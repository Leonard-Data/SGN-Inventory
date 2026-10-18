// The write path of the legacy workbook import: the settled review, address, price, staff and
// attachment rules from `scripts/import-legacy-sheet.mjs`, executed against one project.
//
// Every row this module writes is keyed by a stable identifier derived from its source key, so
// re-running it converges instead of duplicating: a second run finds the row already there and
// does nothing, and an interrupted run resumes from the batch, staging and map rows it left
// behind. `private.import_batches`, `private.staging_rows`, `private.property_source_map` and
// `private.import_entity_map` record what was written and to which source row.
//
// Properties, addresses, contacts and links are written over an administrative database
// connection, which is the owner role and therefore not subject to row level security. That is
// deliberate and reported: the import preserves each legacy creator and editor as the row's
// author, which the authenticated guard would overwrite with the importing account. Every
// attachment goes through the application's own registration and completion RPCs as the
// importing admin, so the shipped per-file and per-property limits decide what may be stored.
//
// Nothing here reads the Nhân viên password columns, the Login tab, or writes to the sheet or
// Drive. It refuses to run against a project that is not the development project.
import { createHash, createHmac } from 'node:crypto';
import {
  PutObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export const SOURCE_SYSTEM = 'appsheet_google_sheet';

// Fixed namespace for every stable identifier this import derives; changing it would orphan
// every row a previous run wrote.
const UUID_NAMESPACE = '9d0f6a4e-3b1c-4c8f-9a51-7c2f0d5b8e13';

/** A version-5 UUID: the same source key always yields the same row id. */
export function stableUuid(...parts) {
  const digest = createHash('sha1')
    .update([UUID_NAMESPACE, ...parts.map(String)].join('|'))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ---------------------------------------------------------------- attachment planning

const MIME_BY_EXTENSION = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export const fileClassOf = (mimeType) =>
  mimeType === 'application/pdf'
    ? 'document'
    : ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)
      ? 'image'
      : null;

// The same limits migration 20261018031541 enforces in the database.
export const classLimitBytes = { document: 20971520, image: 5242880 };
export const classSlotLimit = { document: 5, image: 10 };

const rstringLower = (value) => String(value ?? '').toLowerCase();

// The roster labels are Vietnamese, so the position is compared accent- and case-insensitively:
// `TPKD`, `Thư ký` and `Thu ky` are the same position.
const foldLabel = (value) =>
  rstringLower(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();

export const mimeTypeFor = (filename) => {
  const match = String(filename ?? '').match(/\.[^.]+$/);
  return MIME_BY_EXTENSION[rstringLower(match?.[0])] ?? null;
};

/**
 * Decide, per attachment row, whether its bytes can become a property file. Every row that
 * cannot is counted under one reason, so a dropped attachment is never silent.
 */
export function planAttachmentImport({
  rows,
  propertiesByKey,
  driveFiles,
  slots = classSlotLimit,
  limits = classLimitBytes,
}) {
  const plan = [];
  const dropped = new Map();
  const droppedRows = [];
  const used = new Map();
  const seen = new Set();
  const drop = (reason, row) => {
    dropped.set(reason, (dropped.get(reason) ?? 0) + 1);
    droppedRows.push({ ...row, reason });
  };
  for (const row of rows) {
    const propertyId = propertiesByKey.get(row.property_key);
    if (!row.property_key) {
      drop('no_property_key', row);
      continue;
    }
    if (!propertyId) {
      drop('property_not_imported', row);
      continue;
    }
    // The same Drive file named twice for one property is one file, not two copies of the bytes.
    if (seen.has(`${row.property_key}|${row.url}`)) {
      drop('repeated_attachment', row);
      continue;
    }
    const file = driveFiles.get(row.url);
    if (!file) {
      drop('missing_drive_file', row);
      continue;
    }
    const mimeType = mimeTypeFor(file.name ?? row.url);
    const kind = fileClassOf(mimeType);
    if (!kind) {
      drop('unsupported_type', row);
      continue;
    }
    const size = Number(file.size ?? 0);
    if (!(size > 0)) {
      drop('empty_file', row);
      continue;
    }
    if (size > limits[kind]) {
      drop(`over_${kind}_limit`, { ...row, size, mimeType });
      continue;
    }
    const slotKey = `${propertyId}|${kind}`;
    const taken = used.get(slotKey) ?? 0;
    if (taken >= slots[kind]) {
      drop('property_slot_limit', { ...row, size, mimeType });
      continue;
    }
    used.set(slotKey, taken + 1);
    seen.add(`${row.property_key}|${row.url}`);
    plan.push({
      ...row,
      property_id: propertyId,
      drive_file_id: file.id,
      drive_name: file.name ?? row.url,
      mime_type: mimeType,
      file_class: kind,
      size_bytes: size,
      file_id: stableUuid(
        'property-file',
        row.legacy_id ?? row.url,
        row.property_key,
      ),
    });
  }
  return {
    plan,
    dropped: [...dropped.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, count })),
    dropped_rows: droppedRows,
    total_bytes: plan.reduce((total, row) => total + row.size_bytes, 0),
  };
}

// ---------------------------------------------------------------- batch and staging

/** Create or resume the batch for this snapshot digest; a re-run converges on the same row. */
export async function openBatch(db, { digest, filename }) {
  const { rows } = await db.query(
    `insert into private.import_batches (source_sha256, filename, status) values ($1,$2,'staged')
       on conflict (source_sha256) do update set filename = excluded.filename
       returning id, status`,
    [digest, filename],
  );
  return rows[0];
}

