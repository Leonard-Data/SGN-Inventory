/**
 * Importer for the legacy AppSheet inventory now served from Google Sheets. Dry by default.
 *
 *   npm run import:legacy                      # dry run: reads only, writes nothing anywhere
 *   npm run import:legacy -- --out <dir>       # choose the report directory
 *
 * Reads the approved spreadsheet and its Drive attachment folder with a service account
 * holding `spreadsheets.readonly` and `drive.readonly` only. Nothing in this script writes
 * to the sheet, to Drive or to the database unless `--write` is passed together with a
 * captain-confirmed mapping whose digest matches the snapshot just read.
 *
 * The property-side import (master tab, owners, legacy and converted addresses) works
 * standalone. The child tabs join on an **exact** master `PropertyID` only: `Historical` and
 * `Attachments` rows that match are imported, every row that does not match is dropped and
 * counted, and `Contracts` (all BDS ids) and `clicks` (excluded by the captain) are not used.
 *
 * Personal data (names, phones, addresses) stays in the report under an ignored directory.
 * Never commit the report, the key or any staging output.
 */
import { createHash, createSign, randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertWriteTarget,
  beginInvitations,
  connect,
  currentAddressText,
  convertedSkipped,
  importAttachments,
  importProperties,
  importableBucket,
  openBatch,
  planAttachmentImport,
  planStaffAccounts,
  provisionSilentAdmin,
  recordedInvitations,
  sendInvitations,
  staffRoleFor,
  verifyImport,
} from './legacy-import-write.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '..', 'supabase', 'migrations');

export const DEFAULT_SPREADSHEET_ID =
  '1xo7w7-o9mrSQ97HZNUaeMoEN9048bDeiNS5MQvSZEis';
export const DEFAULT_DRIVE_FOLDER_ID = '1_cfuMDtB0eaVXSUCk0lee61ipJO2egSb';
export const DEFAULT_KEY_PATH =
  '/home/sam/agent-orchestrator/config/google-service-account.json';
export const READ_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
];
const OPEN_API = 'https://provinces.open-api.vn';
const MONEY_LIMIT = 999999999999999999n;

/** Tabs are matched accent-insensitively: the brief and the workbook spell them differently. */
export const TAB_ALIASES = {
  master: ['thong tin du an'],
  listing: ['loai hinh'],
  projectType: ['loai du an'],
  employee: ['nhan vien'],
  status: ['trang thai du an'],
  district: ['quan'],
  ward: ['phuong'],
  city: ['cities'],
  contracts: ['contracts'],
  historical: ['historical'],
  attachments: ['attachments'],
  clicks: ['clicks'],
  login: ['login'],
};

const SECOND_TIER =
  'https://github.com/thanglequoc/vietnamese-provinces-database/blob/v5.2.0/postgresql/postgres_ImportData_vn_units.sql';

// The captain's own account: the one admin, created silently, and the actor every invitation is
// recorded against. Nobody else is offered the admin role by the import.
export const SILENT_ADMIN_EMAIL = 'manager.sgnewhouse@gmail.com';
export const MANAGER_ACCOUNT_FILE =
  '/home/sam/agent-orchestrator/config/sgn-manager-account.env';

// ---------------------------------------------------------------- text and numbers

// Bounded retry for a read whose only failure mode is the link itself: three attempts, then the
// last error, so a definite refusal is reported instead of looped on.
async function retryNetwork(operation, attempts = 3) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      last = error;
      if (attempt + 1 < attempts)
        await new Promise((resolve) =>
          setTimeout(resolve, 5000 * (attempt + 1)),
        );
    }
  }
  throw last;
}

export function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

export function foldText(value) {
  return text(value)
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd');
}

/**
 * Comparison key for a Vietnamese administrative name: accent-free, without the
 * administrative type prefix and with leading zeros removed from ward numbers, so
 * `Phường 01`, `phường 1` and `Phuong 1` compare equal while `Quận 1` and `Quận 10`
 * stay distinct. Numeric names are the reason a ward may never be matched on its own.
 */
export function adminNameKey(value) {
  return foldText(value)
    .replace(
      /^(thanh pho|tinh|quan|huyen|thi xa|phuong|xa|thi tran|dac khu)\s+/,
      '',
    )
    .replace(/^0+(\d)/, '$1')
    .trim();
}

/** A plain decimal with either a dot or a comma, never a mixed or thousands separator. */
export function parseDecimal(value) {
  const raw = text(value).replace(/\s+/g, '');
  if (!raw) return { value: null };
  if (!/^[+-]?\d+(?:[.,]\d+)?$/.test(raw)) return { error: 'ambiguous_number' };
  return { value: raw.replace(',', '.') };
}

/** Whole VND from a decimal source figure scaled by `multiplier`, in integer arithmetic. */
export function parseMoneyVnd(value, multiplier) {
  const decimal = parseDecimal(value);
  if (decimal.error) return { error: decimal.error };
  if (decimal.value === null) return { value: null };
  if (decimal.value.startsWith('-')) return { error: 'negative_money' };
  const [whole, fraction = ''] = decimal.value.replace(/^\+/, '').split('.');
  const scale = 10n ** BigInt(fraction.length);
  const scaled =
    (BigInt(whole) * scale + BigInt(fraction || '0')) * BigInt(multiplier);
  if (scaled % scale !== 0n) return { error: 'fractional_vnd' };
  const vnd = scaled / scale;
  if (vnd > MONEY_LIMIT) return { error: 'money_overflow' };
  return { value: vnd.toString() };
}

/** A positive measurement kept as the decimal string the database column expects. */
export function parseMeasure(value, maxDecimals = 2, maxValue = null) {
  const decimal = parseDecimal(value);
  if (decimal.error) return { error: decimal.error };
  if (decimal.value === null) return { value: null };
  if (decimal.value.startsWith('-')) return { error: 'negative_measure' };
  const [, fraction = ''] = decimal.value.replace(/^\+/, '').split('.');
  if (fraction.length > maxDecimals) return { error: 'too_precise' };
  if (Number(decimal.value) === 0) return { error: 'non_positive' };
  // The column decides what fits: a value the schema cannot store is a read error, not a crash.
  if (maxValue !== null && Number(decimal.value) > maxValue)
    return { error: 'measure_overflow' };
  return { value: decimal.value.replace(/^\+/, '') };
}

/** The reported area is only trusted when it carries an explicit square-metre unit. */
export function parseArea(value, maxValue = null) {
  const raw = text(value);
  if (!raw) return { value: null, raw };
  const match = raw.match(/^(\d+(?:[.,]\d+)?)\s*m[²2]/i);
  if (!match) return { error: 'area_without_unit', raw };
  const measure = parseMeasure(match[1], 2, maxValue);
  if (measure.error) return { error: measure.error, raw };
  return { value: measure.value, raw };
}

/** Split multiple owner phone values, normalising only known mobile shapes. */
export function parsePhones(value) {
  const raw = text(value);
  const phones = [];
  let needsReview = 0;
  for (const part of raw.split(/\s*[-/;,\n]\s*/)) {
    if (!part) continue;
    const compact = part.replace(/[\s().]/g, '');
    if (/^0\d{9}$/.test(compact)) {
      const normalised = `+84${compact.slice(1)}`;
      if (!phones.includes(normalised)) phones.push(normalised);
    } else if (/^84\d{9}$/.test(compact)) {
      const normalised = `+${compact}`;
      if (!phones.includes(normalised)) phones.push(normalised);
    } else if (/^\+84\d{9}$/.test(compact)) {
      if (!phones.includes(compact)) phones.push(compact);
    } else {
      needsReview += 1;
    }
  }
  return { phones, raw, needsReview };
}

/** Source dates are dd/mm/yyyy, with m/d/yy accepted only when the day field proves it. */
export function parseSourceDate(value) {
  const raw = text(value);
  if (!raw) return { value: null };
  const datePart = raw.split(/[ T]/)[0];
  const parts = datePart.split(/[/-]/).map((part) => part.trim());
  if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part)))
    return { error: 'invalid_date' };
  let [first, second, year] = parts.map(Number);
  if (year < 100) year += year > 50 ? 1900 : 2000;
  let day = first;
  let month = second;
  if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else if (second > 12 && first <= 12) {
    day = second;
    month = first;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return { error: 'invalid_date' };
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { value: iso };
}

export const DIRECTIONS = {
  bac: 'N',
  'dong bac': 'NE',
  dong: 'E',
  'dong nam': 'SE',
  nam: 'S',
  'tay nam': 'SW',
  tay: 'W',
  'tay bac': 'NW',
};

/** Labels come from the workbook's own reference tabs; only their meaning is code. */
export function listingModeFromLabel(label) {
  const folded = foldText(label);
  if (!folded) return { error: 'missing' };
  if (folded.includes('thue')) return { value: 'rent' };
  if (folded.includes('ban')) return { value: 'sale' };
  return { error: 'unmapped_label' };
}

export function statusFromLabel(label) {
  const folded = foldText(label);
  if (folded === 'tao moi') return 'draft';
  if (folded === 'dang ban') return 'available';
  if (folded === 'dang thuong luong' || folded === 'dang giao dich')
    return 'negotiating';
  if (folded === 'da ban') return 'sold';
  if (folded === 'ngung ban') return 'withdrawn';
  return null;
}

/**
 * Project-type labels describe the approach as often as the building, so one label can
 * feed both `access_type` and `property_type`. Labels prove neither on their own.
 */
export function classifyProjectType(label) {
  const folded = foldText(label);
  const result = { access_type: null, property_type: null, known: true };
  if (folded === 'mat tien') result.access_type = 'street_front';
  else if (folded === 'hem o to') result.access_type = 'car_alley';
  else if (folded === 'hem xe may') result.access_type = 'motorbike_alley';
  else if (folded === 'ba gac') result.access_type = 'three_wheeler_alley';
  else if (folded === 'chung cu') result.property_type = 'apartment';
  else if (folded.startsWith('vila') || folded.startsWith('biet thu'))
    result.property_type = 'villa';
  else if (folded === 'dat o') result.property_type = 'land';
  else if (folded === 'nha' || folded === 'nha nat')
    result.property_type = 'house';
  else if (folded === 'can ho dich vu')
    result.property_type = 'serviced_apartment';
  else result.known = false;
  return result;
}

// ---------------------------------------------------------------- reference tabs

export function buildReference({
  listing = [],
  projectType = [],
  status = [],
  district = [],
  ward = [],
  city = [],
}) {
  const labelRows = (rows) =>
    rows.slice(1).filter((row) => text(row?.[1]) || text(row?.[0]));
  const single = (rows) =>
    rows
      .slice(1)
      .map((row) => text(row?.[0]))
      .filter(Boolean);
  const listingModes = new Map();
  for (const row of labelRows(listing))
    listingModes.set(text(row[0]), text(row[1]));
  const projectLabels = new Set();
  for (const row of labelRows(projectType))
    if (text(row[1])) projectLabels.add(text(row[1]));
  const wardPairs = new Map();
  for (const row of ward.slice(1)) {
    const name = text(row?.[1]);
    const parent = text(row?.[2]);
    if (name && parent)
      wardPairs.set(`${adminNameKey(parent)}|${adminNameKey(name)}`, {
        district: parent,
        ward: name,
      });
  }
  return {
    listingModes,
    projectLabels,
    statusLabels: single(status),
    districts: new Set(single(district).map(adminNameKey)),
    cities: new Set(single(city).map(adminNameKey)),
    wardPairs,
  };
}

// ---------------------------------------------------------------- local catalogue

/** Unescape PostgreSQL text literals inside a values row. */
function sqlString(raw) {
  return raw.replace(/''/g, "'");
}

/**
 * Read `admin_unit_versions` content from the seeded migrations. The catalogue is the
 * project's own physical reference data, so the dry run needs no database connection;
 * no district level is seeded because the two-tier catalogue carries none.
 */
export function readAdminUnitCatalogue(migrationsDir = MIGRATIONS_DIR) {
  const provinces = new Map();
  const communes = new Map();
  for (const file of readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    for (const match of sql.matchAll(
      /\(\s*'([^']*)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'(province|district|commune)'\s*,\s*(?:null|'[^']*')\s*,\s*date\s*'([^']+)'/g,
    )) {
      const [, code, name, level, validFrom] = match;
      if (level !== 'province') continue;
      const existing = provinces.get(code);
      const version = { code, name: sqlString(name), validFrom };
      if (!existing || version.validFrom > existing.validFrom)
        provinces.set(code, version);
    }
    for (const match of sql.matchAll(
      /\(\s*'(\d{4,5})'\s*,\s*'((?:[^']|'')*)'\s*,\s*'(\d{1,2})'\s*\)/g,
    )) {
      const [, code, name, province] = match;
      const key = `${code}|${province}`;
      if (!communes.has(key))
        communes.set(key, { code, name: sqlString(name), province });
    }
  }
  const byProvince = new Map();
  const byName = new Map();
  for (const commune of communes.values()) {
    if (!provinces.has(commune.province)) continue;
    if (!byProvince.has(commune.province)) byProvince.set(commune.province, []);
    byProvince.get(commune.province).push(commune);
    const key = adminNameKey(commune.name);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(commune);
  }
  return {
    provinces,
    communes,
    byProvince,
    byName,
    source: `supabase/migrations (${SECOND_TIER})`,
  };
}

// ---------------------------------------------------------------- VietMap address migration

/**
 * VietMap's documented address migration resolves an old address to the current ward and
 * province. It is the primary resolver: it answers per address, which is the only way a
 * ward split among several current communes can be resolved without guessing. The access
 * token is read from a private file and is never printed, logged or reported.
 */
export const VIETMAP_ENDPOINT =
  'https://maps.vietmap.vn/api/migrate-address/v3';
export const VIETMAP_TOKEN_FILE =
  process.env.VIETMAP_TOKEN_FILE ??
  '/home/sam/agent-orchestrator/config/sgn-inventory-vietmap.env';

