// Issue #35 hosted acceptance: reviewer-only province owner-contact activity.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and real
// Chrome sessions. It creates only the synthetic identities, catalog fixtures, properties,
// contacts and committed activity rows the report needs under an exact-ID private manifest, and
// removes exactly what it created through the supported operator-SQL and service-role paths.
// Synthetic employee rows are written, role-changed and removed through the owner database
// connection as well: the live employee admin-state guard rejects service-role employee
// inserts, sign-in links and lifecycle changes, and the owner connection is the same path the
// repo's operator fixtures already use.
// Mock, shim and readiness-page results are not acceptance.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node --env-file-if-exists=.env.local scripts/province-activity-acceptance.mjs \
//     [--report <sanitized json path>]
//
// The local application must already be built (`npm run build`); the harness starts `next start`
// on SGN_ACCEPTANCE_PORT and stops it again.
//
// The dev env supplies the publishable application settings; the owner config supplies the
// operator database URL and owner capability. Both are read as data only and are never printed
// or shell sourced. The owner Auth key stays in-process, but `supabase db query` accepts no
// other connection source, so each maintenance fixture statement carries the owner database URL
// (with its password) in the child process argv and it is visible in the process table while
// that statement runs. Counts are asserted as deltas around the fixture write, because the
// report is company-wide and the development project is shared.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

const devEnvPath = process.env.SGN_ACCEPTANCE_DEV_ENV;
const ownerPath = process.env.SGN_ACCEPTANCE_OWNER;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const browserCli =
  process.env.SGN_ACCEPTANCE_BROWSER_CLI ??
  path.join(process.env.HOME ?? '', '.local/bin/chrome-devtools-axi');
const chromeBin =
  process.env.SGN_ACCEPTANCE_CHROME ??
  path.join(
    process.env.HOME ?? '',
    '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  );
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3103);
const keep = process.env.SGN_ACCEPTANCE_KEEP === '1';
const root = path.resolve(import.meta.dirname, '..');
const reportIndex = process.argv.indexOf('--report');
const reportPath =
  reportIndex >= 0
    ? process.argv[reportIndex + 1]
    : path.join(workdir ?? '.', 'acceptance-report.json');

if (process.argv.includes('--help')) {
  console.log(
    'Hosted acceptance for the province owner-contact report. Requires SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR.',
  );
  process.exit(0);
}
assert.ok(
  devEnvPath && ownerPath && workdir,
  'Provide SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR',
);

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const devEnv = parseEnv(await fs.readFile(devEnvPath, 'utf8'));
const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
assert.equal(devEnv.SGN_ENV, 'dev', 'Acceptance must never target production');
assert.equal(
  typeof owner.authAdminKey,
  'string',
  'The owner config must supply the owner capability',
);
assert.equal(
  typeof owner.dbUrl,
  'string',
  'The owner config must supply the operator database URL',
);
const projectRef = devEnv.EXPECTED_SUPABASE_PROJECT_REF;
const environment = readEnvironment(
  { ...devEnv, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}` },
  projectRef,
);
const appUrl = environment.appUrl;
await fs.mkdir(workdir, { recursive: true });

// The owner-capability client bypasses RLS for fixture setup/removal and Auth administration
// only. Every report assertion below runs on a real signed-in publishable-key session.
const admin = createClient(environment.supabaseUrl, owner.authAdminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const observations = [];
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let retryCount = 0;
function isTransient(error) {
  const text = `${error?.message ?? ''} ${error?.details ?? ''}`;
  return /fetch failed|ConnectTimeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|Connection terminated|upstream connect error|502|503|504/i.test(
    text,
  );
}
async function retryResult(label, work, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    const result = await work();
    if (!result?.error || !isTransient(result.error) || attempt >= attempts)
      return result;
    retryCount++;
    console.log('RETRY', label, attempt);
    await sleep(1500 * attempt);
  }
}
async function retryThrown(label, work, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) throw error;
      retryCount++;
      console.log('RETRY', label, attempt);
      await sleep(1500 * attempt);
    }
  }
}
// The maintenance contract keeps property_history append-only and withdraws service-role
// insert/update/delete from properties, property_addresses, contacts and property_contacts, so
// the fixture rows for those tables are written and removed through the owner database
// connection.
function operatorSql(statement) {
  const result = spawnSync(
    'npx',
    [
      'supabase',
      'db',
      'query',
      '--db-url',
      owner.dbUrl,
      '--output-format',
      'json',
      statement,
    ],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (result.status !== 0)
    throw new Error(
      'Operator SQL failed: ' + (result.stdout || result.stderr).slice(-800),
    );
  try {
    return JSON.parse(result.stdout).rows ?? [];
  } catch {
    return [];
  }
}
async function operatorSqlWithRetry(label, statement) {
  return retryThrown(label, async () => operatorSql(statement));
}
const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlId = (id) => `${sqlLiteral(id)}::uuid`;
const sqlIds = (ids) => ids.map(sqlId).join(',');
async function updateEmployee(id, patch) {
  const assignments = Object.entries(patch)
    .map(([column, value]) =>
      typeof value === 'boolean'
        ? `${column} = ${value}`
        : `${column} = ${sqlLiteral(value)}`,
    )
    .join(',');
  const updated = await operatorSqlWithRetry(
    'employee-update',
    `update public.employees set ${assignments} where id=${sqlId(id)} returning id`,
  );
  assert.equal(updated.length, 1, 'employee update affected one row');
  return updated;
}
async function insertRows(label, table, rows) {
  const inserted = await retryResult(label, () =>
    admin.from(table).insert(rows).select('id'),
  );
  assert.equal(inserted.error, null, label);
  return inserted.data ?? [];
}
async function countRows(table) {
  const { count, error } = await retryResult(`count ${table}`, () =>
    admin.from(table).select('*', { count: 'exact', head: true }),
  );
  assert.equal(error, null, `count ${table}`);
  return count;
}
// Exact-identity count of rows this harness created, so removal is asserted on the fixture rows
// rather than on whole-table counts a sibling harness can move.
async function countFixtureRows(table, column, ids) {
  if (!ids.length) return 0;
  const { count, error } = await retryResult(`count fixture ${table}`, () =>
    admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, ids),
  );
  assert.equal(error, null, `count fixture ${table}`);
  return count ?? 0;
}
function vietnamDay(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return new Date(
    Date.UTC(
      Number(value('year')),
      Number(value('month')) - 1,
      Number(value('day')),
    ) +
      offsetDays * 86400000,
  )
    .toISOString()
    .slice(0, 10);
}

// ------------------------------------------------------------------ fixtures
const namespace = 'SGN35';
// Distinct Vietnam days in the recent past, so a later run's cleanup cannot overlap this one's
// period and the two together stay a stable, explicit range.
const [firstDay, secondDay] = [vietnamDay(-2), vietnamDay(-1)];
const quietDay = '2020-01-03';
const identities = [
  ['manager', 'manager', true],
  ['admin', 'admin', true],
  ['sales', 'sales', true],
  ['staff', 'staff', true],
  ['inactive', 'sales', false],
];
const manifestPath = path.join(workdir, 'fixtures.json');
async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}
async function writeManifest(manifest) {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
async function removeFixtures(manifest) {
  if (!manifest) return;
  const employeeIds = Object.values(manifest.identities ?? {}).map(
    (identity) => identity.employeeId,
  );
  const propertyIds = Object.values(manifest.properties ?? {});
  const contactIds = Object.values(manifest.contacts ?? {});
  const unitIds = Object.values(manifest.units ?? {});
  const historyClauses = [];
  if (propertyIds.length)
    historyClauses.push(`property_id in (${sqlIds(propertyIds)})`);
  if (employeeIds.length)
    historyClauses.push(`actor_id in (${sqlIds(employeeIds)})`);
  if (historyClauses.length)
    await operatorSqlWithRetry(
      'remove fixture history',
      `delete from public.property_history where ${historyClauses.join(' or ')}`,
    );
  if (propertyIds.length) {
    await operatorSqlWithRetry(
      'remove fixture links',
      `delete from public.property_contacts where property_id in (${sqlIds(propertyIds)})`,
    );
    const events = await retryResult('remove fixture activity', () =>
      admin.from('activity_events').delete().in('property_id', propertyIds),
    );
    assert.equal(events.error, null, 'remove fixture activity');
    await operatorSqlWithRetry(
      'remove fixture addresses',
      `delete from public.property_addresses where property_id in (${sqlIds(propertyIds)})`,
    );
    await operatorSqlWithRetry(
      'remove fixture properties',
      `delete from public.properties where id in (${sqlIds(propertyIds)})`,
    );
  }
  if (contactIds.length)
    await operatorSqlWithRetry(
      'remove fixture contacts',
      `delete from public.contacts where id in (${sqlIds(contactIds)})`,
    );
  if (unitIds.length) {
    const units = await retryResult('remove fixture units', () =>
      admin.from('admin_unit_versions').delete().in('id', unitIds),
    );
    assert.equal(units.error, null, 'remove fixture units');
  }
  if (employeeIds.length) {
    const removedEmployees = await operatorSqlWithRetry(
      'remove fixture employees',
      `delete from public.employees where id in (${sqlIds(employeeIds)}) returning id`,
    );
    assert.equal(
      removedEmployees.length,
      employeeIds.length,
      'remove fixture employees',
    );
  }
  const users = [
    ...Object.values(manifest.identities ?? {}).map(
      (identity) => identity.userId,
    ),
    ...(manifest.unlinked ? [manifest.unlinked.userId] : []),
  ];
  for (const userId of users) {
    const removed = await retryThrown('remove fixture auth user', () =>
      admin.auth.admin.deleteUser(userId),
    ).catch((error) => ({ error }));
    // An identity an earlier interrupted run already removed is not a failure.
    if (removed.error && !/not found/i.test(removed.error.message))
      assert.fail(`remove fixture auth user: ${removed.error.message}`);
  }
}
async function createIdentities() {
  const manifest = {
    namespace,
    identities: {},
    unlinked: null,
    units: {},
    properties: {},
    committedEvents: 0,
  };
  for (const [name, role, active] of identities) {
    const email = `${namespace.toLowerCase()}.${name}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const created = await retryResult(`create auth user ${name}`, () =>
      admin.auth.admin.createUser({ email, password, email_confirm: true }),
    );
    assert.equal(created.error, null, `create auth user ${name}`);
    const userId = created.data.user.id;
    const employeeId = randomUUID();
    const inserted = await operatorSqlWithRetry(
      `create employee ${name}`,
      `insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values (${sqlId(employeeId)},${sqlId(userId)},${sqlLiteral(email)},${sqlLiteral(`${namespace} ${name}`)},${sqlLiteral(role)},${active}) returning id`,
    );
    assert.equal(inserted.length, 1, `create employee ${name}`);
    manifest.identities[name] = {
      userId,
      employeeId,
      email,
      password,
      role,
      active,
    };
  }
  const email = `${namespace.toLowerCase()}.unlinked@example.test`;
  const password = randomBytes(24).toString('base64url');
  const created = await retryResult('create unlinked auth user', () =>
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  assert.equal(created.error, null, 'create unlinked auth user');
  manifest.unlinked = { userId: created.data.user.id, email, password };
  await writeManifest(manifest);
  return manifest;
}