// ---------------------------------------------------------------- staff

const ROLE_BY_POSITION = { tpkd: 'manager', 'thu ky': 'staff' };

/**
 * The captain's role rule, applied to the position named in the Nhân viên tab:
 * TPKD is a manager, Thư ký is staff, and Admin is sales for everyone but the captain, whose
 * own address is the one admin account. Every other label, and every master address that the
 * tab does not name, is sales.
 */
export function staffRoleFor({ email, position, silentAdminEmail }) {
  const normalized = rstringLower(email).trim();
  if (silentAdminEmail && normalized === rstringLower(silentAdminEmail).trim())
    return 'admin';
  return ROLE_BY_POSITION[foldLabel(position)] ?? 'sales';
}

/**
 * The addresses to provision: every creator and editor the master tab names, plus every address
 * in the Nhân viên roster, each with exactly one role and its roster name when it has one.
 */
export function planStaffAccounts({
  masterEmails,
  employeeRows,
  silentAdminEmail,
}) {
  const positionByEmail = new Map();
  const nameByEmail = new Map();
  for (const row of employeeRows) {
    const email = rstringLower(row.email).trim();
    if (!email || !email.includes('@')) continue;
    positionByEmail.set(email, row.position ?? '');
    if (row.name) nameByEmail.set(email, row.name);
  }
  const master = masterEmails.map((email) => rstringLower(email).trim());
  const addresses = [
    ...master,
    ...[...positionByEmail.keys()].filter((email) => !master.includes(email)),
  ];
  const unique = [...new Set(addresses.filter((email) => email.includes('@')))];
  return unique
    .map((email) => ({
      email,
      role: staffRoleFor({
        email,
        position: positionByEmail.get(email),
        silentAdminEmail,
      }),
      position: positionByEmail.get(email) ?? null,
      display_name: nameByEmail.get(email) ?? null,
      silent: email === rstringLower(silentAdminEmail).trim(),
      source: master.includes(email) ? 'master_email' : 'employee_tab',
    }))
    .sort((a, b) =>
      a.silent === b.silent
        ? a.email.localeCompare(b.email)
        : a.silent
          ? -1
          : 1,
    );
}

// ---------------------------------------------------------------- REST helpers

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be configured for a write run`);
  return value;
}

function http() {
  return {
    supabaseUrl: required('NEXT_PUBLIC_SUPABASE_URL').replace(/\/$/, ''),
    publishableKey: required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
    serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    appUrl: required('NEXT_PUBLIC_APP_URL'),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The link to Drive and R2 drops connections, and a dropped connection otherwise waits forever:
// each transfer carries its own deadline and is retried a bounded number of times. The file
// transfers get a wider budget than a provider call because that link resets single requests
// sporadically: one observed run lost nearly half its first attempts with `socket hang up`,
// which three attempts cannot ride out, while every one of them succeeded on a later attempt.
const DOWNLOAD_TIMEOUT_MS = 120000;
const UPLOAD_TIMEOUT_MS = 180000;
const TRANSFER_ATTEMPTS = 8;

// The link to the provider is long and occasionally drops a connection. A transport failure is
// retried a bounded number of times; a refusal is never retried.
async function withRetry(operation, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw last;
}

async function readJson(response) {
  const body = await response.text();
  try {
    return body ? JSON.parse(body) : null;
  } catch {
    return { raw: body };
  }
}

export async function signIn({ supabaseUrl, publishableKey, email, password }) {
  const response = await fetch(
    `${supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    },
  );
  const body = await readJson(response);
  if (!response.ok || !body?.access_token)
    throw new Error(
      `sign-in as ${email} failed: ${response.status} ${body?.error_description ?? body?.msg ?? ''}`.trim(),
    );
  return body.access_token;
}

/**
 * The captain's Auth identity: created once, and on a later run the existing identity is given
 * the password this run holds, so a re-run converges on the credential written to the captain's
 * file instead of leaving an account nobody can sign in to.
 */
async function ensureAuthUser(
  { supabaseUrl, serviceRoleKey },
  { email, password },
) {
  const existing = await findAuthUser({ supabaseUrl, serviceRoleKey }, email);
  if (existing) {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${existing}`,
      {
        method: 'PUT',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password, email_confirm: true }),
      },
    );
    if (!response.ok) {
      const body = await readJson(response);
      throw new Error(
        `setting the password for ${email} failed: ${response.status} ${body?.msg ?? body?.message ?? ''}`.trim(),
      );
    }
    return { outcome: 'existing', userId: existing };
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: {},
      data: {},
    }),
  });
  const body = await readJson(response);
  if (response.ok && body?.id) return { outcome: 'created', userId: body.id };
  throw new Error(
    `auth user creation for ${email} failed: ${response.status} ${body?.msg ?? body?.message ?? ''}`.trim(),
  );
}

async function findAuthUser({ supabaseUrl, serviceRoleKey }, email) {
  const wanted = rstringLower(email).trim();
  for (let page = 1; page <= 20; page += 1) {
    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users?page=${page}&per_page=50`,
      {
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (!response.ok) return null;
    const body = await readJson(response);
    const users = body?.users;
    if (!Array.isArray(users)) return null;
    const match = users.find(
      (user) => rstringLower(user?.email).trim() === wanted,
    );
    if (match?.id) return match.id;
    if (users.length < 50) return null;
  }
  return null;
}

// The provider's own invitation request, with the fixed application destination the admin
// form uses and no company data in editable metadata.
async function inviteByEmail({ supabaseUrl, serviceRoleKey, appUrl }, email) {
  const response = await fetch(`${supabaseUrl}/auth/v1/invite`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      data: {},
      redirect_to: `${appUrl.replace(/\/$/, '')}/auth/invite`,
    }),
  });
  return { status: response.status, body: await readJson(response) };
}