export function readVietMapToken(path = VIETMAP_TOKEN_FILE) {
  const token = (readFileSync(path, 'utf8').match(/^ACCESS_TOKEN=(.*)$/m) ??
    [])[1];
  if (!token || !token.trim()) throw new Error(`no ACCESS_TOKEN in ${path}`);
  return token.trim();
}

/** Map VietMap's current boundaries onto the project's own catalogue unit. */
export function vietMapBoundaryTarget(boundaries, catalogue) {
  const list = Array.isArray(boundaries) ? boundaries : [];
  const provinceBoundary = list.find((entry) => entry.type === 0);
  const communeBoundary = list.find((entry) => entry.type === 2);
  if (!provinceBoundary || !communeBoundary)
    return { status: 'empty_boundaries' };
  const provinceName =
    provinceBoundary.full_name ??
    `${provinceBoundary.prefix ?? ''} ${provinceBoundary.name ?? ''}`.trim();
  const communeName =
    communeBoundary.full_name ??
    `${communeBoundary.prefix ?? ''} ${communeBoundary.name ?? ''}`.trim();
  const province = [...catalogue.provinces.values()].find(
    (entry) => adminNameKey(entry.name) === adminNameKey(provinceName),
  );
  if (!province) return { status: 'catalogue_missing_province', provinceName };
  const matches = (catalogue.byProvince.get(province.code) ?? []).filter(
    (entry) => adminNameKey(entry.name) === adminNameKey(communeName),
  );
  if (matches.length === 0)
    return { status: 'catalogue_missing_commune', provinceName, communeName };
  if (matches.length > 1)
    return { status: 'ambiguous_current_name', communeName };
  return { status: 'resolved', target: describeTarget(catalogue, matches[0]) };
}

/** Sequential, cached, bounded-retry client. A failure is recorded, never looped on. */
export function createVietMapResolver({
  token,
  cachePath,
  catalogue,
  fetchImpl = fetch,
  pauseMs = 40,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
}) {
  const entries = new Map();
  if (cachePath && existsSync(cachePath)) {
    try {
      for (const [query, entry] of Object.entries(
        JSON.parse(readFileSync(cachePath, 'utf8')).entries ?? {},
      )) {
        // A failure is never cached: a transient outage must not poison a later run.
        if (!entry?.error) entries.set(query, entry);
      }
    } catch {
      // A corrupt cache is discarded rather than trusted.
    }
  }
  const stats = {
    unique_queries: 0,
    api_calls: 0,
    cache_hits: 0,
    empty_boundaries: 0,
    failed: 0,
    migrate_type_2_calls: 0,
  };
  let consecutiveFailures = 0;
  const flush = () => {
    if (!cachePath) return;
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(
      cachePath,
      `${JSON.stringify({ version: 1, entries: Object.fromEntries(entries) })}\n`,
    );
  };

  async function request(query, migrateType) {
    const url = `${VIETMAP_ENDPOINT}?apikey=${encodeURIComponent(token)}&text=${encodeURIComponent(query)}&migrate_type=${migrateType}`;
    for (let attempt = 0; attempt <= 2; attempt += 1) {
      stats.api_calls += 1;
      if (migrateType === 2) stats.migrate_type_2_calls += 1;
      let response;
      try {
        response = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
      } catch {
        // Never surface the URL: it carries the access token.
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (
        response.status === 429 ||
        response.status === 500 ||
        response.status === 504
      ) {
        await sleep(1000 * (attempt + 1));
        continue;
      }
      if (!response.ok) return { error: `http_${response.status}` };
      const body = await response.json().catch(() => null);
      if (!body) return { error: 'unreadable_response' };
      return { body };
    }
    return { error: 'retries_exhausted' };
  }

  async function lookup(query) {
    if (!query) return { status: 'no_query' };
    if (entries.has(query)) {
      stats.cache_hits += 1;
      return entries.get(query);
    }
    stats.unique_queries += 1;
    await sleep(pauseMs);
    let answer = await request(query, 1);
    let boundaries = answer.body?.boundaries;
    if (
      !answer.error &&
      (!Array.isArray(boundaries) || boundaries.length === 0)
    ) {
      answer = await request(query, 2);
      boundaries = answer.body?.boundaries;
    }
    let entry;
    if (answer.error) {
      entry = { error: answer.error };
      stats.failed += 1;
      consecutiveFailures += 1;
      if (consecutiveFailures >= 20)
        throw new Error(
          `VietMap failed ${consecutiveFailures} times in a row (last: ${answer.error}); stopping instead of hammering it`,
        );
    } else {
      consecutiveFailures = 0;
      const target = vietMapBoundaryTarget(boundaries, catalogue);
      if (target.status === 'resolved') {
        entry = {
          province_code: target.target.provinceCode,
          commune_code: target.target.code,
        };
      } else if (target.status === 'empty_boundaries') {
        entry = { empty: true };
        stats.empty_boundaries += 1;
      } else {
        entry = { empty: true, unmatched: target.status };
        stats.empty_boundaries += 1;
      }
    }
    if (!entry.error) {
      entries.set(query, entry);
      if (entries.size % 250 === 0) flush();
    }
    return entry;
  }

  return { lookup, stats: () => ({ ...stats }), flush };
}

// ---------------------------------------------------------------- address conversion

/**
 * Resolve one legacy city/district/ward triple to current province and commune units.
 *
 * Matching is always on city **and** district **and** ward: the workbook's own ward list
 * is keyed by district, the official three-tier tree is searched by district and ward
 * together, and the conversion is requested by the legacy ward's official code. A ward
 * name alone never selects a unit. Anything split, unlisted or absent from the project
 * catalogue is refused rather than guessed.
 */
export async function resolveAddress(source, context) {
  const { catalogue, reference, legacyTree, convertLegacyWard } = context;
  const city = text(source.city);
  const district = text(source.district);
  const ward = text(source.ward);
  if (!city) return { status: 'missing_city' };
  if (!district) return { status: 'missing_district' };
  if (!ward) return { status: 'missing_ward' };

  const cityKey = adminNameKey(city);
  const tree = legacyTree(cityKey);
  if (!tree) return { status: 'unknown_city', city };
  const pairKey = `${adminNameKey(district)}|${adminNameKey(ward)}`;
  if (!reference.wardPairs.has(pairKey)) {
    const current = currentCommuneByName(catalogue, cityKey, ward);
    if (current.length === 1) {
      return {
        status: 'current_name',
        target: [describeTarget(catalogue, current[0])],
        evidence: `${OPEN_API}/api/v2/`,
        note: 'ward label already matches one current commune; the legacy district label is not part of the current hierarchy',
      };
    }
    if (current.length > 1)
      return {
        status: 'ambiguous_current_name',
        candidates: current.map((unit) => unit.code),
      };
    return { status: 'unlisted_legacy_pair', district, ward };
  }

  const legacyDistrict = tree.districts.find(
    (entry) => adminNameKey(entry.name) === adminNameKey(district),
  );
  if (!legacyDistrict) return { status: 'unknown_district', district };
  const legacyWards = legacyDistrict.wards.filter(
    (entry) => adminNameKey(entry.name) === adminNameKey(ward),
  );
  if (legacyWards.length === 0)
    return { status: 'unknown_ward', district, ward };
  if (legacyWards.length > 1) {
    return {
      status: 'ambiguous_legacy_ward',
      district,
      ward,
      candidates: legacyWards.map((entry) => entry.code),
    };
  }

  const converted = await convertLegacyWard(legacyWards[0].code);
  const unique = [
    ...new Map(converted.map((entry) => [entry.code, entry])).values(),
  ];
  if (unique.length === 0) {
    return {
      status: 'no_current_ward',
      legacyCode: legacyWards[0].code,
      district,
      ward,
    };
  }
  const targets = unique.map((entry) => {
    const commune = catalogue.communes.get(`${entry.code}|${entry.province}`);
    return commune
      ? describeTarget(catalogue, commune)
      : {
          code: entry.code,
          name: entry.name,
          provinceCode: entry.province,
          provinceName: null,
          missingFromCatalogue: true,
        };
  });
  if (targets.some((target) => target.missingFromCatalogue)) {
    return {
      status: 'catalogue_missing',
      candidates: targets.map((target) => target.code),
    };
  }
  if (targets.length > 1)
    return {
      status: 'split',
      candidates: targets.map((target) => target.code),
    };
  return {
    status: 'resolved',
    target: targets,
    evidence: `${OPEN_API}/api/v2/w/from-legacy/?legacy_code=${legacyWards[0].code}`,
    crosswalkNote:
      'admin_unit_crosswalks carries no reviewed rows for this unit, so the published official mapping supplied the target and the project catalogue supplied its unit identity',
  };
}

function currentCommuneByName(catalogue, provinceKey, ward) {
  const nameKey = adminNameKey(ward);
  return [...catalogue.communes.values()].filter((commune) => {
    const province = catalogue.provinces.get(commune.province);
    return (
      province &&
      adminNameKey(province.name) === provinceKey &&
      adminNameKey(commune.name) === nameKey
    );
  });
}

function describeTarget(catalogue, commune) {
  const province = catalogue.provinces.get(commune.province);
  return {
    code: commune.code,
    name: commune.name,
    provinceCode: commune.province,
    provinceName: province ? province.name : null,
  };
}

/**
 * VietMap is the primary resolver and the official legacy mapping the fallback. When both
 * resolve and they disagree, the disagreement is reported and the row needs review; it is
 * never settled silently in either direction.
 */
export function combineResolution(vietmapEntry, legacy, catalogue) {
  let vietmapTarget = null;
  let vietmapStatus = 'not_queried';
  if (vietmapEntry?.commune_code) {
    const commune = catalogue.communes.get(
      `${vietmapEntry.commune_code}|${vietmapEntry.province_code}`,
    );
    if (commune) {
      vietmapTarget = describeTarget(catalogue, commune);
      vietmapStatus = 'resolved';
    } else vietmapStatus = 'catalogue_missing';
  } else if (vietmapEntry?.error) vietmapStatus = `error:${vietmapEntry.error}`;
  else if (vietmapEntry?.empty)
    vietmapStatus = vietmapEntry.unmatched ?? 'empty_boundaries';

  const legacyTarget = legacy.target?.[0] ?? null;
  const disagreement =
    vietmapTarget &&
    legacyTarget &&
    (vietmapTarget.code !== legacyTarget.code ||
      vietmapTarget.provinceCode !== legacyTarget.provinceCode)
      ? {
          vietmap: `${vietmapTarget.code} ${vietmapTarget.name}`,
          official_mapping: `${legacyTarget.code} ${legacyTarget.name} (${legacy.status})`,
        }
      : null;
  const detail = {
    vietmap_status: vietmapStatus,
    legacy_status: legacy.status,
    disagreement,
    candidates: legacy.candidates ?? [],
  };
  if (vietmapTarget) {
    return {
      status: 'resolved',
      source: 'vietmap',
      target: [vietmapTarget],
      evidence: 'VietMap address migration, migrate_type 1',
      ...detail,
    };
  }
  if (legacyTarget) {
    return {
      status: legacy.status,
      source:
        legacy.status === 'current_name'
          ? 'current_name'
          : 'official_legacy_mapping',
      target: legacy.target,
      evidence: legacy.evidence,
      ...detail,
    };
  }
  return {
    status: legacy.status === 'resolved' ? 'unresolved' : legacy.status,
    source: null,
    target: null,
    evidence: null,
    ...detail,
  };
}

// ---------------------------------------------------------------- master row mapping

/**
 * Every master column is listed with its destination. A column with `destination: null`
 * is deliberately not imported and is still reported by name, so nothing disappears
 * silently. `blocked` names a real destination that needs a prerequisite this run lacks.
 */
export const MASTER_COLUMNS = {
  PropertyID: { destination: 'private.property_source_map.source_key' },
  'Tên người tạo': {
    destination: null,
    why: 'display-name provenance only; it never identifies a sign-in account',
  },
  'Email Người Tạo': {
    destination: 'properties.created_by',
    blocked: 'resolved only by a completed write run, against public.employees',
  },
  'Ngày Tạo': { destination: 'properties.entry_on with entry_source=legacy' },
  'Tên chủ sở hũu': { destination: 'contacts.display_name' },
  'Số điện thoai': {
    destination: 'contacts.phones and contacts.raw_phone_text',
  },
  'Địa chỉ dự án': {
    destination: 'property_addresses.address_text (format=legacy)',
  },
  'Chiều ngang': { destination: 'properties.frontage_m' },
  'Chiều dài': { destination: 'properties.depth_m' },
  'Tổng diện tích': {
    destination: 'properties.land_area_m2 and properties.area_raw',
  },
  'Loại Hình': {
    destination:
      'properties.listing_mode (through the Loại Hình reference tab)',
  },
  'Loại Dự án': {
    destination:
      'properties.access_type and properties.property_type (through the Loại dự án tab)',
  },
  'Tạo mới': {
    destination: 'properties.status (through the Trạng thái dự án tab)',
  },
  'Hướng nhà': { destination: 'properties.direction' },
  'Ghi Chú Thêm': { destination: 'properties.notes' },
  'Giá Bán (tỷ Đồng)': { destination: 'properties.sale_price_vnd' },
  'Giá Thuê (triệu Đồng)': { destination: 'properties.monthly_rent_vnd' },
  'Thành phố': {
    destination: 'property_addresses.province_text (legacy label)',
  },
  Quận: { destination: 'property_addresses.district_text (legacy label)' },
  Phường: { destination: 'property_addresses.commune_text (legacy label)' },
  'Tên Đường': { destination: 'property_addresses.street' },
  'Địa Chỉ': { destination: 'property_addresses.house_number' },
  'Ngày Chỉnh Sửa gần nhất': {
    destination: null,
    why: 'source edit time; the application records its own update time and history',
  },
  Note: {
    destination: null,
    why: 'second free-text column with unclear semantics; it must not replace Ghi Chú Thêm silently',
  },
  'Temp Value': {
    destination: null,
    why: 'unclear semantics; never treated as a price',
  },
  'Người chỉnh sửa': {
    destination: 'properties.updated_by',
    blocked: 'resolved only by a completed write run, against public.employees',
  },
  'Kết cấu': { destination: 'properties.construction_text' },
  Approved: {
    destination: null,
    why: 'source flag only; it is not a reservation approval and imported records start review=pending',
  },
};

/**
 * One contact per distinct owner name + phone set, shared by every property that carries it.
 * Names alone never establish identity, so a different phone makes a different contact.
 */
export function contactKey(contact) {
  const phones = [...contact.phones].sort().join(',');
  return `${foldText(contact.display_name)}|${phones || foldText(contact.raw_phone_text)}`;
}

// Labels that mean "the owner is unknown", not a person: they create no contact row. The
// property is still imported; only the invented contact is withheld.
const PLACEHOLDER_OWNERS = new Set([
  'chua co ten',
  'chua co chu',
  'chua chu',
  'chua biet ten',
  'chua hoi ten',
  'tim chu',
  'chu nha',
  'khong ro',
  'khong co ten',
  'cn',
  'a cn',
  'c n',
  'chu nha',
]);

export function isPlaceholderOwner(name) {
  const folded = foldText(name).replace(/\s+/g, ' ').trim();
  if (!folded) return true;
  if (/^[.\-_*?/]+$/.test(folded)) return true;
  return PLACEHOLDER_OWNERS.has(folded);
}

/** A master key is the only thing a child tab joins on; a BDS id is never converted. */
export function classifyChildReference(reference, masterByKey) {
  const value = text(reference);
  if (!value) return { kind: 'empty_key' };
  const direct = masterByKey.get(value);
  if (direct) return { kind: 'direct_key', propertyKey: direct };
  return { kind: 'unmatched' };
}

/**
 * What happens to one master row. The price rules outrank review, so a row whose price cannot
 * be read is quarantined before its listing facts are looked at, and only `ready` and `review`
 * rows are ever written.
 */
export function recordBucket({
  empty,
  sourceKey,
  duplicateKey,
  priceRule,
  status,
  addressStatus,
  issues,
}) {
  if (empty) return 'empty';
  if (!sourceKey) return 'quarantined_missing_id';
  if (duplicateKey) return 'quarantined_duplicate_id';
  if (priceRule === 'price_missing') return 'quarantined_price_missing';
  if (priceRule === 'price_ceiling') return 'quarantined_price_ceiling';
  if (priceRule === 'unparseable') return 'quarantined_price_unparseable';
  if (priceRule === 'rent_unparseable') return 'quarantined_rent_unparseable';
  if (priceRule === 'rental_only') return 'excluded_rental_only';
  if (!status) return 'quarantined_status_unmapped';
  if (!['resolved', 'current_name'].includes(addressStatus)) return 'review';
  if (
    issues.some((issue) =>
      /missing|unmapped|invalid|ambiguous|overflow|fractional|non_positive|too_precise|needs_review|disagreement/.test(
        issue,
      ),
    )
  )
    return 'review';
  return 'ready';
}

/**
 * The master keys whose properties this run would create. The write run resolves the same set
 * through private.property_source_map, so the dry run's attachment plan names it too.
 */
export function importablePropertyKeys(records) {
  return new Map(
    records
      .filter((record) => importableBucket(record.bucket))
      .map((record) => [record.source_key, record.source_key]),
  );
}

/**
 * Owner contacts over the rows this run would create, which is the set the write path links: a
 * quarantined row's owner is written nowhere and is counted nowhere here.
 */
export function contactSummary(records) {
  const importable = records.filter((record) =>
    importableBucket(record.bucket),
  );
  const rows = new Map();
  const contacts = new Map();
  for (const record of importable) {
    if (!record.contact_key) continue;
    rows.set(record.contact_key, (rows.get(record.contact_key) ?? 0) + 1);
    if (record.mapped?.contact)
      contacts.set(record.contact_key, record.mapped.contact);
  }
  return {
    distinct: rows.size,
    rows_with_owner: importable.filter((record) => record.contact_key).length,
    rows_without_owner: importable.filter((record) => !record.contact_key)
      .length,
    placeholder_owner_rows: importable.filter((record) =>
      record.issues.includes('owner_placeholder'),
    ).length,
    shared: [...rows.values()].filter((count) => count > 1).length,
    examples: [...rows.entries()]
      .filter(([, count]) => count > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key, count]) => ({
        display_name: contacts.get(key)?.display_name ?? null,
        phones: contacts.get(key)?.phones ?? [],
        rows: count,
      })),
  };
}