// Two catalog versions of one official province code (the canonical-identity case), one second
// province, and the three commune versions their addresses are verified against.
const provinceCode = `${namespace}PA`;
const provinceAFirstName = `${namespace} Province A`;
const provinceARevisedName = `${namespace} Province A (revised)`;
const provinceBName = `${namespace} Province B`;
const legacyRawProvince = 'Thành phố Hồ Chí Minh';

async function createProvinceFixtures(manifest) {
  const manager = manifest.identities.manager.employeeId;
  const units = {
    provinceFirst: randomUUID(),
    provinceSecond: randomUUID(),
    provinceOther: randomUUID(),
    communeFirst: randomUUID(),
    communeSecond: randomUUID(),
    communeOther: randomUUID(),
  };
  manifest.units = units;
  const properties = {
    verifiedA: randomUUID(),
    verifiedA2: randomUUID(),
    verifiedB: randomUUID(),
    legacyOnly: randomUUID(),
    candidate: randomUUID(),
    archived: randomUUID(),
  };
  manifest.properties = properties;
  manifest.contacts = { sharedOwner: randomUUID() };
  await writeManifest(manifest);
  await insertRows('insert fixture units', 'admin_unit_versions', [
    {
      id: units.provinceFirst,
      official_code: provinceCode,
      name_vi: provinceAFirstName,
      unit_level: 'province',
      valid_from: firstDay,
      source_url: 'https://example.test/catalog',
    },
    {
      id: units.provinceSecond,
      official_code: provinceCode,
      name_vi: provinceARevisedName,
      unit_level: 'province',
      valid_from: secondDay,
      source_url: 'https://example.test/catalog',
    },
    {
      id: units.provinceOther,
      official_code: `${namespace}PB`,
      name_vi: provinceBName,
      unit_level: 'province',
      valid_from: firstDay,
      source_url: 'https://example.test/catalog',
    },
    {
      id: units.communeFirst,
      official_code: `${namespace}CA1`,
      name_vi: `${namespace} Commune A1`,
      unit_level: 'commune',
      parent_id: units.provinceFirst,
      valid_from: firstDay,
      source_url: 'https://example.test/catalog',
    },
    {
      id: units.communeSecond,
      official_code: `${namespace}CA2`,
      name_vi: `${namespace} Commune A2`,
      unit_level: 'commune',
      parent_id: units.provinceSecond,
      valid_from: firstDay,
      source_url: 'https://example.test/catalog',
    },
    {
      id: units.communeOther,
      official_code: `${namespace}CB1`,
      name_vi: `${namespace} Commune B1`,
      unit_level: 'commune',
      parent_id: units.provinceOther,
      valid_from: firstDay,
      source_url: 'https://example.test/catalog',
    },
  ]);
  const propertyValues = Object.entries(properties)
    .map(
      ([name, id]) =>
        `(${sqlId(id)},${sqlLiteral(`${namespace}-${name}`)},'sale','available',${sqlId(manager)})`,
    )
    .join(',');
  await operatorSqlWithRetry(
    'insert fixture properties',
    `insert into public.properties(id,property_code,listing_mode,status,created_by) values ${propertyValues}`,
  );
  // Current addresses start unresolved and are verified below through the authorized
  // maintenance RPC as the fixture manager; the unresolved candidate and the legacy-only
  // property keep the Unverified boundary.
  const currentAddresses = [
    {
      property: properties.verifiedA,
      text: `1 ${namespace} Street, ${namespace} Commune A1`,
      province: units.provinceFirst,
      commune: units.communeFirst,
    },
    {
      property: properties.verifiedA2,
      text: `2 ${namespace} Street, ${namespace} Commune A2`,
      province: units.provinceSecond,
      commune: units.communeSecond,
    },
    {
      property: properties.verifiedB,
      text: `3 ${namespace} Street, ${namespace} Commune B1`,
      province: units.provinceOther,
      commune: units.communeOther,
    },
    {
      property: properties.archived,
      text: `6 ${namespace} Street, ${namespace} Commune A1`,
      province: units.provinceFirst,
      commune: units.communeFirst,
    },
    {
      property: properties.candidate,
      text: `5 ${namespace} Street, ${namespace} Commune A2`,
      province: units.provinceSecond,
      commune: units.communeSecond,
      mapping: 'candidate',
    },
  ];
  const addressValues = currentAddresses
    .map(
      (row) =>
        `(${sqlId(row.property)},'current',${sqlLiteral(row.text)},${sqlId(
          row.province,
        )},${sqlId(row.commune)},${sqlLiteral(firstDay)},true,${sqlLiteral(
          row.mapping ?? 'unresolved',
        )})`,
    )
    .join(',');
  await operatorSqlWithRetry(
    'insert fixture current addresses',
    `insert into public.property_addresses(property_id,format,address_text,province_unit_id,commune_unit_id,effective_on,is_primary,mapping_status) values ${addressValues}`,
  );
  await operatorSqlWithRetry(
    'insert fixture legacy address',
    `insert into public.property_addresses(property_id,format,address_text,province_text,district_text,commune_text,is_primary) values (${sqlId(
      properties.legacyOnly,
    )},'legacy',${sqlLiteral(
      `12 ${namespace} Street, Phường 14, Quận 10, ${legacyRawProvince}`,
    )},${sqlLiteral(legacyRawProvince)},${sqlLiteral('Quận 10')},${sqlLiteral(
      'Phường 14',
    )},true)`,
  );
  // One recorded owner is shared by the two canonical-province properties, and both carry a
  // committed disclosure by the same employee on the second Vietnam day, so a regression that
  // collapsed two properties of one owner into one unit would change the asserted count.
  await operatorSqlWithRetry(
    'insert shared owner contact',
    `insert into public.contacts(id,display_name,contact_type) values (${sqlId(
      manifest.contacts.sharedOwner,
    )},${sqlLiteral(`${namespace} Shared Owner`)},'owner')`,
  );
  await operatorSqlWithRetry(
    'insert shared owner links',
    `insert into public.property_contacts(property_id,contact_id,relation,is_primary) values (${sqlId(
      properties.verifiedA,
    )},${sqlId(manifest.contacts.sharedOwner)},'owner',true),(${sqlId(
      properties.verifiedA2,
    )},${sqlId(manifest.contacts.sharedOwner)},'owner',true)`,
  );
  return manifest;
}