const isUuid = (value) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

/**
 * The provider outcome, read the way the application reads it: a 4xx is a refusal, anything
 * else is ambiguous, and acceptance needs the confirmed identity of exactly this address.
 */
export function classifyInviteResponse({ status, body }, email) {
  if (status >= 400) {
    const detail = String(
      body?.msg ?? body?.error_description ?? body?.message ?? '',
    ).slice(0, 300);
    return { outcome: status < 500 ? 'failed' : 'ambiguous', detail };
  }
  const id = body?.id ?? body?.user?.id;
  const confirmed = rstringLower(body?.email ?? body?.user?.email).trim();
  if (!isUuid(id) || confirmed !== rstringLower(email).trim())
    return {
      outcome: 'ambiguous',
      detail:
        'the provider accepted the request without confirming the intended identity',
    };
  return { outcome: 'accepted', providerUserId: id };
}

// Supabase refuses the extra message with 429 once the hourly send cap is reached; that is a
// wait, never a failed invitation, so it must be distinguishable from a real provider refusal.
export function isRateLimitResponse({ status }) {
  return status === 429;
}

// ---------------------------------------------------------------- database steps

const DEV_STAGES = new Set(['dev', 'development', 'local']);
const PRODUCTION_STAGES = new Set(['prod', 'production']);

/**
 * The one production project a production-labelled run may write. It is pinned here rather than
 * read from the environment, so no environment file can relabel another project as production.
 */
export const PRODUCTION_PROJECT_REF = 'zckhbxpatjmdqpnqphgy';

/** The buckets whose rows the write path imports. */
export const importableBucket = (bucket) =>
  bucket === 'ready' || bucket === 'review';

/**
 * Converted addresses the project had no admin unit for: how many rows, and the unit codes that
 * were missing. They keep the legacy address only, and this is what the run reports.
 */
export function convertedSkipped(rows) {
  const codes = new Map();
  for (const row of rows) {
    const code = `${row.province_code}/${row.commune_code}`;
    codes.set(code, (codes.get(code) ?? 0) + 1);
  }
  return {
    rows: rows.length,
    codes: [...codes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([code, count]) => ({ code, rows: count })),
  };
}

/** The project a database URL names, from its host or its pooler user; null when it names none. */
export function projectRefFromDatabaseUrl(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  const direct = /^(?:db\.)?([a-z]{20})\.supabase\.co$/.exec(url.hostname);
  if (direct) return direct[1];
  const pooled = /^[a-z0-9-]+\.([a-z]{20})$/.exec(
    decodeURIComponent(url.username),
  );
  if (pooled && url.hostname.endsWith('.pooler.supabase.com')) return pooled[1];
  return null;
}

/** The project an API URL names; null when it names none. */
export function projectRefFromSupabaseUrl(supabaseUrl) {
  try {
    return (
      /^([a-z]{20})\.supabase\.co$/.exec(new URL(supabaseUrl).hostname)?.[1] ??
      null
    );
  } catch {
    return null;
  }
}

/**
 * The declared stage is a claim every write target has to prove: the run is refused unless the
 * database, the Supabase API that creates Auth users and invitations, and the file bucket all
 * belong to the stage the run declares, before anything is written. A development label on a
 * production target and a production label on any other project are both refused, so the label
 * and the projects it points at are checked against each other rather than trusted.
 */
export function assertWriteTarget(databaseUrl, values = process.env) {
  const stage = (values.SGN_ENV ?? '').trim().toLowerCase();
  const production = PRODUCTION_STAGES.has(stage);
  if (!production && !DEV_STAGES.has(stage))
    throw new Error(
      `a write run needs SGN_ENV=dev or prod; it is "${stage || '(unset)'}"`,
    );
  const dev = (
    values.DEV_SUPABASE_PROJECT_REF ??
    values.EXPECTED_SUPABASE_PROJECT_REF ??
    ''
  )
    .trim()
    .toLowerCase();
  if (!production && !/^[a-z]{20}$/.test(dev))
    throw new Error(
      'the development project reference is not configured (DEV_SUPABASE_PROJECT_REF or EXPECTED_SUPABASE_PROJECT_REF)',
    );
  if (!production && dev === PRODUCTION_PROJECT_REF)
    throw new Error(
      `the run is labelled "${stage}" and its expected project is the production project ${PRODUCTION_PROJECT_REF}; both references name ${dev}`,
    );
  const configuredProd = (values.PROD_SUPABASE_PROJECT_REF ?? '')
    .trim()
    .toLowerCase();
  if (configuredProd && configuredProd !== PRODUCTION_PROJECT_REF)
    throw new Error(
      `PROD_SUPABASE_PROJECT_REF names ${configuredProd}, not the production project ${PRODUCTION_PROJECT_REF}`,
    );
  const expectedRef = production ? PRODUCTION_PROJECT_REF : dev;
  const target = production ? 'production' : 'development';
  const bucket = (values.R2_BUCKET ?? '').trim();
  const expectedBucket = (values.EXPECTED_R2_BUCKET ?? '').trim();
  if (!expectedBucket)
    throw new Error(
      `the ${target} R2 bucket is not configured (EXPECTED_R2_BUCKET)`,
    );
  const account = (values.R2_ACCOUNT_ID ?? '').trim();
  const expectedAccount = (values.EXPECTED_R2_ACCOUNT_ID ?? '').trim();
  if (!expectedAccount)
    throw new Error(
      `the ${target} R2 account is not configured (EXPECTED_R2_ACCOUNT_ID)`,
    );
  const targets = [
    [
      'IMPORT_DATABASE_URL',
      projectRefFromDatabaseUrl(databaseUrl),
      expectedRef,
    ],
    [
      'NEXT_PUBLIC_SUPABASE_URL',
      projectRefFromSupabaseUrl(values.NEXT_PUBLIC_SUPABASE_URL),
      expectedRef,
    ],
    ['R2_BUCKET', bucket || null, expectedBucket],
    ['R2_ACCOUNT_ID', account || null, expectedAccount],
  ];
  for (const [name, resolved, expected] of targets) {
    if (!resolved)
      throw new Error(
        `${name} names no target to check; the ${target} target is ${expected}`,
      );
    if (resolved !== expected)
      throw new Error(
        `${name} names ${resolved}${resolved === dev ? ' (the development project)' : ''}, not the ${target} target ${expected} for stage "${stage}"`,
      );
  }
  return {
    stage: production ? 'prod' : 'dev',
    projectRef: expectedRef,
    bucket,
    account,
  };
}