/** The rows set aside because `Tạo mới` names no allowed status, with what the sheet said. */
export function statusQuarantine(records) {
  const rows = records.filter(
    (record) => record.bucket === 'quarantined_status_unmapped',
  );
  const values = new Map();
  for (const record of rows)
    values.set(
      record.status_raw ?? '',
      (values.get(record.status_raw ?? '') ?? 0) + 1,
    );
  return {
    rows: rows.length,
    values: [...values.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([value, count]) => ({ value, rows: count })),
    samples: rows.slice(0, 10).map((record) => ({
      source_row: record.source_row,
      source_key: record.source_key,
      status_raw: record.status_raw,
    })),
  };
}

export function columnReport(headers, { write = false } = {}) {
  const rows = headers.map((header) => {
    const entry = MASTER_COLUMNS[header];
    if (!entry)
      return {
        column: header,
        state: 'unmapped',
        detail: 'no destination is defined for this column',
      };
    if (entry.destination === null)
      return { column: header, state: 'unmapped', detail: entry.why };
    if (entry.blocked)
      return write
        ? {
            column: header,
            state: 'mapped',
            detail: `${entry.destination}, resolved against public.employees in a write run`,
          }
        : { column: header, state: 'blocked', detail: entry.blocked };
    return { column: header, state: 'mapped', detail: entry.destination };
  });
  return rows;
}

export const PRICE_CEILING_VND = 200000000000n; // 200 billion dong, the captain's ceiling

export function mapMasterRow(row, index, reference, todayIso) {
  const value = (header) => text(row[index[header]]);
  const issues = [];
  const mapped = {
    source_key: value('PropertyID'),
    property: {
      listing_mode: null,
      property_type: 'unclassified',
      access_type: 'unknown',
      status: null,
      record_review_status: 'pending',
      legal_status: 'unknown',
      land_area_m2: null,
      frontage_m: null,
      depth_m: null,
      area_raw: null,
      direction: null,
      sale_price_vnd: null,
      monthly_rent_vnd: null,
      construction_text: value('Kết cấu') || null,
      notes: value('Ghi Chú Thêm') || null,
      entry_on: null,
      entry_source: 'unknown',
    },
    address: {
      address_text: value('Địa chỉ dự án'),
      house_number: value('Địa Chỉ') || null,
      street: value('Tên Đường') || null,
      province_text: value('Thành phố') || null,
      district_text: value('Quận') || null,
      commune_text: value('Phường') || null,
    },
    contact: null,
    unmapped: {},
  };

  const listingLabel = reference.listingModes.get(value('Loại Hình'));
  const listing = listingModeFromLabel(listingLabel);
  if (listing.error)
    issues.push(
      listing.error === 'missing'
        ? 'listing_mode_missing'
        : 'listing_mode_unmapped',
    );

  const statusLabel = value('Tạo mới');
  const status = statusFromLabel(statusLabel);
  // An unresolvable status stays unresolved, so the row is set aside instead of being given a
  // state the sheet never recorded.
  mapped.property.status = status;
  if (!status) issues.push(statusLabel ? 'status_unmapped' : 'status_missing');

  const projectLabel = value('Loại Dự án');
  if (projectLabel) {
    const category = classifyProjectType(projectLabel);
    if (category.access_type)
      mapped.property.access_type = category.access_type;
    if (category.property_type)
      mapped.property.property_type = category.property_type;
    if (!category.known) issues.push('project_type_not_in_reference');
  }

  const directionKey = foldText(value('Hướng nhà'));
  if (directionKey) {
    const code = DIRECTIONS[directionKey];
    if (code) mapped.property.direction = code;
    else issues.push('direction_unmapped');
  }

  // Captain's price rules: empty is not zero, 200 billion is a hard sanity ceiling, and a real
  // zero means price on application rather than a stored 0.
  const sale = parseMoneyVnd(value('Giá Bán (tỷ Đồng)'), 1000000000);
  const rent = parseMoneyVnd(value('Giá Thuê (triệu Đồng)'), 1000000);
  let priceRule = 'priced';
  if (sale.error) {
    priceRule = 'unparseable';
    issues.push(`sale_price_vnd:${sale.error}`);
  } else if (rent.error) {
    priceRule = 'rent_unparseable';
    mapped.property.sale_price_vnd = sale.value;
  }
  if (rent.error) issues.push(`monthly_rent_vnd:${rent.error}`);
  if (!sale.error && !rent.error) {
    if (sale.value === null) {
      priceRule =
        rent.value !== null && BigInt(rent.value) > 0n
          ? 'rental_only'
          : 'price_missing';
    } else if (BigInt(sale.value) > PRICE_CEILING_VND) {
      priceRule = 'price_ceiling';
    } else if (BigInt(sale.value) === 0n) {
      priceRule = 'price_on_application';
    }
    mapped.property.sale_price_vnd =
      priceRule === 'price_on_application' ? null : sale.value;
    mapped.property.monthly_rent_vnd = rent.value;
  }
  if (priceRule === 'price_on_application') {
    // Price on application: the status vocabulary already has the word for it.
    mapped.property.status = 'negotiating';
    issues.push('price_on_application');
  }
  if (priceRule === 'price_missing') issues.push('sale_price_missing');
  if (priceRule === 'price_ceiling') issues.push('sale_price_above_ceiling');
  if (priceRule === 'rental_only') issues.push('rental_only');
  if (priceRule === 'unparseable') issues.push('sale_price_unparseable');
  if (priceRule === 'rent_unparseable') issues.push('rent_price_unparseable');
  // The row's own prices say what is being listed; the sheet's label is only the fallback. A
  // value the parser rejected is not a value, so it never feeds the listing mode.
  const saleAmount = sale.error ? null : sale.value;
  const rentAmount = rent.error ? null : rent.value;
  const saleListed = saleAmount !== null;
  const rentListed = rentAmount !== null && BigInt(rentAmount) > 0n;
  mapped.property.listing_mode = saleListed
    ? rentListed
      ? 'both'
      : 'sale'
    : rentListed
      ? 'rent'
      : (listing.value ?? null);
  if (!mapped.property.listing_mode) issues.push('listing_mode_unresolved');
  mapped.price_rule = priceRule;
  mapped.creator_email = value('Email Người Tạo').toLowerCase() || null;
  mapped.editor_email = value('Người chỉnh sửa').toLowerCase() || null;

  for (const [header, column, maxValue] of [
    ['Chiều ngang', 'frontage_m', 999999.99],
    ['Chiều dài', 'depth_m', 999999.99],
  ]) {
    const measure = parseMeasure(value(header), 2, maxValue);
    if (measure.error) issues.push(`${column}:${measure.error}`);
    else mapped.property[column] = measure.value;
  }

  const area = parseArea(value('Tổng diện tích'), 9999999999.99);
  mapped.property.area_raw = area.raw || null;
  if (area.error) issues.push(area.error);
  else mapped.property.land_area_m2 = area.value;

  const created = parseSourceDate(value('Ngày Tạo'));
  if (created.error) issues.push('entry_on:invalid_date');
  else if (created.value && created.value <= todayIso) {
    mapped.property.entry_on = created.value;
    mapped.property.entry_source = 'legacy';
  } else if (created.value) issues.push('entry_on:future_date');

  const phones = parsePhones(value('Số điện thoai'));
  if (phones.needsReview) issues.push('phone_needs_review');
  const ownerName = value('Tên chủ sở hũu');
  if (!ownerName) issues.push('contact_name_missing');
  else if (isPlaceholderOwner(ownerName)) issues.push('owner_placeholder');
  else {
    mapped.contact = {
      display_name: ownerName,
      phones: phones.phones,
      raw_phone_text: phones.raw || null,
      contact_type: 'owner',
    };
  }
  if (!mapped.address.address_text) issues.push('address_text_missing');

  for (const [header, entry] of Object.entries(MASTER_COLUMNS)) {
    if (entry.destination !== null) continue;
    const source = value(header);
    if (source) mapped.unmapped[header] = source;
  }
  return { mapped, issues: [...new Set(issues)] };
}

// ---------------------------------------------------------------- Google reads

export function serviceAccountAssertion(credentials, scopes, nowSeconds) {
  const encode = (value) => Buffer.from(value).toString('base64url');
  const unsigned = `${encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${encode(
    JSON.stringify({
      iss: credentials.client_email,
      scope: scopes.join(' '),
      aud: credentials.token_uri,
      iat: nowSeconds,
      exp: nowSeconds + 3600,
    }),
  )}`;
  const signature = createSign('RSA-SHA256')
    .update(unsigned)
    .sign(credentials.private_key, 'base64url');
  return `${unsigned}.${signature}`;
}

export async function googleAccessToken(
  credentials,
  scopes,
  fetchImpl = fetch,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  const assertion = serviceAccountAssertion(credentials, scopes, nowSeconds);
  const response = await fetchImpl(credentials.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(
      `Google token request failed: ${response.status} ${body.error ?? ''}`.trim(),
    );
  return body.access_token;
}

async function googleJson(url, token, fetchImpl = fetch) {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60000),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `Google API ${response.status} for ${url}: ${JSON.stringify(body).slice(0, 300)}`,
    );
  }
  return body;
}

/** A header that names credential material: those cells are never requested. */
const CREDENTIAL_HEADER =
  /password|mat khau|username|monitor|secret|token|api key/i;

/** The header positions that hold credential material, by header text. */
export function credentialColumns(headers) {
  return (headers ?? [])
    .map((header, position) => ({ header: text(header), position }))
    .filter(({ header }) => CREDENTIAL_HEADER.test(foldText(header)));
}

function columnLetter(position) {
  let letter = '';
  let index = position;
  do {
    letter = String.fromCharCode(65 + (index % 26)) + letter;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return letter;
}

/** The contiguous runs of wanted columns, as 0-based start/end pairs. */
function columnBlocks(width, excluded) {
  const blocks = [];
  for (let position = 0; position < width; position += 1) {
    if (excluded.has(position)) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.end === position - 1) last.end = position;
    else blocks.push({ start: position, end: position });
  }
  return blocks;
}

