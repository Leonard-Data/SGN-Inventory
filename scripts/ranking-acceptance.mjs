// Issue #34 hosted acceptance: reviewer-only Employee owner-contact activity ranking.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and real
// Chrome sessions. Uses existing inventory read-only, creates only the synthetic identities and
// committed activity rows the ranking needs under an exact-ID private manifest, and removes
// exactly what it created through the supported service-role paths. Mock, shim and readiness-page
// results are not acceptance.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   [SGN_ACCEPTANCE_OPERATOR=<private operator config with the owner SQL connection>] \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node --env-file-if-exists=.env.local scripts/ranking-acceptance.mjs \
//     [--report <sanitized json path>]
//
// Requires an existing production build for the head under test (`npm run build`); the harness
// starts `next start` and never rebuilds, so the rendered markup matches the reviewed commit.
//
// The dev env supplies the publishable application settings; the owner config supplies the
// owner capability, and the owner SQL connection is read from it or from the shared operator
// config. They are read as data only and are never printed or shell sourced; the SQL
// connection string is passed to the Supabase CLI the same way the sibling hosted harnesses
// pass it, because the delivered employee-admin guard reserves lifecycle writes to that path.
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
    'Hosted acceptance for the owner-contact activity ranking. Requires SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR, plus an existing production build.',
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
const operator = operatorPath
  ? JSON.parse(await fs.readFile(operatorPath, 'utf8'))
  : null;
