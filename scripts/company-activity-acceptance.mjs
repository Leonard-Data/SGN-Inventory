// Issue #31 hosted acceptance: company employee-by-day activity.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and real
// Chrome sessions. Uses existing inventory read-only, creates only the synthetic identities the
// report needs under an exact-ID private manifest, and removes exactly what it created through
// the supported service-role paths. Mock, shim and readiness-page results are not acceptance.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node --env-file-if-exists=.env.local scripts/company-activity-acceptance.mjs \
//     [--report <sanitized json path>]
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
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3101);
const keep = process.env.SGN_ACCEPTANCE_KEEP === '1';
const root = path.resolve(import.meta.dirname, '..');
const reportIndex = process.argv.indexOf('--report');
const reportPath =
  reportIndex >= 0
    ? process.argv[reportIndex + 1]
    : path.join(workdir ?? '.', 'acceptance-report.json');

if (process.argv.includes('--help')) {
  console.log(
    'Hosted acceptance for the company employee-by-day report. Requires SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR.',
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
if (environment.publishableKey.split('.').length === 3) {
  const capability = JSON.parse(
    Buffer.from(owner.authAdminKey.split('.')[1], 'base64url').toString(),
  );
  assert.equal(capability.role, 'service_role', 'Owner capability required');
  assert.equal(capability.ref, projectRef, 'Owner capability project mismatch');
}
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
const namespace = 'SGN31';
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
async function report(client, from, to) {
  return retryResult('company report', () =>
    client.rpc('company_employee_daily_activity', {
      p_from: from,
      p_to: to,
    }),
  );
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
// The report page is loaded when its table exists; a failure path reports the observed state
// instead of an opaque timeout. A transient upstream error is retried through the page's own
// Retry control, and every such retry is disclosed in the sanitized report.
const loadState = `() => ({
  path: location.pathname,
  table: Boolean(document.querySelector('table.report-table')),
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
// The browser bridge truncates large payloads, so the read returns only the tracked rows for
// the days under assertion rather than the whole employee/date table.
function screenExpression(tracked, dates) {
  return `() => {
  const main = document.querySelector('main');
  const summary = document.querySelector('#today-summary')?.parentElement ?? null;
  const table = document.querySelector('table.report-table');
  const tracked = ${JSON.stringify(tracked)};
  const dates = ${JSON.stringify(dates)};
  const rows = table
    ? [...table.querySelectorAll('tbody tr')]
        .map((tr) => [...tr.children].map((cell) => cell.textContent.trim()))
        .filter((cells) => tracked.includes(cells[0]) && dates.includes(cells[1]))
    : [];
  return {
    path: location.pathname,
    lang: main?.lang ?? document.documentElement.lang,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    summaryDate: summary?.querySelector('dd')?.textContent?.trim() ?? null,
    summaryLabels: summary ? [...summary.querySelectorAll('dt')].map((node) => node.textContent.trim()) : [],
    summaryValues: summary ? [...summary.querySelectorAll('dd')].slice(1).map((node) => node.textContent.trim()) : [],
    caption: table?.querySelector('caption')?.textContent?.trim() ?? null,
    headers: table ? [...table.querySelectorAll('thead th')].map((node) => node.textContent.trim()) : [],
    rowCount: table ? table.querySelectorAll('tbody tr').length : 0,
    rows,
    alerts: [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent.trim()),
    denied: document.body.innerText.includes('Không có quyền truy cập') || document.body.innerText.includes('Access denied'),
  };
}`;
}
function screen(session, cdpPort, tracked, dates) {
  let value = evaluate(session, cdpPort, screenExpression(tracked, dates));
  for (let depth = 0; depth < 4 && typeof value === 'string'; depth++)
    value = JSON.parse(value);
  assert.equal(typeof value, 'object', 'Unexpected browser screen payload');
  return value;
}

// ------------------------------------------------------------------ run
let manifest = null;
let baseline = null;
let eventsCreated = 0;
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

  const track = (result) => {
    if (result?.eventId) {
      manifest.createdEventIds.push(result.eventId);
      eventsCreated++;
    }
    return result;
  };
  const salesA = await signIn(fixtures.salesA.email, fixtures.salesA.password);
  const salesB = await signIn(fixtures.salesB.email, fixtures.salesB.password);
  const manager = await signIn(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  const adminClient = await signIn(
    fixtures.admin.email,
    fixtures.admin.password,
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

  // Real activity through the delivered RPCs, on today's Vietnam day.
  for (const propertyId of inventory.pageView) {
    const view = await viewProperty(salesA, propertyId);
    assert.equal(view.error, null, 'page view RPC failed');
    manifest.createdEventIds.push(view.data);
    eventsCreated++;
  }
  const firstReveal = await discloseOwner(salesA, inventory.eligible);
  assert.equal(firstReveal.error, null, 'owner disclosure failed');
  track(firstReveal.data);
  const repeatReveal = await discloseOwner(salesA, inventory.eligible);
  assert.equal(repeatReveal.error, null, 'repeat owner disclosure failed');
  track(repeatReveal.data);
  const secondEmployeeReveal = await discloseOwner(salesB, inventory.eligible);
  assert.equal(
    secondEmployeeReveal.error,
    null,
    'second employee disclosure failed',
  );
  track(secondEmployeeReveal.data);
  const managerPageView = await viewProperty(manager, inventory.pageView[0]);
  assert.equal(managerPageView.error, null, 'manager page view failed');
  manifest.createdEventIds.push(managerPageView.data);
  eventsCreated++;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  observed('committed synthetic activity recorded through the delivered RPCs', {
    activityEvents: eventsCreated,
  });

  // Authorization and completeness.
  const anonymous = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false } },
  );
  const anonymousReport = await report(anonymous, from, to);
  assert.equal(anonymousReport.error?.code, '42501');
  observed('anonymous publishable-key report request denied');
  const salesReport = await report(salesA, from, to);
  assert.equal(salesReport.error?.code, '42501');
  observed('sales employee report request denied');
  const staffReport = await report(
    await signIn(fixtures.staff.email, fixtures.staff.password),
    from,
    to,
  );
  assert.equal(staffReport.error?.code, '42501');
  observed('staff employee report request denied');
  const inactiveReport = await report(
    await signIn(fixtures.inactive.email, fixtures.inactive.password),
    from,
    to,
  );
  assert.equal(inactiveReport.error?.code, '42501');
  observed('inactive employee report request denied');
  const unlinkedReport = await report(
    await signIn(manifest.unlinked.email, manifest.unlinked.password),
    from,
    to,
  );
  assert.equal(unlinkedReport.error?.code, '42501');
  observed('authenticated unlinked identity report request denied');

  const managerReport = await report(manager, from, to);
  assert.equal(managerReport.error, null, 'manager report failed');
  const rows = managerReport.data;
  const inRange = (value) => value >= from && value <= to;
  const days = [];
  for (let cursor = from; cursor <= to;) {
    days.push(cursor);
    const next = new Date(Date.parse(`${cursor}T00:00:00Z`) + 86400000);
    cursor = next.toISOString().slice(0, 10);
  }
  const { data: employees, error: employeeError } = await retryResult(
    'read employees',
    () => admin.from('employees').select('id,is_active'),
  );
  assert.equal(employeeError, null, 'read employees');
  const { data: events } = await retryResult('read range events', () =>
    admin
      .from('activity_events')
      .select('employee_id,business_day')
      .gte('business_day', from)
      .lte('business_day', to),
  );
  const subjects = new Set(
    employees.filter((employee) => employee.is_active).map((e) => e.id),
  );
  const withEvents = new Set(
    events
      .filter((event) => inRange(event.business_day))
      .map((e) => e.employee_id),
  );
  const expected = new Set(
    [...subjects, ...withEvents].flatMap((id) =>
      days.map((value) => `${id}|${value}`),
    ),
  );
  const actual = new Set(
    rows.map((row) => `${row.employee_id}|${row.business_day}`),
  );
  assert.deepEqual([...actual].sort(), [...expected].sort());
  observed(
    'every active employee and requested Vietnam day is present, including empty days',
    {
      rows: rows.length,
      employees: subjects.size,
      days: days.length,
    },
  );

  const cell = (employeeId, value) =>
    rows.find(
      (row) => row.employee_id === employeeId && row.business_day === value,
    ) ?? {
      page_view_events: -1,
      distinct_properties_viewed: -1,
      owner_contact_properties: -1,
    };
  const counts = (employeeId, value) => ({
    pageViewEvents: Number(cell(employeeId, value).page_view_events),
    distinctPropertiesViewed: Number(
      cell(employeeId, value).distinct_properties_viewed,
    ),
    ownerContactProperties: Number(
      cell(employeeId, value).owner_contact_properties,
    ),
  });
  assert.deepEqual(counts(fixtures.salesA.employeeId, day), {
    pageViewEvents: 2,
    distinctPropertiesViewed: 2,
    ownerContactProperties: 1,
  });
  assert.deepEqual(counts(fixtures.salesB.employeeId, day), {
    pageViewEvents: 0,
    distinctPropertiesViewed: 0,
    ownerContactProperties: 1,
  });
  assert.deepEqual(counts(fixtures.manager.employeeId, day), {
    pageViewEvents: 1,
    distinctPropertiesViewed: 1,
    ownerContactProperties: 0,
  });
  assert.deepEqual(counts(fixtures.staff.employeeId, day), {
    pageViewEvents: 0,
    distinctPropertiesViewed: 0,
    ownerContactProperties: 0,
  });
  observed(
    'page view events, distinct properties viewed and owner-contact access stay separate per employee and day',
  );
  observed(
    'two employees disclosing one property each keep their own daily count and repeated reveals count once',
  );
  observed('an employee with no events reports explicit zeros for every day');

  const emptyDay = days.find(
    (value) =>
      value !== day &&
      rows
        .filter((row) => row.business_day === value)
        .every(
          (row) =>
            Number(row.page_view_events) === 0 &&
            Number(row.distinct_properties_viewed) === 0 &&
            Number(row.owner_contact_properties) === 0,
        ),
  );
  assert.ok(emptyDay, 'No completely empty day was available in the range');
  observed('a completely empty day reports zeros for every employee', {
    day: emptyDay,
  });

  const personal = await retryResult('personal report', () =>
    salesA.rpc('my_today_activity'),
  );
  assert.equal(personal.error, null, 'personal report failed');
  assert.deepEqual(counts(fixtures.salesA.employeeId, day), {
    pageViewEvents: Number(personal.data[0].page_view_events),
    distinctPropertiesViewed: Number(
      personal.data[0].distinct_properties_viewed,
    ),
    ownerContactProperties: Number(personal.data[0].owner_contact_properties),
  });
  observed(
    'the company row for today agrees with the employee personal today report',
  );

  const invalidRange = await report(manager, to, from);
  assert.equal(invalidRange.error?.code, '22023');
  const tooLong = await report(manager, await today(-500), day);
  assert.equal(tooLong.error?.code, '22023');
  observed(
    'invalid and over-long ranges are rejected instead of reported as zeros',
  );

  // Owner-contact eligibility and denial against existing read-only inventory.
  if (inventory.brokerOnly) {
    const brokerReveal = await discloseOwner(salesA, inventory.brokerOnly);
    assert.equal(brokerReveal.error?.code, 'P0003');
    observed(
      'broker-only disclosure is denied and adds no owner-contact credit',
    );
  }
  if (inventory.archivedOwner) {
    const archivedReveal = await discloseOwner(
      manager,
      inventory.archivedOwner,
    );
    assert.equal(archivedReveal.error, null, 'archived review failed');
    assert.equal(archivedReveal.data.credited, false);
    assert.equal(archivedReveal.data.eventId, null);
    track(archivedReveal.data);
    const deniedReveal = await discloseOwner(salesA, inventory.archivedOwner);
    assert.equal(deniedReveal.error?.code, 'P0002');
    const afterArchived = await report(manager, day, day);
    assert.equal(
      Number(
        afterArchived.data.find(
          (row) =>
            row.employee_id === fixtures.manager.employeeId &&
            row.business_day === day,
        ).owner_contact_properties,
      ),
      0,
    );
    observed(
      'manager archived review keeps authorized contact access without new owner-contact credit and an ordinary employee stays denied',
    );
  }
  assert.equal(
    counts(fixtures.salesA.employeeId, day).ownerContactProperties,
    1,
  );
  observed('denied and archived disclosures added no owner-contact credit');
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

  // Live role and activation rechecks with the same session.
  await updateEmployee(fixtures.manager.employeeId, { role: 'sales' });
  const downgraded = await report(manager, from, to);
  assert.equal(downgraded.error?.code, '42501');
  await updateEmployee(fixtures.manager.employeeId, { role: 'manager' });
  const restoredManager = await report(manager, from, to);
  assert.equal(restoredManager.error, null);
  observed(
    'a manager to sales downgrade removes authority on the next request with the same session',
  );
  await updateEmployee(fixtures.manager.employeeId, { is_active: false });
  const deactivated = await report(manager, from, to);
  assert.equal(deactivated.error?.code, '42501');
  await updateEmployee(fixtures.manager.employeeId, { is_active: true });
  const reactivated = await report(manager, from, to);
  assert.equal(reactivated.error, null);
  observed(
    'deactivation removes authority with the same session and restoration returns it',
  );
  const adminReport = await report(adminClient, from, to);
  assert.equal(adminReport.error, null);
  observed('admin report read allowed');

  // Application endpoint.
  const anonymousApp = await appGet('', '/api/activity/company');
  assert.equal(anonymousApp.status, 401);
  observed('the application endpoint returns 401 for an anonymous caller');
  const salesCookies = await appLogin(
    fixtures.salesA.email,
    fixtures.salesA.password,
  );
  const salesApp = await appGet(
    salesCookies,
    `/api/activity/company?from=${from}&to=${to}`,
  );
  assert.equal(salesApp.status, 403);
  observed('the application endpoint returns 403 for a sales employee');
  const managerCookies = await appLogin(
    fixtures.manager.email,
    fixtures.manager.password,
  );
  const invalidApp = await appGet(
    managerCookies,
    `/api/activity/company?from=${to}&to=${from}`,
  );
  assert.equal(invalidApp.status, 400);
  assert.equal(invalidApp.body?.error, 'invalid-range');
  const malformedApp = await appGet(
    managerCookies,
    '/api/activity/company?from=2026-2-1&to=2026-03-01',
  );
  assert.equal(malformedApp.status, 400);
  assert.equal(malformedApp.body?.error, 'invalid-input');
  observed(
    'the application endpoint rejects invalid and malformed ranges clearly',
  );
  const defaultApp = await appGet(managerCookies, '/api/activity/company');
  assert.equal(defaultApp.status, 200);
  assert.equal(defaultApp.body.from, await today(-29));
  assert.equal(defaultApp.body.to, day);
  assert.equal(defaultApp.body.today, day);
  const staffApp = await appGet(
    await appLogin(fixtures.staff.email, fixtures.staff.password),
    `/api/activity/company?from=${from}&to=${to}`,
  );
  assert.equal(staffApp.status, 403);
  observed('the application endpoint returns 403 for a staff employee');
  const managerApp = await appGet(
    managerCookies,
    `/api/activity/company?from=${from}&to=${to}`,
  );
  assert.equal(managerApp.status, 200);
  const appSalesA = managerApp.body.rows.find(
    (row) =>
      row.employeeId === fixtures.salesA.employeeId && row.businessDay === day,
  );
  assert.deepEqual(
    {
      pageViewEvents: appSalesA.pageViewEvents,
      distinctPropertiesViewed: appSalesA.distinctPropertiesViewed,
      ownerContactProperties: appSalesA.ownerContactProperties,
    },
    counts(fixtures.salesA.employeeId, day),
  );
  const appStaff = managerApp.body.rows.find(
    (row) =>
      row.employeeId === fixtures.staff.employeeId && row.businessDay === day,
  );
  assert.deepEqual(
    {
      pageViewEvents: appStaff.pageViewEvents,
      distinctPropertiesViewed: appStaff.distinctPropertiesViewed,
      ownerContactProperties: appStaff.ownerContactProperties,
    },
    {
      pageViewEvents: 0,
      distinctPropertiesViewed: 0,
      ownerContactProperties: 0,
    },
  );
  observed(
    'the application endpoint returns exact company counts, the default 30-day period and explicit zeros',
  );

  // Browser journey.
  await startBrowser(9331, 'Asia/Ho_Chi_Minh');
  await startBrowser(9332, 'Pacific/Kiritimati');
  await browserSignIn(
    'sgn31-vi',
    9331,
    fixtures.manager.email,
    fixtures.manager.password,
  );
  browser('sgn31-vi', 9331, [
    'open',
    `${appUrl}/activity/company?from=${from}&to=${to}`,
  ]);
  await waitForReport('sgn31-vi', 9331);
  const screenDate = day.split('-').reverse().join('/');
  const emptyScreenDate = emptyDay.split('-').reverse().join('/');
  const screenDates = [screenDate, emptyScreenDate];
  const trackedNames = [
    'SGN31 salesA',
    'SGN31 salesB',
    'SGN31 manager',
    'SGN31 staff',
  ];
  let vi = screen('sgn31-vi', 9331, trackedNames, screenDates);
  assert.equal(
    vi.path,
    '/activity/company',
    `VI screen ${JSON.stringify(vi).slice(0, 400)}`,
  );
  assert.equal(vi.lang, 'vi');
  assert.equal(vi.heading, 'Hoạt động của nhân viên theo ngày');
  assert.deepEqual(vi.summaryLabels, [
    'Ngày (giờ Việt Nam)',
    'Lượt xem trang',
    'Bất động sản đã xem',
    'Bất động sản đã xem liên hệ chủ nhà',
  ]);
  const viSalesA = vi.rows.find(
    (row) => row[0] === 'SGN31 salesA' && row[1] === screenDate,
  );
  assert.deepEqual(viSalesA.slice(2), ['2', '2', '1']);
  const viStaff = vi.rows.find(
    (row) => row[0] === 'SGN31 staff' && row[1] === emptyScreenDate,
  );
  assert.deepEqual(viStaff.slice(2), ['0', '0', '0']);
  observed(
    'a live manager sees the Vietnamese report with separated metrics and explicit zero rows',
  );
  const activityBefore = await report(manager, day, day);
  const englishButton = `(() => { const button = [...document.querySelectorAll('header button')].find((node) => node.textContent.trim() === 'English'); button.click(); return true; })()`;
  evaluate('sgn31-vi', 9331, englishButton);
  await waitFor(
    'sgn31-vi',
    9331,
    `() => document.querySelector('main')?.lang === 'en'`,
  );
  const en = screen('sgn31-vi', 9331, trackedNames, screenDates);
  assert.deepEqual(en.summaryLabels, [
    'Day (Vietnam time)',
    'Page views',
    'Distinct properties viewed',
    'Owner-contact properties',
  ]);
  assert.deepEqual(
    en.rows
      .find((row) => row[0] === 'SGN31 salesA' && row[1] === screenDate)
      .slice(2),
    ['2', '2', '1'],
  );
  const activityAfter = await report(manager, day, day);
  assert.deepEqual(
    activityBefore.data.map((row) => row.owner_contact_properties),
    activityAfter.data.map((row) => row.owner_contact_properties),
  );
  observed(
    'switching to English preserves the report counts and records no activity',
  );
  const filter = `(() => {
    const set = (selector, value) => {
      const el = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set('#report-from', ${JSON.stringify(day)});
    set('#report-to', ${JSON.stringify(day)});
    document.querySelector('form.report-filter').requestSubmit();
    return true;
  })()`;
  evaluate('sgn31-vi', 9331, filter);
  await waitFor(
    'sgn31-vi',
    9331,
    `() => location.search.includes(${JSON.stringify('from=' + day)})`,
  );
  await waitForReport('sgn31-vi', 9331);
  const singleDayRpc = await report(manager, day, day);
  assert.equal(singleDayRpc.error, null, 'single-day report read');
  const singleDayApp = await appGet(
    managerCookies,
    `/api/activity/company?from=${day}&to=${day}`,
  );
  assert.equal(singleDayApp.status, 200, 'single-day application read');
  assert.equal(
    singleDayApp.body.rows.length,
    singleDayRpc.data.length,
    `application and RPC single-day scope disagree: ${singleDayApp.body.rows.length} vs ${singleDayRpc.data.length}`,
  );
  const filtered = screen('sgn31-vi', 9331, trackedNames, [screenDate]);
  assert.equal(
    filtered.rowCount,
    singleDayApp.body.rows.length,
    `filtered row count ${filtered.rowCount} expected ${singleDayApp.body.rows.length} caption ${filtered.caption} alerts ${JSON.stringify(filtered.alerts)}`,
  );
  assert.ok(filtered.caption.includes(screenDate));
  observed('the date filter selects another validated single-day range');

  await browserSignIn(
    'sgn31-tz',
    9332,
    fixtures.manager.email,
    fixtures.manager.password,
  );
  browser('sgn31-tz', 9332, [
    'open',
    `${appUrl}/activity/company?from=${from}&to=${to}`,
  ]);
  await waitForReport('sgn31-tz', 9332);
  const tz = screen('sgn31-tz', 9332, trackedNames, screenDates);
  assert.equal(tz.summaryDate, vi.summaryDate);
  assert.deepEqual(
    tz.rows
      .find((row) => row[0] === 'SGN31 salesA' && row[1] === screenDate)
      .slice(2),
    ['2', '2', '1'],
  );
  observed(
    'a browser in a different timezone sees the same Vietnam period and counts',
  );

  // Sign-out clears the protected report and Back exposes none of it.
  evaluate(
    'sgn31-tz',
    9332,
    `(() => { const button = [...document.querySelectorAll('header button')].find((node) => /Đăng xuất|Sign out/.test(node.textContent)); button.click(); return true; })()`,
  );
  await waitFor('sgn31-tz', 9332, `() => location.pathname === '/login'`);
  evaluate('sgn31-tz', 9332, `(() => { history.back(); return true; })()`);
  await sleep(2000);
  const afterBack = await evaluate(
    'sgn31-tz',
    9332,
    `() => ({ path: location.pathname, report: Boolean(document.querySelector('table.report-table')) })`,
  );
  assert.equal(afterBack.report, false);
  observed('sign-out clears the protected report and Back exposes none of it');

  await startBrowser(9333, 'Asia/Ho_Chi_Minh');
  await browserSignIn(
    'sgn31-sales',
    9333,
    fixtures.salesA.email,
    fixtures.salesA.password,
  );
  browser('sgn31-sales', 9333, ['open', `${appUrl}/activity/company`]);
  let salesState = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      salesState = evaluate(
        'sgn31-sales',
        9333,
        `() => ({ path: location.pathname, denied: /quyền truy cập|Access denied/.test(document.body.innerText), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 160) })`,
      );
      if (salesState.denied) break;
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.ok(
    salesState?.denied,
    `sales denial not shown: ${JSON.stringify(salesState)}`,
  );
  observed('a sales employee navigating directly to the report is denied');

  await updateEmployee(fixtures.manager.employeeId, { is_active: false });
  evaluate(
    'sgn31-vi',
    9331,
    `(() => { window.dispatchEvent(new Event('focus')); return true; })()`,
  );
  let refocusState = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      refocusState = evaluate(
        'sgn31-vi',
        9331,
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
  await updateEmployee(fixtures.manager.employeeId, { is_active: true });
  observed('deactivation clears the protected report on refocus and denies it');
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
    activity_events: eventsCreated,
  },
  removed: {
    identities: identities.length,
    unlinked: 1,
    activity_events: eventsCreated,
  },
  limitations: [
    retryCount
      ? `${retryCount} transient transport retries were needed for idempotent fixture/read steps; no assertion was retried.`
      : null,
    pageRetries
      ? `${pageRetries} in-page Retry activations were needed after transient upstream 503 responses on the report read; each retry re-issued the same authorized request and no assertion was retried.`
      : null,
    'Existing read-only inventory supplies one unarchived owner-eligible property, no broker-only property, no unarchived owner without a phone and no owner shared across properties, so those exclusion and separation cases are not representable here without creating property fixtures; they remain covered by npm run test:schema.',
    'Queries are embedded-PGlite regressions plus these live individual-session Auth/Data API/RLS observations; no production edge or load testing.',
  ].filter(Boolean),
};
await fs.writeFile(reportPath, JSON.stringify(reportDocument, null, 2) + '\n');
console.log(`${observations.length} observations passed`);