/**
 * Values are fetched for every tab except the sign-in store, and never for a credential column:
 * the header row is read first and the data ranges cover only the columns it leaves.
 */
export async function readSpreadsheet(token, spreadsheetId, fetchImpl = fetch) {
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const meta = await googleJson(
    `${base}?fields=properties.title,sheets.properties.title,sheets.properties.gridProperties`,
    token,
    fetchImpl,
  );
  const tabs = new Map();
  const skipped = [];
  const excluded = [];
  for (const sheet of meta.sheets) {
    const title = sheet.properties.title;
    if (foldText(title) === 'login') {
      skipped.push(title);
      continue;
    }
    const header = await googleJson(
      `${base}/values/${encodeURIComponent(`'${title}'!1:1`)}?majorDimension=ROWS`,
      token,
      fetchImpl,
    );
    const headers = (header.values?.[0] ?? []).map(text);
    const credential = credentialColumns(headers);
    for (const entry of credential)
      excluded.push({
        tab: title,
        column: entry.header,
        why: 'credential-like column, never requested',
      });
    const blocks = columnBlocks(
      headers.length,
      new Set(credential.map((entry) => entry.position)),
    );
    if (!blocks.length) {
      tabs.set(title, []);
      continue;
    }
    const rowCount = sheet.properties.gridProperties?.rowCount;
    const params = new URLSearchParams({ majorDimension: 'ROWS' });
    for (const block of blocks)
      params.append(
        'ranges',
        `'${title}'!${columnLetter(block.start)}1:${columnLetter(block.end)}${rowCount ?? ''}`,
      );
    const body = await googleJson(
      `${base}/values:batchGet?${params}`,
      token,
      fetchImpl,
    );
    const valueRanges = body.valueRanges ?? [];
    const height = valueRanges.reduce(
      (tallest, valueRange) =>
        Math.max(tallest, (valueRange.values ?? []).length),
      0,
    );
    const rows = [];
    for (let index = 0; index < height; index += 1) {
      // Cells keep their header position so a row index means the same column everywhere.
      const row = new Array(headers.length).fill('');
      valueRanges.forEach((valueRange, position) => {
        const block = blocks[position];
        const cells = valueRange.values?.[index] ?? [];
        for (let cell = block.start; cell <= block.end; cell += 1)
          row[cell] = cells[cell - block.start] ?? '';
      });
      rows.push(row);
    }
    tabs.set(title, rows);
  }
  return { title: meta.properties.title, tabs, skipped, excluded };
}

export async function listDriveFolder(token, folderId, fetchImpl = fetch) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: '1000',
      fields: 'nextPageToken,files(id,name,mimeType,size)',
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const body = await googleJson(
      `https://www.googleapis.com/drive/v3/files?${params}`,
      token,
      fetchImpl,
    );
    files.push(...(body.files ?? []));
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return files;
}

/** Folders with their files, each carrying the relative path the attachment tab uses. */
export async function listDriveTree(
  token,
  rootId,
  fetchImpl = fetch,
  depth = 0,
) {
  const folders = [];
  const loose = [];
  for (const entry of await listDriveFolder(token, rootId, fetchImpl)) {
    if (entry.mimeType === 'application/vnd.google-apps.folder') {
      if (depth >= 3) continue;
      const nested = await listDriveTree(token, entry.id, fetchImpl, depth + 1);
      folders.push({
        id: entry.id,
        name: entry.name,
        files: nested.loose.map((file) => ({
          ...file,
          folderId: entry.id,
          relativePath: `${entry.name}/${file.relativePath}`,
        })),
      });
      folders.push(
        ...nested.folders.map((folder) => ({
          ...folder,
          files: folder.files.map((file) => ({
            ...file,
            relativePath: `${entry.name}/${file.relativePath}`,
          })),
        })),
      );
    } else if (entry.mimeType !== 'application/vnd.google-apps.spreadsheet') {
      loose.push({ ...entry, relativePath: entry.name });
    }
  }
  return { folders, loose };
}

export function pickTab(tabs, aliasKey) {
  const wanted = TAB_ALIASES[aliasKey] ?? [aliasKey];
  for (const title of tabs.keys()) {
    if (wanted.includes(foldText(title))) return title;
  }
  for (const title of tabs.keys()) {
    if (wanted.some((name) => foldText(title).startsWith(name))) return title;
  }
  return null;
}

/**
 * The roster's name, email and position cells, found by their header so a credential column
 * between them cannot shift the position out of the cell the role rule reads.
 */
export function rosterEmployees(rows) {
  const column = (...patterns) =>
    (rows?.[0] ?? []).findIndex((header) =>
      patterns.some((pattern) => pattern.test(foldText(header))),
    );
  const nameColumn = column(/^ten/, /^name/);
  const emailColumn = column(/email/);
  const positionColumn = column(/chuc vu/, /position/, /^role/);
  return (rows ?? []).slice(1).map((row) => ({
    name: text(row?.[nameColumn]),
    email: text(row?.[emailColumn]),
    position: text(row?.[positionColumn]),
  }));
}

// ---------------------------------------------------------------- confirmation gate

/**
 * Write mode refuses unless the confirmation names the exact snapshot that was just read. The
 * captain's settled rules cover what happens to a refused address (legacy address only, review
 * pending), so no per-address decision is asked for here.
 */
export function confirmationProblems(confirmation, { digest }) {
  const problems = [];
  if (!confirmation) return ['no confirmation file was supplied'];
  if (confirmation.source_sha256 !== digest) {
    problems.push(
      `confirmation digest ${confirmation.source_sha256 ?? '(missing)'} does not match snapshot ${digest}`,
    );
  }
  if (!text(confirmation.confirmed_by))
    problems.push('confirmed_by is missing');
  if (!text(confirmation.confirmed_at))
    problems.push('confirmed_at is missing');
  else if (Number.isNaN(Date.parse(confirmation.confirmed_at)))
    problems.push('confirmed_at is not a date');
  return problems;
}

// ---------------------------------------------------------------- report