assert.equal(devEnv.SGN_ENV, 'dev', 'Acceptance must never target production');
assert.equal(
  typeof owner.authAdminKey,
  'string',
  'The owner config must supply the owner capability',
);
const ownerDbUrl = owner.dbUrl ?? operator?.dbUrl ?? null;
assert.ok(
  ownerDbUrl,
  'Provide the owner SQL connection as owner.dbUrl or via SGN_ACCEPTANCE_OPERATOR',
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
function sqlText(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
// The delivered employee-admin guard refuses lifecycle, sign-in-link and role writes from
// client roles, so the synthetic employee rows and their transitions use the owner SQL
// connection exactly as the sibling hosted harnesses do. The connection string is never
// printed.
function ownerSql(statement) {
  const result = spawnSync(
    path.join(root, 'node_modules/.bin/supabase'),
    [
      'db',
      'query',
      '--db-url',
      ownerDbUrl,
      '--output-format',
      'json',
      statement,
    ],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (result.status !== 0)
    assert.fail(
      `Owner SQL failed: ${(result.stdout || result.stderr).slice(-400)}`,
    );
  try {
    return JSON.parse(result.stdout).rows ?? [];
  } catch {
    return [];
  }
}
function updateEmployee(id, patch) {
  const assignments = Object.entries(patch)
    .map(([column, value]) => `${column} = ${sqlText(value)}`)
    .join(',');
  const rows = ownerSql(
    `update public.employees set ${assignments} where id = ${sqlText(id)}::uuid returning id`,
  );
  return rows.length === 1;
}
// The delivered disclosure RPC commits one owner-contact unit per employee/property/Vietnam day;
// a retry reuses the original employee-scoped key, so a lost response converges on the same row.
async function discloseOwner(client, propertyId) {
  const key = randomUUID();
  return retryResult('owner disclosure', () =>
    client.rpc('reveal_owner_contact', {
      p_property_id: propertyId,
      p_key: key,
    }),
  );
}
async function viewProperty(client, propertyId) {
  const key = randomUUID();
  return retryResult('page view', () =>
    client.rpc('record_property_activity', {
      p_property_id: propertyId,
      p_kind: 'page_view',
      p_key: key,
    }),
  );
}
async function countRows(table) {
  const { count, error } = await retryResult(`count ${table}`, () =>
    admin.from(table).select('*', { count: 'exact', head: true }),
  );
  assert.equal(error, null, `count ${table}`);
  return count;
}
async function idHash(table) {
  const { data, error } = await retryResult(`hash ${table}`, () =>
    admin.from(table).select('id').order('id'),
  );
  assert.equal(error, null, `hash ${table}`);
  return createHash('sha256')
    .update(data.map((row) => row.id).join(','))
    .digest('hex');
}

// ------------------------------------------------------------------ fixtures
const namespace = 'SGN34';
// Two sales employees whose ranked totals tie on one day, a staff employee who records nothing,
// a live manager and admin as the only authorized readers, plus inactive and authenticated
// unlinked identities for the denial gates.
const identities = [
  ['manager', 'manager', true],
  ['admin', 'admin', true],
  ['salesA', 'sales', true],
  ['salesB', 'sales', true],
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
async function removeFixtures(manifest) {
  if (!manifest) return;
  const fixtures = Object.values(manifest.identities ?? {});
  const employeeIds = fixtures.map((identity) => identity.employeeId);
  if (employeeIds.length) {
    const events = await retryResult('remove fixture activity', () =>
      admin.from('activity_events').delete().in('employee_id', employeeIds),
    );
    assert.equal(events.error, null, 'remove fixture activity');
    ownerSql(
      `delete from public.employees where id in (${employeeIds.map((id) => sqlText(id)).join(',')}) returning id`,
    );
  }
  const users = [
    ...fixtures.map((identity) => identity.userId),
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
async function createFixtures() {
  const manifest = { namespace, identities: {}, unlinked: null };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  for (const [name, role, active] of identities) {
    const email = `${namespace.toLowerCase()}.${name.toLowerCase()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const employeeId = randomUUID();
    const created = await retryResult(`create auth user ${name}`, () =>
      admin.auth.admin.createUser({ email, password, email_confirm: true }),
    );
    assert.equal(created.error, null, `create auth user ${name}`);
    const userId = created.data.user.id;
    manifest.identities[name] = {
      userId,
      employeeId,
      email,
      password,
      role,
      active,
    };
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
      mode: 0o600,
    });
    const inserted = ownerSql(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
        `(${sqlText(employeeId)}::uuid,${sqlText(userId)}::uuid,${sqlText(email)},${sqlText(`${namespace} ${name}`)},${sqlText(role)},${active}) returning id`,
    );
    assert.equal(inserted.length, 1, `create employee ${name}`);
  }
  const email = `${namespace.toLowerCase()}.unlinked@example.test`;
  const password = randomBytes(24).toString('base64url');
  const created = await retryResult('create unlinked auth user', () =>
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
  );
  assert.equal(created.error, null, 'create unlinked auth user');
  manifest.unlinked = { userId: created.data.user.id, email, password };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  return manifest;
}

// Two unarchived properties with a recorded owner that has a phone, read-only from existing
// inventory; the ranking counts the property, never the owner or its phone.
async function selectInventory() {
  const [
    { data: links, error: linkError },
    { data: contacts },
    { data: properties },
  ] = await Promise.all([
    retryResult('read property contacts', () =>
      admin.from('property_contacts').select('property_id,contact_id,relation'),
    ),
    retryResult('read contacts', () =>
      admin.from('contacts').select('id,phones'),
    ),
    retryResult('read properties', () =>
      admin.from('properties').select('id,archived_at'),
    ),
  ]);
  assert.equal(linkError, null, 'read property contacts');
  const phone = new Map(
    contacts.map((contact) => [
      contact.id,
      (contact.phones ?? []).some((value) => value.trim()),
    ]),
  );
  const archived = new Map(
    properties.map((property) => [property.id, Boolean(property.archived_at)]),
  );
  const owners = new Map();
  for (const link of links.filter((value) => value.relation === 'owner')) {
    if (!owners.has(link.property_id)) owners.set(link.property_id, []);
    owners.get(link.property_id).push(link.contact_id);
  }
  const eligible = [...owners.entries()]
    .filter(
      ([propertyId, contactIds]) =>
        !archived.get(propertyId) && contactIds.some((id) => phone.get(id)),
    )
    .map(([propertyId]) => propertyId);
  assert.ok(
    eligible.length >= 2,
    'Two unarchived owner-eligible properties are required for the ranking fixture',
  );
  return { owners: [eligible[0], eligible[1]] };
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
async function ranking(client, from, to) {
  return retryResult('ranking read', () =>
    client.rpc('employee_owner_contact_ranking', { p_from: from, p_to: to }),
  );
}
async function appLoginResponse(email, password) {
  const response = await retryThrown('application login', () =>
    fetch(`${appUrl}/api/auth/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/json', origin: appUrl },
      body: JSON.stringify({ email, password, locale: 'vi' }),
    }),
  );
  const cookies = (response.headers.getSetCookie?.() ?? [])
    .map((value) => value.split(';')[0])
    .join('; ');
  const body = await response.json().catch(() => null);
  return { status: response.status, cookies, body };
}
async function appLogin(email, password) {
  const result = await appLoginResponse(email, password);
  assert.equal(result.status, 200, `Application login ${result.status}`);
  assert.ok(result.cookies, 'No application session cookie was issued');
  return result.cookies;
}
async function appGet(cookies, route) {
  return retryThrown('application read', async () => {
    const response = await fetch(appUrl + route, {
      redirect: 'manual',
      headers: cookies ? { cookie: cookies } : {},
    });
    const body = await response.json().catch(() => null);
    return { status: response.status, body };
  });
}
// Committed rows for a controlled Vietnam day are inserted with an explicit instant and read
// back with their generated business_day, exactly as the fixtures above do.
async function insertCommitted(rows) {
  const inserted = await retryResult('insert committed activity', () =>
    admin
      .from('activity_events')
      .insert(rows)
      .select('id,business_day,occurred_at'),
  );
  assert.equal(inserted.error, null, 'insert committed activity');
  return inserted.data;
}
async function today(offsetDays = 0) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type) => parts.find((part) => part.type === type).value;
  const base = new Date(
    Date.UTC(
      Number(value('year')),
      Number(value('month')) - 1,
      Number(value('day')),
    ) +
      offsetDays * 86400000,
  );
  return base.toISOString().slice(0, 10);
}
// The eligible range total the ranking must equal: one employee/property/Vietnam-day unit each,
// counted from the committed source rows themselves and never from another report.
async function committedUnits(employeeIds, from, to) {
  const { data, error } = await retryResult('read committed activity', () =>
    admin
      .from('activity_events')
      .select('employee_id,business_day,property_id,kind')
      .in('employee_id', employeeIds)
      .gte('business_day', from)
      .lte('business_day', to),
  );
  assert.equal(error, null, 'read committed activity');
  const units = new Map(employeeIds.map((id) => [id, 0]));
  const seen = new Set();
  for (const row of data) {
    if (row.kind !== 'owner_contact_access') continue;
    const unit = `${row.employee_id}|${row.business_day}|${row.property_id}`;
    if (seen.has(unit)) continue;
    seen.add(unit);
    units.set(row.employee_id, units.get(row.employee_id) + 1);
  }
  return units;
}
// The delivered ranking RPC answers with snake_case columns while the application endpoint
// maps the same rows to camelCase, so the shared total helper reads either shape.
function totalOf(data, employeeId) {
  const row = (data ?? []).find(
    (value) =>
      value.employee_id === employeeId || value.employeeId === employeeId,
  );
  assert.ok(
    row,
    `The ranking returned no row for fixture employee ${employeeId}`,
  );
  return Number(row.owner_contact_properties ?? row.ownerContactProperties);
}
function rankOf(data, employeeId) {
  const row = (data ?? []).find((value) => value.employee_id === employeeId);
  assert.ok(
    row,
    `The ranking returned no rank for fixture employee ${employeeId}`,
  );
  return Number(row.rank_position);
}
function renderedRow(state, name) {
  return (
    state.rankingRows.find((row) =>
      (row[1] ?? '').startsWith(`${namespace} ${name}`),
    ) ?? null
  );
}
const rankNumber = (row) => Number(row[0]);

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

// ------------------------------------------------------------------ browsers
const browsers = new Map();
const profileDirs = [];
const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
// Per-run session names keep a rerun from reusing another run's browser bridge state.
const managerSession = `sgn34-manager-${runStamp}`;
const tzSession = `sgn34-tz-${runStamp}`;
const salesSession = `sgn34-sales-${runStamp}`;
async function startBrowser(cdpPort, timezone) {
  // A shared workstation under load can lose a Chromium launch, so a failed start is
  // retried once with a fresh profile instead of failing the observation.
  for (let launch = 1; launch <= 2; launch++) {
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
    browsers.set(cdpPort, child);
    for (let attempt = 0; attempt < 120; attempt++) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${cdpPort}/json/version`,
        );
        if (response.ok) return child;
      } catch {
        // not listening yet
      }
      await sleep(500);
    }
    child.kill('SIGKILL');
    browsers.delete(cdpPort);
    console.log('RETRY headless chromium', cdpPort, launch);
    await sleep(2000);
  }
  assert.fail('Headless Chromium did not become ready');
}
async function stopBrowser(cdpPort) {
  const child = browsers.get(cdpPort);
  if (!child) return;
  child.kill('SIGTERM');
  await sleep(1000);
  if (child.exitCode === null) child.kill('SIGKILL');
  browsers.delete(cdpPort);
}
async function stopBrowsers() {
  for (const child of browsers.values()) child.kill('SIGTERM');
  await sleep(1000);
  for (const child of browsers.values())
    if (child.exitCode === null) child.kill('SIGKILL');
  browsers.clear();
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
  const diagnostic = `${result.stderr ?? ''}\n${result.stdout ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-4)
    .join(' | ')
    .slice(0, 300);
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
// The shipped company report surface: the ranking panel is the section that owns
// `#company-ranking`, and the daily history stays in its own panel below it.
const companyScreen = `() => {
  const rows = (table) => table
    ? [...table.querySelectorAll('tbody tr')].map((row) =>
        [...row.children].map((cell) => cell.textContent.trim()))
    : [];
  const ranking = document.querySelector('section[aria-labelledby="company-ranking"]');
  const history = document.querySelector('section[aria-labelledby="company-history"]');
  const rankingTable = ranking?.querySelector('table.data-table') ?? null;
  return {
    path: location.pathname,
    lang: document.documentElement.lang,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    rankingHeading: ranking?.querySelector('h2')?.textContent?.trim() ?? null,
    rankingNote: ranking?.querySelector('.panel-foot')?.textContent?.trim() ?? null,
    rankingPeriod: ranking?.querySelector('.panel-note')?.textContent?.trim() ?? null,
    rankingHeaders: rankingTable
      ? [...rankingTable.querySelectorAll('thead th')].map((node) => node.textContent.trim())
      : [],
    rankingRows: rows(rankingTable),
    historyRows: rows(history?.querySelector('table.data-table')),
    rangedLabels: ranking
      ? [...ranking.querySelectorAll('th[data-label],td[data-label]')].length
      : 0,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    alerts: [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent.trim()),
    status: document.querySelector('[role=status]')?.textContent?.trim() ?? null,
  };
}`;
function screen(session, cdpPort) {
  const value = evaluate(session, cdpPort, companyScreen);
  assert.equal(typeof value, 'object', 'Unexpected browser screen payload');
  return value;
}
let pageRetries = 0;
async function waitForRanking(session, cdpPort, attempts = 120) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = screen(session, cdpPort);
      if (last.rankingHeading && last.rankingRows.length) return last;
      if (last.alerts.length && attempt % 8 === 7 && pageRetries < 5) {
        const clicked = evaluate(
          session,
          cdpPort,
          `(() => { const button = document.querySelector('[role=alert] button'); if (!button) return false; button.click(); return true; })()`,
        );
        if (clicked) {
          pageRetries++;
          console.log('RETRY company-page', pageRetries);
        }
      }
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.fail(`Company report did not load: ${JSON.stringify(last)}`);
}
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
const reportStrings = {
  vi: {
    invalidRange:
      'Khoảng ngày không hợp lệ. Ngày bắt đầu không được sau ngày kết thúc và tối đa 366 ngày.',
    connectionFailure: 'Không thể kết nối. Vui lòng thử lại.',
    loading: 'Đang tải…',
  },
  en: {
    invalidRange:
      'That date range is not valid. The start date must not be after the end date, and the range may cover at most 366 days.',
    connectionFailure: 'Unable to connect. Please try again.',
    loading: 'Loading…',
  },
};
const observeStatus = `(() => {
  window.__sgnStatusSeen = [];
  const record = () => {
    const node = document.querySelector('[role=status]');
    if (!node) return;
    const text = node.textContent.trim();
    if (!window.__sgnStatusSeen.includes(text)) window.__sgnStatusSeen.push(text);
  };
  new MutationObserver(record).observe(document.body, { childList: true, subtree: true, characterData: true });
  record();
  return true;
})()`;
// The rendered states must stay distinguishable and localized: an invalid range is an error and
// never a zero ranking, and a genuine transport failure is a failure, not zero, while the
// in-flight loading state stays observable and Retry recovers the ranked totals.
async function assertReportStates(
  session,
  cdpPort,
  language,
  day,
  previousDay,
) {
  const label = language === 'vi' ? 'Vietnamese/default' : 'English';
  const text = reportStrings[language];
  browser(session, cdpPort, [
    'open',
    `${appUrl}/activity/company?from=${day}&to=${previousDay}`,
  ]);
  await waitFor(
    session,
    cdpPort,
    `() => (document.querySelector('[role=alert]')?.textContent ?? '').includes(${JSON.stringify(text.invalidRange)})`,
  );
  const invalid = screen(session, cdpPort);
  assert.equal(invalid.rankingHeading, null);
  assert.equal(invalid.rankingRows.length, 0);
  assert.ok(
    invalid.alerts.some((entry) => entry.includes(text.invalidRange)),
    `invalid-range alert missing in ${label}`,
  );
  observed(
    `an invalid range renders the localized validation and no ranking in ${label}`,
  );

  browser(session, cdpPort, [
    'open',
    `${appUrl}/activity/company?from=${previousDay}&to=${day}`,
  ]);
  await waitForRanking(session, cdpPort);
  browser(session, cdpPort, ['emulate', '--network', 'Offline']);
  evaluate(session, cdpPort, observeStatus);
  evaluate(
    session,
    cdpPort,
    `(() => { window.dispatchEvent(new Event('focus')); return true; })()`,
  );
  await waitFor(
    session,
    cdpPort,
    `() => (document.querySelector('[role=alert]')?.textContent ?? '').includes(${JSON.stringify(text.connectionFailure)})`,
  );
  const failure = screen(session, cdpPort);
  assert.equal(failure.rankingHeading, null);
  assert.equal(failure.rankingRows.length, 0);
  assert.ok(
    failure.alerts.some((entry) => entry.includes(text.connectionFailure)),
    `query failure alert missing in ${label}`,
  );
  browser(session, cdpPort, ['emulate', '--network', 'Fast 4G']);
  evaluate(
    session,
    cdpPort,
    `(() => { const button = document.querySelector('[role=alert] button'); if (!button) return false; button.click(); return true; })()`,
  );
  const recovered = await waitForRanking(session, cdpPort);
  assert.equal(renderedRow(recovered, 'salesB')?.[2], '3');
  assert.equal(renderedRow(recovered, 'staff')?.[2], '0');
  const seen = evaluate(session, cdpPort, `() => window.__sgnStatusSeen ?? []`);
  assert.ok(
    seen.includes(text.loading),
    `loading state not observed in ${label}: ${JSON.stringify(seen)}`,
  );
  observed(
    `a query failure renders the localized failure and loading states, and Retry recovers the ranking in ${label}`,
  );
}
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

// ------------------------------------------------------------------ run
let manifest = null;
let baseline = null;
let committedRows = 0;
const previous = await readManifest();
await removeFixtures(previous);
await fs.rm(manifestPath, { force: true });

let primary = null;
try {
  await startApp();
  baseline = {
    employees: await countRows('employees'),
    activity: await countRows('activity_events'),
    employeeHash: await idHash('employees'),
    activityHash: await idHash('activity_events'),
  };
  manifest = await createFixtures();
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  const inventory = await selectInventory();
  const fixtures = manifest.identities;
  const [ownerOne, ownerTwo] = inventory.owners;
  const day = await today(0);
  const previousDay = await today(-1);
  const fixtureIds = identities.map(([name]) => fixtures[name].employeeId);
  const manager = await signIn(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  const salesA = await signIn(fixtures.salesA.email, fixtures.salesA.password);
  const salesB = await signIn(fixtures.salesB.email, fixtures.salesB.password);
  observed('real development project and synthetic identities established', {
    namespace,
    employees: identities.length,
    unlinked: 1,
    ownerEligibleProperties: inventory.owners.length,
  });

  // Today's committed activity through the delivered disclosure RPC: salesA reveals one
  // property twice (one unit) and a second property once, salesB reveals the same two properties
  // once each, so the two employees tie at two units. salesA also records a Page view, which
  // must never enter the ranked total, and staff records nothing at all.
  for (const propertyId of [ownerOne, ownerOne, ownerTwo]) {
    const result = await discloseOwner(salesA, propertyId);
    assert.equal(result.error, null, 'owner disclosure failed');
    assert.equal(
      result.data.credited,
      true,
      'owner disclosure was not credited',
    );
  }
  for (const propertyId of [ownerOne, ownerTwo]) {
    const result = await discloseOwner(salesB, propertyId);
    assert.equal(result.error, null, 'owner disclosure failed');
    assert.equal(
      result.data.credited,
      true,
      'owner disclosure was not credited',
    );
  }
  const view = await viewProperty(salesA, ownerOne);
  assert.equal(view.error, null, 'page view RPC failed');
  // One committed row is placed on the previous Vietnam day with an explicit instant, so the
  // same property on another day must add a further unit.
  committedRows += (
    await insertCommitted([
      {
        employee_id: fixtures.salesB.employeeId,
        property_id: ownerOne,
        kind: 'owner_contact_access',
        idempotency_key: randomUUID(),
        occurred_at: `${previousDay} 12:00:00+07`,
      },
    ])
  ).length;
  observed(
    'committed owner-contact activity recorded through the delivered RPCs and one controlled previous Vietnam day',
    { unit: 'one employee/property/Vietnam day' },
  );

  // The ranking the manager reads must equal the committed source units, keep the zero row, and
  // share one rank for the tied pair.
  const todayResult = await ranking(manager, day, day);
  assert.equal(todayResult.error, null, 'ranking RPC failed for the manager');
  const units = await committedUnits(fixtureIds, day, day);
  const todayData = todayResult.data;
  for (const [name, identity] of Object.entries(fixtures)) {
    if (name === 'inactive') continue;
    assert.equal(
      totalOf(todayData, identity.employeeId),
      units.get(identity.employeeId),
      `ranking total disagrees with the committed units for ${name}`,
    );
  }
  assert.equal(totalOf(todayData, fixtures.salesA.employeeId), 2);
  assert.equal(totalOf(todayData, fixtures.salesB.employeeId), 2);
  assert.equal(totalOf(todayData, fixtures.staff.employeeId), 0);
  assert.equal(
    rankOf(todayData, fixtures.salesA.employeeId),
    rankOf(todayData, fixtures.salesB.employeeId),
    'Equal totals must share a rank',
  );
  const staffRow = todayData.find(
    (row) => row.employee_id === fixtures.staff.employeeId,
  );
  assert.equal(Number(staffRow.owner_contact_properties), 0);
  observed(
    'the daily ranking equals the committed units, keeps the explicit zero row and shares the tied rank',
  );

  // The same property on the previous Vietnam day adds again, so the tie breaks over a range.
  const rangeResult = await ranking(manager, previousDay, day);
  assert.equal(rangeResult.error, null, 'ranking RPC failed for the range');
  const rangeUnits = await committedUnits(fixtureIds, previousDay, day);
  for (const [name, identity] of Object.entries(fixtures)) {
    if (name === 'inactive') continue;
    assert.equal(
      totalOf(rangeResult.data, identity.employeeId),
      rangeUnits.get(identity.employeeId),
      `range total disagrees with the committed units for ${name}`,
    );
  }
  assert.equal(totalOf(rangeResult.data, fixtures.salesA.employeeId), 2);
  assert.equal(totalOf(rangeResult.data, fixtures.salesB.employeeId), 3);
  assert.ok(
    rankOf(rangeResult.data, fixtures.salesB.employeeId) <
      rankOf(rangeResult.data, fixtures.salesA.employeeId),
    'The previous Vietnam day must add a further ranked unit',
  );
  observed(
    'the same property on the next Vietnam day adds a further ranked unit',
  );

  // Page views and distinct properties viewed stay separate: salesA owns a committed Page view
  // that changed no owner-contact total.
  const committedPageViews = (
    await retryResult('read committed page views', () =>
      admin
        .from('activity_events')
        .select('employee_id')
        .eq('employee_id', fixtures.salesA.employeeId)
        .eq('kind', 'page_view')
        .gte('business_day', day)
        .lte('business_day', day),
    )
  ).data;
  assert.ok(committedPageViews.length >= 1, 'The Page-view fixture is missing');
  assert.equal(totalOf(todayData, fixtures.salesA.employeeId), 2);
  observed('Page views stay outside the ranked total');

  // The application endpoint returns the same ranking under its own validated range.
  const managerCookies = await appLogin(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  const appRange = await appGet(
    managerCookies,
    `/api/activity/company?from=${day}&to=${day}`,
  );
  assert.equal(appRange.status, 200, `Company endpoint ${appRange.status}`);
  assert.ok(Array.isArray(appRange.body?.ranking), 'No ranking array returned');
  assert.equal(
    totalOf(appRange.body.ranking, fixtures.salesA.employeeId),
    2,
    'The endpoint ranking disagrees with the RPC',
  );
  // The default period is today plus the preceding 29 Vietnam days. The companion daily report
  // is capped at the Data API's 1,000 rows (active employees x days), so on a project with more
  // than 33 active employees the endpoint rejects it rather than returning a short or truncated
  // ranking; the ranking's own scope stays under its own cap and is read directly either way.
  const appDefault = await appGet(managerCookies, '/api/activity/company');
  if (appDefault.status === 200) {
    assert.equal(appDefault.body.from, await today(-29));
    assert.equal(appDefault.body.to, day);
    assert.equal(
      totalOf(appDefault.body.ranking, fixtures.salesB.employeeId),
      3,
      'The default 30-day ranking lost the previous-day unit',
    );
    assert.ok(
      appDefault.body.rows.some(
        (row) =>
          row.employeeId === fixtures.staff.employeeId &&
          row.ownerContactProperties === 0,
      ),
      'The zero staff row is missing from the daily report',
    );
    observed(
      'the application endpoint returns the same ranking, the explicit zero row and the 30-day default',
    );
  } else {
    assert.equal(appDefault.status, 400, 'Default company range status');
    assert.equal(appDefault.body.error, 'range-too-large');
    observed(
      'a 30-day default above the companion report row cap is rejected, never a zero or truncated ranking',
      { activeScope: true },
    );
  }
  const defaultRanking = await ranking(manager, await today(-29), day);
  assert.equal(defaultRanking.error, null, 'default ranking RPC read');
  assert.equal(
    totalOf(defaultRanking.data, fixtures.salesB.employeeId),
    3,
    'The default 30-day ranking RPC lost the previous-day unit',
  );
  assert.equal(
    totalOf(defaultRanking.data, fixtures.staff.employeeId),
    0,
    'The default 30-day ranking RPC lost the zero staff row',
  );
  observed(
    'the ranking RPC sums the 30-day default period from the committed units',
  );

  // Authorization: the live manager and admin read; every other identity is refused, including
  // by the direct Data API and with an already-issued session after a role downgrade.
  const adminResult = await ranking(
    await signIn(fixtures.admin.email, fixtures.admin.password),
    day,
    day,
  );
  assert.equal(adminResult.error, null, 'ranking RPC failed for the admin');
  const anonymousClient = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const anonymousDirect = await ranking(anonymousClient, day, day);
  assert.equal(anonymousDirect.error?.code, '42501');
  const anonymous = await appGet('', '/api/activity/company');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error, 'unauthenticated');
  for (const name of ['salesA', 'staff']) {
    const direct = await ranking(
      await signIn(fixtures[name].email, fixtures[name].password),
      day,
      day,
    );
    assert.equal(direct.error?.code, '42501', `${name} read the ranking`);
    const cookies = await appLogin(
      fixtures[name].email,
      fixtures[name].password,
    );
    const denied = await appGet(
      cookies,
      `/api/activity/company?from=${day}&to=${day}`,
    );
    assert.equal(denied.status, 403, `${name} endpoint status`);
    assert.equal(denied.body.error, 'access-denied');
  }
  const inactiveDirect = await ranking(
    await signIn(fixtures.inactive.email, fixtures.inactive.password),
    day,
    day,
  );
  assert.equal(inactiveDirect.error?.code, '42501');
  const unlinkedDirect = await ranking(
    await signIn(manifest.unlinked.email, manifest.unlinked.password),
    day,
    day,
  );
  assert.equal(unlinkedDirect.error?.code, '42501');
  for (const [label, email, password] of [
    ['inactive', fixtures.inactive.email, fixtures.inactive.password],
    ['unlinked', manifest.unlinked.email, manifest.unlinked.password],
  ]) {
    const login = await appLoginResponse(email, password);
    assert.equal(login.status, 403, `${label} application login status`);
    assert.equal(login.body?.error, 'access-denied');
  }
  observed(
    'manager and admin read the ranking; sales, staff, inactive, unlinked and anonymous identities are refused',
  );

  assert.ok(
    updateEmployee(fixtures.manager.employeeId, { role: 'sales' }),
    'role downgrade failed',
  );
  const downgraded = await appGet(
    managerCookies,
    `/api/activity/company?from=${day}&to=${day}`,
  );
  assert.equal(downgraded.status, 403, 'A downgraded manager kept authority');
  assert.ok(
    updateEmployee(fixtures.manager.employeeId, { role: 'manager' }),
    'role restore failed',
  );
  const restoredRead = await appGet(
    managerCookies,
    `/api/activity/company?from=${day}&to=${day}`,
  );
  assert.equal(
    restoredRead.status,
    200,
    'Restoring the role did not restore authority',
  );
  observed(
    'a role downgrade removes ranking authority on the next request with the already-issued session',
  );

  // Range validation stays the report's own contract, never a zero or truncated ranking.
  for (const [query, status, error] of [
    [`from=${day}&to=${previousDay}`, 400, 'invalid-range'],
    [`from=${day}&to=`, 400, 'invalid-input'],
    ['from=2025-01-01&to=2026-01-01', 400, 'range-too-large'],
  ]) {
    const invalid = await appGet(
      managerCookies,
      `/api/activity/company?${query}`,
    );
    assert.equal(invalid.status, status, `Range ${query}`);
    assert.equal(invalid.body.error, error, `Range ${query}`);
  }
  observed(
    'invalid, partial and over-cap ranges are rejected, never shown as zeros',
  );

  // The real manager browser: the ranking panel renders the same values, survives a language
  // switch, follows a selected range and stays readable on a mobile viewport.
  await startBrowser(9341, 'Asia/Ho_Chi_Minh');
  await browserSignIn(
    managerSession,
    9341,
    fixtures.manager.email,
    fixtures.manager.password,
  );
  browser(managerSession, 9341, [
    'open',
    `${appUrl}/activity/company?from=${previousDay}&to=${day}`,
  ]);
  const vi = await waitForRanking(managerSession, 9341);
  assert.equal(vi.path, '/activity/company');
  assert.equal(vi.lang, 'vi');
  assert.deepEqual(vi.rankingHeaders, [
    'Hạng',
    'Nhân viên',
    'Bất động sản đã xem liên hệ chủ nhà',
  ]);
  // Other real employees may outrank the fixture pair, so the gates assert the fixture totals
  // and their relative order rather than a fixed global rank.
  assert.equal(renderedRow(vi, 'salesB')?.[2], '3');
  assert.equal(renderedRow(vi, 'salesA')?.[2], '2');
  assert.equal(renderedRow(vi, 'staff')?.[2], '0');
  assert.ok(
    rankNumber(renderedRow(vi, 'salesB')) <
      rankNumber(renderedRow(vi, 'salesA')),
    'The previous-day unit did not rank above the tied pair total',
  );
  assert.ok((vi.rankingNote ?? '').length > 0, 'The ranking carries no note');
  assert.ok(
    vi.historyRows.some((row) => row[0] === `${namespace} salesA`),
    'The daily history table lost the fixture employee',
  );
  assert.ok(vi.rangedLabels >= 3, 'The ranking cells carry no per-cell labels');
  observed(
    'the manager browser renders the ranked totals, the explicit zero row and the daily history',
    { rows: vi.rankingRows.length },
  );

  await assertReportStates(managerSession, 9341, 'vi', day, previousDay);
  // Capture the rendered default range immediately before the switch so the comparison is not
  // exposed to another user's activity landing between the two reads.
  const viBeforeEn = await waitForRanking(managerSession, 9341);

  evaluate(
    managerSession,
    9341,
    `(() => { const button = document.querySelector('.lang-switch button[lang=en]'); button.click(); return true; })()`,
  );
  await waitFor(
    managerSession,
    9341,
    `() => document.documentElement.lang === 'en'`,
  );
  const en = await waitForRanking(managerSession, 9341);
  assert.deepEqual(en.rankingHeaders, [
    'Rank',
    'Employee',
    'Owner-contact properties',
  ]);
  assert.deepEqual(
    en.rankingRows.map((row) => row.slice(0, 3)),
    viBeforeEn.rankingRows.map((row) => row.slice(0, 3)),
    'Switching language changed a recorded total or rank',
  );
  assert.equal(en.rankingPeriod, viBeforeEn.rankingPeriod);
  observed(
    'switching Vietnamese to English keeps the ranked totals and rewrites no record',
  );

  await assertReportStates(managerSession, 9341, 'en', day, previousDay);

  evaluate(managerSession, 9341, setInput('#report-from', day));
  evaluate(managerSession, 9341, setInput('#report-to', day));
  evaluate(
    managerSession,
    9341,
    `(() => { document.querySelector('form[action="/activity/company"]').requestSubmit(); return true; })()`,
  );
  let singleDay = null;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      singleDay = screen(managerSession, 9341);
      if (
        singleDay.rankingRows.some(
          (row) => row[1] === `${namespace} salesB` && row[2] === '2',
        )
      )
        break;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.equal(renderedRow(singleDay, 'salesA')?.[2], '2');
  assert.equal(renderedRow(singleDay, 'salesB')?.[2], '2');
  assert.equal(
    renderedRow(singleDay, 'salesA')?.[0],
    renderedRow(singleDay, 'salesB')?.[0],
    'Equal single-day totals must share a rank',
  );
  observed(
    'the selected single-day range reranks the tied employees from the committed units',
  );

  browser(managerSession, 9341, ['resize', '375', '900']);
  const mobile = screen(managerSession, 9341);
  assert.equal(
    mobile.overflowX,
    0,
    'The 375px ranking view overflows horizontally',
  );
  assert.ok(mobile.rangedLabels >= 3);
  observed('the ranking stays readable without horizontal overflow at 375px');

  // A browser in another timezone reads the same Vietnam period and the same ranked facts.
  await startBrowser(9343, 'Pacific/Kiritimati');
  await browserSignIn(
    tzSession,
    9343,
    fixtures.manager.email,
    fixtures.manager.password,
  );
  browser(tzSession, 9343, [
    'open',
    `${appUrl}/activity/company?from=${previousDay}&to=${day}`,
  ]);
  const tz = await waitForRanking(tzSession, 9343);
  assert.equal(tz.rankingPeriod, vi.rankingPeriod);
  for (const [name, total] of [
    ['salesA', '2'],
    ['salesB', '3'],
    ['staff', '0'],
    ['manager', '0'],
  ]) {
    assert.equal(
      renderedRow(tz, name)?.[2],
      total,
      `The timezone browser changed the ranked total for ${name}`,
    );
  }
  const historyRow = (state) =>
    state.historyRows.find((row) => row[0] === `${namespace} salesA`) ?? null;
  assert.deepEqual(historyRow(tz), historyRow(vi));
  assert.equal(
    tz.rankingPeriod?.includes(previousDay.split('-').reverse().join('/')),
    true,
    'The timezone browser did not render the requested Vietnam period',
  );
  observed(
    'a browser in another timezone sees the same Vietnam period and the same ranked totals',
  );
  await stopBrowser(9343);

  // A live deactivation clears the displayed ranking on refocus and denies the next read.
  assert.ok(
    updateEmployee(fixtures.manager.employeeId, { is_active: false }),
    'manager deactivation failed',
  );
  evaluate(
    managerSession,
    9341,
    `(() => { window.dispatchEvent(new Event('focus')); return true; })()`,
  );
  let refocusState = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      refocusState = evaluate(
        managerSession,
        9341,
        `() => ({ path: location.pathname, denied: /quyền truy cập|Access denied/.test(document.body.innerText), ranking: Boolean(document.querySelector('section[aria-labelledby="company-ranking"]')) })`,
      );
      if (refocusState.path === '/access-denied' || refocusState.denied) break;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.ok(
    refocusState?.path === '/access-denied' || refocusState?.denied,
    `refocus denial not shown: ${JSON.stringify(refocusState)}`,
  );
  assert.equal(
    refocusState.ranking,
    false,
    'The ranking stayed visible after deactivation',
  );
  assert.ok(
    updateEmployee(fixtures.manager.employeeId, { is_active: true }),
    'manager reactivation failed',
  );
  browser(managerSession, 9341, [
    'open',
    `${appUrl}/activity/company?from=${previousDay}&to=${day}`,
  ]);
  await waitForRanking(managerSession, 9341);
  observed(
    'deactivation clears the displayed ranking on refocus and denies the next read',
  );

  // Denial in the browser, and no ranking left behind after sign-out.
  await startBrowser(9342, 'Asia/Ho_Chi_Minh');
  await browserSignIn(
    salesSession,
    9342,
    fixtures.salesA.email,
    fixtures.salesA.password,
  );
  browser(salesSession, 9342, ['open', `${appUrl}/activity/company`]);
  await waitFor(
    salesSession,
    9342,
    `() => location.pathname === '/access-denied'`,
  );
  observed('a sales employee opening the report directly is denied');

  evaluate(
    managerSession,
    9341,
    `(() => { document.querySelector('.sgn-user-btn').click(); return true; })()`,
  );
  await sleep(300);
  const signedOut = evaluate(
    managerSession,
    9341,
    `(() => { const button = [...document.querySelectorAll('.sgn-popover button')][0]; if (!button) return false; button.click(); return true; })()`,
  );
  assert.equal(signedOut, true, 'No sign-out control was found');
  await waitFor(managerSession, 9341, `() => location.pathname === '/login'`);
  evaluate(managerSession, 9341, `(() => { history.back(); return true; })()`);
  await sleep(2000);
  const afterBack = evaluate(
    managerSession,
    9341,
    `() => ({ path: location.pathname, ranking: Boolean(document.querySelector('section[aria-labelledby="company-ranking"]')) })`,
  );
  assert.equal(
    afterBack.ranking,
    false,
    'Back exposed the ranking after sign-out',
  );
  observed('sign-out clears the ranking so Back cannot reveal it');
} catch (error) {
  primary = error;
} finally {
  if (!keep) {
    try {
      await stopBrowsers();
      await stopApp();
      manifest = (await readManifest()) ?? manifest;
      await removeFixtures(manifest);
      await fs.rm(manifestPath, { force: true });
      if (baseline) {
        // The shared development project is used by other lanes, so removal is verified
        // against the exact synthetic fixture IDs rather than a global row-count baseline.
        const fixtureIds = Object.values(manifest?.identities ?? {}).map(
          (identity) => identity.employeeId,
        );
        const [leftoverEmployees, leftoverActivity] = fixtureIds.length
          ? await Promise.all([
              retryResult('read leftover employees', () =>
                admin.from('employees').select('id,email').in('id', fixtureIds),
              ),
              retryResult('read leftover activity', () =>
                admin
                  .from('activity_events')
                  .select('id')
                  .in('employee_id', fixtureIds),
              ),
            ])
          : [{ data: [] }, { data: [] }];
        assert.deepEqual(
          leftoverEmployees.data ?? [],
          [],
          'Fixture employees were not removed',
        );
        assert.deepEqual(
          leftoverActivity.data ?? [],
          [],
          'Fixture activity was not removed',
        );
        const after = {
          employees: await countRows('employees'),
          activity: await countRows('activity_events'),
        };
        observed(
          'the synthetic identities, employee rows and activity are removed',
          { baselineEmployees: baseline.employees, employees: after.employees },
        );
      }
    } catch (error) {
      if (!primary) primary = error;
      else console.error('CLEANUP', error?.message ?? String(error));
    }
  }
}
if (primary) throw primary;

const reportDocument = {
  checked_at: new Date().toISOString(),
  project_ref: projectRef,
  namespace,
  observations: observations.map(({ name, ...rest }) => ({ name, ...rest })),
  transient_retries: retryCount,
  page_retries: pageRetries,
  created: {
    identities: identities.map(([name]) => `${namespace} ${name}`),
    unlinked: 1,
    activity_events: committedRows + 6,
  },
  removed: {
    identities: identities.length,
    unlinked: 1,
    activity_events: committedRows + 6,
  },
  limitations: [
    retryCount
      ? `${retryCount} transient transport retries were needed for idempotent fixture/read steps; no assertion was retried.`
      : null,
    pageRetries
      ? `${pageRetries} in-page Retry activations were needed after transient upstream 503 responses on the report read; each retry re-issued the same authorized request and no assertion was retried.`
      : null,
    'The ranking is read from existing read-only owner-eligible inventory plus synthetic committed activity rows scoped to the SGN34 namespace; inventory that cannot supply two unarchived owner-eligible properties fails the run rather than skipping the gate.',
    'Past-day units are placed by one committed row with an explicit instant so the Vietnam day is controlled; the same-day duplicate, tie and shared-property cases use the delivered disclosure RPC.',
    'The companion daily report caps its scope at the Data API row limit (active employees x days <= 1000), so on a shared development project with more than 33 active employees the endpoint rejects the 30-day default with 400/range-too-large while the ranking RPC is read directly for the same period; the rendered browser pass uses an in-cap inclusive range.',
    'The shared development project is used by other lanes concurrently, so fixture removal is verified against the exact synthetic employee and activity IDs instead of a global row-count baseline.',
    'Synthetic employee rows and their role/activation transitions are provisioned through the owner SQL connection because the delivered employee-admin guard reserves lifecycle writes to that path.',
    'Queries are embedded-PGlite regressions plus these live individual-session Auth/Data API/RLS observations; no production edge or load testing.',
  ].filter(Boolean),
};
await fs.writeFile(reportPath, JSON.stringify(reportDocument, null, 2) + '\n');
console.log(`${observations.length} observations passed`);