async function committedRows(manifest) {
  const sales = manifest.identities.sales.employeeId;
  const staff = manifest.identities.staff.employeeId;
  const { properties } = manifest;
  const at = (day) => `${day} 12:00:00+07`;
  const ownerContact = (employeeId, propertyId, day) => ({
    employee_id: employeeId,
    property_id: propertyId,
    kind: 'owner_contact_access',
    idempotency_key: randomUUID(),
    occurred_at: at(day),
  });
  const rows = [
    // Employee 0 discloses one property twice on the first day and employee 1 discloses it
    // once, so the same-property repeat collapses and the two employees stay separate.
    ownerContact(sales, properties.verifiedA, firstDay),
    ownerContact(sales, properties.verifiedA, firstDay),
    ownerContact(staff, properties.verifiedA, firstDay),
    ownerContact(sales, properties.verifiedB, firstDay),
    ownerContact(sales, properties.legacyOnly, firstDay),
    ownerContact(staff, properties.candidate, firstDay),
    // The second day: one repeated property counts again plus one second property of the same
    // province and the property that is archived during the run.
    ownerContact(sales, properties.verifiedA, secondDay),
    ownerContact(sales, properties.verifiedA2, secondDay),
    ownerContact(sales, properties.archived, secondDay),
    // A page view and a retained legacy visit row never enter the owner-contact metric.
    {
      employee_id: sales,
      property_id: properties.verifiedA,
      kind: 'page_view',
      idempotency_key: randomUUID(),
      occurred_at: at(firstDay),
    },
    {
      employee_id: sales,
      property_id: properties.verifiedA,
      kind: 'site_visit',
      visit_status: 'pending',
      idempotency_key: randomUUID(),
      occurred_at: at(firstDay),
    },
  ];
  const inserted = await insertRows(
    'insert committed activity',
    'activity_events',
    rows,
  );
  manifest.committedEvents = inserted.length;
  await writeManifest(manifest);
  return manifest;
}

// ------------------------------------------------------------------ clients
async function signIn(email, password) {
  const client = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await retryThrown('fixture authentication', () =>
    client.auth.signInWithPassword({ email, password }),
  );
  assert.equal(error, null, 'Real fixture authentication failed');
  assert.ok(data.session, 'Real fixture session missing');
  return client;
}
async function provinceReport(client, from, to) {
  return retryResult('province report', () =>
    client.rpc('company_province_owner_contact_activity', {
      p_from: from,
      p_to: to,
    }),
  );
}
async function companyReport(client, from, to) {
  return retryResult('company report', () =>
    client.rpc('company_employee_daily_activity', { p_from: from, p_to: to }),
  );
}
function rows(result, label) {
  assert.equal(result.error, null, `${label} failed`);
  return result.data ?? [];
}
const groupKey = (row) => row.province_unit_id ?? 'unverified';
function deltaOf(before, after) {
  const delta = new Map();
  for (const row of before)
    delta.set(groupKey(row), -Number(row.owner_contact_properties));
  for (const row of after)
    delta.set(
      groupKey(row),
      (delta.get(groupKey(row)) ?? 0) + Number(row.owner_contact_properties),
    );
  return Object.fromEntries(
    [...delta.entries()].filter(([, value]) => value !== 0),
  );
}
const total = (reportRows) =>
  reportRows.reduce(
    (sum, row) => sum + Number(row.owner_contact_properties),
    0,
  );