function topEntries(map, limit = 5) {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

/**
 * What the report may claim: the requested mode is not evidence of what happened, so every claim
 * is keyed on the recorded outcome - the dry run, a refused write and its reason, or a completed
 * write that resolved the roster.
 */
export function writeOutcome(report) {
  const state =
    report.write_outcome?.state ?? (report.write ? 'completed' : 'dry_run');
  const reason = report.write_outcome?.reason ?? null;
  return {
    state,
    reason,
    rosterResolved: state === 'completed',
    title:
      state === 'completed'
        ? 'import'
        : state === 'refused'
          ? 'write refused'
          : state === 'failed'
            ? 'write failed'
            : 'dry run',
    label:
      state === 'completed'
        ? 'write run'
        : state === 'refused'
          ? 'refused write run'
          : state === 'failed'
            ? 'failed write run'
            : 'dry run',
  };
}

export function renderReport(report) {
  const lines = [];
  const push = (...values) => lines.push(...values);
  const price = report.prices;
  const outcome = writeOutcome(report);
  const sampleRows = (bucket) =>
    (report.samples[bucket] ?? []).map(
      (row) =>
        `| ${row.source_row} | ${row.source_key} | ${row.owner ?? ''} | ${row.sale_raw ?? '(empty)'} | ${row.rent_raw ?? '(empty)'} |`,
    );
  push(
    `# Legacy workbook ${outcome.title} — ${report.generated_at}`,
    '',
    `Spreadsheet: \`${report.spreadsheet_id}\` (title "${report.spreadsheet_title}")  `,
    `Drive folder: \`${report.drive_folder_id}\`  `,
    `Service account: ${report.service_account} (scopes: spreadsheets.readonly, drive.readonly)  `,
    `Snapshot digest: \`${report.digest}\`  `,
    `Write: ${outcome.state}${outcome.reason ? ` — ${outcome.reason}` : ''}`,
    '',
    outcome.state === 'completed'
      ? `**This run wrote to the development project.** The project now holds ${report.write.verification.counts.properties} properties and ${report.write.verification.counts.files} ready files for this batch's source rows, and this run recorded ${report.write.staff.invitations.recorded} invitations (the project holds ${report.write.verification.counts.invitations_recorded} recorded invitations in total); the sheet and Drive were only read. The report is written`
      : outcome.state === 'refused'
        ? `**No writes were made.** The write was refused: ${outcome.reason}. The sheet and Drive were only read. The report is written`
        : outcome.state === 'failed'
          ? `**The write failed: ${outcome.reason}.** Rows this run committed before the failure remain in the project and the read-back is not recorded; the column states below are the pre-write states. The report is written`
          : '**No writes were made.** The sheet, Drive and the database were only read. The report is written',
    `to \`${report.out_dir}\`, which Git ignores because it contains personal data.`,
    '',
    '## 1. Counts',
    '',
    '| Measure | Count |',
    '| --- | ---: |',
    `| Data rows read from the master tab | ${report.counts.total_rows} |`,
    `| Fully empty rows | ${report.counts.empty_rows} |`,
    `| Rows with no PropertyID | ${report.counts.missing_id_rows} |`,
    `| Distinct PropertyID values | ${report.counts.distinct_keys} |`,
    `| Duplicated PropertyID keys | ${report.counts.duplicate_keys} |`,
    `| Rows import cleanly | ${report.counts.ready_rows} |`,
    `| Rows needing review | ${report.counts.review_rows} |`,
    `| Quarantined rows | ${report.counts.quarantined_rows} |`,
    `| Excluded rows (captain decision) | ${report.counts.excluded_rows} |`,
    '',
    '| Bucket | Rows |',
    '| --- | ---: |',
    ...report.counts.buckets.map((row) => `| ${row.bucket} | ${row.rows} |`),
    '',
    '| Source issue | Rows |',
    '| --- | ---: |',
    ...report.issues.map((row) => `| ${row.issue} | ${row.rows} |`),
    '',
    '## 2. Price rules (captain’s rule set)',
    '',
    '| Rule | Rows | Effect |',
    '| --- | ---: | --- |',
    `| Sale price empty, no rent | ${price.missing} | quarantined, not imported |`,
    `| Sale price above 200 billion | ${price.ceiling} | quarantined, not imported |`,
    `| Sale price exactly 0 | ${price.on_application} | imported with status negotiating and no numeric sale price |`,
    `| Sale price empty but rent above zero | ${price.rental_only} | excluded from this migration per captain |`,
    `| Sale price text that cannot be read | ${price.unparseable} | quarantined, never guessed |`,
    `| Rent price text that cannot be read | ${price.rent_unparseable} | quarantined, never guessed |`,
    '',
  );
  if (price.missing) {
    push(
      '### Quarantined: sale price empty, no rent',
      '',
      '| Source row | PropertyID | Owner | Sale price | Rent price |',
      '| ---: | --- | --- | --- | --- |',
      ...sampleRows('quarantined_price_missing'),
      '',
    );
  }
  if (price.ceiling) {
    push(
      '### Quarantined: sale price above the 200 billion ceiling',
      '',
      '| Source row | PropertyID | Owner | Sale price | Rent price |',
      '| ---: | --- | --- | --- | --- |',
      ...sampleRows('quarantined_price_ceiling'),
      '',
    );
  }
  if (price.on_application_samples.length) {
    push(
      '### Imported as price on application (sale price exactly 0)',
      '',
      '| Source row | PropertyID | Owner | Sale price | Rent price |',
      '| ---: | --- | --- | --- | --- |',
      ...price.on_application_samples.map(
        (row) =>
          `| ${row.source_row} | ${row.source_key} | ${row.owner ?? ''} | ${row.sale_raw ?? '(empty)'} | ${row.rent_raw ?? '(empty)'} |`,
      ),
      '',
    );
  }
  if (price.rental_only) {
    push(
      '### Excluded: rental-only, sale price absent (per captain)',
      '',
      '| Source row | PropertyID | Owner | Sale price | Rent price |',
      '| ---: | --- | --- | --- | --- |',
      ...sampleRows('excluded_rental_only'),
      '',
    );
  }
  const statusQuarantined = report.statuses ?? {
    rows: 0,
    values: [],
    samples: [],
  };
  if (statusQuarantined.rows) {
    push(
      '### Quarantined: `Tạo mới` names no allowed status',
      '',
      `Rows set aside: **${statusQuarantined.rows}**. No property row is written for them, so none`,
      'carries an invented status.',
      '',
      '| Tạo mới value | Rows |',
      '| --- | ---: |',
      ...statusQuarantined.values.map(
        (entry) => `| ${entry.value || '(empty)'} | ${entry.rows} |`,
      ),
      '',
      '| Source row | PropertyID | Tạo mới |',
      '| ---: | --- | --- |',
      ...statusQuarantined.samples.map(
        (row) =>
          `| ${row.source_row} | ${row.source_key} | ${row.status_raw || '(empty)'} |`,
      ),
      '',
    );
  }
  push(
    '## 3. Master columns',
    '',
    '| Column | State | Destination or reason |',
    '| --- | --- | --- |',
    ...report.columns.map(
      (column) => `| ${column.column} | ${column.state} | ${column.detail} |`,
    ),
    '',
  );
  const unmapped = report.columns.filter((column) => column.state !== 'mapped');
  if (unmapped.length) {
    push(
      `### Columns with no live destination in this ${outcome.label}`,
      '',
      ...unmapped.map(
        (column) =>
          `- **${column.column}** — ${column.state}: ${column.detail}`,
      ),
      '',
    );
  }
  push(
    '## 4. Address conversion',
    '',
    'VietMap’s address migration API is the primary resolver and answers per address, so every',
    'distinct address in the sheet is queried exactly once (cached in `vietmap-cache.json`; the raw',
    'response is never stored). Where it returns no boundary, the fallback is the published official',
    'three-tier → two-tier mapping, matched by city **and** district **and** ward together and then by',
    'the legacy ward’s official code; the project catalogue supplies the target unit identity.',
    'A ward name alone never selects a commune.',
    '',
    '| Resolved by | Rows |',
    '| --- | ---: |',
    ...report.addresses.sources.map((row) => `| ${row.source} | ${row.rows} |`),
    '',
    `Distinct addresses: **${report.addresses.vietmap.distinct_addresses}** — ${report.addresses.vietmap.cached_resolved} resolved and ${report.addresses.vietmap.cached_empty} with no boundary in the cache. This run queried ${report.addresses.vietmap.unique_queries} new addresses and made ${report.addresses.vietmap.api_calls} API calls (${report.addresses.vietmap.cache_hits} cache hits, ${report.addresses.vietmap.migrate_type_2_calls} retried with migrate_type 2, ${report.addresses.vietmap.failed} failed after retries).`,
    '',
    '| VietMap outcome | Rows |',
    '| --- | ---: |',
    ...report.addresses.vietmap_statuses.map(
      (row) => `| ${row.status} | ${row.rows} |`,
    ),
    '',
    '| Fallback outcome | Rows | Triples |',
    '| --- | ---: | ---: |',
    ...report.addresses.outcomes.map(
      (row) => `| ${row.status} | ${row.rows} | ${row.triples} |`,
    ),
    '',
    `Rows with a converted current province and commune: **${report.addresses.converted_rows}** of ${report.counts.total_rows}.`,
    `Rows refused: **${report.addresses.refused_rows}**.`,
    '',
    report.addresses.crosswalk_note,
    '',
  );
  if (report.addresses.disagreements.length) {
    push(
      '### Sources that disagree',
      '',
      `Rows affected: ${report.addresses.disagreement_rows}. Neither source is silently preferred: VietMap's answer is used and the row needs review.`,
      '',
      '| Source row | Address | VietMap | Official mapping |',
      '| ---: | --- | --- | --- |',
      ...report.addresses.disagreements.map(
        (entry) =>
          `| ${entry.source_row} | ${entry.query} | ${entry.vietmap} | ${entry.official_mapping} |`,
      ),
      '',
    );
  }
  if (report.addresses.unresolved_units.length) {
    push(
      '### Unresolved legacy units, by row count',
      '',
      '| Legacy triple | Rows | Fallback outcome | VietMap |',
      '| --- | ---: | --- | --- |',
    );
    for (const entry of report.addresses.unresolved_units) {
      push(
        `| ${entry.key} | ${entry.rows} | ${entry.status} | ${entry.vietmap} |`,
      );
    }
    push('');
  }
  if (report.addresses.split_units.length) {
    push(
      '### Legacy units that resolve to more than one current commune',
      '',
      '| Legacy triple | Rows | Current communes |',
      '| --- | ---: | --- |',
    );
    for (const entry of report.addresses.split_units)
      push(`| ${entry.key} | ${entry.rows} | ${entry.targets} |`);
    push('');
  }
  if (report.addresses.refused_examples.length) {
    push(
      '### Refused or unresolved addresses (examples)',
      '',
      '| Source row | City / District / Ward | Outcome | Detail |',
      '| ---: | --- | --- | --- |',
    );
    for (const entry of report.addresses.refused_examples) {
      push(
        `| ${entry.source_row} | ${entry.city} / ${entry.district} / ${entry.ward} | ${entry.status} | ${entry.detail} |`,
      );
    }
    push('');
  }
  push(
    '## 5. Duplicates and collisions',
    '',
    `- Repeated PropertyID keys: ${report.duplicates.property_keys.length} key(s), ${report.duplicates.property_key_rows} row(s).`,
    `- Repeated owner phone numbers: ${report.duplicates.phone_repeats} value(s) shared by ${report.duplicates.phone_repeat_rows} rows.`,
    `- Addresses whose legacy unit resolves to more than one current commune: ${report.duplicates.multi_commune_rows} row(s).`,
    '',
  );
  if (report.duplicates.examples.length) {
    push('| Kind | Value | Rows |', '| --- | --- | ---: |');
    for (const entry of report.duplicates.examples)
      push(`| ${entry.kind} | ${entry.value} | ${entry.rows} |`);
    push('');
  }
  push(
    '## 6. Contacts and staff attribution',
    '',
    `- Distinct owner contacts (folded name, sorted phones, folded raw phone text) for the properties this run would create: **${report.contacts.distinct}**, over ${report.contacts.rows_with_owner} such rows with an owner.`,
    `- Contacts linked by more than one of those properties: ${report.contacts.shared}.`,
    `- Rows this run would create with no owner name or a placeholder owner (\`Chưa có tên\`, \`tìm chủ\`, \`cn\` and similar), so no contact row is written: ${report.contacts.rows_without_owner} (${report.contacts.placeholder_owner_rows} of them placeholders).`,
    `- The Contracts tab is not used for owner data; ownership comes from the master tab.`,
    `- Distinct creator emails: ${report.staff.creator_emails} (${report.staff.creator_rows} rows); distinct editor emails: ${report.staff.editor_emails} (${report.staff.editor_rows} rows).`,
    `- Staff addresses to provision: **${report.staff_plan.addresses}** (${report.staff_plan.from_roster} also appear in the Nhân viên roster with a position).`,
    '',
  );
  if (report.contacts.examples.length) {
    push('| Owner | Phones | Properties |', '| --- | --- | ---: |');
    for (const entry of report.contacts.examples)
      push(
        `| ${entry.display_name} | ${entry.phones.join(' ')} | ${entry.rows} |`,
      );
    push('');
  }
  push(
    '### Staff roles',
    '',
    'TPKD is a manager, Thư ký is staff, and admin stays with the captain: every other Admin position,',
    'every other position and every address the roster does not name is sales.',
    '',
    '| Role | Addresses |',
    '| --- | ---: |',
    ...report.staff_plan.by_role.map(
      (entry) => `| ${entry.role} | ${entry.count} |`,
    ),
    '',
    `- The silent admin is \`${report.staff_plan.silent_admin ?? '(none)'}\`: an Auth user created through the admin API, an active admin employee, and no invitation email. Its password goes only to the captain's private file.`,
    `- Position labels in the roster: ${report.staff_plan.roster_positions.map((entry) => `\`${entry.position}\` → ${entry.role}`).join(', ') || '(none)'}.`,
    '- Every other address that is not already an employee receives a real invitation through the application flow, begun and recorded as the captain administration account.',
    '- The Nhân viên password columns are never read, here or at write time.',
    '',
    '## 7. Attachments',
    '',
    '| Folder | Files | Size |',
    '| --- | ---: | ---: |',
    ...report.attachments.folders.map(
      (folder) => `| ${folder.name} | ${folder.files} | ${folder.mib} MiB |`,
    ),
    '',
    `- Exact-PropertyID attachment rows: **${report.attachments.rows}**.`,
    `- Rows whose bytes can be imported now, for the properties this run would create: **${report.attachments.matched_files}** (${report.attachments.downloadable_bytes} MiB).`,
    `- Drive files no attachment row references: ${report.attachments.unreferenced_files}.`,
    '',
  );
  if (report.attachments.dropped.length) {
    push('| Dropped rows | Count |', '| --- | ---: |');
    for (const entry of report.attachments.dropped)
      push(`| ${entry.reason} | ${entry.count} |`);
    push('');
  }
  push(
    'Write mode downloads each importable file from the Drive folder, stores the bytes in the private',
    'R2 bucket through the application upload path, and registers the property file row. The shipped',
    'per-file (image 5 MiB, document 20 MiB) and per-property (10 images, 5 documents) limits decide',
    'what may be stored; a refusal is reported, never worked around.',
    '',
    '## 8. Child tabs',
    '',
    'The settled join is an exact master `PropertyID`. The `BDS-N` row-number hypothesis is disproved',
    'against this sheet, so a child row that does not match an exact key is dropped and counted.',
    '',
    '| Tab | Rows | Exact key | Unmatched | Empty key |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...report.children.map(
      (child) =>
        `| ${child.tab} | ${child.rows} | ${child.direct_key} | ${child.unmatched} | ${child.empty_key} |`,
    ),
    '',
  );
  if (report.dropped_tabs.length) {
    push('| Tab | Rows | Why it is not imported |', '| --- | ---: | --- |');
    for (const entry of report.dropped_tabs)
      push(`| ${entry.tab} | ${entry.rows} | ${entry.reason} |`);
    push('');
  }
  push(
    'Accepted `Historical` rows are kept as the private source archive in `private.staging_rows`, linked to',
    'the property they name through `private.import_entity_map`; no audit event or approval is invented.',
    '',
    '## 9. Excluded credentials and personal material',
    '',
    ...(report.skipped_tabs.length
      ? report.skipped_tabs.map(
          (tab) =>
            `- ${tab} tab — never requested: it stores sign-in material.`,
        )
      : ['- No sign-in tab was present.']),
    ...report.excluded.map(
      (entry) => `- ${entry.tab} / ${entry.column} — ${entry.why}.`,
    ),
    '',
    '## 10. Example rows mapped end to end',
    '',
  );
  for (const example of report.examples) {
    push(
      `### Source row ${example.source_row} (PropertyID ${example.source_key})`,
      '',
      '```json',
      JSON.stringify(example.entity, null, 2),
      '```',
      '',
    );
  }
  push(
    '## 11. What a write run does',
    '',
    '- Opens (or resumes) one `private.import_batches` row keyed on the snapshot digest and records one',
    '  `private.staging_rows` row per master, Historical and Attachments source row.',
    '- Inserts one `public.properties` row per accepted source key, keyed by a stable id derived from the',
    '  source key, so a repeated or resumed run converges instead of duplicating. Review starts `pending`.',
    '- Inserts the legacy address untouched, and a converted current address only where a bound was',
    '  resolved; an unresolved address keeps the legacy row and no current province or commune.',
    '- Inserts each distinct owner contact once and links it through `public.property_contacts`.',
    '- Records every source key in `private.property_source_map` and every written row in',
    '  `private.import_entity_map`.',
    '- Resolves creator and editor emails against `public.employees`, provisioning the roster first.',
    '- Downloads each importable attachment, stores the bytes in the private R2 bucket through the',
    '  application upload path, and registers the property file.',
    '- Refuses the whole run unless the confirmed digest matches this snapshot.',
    '',
  );
  const writeSection = outcome.state === 'completed' && Boolean(report.write);
  if (writeSection) {
    const write = report.write;
    const skipped = write.properties.addresses.converted_skipped;
    const skippedSummary = convertedSkipped(skipped);
    push(
      '## 12. What this run wrote',
      '',
      `Batch \`${write.batch_id}\` (${write.batch_status}).`,
      '',
      `| Read back for this batch's source rows | Count |`,
      '| --- | ---: |',
      `| Properties | ${write.verification.counts.properties} |`,
      `| Legacy addresses | ${write.verification.counts.legacy_addresses} |`,
      `| Converted current addresses | ${write.verification.counts.current_addresses} |`,
      `| Owner contact links | ${write.verification.counts.contact_links} |`,
      `| Files stored | ${write.verification.counts.files} |`,
      '',
      `- Staff addresses planned: ${write.staff.addresses}; silent admin: \`${write.staff.silent_admin ?? '(none)'}\`.`,
      `- Invitations this run stated ${write.staff.invitations.stated}, ${write.staff.invitations.refused} refused, and recorded ${write.staff.invitations.recorded} (accepted provider outcome plus accepted outcome write); ${write.staff.invitations.failures.length} did not reach recorded.`,
      `- Recorded invitations the project as a whole holds, not scoped to this batch: ${write.verification.counts.invitations_recorded}.`,
      ...(write.staff.invitations.failures.length
        ? [
            '',
            '| Invitation that did not reach recorded | Provider outcome | Detail |',
            '| --- | --- | --- |',
            ...write.staff.invitations.failures.map(
              (entry) =>
                `| ${entry.email} | ${entry.outcome} | ${entry.detail ?? ''} |`,
            ),
          ]
        : []),
      `- Attachments planned ${write.attachments.planned}, dropped ${write.attachments.dropped.reduce((total, entry) => total + entry.count, 0)}; outcomes: ${write.attachments.outcomes.map((entry) => `${entry.outcome} ${entry.count}`).join(', ') || '(none)'}.`,
      `- Rows counted as converted by the dry run but written with the legacy address only, because the project has no admin unit for the target: **${skippedSummary.rows}**, missing ${
        skippedSummary.codes
          .slice(0, 10)
          .map((entry) => `${entry.code} x${entry.rows}`)
          .join(', ') || 'no unit codes'
      }${skippedSummary.codes.length > 10 ? ` and ${skippedSummary.codes.length - 10} more unit codes` : ''}.`,
      ...(skipped.length
        ? [
            '',
            '| Source row | PropertyID | Province / commune codes |',
            '| ---: | --- | --- |',
            ...skipped
              .slice(0, 50)
              .map(
                (row) =>
                  `| ${row.source_row} | ${row.source_key} | ${row.province_code} / ${row.commune_code} |`,
              ),
          ]
        : []),
      '',
    );
  }
  push(
    `## ${writeSection ? 13 : 12}. Limits of this run`,
    '',
    '- `admin_unit_crosswalks` has no reviewed rows and `admin_unit_versions` seeds no district level, so',
    '  the fallback conversion uses the published official mapping.',
    '- Property, address and contact rows are written over the administrative (owner) database connection,',
    '  which is not subject to RLS, because the import preserves each legacy author; attachments go through',
    '  the application RPCs as the importing admin and are subject to the shipped limits.',
    '- This run is authorised for the development project only. Production is a separate, later step.',
    '',
  );
  return lines.join('\n');
}

// ---------------------------------------------------------------- main

function parseArgs(argv) {
  const options = {
    out: join(process.cwd(), 'imports', 'legacy-dry-run'),
    write: false,
    confirm: null,
    spreadsheetId: process.env.SHEET_ID ?? DEFAULT_SPREADSHEET_ID,
    folderId: process.env.DRIVE_FOLDER_ID ?? DEFAULT_DRIVE_FOLDER_ID,
    keyPath: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? DEFAULT_KEY_PATH,
    migrationsDir: MIGRATIONS_DIR,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') continue;
    if (argument === '--write') options.write = true;
    else if (argument === '--confirm') options.confirm = argv[++index];
    else if (argument === '--out') options.out = resolve(argv[++index]);
    else if (argument === '--spreadsheet')
      options.spreadsheetId = argv[++index];
    else if (argument === '--folder') options.folderId = argv[++index];
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`unknown argument ${argument}`);
  }
  return options;
}

