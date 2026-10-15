// Issue #37 hosted acceptance: explicit original inventory entry dates and chronological
// inventory age views.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and real
// Chrome sessions. Mock, shim and readiness-page results are not acceptance. The run creates
// isolated synthetic SGN37 identities and property fixtures covering different dates, a date
// tie, a reliable old legacy date, an explicit unknown, a relisted recent update and ineligible
// statuses, exercises the delivered read journey against them, and removes every created row by
// exact ID through the owner capability.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_OPERATOR=<private owner SQL config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node --env-file-if-exists=.env.local scripts/inventory-age-acceptance.mjs \
//     [--report <sanitized json path>]
//
// Requires an existing production build for the head under test (`npm run build`); the harness
// starts `next start` and never rebuilds, so the rendered markup matches the reviewed commit.
// The dev env supplies the publishable application settings; the owner config supplies the
// owner capability and the operator config the owner SQL connection. All are read as data only
// and are never printed; connection strings are redacted from any surfaced diagnostic.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

const devEnvPath = process.env.SGN_ACCEPTANCE_DEV_ENV;
const ownerPath = process.env.SGN_ACCEPTANCE_OWNER;
const operatorPath = process.env.SGN_ACCEPTANCE_OPERATOR;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const browserCli =
  process.env.SGN_ACCEPTANCE_BROWSER_CLI ??
  path.join(process.env.HOME ?? '', '.local/bin/chrome-devtools-axi');
const chromeBin =
  process.env.SGN_ACCEPTANCE_CHROME ??
  path.join(
    process.env.HOME ?? '',
    '.cache/ms-playwright/chromium-1234/chrome-linux64/chrome',
  );
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3104);
const root = path.resolve(import.meta.dirname, '..');
const reportIndex = process.argv.indexOf('--report');
const reportPath =
  reportIndex >= 0
    ? process.argv[reportIndex + 1]
    : path.join(workdir ?? '.', 'inventory-age-acceptance-report.json');

if (process.argv.includes('--help')) {
  console.log(
    'Hosted acceptance for inventory age and chronological ordering. Requires SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER, SGN_ACCEPTANCE_OPERATOR and SGN_ACCEPTANCE_WORKDIR, plus an existing production build.',
  );
  process.exit(0);
}
assert.ok(
  devEnvPath && ownerPath && operatorPath && workdir,
  'Provide SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER, SGN_ACCEPTANCE_OPERATOR and SGN_ACCEPTANCE_WORKDIR',
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
const operator = JSON.parse(await fs.readFile(operatorPath, 'utf8'));
assert.equal(devEnv.SGN_ENV, 'dev', 'Acceptance must never target production');
assert.equal(
  typeof owner.authAdminKey,
  'string',
  'The owner config must supply the owner capability',
);
assert.equal(
  typeof operator.dbUrl,
  'string',
  'The operator config must supply an owner SQL connection',
);
const projectRef = devEnv.EXPECTED_SUPABASE_PROJECT_REF;
const environment = readEnvironment(
  { ...devEnv, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}` },
  projectRef,
);
const appUrl = environment.appUrl;
await fs.mkdir(workdir, { recursive: true });

const admin = createClient(environment.supabaseUrl, owner.authAdminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Fixture rows are created and removed through the owner capability. The CLI rejects an
// unencoded password, so the userinfo is percent-encoded; when the direct host is unreachable
// (the development project resolves to IPv6 only), the authenticated CLI Management API query
// channel runs the same owner SQL. Connection strings never reach a log.
const redactConnection = (text) =>
  String(text).replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-db-url>');
function encodedDirectUrl(raw) {
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd < 0) return raw;
  const rest = raw.slice(schemeEnd + 3);
  const lastAt = rest.lastIndexOf('@');
  if (lastAt < 0) return raw;
  const userinfo = rest.slice(0, lastAt);
  const colon = userinfo.indexOf(':');
  const username = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  const password = colon >= 0 ? userinfo.slice(colon + 1) : '';
  return `${raw.slice(0, schemeEnd + 3)}${encodeURIComponent(username)}:${encodeURIComponent(password)}@${rest.slice(lastAt + 1)}`;
}
let operatorChannel = 'direct';
function operatorSql(statement) {
  const args =
    operatorChannel === 'linked'
      ? [
          'supabase',
          'db',
          'query',
          '--linked',
          '--project-ref',
          projectRef,
          '--output-format',
          'json',
          statement,
        ]
      : [
          'supabase',
          'db',
          'query',
          '--db-url',
          encodedDirectUrl(operator.dbUrl),
          '--output-format',
          'json',
          statement,
        ];
  const result = spawnSync('npx', args, { encoding: 'utf8', timeout: 180000 });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    if (
      operatorChannel === 'direct' &&
      /DbConnectError|DbConfigParseUrlError|failed to connect|failed to parse connection string/i.test(
        diagnostic,
      )
    ) {
      console.log(
        'INFO owner SQL direct connection unavailable; using the linked Management API channel',
      );
      operatorChannel = 'linked';
      return operatorSql(statement);
    }
    throw new Error(
      `Owner SQL failed: ${redactConnection(diagnostic).slice(-800)}`,
    );
  }
  try {
    return JSON.parse(result.stdout).rows ?? [];
  } catch {
    return [];
  }
}

const observations = [];
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Flaky transport steps are retried and counted, then disclosed; assertions are never retried.
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
// Employee lifecycle, sign-in link and role writes are guarded against client roles on the
// development target, so fixture activation changes run through the owner SQL channel.
async function updateEmployee(id, patch) {
  const assignments = Object.entries(patch)
    .map(([column, value]) =>
      typeof value === 'boolean'
        ? `${column}=${value}`
        : `${column}='${value}'`,
    )
    .join(',');
  const changed = operatorSql(
    `update public.employees set ${assignments} where id='${id}' returning id`,
  );
  assert.equal(changed.length, 1, 'employee-update');
  return { error: null };
}
async function countRows(table) {
  const { count, error } = await retryResult(`count ${table}`, () =>
    admin.from(table).select('*', { count: 'exact', head: true }),
  );
  assert.equal(error, null, `count ${table}`);
  return count;
}
async function idHash(table) {
  const ids = [];
  for (let from = 0; ; from += 1000) {
    const page = await retryResult(`hash ${table}`, () =>
      admin
        .from(table)
        .select('id')
        .order('id')
        .range(from, from + 999),
    );
    assert.equal(page.error, null, `hash ${table}`);
    ids.push(...(page.data ?? []).map((row) => row.id));
    if ((page.data ?? []).length < 1000) break;
  }
  return createHash('sha256').update(ids.join(',')).digest('hex');
}
function vietnamToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
function dayNumber(value) {
  return Date.parse(`${value}T00:00:00Z`) / 86400000;
}
function vietnamDateLabel(value) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00+07:00`));
}
function integerLabel(value, locale) {
  return new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-GB').format(
    value,
  );
}