// The absolute count a report read carries for one group, keyed like `groupKey` above.
const countOf = (reportRows, key) => {
  const row = reportRows.find(
    (value) => (value.province_unit_id ?? 'unverified') === key,
  );
  assert.ok(row, `group ${key} missing from the report`);
  return Number(row.owner_contact_properties);
};
const numberFormat = (locale) => new Intl.NumberFormat(locale);
// The report panel prints a Vietnam date as dd/mm/yyyy.
const vietnamLabel = (iso) => {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
};
async function mappingFor(client, propertyId, changes) {
  const { data: address, error: addressError } = await retryResult(
    'read fixture address',
    () =>
      client
        .from('property_addresses')
        .select('id,revision')
        .eq('property_id', propertyId)
        .eq('format', 'current')
        .eq('is_primary', true)
        .maybeSingle(),
  );
  assert.equal(addressError, null, 'read fixture address');
  assert.ok(address, 'fixture primary current address missing');
  const { data: property, error: propertyError } = await retryResult(
    'read fixture property',
    () =>
      client
        .from('properties')
        .select('revision')
        .eq('id', propertyId)
        .maybeSingle(),
  );
  assert.equal(propertyError, null, 'read fixture property');
  const result = await retryResult('mapping write', () =>
    client.rpc('maintain_property', {
      p_property_id: propertyId,
      p_target: 'mapping',
      p_target_id: address.id,
      p_expected_revision: address.revision,
      p_changes: changes,
      p_property_revision: property.revision,
    }),
  );
  assert.equal(result.error, null, `mapping write: ${result.error?.message}`);
}