const USAGE = `Legacy workbook importer.

  node scripts/import-legacy-sheet.mjs [--out <dir>]

  --out <dir>        report directory (default ./imports/legacy-dry-run); Git ignores imports/
  --write            import into the project; requires --confirm <file> for this exact snapshot
  --confirm <file>   confirmation JSON carrying the snapshot digest it approves
  --spreadsheet      override the spreadsheet id
  --folder           override the Drive folder id

A dry run reads only. A write run needs IMPORT_DATABASE_URL, the server-only Supabase and R2
variables in the environment, and SGN_ENV=dev: this import is authorised for the development
project only. The key is read from GOOGLE_APPLICATION_CREDENTIALS or ${DEFAULT_KEY_PATH}.`;

export async function run(argv, dependencies = {}) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(USAGE);
    return { code: 0 };
  }
  const fetchImpl = dependencies.fetch ?? fetch;
  const credentials = JSON.parse(readFileSync(options.keyPath, 'utf8'));
  const token = await googleAccessToken(credentials, READ_SCOPES, fetchImpl);
  // The sheets and Drive reads are the only reads with no retry of their own, and a dropped
  // connection there would throw away a long run's setup.
  const sheet = await retryNetwork(() =>
    readSpreadsheet(token, options.spreadsheetId, fetchImpl),
  );
  const drive = await retryNetwork(() =>
    listDriveTree(token, options.folderId, fetchImpl),
  );

  const masterTitle = pickTab(sheet.tabs, 'master');
  if (!masterTitle)
    throw new Error('the master tab was not found in the spreadsheet');

  const digest = createHash('sha256')
    .update(JSON.stringify([...sheet.tabs.entries()]))
    .digest('hex');
  const todayIso = new Date(Date.now() + 7 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const catalogue =
    dependencies.catalogue ?? readAdminUnitCatalogue(options.migrationsDir);
  const reference = buildReference({
    listing: sheet.tabs.get(pickTab(sheet.tabs, 'listing')) ?? [],
    projectType: sheet.tabs.get(pickTab(sheet.tabs, 'projectType')) ?? [],
    status: sheet.tabs.get(pickTab(sheet.tabs, 'status')) ?? [],
    district: sheet.tabs.get(pickTab(sheet.tabs, 'district')) ?? [],
    ward: sheet.tabs.get(pickTab(sheet.tabs, 'ward')) ?? [],
    city: sheet.tabs.get(pickTab(sheet.tabs, 'city')) ?? [],
  });

  const master = sheet.tabs.get(masterTitle);
  const headers = (master[0] ?? []).map(text);
  const index = Object.fromEntries(
    headers.map((header, position) => [header, position]),
  );
  const keys = new Map();
  for (const row of master.slice(1)) {
    const key = text(row?.[index.PropertyID]);
    if (key) keys.set(key, (keys.get(key) ?? 0) + 1);
  }
  const duplicateKeys = new Set(
    [...keys.entries()].filter(([, count]) => count > 1).map(([key]) => key),
  );

  const legacyTrees = new Map();
  const conversionCache = new Map();
  const resolveContext = {
    catalogue,
    reference,
    legacyTree: (cityKey) => legacyTrees.get(cityKey) ?? null,
    convertLegacyWard: async (code) => {
      if (!conversionCache.has(code)) {
        const response = await fetchImpl(
          `${OPEN_API}/api/v2/w/from-legacy/?legacy_code=${code}`,
          {
            signal: AbortSignal.timeout(30000),
          },
        );
        if (!response.ok)
          throw new Error(
            `provinces.open-api.vn returned ${response.status} for legacy ward ${code}`,
          );
        const body = await response.json();
        conversionCache.set(
          code,
          body.map((entry) => ({
            code: String(entry.ward.code),
            name: entry.ward.name,
            province: String(entry.ward.province_code).padStart(2, '0'),
          })),
        );
      }
      return conversionCache.get(code);
    },
  };

  // The official three-tier tree is loaded only for cities the workbook actually uses.
  const legacyProvinceList = await fetchImpl(`${OPEN_API}/api/v1/?depth=1`, {
    signal: AbortSignal.timeout(30000),
  }).then((response) => {
    if (!response.ok)
      throw new Error(
        `provinces.open-api.vn returned ${response.status} for the legacy province list`,
      );
    return response.json();
  });
  const usedCities = new Set();
  for (const row of master.slice(1)) {
    const city = text(row?.[index['Thành phố']]);
    if (city) usedCities.add(adminNameKey(city));
  }
  for (const cityKey of usedCities) {
    const province = legacyProvinceList.find(
      (entry) => adminNameKey(entry.name) === cityKey,
    );
    if (!province) continue;
    const response = await fetchImpl(
      `${OPEN_API}/api/v1/p/${province.code}?depth=3`,
      { signal: AbortSignal.timeout(60000) },
    );
    if (!response.ok)
      throw new Error(
        `provinces.open-api.vn returned ${response.status} for legacy province ${province.code}`,
      );
    legacyTrees.set(cityKey, await response.json());
  }

  const outcomes = new Map();
  const sources = new Map();
  const splitUnits = new Map();
  const addressResults = new Map();
  const records = [];
  const phoneRows = new Map();
  const issueCounts = new Map();
  const disagreements = [];
  const creatorEmails = new Map();
  const editorEmails = new Map();

  const addressQuery = (address) =>
    text(address.address_text) ||
    [address.commune_text, address.district_text, address.province_text]
      .map(text)
      .filter(Boolean)
      .join(', ');

  // VietMap answers per address, so every distinct address is queried exactly once and cached.
  const vietmap =
    dependencies.vietmap ??
    createVietMapResolver({
      token: dependencies.vietmapToken ?? readVietMapToken(),
      catalogue,
      cachePath: join(options.out, 'vietmap-cache.json'),
      fetchImpl,
    });
  const answers = new Map();
  for (const row of master.slice(1)) {
    const query = addressQuery({
      address_text: text(row?.[index['Địa chỉ dự án']]),
      commune_text: text(row?.[index['Phường']]),
      district_text: text(row?.[index['Quận']]),
      province_text: text(row?.[index['Thành phố']]),
    });
    if (!query || answers.has(query)) continue;
    answers.set(query, await vietmap.lookup(query));
  }
  vietmap.flush?.();
  const cacheSummary = {
    distinct_addresses: answers.size,
    cached_resolved: [...answers.values()].filter((entry) => entry.commune_code)
      .length,
    cached_empty: [...answers.values()].filter((entry) => !entry.commune_code)
      .length,
  };

  for (const [offset] of master.slice(1).entries()) {
    const sourceRow = offset + 2;
    const full = master[offset + 1];
    const mapped = mapMasterRow(full, index, reference, todayIso);
    const empty = headers.every((header) => !text(full?.[index[header]]));
    const sourceKey = mapped.mapped.source_key;
    const rowIssues = [...mapped.issues];
    const tripleKey = `${mapped.mapped.address.province_text}|${mapped.mapped.address.district_text}|${mapped.mapped.address.commune_text}`;

    let address;
    if (empty || !sourceKey)
      address = {
        status: empty ? 'empty_row' : 'missing_property_id',
        source: null,
      };
    else {
      if (!addressResults.has(tripleKey)) {
        addressResults.set(
          tripleKey,
          await resolveAddress(
            {
              city: mapped.mapped.address.province_text,
              district: mapped.mapped.address.district_text,
              ward: mapped.mapped.address.commune_text,
            },
            resolveContext,
          ),
        );
      }
      address = combineResolution(
        answers.get(addressQuery(mapped.mapped.address)),
        addressResults.get(tripleKey),
        catalogue,
      );
      if (address.disagreement) {
        rowIssues.push('address_source_disagreement');
        if (disagreements.length < 20) {
          disagreements.push({
            source_row: sourceRow,
            query: addressQuery(mapped.mapped.address),
            ...address.disagreement,
          });
        }
      }
      sources.set(
        address.source ?? 'unresolved',
        (sources.get(address.source ?? 'unresolved') ?? 0) + 1,
      );
    }

    const bucket = recordBucket({
      empty,
      sourceKey,
      duplicateKey: duplicateKeys.has(sourceKey),
      priceRule: mapped.mapped.price_rule,
      status: mapped.mapped.property.status,
      addressStatus: address.status,
      issues: rowIssues,
    });
    if (!sourceKey && !empty) rowIssues.push('missing_property_id');
    if (duplicateKeys.has(sourceKey)) rowIssues.push('duplicate_property_id');
    if (!empty)
      for (const issue of rowIssues)
        issueCounts.set(issue, (issueCounts.get(issue) ?? 0) + 1);
    if (mapped.mapped.creator_email)
      creatorEmails.set(
        mapped.mapped.creator_email,
        (creatorEmails.get(mapped.mapped.creator_email) ?? 0) + 1,
      );
    if (mapped.mapped.editor_email)
      editorEmails.set(
        mapped.mapped.editor_email,
        (editorEmails.get(mapped.mapped.editor_email) ?? 0) + 1,
      );

    const outcomeKey = address.legacy_status ?? address.status;
    const entry = outcomes.get(outcomeKey) ?? { rows: 0, triples: new Set() };
    entry.rows += 1;
    if (!empty && sourceKey) entry.triples.add(tripleKey);
    outcomes.set(outcomeKey, entry);

    if (address.legacy_status === 'split') {
      const split = splitUnits.get(tripleKey) ?? { rows: 0, targets: [] };
      split.rows += 1;
      split.targets = address.candidates;
      splitUnits.set(tripleKey, split);
    }
    for (const phone of mapped.mapped.contact?.phones ?? []) {
      phoneRows.set(phone, (phoneRows.get(phone) ?? 0) + 1);
    }
    const contactKeyValue = mapped.mapped.contact
      ? contactKey(mapped.mapped.contact)
      : null;
    records.push({
      source_row: sourceRow,
      source_key: sourceKey,
      bucket,
      issues: rowIssues,
      address_status: address.status,
      legacy_status: address.legacy_status ?? null,
      address_detail: address,
      contact_key: contactKeyValue,
      sale_raw: text(full?.[index['Giá Bán (tỷ Đồng)']]) || null,
      rent_raw: text(full?.[index['Giá Thuê (triệu Đồng)']]) || null,
      status_raw: text(full?.[index['Tạo mới']]) || null,
      owner: mapped.mapped.contact?.display_name ?? null,
      mapped: mapped.mapped,
    });
  }

  const bucketCounts = new Map();
  for (const record of records)
    bucketCounts.set(record.bucket, (bucketCounts.get(record.bucket) ?? 0) + 1);
  const counts = {
    total_rows: master.length - 1,
    empty_rows: records.filter((record) => record.bucket === 'empty').length,
    missing_id_rows: records.filter(
      (record) => !record.source_key && record.bucket !== 'empty',
    ).length,
    distinct_keys: [...keys.keys()].length,
    duplicate_keys: duplicateKeys.size,
    ready_rows: records.filter((record) => record.bucket === 'ready').length,
    review_rows: records.filter((record) => record.bucket === 'review').length,
    quarantined_rows: records.filter((record) =>
      record.bucket.startsWith('quarantined_'),
    ).length,
    excluded_rows: records.filter(
      (record) => record.bucket === 'excluded_rental_only',
    ).length,
    buckets: [...bucketCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([bucket, rows]) => ({ bucket, rows })),
  };

  const samples = {};
  for (const bucket of bucketCounts.keys()) {
    samples[bucket] = records
      .filter((record) => record.bucket === bucket)
      .slice(0, 10)
      .map((record) => ({
        source_row: record.source_row,
        source_key: record.source_key,
        owner: record.owner,
        sale_raw: record.sale_raw,
        rent_raw: record.rent_raw,
      }));
  }
  const priceSamplesOf = (rule) =>
    records
      .filter(
        (record) =>
          record.mapped.price_rule === rule && importableBucket(record.bucket),
      )
      .slice(0, 10)
      .map((record) => ({
        source_row: record.source_row,
        source_key: record.source_key,
        owner: record.owner,
        sale_raw: record.sale_raw,
        rent_raw: record.rent_raw,
      }));
  const prices = {
    missing: bucketCounts.get('quarantined_price_missing') ?? 0,
    ceiling: bucketCounts.get('quarantined_price_ceiling') ?? 0,
    unparseable: bucketCounts.get('quarantined_price_unparseable') ?? 0,
    rent_unparseable: bucketCounts.get('quarantined_rent_unparseable') ?? 0,
    rental_only: bucketCounts.get('excluded_rental_only') ?? 0,
    on_application: records.filter(
      (record) =>
        record.mapped.price_rule === 'price_on_application' &&
        importableBucket(record.bucket),
    ).length,
    on_application_samples: priceSamplesOf('price_on_application'),
  };
  const statuses = statusQuarantine(records);
  const contactStats = contactSummary(records);
  const staff = {
    creator_emails: creatorEmails.size,
    creator_rows: [...creatorEmails.values()].reduce(
      (total, rows) => total + rows,
      0,
    ),
    editor_emails: editorEmails.size,
    editor_rows: [...editorEmails.values()].reduce(
      (total, rows) => total + rows,
      0,
    ),
  };

  const convertedRows = records.filter((record) =>
    ['resolved', 'current_name'].includes(record.address_status),
  ).length;
  const refusedRows = records.filter(
    (record) =>
      ![
        'resolved',
        'current_name',
        'empty_row',
        'missing_property_id',
      ].includes(record.address_status),
  ).length;
  const addressOutcomes = [...outcomes.entries()]
    .map(([status, entry]) => ({
      status,
      rows: entry.rows,
      triples: entry.triples.size,
    }))
    .sort((a, b) => b.rows - a.rows);
  const vietmapStatuses = new Map();
  for (const record of records) {
    const key = record.address_detail?.vietmap_status;
    if (!key) continue;
    vietmapStatuses.set(key, (vietmapStatuses.get(key) ?? 0) + 1);
  }
  const unresolvedUnits = new Map();
  for (const record of records) {
    if (
      ['resolved', 'current_name', 'empty_row', 'missing_property_id'].includes(
        record.address_status,
      )
    )
      continue;
    const key = `${record.mapped.address.province_text}|${record.mapped.address.district_text}|${record.mapped.address.commune_text}`;
    const entry = unresolvedUnits.get(key) ?? {
      rows: 0,
      status: record.address_status,
      vietmap: record.address_detail?.vietmap_status ?? '',
    };
    entry.rows += 1;
    unresolvedUnits.set(key, entry);
  }
  const refusedExamples = [];
  const seenQueries = new Set();
  for (const record of records) {
    if (
      ['resolved', 'current_name', 'empty_row', 'missing_property_id'].includes(
        record.address_status,
      )
    )
      continue;
    const query = `${record.mapped.address.province_text}|${record.mapped.address.district_text}|${record.mapped.address.commune_text}`;
    if (seenQueries.has(query)) continue;
    seenQueries.add(query);
    refusedExamples.push({
      source_row: record.source_row,
      city: record.mapped.address.province_text || '(blank)',
      district: record.mapped.address.district_text || '(blank)',
      ward: record.mapped.address.commune_text || '(blank)',
      status: record.address_status,
      detail: detailOf(record.address_detail),
    });
    if (refusedExamples.length >= 15) break;
  }

  const phoneRepeats = [...phoneRows.entries()].filter(
    ([, count]) => count > 1,
  );
  const duplicates = {
    property_keys: [...duplicateKeys],
    property_key_rows: [...duplicateKeys].reduce(
      (total, key) => total + keys.get(key),
      0,
    ),
    phone_repeats: phoneRepeats.length,
    phone_repeat_rows: phoneRepeats.reduce(
      (total, [, count]) => total + count,
      0,
    ),
    multi_commune_rows: records.filter(
      (record) => record.legacy_status === 'split',
    ).length,
    examples: [
      ...[...duplicateKeys].slice(0, 3).map((key) => ({
        kind: 'repeated PropertyID',
        value: key,
        rows: keys.get(key),
      })),
      ...topEntries(new Map(phoneRepeats), 5).map(([phone, count]) => ({
        kind: 'repeated owner phone',
        value: phone,
        rows: count,
      })),
    ],
  };

  // A repeated PropertyID cannot map to two properties, so both of its rows stay quarantined and
  // neither key joins a child tab.
  const masterByKey = new Map(
    [...keys.keys()]
      .filter((key) => !duplicateKeys.has(key))
      .map((key) => [key, key]),
  );
  const children = planChildren({ tabs: sheet.tabs, masterByKey });
  const driveFiles = driveFileIndex(drive);
  // The attachment plan names the properties this run would create, which is the set the write
  // run resolves through private.property_source_map: a quarantined row's attachments are dropped
  // as `property_not_imported` in both modes instead of counting as importable here.
  const importableByKey = importablePropertyKeys(records);
  const attachmentPlan = planAttachmentImport({
    rows: children.rows.attachments,
    propertiesByKey: importableByKey,
    driveFiles,
  });
  const attachments = {
    rows: children.rows.attachments.length,
    folders: driveFolderStats(drive),
    matched_files: attachmentPlan.plan.length,
    dropped: attachmentPlan.dropped,
    unreferenced_files:
      driveFiles.size -
      new Set(
        children.rows.attachments
          .map((row) => row.url)
          .filter((url) => driveFiles.has(url)),
      ).size,
    downloadable_bytes: Math.round(attachmentPlan.total_bytes / 1048576),
  };
  const rosterTab = pickTab(sheet.tabs, 'employee');
  const employeeRows = rosterEmployees(
    rosterTab ? sheet.tabs.get(rosterTab) : null,
  );
  const staffPlan = planStaffAccounts({
    masterEmails: [
      ...new Set([...creatorEmails.keys(), ...editorEmails.keys()]),
    ],
    employeeRows,
    silentAdminEmail: SILENT_ADMIN_EMAIL,
  });
  const staffCounts = {
    addresses: staffPlan.length,
    from_roster: staffPlan.filter((entry) => entry.position).length,
    by_role: ['admin', 'manager', 'staff', 'sales'].map((role) => ({
      role,
      count: staffPlan.filter((entry) => entry.role === role).length,
    })),
    silent_admin: staffPlan.find((entry) => entry.silent)?.email ?? null,
    roster_positions: [
      ...new Set(employeeRows.map((row) => row.position).filter(Boolean)),
    ].map((position) => ({
      position,
      role: staffRoleFor({
        email: '',
        position,
        silentAdminEmail: SILENT_ADMIN_EMAIL,
      }),
    })),
  };

  const examples = records
    .filter((record) => record.bucket === 'ready')
    .slice(0, 5)
    .map((record) => ({
      source_row: record.source_row,
      source_key: record.source_key,
      entity: {
        properties: record.mapped.property,
        property_addresses: [
          {
            format: 'legacy',
            ...record.mapped.address,
            mapping_status: 'unresolved',
            is_primary: true,
          },
          record.address_detail.target
            ? {
                format: 'current',
                address_text: currentAddressText(
                  record.mapped.address,
                  record.address_detail.target[0],
                ),
                house_number: record.mapped.address.house_number,
                street: record.mapped.address.street,
                province_unit_code:
                  record.address_detail.target[0].provinceCode,
                province_name: record.address_detail.target[0].provinceName,
                commune_unit_code: record.address_detail.target[0].code,
                commune_name: record.address_detail.target[0].name,
                mapping_status: 'candidate',
                effective_on: '2025-07-01',
                evidence: record.address_detail.evidence,
                is_primary: true,
              }
            : null,
        ].filter(Boolean),
        contacts: record.mapped.contact,
        property_source_map: {
          source_system: 'appsheet_google_sheet',
          source_key: record.source_key,
          evidence: `spreadsheet ${options.spreadsheetId} sheet "${masterTitle}" row ${record.source_row}`,
        },
      },
    }));

  const report = {
    generated_at: new Date().toISOString(),
    spreadsheet_id: options.spreadsheetId,
    spreadsheet_title: sheet.title,
    drive_folder_id: options.folderId,
    service_account: credentials.client_email,
    digest,
    out_dir: options.out,
    counts,
    prices,
    statuses,
    samples,
    contacts: contactStats,
    staff,
    issues: [...issueCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([issue, rows]) => ({ issue, rows })),
    columns: columnReport(headers),
    write_outcome: { state: 'dry_run', reason: null },
    addresses: {
      outcomes: addressOutcomes,
      sources: [...sources.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([source, rows]) => ({ source, rows })),
      vietmap: { ...vietmap.stats(), ...cacheSummary },
      vietmap_statuses: [...vietmapStatuses.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([status, rows]) => ({ status, rows })),
      disagreements,
      disagreement_rows: records.filter((record) =>
        record.issues.includes('address_source_disagreement'),
      ).length,
      converted_rows: convertedRows,
      refused_rows: refusedRows,
      refused_examples: refusedExamples,
      unresolved_units: [...unresolvedUnits.entries()]
        .sort((a, b) => b[1].rows - a[1].rows)
        .slice(0, 25)
        .map(([key, entry]) => ({
          key,
          rows: entry.rows,
          status: entry.status,
          vietmap: entry.vietmap,
        })),
      split_units: [...splitUnits.entries()]
        .sort((a, b) => b[1].rows - a[1].rows)
        .slice(0, 20)
        .map(([key, entry]) => ({
          key,
          rows: entry.rows,
          targets: entry.targets.join(', '),
        })),
      catalogue_source: catalogue.source,
      crosswalk_note:
        'public.admin_unit_crosswalks carries no reviewed rows and public.admin_unit_versions seeds no district level, so the fallback mapping is the published official three-tier to two-tier conversion, matched by legacy ward code. Once reviewed crosswalk rows exist they take this fallback role.',
    },
    duplicates,
    attachments,
    children: children.tabs,
    dropped_tabs: children.dropped,
    staff_plan: staffCounts,
    excluded: sheet.excluded,
    skipped_tabs: sheet.skipped,
    examples,
  };

  if (!options.write) {
    writeReport(report, options.out);
    printSummary(report);
    return { code: 0, report };
  }

  const refuse = (reason) => {
    console.error(`Write refused: ${reason}`);
    report.write_outcome = { state: 'refused', reason };
    report.columns = columnReport(headers, {
      write: writeOutcome(report).rosterResolved,
    });
    writeReport(report, options.out);
    printSummary(report);
    return { code: 2, report };
  };

  const confirmationPath = options.confirm;
  const confirmation =
    confirmationPath && existsSync(confirmationPath)
      ? JSON.parse(readFileSync(confirmationPath, 'utf8'))
      : null;
  const problems = confirmationProblems(confirmation, { digest });
  if (problems.length) return refuse(problems.join('; '));

  const databaseUrl = process.env.IMPORT_DATABASE_URL;
  if (!databaseUrl)
    return refuse(
      'IMPORT_DATABASE_URL is not set, so there is no administrative import connection',
    );

  try {
    assertWriteTarget(databaseUrl, process.env);
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }

  let run;
  try {
    run = await writeProject({
      databaseUrl,
      digest,
      masterTitle,
      spreadsheetId: options.spreadsheetId,
      sheetTitle: sheet.title,
      records,
      children,
      staffPlan,
      employeeRows,
      drive,
      driveToken: token,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`Write failed: ${reason}`);
    report.write_outcome = { state: 'failed', reason };
    report.columns = columnReport(headers, {
      write: writeOutcome(report).rosterResolved,
    });
    writeReport(report, options.out);
    printSummary(report);
    return { code: 1, report };
  }
  report.write = run;
  report.write_outcome = { state: 'completed', reason: null };
  report.columns = columnReport(headers, {
    write: writeOutcome(report).rosterResolved,
  });
  writeReport(report, options.out);
  printSummary(report);
  return { code: 0, report, write: run };
}

// The attestation the upload completion checks is signed with the stage key the database itself
// holds, so the signature is the same one the trusted server produces. The value is never logged.
async function validationKey(db) {
  const configured = process.env.SGN_FILE_VALIDATION_KEY?.trim();
  if (configured) return configured;
  const { rows } = await db.query(
    'select key_hex from private.file_validation_keys where id = 1',
  );
  if (!rows[0]?.key_hex)
    throw new Error('no file validation key is configured for this project');
  return rows[0].key_hex;
}

function importPassword() {
  // A strong password for the silent admin: the password policy wants length, both cases, a
  // digit and a symbol. It is written to the captain's private file and never printed or logged.
  return `${randomBytes(24).toString('base64url')}aA1!`;
}

// A resumed run reuses the password it already wrote, so the private file and the account it
// describes never disagree.
function storedManagerPassword() {
  if (!existsSync(MANAGER_ACCOUNT_FILE)) return null;
  const match = readFileSync(MANAGER_ACCOUNT_FILE, 'utf8').match(
    /^SGN_MANAGER_PASSWORD=(.+)$/m,
  );
  return match ? match[1].trim() : null;
}

// One statement per chunk: the link to the project is slow enough that a row-at-a-time loop
// would spend hours waiting on round trips.
async function stageRows(db, batchId, sheet, rows, chunkSize = 200) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const params = [];
    const tuples = chunk.map((row) => {
      for (const value of [
        batchId,
        sheet,
        row.source_row,
        row.source_id ?? row.source_key ?? null,
        JSON.stringify(row.payload),
        row.issues ?? [],
        row.disposition,
      ])
        params.push(value);
      const base = params.length - 7;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`;
    });
    await db.query({
      text: `insert into private.staging_rows (batch_id, sheet, source_row, source_id, payload, issues, disposition)
          values ${tuples.join(',')}
          on conflict (batch_id, sheet, source_row) do update
            set source_id = excluded.source_id, payload = excluded.payload,
                issues = excluded.issues, disposition = excluded.disposition
            where private.staging_rows.disposition <> 'promoted'`,
      values: params,
    });
  }
}

async function linkChildRows(db, batchId, sheet, links) {
  const linked = links.filter((link) => link.entity_id);
  const ignored = links.filter((link) => !link.entity_id);
  for (let index = 0; index < linked.length; index += 250) {
    const chunk = linked.slice(index, index + 250);
    const params = [];
    const tuples = chunk.map((link) => {
      for (const value of [
        batchId,
        sheet,
        link.source_row,
        link.entity_table,
        link.entity_id,
      ])
        params.push(value);
      const base = params.length - 5;
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5})`;
    });
    await db.query({
      text: `insert into private.import_entity_map (batch_id, sheet, source_row, entity_table, entity_id)
        values ${tuples.join(',')}
        on conflict (batch_id, sheet, source_row, entity_table) do nothing`,
      values: params,
    });
  }
  for (let index = 0; index < linked.length; index += 500) {
    const chunk = linked.slice(index, index + 500);
    await db.query(
      `update private.staging_rows set disposition = 'promoted'
        where batch_id = $1 and sheet = $2 and source_row = any($3::int[])`,
      [batchId, sheet, chunk.map((link) => link.source_row)],
    );
  }
  const byReason = new Map();
  for (const link of ignored) {
    const reason = link.reason;
    byReason.set(reason, [...(byReason.get(reason) ?? []), link.source_row]);
  }
  for (const [reason, sourceRows] of byReason)
    for (let index = 0; index < sourceRows.length; index += 500)
      await db.query(
        `update private.staging_rows set disposition = 'ignored', issues = array[$3]
          where batch_id = $1 and sheet = $2 and source_row = any($4::int[])`,
        [batchId, sheet, reason, sourceRows.slice(index, index + 500)],
      );
}