export async function connect(databaseUrl) {
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    connectionString: databaseUrl,
    statement_timeout: 120000,
  });
  await client.connect();
  return client;
}

async function unitIds(db, cache) {
  return async (level, code, effectiveOn = '2025-07-01') => {
    const key = `${level}|${code}|${effectiveOn}`;
    if (cache.has(key)) return cache.get(key);
    const { rows } = await db.query(
      `select id from public.admin_unit_versions
        where unit_level = $1 and official_code = $2
          and valid_from <= $3 and (valid_to is null or valid_to > $3)
        order by valid_from desc limit 1`,
      [level, code, effectiveOn],
    );
    const id = rows[0]?.id ?? null;
    cache.set(key, id);
    return id;
  };
}

export function currentAddressText(address, target) {
  const local = [address.house_number, address.street]
    .filter(Boolean)
    .join(' ');
  return [local, target.name, target.provinceName].filter(Boolean).join(', ');
}

/**
 * One batch transaction: the property, its two addresses, its shared owner contact, the link,
 * the source map and the entity map. Every insert is a no-op when the stable id is already
 * present, so a resumed or repeated run neither duplicates a row nor loses one.
 */
// One statement per table per batch: the link to the project is slow enough that a row-at-a-time
// loop would spend hours waiting on round trips.
function insertMany(
  table,
  columns,
  rows,
  { conflict = 'on conflict do nothing', returning = '' } = {},
) {
  const params = [];
  const tuples = rows.map(
    (row) =>
      `(${row
        .map((value) => {
          params.push(value);
          return `$${params.length}`;
        })
        .join(',')})`,
  );
  return {
    text: `insert into ${table} (${columns.join(',')}) values ${tuples.join(',')} ${conflict} ${returning}`.trim(),
    values: params,
  };
}