// ------------------------------------------------------------------ fixtures
// The journey uses isolated synthetic identities and property fixtures so the required
// chronology variety is genuinely present, then removes every created row by exact ID.
const namespace = 'SGN37';
const identities = [
  ['sales', 'sales', true],
  ['inactive', 'sales', false],
];
const manifestPath = path.join(workdir, 'fixtures.json');
const unlinkedEmail = `${namespace.toLowerCase()}.unlinked@example.test`;
const identityEmails = [
  ...identities.map(
    ([name]) => `${namespace.toLowerCase()}.${name.toLowerCase()}@example.test`,
  ),
  unlinkedEmail,
];
function fixturePlan() {
  const today = dayNumber(vietnamToday());
  const recent = new Date((today - 3) * 86400000).toISOString().slice(0, 10);
  return [
    [
      'oldLegacy',
      `SGN37-OLD-${runStamp}`,
      '2019-03-15',
      'legacy',
      'available',
      false,
    ],
    [
      'tieA',
      `SGN37-TIE-A-${runStamp}`,
      '2025-06-01',
      'recorded',
      'available',
      false,
    ],
    [
      'tieB',
      `SGN37-TIE-B-${runStamp}`,
      '2025-06-01',
      'recorded',
      'available',
      false,
    ],
    [
      'recent',
      `SGN37-RECENT-${runStamp}`,
      recent,
      'recorded',
      'available',
      false,
    ],
    [
      'negotiating',
      `SGN37-NEG-${runStamp}`,
      '2024-05-05',
      'legacy',
      'negotiating',
      false,
    ],
    ['unknown', `SGN37-UNK-${runStamp}`, null, 'unknown', 'available', false],
    [
      'soldOut',
      `SGN37-SOLD-${runStamp}`,
      '2018-01-01',
      'legacy',
      'sold',
      false,
    ],
    [
      'draftOut',
      `SGN37-DRAFT-${runStamp}`,
      '2018-02-01',
      'legacy',
      'draft',
      false,
    ],
    [
      'withdrawnOut',
      `SGN37-WDR-${runStamp}`,
      '2018-03-01',
      'legacy',
      'withdrawn',
      false,
    ],
    [
      'archivedOut',
      `SGN37-ARC-${runStamp}`,
      '2018-04-01',
      'legacy',
      'available',
      true,
    ],
  ].map(([key, code, entryOn, entrySource, status, archived]) => ({
    key,
    code,
    entryOn,
    entrySource,
    status,
    archived,
    id: randomUUID(),
  }));
}
function writeManifest(manifest) {
  return fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
}
async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}
async function removeFixtures(manifest) {
  const propertyIds = (manifest?.properties ?? [])
    .map((property) => property.id)
    .filter(Boolean);
  if (propertyIds.length)
    operatorSql(
      `delete from public.properties where id in (${propertyIds
        .map((id) => `'${id}'`)
        .join(',')})`,
    );
  const fixtures = Object.values(manifest?.identities ?? {});
  const employeeIds = fixtures
    .map((identity) => identity.employeeId)
    .filter(Boolean);
  if (employeeIds.length) {
    const events = await retryResult('remove fixture activity', () =>
      admin.from('activity_events').delete().in('employee_id', employeeIds),
    );
    assert.equal(events.error, null, 'remove fixture activity');
  }
  const emails = [
    ...new Set(
      [
        ...fixtures.map((identity) => identity.email),
        ...(manifest?.unlinked?.email ? [manifest.unlinked.email] : []),
        ...identityEmails,
      ].filter(Boolean),
    ),
  ];
  if (employeeIds.length)
    operatorSql(
      `delete from public.employees where id in (${employeeIds
        .map((id) => `'${id}'`)
        .join(',')})`,
    );
  if (emails.length)
    operatorSql(
      `delete from public.employees where email in (${emails
        .map((email) => `'${email}'`)
        .join(',')})`,
    );
  const userIds = new Set(
    [
      ...fixtures.map((identity) => identity.userId),
      manifest?.unlinked?.userId,
    ].filter(Boolean),
  );
  for (let page = 1; ; page++) {
    const listed = await retryResult('list fixture auth users', () =>
      admin.auth.admin.listUsers({ page, perPage: 1000 }),
    );
    assert.equal(listed.error, null, 'list fixture auth users');
    for (const user of listed.data.users)
      if (user.email && emails.includes(user.email)) userIds.add(user.id);
    if (listed.data.users.length < 1000) break;
  }
  for (const userId of userIds) {
    const removed = await retryThrown('remove fixture auth user', () =>
      admin.auth.admin.deleteUser(userId),
    ).catch((error) => ({ error }));
    // An identity an earlier interrupted run already removed is not a failure.
    if (removed.error && !/not found/i.test(removed.error.message))
      assert.fail(`remove fixture auth user: ${removed.error.message}`);
  }
}
async function createFixtures() {
  const manifest = {
    namespace,
    identities: {},
    unlinked: null,
    properties: fixturePlan(),
  };
  await writeManifest(manifest);
  for (const [name, role, active] of identities) {
    const email = `${namespace.toLowerCase()}.${name.toLowerCase()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const employeeId = randomUUID();
    manifest.identities[name] = {
      email,
      password,
      role,
      active,
      employeeId,
      userId: null,
    };
    await writeManifest(manifest);
    const created = await retryResult(`create auth user ${name}`, () =>
      admin.auth.admin.createUser({ email, password, email_confirm: true }),
    );
    assert.equal(created.error, null, `create auth user ${name}`);
    manifest.identities[name].userId = created.data.user.id;
    await writeManifest(manifest);
    const inserted = operatorSql(
      `insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ('${employeeId}','${created.data.user.id}','${email}','${namespace} ${name}','${role}',${active}) returning id`,
    );
    assert.equal(inserted[0]?.id, employeeId, `create employee ${name}`);
    await writeManifest(manifest);
  }
  const password = randomBytes(24).toString('base64url');
  manifest.unlinked = { email: unlinkedEmail, password, userId: null };
  await writeManifest(manifest);
  const created = await retryResult('create unlinked auth user', () =>
    admin.auth.admin.createUser({
      email: unlinkedEmail,
      password,
      email_confirm: true,
    }),
  );
  assert.equal(created.error, null, 'create unlinked auth user');
  manifest.unlinked.userId = created.data.user.id;
  await writeManifest(manifest);
  return manifest;
}
async function createPropertyFixtures(manifest) {
  const createdBy = manifest.identities.sales.employeeId;
  const values = manifest.properties.map((property) => {
    const entry = property.entryOn ? `date '${property.entryOn}'` : 'null';
    const archived = property.archived ? 'now()' : 'null';
    return `('${property.id}','${property.code}','sale','${property.status}','${createdBy}',${entry},'${property.entrySource}',${archived})`;
  });
  operatorSql(
    'insert into public.properties(id,property_code,listing_mode,status,created_by,entry_on,entry_source,archived_at) values ' +
      values.join(','),
  );
}

// ------------------------------------------------------------------ expected inventory
async function eligibleInventory() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const page = await retryResult(`read eligible inventory ${from}`, () =>
      admin
        .from('properties')
        .select(
          'id,property_code,status,entry_on,entry_source,archived_at,updated_at',
        )
        .is('archived_at', null)
        .in('status', ['available', 'negotiating'])
        .order('id')
        .range(from, from + 999),
    );
    assert.equal(page.error, null, 'read eligible inventory');
    rows.push(...(page.data ?? []));
    if (!page.data || page.data.length < 1000) break;
  }
  assert.ok(
    rows.length,
    'No eligible inventory exists on the development target',
  );
  const today = vietnamToday();
  return rows.map((row) => ({
    id: row.id,
    propertyCode: row.property_code,
    status: row.status,
    entryOn: row.entry_on ?? null,
    entrySource: row.entry_source,
    ageDays: row.entry_on ? dayNumber(today) - dayNumber(row.entry_on) : null,
  }));
}
function chronologicalOrder(rows, direction) {
  return [...rows].sort((left, right) => {
    const leftUnknown = left.entryOn === null;
    const rightUnknown = right.entryOn === null;
    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    if (!leftUnknown && left.entryOn !== right.entryOn)
      return direction === 'oldest'
        ? left.entryOn < right.entryOn
          ? -1
          : 1
        : left.entryOn > right.entryOn
          ? -1
          : 1;
    return direction === 'oldest'
      ? left.id < right.id
        ? -1
        : left.id > right.id
          ? 1
          : 0
      : right.id < left.id
        ? -1
        : right.id > left.id
          ? 1
          : 0;
  });
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
function anonymousClient() {
  return createClient(environment.supabaseUrl, environment.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
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
async function appLogin(email, password) {
  const response = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body: JSON.stringify({ email, password, locale: 'vi' }),
  });
  assert.equal(response.status, 200, `Application login ${response.status}`);
  const cookies = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');
  assert.ok(cookies, 'No application session cookie was issued');
  return cookies;
}
async function appGet(cookies, route) {
  const response = await fetch(appUrl + route, {
    redirect: 'manual',
    headers: cookies ? { cookie: cookies } : {},
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}
// Walk the chronological endpoint the way the browser does: one bounded page at a time,
// carrying the cursor until the read stops emitting one.
async function walkApi(cookies, direction) {
  const pages = [];
  let after = null;
  for (let guard = 0; guard < 200; guard++) {
    const route =
      `/api/properties?sort=${direction}` +
      (after ? `&after=${encodeURIComponent(after)}` : '');
    const page = await appGet(cookies, route);
    assert.equal(
      page.status,
      200,
      `inventory ${direction} page ${pages.length}`,
    );
    assert.equal(page.body?.order, direction, 'page ordering label');
    pages.push(page.body);
    if (!page.body.nextCursor) return pages;
    assert.equal(
      page.body.properties.length,
      30,
      'a cursor is emitted only from a full exposed page',
    );
    after = page.body.nextCursor;
  }
  assert.fail('Chronological walk did not terminate');
}

// ------------------------------------------------------------------ browsers
const browsers = [];
const profileDirs = [];
const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
async function startBrowser(cdpPort, timezone) {
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
    { env: { ...process.env, TZ: timezone }, stdio: 'ignore' },
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
  const diagnostic = (
    (result.stderr ?? '')
      .split('\n')
      .filter((line) => /^(error|code):/.test(line.trim()))
      .join(' | ') || (result.stdout ?? '').trim().slice(-300)
  ).slice(0, 400);
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
// The rendered chronological inventory surface: card order, the entry line each card shows,
// the ordering control, the pager and the document language.
const screenExpression = `() => {
  const cards = [...document.querySelectorAll('.property-list article.property-card')];
  const pager = [...document.querySelectorAll('.pagination .pager-btn')];
  return {
    path: location.pathname,
    search: location.search,
    lang: document.documentElement.lang,
    codes: cards.map((card) => {
      const meta = card.querySelector('.card-meta')?.textContent ?? '';
      return meta.split('·')[0].trim();
    }),
    entries: cards.map((card) =>
      (card.querySelector('.card-entry')?.textContent ?? '').replace(/\\s+/g, ' ').trim(),
    ),
    orders: [...document.querySelectorAll('.seg .seg-btn')].map((link) => ({
      label: link.textContent.trim(),
      current: link.getAttribute('aria-current') === 'true',
    })),
    pager: pager.map((link) => link.textContent.trim()),
    pageInfo: document.querySelector('.pagination .page-info')?.textContent?.trim() ?? null,
    empty: document.querySelector('.state-panel h3')?.textContent?.trim() ?? null,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
}`;
function screen(session, cdpPort) {
  let value = evaluate(session, cdpPort, screenExpression);
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth++)
    value = JSON.parse(value);
  assert.equal(typeof value, 'object', 'Unexpected browser screen payload');
  return value;
}
async function waitForInventory(session, cdpPort, attempts = 120) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = screen(session, cdpPort);
      if (last.codes.length || last.empty) return last;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.fail(`Inventory page did not load: ${JSON.stringify(last)}`);
}
function entryText(record, locale) {
  if (record.entryOn === null)
    return locale === 'vi'
      ? 'Ngày nhập kho gốc: Chưa xác định · Tuổi kho chưa xác định'
      : 'Original inventory entry date: Unknown · Inventory age unknown';
  const date = vietnamDateLabel(record.entryOn);
  const age = `${integerLabel(record.ageDays, locale)} ${
    locale === 'vi'
      ? 'ngày trong kho'
      : record.ageDays === 1
        ? 'day in inventory'
        : 'days in inventory'
  }`;
  const legacy =
    record.entrySource === 'legacy'
      ? locale === 'vi'
        ? ' (Theo hồ sơ gốc)'
        : ' (From the legacy record)'
      : '';
  return locale === 'vi'
    ? `Ngày nhập kho gốc: ${date}${legacy} · ${age}`
    : `Original inventory entry date: ${date}${legacy} · ${age}`;
}

// ------------------------------------------------------------------ run
let manifest = null;
let baseline = null;
let insertProvenanceApplied = false;
const previous = await readManifest();
await removeFixtures(previous);
await fs.rm(manifestPath, { force: true });

try {
  operatorSql('select 1 as ok');
  insertProvenanceApplied =
    operatorSql(
      "select exists (select 1 from supabase_migrations.schema_migrations where version = '20261014002006') as applied",
    )[0]?.applied === true;
  await startApp();
  baseline = {
    employees: await countRows('employees'),
    activity: await countRows('activity_events'),
    properties: await countRows('properties'),
    employeeHash: await idHash('employees'),
    activityHash: await idHash('activity_events'),
    propertyHash: await idHash('properties'),
  };
  manifest = await createFixtures();
  const fixtures = manifest.identities;
  await createPropertyFixtures(manifest);
  let inventory = await eligibleInventory();
  const byId = (id) => inventory.find((record) => record.id === id);
  const eligibleFixtures = manifest.properties.filter(
    (property) =>
      !property.archived &&
      ['available', 'negotiating'].includes(property.status),
  );
  for (const property of eligibleFixtures) {
    const record = byId(property.id);
    assert.ok(record, `fixture ${property.key} is eligible`);
    assert.equal(
      record.entryOn,
      property.entryOn,
      `fixture ${property.key} entry date`,
    );
    assert.equal(
      record.entrySource,
      property.entrySource,
      `fixture ${property.key} provenance`,
    );
  }
  for (const property of manifest.properties.filter(
    (candidate) => !eligibleFixtures.includes(candidate),
  ))
    assert.ok(
      !byId(property.id),
      `ineligible fixture ${property.key} is excluded`,
    );
  const tieCounts = new Map();
  for (const property of eligibleFixtures.filter((p) => p.entryOn))
    tieCounts.set(property.entryOn, (tieCounts.get(property.entryOn) ?? 0) + 1);
  assert.ok(
    [...tieCounts.values()].some((count) => count > 1),
    'No eligible date tie was created',
  );
  assert.ok(
    eligibleFixtures.some((property) => property.entryOn === null),
    'No explicit unknown entry date fixture was created',
  );
  assert.ok(
    eligibleFixtures.some((property) => property.entrySource === 'legacy'),
    'No reliable legacy entry date fixture was created',
  );
  const recentFixture = manifest.properties.find(
    (property) => property.key === 'recent',
  );
  const recentBefore = byId(recentFixture.id);
  const orderBefore = chronologicalOrder(inventory, 'oldest').map(
    (record) => record.id,
  );
  operatorSql(
    `update public.properties set status='withdrawn' where id='${recentFixture.id}'`,
  );
  operatorSql(
    `update public.properties set status='available',sale_price_vnd=123456789,updated_at=now() where id='${recentFixture.id}'`,
  );
  const updated = operatorSql(
    `select (updated_at > created_at) as updated, entry_on::text as entry_on, entry_source from public.properties where id='${recentFixture.id}'`,
  )[0];
  assert.equal(updated?.updated, true, 'relist update did not record');
  inventory = await eligibleInventory();
  const recentAfter = byId(recentFixture.id);
  assert.equal(
    recentAfter.entryOn,
    recentBefore.entryOn,
    'a relist must preserve the recorded entry date',
  );
  assert.equal(
    recentAfter.ageDays,
    recentBefore.ageDays,
    'a relist must preserve the inventory age',
  );
  assert.deepEqual(
    chronologicalOrder(inventory, 'oldest').map((record) => record.id),
    orderBefore,
    'a relist must preserve the chronological position',
  );
  observed(
    'a relist and price edit preserve the recorded entry date, age and position',
  );
  const oldest = chronologicalOrder(inventory, 'oldest');
  const newest = chronologicalOrder(inventory, 'newest');
  observed('development inventory carries the required chronology variety', {
    eligible: inventory.length,
    fixtureEligible: eligibleFixtures.length,
    fixtureIneligible: manifest.properties.length - eligibleFixtures.length,
    legacy: inventory.filter((record) => record.entrySource === 'legacy')
      .length,
    recorded: inventory.filter((record) => record.entrySource === 'recorded')
      .length,
    unknown: inventory.filter((record) => record.entryOn === null).length,
    tieDates: [...tieCounts.keys()].filter((date) => tieCounts.get(date) > 1)
      .length,
  });

  const salesCookies = await appLogin(
    fixtures.sales.email,
    fixtures.sales.password,
  );
  const oldestPages = await walkApi(salesCookies, 'oldest');
  const newestPages = await walkApi(salesCookies, 'newest');
  const oldestApi = oldestPages.flatMap((page) => page.properties);
  const newestApi = newestPages.flatMap((page) => page.properties);
  assert.deepEqual(
    oldestApi.map((row) => row.id),
    oldest.map((row) => row.id),
    'API oldest-first order must match the recorded eligible inventory exactly',
  );
  assert.deepEqual(
    newestApi.map((row) => row.id),
    newest.map((row) => row.id),
    'API newest-first order must match the recorded eligible inventory exactly',
  );
  for (const row of [...oldestApi, ...newestApi]) {
    const expected = inventory.find((record) => record.id === row.id);
    assert.equal(row.entryOn ?? null, expected.entryOn, 'recorded entry date');
    assert.equal(row.entrySource, expected.entrySource, 'entry provenance');
    assert.equal(
      row.ageDays ?? null,
      expected.ageDays,
      'Vietnam inventory age',
    );
  }
  assert.ok(
    oldestPages.every((page) => page.properties.length <= 30),
    'No page may expose more than 30 rows',
  );
  observed(
    'both API orderings return every eligible row once with exact dates and ages',
    {
      pages: [oldestPages.length, newestPages.length],
    },
  );

  // Direct public API boundary: denial is a refusal, never an empty list.
  const anonymous = await appGet(null, '/api/properties?sort=oldest');
  assert.equal(anonymous.status, 401, 'anonymous chronological read denial');
  const malformedSort = await appGet(
    salesCookies,
    '/api/properties?sort=bogus',
  );
  assert.equal(malformedSort.status, 400, 'invalid sort refusal');
  assert.equal(malformedSort.body?.error, 'invalid-input');
  const malformedCursor = await appGet(
    salesCookies,
    '/api/properties?sort=oldest&after=not-a-cursor',
  );
  assert.equal(malformedCursor.status, 400, 'invalid cursor refusal');
  const extraParameter = await appGet(
    salesCookies,
    '/api/properties?sort=oldest&unknown=1',
  );
  assert.equal(extraParameter.status, 400, 'unknown parameter refusal');
  observed(
    'direct public API rejects anonymous and invalid chronological input',
  );

  // Direct Data API boundary: the read RPC and every direct rewrite stay subject to the
  // session and the delivered guards.
  const anonApi = anonymousClient();
  const anonRpc = await anonApi.rpc('list_inventory_by_age', {
    p_direction: 'oldest',
  });
  assert.equal(anonRpc.error?.code, '42501', 'anonymous RPC denial');
  const salesApi = await signIn(fixtures.sales.email, fixtures.sales.password);
  const rpc = await retryResult('direct age RPC', () =>
    salesApi.rpc('list_inventory_by_age', {
      p_direction: 'oldest',
      p_limit: 31,
    }),
  );
  assert.equal(rpc.error, null, 'employee age RPC');
  assert.equal(rpc.data.length, Math.min(31, inventory.length));
  const directInsert = await retryResult('direct insert', () =>
    salesApi.from('properties').insert({
      property_code: `SGN37-DIRECT-${runStamp}`,
      listing_mode: 'sale',
      status: 'available',
    }),
  );
  assert.equal(directInsert.error?.code, '42501', 'direct insert denial');
  const directUpdate = await retryResult('direct entry update', () =>
    salesApi
      .from('properties')
      .update({ entry_on: '2020-01-01' })
      .eq('id', inventory[0].id),
  );
  assert.ok(
    ['42501', '23514'].includes(directUpdate.error?.code),
    `direct entry rewrite denial (${directUpdate.error?.code})`,
  );
  observed(
    'direct Data API keeps the age read authorized and direct rewrites denied',
  );

  // Real browser journey in Vietnamese/default.
  await startBrowser(9341, 'Asia/Ho_Chi_Minh');
  await browserSignIn(
    'sgn37-vi',
    9341,
    fixtures.sales.email,
    fixtures.sales.password,
  );
  browser('sgn37-vi', 9341, ['open', `${appUrl}/properties?sort=oldest`]);
  let view = await waitForInventory('sgn37-vi', 9341);
  assert.equal(view.lang, 'vi', 'default document language');
  assert.deepEqual(
    view.codes,
    oldest.slice(0, 30).map((record) => record.propertyCode),
    'oldest-first page one renders the exact recorded order',
  );
  assert.deepEqual(
    view.entries,
    oldest.slice(0, 30).map((record) => entryText(record, 'vi')),
    'oldest-first page one renders the exact recorded date and age',
  );
  assert.ok(
    view.orders.some(
      (order) => order.current && order.label === 'Cũ nhất trước',
    ),
    'oldest-first control is the current ordering',
  );
  observed(
    'browser oldest-first page one shows the exact date and age in Vietnamese',
  );

  // The pager is real browser pagination: every emitted Next leads to a non-empty page and the
  // final page stops linking forward. A full final page must not produce an empty terminal page.
  const walked = [...view.codes];
  let pageCount = 1;
  while (view.pager.includes('Trang tiếp')) {
    evaluate(
      'sgn37-vi',
      9341,
      `(() => { const next = [...document.querySelectorAll('.pagination .pager-btn')].find((link) => link.textContent.trim() === 'Trang tiếp'); next.click(); return true; })()`,
    );
    const before = view.codes.join(',');
    let next = null;
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(500);
      next = screen('sgn37-vi', 9341);
      if (next.codes.length && next.codes.join(',') !== before) break;
    }
    assert.ok(
      next && next.codes.length,
      'pagination must not reach an empty page',
    );
    view = next;
    pageCount++;
    walked.push(...view.codes);
    assert.ok(pageCount <= 200, 'pagination did not terminate');
  }
  assert.deepEqual(
    walked,
    oldest.map((record) => record.propertyCode),
    'browser pagination visits every eligible property exactly once',
  );
  observed(
    'browser pagination walks the exact order and never opens an empty page',
  );

  // Newest-first in the same browser session.
  evaluate(
    'sgn37-vi',
    9341,
    `(() => { const link = [...document.querySelectorAll('.seg .seg-btn')].find((node) => node.textContent.trim() === 'Mới nhất trước'); link.click(); return true; })()`,
  );
  await waitFor(
    'sgn37-vi',
    9341,
    `() => new URL(location.href).searchParams.get('sort') === 'newest'`,
  );
  view = await waitForInventory('sgn37-vi', 9341);
  assert.deepEqual(
    view.codes,
    newest.slice(0, 30).map((record) => record.propertyCode),
    'newest-first page one renders the exact reverse chronology',
  );
  assert.deepEqual(
    view.entries,
    newest.slice(0, 30).map((record) => entryText(record, 'vi')),
    'newest-first page one renders the exact recorded date and age',
  );
  observed(
    'browser newest-first page one renders the exact reverse chronology',
  );

  // Switching VI -> EN preserves the current newest-first view, filters and record facts.
  const beforeLanguage = view;
  const activityBeforeLanguage = await countRows('activity_events');
  evaluate(
    'sgn37-vi',
    9341,
    `(() => { document.querySelector('.lang-btn[lang=en]').click(); return true; })()`,
  );
  await waitFor(
    'sgn37-vi',
    9341,
    `() => document.documentElement.lang === 'en'`,
  );
  view = await waitForInventory('sgn37-vi', 9341);
  assert.equal(
    view.search,
    beforeLanguage.search,
    'language switch preserves filters',
  );
  assert.deepEqual(
    view.codes,
    beforeLanguage.codes,
    'language switch preserves the view',
  );
  assert.deepEqual(
    view.entries,
    newest.slice(0, 30).map((record) => entryText(record, 'en')),
    'English renders the equivalent date and age labels',
  );
  assert.ok(
    view.orders.some(
      (order) => order.current && order.label === 'Newest first',
    ),
    'the ordering control is localized',
  );
  assert.equal(
    await countRows('activity_events'),
    activityBeforeLanguage,
    'language switch records no activity',
  );
  observed(
    'switching to English preserves the view and localizes date and age',
  );

  // Mobile viewport and keyboard reachability.
  browser('sgn37-vi', 9341, ['resize', '375', '812']);
  await sleep(500);
  view = await waitForInventory('sgn37-vi', 9341);
  assert.equal(
    view.overflowX,
    0,
    'mobile layout must not overflow horizontally',
  );
  const reachable = evaluate(
    'sgn37-vi',
    9341,
    `(() => {
      const link = document.querySelector('.seg .seg-btn');
      link.focus();
      return {
        focused: document.activeElement === link,
        labels: [...document.querySelectorAll('.card-entry')].slice(0, 3).map((node) => node.textContent.replace(/\\s+/g, ' ').trim()),
      };
    })()`,
  );
  assert.equal(
    reachable.focused,
    true,
    'ordering control is keyboard reachable',
  );
  assert.ok(
    reachable.labels.every((label) => /inventory|Unknown/i.test(label)),
    'mobile cards keep their date and age labels',
  );
  observed(
    'mobile viewport keeps the labels, no overflow and keyboard reachable controls',
  );

  // Existing-JWT deactivation: the next read is refused and refocus clears the surface.
  await updateEmployee(fixtures.sales.employeeId, { is_active: false });
  const deactivatedApi = await appGet(
    salesCookies,
    '/api/properties?sort=oldest',
  );
  assert.equal(
    deactivatedApi.status,
    403,
    'deactivated chronological read denial',
  );
  assert.equal(deactivatedApi.body?.error, 'access-denied');
  const deactivatedRpc = await retryResult('deactivated direct age RPC', () =>
    salesApi.rpc('list_inventory_by_age', { p_direction: 'oldest' }),
  );
  assert.equal(deactivatedRpc.error?.code, '42501', 'deactivated RPC denial');
  evaluate(
    'sgn37-vi',
    9341,
    `(() => { window.dispatchEvent(new Event('focus')); return true; })()`,
  );
  let refocus = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      refocus = evaluate(
        'sgn37-vi',
        9341,
        `() => ({ path: location.pathname, cards: Boolean(document.querySelector('.property-card')), denied: /quyền truy cập|Access denied/.test(document.body.innerText) })`,
      );
      if (refocus.path === '/access-denied' || refocus.denied) break;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.ok(
    refocus?.path === '/access-denied' || refocus?.denied,
    `refocus denial not shown: ${JSON.stringify(refocus)}`,
  );
  assert.equal(
    refocus.cards ?? false,
    false,
    'denied surface exposes no inventory',
  );
  await updateEmployee(fixtures.sales.employeeId, { is_active: true });
  observed(
    'deactivation denies the next read and refocus clears the inventory surface',
  );

  // Inactive and authenticated-unlinked identities are refused in both languages.
  for (const locale of ['vi', 'en']) {
    for (const identity of [fixtures.inactive, manifest.unlinked]) {
      browser('sgn37-vi', 9341, ['open', `${appUrl}/login?lang=${locale}`]);
      evaluate('sgn37-vi', 9341, setInput('#email', identity.email));
      evaluate('sgn37-vi', 9341, setInput('#password', identity.password));
      evaluate(
        'sgn37-vi',
        9341,
        `(() => { document.querySelector('form').requestSubmit(); return true; })()`,
      );
      await waitFor(
        'sgn37-vi',
        9341,
        `() => location.pathname === '/access-denied'`,
      );
      const denied = evaluate(
        'sgn37-vi',
        9341,
        `() => ({ lang: document.documentElement.lang, heading: document.querySelector('h1')?.textContent?.trim() ?? null, cards: Boolean(document.querySelector('.property-card')) })`,
      );
      assert.equal(
        denied.heading,
        locale === 'vi' ? 'Không có quyền truy cập' : 'Access denied',
        `${locale} denial heading`,
      );
      assert.equal(denied.cards, false, 'denied surface exposes no inventory');
    }
  }
  observed(
    'inactive and unlinked identities are refused in Vietnamese/default and English',
  );

  // Sign-out clears the protected list and Back exposes none of it. The denial loop above left
  // the browser on the unlinked identity, so the sales fixture signs in again first.
  await browserSignIn(
    'sgn37-vi',
    9341,
    fixtures.sales.email,
    fixtures.sales.password,
  );
  browser('sgn37-vi', 9341, ['open', `${appUrl}/properties?sort=oldest`]);
  await waitForInventory('sgn37-vi', 9341);
  await waitFor(
    'sgn37-vi',
    9341,
    `() => Boolean(document.querySelector('.sgn-user-btn'))`,
  );
  evaluate(
    'sgn37-vi',
    9341,
    `(() => { document.querySelector('.sgn-user-btn').click(); return true; })()`,
  );
  await waitFor(
    'sgn37-vi',
    9341,
    `() => Boolean(document.querySelector('.sgn-popover button'))`,
  );
  evaluate(
    'sgn37-vi',
    9341,
    `(() => { document.querySelector('.sgn-popover button').click(); return true; })()`,
  );
  await waitFor('sgn37-vi', 9341, `() => location.pathname === '/login'`);
  evaluate('sgn37-vi', 9341, `(() => { history.back(); return true; })()`);
  await sleep(2000);
  const afterBack = evaluate(
    'sgn37-vi',
    9341,
    `() => ({ path: location.pathname, cards: Boolean(document.querySelector('.property-card')) })`,
  );
  assert.equal(afterBack.cards, false, 'sign-out clears the protected list');
  observed('sign-out clears the protected list and Back exposes none of it');
} finally {
  await stopBrowsers();
  await stopApp();
  manifest = (await readManifest()) ?? manifest;
  await removeFixtures(manifest);
  await fs.rm(manifestPath, { force: true });
  if (baseline) {
    const after = {
      employees: await countRows('employees'),
      activity: await countRows('activity_events'),
      properties: await countRows('properties'),
      employeeHash: await idHash('employees'),
      activityHash: await idHash('activity_events'),
      propertyHash: await idHash('properties'),
    };
    assert.deepEqual(
      after,
      baseline,
      'Fixture restoration did not return to baseline',
    );
    observed('fixtures removed and the pre-acceptance baseline restored', {
      employees: after.employees,
      activity: after.activity,
      properties: after.properties,
    });
  }
}

const reportDocument = {
  checked_at: new Date().toISOString(),
  project_ref: projectRef,
  namespace,
  observations: observations.map(({ name, ...rest }) => ({ name, ...rest })),
  transient_retries: retryCount,
  owner_sql_channel: operatorChannel,
  insert_provenance_migration_applied: insertProvenanceApplied,
  created: {
    identities: identities.map(([name]) => `${namespace} ${name}`),
    unlinked: 1,
    propertyFixtures: manifest?.properties?.length ?? 0,
  },
  removed: {
    identities: identities.length,
    unlinked: 1,
    propertyFixtures: manifest?.properties?.length ?? 0,
  },
  limitations: [
    retryCount
      ? `${retryCount} transient transport retries were needed for idempotent fixture/read steps; no assertion was retried.`
      : null,
    operatorChannel === 'linked'
      ? 'The supplied owner dbUrl is an unencoded direct connection on an IPv6-only host unreachable from this runner; fixture rows were created and removed through the authenticated Supabase CLI Management API query channel (db query --linked --project-ref) instead.'
      : null,
    insertProvenanceApplied
      ? null
      : 'The forward migration 20261014002006_inventory_entry_insert_provenance.sql is not applied on the development target, so the request-context insert constraint is evidenced only by npm run test:schema and not by this hosted run.',
    'Queries are embedded-PGlite regressions plus these live individual-session Auth/Data API/RLS and browser observations; no production edge or load testing.',
  ].filter(Boolean),
};
await fs.writeFile(reportPath, JSON.stringify(reportDocument, null, 2) + '\n');
console.log(`${observations.length} observations passed`);