/**
 * The write run, phase by phase. Every phase is idempotent on its source key, so an interrupted
 * run continues by running it again: the batch, its staging rows and the source map decide what
 * is already done, and no phase duplicates a row.
 */
async function writeProject({
  databaseUrl,
  digest,
  masterTitle,
  spreadsheetId,
  sheetTitle,
  records,
  children,
  staffPlan,
  employeeRows,
  drive,
  driveToken,
}) {
  assertWriteTarget(databaseUrl, process.env);
  const db = await connect(databaseUrl);
  const log = (line) => console.log(line);
  try {
    const batch = await openBatch(db, {
      digest,
      filename: `${sheetTitle} (${spreadsheetId})`,
    });
    log(`batch ${batch.id} opened (${batch.status})`);
    await stageRows(
      db,
      batch.id,
      masterTitle,
      records.map((record) => ({
        source_row: record.source_row,
        source_key: record.source_key,
        payload: record.mapped,
        issues: record.issues ?? [],
        disposition: importableBucket(record.bucket)
          ? 'pending'
          : record.bucket === 'empty'
            ? 'ignored'
            : 'quarantined',
      })),
    );
    await stageRows(
      db,
      batch.id,
      'historical',
      children.rows.historical.map((row) => ({
        source_row: row.source_row,
        source_id: row.legacy_id,
        payload: row.payload,
        disposition: 'pending',
      })),
    );
    await stageRows(
      db,
      batch.id,
      'attachments',
      children.rows.attachments.map((row) => ({
        source_row: row.source_row,
        source_id: row.legacy_id,
        payload: row.payload,
        disposition: 'pending',
      })),
    );
    log(
      `staged ${records.length} master rows, ${children.rows.historical.length} historical rows, ${children.rows.attachments.length} attachment rows`,
    );

    // The roster rows carry the positions, so the role is decided from them, never rebuilt from
    // an already-summarised plan.
    const staff = planStaffAccounts({
      masterEmails: staffPlan
        .filter((entry) => entry.source === 'master_email')
        .map((entry) => entry.email),
      employeeRows,
      silentAdminEmail: SILENT_ADMIN_EMAIL,
    });
    const silentAdmin = staff.find((entry) => entry.silent) ?? null;
    const password = silentAdmin
      ? process.env.SGN_MANAGER_PASSWORD?.trim() ||
        storedManagerPassword() ||
        importPassword()
      : null;
    let account = null;
    if (silentAdmin) {
      account = await provisionSilentAdmin(db, {
        staff: silentAdmin,
        password,
        log,
      });
      writeFileSync(
        MANAGER_ACCOUNT_FILE,
        [
          "# The captain's SGN-Inventory admin account, created by the legacy import.",
          '# Mode 0600: never commit, never print. Rotate from the app if it is ever shared.',
          `SGN_MANAGER_EMAIL=${silentAdmin.email}`,
          `SGN_MANAGER_PASSWORD=${password}`,
          `SGN_MANAGER_EMPLOYEE_ID=${account.id}`,
          '',
        ].join('\n'),
        { mode: 0o600 },
      );
      chmodSync(MANAGER_ACCOUNT_FILE, 0o600);
    }
    const invitations = await beginInvitations(db, {
      staff,
      actorEmail: silentAdmin?.email,
      actorPassword: password,
      log,
    });
    const employeesByEmail = new Map(
      (
        await db.query('select id, lower(email) as email from public.employees')
      ).rows.map((row) => [row.email, row.id]),
    );

    const properties = await importProperties(db, {
      batchId: batch.id,
      sheet: masterTitle,
      records,
      spreadsheetId,
      employeesByEmail,
      contactKey,
      log,
    });
    // The source map is the record of which property each source key became, so a resumed run
    // that wrote nothing itself still resolves the child tabs against the right properties.
    const { rows: mapped } = await db.query(
      'select source_key, property_id from private.property_source_map',
    );
    const propertyIdByKey = new Map(
      mapped.map((row) => [row.source_key, row.property_id]),
    );
    await linkChildRows(
      db,
      batch.id,
      'historical',
      children.rows.historical.map((row) => {
        const propertyId = propertyIdByKey.get(row.property_key) ?? null;
        return {
          source_row: row.source_row,
          entity_table: 'properties',
          entity_id: propertyId,
          reason: propertyId ? null : 'property_not_imported',
        };
      }),
    );

    const plan = planAttachmentImport({
      rows: children.rows.attachments,
      propertiesByKey: propertyIdByKey,
      driveFiles: driveFileIndex(drive),
    });
    await linkChildRows(
      db,
      batch.id,
      'attachments',
      plan.dropped_rows.map((row) => ({
        source_row: row.source_row,
        entity_table: 'property_files',
        entity_id: null,
        reason: row.reason,
      })),
    );
    const stored = await importAttachments(db, {
      plan: plan.plan,
      driveToken,
      actorAuthUserId: account?.auth_user_id ?? null,
      actorEmployeeId: account?.id ?? null,
      validationKeyHex: await validationKey(db),
      r2: {
        accountId: process.env.R2_ACCOUNT_ID,
        bucket: process.env.R2_BUCKET,
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      log,
    });
    const resultByRow = new Map(
      stored.results.map((entry) => [entry.source_row, entry]),
    );
    await linkChildRows(
      db,
      batch.id,
      'attachments',
      plan.plan.map((row) => {
        const result = resultByRow.get(row.source_row);
        const kept =
          result?.outcome === 'stored' || result?.outcome === 'already_ready';
        return {
          source_row: row.source_row,
          entity_table: 'property_files',
          entity_id: kept ? result.file_id : null,
          reason: kept ? null : (result?.outcome ?? 'not_attempted'),
        };
      }),
    );

    const sends = await sendInvitations({
      invitations,
      actorId: employeesByEmail.get(silentAdmin?.email) ?? null,
      waitSeconds: Number(process.env.SGN_INVITE_WAIT_SECONDS ?? 300),
      log,
    });

    const verification = await verifyImport(db, {
      batchId: batch.id,
      sheet: masterTitle,
    });
    await db.query(
      `update private.import_batches set status = 'promoted' where id = $1`,
      [batch.id],
    );
    return {
      batch_id: batch.id,
      batch_status: 'promoted',
      staff: {
        addresses: staff.length,
        silent_admin: silentAdmin?.email ?? null,
        manager_account_file: silentAdmin ? MANAGER_ACCOUNT_FILE : null,
        invitations: {
          stated: invitations.filter((entry) => entry.stated).length,
          refused: invitations.filter((entry) => !entry.stated).length,
          recorded: recordedInvitations(sends),
          outcomes: outcomesBy(sends),
          refusals: invitations
            .filter((entry) => !entry.stated)
            .map((entry) => ({ email: entry.email, detail: entry.detail })),
          failures: sends
            .filter((entry) => !entry.recorded || entry.outcome !== 'accepted')
            .map((entry) => ({
              email: entry.email,
              outcome: entry.outcome,
              detail: entry.detail,
            })),
        },
      },
      properties,
      attachments: {
        planned: plan.plan.length,
        dropped: plan.dropped,
        outcomes: stored.outcomes,
        failed: stored.results
          .filter(
            (entry) =>
              entry.outcome !== 'stored' && entry.outcome !== 'already_ready',
          )
          .map((entry) => ({
            legacy_id: entry.legacy_id,
            url: entry.url,
            outcome: entry.outcome,
            detail: entry.detail ?? null,
          })),
      },
      verification,
    };
  } finally {
    await db.end();
  }
}

function outcomesBy(entries) {
  const counts = new Map();
  for (const entry of entries)
    counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
  return [...counts.entries()].map(([outcome, count]) => ({ outcome, count }));
}

function detailOf(address) {
  if (!address) return '';
  const parts = [];
  if (address.vietmap_status) parts.push(`VietMap: ${address.vietmap_status}`);
  if (address.legacy_status)
    parts.push(`official mapping: ${address.legacy_status}`);
  if (address.candidates?.length)
    parts.push(`candidates ${address.candidates.join(', ')}`);
  return parts.join('; ');
}

function driveFileIndex(drive) {
  const files = new Map();
  for (const file of drive.loose) files.set(file.relativePath, file);
  for (const folder of drive.folders)
    for (const file of folder.files) files.set(file.relativePath, file);
  return files;
}

function driveFolderStats(drive) {
  const stats = drive.folders.map((folder) => ({
    name: folder.name,
    files: folder.files.length,
    mib: Number(
      (
        folder.files.reduce(
          (total, file) => total + Number(file.size ?? 0),
          0,
        ) / 1048576
      ).toFixed(1),
    ),
  }));
  if (drive.loose.length)
    stats.push({
      name: '(folder root, not a subfolder)',
      files: drive.loose.length,
      mib: Number(
        (
          drive.loose.reduce(
            (total, file) => total + Number(file.size ?? 0),
            0,
          ) / 1048576
        ).toFixed(1),
      ),
    });
  return stats;
}

/**
 * Child rows the captain accepts, joined on an exact master key only. The `BDS-N` row-number
 * hypothesis was disproved against this sheet (0.3% owner/phone agreement), so a row without an
 * exact PropertyID is dropped and counted by reason, never guessed.
 */
const CHILD_TABS = [
  { aliasKey: 'historical', column: 'Dự án' },
  { aliasKey: 'attachments', column: 'PropertyID' },
];

/** Tabs the captain excluded, kept in the report so nobody later wonders where their rows went. */
const DROPPED_TABS = [
  {
    aliasKey: 'contracts',
    reason:
      'zero exact PropertyID matches; every reference is a BDS id and the row-number hypothesis is disproved',
  },
  {
    aliasKey: 'clicks',
    reason:
      'excluded by captain decision; page views are not imported, counted as pending or reported as work by this run',
  },
];

function childRow(aliasKey, { row, headers, sourceRow, propertyKey }) {
  const record = {};
  for (const [position, header] of headers.entries())
    if (header) record[header] = text(row?.[position]);
  if (aliasKey === 'attachments')
    return {
      source_row: sourceRow,
      legacy_id: record.attachmentID || null,
      property_key: propertyKey,
      url: (record.URL ?? '').replace(/^\/+/, ''),
      modified_on: record['Modified date'] || null,
      payload: record,
    };
  return {
    source_row: sourceRow,
    legacy_id: record.History_ID || null,
    property_key: propertyKey,
    payload: record,
  };
}

function planChildren({ tabs, masterByKey }) {
  const plan = {
    tabs: [],
    dropped: DROPPED_TABS.map((entry) => {
      const title = pickTab(tabs, entry.aliasKey);
      const rows = title ? tabs.get(title) : [];
      return {
        tab: title ?? entry.aliasKey,
        rows: rows.slice(1).filter((row) => row.some((cell) => text(cell)))
          .length,
        reason: entry.reason,
      };
    }),
    rows: { historical: [], attachments: [] },
  };
  for (const { aliasKey, column } of CHILD_TABS) {
    const title = pickTab(tabs, aliasKey);
    if (!title) continue;
    const rows = tabs.get(title);
    const headers = (rows[0] ?? []).map(text);
    const position = headers.indexOf(column);
    const counts = { rows: 0, direct_key: 0, unmatched: 0, empty_key: 0 };
    for (const [offset, row] of rows.slice(1).entries()) {
      if (!row.some((cell) => text(cell))) continue;
      counts.rows += 1;
      const outcome = classifyChildReference(
        position >= 0 ? row[position] : '',
        masterByKey,
      );
      if (outcome.kind !== 'direct_key') {
        counts[outcome.kind] += 1;
        continue;
      }
      counts.direct_key += 1;
      plan.rows[aliasKey].push(
        childRow(aliasKey, {
          row,
          headers,
          sourceRow: offset + 2,
          propertyKey: outcome.propertyKey,
        }),
      );
    }
    plan.tabs.push({ tab: title, column, ...counts });
  }
  return plan;
}

function writeReport(report, outDir) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(outDir, 'report.md'), `${renderReport(report)}\n`);
}