// ------------------------------------------------------------------ app server
let app = null;
async function startApp() {
  const log = openSync(path.join(workdir, 'app.log'), 'a');
  const child = spawn(
    process.execPath,
    [
      path.join(root, 'node_modules/next/dist/bin/next'),
      'start',
      '-p',
      String(appPort),
    ],
    {
      cwd: root,
      env: { ...process.env, ...devEnv, NEXT_PUBLIC_APP_URL: appUrl },
      stdio: ['ignore', log, log],
    },
  );
  app = child;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${appUrl}/api/health`, {
        redirect: 'manual',
      });
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  assert.fail('Local application did not become ready');
}
async function stopApp() {
  if (!app) return;
  app.kill('SIGTERM');
  await sleep(1500);
  if (app.exitCode === null) app.kill('SIGKILL');
  app = null;
}
// A local application request can lose its transport connection transiently (the development
// host also runs sibling acceptance harnesses), so the connection is retried and any eventual
// failure names the underlying cause instead of an opaque "fetch failed".
function appFetch(label, url, options) {
  return retryThrown(label, async () => {
    try {
      return await fetch(url, options);
    } catch (error) {
      throw new Error(
        `${label} failed: ${error?.message ?? error} (${error?.cause?.code ?? error?.cause?.message ?? 'no cause'})`,
      );
    }
  });
}
function appLoginRequest(email, password, locale = 'vi') {
  return appFetch('application login request', `${appUrl}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body: JSON.stringify({ email, password, locale }),
  });
}
async function appLogin(email, password, locale = 'vi') {
  const response = await appLoginRequest(email, password, locale);
  assert.equal(response.status, 200, `Application login ${response.status}`);
  const cookies = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookies, 'No application session cookie was issued');
  return cookies;
}
async function appGet(cookies, route) {
  const response = await appFetch('application read', appUrl + route, {
    redirect: 'manual',
    headers: cookies ? { cookie: cookies } : {},
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

// ------------------------------------------------------------------ browsers
const browsers = [];
const profileDirs = [];
const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
async function startBrowser(cdpPort) {
  const profile = path.join(workdir, `chrome-${cdpPort}-${runStamp}`);
  profileDirs.push(profile);
  const child = spawn(
    chromeBin,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { env: { ...process.env, TZ: 'Asia/Ho_Chi_Minh' }, stdio: 'ignore' },
  );
  browsers.push(child);
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) return child;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  assert.fail('Headless Chromium did not become ready');
}
async function stopBrowsers() {
  for (const child of browsers) child.kill('SIGTERM');
  await sleep(1000);
  for (const child of browsers)
    if (child.exitCode === null) child.kill('SIGKILL');
  browsers.length = 0;
  for (const profile of profileDirs)
    await fs.rm(profile, { recursive: true, force: true });
  profileDirs.length = 0;
}
function browser(session, cdpPort, args) {
  const result = spawnSync(process.execPath, [browserCli, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    env: {
      ...process.env,
      CHROME_DEVTOOLS_AXI_SESSION: session,
      CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
      CHROME_DEVTOOLS_AXI_BROWSER_URL: `http://127.0.0.1:${cdpPort}`,
      CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '',
      CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '180000',
    },
  });
  const diagnostic = (result.stderr ?? '')
    .split('\n')
    .filter((line) => /^(error|code):/.test(line.trim()))
    .join(' | ')
    .slice(0, 200);
  assert.equal(
    result.status,
    0,
    `Browser ${args[0]} failed${diagnostic ? ': ' + diagnostic : ''}`,
  );
  return result.stdout;
}
function evaluate(session, cdpPort, expression) {
  const output = browser(session, cdpPort, ['eval', expression]);
  const match = output.match(/^result: (.+)$/m);
  assert.ok(match, 'Browser evaluation returned no result');
  let value = JSON.parse(match[1]);
  while (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return value;
}
async function waitFor(session, cdpPort, expression, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (evaluate(session, cdpPort, expression)) return;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.fail('Timed out waiting for browser state');
}
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
async function browserSignIn(session, cdpPort, email, password) {
  browser(session, cdpPort, ['open', `${appUrl}/login`]);
  evaluate(session, cdpPort, setInput('#email', email));
  evaluate(session, cdpPort, setInput('#password', password));
  evaluate(
    session,
    cdpPort,
    `(() => { document.querySelector('form').requestSubmit(); return true; })()`,
  );
  await waitFor(session, cdpPort, `() => location.pathname === '/properties'`);
}
// The province table lives in the shipped design vocabulary; the payload is trimmed to the
// fixture rows so the browser bridge never truncates it.
const screenExpression = (groupNames) => `() => {
  const table = document.querySelector('main table.data-table');
  const form = document.querySelector('form[action="/activity/provinces"]');
  const names = ${JSON.stringify(groupNames)};
  const rows = table
    ? [...table.querySelectorAll('tbody tr')]
        .map((tr) => ({
          group: tr.querySelector('th')?.textContent?.trim() ?? '',
          cells: [...tr.querySelectorAll('td')].map((cell) => ({
            text: cell.textContent.trim(),
            level: cell.getAttribute('data-level'),
            background: getComputedStyle(cell).backgroundColor,
          })),
        }))
        .filter((row) => names.some((name) => row.group.includes(name)))
    : [];
  return {
    path: location.pathname,
    lang: document.documentElement.lang,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    hasTable: Boolean(table),
    headers: table
      ? [...table.querySelectorAll('thead th')].map((node) => node.textContent.trim())
      : [],
    labels: form
      ? [...form.querySelectorAll('label')].map((node) => node.textContent.trim())
      : [],
    controls: form
      ? [...form.querySelectorAll('input')].map((node) => ({ id: node.id, type: node.type }))
      : [],
    rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
    rows,
    foot: document.querySelector('.panel-foot')?.textContent?.trim() ?? null,
    empty:
      document.querySelector('[role=status].panel-note')?.textContent?.trim() ?? null,
    alerts: [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent.trim()),
    map: Boolean(
      document.querySelector('canvas') ||
        document.querySelector('.map, .leaflet-container, [data-map]') ||
        document.querySelector('svg[role=img]'),
    ),
    dateInputs: [...document.querySelectorAll('input[type=date]')].map((node) => node.id),
    dateValues: [...document.querySelectorAll('input[type=date]')].map((node) => node.value),
    bounds:
      document.querySelector('.panel-head .panel-note.num')?.textContent?.trim() ?? null,
    focused: document.activeElement?.id ?? null,
    overflowX: Math.max(
      0,
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  };
}`;
function screen(session, cdpPort, groupNames) {
  let value = evaluate(session, cdpPort, screenExpression(groupNames));
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth++)
    value = JSON.parse(value);
  assert.equal(typeof value, 'object', 'Unexpected browser screen payload');
  return value;
}
// The level labels the rendered band must print as text beside the exact count, so colour alone
// never carries the meaning.
const levelLabels = {
  vi: {
    none: 'Không phát sinh',
    low: 'Thấp',
    medium: 'Trung bình',
    high: 'Cao',
  },
  en: { none: 'None', low: 'Low', medium: 'Medium', high: 'High' },
};
function renderedRow(screenPayload, groupName) {
  const row = screenPayload.rows.find((value) =>
    value.group.includes(groupName),
  );
  assert.ok(
    row,
    `rendered row missing for ${groupName}: ${JSON.stringify(screenPayload.rows).slice(0, 400)}`,
  );
  return row;
}
function assertRenderedCount(row, apiRows, key, locale) {
  const expected = numberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB').format(
    countOf(apiRows, key),
  );
  const cell = row.cells[0];
  assert.ok(
    cell.text.startsWith(expected),
    `rendered count ${cell.text} does not start with ${expected}`,
  );
  assert.ok(
    ['none', 'low', 'medium', 'high'].includes(cell.level),
    `unknown level ${cell.level}`,
  );
  if (cell.level === 'none')
    assert.equal(
      cell.background,
      'rgba(0, 0, 0, 0)',
      'the empty band stays untinted',
    );
  else
    assert.notEqual(
      cell.background,
      'rgba(0, 0, 0, 0)',
      `the ${cell.level} cell must be colour-coded`,
    );
  assert.ok(
    cell.text.includes(levelLabels[locale][cell.level]),
    `the ${locale} level label must be printed as text, got ${cell.text}`,
  );
}
async function waitForReport(session, cdpPort, from, to) {
  let last = null;
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      last = evaluate(session, cdpPort, screenExpression([]));
      if (last.hasTable || last.alerts.length) return last;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.fail(
    `Province report did not load for ${from}..${to}: ${JSON.stringify(last)}`,
  );
}

// ------------------------------------------------------------------ run
let manifest = null;
let baseline = null;
// An interrupted earlier run left its own exact-ID fixtures behind; remove them through the same
// supported paths before the baseline, so the restoration check compares the real pre-acceptance
// rows and no property or catalog identity is reused.
const previous = await readManifest();
if (previous) {
  if (previous.namespace !== namespace)
    assert.fail('Fixture manifest belongs to a different namespace');
  await removeFixtures(previous);
  await fs.rm(manifestPath, { force: true });
}
try {
  // The pre-acceptance baseline is captured after any interrupted-run cleanup and before any
  // fixture write, so the restoration check compares exact rows rather than an assumed empty
  // project.
  baseline = {
    employees: await countRows('employees'),
    properties: await countRows('properties'),
    activity: await countRows('activity_events'),
    contacts: await countRows('contacts'),
    propertyContacts: await countRows('property_contacts'),
  };
  manifest = await createIdentities();
  await startApp();
  const fixtures = manifest.identities;
  const manager = await signIn(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  const adminUser = await signIn(fixtures.admin.email, fixtures.admin.password);
  const sales = await signIn(fixtures.sales.email, fixtures.sales.password);

  // Baseline report reads happen before the province fixtures exist; every count below is the
  // delta around the fixture write, because this report is company-wide.
  const provinceBefore = rows(
    await provinceReport(manager, firstDay, secondDay),
    'province baseline',
  );
  const provinceBeforeFirstDay = rows(
    await provinceReport(manager, firstDay, firstDay),
    'province first day baseline',
  );
  const provinceBeforeSecondDay = rows(
    await provinceReport(manager, secondDay, secondDay),
    'province second day baseline',
  );
  const companyBefore = rows(
    await companyReport(manager, firstDay, secondDay),
    'company baseline',
  );

  manifest = await createProvinceFixtures(manifest);
  manifest = await committedRows(manifest);
  const { units, properties } = manifest;
  const sharedLinks = await retryResult('read shared owner links', () =>
    manager
      .from('property_contacts')
      .select('property_id,contact_id,relation')
      .in('property_id', [properties.verifiedA, properties.verifiedA2]),
  );
  assert.equal(sharedLinks.error, null, 'read shared owner links');
  const sharedRows = sharedLinks.data ?? [];
  assert.deepEqual(
    sharedRows.map((row) => row.property_id).sort(),
    [properties.verifiedA, properties.verifiedA2].sort(),
    'both shared-owner properties must be linked',
  );
  assert.deepEqual(
    [...new Set(sharedRows.map((row) => row.contact_id))],
    [manifest.contacts.sharedOwner],
    'the two properties must share one recorded owner',
  );
  assert.ok(
    sharedRows.every((row) => row.relation === 'owner'),
    'the shared links must be owner relations',
  );

  const mapping = (province, commune, effectiveOn = firstDay) => ({
    province_unit_id: province,
    commune_unit_id: commune,
    mapping_status: 'verified',
    verification_method: 'manual',
    source_url: 'https://example.test/evidence',
    effective_on: effectiveOn,
    mapping_evidence:
      'Acceptance fixture: boundary and documents checked against official evidence',
  });
  await mappingFor(
    manager,
    properties.verifiedA,
    mapping(units.provinceFirst, units.communeFirst),
  );
  await mappingFor(
    manager,
    properties.verifiedA2,
    mapping(units.provinceSecond, units.communeSecond, secondDay),
  );
  await mappingFor(
    manager,
    properties.verifiedB,
    mapping(units.provinceOther, units.communeOther),
  );
  await mappingFor(
    manager,
    properties.archived,
    mapping(units.provinceFirst, units.communeFirst),
  );

  const provinceAfter = rows(
    await provinceReport(manager, firstDay, secondDay),
    'province report',
  );
  const companyAfter = rows(
    await companyReport(manager, firstDay, secondDay),
    'company report',
  );
  const canonical = {
    [units.provinceSecond]: 5,
    [units.provinceOther]: 1,
    unverified: 2,
  };
  const delta = deltaOf(provinceBefore, provinceAfter);
  assert.deepEqual(
    delta,
    canonical,
    `unexpected province delta ${JSON.stringify(delta)}`,
  );
  const companyDelta = total(companyAfter) - total(companyBefore);
  assert.equal(
    companyDelta,
    total(provinceAfter) - total(provinceBefore),
    'province plus Unverified must equal the company report sum',
  );
  assert.equal(companyDelta, 8);
  const provinceA = provinceAfter.find(
    (row) => row.province_unit_id === units.provinceSecond,
  );
  assert.ok(provinceA, 'canonical province group missing');
  assert.equal(provinceA.province_name, provinceARevisedName);
  assert.equal(
    provinceAfter.filter((row) => row.official_code === provinceCode).length,
    1,
    'one official province code must stay one group',
  );
  assert.ok(
    !provinceAfter.some((row) => row.province_name === legacyRawProvince),
    'raw legacy province text must never become a group',
  );
  const unverified = provinceAfter.find((row) => row.province_unit_id === null);
  assert.equal(
    Number(unverified.owner_contact_properties) -
      Number(
        provinceBefore.find((row) => row.province_unit_id === null)
          ?.owner_contact_properties ?? 0,
      ),
    2,
  );
  observed(
    'a manager reads canonical province groups and the Unverified group, and the totals reconcile with the company report',
    { delta },
  );

  // Counting units: the two employees on one property and day, the collapsed repeat, the second
  // Vietnam day and the control property of the same province. Each single-day comparison is
  // the delta around the fixture write against that day's own pre-fixture baseline.
  const firstDayRows = rows(
    await provinceReport(manager, firstDay, firstDay),
    'province first day',
  );
  const secondDayRows = rows(
    await provinceReport(manager, secondDay, secondDay),
    'province second day',
  );
  assert.deepEqual(deltaOf(provinceBeforeFirstDay, firstDayRows), {
    [units.provinceSecond]: 2,
    [units.provinceOther]: 1,
    unverified: 2,
  });
  assert.deepEqual(deltaOf(provinceBeforeSecondDay, secondDayRows), {
    [units.provinceSecond]: 3,
  });
  assert.deepEqual(
    firstDayRows,
    rows(await provinceReport(manager, firstDay, firstDay), 'day 1 re-read'),
    'repeated reads must be deterministic',
  );
  observed(
    'employee-property-day units, the collapsed repeat, the second Vietnam day and two properties sharing one recorded owner are exact',
    { sharedOwner: manifest.contacts.sharedOwner },
  );

  // An authorized correction regroups earlier units; an invalidation moves them to Unverified.
  // Neither changes the company total.
  const companyTotal = companyDelta;
  await mappingFor(
    manager,
    properties.verifiedA,
    mapping(units.provinceOther, units.communeOther),
  );
  const corrected = deltaOf(
    provinceBefore,
    rows(
      await provinceReport(manager, firstDay, secondDay),
      'corrected report',
    ),
  );
  assert.deepEqual(corrected, {
    [units.provinceSecond]: 2,
    [units.provinceOther]: 4,
    unverified: 2,
  });
  await mappingFor(manager, properties.verifiedA, {
    mapping_status: 'candidate',
  });
  const invalidated = deltaOf(
    provinceBefore,
    rows(
      await provinceReport(manager, firstDay, secondDay),
      'invalidated report',
    ),
  );
  assert.deepEqual(invalidated, {
    [units.provinceSecond]: 2,
    [units.provinceOther]: 1,
    unverified: 5,
  });
  await mappingFor(
    manager,
    properties.verifiedA,
    mapping(units.provinceFirst, units.communeFirst),
  );
  const restored = deltaOf(
    provinceBefore,
    rows(await provinceReport(manager, firstDay, secondDay), 'restored report'),
  );
  assert.deepEqual(restored, canonical);
  assert.equal(
    total(rows(await companyReport(manager, firstDay, secondDay), 'company')) -
      total(companyBefore),
    companyTotal,
    'regrouping must not change the company total',
  );
  observed(
    'a reviewed address correction and an invalidation move only the affected groups',
    { corrected, invalidated, restored },
  );

  // Archiving a parent property keeps its committed credit.
  await operatorSqlWithRetry(
    'archive fixture property',
    `update public.properties set archived_at=now() where id=${sqlId(properties.archived)}`,
  );
  const secondDayAfter = rows(
    await provinceReport(manager, secondDay, secondDay),
    'province second day after archive',
  );
  assert.equal(
    countOf(secondDayAfter, units.provinceSecond),
    countOf(secondDayRows, units.provinceSecond),
    'archiving must keep committed credit',
  );
  observed('archiving a property keeps its committed owner-contact credit');

  // Range validation and the honest zero period.
  const reversed = await provinceReport(manager, secondDay, firstDay);
  assert.equal(reversed.error?.code, '22023');
  const tooLong = await provinceReport(manager, '2020-01-01', '2026-10-01');
  assert.equal(tooLong.error?.code, '22023');
  const quiet = rows(
    await provinceReport(manager, quietDay, quietDay),
    'quiet report',
  );
  assert.equal(total(quiet), 0);
  assert.equal(quiet.length, 1);
  assert.equal(quiet[0].province_unit_id, null);
  observed(
    'invalid ranges are refused and an event-free period is an explicit Unverified zero',
  );

  // Unauthorized roles through the real API and the live role.
  const managerCookies = await appLogin(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  const adminCookies = await appLogin(
    fixtures.admin.email,
    fixtures.admin.password,
  );
  const salesCookies = await appLogin(
    fixtures.sales.email,
    fixtures.sales.password,
  );
  const staffCookies = await appLogin(
    fixtures.staff.email,
    fixtures.staff.password,
  );
  const route = `/api/activity/provinces?from=${firstDay}&to=${secondDay}`;
  const defaultApp = await appGet(managerCookies, '/api/activity/provinces');
  assert.equal(defaultApp.status, 200);
  assert.equal(defaultApp.body.from, vietnamDay(-29));
  assert.equal(defaultApp.body.to, vietnamDay(0));
  assert.equal(defaultApp.body.today, vietnamDay(0));
  observed(
    'the report endpoint defaults to today and the preceding 29 Vietnam days when no range is given',
  );
  assert.equal((await appGet(managerCookies, route)).status, 200);
  assert.equal((await appGet(adminCookies, route)).status, 200);
  assert.equal((await appGet(salesCookies, route)).status, 403);
  assert.equal((await appGet(staffCookies, route)).status, 403);
  assert.equal((await appGet('', route)).status, 401);
  const inactiveLogin = await appLoginRequest(
    fixtures.inactive.email,
    fixtures.inactive.password,
  );
  assert.equal(inactiveLogin.status, 403);
  assert.equal((await inactiveLogin.json()).error, 'access-denied');
  const directSales = await provinceReport(sales, firstDay, secondDay);
  assert.equal(directSales.error?.code, '42501');
  const directStaff = await provinceReport(
    await signIn(fixtures.staff.email, fixtures.staff.password),
    firstDay,
    secondDay,
  );
  assert.equal(directStaff.error?.code, '42501');
  const directInactive = await provinceReport(
    await signIn(fixtures.inactive.email, fixtures.inactive.password),
    firstDay,
    secondDay,
  );
  assert.equal(directInactive.error?.code, '42501');
  const directUnlinked = await provinceReport(
    await signIn(manifest.unlinked.email, manifest.unlinked.password),
    firstDay,
    secondDay,
  );
  assert.equal(directUnlinked.error?.code, '42501');
  const managerNow = rows(
    await provinceReport(manager, firstDay, secondDay),
    'manager re-read',
  );
  const adminNow = rows(
    await provinceReport(adminUser, firstDay, secondDay),
    'admin direct report',
  );
  for (const key of [units.provinceSecond, units.provinceOther, 'unverified'])
    assert.equal(
      countOf(adminNow, key),
      countOf(managerNow, key),
      `admin and manager must agree on ${key}`,
    );
  assert.equal(countOf(managerNow, units.provinceSecond), 5);
  observed(
    'manager and admin read the report while sales and staff are refused by the application route and the direct RPC, the inactive identity is refused at login and by the direct RPC, and the authenticated-unlinked identity is refused by the direct RPC',
  );

  // A role downgrade applies to an already-issued session on its next request.
  await updateEmployee(fixtures.manager.employeeId, { role: 'sales' });
  const downgraded = await provinceReport(manager, firstDay, secondDay);
  assert.equal(downgraded.error?.code, '42501');
  assert.equal((await appGet(managerCookies, route)).status, 403);
  await updateEmployee(fixtures.manager.employeeId, { role: 'manager' });
  assert.equal((await appGet(managerCookies, route)).status, 200);
  observed(
    'a role downgrade removes authority on the next request and restoring the role restores it, with no new sign-in',
  );
  await updateEmployee(fixtures.manager.employeeId, { is_active: false });
  const deactivated = await provinceReport(manager, firstDay, secondDay);
  assert.equal(deactivated.error?.code, '42501');
  assert.equal((await appGet(managerCookies, route)).status, 403);
  await updateEmployee(fixtures.manager.employeeId, { is_active: true });
  assert.equal((await appGet(managerCookies, route)).status, 200);
  observed(
    'deactivating the manager denies the existing session on the next direct and application request and reactivation restores it',
  );

  // Rendered journey: the manager's real Chrome session in Vietnamese/default and English.
  await startBrowser(9350);
  const groupNames = [
    provinceARevisedName,
    provinceBName,
    'Chưa xác minh vị trí',
    'Unverified location',
  ];
  await browserSignIn(
    'sgn35-manager',
    9350,
    fixtures.manager.email,
    fixtures.manager.password,
  );
  browser('sgn35-manager', 9350, ['open', `${appUrl}/activity/provinces`]);
  await waitForReport('sgn35-manager', 9350, vietnamDay(-29), vietnamDay(0));
  const defaultScreen = screen('sgn35-manager', 9350, groupNames);
  assert.deepEqual(defaultScreen.dateValues, [vietnamDay(-29), vietnamDay(0)]);
  assert.equal(
    defaultScreen.bounds,
    `${vietnamLabel(vietnamDay(-29))} – ${vietnamLabel(vietnamDay(0))}`,
  );
  observed(
    'the page opens on the default period of today and the preceding 29 Vietnam days without query parameters',
  );
  browser('sgn35-manager', 9350, [
    'open',
    `${appUrl}/activity/provinces?from=${firstDay}&to=${secondDay}`,
  ]);
  await waitForReport('sgn35-manager', 9350, firstDay, secondDay);
  const vi = screen('sgn35-manager', 9350, groupNames);
  assert.equal(vi.path, '/activity/provinces');
  assert.equal(vi.lang, 'vi');
  assert.equal(vi.heading, 'Hoạt động mở liên hệ chủ nhà theo tỉnh/thành phố');
  assert.ok(vi.hasTable, `no table: ${JSON.stringify(vi).slice(0, 300)}`);
  assert.deepEqual(vi.headers, [
    'Tỉnh/Thành phố (địa chỉ đã xác minh)',
    'Lượt mở liên hệ chủ nhà',
  ]);
  assert.deepEqual(vi.labels, ['Từ ngày', 'Đến ngày']);
  assert.deepEqual(vi.controls, [
    { id: 'province-report-from', type: 'date' },
    { id: 'province-report-to', type: 'date' },
  ]);
  const viA = renderedRow(vi, provinceARevisedName);
  assertRenderedCount(viA, managerNow, units.provinceSecond, 'vi');
  const viUnverified = renderedRow(vi, 'Chưa xác minh vị trí');
  assertRenderedCount(viUnverified, managerNow, 'unverified', 'vi');
  assert.equal(vi.map, false, 'no geographic map may be rendered');
  assert.ok(vi.foot.includes('Tổng cộng'), `foot ${vi.foot}`);
  assert.ok(
    vi.foot.includes(numberFormat('vi-VN').format(total(managerNow))),
    `foot ${vi.foot}`,
  );
  observed(
    'the manager reads the Vietnamese table with exact counts, the always-listed Unverified row, a text level label and no map',
  );

  // Keyboard and mobile behaviour on the same rendered surface.
  evaluate(
    'sgn35-manager',
    9350,
    `(() => { document.querySelector('#province-report-from').focus(); return true; })()`,
  );
  assert.equal(
    screen('sgn35-manager', 9350, groupNames).focused,
    'province-report-from',
  );
  browser('sgn35-manager', 9350, ['resize', '375', '900']);
  await sleep(500);
  const mobile = screen('sgn35-manager', 9350, groupNames);
  assert.equal(mobile.overflowX, 0, 'mobile viewport overflows horizontally');
  assert.equal(mobile.rows.length, vi.rows.length);
  browser('sgn35-manager', 9350, ['resize', '1440', '900']);
  await sleep(500);
  observed(
    'the filters and table are keyboard reachable and stay readable at 375px without horizontal overflow',
  );

  // Language switching preserves the selected range and the counts.
  evaluate(
    'sgn35-manager',
    9350,
    `(() => { document.querySelector('.lang-switch button[lang=en]').click(); return true; })()`,
  );
  await waitFor(
    'sgn35-manager',
    9350,
    `() => document.documentElement.lang === 'en'`,
  );
  const en = screen('sgn35-manager', 9350, groupNames);
  assert.equal(en.heading, 'Owner-contact activity by province/city');
  assert.deepEqual(en.headers, [
    'Province/city (verified address)',
    'Owner-contact accesses',
  ]);
  assert.deepEqual(en.labels, ['From date', 'To date']);
  const enA = renderedRow(en, provinceARevisedName);
  assertRenderedCount(enA, managerNow, units.provinceSecond, 'en');
  assert.deepEqual(en.dateInputs, [
    'province-report-from',
    'province-report-to',
  ]);
  assert.equal((await appGet(managerCookies, route)).status, 200);
  observed(
    'switching to English keeps the same range and counts and shows English labels',
  );

  // An invalid range and an ordinary employee are refused in the rendered journey too.
  browser('sgn35-manager', 9350, [
    'open',
    `${appUrl}/activity/provinces?from=${secondDay}&to=${firstDay}`,
  ]);
  await waitForReport('sgn35-manager', 9350, secondDay, firstDay);
  const invalid = screen('sgn35-manager', 9350, groupNames);
  assert.equal(invalid.hasTable, false);
  assert.ok(
    invalid.alerts.some((alert) => /366/.test(alert)),
    `invalid-range alert missing: ${JSON.stringify(invalid.alerts)}`,
  );
  observed(
    'an invalid range renders the localized range error instead of a table',
  );

  await startBrowser(9351);
  await browserSignIn(
    'sgn35-sales',
    9351,
    fixtures.sales.email,
    fixtures.sales.password,
  );
  browser('sgn35-sales', 9351, [
    'open',
    `${appUrl}/activity/provinces?from=${firstDay}&to=${secondDay}`,
  ]);
  await waitFor(
    'sgn35-sales',
    9351,
    `() => location.pathname === '/access-denied'`,
  );
  const denied = screen('sgn35-sales', 9351, groupNames);
  assert.equal(denied.hasTable, false);
  observed(
    'an ordinary employee navigating directly to the report is shown the localized access-denied page',
  );
} catch (error) {
  console.error('FAILED', error?.message ?? error);
  throw error;
} finally {
  if (!keep) {
    await stopBrowsers();
    await stopApp();
    manifest = (await readManifest()) ?? manifest;
    await removeFixtures(manifest);
    await fs.rm(manifestPath, { force: true });
    if (baseline && manifest) {
      // The development project is shared with sibling acceptance harnesses, so foreign rows can
      // appear or disappear around this run. What is asserted is the part this harness owns: no
      // fixture row survives removal under its exact identity. The global counts are reported,
      // not asserted, and their drift is recorded as foreign movement.
      const employeeIds = Object.values(manifest.identities ?? {}).map(
        (identity) => identity.employeeId,
      );
      const propertyIds = Object.values(manifest.properties ?? {});
      const contactIds = Object.values(manifest.contacts ?? {});
      const unitIds = Object.values(manifest.units ?? {});
      const leftovers = {
        employees: await countFixtureRows('employees', 'id', employeeIds),
        properties: await countFixtureRows('properties', 'id', propertyIds),
        activity: await countFixtureRows(
          'activity_events',
          'property_id',
          propertyIds,
        ),
        contacts: await countFixtureRows('contacts', 'id', contactIds),
        propertyContacts: await countFixtureRows(
          'property_contacts',
          'property_id',
          propertyIds,
        ),
        units: await countFixtureRows('admin_unit_versions', 'id', unitIds),
      };
      assert.deepEqual(
        leftovers,
        {
          employees: 0,
          properties: 0,
          activity: 0,
          contacts: 0,
          propertyContacts: 0,
          units: 0,
        },
        'Fixture rows survived removal',
      );
      const after = {
        employees: await countRows('employees'),
        properties: await countRows('properties'),
        activity: await countRows('activity_events'),
        contacts: await countRows('contacts'),
        propertyContacts: await countRows('property_contacts'),
      };
      observed(
        'every fixture row is removed and the global row counts are reported',
        {
          baseline,
          after,
          foreignDrift: Object.fromEntries(
            Object.keys(after).map((table) => [
              table,
              after[table] - baseline[table],
            ]),
          ),
        },
      );
    }
  }
}

const reportDocument = {
  checked_at: new Date().toISOString(),
  project_ref: projectRef,
  namespace,
  range: { from: firstDay, to: secondDay, quiet_day: quietDay },
  observations: observations.map(({ name, ...rest }) => ({ name, ...rest })),
  transient_retries: retryCount,
  created: {
    identities: identities.length,
    unlinked: 1,
    properties: 6,
    admin_unit_versions: 6,
    contacts: 1,
    property_contacts: 2,
    activity_events: manifest?.committedEvents ?? 0,
  },
  removed: {
    identities: identities.length,
    unlinked: 1,
    properties: 6,
    admin_unit_versions: 6,
    contacts: 1,
    property_contacts: 2,
    activity_events: manifest?.committedEvents ?? 0,
  },
  limitations: [
    retryCount
      ? `${retryCount} transient transport retries were needed for idempotent fixture/read steps; no assertion was retried.`
      : null,
    'Counts are asserted as deltas around the fixture write, because the report is company-wide and the development project is shared; concurrent foreign activity inside the two fixture days would surface as a mismatch rather than being silently absorbed.',
    'Fixture removal is asserted by exact identity against the rows this harness created; the global employee, property, activity, contact and link counts are reported before and after with any foreign drift, because sibling harnesses share the development project.',
    'The rendered journey covers the report table, the always-listed Unverified row, both languages, an invalid range, the mobile viewport and the denied redirect; the in-flight loading state, transport-failure retry and the company report page remain outside this harness.',
  ].filter(Boolean),
};
await fs.writeFile(reportPath, JSON.stringify(reportDocument, null, 2) + '\n');
console.log(`${observations.length} observations passed`);