async function writePropertyBatch(
  db,
  { batchId, sheet, records, unitId, contactKey },
) {
  const rows = records.map((record) => ({
    record,
    property: record.mapped.property,
    address: record.mapped.address,
    contact: record.mapped.contact,
    propertyId: stableUuid('property', SOURCE_SYSTEM, record.source_key),
    legacyAddressId: stableUuid(
      'address',
      'legacy',
      SOURCE_SYSTEM,
      record.source_key,
    ),
    currentAddressId: stableUuid(
      'address',
      'current',
      SOURCE_SYSTEM,
      record.source_key,
    ),
    target: (record.address_detail?.target ?? [])[0] ?? null,
  }));
  for (const row of rows) {
    if (!row.target) continue;
    row.provinceUnitId = await unitId('province', row.target.provinceCode);
    row.communeUnitId = await unitId('commune', row.target.code);
  }
  // A row the report counts as converted but the project has no unit for keeps its legacy
  // address only, so it is counted here instead of vanishing from the run.
  const addresses = {
    converted_skipped: rows
      .filter((row) => row.target && !(row.provinceUnitId && row.communeUnitId))
      .map((row) => ({
        source_row: row.record.source_row,
        source_key: row.record.source_key,
        province_code: row.target.provinceCode,
        commune_code: row.target.code,
      })),
  };
  const written = [];
  await db.query('begin');
  try {
    // The property code comes from the project's own sequence, one value per row, so the
    // numbering stays the project's and never repeats a code.
    const propertyParams = [];
    const propertyTuples = rows.map((row) => {
      const placeholders = [
        row.propertyId,
        row.property.listing_mode,
        row.property.property_type,
        row.property.access_type,
        row.property.status,
        row.property.land_area_m2,
        row.property.frontage_m,
        row.property.depth_m,
        row.property.area_raw,
        row.property.direction,
        row.property.sale_price_vnd,
        row.property.monthly_rent_vnd,
        row.property.construction_text,
        row.property.notes,
        row.property.entry_on,
        row.property.entry_on ? 'legacy' : 'unknown',
        row.record.creator_employee_id ?? null,
        row.record.editor_employee_id ?? null,
      ].map((value) => {
        propertyParams.push(value);
        return `$${propertyParams.length}`;
      });
      return [
        placeholders[0],
        `'SGN-' || lpad(nextval('private.property_code_sequence')::text, 8, '0')`,
        ...placeholders.slice(1, 5),
        `'pending'`,
        `'unknown'`,
        ...placeholders.slice(5),
      ].join(',');
    });
    const propertyInsert = {
      text: `insert into public.properties (id, property_code, listing_mode, property_type, access_type,
           status, record_review_status, legal_status, land_area_m2, frontage_m, depth_m, area_raw,
           direction, sale_price_vnd, monthly_rent_vnd, construction_text, notes, entry_on,
           entry_source, created_by, updated_by)
         values ${propertyTuples.map((tuple) => `(${tuple})`).join(',')}
         on conflict (id) do nothing returning id`,
      values: propertyParams,
    };
    const created = await db.query(propertyInsert);
    const createdIds = new Set(created.rows.map((row) => row.id));

    await db.query(
      insertMany(
        'public.property_addresses',
        [
          'id',
          'property_id',
          'format',
          'address_text',
          'house_number',
          'street',
          'province_text',
          'district_text',
          'commune_text',
          'mapping_status',
          'is_primary',
          'mapping_evidence',
        ],
        rows.map((row) => [
          row.legacyAddressId,
          row.propertyId,
          'legacy',
          row.address.address_text,
          row.address.house_number,
          row.address.street,
          row.address.province_text,
          row.address.district_text,
          row.address.commune_text,
          'unresolved',
          true,
          row.address.mapping_evidence ?? null,
        ]),
      ),
    );

    const currentRows = rows.filter(
      (row) => row.provinceUnitId && row.communeUnitId,
    );
    if (currentRows.length)
      await db.query(
        insertMany(
          'public.property_addresses',
          [
            'id',
            'property_id',
            'format',
            'address_text',
            'house_number',
            'street',
            'province_unit_id',
            'commune_unit_id',
            'mapping_status',
            'source_url',
            'effective_on',
            'mapping_evidence',
            'is_primary',
          ],
          currentRows.map((row) => [
            row.currentAddressId,
            row.propertyId,
            'current',
            currentAddressText(row.address, row.target),
            row.address.house_number,
            row.address.street,
            row.provinceUnitId,
            row.communeUnitId,
            'candidate',
            row.record.address_detail?.evidence ?? null,
            '2025-07-01',
            `converted from legacy ${row.address.province_text} / ${row.address.district_text} / ${row.address.commune_text}`,
            true,
          ]),
        ),
      );

    const contacts = new Map();
    for (const row of rows)
      if (row.contact)
        contacts.set(
          stableUuid('contact', contactKey(row.contact)),
          row.contact,
        );
    if (contacts.size)
      await db.query(
        insertMany(
          'public.contacts',
          ['id', 'display_name', 'phones', 'raw_phone_text', 'contact_type'],
          [...contacts.entries()].map(([id, contact]) => [
            id,
            contact.display_name,
            contact.phones,
            contact.raw_phone_text,
            'owner',
          ]),
        ),
      );

    const links = rows
      .filter((row) => row.contact)
      .map((row) => [
        row.propertyId,
        stableUuid('contact', contactKey(row.contact)),
      ]);
    if (links.length)
      await db.query(
        insertMany(
          'public.property_contacts',
          ['property_id', 'contact_id', 'relation', 'is_primary'],
          links.map(([propertyId, contactId]) => [
            propertyId,
            contactId,
            'owner',
            true,
          ]),
          { conflict: 'on conflict do nothing' },
        ),
      );

    await db.query(
      insertMany(
        'private.property_source_map',
        ['source_system', 'source_key', 'property_id', 'evidence'],
        rows.map((row) => [
          SOURCE_SYSTEM,
          row.record.source_key,
          row.propertyId,
          `spreadsheet ${row.record.spreadsheet_id} sheet "${sheet}" row ${row.record.source_row}`,
        ]),
      ),
    );
    await db.query(
      insertMany(
        'private.import_entity_map',
        ['batch_id', 'sheet', 'source_row', 'entity_table', 'entity_id'],
        rows.map((row) => [
          batchId,
          sheet,
          row.record.source_row,
          'properties',
          row.propertyId,
        ]),
        {
          conflict:
            'on conflict (batch_id, sheet, source_row, entity_table) do update set entity_id = excluded.entity_id',
        },
      ),
    );
    await db.query(
      `update private.staging_rows set disposition = 'promoted'
        where batch_id = $1 and sheet = $2 and source_row = any($3::int[])`,
      [batchId, sheet, rows.map((row) => row.record.source_row)],
    );
    for (const row of rows)
      written.push({
        source_row: row.record.source_row,
        source_key: row.record.source_key,
        property_id: row.propertyId,
        created: createdIds.has(row.propertyId),
      });
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  return { written, addresses };
}

/**
 * Import every accepted master row in bounded batches, committing each one so an interruption
 * costs at most one batch and a re-run continues from the staging rows already promoted.
 */
export async function importProperties(
  db,
  {
    batchId,
    sheet,
    records,
    spreadsheetId,
    employeesByEmail,
    contactKey,
    batchSize = 200,
    log = () => {},
  },
) {
  const cache = new Map();
  const unitId = await unitIds(db, cache);
  // A resumed run continues where the last one stopped: a master row already promoted for this
  // batch is not rewritten, so its property, addresses and contact are left exactly as they are.
  const { rows: done } = await db.query(
    `select source_row from private.staging_rows
      where batch_id = $1 and sheet = $2 and disposition = 'promoted'`,
    [batchId, sheet],
  );
  const promoted = new Set(done.map((row) => row.source_row));
  const accepted = records.filter(
    (record) =>
      importableBucket(record.bucket) && !promoted.has(record.source_row),
  );
  if (promoted.size)
    log(`properties: ${promoted.size} source rows already written, resuming`);
  const written = [];
  const addresses = { converted_skipped: [] };
  for (let index = 0; index < accepted.length; index += batchSize) {
    const slice = accepted.slice(index, index + batchSize).map((record) => ({
      ...record,
      spreadsheet_id: spreadsheetId,
      creator_employee_id:
        employeesByEmail.get(
          rstringLower(record.mapped.creator_email).trim(),
        ) ?? null,
      editor_employee_id:
        employeesByEmail.get(rstringLower(record.mapped.editor_email).trim()) ??
        null,
    }));
    const batch = await writePropertyBatch(db, {
      batchId,
      sheet,
      records: slice,
      unitId,
      contactKey,
    });
    written.push(...batch.written);
    addresses.converted_skipped.push(...batch.addresses.converted_skipped);
    log(
      `properties: ${Math.min(index + batchSize, accepted.length)}/${accepted.length} source rows committed`,
    );
  }
  if (addresses.converted_skipped.length) {
    const skipped = convertedSkipped(addresses.converted_skipped);
    log(
      `addresses: ${skipped.rows} converted rows kept the legacy address only; missing admin units ${skipped.codes.map((entry) => `${entry.code} x${entry.rows}`).join(', ')}`,
    );
  }
  return {
    source_rows: accepted.length,
    created: written.filter((row) => row.created).length,
    already_present: written.filter((row) => !row.created).length,
    addresses,
    written,
  };
}

// ---------------------------------------------------------------- staff provisioning

/**
 * The silent admin account: an Auth identity created through the admin API, linked to an
 * active admin employee, with no invitation email. The password is handed back to the caller
 * to be written to the captain's private file and is never logged, printed or stored.
 */
export async function provisionSilentAdmin(
  db,
  { staff, password, log = () => {} },
) {
  const config = http();
  const auth = await ensureAuthUser(config, {
    email: staff.email,
    password,
    displayName: staff.display_name,
  });
  const { rows } = await db.query(
    `insert into public.employees (email, display_name, role, is_active, auth_user_id)
     values ($1,$2,'admin',true,$3)
     on conflict (email) do update
       set display_name = excluded.display_name, role = 'admin', is_active = true,
           auth_user_id = excluded.auth_user_id
     returning id, auth_user_id`,
    [staff.email, staff.display_name ?? staff.email, auth.userId],
  );
  log(
    `staff: ${staff.email} is the silent admin (auth user ${auth.outcome}), no invitation sent`,
  );
  return { ...rows[0], auth_user_id: auth.userId };
}

/**
 * Begin every invitation the operator still has to send. Beginning records the intended role
 * and creates the retained, inactive employee row, so the property import can attribute the
 * legacy authors; the provider call is a separate, rate-limited step.
 */
export async function beginInvitations(
  db,
  { staff, actorEmail, actorPassword, log = () => {} },
) {
  const config = http();
  const token = await signIn({
    supabaseUrl: config.supabaseUrl,
    publishableKey: config.publishableKey,
    email: actorEmail,
    password: actorPassword,
  });
  // A recorded invitation is settled: nothing is re-sent, and a role corrected afterwards does
  // not turn the already-recorded invitation into a refusal.
  const { rows: recordedRows } = await db.query(
    "select email from public.employee_invitations where state = 'recorded'",
  );
  const recorded = new Set(
    recordedRows.map((row) => rstringLower(row.email).trim()),
  );
  const results = [];
  for (const person of staff) {
    if (person.silent) continue;
    if (recorded.has(rstringLower(person.email).trim())) {
      results.push({
        email: person.email,
        role: person.role,
        stated: true,
        state: 'recorded',
        invitation_id: null,
        revision: null,
        detail: null,
      });
      continue;
    }
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/rpc/begin_employee_invitation`,
      {
        method: 'POST',
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_email: person.email,
          p_role: person.role,
          p_key: stableUuid('invitation', person.email),
        }),
      },
    );
    const body = await readJson(response);
    const refused = !response.ok;
    results.push({
      email: person.email,
      role: person.role,
      stated: !refused,
      state: refused ? null : (body?.state ?? null),
      invitation_id: refused ? null : (body?.id ?? null),
      revision: refused ? null : (body?.revision ?? null),
      detail: refused
        ? `${response.status} ${body?.message ?? body?.code ?? ''}`.trim()
        : null,
    });
    if (refused)
      log(
        `staff: invitation for ${person.email} refused — ${results.at(-1).detail}`,
      );
  }
  const open = results.filter(
    (entry) => entry.stated && entry.state !== 'recorded',
  );
  const settled = results.filter((entry) => entry.state === 'recorded');
  log(
    `staff: ${open.length} invitation(s) open, ${settled.length} already recorded, ${results.length - open.length - settled.length} refused`,
  );
  return results;
}

/**
 * Send each open invitation through the provider and record exactly one outcome per row.
 * The provider allows 30 messages an hour, so a refusal for rate is waited out and retried;
 * the invitation keeps its open state while it waits and nothing is claimed until recorded.
 */
export async function sendInvitations({
  invitations,
  actorId,
  waitSeconds = 300,
  maxWaits = 48,
  log = () => {},
}) {
  const config = http();
  const open = invitations.filter(
    (entry) =>
      entry.stated && entry.invitation_id && entry.state !== 'recorded',
  );
  const outcomes = [];
  for (const entry of open) {
    let attempts = 0;
    let settled = null;
    while (!settled) {
      const provider = await inviteByEmail(config, entry.email);
      if (isRateLimitResponse(provider)) {
        attempts += 1;
        if (attempts > maxWaits) {
          settled = {
            outcome: 'ambiguous',
            detail: 'the provider kept refusing for rate',
          };
          break;
        }
        log(
          `staff: provider at its hourly cap; waiting ${waitSeconds}s before ${entry.email}`,
        );
        await sleep(waitSeconds * 1000);
        continue;
      }
      settled = classifyInviteResponse(provider, entry.email);
      if (settled.outcome === 'failed') {
        // A refusal of an address the provider already holds means an earlier send landed
        // without its recording; the identity lookup decides, never the error text.
        const identity = await findAuthUser(config, entry.email);
        if (identity)
          settled = { outcome: 'accepted', providerUserId: identity };
      }
    }
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/rpc/record_employee_invitation_result`,
      {
        method: 'POST',
        headers: {
          apikey: config.serviceRoleKey,
          Authorization: `Bearer ${config.serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_invitation_id: entry.invitation_id,
          p_revision: entry.revision,
          p_actor_id: actorId,
          p_email: entry.email,
          p_outcome: settled.outcome,
          p_provider_user_id:
            settled.outcome === 'accepted' ? settled.providerUserId : null,
          p_detail:
            settled.outcome === 'accepted' ? null : (settled.detail ?? null),
        }),
      },
    );
    const body = await readJson(response);
    outcomes.push({
      email: entry.email,
      outcome: settled.outcome,
      recorded: response.ok,
      detail: response.ok
        ? null
        : `${response.status} ${body?.message ?? ''}`.trim(),
    });
    log(
      `staff: ${entry.email} invitation ${settled.outcome}${response.ok ? ' recorded' : ' NOT recorded'}`,
    );
  }
  return outcomes;
}

/**
 * The invitations this run recorded: the outcome write was accepted and the provider accepted the
 * address. A recorded failure is not a recorded invitation.
 */
export const recordedInvitations = (sends) =>
  sends.filter((entry) => entry.recorded && entry.outcome === 'accepted')
    .length;

// ---------------------------------------------------------------- attachments

function r2Client({ accountId, bucket, accessKeyId, secretAccessKey }) {
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return { client, bucket };
}

export const objectIdentity = (etag) => {
  const hex = createHash('md5')
    .update(String(etag ?? ''))
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

// A resumed upload finds its object already present, so its identity is read back from the
// stored object instead of the create response.
async function headIdentity(storage, objectPath) {
  const head = await storage.client.send(
    new HeadObjectCommand({ Bucket: storage.bucket, Key: objectPath }),
  );
  return head?.ETag ? objectIdentity(head.ETag) : null;
}

const validationSignature = (keyHex, payload) =>
  createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(payload, 'utf8')
    .digest('hex');

/**
 * Download one attachment and store it as the property's file: register through the
 * application's own path, put the bytes into the private bucket, then complete the upload with
 * the server-side attestation the application stores. A file already ready is left alone.
 */
export async function importAttachments(
  db,
  {
    plan,
    driveToken,
    actorAuthUserId,
    actorEmployeeId,
    validationKeyHex,
    r2,
    fetchImpl = fetch,
    log = () => {},
  },
) {
  // The whole attachment phase acts as the importing admin: the registration and completion RPCs
  // read the caller from this claim, and one session-level claim is enough for every file.
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: actorAuthUserId, role: 'authenticated' }),
  ]);
  const storage = r2Client(r2);
  const results = [];
  for (const row of plan) {
    const existing = await db.query(
      'select upload_status from public.property_files where id = $1',
      [row.file_id],
    );
    if (existing.rows[0]?.upload_status === 'ready') {
      results.push({ ...row, outcome: 'already_ready' });
      continue;
    }
    const download = await withRetry(async () => {
      const response = await fetchImpl(
        `https://www.googleapis.com/drive/v3/files/${row.drive_file_id}?alt=media&supportsAllDrives=true`,
        {
          headers: { Authorization: `Bearer ${driveToken}` },
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
        },
      );
      if (!response.ok) return { ok: false, detail: String(response.status) };
      return { ok: true, bytes: Buffer.from(await response.arrayBuffer()) };
    }, TRANSFER_ATTEMPTS).catch((error) => ({
      ok: false,
      detail: `network: ${error?.message ?? error}`,
    }));
    // A refusal fails this one row only. A transport failure retries the whole request, so a
    // stalled body is never re-read from the response that already timed out.
    if (!download.ok) {
      results.push({
        ...row,
        outcome: 'download_failed',
        detail: download.detail,
      });
      continue;
    }
    const bytes = download.bytes;
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    await db.query('begin');
    try {
      // The database decides whether this registration is allowed: the class limits are
      // enforced by the shipped RPC, so a refusal is reported rather than worked around.
      const registered = await db.query(
        `select private.register_property_file($1,$2,$3,$4,$5,$6,$7,$8) as body`,
        [
          row.file_id,
          row.property_id,
          row.drive_name,
          row.mime_type,
          bytes.length,
          sha256,
          row.file_class === 'document' ? 'document' : 'photo',
          'ffffffff-ffff-ffff-ffff-ffffffffffff',
        ],
      );
      const objectPath = registered.rows[0]?.body?.objectPath;
      if (!objectPath) throw new Error('registration returned no object path');
      // A resumed run finds the bytes it already wrote for this object key; that is the
      // conditional create working, so it is read back rather than treated as a failure.
      const put = await withRetry(async () => {
        try {
          return await storage.client.send(
            new PutObjectCommand({
              Bucket: storage.bucket,
              Key: objectPath,
              Body: bytes,
              ContentType: row.mime_type,
              ContentLength: bytes.length,
              IfNoneMatch: '*',
            }),
            { abortSignal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) },
          );
        } catch (error) {
          const status = error?.$metadata?.httpStatusCode;
          if (
            status === 412 ||
            String(error?.name ?? '').includes('Precondition')
          )
            return { ETag: null };
          throw error;
        }
      }, TRANSFER_ATTEMPTS);
      if (put) {
        const objectId = put.ETag
          ? objectIdentity(put.ETag)
          : await withRetry(
              () => headIdentity(storage, objectPath),
              TRANSFER_ATTEMPTS,
            );
        if (!objectId)
          throw new Error('the stored object has no identity to record');
        const payload = [
          'v1',
          row.file_id,
          row.property_id,
          actorEmployeeId,
          objectPath,
          objectId,
          row.mime_type,
          String(bytes.length),
          sha256,
        ].join('|');
        await db.query(
          `select public.complete_property_upload($1,$2,$3,$4,$5,$6)`,
          [
            row.file_id,
            objectId,
            row.mime_type,
            bytes.length,
            sha256,
            validationSignature(validationKeyHex, payload),
          ],
        );
      }
      await db.query('commit');
      results.push({ ...row, outcome: 'stored', bytes: bytes.length, sha256 });
      log(
        `attachments: ${results.filter((entry) => entry.outcome === 'stored').length}/${plan.length} stored`,
      );
    } catch (error) {
      await db.query('rollback');
      const message = String(error?.message ?? error);
      const refused =
        /P0020|P0021|P0022/.test(message) ||
        /limit reached|exceeds/.test(message);
      results.push({
        ...row,
        outcome: refused ? 'refused_by_limit' : 'failed',
        detail: message.slice(0, 300),
      });
      log(
        `attachments: ${row.legacy_id ?? row.url} ${refused ? 'refused by the file limits' : 'failed'} — ${message}`,
      );
    }
  }
  const counts = new Map();
  for (const result of results)
    counts.set(result.outcome, (counts.get(result.outcome) ?? 0) + 1);
  return {
    results,
    outcomes: [...counts.entries()].map(([outcome, count]) => ({
      outcome,
      count,
    })),
  };
}