function printSummary(report) {
  const outcome = writeOutcome(report);
  console.log(`Snapshot ${report.digest}`);
  console.log(
    `write=${outcome.state}${outcome.reason ? ` (${outcome.reason})` : ''}`,
  );
  console.log(
    `rows=${report.counts.total_rows} ready=${report.counts.ready_rows} review=${report.counts.review_rows} quarantined=${report.counts.quarantined_rows} empty=${report.counts.empty_rows}`,
  );
  console.log(
    `addresses converted=${report.addresses.converted_rows} refused=${report.addresses.refused_rows}`,
  );
  if (report.statuses?.rows) {
    console.log(
      `status quarantined=${report.statuses.rows} values=${report.statuses.values.map((entry) => `${entry.value || '(empty)'} x${entry.rows}`).join(', ')}`,
    );
    for (const row of report.statuses.samples.slice(0, 5))
      console.log(
        `status quarantined: source row ${row.source_row} ${row.source_key} "${row.status_raw ?? ''}"`,
      );
  }
  console.log(
    `attachments importable=${report.attachments.matched_files} dropped=${report.attachments.dropped.reduce((total, entry) => total + entry.count, 0)}`,
  );
  if (report.write)
    console.log(
      `written properties=${report.write.verification.counts.properties} files=${report.write.verification.counts.files} invitations-recorded-this-run=${report.write.staff.invitations.recorded} project-recorded-invitations=${report.write.verification.counts.invitations_recorded}`,
    );
  const skippedAddresses =
    report.write?.properties?.addresses?.converted_skipped ?? [];
  if (skippedAddresses.length) {
    const skipped = convertedSkipped(skippedAddresses);
    console.log(
      `addresses converted but kept legacy-only=${skipped.rows} missing-units=${skipped.codes
        .slice(0, 10)
        .map((entry) => `${entry.code} x${entry.rows}`)
        .join(
          ', ',
        )}${skipped.codes.length > 10 ? ` and ${skipped.codes.length - 10} more` : ''}`,
    );
    for (const row of skippedAddresses.slice(0, 5))
      console.log(
        `addresses converted but kept legacy-only: source row ${row.source_row} ${row.source_key} ${row.province_code}/${row.commune_code}`,
      );
  }
  console.log(`report: ${join(report.out_dir, 'report.md')}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  run(process.argv.slice(2)).then(
    ({ code }) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
