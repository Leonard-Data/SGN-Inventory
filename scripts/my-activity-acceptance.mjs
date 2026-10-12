// Issue #30 hosted acceptance: personal activity over Vietnam date ranges.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and real
// Chrome sessions. Uses existing inventory read-only, creates only the synthetic identities and
// committed activity rows the personal report needs under an exact-ID private manifest, and
// removes exactly what it created through the supported service-role paths. Mock, shim and
// readiness-page results are not acceptance.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node --env-file-if-exists=.env.local scripts/my-activity-acceptance.mjs \
//     [--report <sanitized json path>]
//
// Requires an existing production build for the head under test (`npm run build`); the harness
// starts `next start` and never rebuilds, so the rendered markup matches the reviewed commit.
//
// The dev env supplies the publishable application settings; the owner config supplies the
// database URL and owner capability. Both are read as data only and are never printed, shell
// sourced, or passed in argv/logs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
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
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3102);
const keep = process.env.SGN_ACCEPTANCE_KEEP === '1';
const root = path.resolve(import.meta.dirname, '..');
const reportIndex = process.argv.indexOf('--report');
const reportPath =
  reportIndex >= 0
    ? process.argv[reportIndex + 1]
    : path.join(workdir ?? '.', 'acceptance-report.json');

if (process.argv.includes('--help')) {
  console.log(
    'Hosted acceptance for the personal activity report. Requires SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR, plus an existing production build.',
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
async function updateEmployee(id, patch) {
  return retryResult('employee-update', () =>
    admin.from('employees').update(patch).eq('id', id),
  );
}
// A retry reuses the original employee-scoped key, so a lost response converges on the
// same committed activity row instead of creating a duplicate.
async function viewProperty(client, propertyId) {
  const key = crypto.randomUUID();
  return retryResult('page view', () =>
    client.rpc('record_property_activity', {
      p_property_id: propertyId,
      p_kind: 'page_view',
      p_key: key,
    }),
  );
}
async function discloseOwner(client, propertyId) {
  const key = crypto.randomUUID();
  return retryResult('owner disclosure', () =>
    client.rpc('reveal_owner_contact', {
      p_property_id: propertyId,
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
const namespace = 'SGN30';
// The report owner, a colleague whose RLS spans the owner's rows is the manager, plus an
// inactive and an authenticated-unlinked identity for the denial gates.
const identities = [
  ['salesA', 'sales', true],
  ['staff', 'staff', true],
  ['manager', 'manager', true],
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
    const employees = await retryResult('remove fixture employees', () =>
      admin.from('employees').delete().in('id', employeeIds),
    );
    assert.equal(employees.error, null, 'remove fixture employees');
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
  const manifest = {
    namespace,
    identities: {},
    unlinked: null,
    createdEventIds: [],
  };
  for (const [name, role, active] of identities) {
    const email = `${namespace.toLowerCase()}.${name.toLowerCase()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const created = await retryResult(`create auth user ${name}`, () =>
      admin.auth.admin.createUser({ email, password, email_confirm: true }),
    );
    assert.equal(created.error, null, `create auth user ${name}`);
    const userId = created.data.user.id;
    const employeeId = crypto.randomUUID();
    const inserted = await retryResult(`create employee ${name}`, () =>
      admin.from('employees').insert({
        id: employeeId,
        auth_user_id: userId,
        email,
        display_name: `${namespace} ${name}`,
        role,
        is_active: active,
      }),
    );
    assert.equal(inserted.error, null, `create employee ${name}`);
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
  return manifest;
}

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
  const byProperty = new Map();
  for (const link of links) {
    if (!byProperty.has(link.property_id))
      byProperty.set(link.property_id, { owner: [], broker: [] });
    byProperty
      .get(link.property_id)
      [link.relation === 'owner' ? 'owner' : 'broker'].push(link.contact_id);
  }
  const eligible = [];
  const brokerOnly = [];
  const archivedOwner = [];
  for (const [propertyId, relations] of byProperty) {
    const ownersWithPhone = relations.owner.filter((id) => phone.get(id));
    if (archived.get(propertyId)) {
      if (ownersWithPhone.length) archivedOwner.push(propertyId);
      continue;
    }
    if (ownersWithPhone.length) eligible.push(propertyId);
    else if (!relations.owner.length && relations.broker.length)
      brokerOnly.push(propertyId);
  }
  assert.ok(eligible.length, 'No unarchived owner-eligible property exists');
  const unarchived = properties
    .filter((property) => !property.archived_at)
    .map((property) => property.id);
  const control = unarchived.find((id) => id !== eligible[0]);
  assert.ok(control, 'No second unarchived property exists for page views');
  return {
    eligible: eligible[0],
    brokerOnly: brokerOnly[0] ?? null,
    archivedOwner: archivedOwner[0] ?? null,
    pageView: [eligible[0], control],
  };
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
// The caller's own daily rows for an inclusive Vietnam date range; no employee argument exists,
// so the scope can only ever be the signed-in employee.
async function report(client, from, to) {
  return retryResult('personal report', () =>
    client.rpc('my_daily_activity', { p_from: from, p_to: to }),
  );
}
async function todayReport(client) {
  return retryResult('personal today report', () =>
    client.rpc('my_today_activity'),
  );
}
// Committed rows are inserted with an explicit instant so a Vietnam day and the midnight
// boundary can be controlled; the generated business_day is read back from the database.
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
function vietnamDays(from, to) {
  const days = [];
  for (let cursor = from; cursor <= to;) {
    days.push(cursor);
    cursor = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return days;
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
// The report table is the personal daily table rendered by the shipped design vocabulary.
const loadState = `() => ({
  path: location.pathname,
  table: Boolean(document.querySelector('main table.data-table')),
  alert: document.querySelector('[role=alert]')?.textContent?.trim() ?? null,
  status: document.querySelector('[role=status]')?.textContent?.trim() ?? null,
})`;
let pageRetries = 0;
async function waitForReport(session, cdpPort, attempts = 120) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = evaluate(session, cdpPort, loadState);
      if (last.table) return last;
      if (last.alert && attempt % 8 === 7 && pageRetries < 5) {
        const clicked = evaluate(
          session,
          cdpPort,
          `(() => { const button = document.querySelector('[role=alert] button'); if (!button) return false; button.click(); return true; })()`,
        );
        if (clicked) {
          pageRetries++;
          console.log('RETRY report-page', pageRetries);
        }
      }
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.fail(`Report page did not load: ${JSON.stringify(last)}`);
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
// The browser bridge truncates large payloads, so the read returns only the tracked days under
// assertion rather than the whole 30-day table.
function screenExpression(dates) {
  return `() => {
  const summary = document.querySelector('#my-today-summary')?.closest('section') ?? null;
  const form = document.querySelector('form[action="/activity/me"]');
  const table = document.querySelector('main table.data-table');
  const dates = ${JSON.stringify(dates)};
  const rows = table
    ? [...table.querySelectorAll('tbody tr')]
        .map((tr) => [...tr.children].map((cell) => cell.textContent.trim()))
        .filter((cells) => dates.includes(cells[0]))
    : [];
  const labels = form
    ? [...form.querySelectorAll('label')].map((node) => node.textContent.trim())
    : [];
  const controls = form
    ? [...form.querySelectorAll('input')].map((node) => ({
        id: node.id,
        type: node.type,
        value: node.value,
      }))
    : [];
  return {
    path: location.pathname,
    lang: document.documentElement.lang,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    summaryDate: summary?.querySelector('.panel-head .panel-note')?.textContent?.trim() ?? null,
    summaryLabels: summary ? [...summary.querySelectorAll('dl.facts dt')].map((node) => node.textContent.trim()) : [],
    summaryValues: summary ? [...summary.querySelectorAll('dl.facts dd')].map((node) => node.textContent.trim()) : [],
    labels,
    controls,
    headers: table ? [...table.querySelectorAll('thead th')].map((node) => node.textContent.trim()) : [],
    rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
    rows,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
    alerts: [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent.trim()),
    denied: document.body.innerText.includes('Không có quyền truy cập') || document.body.innerText.includes('Access denied'),
  };
}`;
}
function screen(session, cdpPort, dates) {
  let value = evaluate(session, cdpPort, screenExpression(dates));
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth++)
    value = JSON.parse(value);
  assert.equal(typeof value, 'object', 'Unexpected browser screen payload');
  return value;
}

// ------------------------------------------------------------------ run
let manifest = null;
let baseline = null;
let committedRows = 0;
const previous = await readManifest();
await removeFixtures(previous);
await fs.rm(manifestPath, { force: true });

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
  const day = await today(0);
  const from = await today(-13);
  const to = day;
  const midnightDay = await today(-3);
  const multiDay = await today(-2);
  const emptyDay = await today(-1);

  const salesA = await signIn(fixtures.salesA.email, fixtures.salesA.password);
  const staff = await signIn(fixtures.staff.email, fixtures.staff.password);
  const manager = await signIn(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  observed('real development project and synthetic identities established', {
    namespace,
    employees: identities.length,
    unlinked: 1,
    inventory: {
      eligible: 1,
      brokerOnly: inventory.brokerOnly ? 1 : 0,
      archivedOwner: inventory.archivedOwner ? 1 : 0,
    },
  });

  // Today's real activity through the delivered RPCs: two page views of two properties and one
  // deliberate owner-contact disclosure for the report owner, one page view for the manager.
  for (const propertyId of inventory.pageView) {
    const view = await viewProperty(salesA, propertyId);
    assert.equal(view.error, null, 'page view RPC failed');
    manifest.createdEventIds.push(view.data);
  }
  const reveal = await discloseOwner(salesA, inventory.eligible);
  assert.equal(reveal.error, null, 'owner disclosure failed');
  assert.equal(reveal.data.credited, true, 'owner disclosure was not credited');
  manifest.createdEventIds.push(reveal.data.eventId);
  const managerView = await viewProperty(manager, inventory.pageView[0]);
  assert.equal(managerView.error, null, 'manager page view failed');
  manifest.createdEventIds.push(managerView.data);

  // Past days and the midnight controls are committed with an explicit instant: 16:59:59Z is
  // 23:59:59 on the Vietnam day, 17:00:00Z starts the next Vietnam day. The colleague's rows use
  // the same days so an own-only read can be told apart from an all-rows read.
  const at = (value, time) => `${value} ${time}`;
  const past = await insertCommitted([
    {
      employee_id: fixtures.salesA.employeeId,
      property_id: inventory.pageView[0],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '12:00:00+07'),
    },
    {
      employee_id: fixtures.salesA.employeeId,
      property_id: inventory.pageView[0],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '12:05:00+07'),
    },
    {
      employee_id: fixtures.salesA.employeeId,
      property_id: inventory.pageView[1],
      kind: 'owner_contact_access',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '12:10:00+07'),
    },
    {
      employee_id: fixtures.salesA.employeeId,
      property_id: inventory.pageView[1],
      kind: 'owner_contact_access',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '12:15:00+07'),
    },
    {
      employee_id: fixtures.salesA.employeeId,
      property_id: inventory.pageView[0],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(midnightDay, '16:59:59Z'),
    },
    {
      employee_id: fixtures.salesA.employeeId,
      property_id: inventory.pageView[1],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(midnightDay, '17:00:00Z'),
    },
    {
      employee_id: fixtures.staff.employeeId,
      property_id: inventory.pageView[0],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '13:00:00+07'),
    },
    {
      employee_id: fixtures.staff.employeeId,
      property_id: inventory.pageView[0],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '13:05:00+07'),
    },
    {
      employee_id: fixtures.staff.employeeId,
      property_id: inventory.pageView[1],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '13:10:00+07'),
    },
    {
      employee_id: fixtures.staff.employeeId,
      property_id: inventory.pageView[0],
      kind: 'page_view',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '13:15:00+07'),
    },
    {
      employee_id: fixtures.staff.employeeId,
      property_id: inventory.pageView[1],
      kind: 'owner_contact_access',
      idempotency_key: crypto.randomUUID(),
      occurred_at: at(multiDay, '13:20:00+07'),
    },
  ]);
  committedRows += past.length;
  manifest.createdEventIds.push(...past.map((row) => row.id));
  // The database, not the caller, decided which Vietnam day each midnight control belongs to.
  const midnightInstants = [
    Date.parse(`${midnightDay}T16:59:59Z`),
    Date.parse(`${midnightDay}T17:00:00Z`),
  ];
  const midnightRows = past.filter((row) =>
    midnightInstants.includes(Date.parse(row.occurred_at)),
  );
  assert.equal(midnightRows.length, 2, 'both midnight controls must persist');
  assert.deepEqual(
    midnightRows.map((row) => row.business_day).sort(),
    [midnightDay, multiDay].sort(),
    'a pre-midnight instant stays on its day and 17:00:00Z starts the next Vietnam day',
  );
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  observed('committed synthetic activity recorded for multiple Vietnam days', {
    activityEvents: committedRows + 4,
    midnightRows: midnightRows.length,
  });

  // Authorization.
  const anonymous = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false } },
  );
  const anonymousReport = await report(anonymous, from, to);
  assert.equal(anonymousReport.error?.code, '42501');
  observed('anonymous publishable-key personal report request denied');
  const inactiveReport = await report(
    await signIn(fixtures.inactive.email, fixtures.inactive.password),
    from,
    to,
  );
  assert.equal(inactiveReport.error?.code, '42501');
  observed('inactive employee personal report request denied');
  const unlinkedReport = await report(
    await signIn(manifest.unlinked.email, manifest.unlinked.password),
    from,
    to,
  );
  assert.equal(unlinkedReport.error?.code, '42501');
  observed('authenticated unlinked identity personal report request denied');

  // Completeness and exact per-metric/per-day values for the report owner.
  const own = await report(salesA, from, to);
  assert.equal(own.error, null, 'personal report failed');
  const days = vietnamDays(from, to);
  assert.deepEqual(
    own.data.map((row) => row.business_day).sort(),
    [...days].sort(),
    'every requested Vietnam day must appear exactly once',
  );
  const cell = (rows, value) => {
    const row = rows.find((entry) => entry.business_day === value);
    assert.ok(row, `missing report row for ${value}`);
    return {
      pageViewEvents: Number(row.page_view_events),
      distinctPropertiesViewed: Number(row.distinct_properties_viewed),
      ownerContactProperties: Number(row.owner_contact_properties),
    };
  };
  assert.deepEqual(cell(own.data, day), {
    pageViewEvents: 2,
    distinctPropertiesViewed: 2,
    ownerContactProperties: 1,
  });
  // Two page views of one property and two reveals of another property on one day stay one
  // distinct property each; the third page view arrives from across the midnight boundary.
  assert.deepEqual(cell(own.data, multiDay), {
    pageViewEvents: 3,
    distinctPropertiesViewed: 2,
    ownerContactProperties: 1,
  });
  assert.deepEqual(cell(own.data, midnightDay), {
    pageViewEvents: 1,
    distinctPropertiesViewed: 1,
    ownerContactProperties: 0,
  });
  assert.deepEqual(cell(own.data, emptyDay), {
    pageViewEvents: 0,
    distinctPropertiesViewed: 0,
    ownerContactProperties: 0,
  });
  observed(
    'the personal report covers every requested day with exact separated metrics and explicit zero days',
    { days: days.length },
  );

  // The committed rows behind those numbers, read by the owner capability.
  const { data: committed, error: committedError } = await retryResult(
    'read committed activity',
    () =>
      admin
        .from('activity_events')
        .select('kind,business_day,property_id')
        .eq('employee_id', fixtures.salesA.employeeId)
        .gte('business_day', from)
        .lte('business_day', to),
  );
  assert.equal(committedError, null, 'read committed activity');
  const onDay = (value, kind) =>
    committed.filter((row) => row.business_day === value && row.kind === kind);
  assert.equal(
    cell(own.data, multiDay).pageViewEvents,
    onDay(multiDay, 'page_view').length,
  );
  assert.equal(
    cell(own.data, multiDay).distinctPropertiesViewed,
    new Set(onDay(multiDay, 'page_view').map((row) => row.property_id)).size,
  );
  assert.equal(
    cell(own.data, multiDay).ownerContactProperties,
    new Set(
      onDay(multiDay, 'owner_contact_access').map((row) => row.property_id),
    ).size,
  );
  assert.equal(onDay(multiDay, 'owner_contact_access').length, 2);
  observed(
    'personal totals equal the eligible committed events, with repeated reveals collapsed',
  );

  // Own-only for every role, including a reviewer whose RLS spans colleagues.
  assert.deepEqual(cell(own.data, midnightDay), {
    pageViewEvents: 1,
    distinctPropertiesViewed: 1,
    ownerContactProperties: 0,
  });
  const colleague = await report(staff, from, to);
  assert.equal(colleague.error, null, 'colleague personal report failed');
  assert.deepEqual(cell(colleague.data, multiDay), {
    pageViewEvents: 4,
    distinctPropertiesViewed: 1,
    ownerContactProperties: 1,
  });
  const reviewer = await report(manager, from, to);
  assert.equal(reviewer.error, null, 'manager personal report failed');
  assert.deepEqual(cell(reviewer.data, day), {
    pageViewEvents: 1,
    distinctPropertiesViewed: 1,
    ownerContactProperties: 0,
  });
  assert.deepEqual(cell(reviewer.data, multiDay), {
    pageViewEvents: 0,
    distinctPropertiesViewed: 0,
    ownerContactProperties: 0,
  });
  observed(
    'a reviewer whose RLS spans colleagues still reads only their own activity',
  );
  // The owner's own read is unchanged by the colleague's rows on the same days.
  const ownAgain = await report(salesA, from, to);
  assert.deepEqual(cell(ownAgain.data, multiDay), cell(own.data, multiDay));
  observed(
    'a colleague’s rows on the same days are absent from the owner report',
  );

  // Same-period agreement with the manager/admin company figures for every employee and day:
  // both reports derive from the committed rows, so the separated metrics must match exactly.
  const company = await retryResult('company report', () =>
    manager.rpc('company_employee_daily_activity', { p_from: from, p_to: to }),
  );
  assert.equal(company.error, null, 'company report read failed');
  for (const [name, personal] of [
    ['salesA', own],
    ['staff', colleague],
    ['manager', reviewer],
  ]) {
    for (const value of days) {
      const row = company.data.find(
        (entry) =>
          entry.employee_id === fixtures[name].employeeId &&
          entry.business_day === value,
      );
      assert.ok(row, `missing company row for ${name} on ${value}`);
      assert.deepEqual(
        {
          pageViewEvents: Number(row.page_view_events),
          distinctPropertiesViewed: Number(row.distinct_properties_viewed),
          ownerContactProperties: Number(row.owner_contact_properties),
        },
        cell(personal.data, value),
        `company and personal same-period values disagree for ${name} on ${value}`,
      );
    }
  }
  observed(
    'the personal range report agrees with the company same-period figures for every employee and requested day',
    { employees: 3, days: days.length },
  );

  // Today's summary agrees with the delivered personal today report.
  const todayOnly = await todayReport(salesA);
  assert.equal(todayOnly.error, null, 'personal today report failed');
  assert.deepEqual(cell(own.data, day), {
    pageViewEvents: Number(todayOnly.data[0].page_view_events),
    distinctPropertiesViewed: Number(
      todayOnly.data[0].distinct_properties_viewed,
    ),
    ownerContactProperties: Number(todayOnly.data[0].owner_contact_properties),
  });
  observed(
    'the range report’s today row agrees with the employee personal today report',
  );

  // Range validation.
  const reversed = await report(salesA, to, from);
  assert.equal(reversed.error?.code, '22023');
  const overLong = await report(salesA, await today(-500), day);
  assert.equal(overLong.error?.code, '22023');
  const widest = await report(salesA, await today(-365), day);
  assert.equal(widest.error, null, '366-day boundary read failed');
  assert.equal(widest.data.length, 366);
  observed(
    'reversed and over-long ranges are rejected instead of reported as zeros, and the 366-day boundary is accepted',
  );

  // Denied disclosure adds no credit.
  if (inventory.brokerOnly) {
    const brokerReveal = await discloseOwner(salesA, inventory.brokerOnly);
    assert.equal(brokerReveal.error?.code, 'P0003');
    const afterBroker = await report(salesA, day, day);
    assert.deepEqual(cell(afterBroker.data, day), cell(own.data, day));
    observed(
      'broker-only disclosure is denied and adds no owner-contact credit',
    );
  }
  if (inventory.archivedOwner) {
    const deniedReveal = await discloseOwner(salesA, inventory.archivedOwner);
    assert.equal(deniedReveal.error?.code, 'P0002');
    const afterDenied = await report(salesA, day, day);
    assert.deepEqual(cell(afterDenied.data, day), cell(own.data, day));
    observed(
      'archived-property disclosure by an ordinary employee stays denied',
    );
  }
  const directMutation = await salesA.from('activity_events').insert({
    employee_id: fixtures.salesA.employeeId,
    property_id: inventory.eligible,
    kind: 'page_view',
    idempotency_key: crypto.randomUUID(),
  });
  assert.equal(
    directMutation.error?.code,
    '42501',
    'Direct activity mutation was not denied',
  );
  observed('direct activity mutation remains denied');

  // Application endpoint.
  const anonymousApp = await appGet('', '/api/activity/me');
  assert.equal(anonymousApp.status, 401);
  observed('the application endpoint returns 401 for an anonymous caller');
  const salesCookies = await appLogin(
    fixtures.salesA.email,
    fixtures.salesA.password,
  );
  const ownedApp = await appGet(
    salesCookies,
    `/api/activity/me?from=${from}&to=${to}`,
  );
  assert.equal(ownedApp.status, 200, 'owner personal report read');
  assert.equal(ownedApp.body.from, from);
  assert.equal(ownedApp.body.to, to);
  assert.equal(ownedApp.body.today, day);
  assert.equal(ownedApp.body.rows.length, days.length);
  const appCell = (value) => {
    const row = ownedApp.body.rows.find((entry) => entry.businessDay === value);
    assert.ok(row, `missing application report row for ${value}`);
    return {
      pageViewEvents: row.pageViewEvents,
      distinctPropertiesViewed: row.distinctPropertiesViewed,
      ownerContactProperties: row.ownerContactProperties,
    };
  };
  assert.deepEqual(appCell(day), cell(own.data, day));
  assert.deepEqual(appCell(multiDay), cell(own.data, multiDay));
  assert.deepEqual(ownedApp.body.todayTotals, cell(own.data, day));
  observed(
    'the application endpoint returns exact personal counts and the today summary',
  );
  const outsideToday = await appGet(
    salesCookies,
    `/api/activity/me?from=${from}&to=${emptyDay}`,
  );
  assert.equal(outsideToday.status, 200);
  assert.deepEqual(
    outsideToday.body.todayTotals,
    cell(own.data, day),
    'a range excluding today must still read today separately',
  );
  observed(
    'the today summary is read separately when the selected range excludes today',
  );
  const defaultApp = await appGet(salesCookies, '/api/activity/me');
  assert.equal(defaultApp.status, 200);
  assert.equal(defaultApp.body.from, await today(-29));
  assert.equal(defaultApp.body.to, day);
  assert.equal(defaultApp.body.rows.length, 30);
  observed('the application defaults to the last 30 Vietnam calendar days');
  const reversedApp = await appGet(
    salesCookies,
    `/api/activity/me?from=${to}&to=${from}`,
  );
  assert.equal(reversedApp.status, 400);
  assert.equal(reversedApp.body?.error, 'invalid-range');
  const malformedApp = await appGet(
    salesCookies,
    '/api/activity/me?from=2026-2-1&to=2026-03-01',
  );
  assert.equal(malformedApp.status, 400);
  assert.equal(malformedApp.body?.error, 'invalid-input');
  const partialApp = await appGet(
    salesCookies,
    `/api/activity/me?from=${from}`,
  );
  assert.equal(partialApp.status, 400);
  assert.equal(partialApp.body?.error, 'invalid-input');
  observed(
    'the application endpoint rejects malformed, partial and reversed ranges clearly',
  );
  const inactiveCookies = await appLogin(
    fixtures.inactive.email,
    fixtures.inactive.password,
  );
  const inactiveApp = await appGet(
    inactiveCookies,
    `/api/activity/me?from=${from}&to=${to}`,
  );
  assert.equal(inactiveApp.status, 403);
  const unlinkedCookies = await appLogin(
    manifest.unlinked.email,
    manifest.unlinked.password,
  );
  const unlinkedApp = await appGet(
    unlinkedCookies,
    `/api/activity/me?from=${from}&to=${to}`,
  );
  assert.equal(unlinkedApp.status, 403);
  observed(
    'the application endpoint returns 403 for inactive and unlinked identities',
  );

  // Browser journey.
  await startBrowser(9334, 'Asia/Ho_Chi_Minh');
  await startBrowser(9335, 'Pacific/Kiritimati');
  await browserSignIn(
    'sgn30-vi',
    9334,
    fixtures.salesA.email,
    fixtures.salesA.password,
  );
  browser('sgn30-vi', 9334, [
    'open',
    `${appUrl}/activity/me?from=${from}&to=${to}`,
  ]);
  await waitForReport('sgn30-vi', 9334);
  const screenDate = day.split('-').reverse().join('/');
  const emptyScreenDate = emptyDay.split('-').reverse().join('/');
  const multiScreenDate = multiDay.split('-').reverse().join('/');
  const screenDates = [screenDate, emptyScreenDate, multiScreenDate];
  const vi = screen('sgn30-vi', 9334, screenDates);
  assert.equal(
    vi.path,
    '/activity/me',
    `VI screen ${JSON.stringify(vi).slice(0, 400)}`,
  );
  assert.equal(vi.lang, 'vi');
  assert.equal(vi.heading, 'Hoạt động của tôi');
  assert.deepEqual(vi.summaryLabels, [
    'Lượt xem trang',
    'Bất động sản đã xem',
    'Bất động sản đã xem liên hệ chủ nhà',
  ]);
  assert.equal(vi.summaryDate, screenDate);
  assert.deepEqual(vi.summaryValues, ['2', '2', '1']);
  assert.deepEqual(vi.headers, [
    'Ngày (giờ Việt Nam)',
    'Lượt xem trang',
    'Bất động sản đã xem',
    'Bất động sản đã xem liên hệ chủ nhà',
  ]);
  assert.deepEqual(vi.rows.find((row) => row[0] === screenDate).slice(1), [
    '2',
    '2',
    '1',
  ]);
  assert.deepEqual(vi.rows.find((row) => row[0] === multiScreenDate).slice(1), [
    '3',
    '2',
    '1',
  ]);
  assert.deepEqual(vi.rows.find((row) => row[0] === emptyScreenDate).slice(1), [
    '0',
    '0',
    '0',
  ]);
  observed(
    'a live employee sees the Vietnamese today summary and daily rows with separated metrics and explicit zero days',
  );
  // Accessible labels and keyboard-reachable date controls on a mobile viewport.
  assert.deepEqual(vi.labels, ['Từ ngày', 'Đến ngày']);
  assert.deepEqual(
    vi.controls.map((control) => [control.id, control.type]),
    [
      ['my-report-from', 'date'],
      ['my-report-to', 'date'],
    ],
  );
  browser('sgn30-vi', 9334, ['resize', '375', '900']);
  await sleep(500);
  const mobile = screen('sgn30-vi', 9334, screenDates);
  assert.equal(mobile.overflowX, 0, 'mobile viewport overflows horizontally');
  assert.deepEqual(mobile.rows.find((row) => row[0] === screenDate).slice(1), [
    '2',
    '2',
    '1',
  ]);
  browser('sgn30-vi', 9334, ['resize', '1440', '900']);
  await sleep(500);
  observed(
    'the date controls carry accessible labels and the report stays readable at 375px without horizontal overflow',
  );
  const activityBefore = await todayReport(salesA);
  evaluate(
    'sgn30-vi',
    9334,
    `(() => { const button = document.querySelector('.lang-switch button[lang=en]'); button.click(); return true; })()`,
  );
  await waitFor(
    'sgn30-vi',
    9334,
    `() => document.documentElement.lang === 'en'`,
  );
  const en = screen('sgn30-vi', 9334, screenDates);
  assert.deepEqual(en.summaryLabels, [
    'Page views',
    'Distinct properties viewed',
    'Owner-contact properties',
  ]);
  assert.deepEqual(en.rows.find((row) => row[0] === screenDate).slice(1), [
    '2',
    '2',
    '1',
  ]);
  assert.deepEqual(en.rows.find((row) => row[0] === multiScreenDate).slice(1), [
    '3',
    '2',
    '1',
  ]);
  assert.deepEqual(en.summaryValues, vi.summaryValues);
  assert.deepEqual(en.rows.find((row) => row[0] === emptyScreenDate).slice(1), [
    '0',
    '0',
    '0',
  ]);
  const activityAfter = await todayReport(salesA);
  assert.deepEqual(activityBefore.data, activityAfter.data);
  observed(
    'switching to English preserves the selected range and counts and records no activity',
  );
  // The date filter changes the reported period.
  const filter = `(() => {
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#my-report-from', ${JSON.stringify(multiDay)});
    set('#my-report-to', ${JSON.stringify(multiDay)});
    document.querySelector('form[action="/activity/me"]').requestSubmit();
    return true;
  })()`;
  evaluate('sgn30-vi', 9334, filter);
  await waitFor(
    'sgn30-vi',
    9334,
    `() => location.search.includes(${JSON.stringify('from=' + multiDay)})`,
  );
  await waitForReport('sgn30-vi', 9334);
  const singleDay = await appGet(
    salesCookies,
    `/api/activity/me?from=${multiDay}&to=${multiDay}`,
  );
  assert.equal(singleDay.status, 200, 'single-day application read');
  assert.equal(singleDay.body.rows.length, 1);
  const filtered = screen('sgn30-vi', 9334, [multiScreenDate]);
  assert.equal(
    filtered.rowCount,
    1,
    `filtered row count ${filtered.rowCount} alerts ${JSON.stringify(filtered.alerts)}`,
  );
  assert.deepEqual(
    filtered.rows.find((row) => row[0] === multiScreenDate).slice(1),
    ['3', '2', '1'],
  );
  observed('the selected date range changes the reported period');

  await browserSignIn(
    'sgn30-tz',
    9335,
    fixtures.salesA.email,
    fixtures.salesA.password,
  );
  browser('sgn30-tz', 9335, [
    'open',
    `${appUrl}/activity/me?from=${from}&to=${to}`,
  ]);
  await waitForReport('sgn30-tz', 9335);
  const tz = screen('sgn30-tz', 9335, screenDates);
  assert.equal(tz.summaryDate, vi.summaryDate);
  assert.deepEqual(tz.rows.find((row) => row[0] === screenDate).slice(1), [
    '2',
    '2',
    '1',
  ]);
  assert.deepEqual(tz.rows.find((row) => row[0] === multiScreenDate).slice(1), [
    '3',
    '2',
    '1',
  ]);
  observed(
    'a browser in another timezone sees the same Vietnam period and counts',
  );

  // Sign-out clears the protected report and Back exposes none of it.
  evaluate(
    'sgn30-tz',
    9335,
    `(() => { document.querySelector('.sgn-user-btn').click(); return true; })()`,
  );
  await sleep(300);
  evaluate(
    'sgn30-tz',
    9335,
    `(() => { const button = [...document.querySelectorAll('.sgn-popover button')][0]; if (!button) return false; button.click(); return true; })()`,
  );
  await waitFor('sgn30-tz', 9335, `() => location.pathname === '/login'`);
  evaluate('sgn30-tz', 9335, `(() => { history.back(); return true; })()`);
  await sleep(2000);
  const afterBack = await evaluate(
    'sgn30-tz',
    9335,
    `() => ({ path: location.pathname, report: Boolean(document.querySelector('main table.data-table')) })`,
  );
  assert.equal(afterBack.report, false);
  observed('sign-out clears the protected report and Back exposes none of it');

  await updateEmployee(fixtures.salesA.employeeId, { is_active: false });
  const deactivated = await report(salesA, from, to);
  assert.equal(deactivated.error?.code, '42501');
  const deactivatedApp = await appGet(
    salesCookies,
    `/api/activity/me?from=${from}&to=${to}`,
  );
  assert.equal(deactivatedApp.status, 403);
  evaluate(
    'sgn30-vi',
    9334,
    `(() => { window.dispatchEvent(new Event('focus')); return true; })()`,
  );
  let refocusState = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      refocusState = evaluate(
        'sgn30-vi',
        9334,
        `() => ({ path: location.pathname, hidden: document.querySelector('main > div[hidden]') !== null, denied: /quyền truy cập|Access denied/.test(document.body.innerText), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160) })`,
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
  await updateEmployee(fixtures.salesA.employeeId, { is_active: true });
  observed(
    'deactivation denies the next personal read and clears the report on refocus',
  );
} finally {
  if (!keep) {
    await stopBrowsers();
    await stopApp();
    manifest = (await readManifest()) ?? manifest;
    await removeFixtures(manifest);
    await fs.rm(manifestPath, { force: true });
    if (baseline) {
      const after = {
        employees: await countRows('employees'),
        activity: await countRows('activity_events'),
        employeeHash: await idHash('employees'),
        activityHash: await idHash('activity_events'),
      };
      assert.deepEqual(
        after,
        baseline,
        'Fixture restoration did not return to baseline',
      );
      observed('fixtures removed and the pre-acceptance baseline restored', {
        employees: after.employees,
        activity: after.activity,
      });
    }
  }
}

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
    activity_events: committedRows + 4,
  },
  removed: {
    identities: identities.length,
    unlinked: 1,
    activity_events: committedRows + 4,
  },
  limitations: [
    retryCount
      ? `${retryCount} transient transport retries were needed for idempotent fixture/read steps; no assertion was retried.`
      : null,
    pageRetries
      ? `${pageRetries} in-page Retry activations were needed after transient upstream 503 responses on the report read; each retry re-issued the same authorized request and no assertion was retried.`
      : null,
    'The report is read from existing read-only inventory plus synthetic committed activity rows scoped to the SGN30 namespace; existing inventory supplies no broker-only property and no archived owner-eligible property on every run, so those denial cases run only when present and otherwise rest on npm run test:schema.',
    'Queries are embedded-PGlite regressions plus these live individual-session Auth/Data API/RLS observations; no production edge or load testing.',
  ].filter(Boolean),
};
await fs.writeFile(reportPath, JSON.stringify(reportDocument, null, 2) + '\n');
console.log(`${observations.length} observations passed`);