// ---------------------------------------------------------------- verification

/** Read the import back: counts from the batch's own map rows, then samples end to end. */
export async function verifyImport(db, { batchId, sheet, samples = 5 }) {
  const count = async (sql, params = []) => {
    const { rows } = await db.query(sql, params);
    return Number(rows[0]?.count ?? 0);
  };
  const mapped = await db.query(
    `select source_row, entity_id from private.import_entity_map
      where batch_id = $1 and sheet = $2 and entity_table = 'properties'
      order by source_row`,
    [batchId, sheet],
  );
  const propertyIds = mapped.rows.map((row) => row.entity_id);
  const counts = {
    source_rows: await count(
      'select count(*) from private.staging_rows where batch_id = $1 and sheet = $2',
      [batchId, sheet],
    ),
    promoted: await count(
      `select count(*) from private.staging_rows where batch_id = $1 and sheet = $2 and disposition = 'promoted'`,
      [batchId, sheet],
    ),
    properties: propertyIds.length,
    source_map: await count(
      `select count(*) from private.property_source_map where property_id = any($1::uuid[])`,
      [propertyIds],
    ),
    legacy_addresses: await count(
      `select count(*) from public.property_addresses where format = 'legacy' and property_id = any($1::uuid[])`,
      [propertyIds],
    ),
    current_addresses: await count(
      `select count(*) from public.property_addresses where format = 'current' and property_id = any($1::uuid[])`,
      [propertyIds],
    ),
    contact_links: await count(
      `select count(*) from public.property_contacts where property_id = any($1::uuid[])`,
      [propertyIds],
    ),
    contacts: await count(
      `select count(distinct contact_id) from public.property_contacts where property_id = any($1::uuid[])`,
      [propertyIds],
    ),
    files: await count(
      `select count(*) from public.property_files where property_id = any($1::uuid[]) and upload_status = 'ready'`,
      [propertyIds],
    ),
    invitations_recorded: await count(
      `select count(*) from public.employee_invitations where state = 'recorded'`,
    ),
    employees: await count('select count(*) from public.employees'),
    active_admin: await count(
      `select count(*) from public.employees where role = 'admin' and is_active`,
    ),
  };
  const sampleRows = await db.query(
    `select p.id, p.property_code, p.listing_mode, p.status, p.sale_price_vnd, p.record_review_status,
            (select count(*) from public.property_addresses a where a.property_id = p.id and a.format='legacy') as legacy_addresses,
            (select count(*) from public.property_addresses a where a.property_id = p.id and a.format='current') as current_addresses,
            (select count(*) from public.property_contacts c where c.property_id = p.id) as contacts,
            (select count(*) from public.property_files f where f.property_id = p.id and f.upload_status='ready') as files,
            (select count(*) from private.property_source_map m where m.property_id = p.id) as source_keys
       from public.properties p where p.id = any($1::uuid[])
      order by p.property_code limit $2`,
    [propertyIds, samples],
  );
  return { counts, samples: sampleRows.rows };
}
