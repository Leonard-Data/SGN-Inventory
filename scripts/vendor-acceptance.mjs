// Issue #73 hosted acceptance: the company vendor directory.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and the
// rendered browser journey driven over CDP in a task-private headless Chromium. Every probe
// uses an individual signed-in session; mock, shim and embedded-PGlite results are not
// acceptance.
//
// This slice deliberately has no vendor deletion path, so the synthetic vendor rows are
// retained after the run under the declared SGN73 namespace: the report lists their exact
// ids. Fixture employees and Auth users those retained rows reference are also retained
// and recorded in the report; every other synthetic identity is removed.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   node --env-file-if-exists=.env.local scripts/vendor-acceptance.mjs \
//     [--report <sanitized json path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// server-only Auth admin capability (`authAdminKey`), which is never printed, shell sourced
// or passed in argv. The operator config supplies the owner connection (`dbUrl`), handed to
// the Supabase CLI in argv for the fixture statements that provision and remove the
// synthetic employees, because client roles cannot write employee lifecycle rows under the
// live employee guard. Captured CLI output is redacted of the connection string before it is
// recorded.
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
const operatorPath = process.env.SGN_ACCEPTANCE_OPERATOR;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3104);
const browserCli =
  process.env.SGN_ACCEPTANCE_BROWSER_CLI ??
  path.join(process.env.HOME ?? '', '.local/bin/chrome-devtools-axi');
const chromeBin =
  process.env.SGN_ACCEPTANCE_CHROME ??
  path.join(
    process.env.HOME ?? '',
    '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  );
const keep = process.env.SGN_ACCEPTANCE_KEEP === '1';
const root = path.resolve(import.meta.dirname, '..');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;

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
  'The owner config must supply the server-only Auth admin capability',
);
assert.ok(operator.dbUrl, 'The operator config needs an owner connection');
const environment = readEnvironment(
  { ...devEnv, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}` },
  devEnv.EXPECTED_SUPABASE_PROJECT_REF,
);
const appUrl = environment.appUrl;
await fs.mkdir(workdir, { recursive: true });

const ownerClient = createClient(environment.supabaseUrl, owner.authAdminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// The employee lifecycle guard refuses every client role, so the fixture employees are
// provisioned and removed with the separately authorized owner connection.
function operatorSql(statement) {
  const result = spawnSync(
    'npx',
    [
      'supabase',
      'db',
      'query',
      '--db-url',
      operator.dbUrl,
      '--output-format',
      'json',
      statement,
    ],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (result.status !== 0)
    throw new Error(
      'Operator SQL failed: ' +
        (result.stdout || result.stderr)
          .split(operator.dbUrl)
          .join('[redacted connection string]')
          .slice(-800),
    );
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
// Ticket #74 probes: a guarded mutation and an application endpoint call tolerate the same
// transient transport or edge failure the read retry above handles, and a refusal assertion
// reports the observed error rather than only its code, so a failure in this journey is
// diagnosable from the run log alone.
async function rpcCall(label, client, fn, args) {
  return retryThrown(label, () =>
    retryResult(label, () => client.rpc(fn, args)),
  );
}
async function endpointCall(label, work, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      const result = await work();
      const transient =
        result?.status === 0 || [502, 503, 504].includes(result?.status ?? 0);
      if (!transient || attempt >= attempts) return result;
      retryCount++;
      console.log('RETRY', label, attempt);
      await sleep(1500 * attempt);
    } catch (error) {
      if (!isTransient(error) || attempt >= attempts) throw error;
      retryCount++;
      console.log('RETRY', label, attempt);
      await sleep(1500 * attempt);
    }
  }
}
const refusal = (error, code) =>
  `expected ${code}, observed ${JSON.stringify(error ?? null)}`;
// A ticket #74 inspection read: the same transient retry as `rpcCall`, and a failed read is
// reported instead of being read as an empty result.
async function readRows(label, work) {
  const result = await retryThrown(label, () =>
    retryResult(label, async () => work()),
  );
  assert.equal(result.error, null, refusal(result.error, 'no error'));
  return result.data ?? [];
}
function sessionClient() {
  return createClient(environment.supabaseUrl, environment.publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
async function signInClient(email, password) {
  const client = sessionClient();
  const { error } = await retryResult('sign in fixture identity', () =>
    client.auth.signInWithPassword({ email, password }),
  );
  assert.equal(error, null, `sign in ${email}`);
  return client;
}
const anonClient = sessionClient();
const VENDOR_COLUMNS =
  'id,display_name,contact_name,phones,email,source_address,notes,created_at';

// ------------------------------------------------------------------ fixtures
const namespace = 'SGN73';
const filePrefix = namespace.toLowerCase();
// Fresh identities and vendor names per run: an interrupted earlier run leaves its
// retained SGN73 rows behind, so only this run's unique name is asserted to be alone.
const runToken = randomBytes(3).toString('hex');
const fixtureName = (suffix) => `${namespace} ${runToken} ${suffix}`;
// role, is_active. The unlinked identity below has an Auth account but no employee row.
const identities = [
  ['admin', 'admin', true],
  ['manager', 'manager', true],
  ['staff', 'staff', true],
  ['sales', 'sales', true],
  ['inactive', 'sales', false],
];
// Enough retained paging vendors to cross the 31-row follow-page probe.
const pagingRows = 32;
const manifestPath = path.join(workdir, 'fixtures.json');
async function readManifest() {
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}
// Which employees do already-retained vendors reference? The vendor table grants no
// privileged read, so the check runs through a real active employee session.
async function vendorCreators(manifest, employeeIds) {
  const reader = Object.values(manifest.identities ?? {}).find(
    (identity) =>
      identity.active === true &&
      ['staff', 'manager', 'admin'].includes(identity.role),
  );
  if (!reader) return null;
  try {
    const client = sessionClient();
    const signedIn = await retryResult('sign in retained fixture reader', () =>
      client.auth.signInWithPassword({
        email: reader.email,
        password: reader.password,
      }),
    );
    if (signedIn.error) return null;
    const result = await retryResult('read retained vendor creators', () =>
      client.from('vendors').select('created_by').in('created_by', employeeIds),
    );
    if (result.error) return null;
    return new Set(result.data.map((row) => row.created_by));
  } catch {
    return null;
  }
}
// Cleanup never throws: a failure here must not skip the report, the remaining Auth
// removal or the manifest handling. Employees (and their Auth users) that retained
// vendors reference cannot be deleted, so they stay and are recorded in the report.
async function removeFixtures(manifest) {
  const cleanup = {
    employees_removed: [],
    employees_retained: [],
    auth_users_removed: [],
    auth_users_retained: [],
    properties_removed: [],
    properties_retained: [],
    failures: [],
  };
  if (!manifest) return cleanup;
  // Ticket #74 fixture properties first: their creator FK would otherwise keep the fixture
  // employees, and the synthetic history/link rows they own are removed with them. Every
  // statement is scoped to the recorded ids and a failure is recorded, never thrown.
  const propertyIds = manifest.propertyIds ?? [];
  if (propertyIds.length) {
    const list = propertyIds.map((id) => `'${id}'`).join(',');
    for (const statement of [
      `delete from public.property_history where property_id in (${list})`,
      `delete from public.property_vendors where property_id in (${list})`,
      `delete from public.activity_events where property_id in (${list})`,
      `delete from public.property_contacts where property_id in (${list})`,
      `delete from public.property_addresses where property_id in (${list})`,
      `delete from public.properties where id in (${list})`,
    ]) {
      try {
        operatorSql(statement);
      } catch (error) {
        cleanup.failures.push(`remove fixture property rows: ${error.message}`);
        break;
      }
    }
    let remaining = propertyIds;
    try {
      remaining = operatorSql(
        `select id::text as id from public.properties where id in (${list})`,
      ).map((row) => row.id);
    } catch (error) {
      cleanup.failures.push(`read fixture properties: ${error.message}`);
    }
    cleanup.properties_removed = propertyIds.filter(
      (id) => !remaining.includes(id),
    );
    cleanup.properties_retained = propertyIds.filter((id) =>
      remaining.includes(id),
    );
  }
  const identities = Object.entries(manifest.identities ?? {});
  const employeeIds = identities
    .map(([, identity]) => identity.employeeId)
    .filter(Boolean);
  let existing = new Set();
  if (employeeIds.length) {
    try {
      const rows = operatorSql(
        `select id::text as id from public.employees where id in (${employeeIds
          .map((id) => `'${id}'`)
          .join(',')})`,
      );
      existing = new Set(rows.map((row) => row.id));
    } catch (error) {
      cleanup.failures.push(`read fixture employees: ${error.message}`);
      existing = new Set(employeeIds);
    }
  }
  const retained = new Set();
  const present = employeeIds.filter((id) => existing.has(id));
  if (present.length) {
    const referenced = await vendorCreators(manifest, present);
    if (referenced === null) {
      for (const id of present) retained.add(id);
      cleanup.failures.push(
        'could not resolve retained vendor creators; fixture employees were left in place',
      );
    } else {
      for (const id of referenced) retained.add(id);
    }
  }
  for (const [name, identity] of identities) {
    if (!identity.employeeId || !existing.has(identity.employeeId)) continue;
    if (retained.has(identity.employeeId)) {
      cleanup.employees_retained.push(identity.employeeId);
      continue;
    }
    try {
      operatorSql(
        `delete from public.employees where id = '${identity.employeeId}'`,
      );
      cleanup.employees_removed.push(identity.employeeId);
    } catch (error) {
      retained.add(identity.employeeId);
      cleanup.employees_retained.push(identity.employeeId);
      cleanup.failures.push(
        `remove fixture employee ${name}: ${error.message}`,
      );
    }
  }
  const users = [
    ...identities.map(([name, identity]) => ({
      name,
      userId: identity.userId,
      employeeId: identity.employeeId ?? null,
    })),
    ...(manifest.unlinked
      ? [
          {
            name: 'unlinked',
            userId: manifest.unlinked.userId,
            employeeId: null,
          },
        ]
      : []),
  ];
  for (const user of users) {
    if (user.employeeId !== null && retained.has(user.employeeId)) {
      cleanup.auth_users_retained.push(user.userId);
      continue;
    }
    let removed;
    try {
      removed = await retryThrown(`remove fixture auth user ${user.name}`, () =>
        ownerClient.auth.admin.deleteUser(user.userId),
      );
    } catch (error) {
      removed = { error };
    }
    const message = removed?.error?.message ?? '';
    // An identity an earlier interrupted run already removed is not a failure.
    if (!removed?.error || /not found/i.test(message)) {
      cleanup.auth_users_removed.push(user.userId);
    } else {
      cleanup.auth_users_retained.push(user.userId);
      cleanup.failures.push(
        `remove fixture auth user ${user.name}: ${message}`,
      );
    }
  }
  return cleanup;
}
async function createFixtures() {
  const manifest = {
    namespace,
    run_token: runToken,
    identities: {},
    unlinked: null,
    retainedVendorIds: [],
    // Ticket #74 link fixtures: synthetic properties this run created, removed before the
    // fixture employees their creator FK would otherwise keep.
    propertyIds: [],
  };
  for (const [name, role, active] of identities) {
    const email = `${filePrefix}.${name}.${runToken}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const created = await retryResult(`create auth user ${name}`, () =>
      ownerClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    assert.equal(created.error, null, `create auth user ${name}`);
    const employeeId = randomUUID();
    operatorSql(
      `insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ('${employeeId}','${created.data.user.id}','${email}','${fixtureName(name)}','${role}',${active})`,
    );
    manifest.identities[name] = {
      userId: created.data.user.id,
      employeeId,
      email,
      password,
      role,
      active,
    };
  }
  const unlinkedEmail = `${filePrefix}.unlinked.${runToken}@example.test`;
  const unlinkedPassword = randomBytes(24).toString('base64url');
  const unlinked = await retryResult('create unlinked auth user', () =>
    ownerClient.auth.admin.createUser({
      email: unlinkedEmail,
      password: unlinkedPassword,
      email_confirm: true,
    }),
  );
  assert.equal(unlinked.error, null, 'create unlinked auth user');
  manifest.unlinked = {
    userId: unlinked.data.user.id,
    email: unlinkedEmail,
    password: unlinkedPassword,
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  return manifest;
}
async function createVendor(client, fields) {
  // One submission key per call: a transient retry converges on the same vendor.
  const key = randomUUID();
  const result = await retryResult('create fixture vendor', () =>
    client.rpc('create_vendor', {
      p_key: key,
      p_display_name: fields.displayName,
      ...(fields.contactName ? { p_contact_name: fields.contactName } : {}),
      ...(fields.phones ? { p_phones: fields.phones } : {}),
      ...(fields.email ? { p_email: fields.email } : {}),
      ...(fields.sourceAddress
        ? { p_source_address: fields.sourceAddress }
        : {}),
      ...(fields.notes ? { p_notes: fields.notes } : {}),
    }),
  );
  assert.equal(result.error, null, `create vendor ${fields.displayName}`);
  return result.data;
}

// ------------------------------------------------------------------ app server
let app = null;
async function startApp() {
  const log = openSync(path.join(workdir, 'app.log'), 'a');
  app = spawn(
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
async function appLoginResponse(email, password) {
  const response = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/json', origin: appUrl },
    body: JSON.stringify({ email, password, locale: 'vi' }),
  });
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
  const response = await fetch(appUrl + route, {
    redirect: 'manual',
    headers: cookies ? { cookie: cookies } : {},
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}
async function appPost(cookies, route, body) {
  const response = await fetch(appUrl + route, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      origin: appUrl,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, body: payload };
}
// Every page the cursor advertises, through the application endpoint.
async function readAllPages(cookies) {
  const entries = [];
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  for (;;) {
    const parameters = new URLSearchParams({ query: 'SGN73' });
    if (cursor) {
      parameters.set('before', cursor.before);
      parameters.set('beforeId', cursor.beforeId);
    }
    const { status, body } = await appGet(
      cookies,
      '/api/vendors?' + parameters.toString(),
    );
    assert.equal(status, 200, `Vendor list read ${status}`);
    assert.ok(Array.isArray(body?.vendors), 'Vendor list shape');
    pages++;
    for (const entry of body.vendors) {
      assert.ok(!seen.has(entry.id), 'No vendor appears on two pages');
      seen.add(entry.id);
      entries.push(entry);
    }
    if (!body.nextCursor) break;
    assert.ok(
      body.vendors.length === 30 || pages < 40,
      'A non-final page exposes 30 vendors',
    );
    cursor = body.nextCursor;
    assert.ok(pages < 40, 'Paging terminated');
  }
  return { entries, pages };
}

// ------------------------------------------------------------------ browsers
const browsers = [];
const profileDirs = [];
const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, '');
// Named bridge ports are hashed into a small range, so stale bridges from another run can collide.
const bridgePorts = new Map();
let nextBridgePort = 20000 + (Number.parseInt(runToken, 16) % 40000);
function allocateBridgePort() {
  const port = nextBridgePort;
  nextBridgePort = nextBridgePort >= 59999 ? 20000 : nextBridgePort + 1;
  return port;
}
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
  const sessionName = `${session}-${runStamp}`;
  let bridgePort = bridgePorts.get(sessionName) ?? allocateBridgePort();
  let result;
  for (let attempt = 0; attempt < 16; attempt++) {
    result = spawnSync(process.execPath, [browserCli, ...args], {
      encoding: 'utf8',
      timeout: 120000,
      env: {
        ...process.env,
        CHROME_DEVTOOLS_AXI_SESSION: sessionName,
        CHROME_DEVTOOLS_AXI_PORT: String(bridgePort),
        CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
        CHROME_DEVTOOLS_AXI_BROWSER_URL: `http://127.0.0.1:${cdpPort}`,
        CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '',
        CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '180000',
      },
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
    if (result.status === 0) {
      bridgePorts.set(sessionName, bridgePort);
      return result.stdout;
    }
    if (
      !/BRIDGE_NOT_READY/.test(output) ||
      !/(code 48|already in use)/i.test(output) ||
      attempt === 15
    )
      break;
    bridgePort = allocateBridgePort();
  }
  const diagnostic = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
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
  // A timed-out wait must say what the browser actually showed; naming only the missing
  // state leaves a real integration failure indistinguishable from a slow read.
  let state;
  try {
    state = evaluate(
      session,
      cdpPort,
      `() => ({
        path: location.pathname,
        title: document.title,
        signedOut: Boolean(document.querySelector('#email')),
        vendorPanel: Boolean(document.querySelector('[data-od-id="panel-vendors"]')),
        recordBody: Boolean(document.querySelector('.detail-body')),
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
      })`,
    );
  } catch {
    state = 'unreadable';
  }
  assert.fail(`Timed out waiting for browser state: ${JSON.stringify(state)}`);
}
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
async function browserSignIn(session, cdpPort, email, password, landing) {
  browser(session, cdpPort, ['open', `${appUrl}/login?lang=vi`]);
  evaluate(session, cdpPort, setInput('#email', email));
  evaluate(session, cdpPort, setInput('#password', password));
  evaluate(
    session,
    cdpPort,
    `(() => { document.querySelector('form').requestSubmit(); return true; })()`,
  );
  await waitFor(
    session,
    cdpPort,
    `() => location.pathname === ${JSON.stringify(landing)}`,
  );
}
const vendorScreen = (session, cdpPort) => {
  const value = evaluate(
    session,
    cdpPort,
    `() => {
      const table = document.querySelector('main table.data-table');
      return {
        path: location.pathname + location.search,
        lang: document.documentElement.lang,
        heading: document.querySelector('h1')?.textContent?.trim() ?? null,
        table: Boolean(table),
        rows: table
          ? [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((cell) => cell.textContent.trim()))
          : [],
        createPanel: Boolean(document.querySelector('#vendor-create')),
        createForm: Boolean(document.querySelector('form input[name=displayName]')),
        empty: document.querySelector('.state-panel h3')?.textContent?.trim() ?? null,
        pager: [...document.querySelectorAll('.pagination .pager-btn')].map((link) => link.getAttribute('href')),
      };
    }`,
  );
  assert.equal(typeof value, 'object', 'Unexpected vendor screen payload');
  return value;
};
const detailScreen = (session, cdpPort) => {
  const value = evaluate(
    session,
    cdpPort,
    `() => {
      const facts = [...document.querySelectorAll('.facts .fact')].map((fact) => ({
        label: fact.querySelector('dt')?.textContent?.trim() ?? null,
        value: fact.querySelector('dd')?.textContent?.trim() ?? null,
        unknown: Boolean(fact.querySelector('dd.is-unknown')),
      }));
      return {
        path: location.pathname,
        heading: document.querySelector('h1')?.textContent?.trim() ?? null,
        facts,
        editControls: [...document.querySelectorAll('button')].filter((node) => /Sửa|Lưu|Save|Edit/.test(node.textContent)).length,
      };
    }`,
  );
  assert.equal(typeof value, 'object', 'Unexpected detail screen payload');
  return value;
};

// ------------------------------------------------------------------ ticket #74 links
// A synthetic property created through the guarded operation, so the link fixtures never
// touch a real record's history.
async function createLinkProperty(client, address) {
  const result = await retryResult('create link fixture property', () =>
    client.rpc('create_property', {
      p_mode: 'sale',
      p_facts: {},
      p_address: { format: 'legacy', address_text: address },
    }),
  );
  assert.equal(result.error, null, 'create link fixture property');
  return result.data;
}
async function propertyRevisionOf(client, id) {
  const result = await retryResult('read fixture property revision', () =>
    client
      .from('properties')
      .select('revision,status,record_review_status')
      .eq('id', id)
      .single(),
  );
  assert.equal(result.error, null, 'read fixture property revision');
  return result.data;
}
const vendorSection = (session, cdpPort) => {
  const value = evaluate(
    session,
    cdpPort,
    `() => {
      const panel = document.querySelector('[data-od-id="panel-vendors"]');
      return {
        path: location.pathname,
        lang: document.documentElement.lang,
        heading: panel?.querySelector('h2')?.textContent?.trim() ?? null,
        rows: panel
          ? [...panel.querySelectorAll('.record')].map((row) => ({
              name: row.querySelector('.record-title')?.textContent?.trim() ?? null,
              meta: row.querySelector('.record-meta')?.textContent?.trim() ?? null,
            }))
          : [],
        linkSummary: panel?.querySelector('details.maintenance summary')?.textContent?.trim() ?? null,
        unlinkControls: panel
          ? [...panel.querySelectorAll('button')].filter((node) => /Gỡ liên kết|Unlink/.test(node.textContent)).length
          : 0,
        history: [...document.querySelectorAll('.hist-row')].map((row) => ({
          target: row.querySelector('.hist-field')?.textContent?.trim() ?? null,
          when: row.querySelector('.hist-when')?.textContent?.trim() ?? null,
        })),
      };
    }`,
  );
  assert.equal(typeof value, 'object', 'Unexpected vendor section payload');
  return value;
};
const clickPanelButton = (text) => `(() => {
  const panel = document.querySelector('[data-od-id="panel-vendors"]');
  const button = [...panel.querySelectorAll('button')].find((node) => node.textContent.trim() === ${JSON.stringify(text)});
  if (!button) return false;
  button.click();
  return true;
})()`;

// Ticket #74 through real independent sessions, the real application endpoints and the
// rendered property record: link visibility, duplicate/stale/archive refusal and the
// retained unlink history.
async function vendorLinkJourney({
  manifest,
  staff,
  admin,
  sales,
  inactive,
  unlinked,
  anonymous,
  staffCookies,
  salesCookies,
  inactiveCookies,
  unlinkedCookies,
}) {
  const liveProperty = await createLinkProperty(
    staff,
    fixtureName('liên kết A'),
  );
  const otherProperty = await createLinkProperty(
    staff,
    fixtureName('liên kết B'),
  );
  const archivedProperty = await createLinkProperty(
    staff,
    fixtureName('liên kết C'),
  );
  manifest.propertyIds.push(liveProperty, otherProperty, archivedProperty);
  operatorSql(
    `update public.properties set archived_at = now() where id = '${archivedProperty}'`,
  );
  const vendor = await createVendor(staff, {
    displayName: fixtureName('nhà cung cấp liên kết'),
    contactName: 'Phạm Văn Kỹ',
    phones: ['090 555 6677'],
  });
  manifest.retainedVendorIds.push(vendor.id);
  report.retained_properties = [...manifest.propertyIds];
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });

  const revision = (await propertyRevisionOf(staff, liveProperty)).revision;
  const linkArgs = {
    p_property_id: liveProperty,
    p_vendor_id: vendor.id,
    p_expected_property_revision: revision,
  };
  const salesLink = await rpcCall(
    'sales link',
    sales,
    'link_property_vendor',
    linkArgs,
  );
  assert.equal(salesLink.error, null, refusal(salesLink.error, 'no error'));
  assert.equal(salesLink.data.created, true);
  const salesUnlink = await rpcCall(
    'sales unlink',
    sales,
    'unlink_property_vendor',
    {
      p_property_id: liveProperty,
      p_vendor_id: vendor.id,
      p_expected_link_revision: salesLink.data.revision,
    },
  );
  assert.equal(salesUnlink.error, null, refusal(salesUnlink.error, 'no error'));
  assert.equal(salesUnlink.data.removed, true);
  const salesInsert = await sales.from('property_vendors').insert({
    property_id: liveProperty,
    vendor_id: vendor.id,
    created_by: manifest.identities.sales.employeeId,
  });
  assert.equal(
    salesInsert.error?.code,
    '42501',
    refusal(salesInsert.error, '42501'),
  );
  const salesDelete = await sales
    .from('property_vendors')
    .delete()
    .eq('property_id', liveProperty)
    .select('vendor_id');
  assert.ok(
    salesDelete.error?.code === '42501' ||
      (salesDelete.data ?? []).length === 0,
    refusal(salesDelete.error, '42501 or no deleted row'),
  );
  assert.equal(
    (
      await readRows('sales reads no link row', () =>
        sales
          .from('property_vendors')
          .select('vendor_id')
          .eq('property_id', liveProperty),
      )
    ).length,
    0,
  );
  observed(
    'a sales employee links and unlinks while direct writes stay blocked',
  );

  const created = await rpcCall(
    'first confirmed link',
    staff,
    'link_property_vendor',
    linkArgs,
  );
  assert.equal(created.error, null, refusal(created.error, 'no error'));
  assert.equal(typeof created.data.created, 'boolean');
  assert.equal(created.data.display_name, vendor.display_name);
  const converged = await rpcCall(
    'convergent duplicate link',
    staff,
    'link_property_vendor',
    linkArgs,
  );
  assert.equal(converged.error, null, refusal(converged.error, 'no error'));
  assert.equal(converged.data.created, false);
  assert.equal(converged.data.revision, created.data.revision);
  const section = await rpcCall(
    'property vendor section read',
    sales,
    'list_property_vendors',
    { p_property_id: liveProperty },
  );
  assert.equal(section.error, null, refusal(section.error, 'no error'));
  assert.deepEqual(
    section.data.map((row) => row.vendor_id),
    [vendor.id],
  );
  assert.equal(section.data[0].contact_name, 'Phạm Văn Kỹ');
  assert.deepEqual(section.data[0].phones, ['090 555 6677']);

  assert.ok(
    inactiveCookies,
    'Inactive login must retain its Auth session cookie',
  );
  assert.ok(
    unlinkedCookies,
    'Unlinked login must retain its Auth session cookie',
  );
  for (const caller of [
    { name: 'unlinked', client: unlinked, cookies: unlinkedCookies },
    { name: 'inactive', client: inactive, cookies: inactiveCookies },
    { name: 'anonymous', client: anonymous, cookies: null },
  ]) {
    const deniedLink = await rpcCall(
      `${caller.name} link refusal`,
      caller.client,
      'link_property_vendor',
      linkArgs,
    );
    assert.equal(
      deniedLink.error?.code,
      '42501',
      refusal(deniedLink.error, '42501'),
    );
    const deniedUnlink = await rpcCall(
      `${caller.name} unlink refusal`,
      caller.client,
      'unlink_property_vendor',
      {
        p_property_id: liveProperty,
        p_vendor_id: vendor.id,
        p_expected_link_revision: section.data[0].revision,
      },
    );
    assert.equal(
      deniedUnlink.error?.code,
      '42501',
      refusal(deniedUnlink.error, '42501'),
    );
    const deniedLinkRoute = await endpointCall(
      `${caller.name} link endpoint refusal`,
      () =>
        appPost(caller.cookies, `/api/properties/${liveProperty}/vendors`, {
          vendorId: vendor.id,
          propertyRevision: revision,
        }),
    );
    assert.ok(
      [401, 403].includes(deniedLinkRoute.status),
      JSON.stringify(deniedLinkRoute.body),
    );
    const deniedUnlinkRoute = await endpointCall(
      `${caller.name} unlink endpoint refusal`,
      () =>
        appPost(
          caller.cookies,
          `/api/properties/${liveProperty}/vendors/${vendor.id}`,
          { revision: section.data[0].revision },
        ),
    );
    assert.ok(
      [401, 403].includes(deniedUnlinkRoute.status),
      JSON.stringify(deniedUnlinkRoute.body),
    );
  }
  const unchanged = await readRows(
    'denied callers leave the link unchanged',
    () =>
      sales
        .from('property_vendors')
        .select('vendor_id,revision')
        .eq('property_id', liveProperty),
  );
  assert.deepEqual(unchanged, [
    { vendor_id: vendor.id, revision: section.data[0].revision },
  ]);
  observed(
    'anonymous, unlinked and inactive callers are refused by both link paths without changing the relationship',
  );
  observed(
    'a duplicate link converges on the recorded relationship and a property reader sees it',
    { vendor: vendor.id, property: liveProperty },
  );

  // A vendor link is not ownership, a reservation or rental occupancy, and it credits no
  // owner-contact access on the property it is linked to.
  const credits = await readRows('owner-contact credit check', () =>
    admin
      .from('activity_events')
      .select('id')
      .eq('property_id', liveProperty)
      .eq('kind', 'owner_contact_access'),
  );
  assert.equal(credits.length, 0);
  const locks = await readRows('reservation lock check', () =>
    admin.from('property_locks').select('id').eq('property_id', liveProperty),
  );
  assert.equal(locks.length, 0);
  const ownership = await readRows('owner link check', () =>
    sales
      .from('property_contacts')
      .select('contact_id')
      .eq('property_id', liveProperty),
  );
  assert.equal(ownership.length, 0);
  const facts = await propertyRevisionOf(staff, liveProperty);
  assert.equal(facts.record_review_status, 'pending');
  assert.equal(facts.status, 'available');
  observed(
    'linking writes no owner link, lock, owner-contact credit or property-fact change',
  );

  const stale = await rpcCall(
    'stale property link',
    staff,
    'link_property_vendor',
    { ...linkArgs, p_expected_property_revision: randomUUID() },
  );
  assert.equal(stale.error?.code, 'PT409', refusal(stale.error, 'PT409'));
  const staleUnlink = await rpcCall(
    'stale link revision',
    staff,
    'unlink_property_vendor',
    {
      p_property_id: liveProperty,
      p_vendor_id: vendor.id,
      p_expected_link_revision: randomUUID(),
    },
  );
  assert.equal(
    staleUnlink.error?.code,
    'PT409',
    refusal(staleUnlink.error, 'PT409'),
  );
  const missingVendor = await rpcCall(
    'missing vendor link',
    staff,
    'link_property_vendor',
    { ...linkArgs, p_vendor_id: '00000000-0000-4000-8000-00000000dead' },
  );
  assert.equal(
    missingVendor.error?.code,
    '23503',
    refusal(missingVendor.error, '23503'),
  );
  assert.equal(
    (
      await readRows('link row survives the refusals', () =>
        sales
          .from('property_vendors')
          .select('vendor_id')
          .eq('property_id', liveProperty),
      )
    ).length,
    1,
  );
  observed('a stale or missing-company link context changes nothing');

  // The archived boundary: a new link is refused, and the existing projection hides the
  // archived property from a reader who is not a reviewer.
  const archivedRevision = (await propertyRevisionOf(admin, archivedProperty))
    .revision;
  const archivedLink = await rpcCall(
    'archived property link refusal',
    staff,
    'link_property_vendor',
    {
      p_property_id: archivedProperty,
      p_vendor_id: vendor.id,
      p_expected_property_revision: archivedRevision,
    },
  );
  assert.equal(
    archivedLink.error?.code,
    '42501',
    refusal(archivedLink.error, '42501'),
  );
  operatorSql(
    `insert into public.property_vendors(property_id,vendor_id,created_by) values ('${archivedProperty}','${vendor.id}','${manifest.identities.staff.employeeId}')`,
  );
  const salesArchivedSection = await rpcCall(
    'sales archived section read',
    sales,
    'list_property_vendors',
    { p_property_id: archivedProperty },
  );
  assert.equal(
    salesArchivedSection.error,
    null,
    refusal(salesArchivedSection.error, 'no error'),
  );
  assert.equal(salesArchivedSection.data.length, 0);
  const adminArchivedSection = await rpcCall(
    'reviewer archived section read',
    admin,
    'list_property_vendors',
    { p_property_id: archivedProperty },
  );
  assert.equal(adminArchivedSection.data.length, 1);
  const salesReach = await rpcCall(
    'sales vendor reach',
    sales,
    'list_vendor_properties',
    { p_vendor_id: vendor.id },
  );
  assert.equal(salesReach.error, null, refusal(salesReach.error, 'no error'));
  assert.ok(
    !salesReach.data.some((row) => row.property_id === archivedProperty),
    'The archived property stays out of the sales projection',
  );
  const adminReach = await rpcCall(
    'reviewer vendor reach',
    admin,
    'list_vendor_properties',
    { p_vendor_id: vendor.id },
  );
  assert.ok(
    adminReach.data.some((row) => row.property_id === archivedProperty),
    'A reviewer sees the archived linked property',
  );
  observed(
    'an archived property refuses a new link and hides its links outside reviewer authority',
  );

  // Unlink: only the current relationship goes; the vendor and another property's link
  // stay, and link changes do not write property-history rows.
  const secondLink = await rpcCall(
    'second property link',
    staff,
    'link_property_vendor',
    {
      p_property_id: otherProperty,
      p_vendor_id: vendor.id,
      p_expected_property_revision: (
        await propertyRevisionOf(staff, otherProperty)
      ).revision,
    },
  );
  assert.equal(secondLink.error, null, refusal(secondLink.error, 'no error'));
  const historyBefore = await readRows('link history read', () =>
    sales
      .from('property_history')
      .select('target,actor_name,changed_fields,before_values,after_values')
      .eq('property_id', liveProperty)
      .eq('target', 'vendor_link')
      .order('occurred_at'),
  );
  assert.equal(historyBefore.length, 0);
  const removed = await rpcCall(
    'confirmed unlink',
    staff,
    'unlink_property_vendor',
    {
      p_property_id: liveProperty,
      p_vendor_id: vendor.id,
      p_expected_link_revision: section.data[0].revision,
    },
  );
  // A retry after a lost response reports the link as already removed; the removed row is
  // asserted immediately below, so the correction itself stays proven.
  assert.ok(
    removed.error === null || removed.error?.code === 'P0002',
    refusal(removed.error, 'no error or P0002'),
  );
  if (removed.error === null) assert.equal(removed.data.removed, true);
  assert.equal(
    (
      await readRows('unlinked property reads no link', () =>
        sales
          .from('property_vendors')
          .select('vendor_id')
          .eq('property_id', liveProperty),
      )
    ).length,
    0,
  );
  const retainedVendor = (
    await readRows('retained vendor read', () =>
      sales.from('vendors').select(VENDOR_COLUMNS).eq('id', vendor.id),
    )
  )[0];
  assert.equal(retainedVendor.display_name, vendor.display_name);
  assert.equal(retainedVendor.contact_name, 'Phạm Văn Kỹ');
  const otherSection = await rpcCall(
    'other property section read',
    sales,
    'list_property_vendors',
    { p_property_id: otherProperty },
  );
  assert.deepEqual(
    otherSection.data.map((row) => row.vendor_id),
    [vendor.id],
  );
  const historyAfter = await readRows('unlink history read', () =>
    sales
      .from('property_history')
      .select('target,changed_fields,before_values,after_values')
      .eq('property_id', liveProperty)
      .eq('target', 'vendor_link')
      .order('occurred_at'),
  );
  assert.equal(historyAfter.length, 0);
  observed(
    'unlink keeps the vendor and the unrelated link without property-history rows',
    { vendor: vendor.id },
  );

  // ---------------------------------------------------------------- application
  const salesSectionRoute = await endpointCall('sales section route', () =>
    appGet(salesCookies, `/api/properties/${liveProperty}/vendors`),
  );
  assert.equal(salesSectionRoute.status, 200);
  assert.deepEqual(salesSectionRoute.body.vendors, []);
  const salesLinkRoute = await endpointCall('sales link route', () =>
    appPost(salesCookies, `/api/properties/${liveProperty}/vendors`, {
      vendorId: vendor.id,
      propertyRevision: revision,
    }),
  );
  assert.equal(salesLinkRoute.status, 200, JSON.stringify(salesLinkRoute.body));
  assert.equal(salesLinkRoute.body.link.vendorId, vendor.id);
  const salesRouteSection = await rpcCall(
    'sales route link read',
    sales,
    'list_property_vendors',
    { p_property_id: liveProperty },
  );
  const salesUnlinkRoute = await endpointCall('sales unlink route', () =>
    appPost(
      salesCookies,
      `/api/properties/${liveProperty}/vendors/${vendor.id}`,
      { revision: salesRouteSection.data[0].revision },
    ),
  );
  assert.equal(
    salesUnlinkRoute.status,
    200,
    JSON.stringify(salesUnlinkRoute.body),
  );
  const staffLinkRoute = await endpointCall('staff link route', () =>
    appPost(staffCookies, `/api/properties/${liveProperty}/vendors`, {
      vendorId: vendor.id,
      propertyRevision: revision,
    }),
  );
  assert.equal(staffLinkRoute.status, 200, JSON.stringify(staffLinkRoute.body));
  assert.equal(staffLinkRoute.body.link.vendorId, vendor.id);
  const malformedRoute = await endpointCall('malformed link route', () =>
    appPost(staffCookies, `/api/properties/${liveProperty}/vendors`, {
      vendorId: vendor.id,
    }),
  );
  assert.equal(malformedRoute.status, 400);
  const staleUnlinkRoute = await endpointCall('stale unlink route', () =>
    appPost(
      staffCookies,
      `/api/properties/${liveProperty}/vendors/${vendor.id}`,
      { revision: randomUUID() },
    ),
  );
  assert.equal(staleUnlinkRoute.status, 409);
  assert.equal(staleUnlinkRoute.body.error, 'stale-edit');
  const currentLink = await rpcCall(
    'current link read',
    sales,
    'list_property_vendors',
    { p_property_id: liveProperty },
  );
  const unlinkRoute = await endpointCall('unlink route', () =>
    appPost(
      staffCookies,
      `/api/properties/${liveProperty}/vendors/${vendor.id}`,
      { revision: currentLink.data[0].revision },
    ),
  );
  assert.equal(unlinkRoute.status, 200, JSON.stringify(unlinkRoute.body));
  const afterRouteSection = await rpcCall(
    'property section after route unlink',
    sales,
    'list_property_vendors',
    { p_property_id: liveProperty },
  );
  assert.equal(
    afterRouteSection.error,
    null,
    refusal(afterRouteSection.error, 'no error'),
  );
  assert.deepEqual(afterRouteSection.data, []);
  const vendorDetailRoute = await appGet(
    salesCookies,
    '/api/vendors/' + vendor.id,
  );
  assert.equal(vendorDetailRoute.status, 200);
  assert.equal(vendorDetailRoute.body.vendor.displayName, vendor.display_name);
  assert.ok(Array.isArray(vendorDetailRoute.body.properties));
  assert.ok(
    !vendorDetailRoute.body.properties.some(
      (property) => property.propertyId === archivedProperty,
    ),
    'The sales projection hides the archived linked property',
  );
  assert.ok(
    !vendorDetailRoute.body.properties.some(
      (property) => property.propertyId === liveProperty,
    ),
    'The route unlink removes the live property from the vendor projection',
  );
  assert.ok(
    vendorDetailRoute.body.properties.some(
      (property) => property.propertyId === otherProperty,
    ),
  );
  const historyRoute = await appGet(
    salesCookies,
    `/api/properties/${liveProperty}/history`,
  );
  assert.equal(historyRoute.status, 200);
  const linkEvents = historyRoute.body.events.filter(
    (event) => event.target === 'vendor_link',
  );
  assert.equal(linkEvents.length, 0);
  observed(
    'the endpoints bind the link bodies without writing property history',
  );

  // ---------------------------------------------------------------- browser
  await rpcCall('browser journey link', staff, 'link_property_vendor', {
    ...linkArgs,
    p_expected_property_revision: (
      await propertyRevisionOf(staff, liveProperty)
    ).revision,
  });
  // The same read through the application first: the rendered page must not be the only
  // evidence that the record is readable for this session.
  const staffDetailRoute = await endpointCall('staff record route', () =>
    appGet(staffCookies, `/api/properties/${liveProperty}`),
  );
  assert.equal(
    staffDetailRoute.status,
    200,
    JSON.stringify(staffDetailRoute.body),
  );
  assert.equal(staffDetailRoute.body.property.id, liveProperty);
  // Every CDP session shares one browser profile and cookie jar, so the last sign-in wins:
  // this journey signs in again instead of assuming the directory journey left it signed in.
  await browserSignIn(
    'sgn73-staff',
    9336,
    manifest.identities.staff.email,
    manifest.identities.staff.password,
    '/properties',
  );
  browser('sgn73-staff', 9336, [
    'open',
    `${appUrl}/properties/${liveProperty}`,
  ]);
  await waitFor(
    'sgn73-staff',
    9336,
    `() => Boolean(document.querySelector('[data-od-id="panel-vendors"]'))`,
    120,
  );
  // The shell keeps the employee's saved locale, which the directory journey left on
  // English, so the VI/default assertions below select Vietnamese explicitly first.
  evaluate(
    'sgn73-staff',
    9336,
    `(() => { document.querySelector('.lang-switch button[lang=vi]').click(); return true; })()`,
  );
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelector('[data-od-id="panel-vendors"] h2')?.textContent?.trim() === 'Nhà cung cấp'`,
    120,
  );
  const staffSection = vendorSection('sgn73-staff', 9336);
  assert.equal(staffSection.heading, 'Nhà cung cấp');
  assert.equal(staffSection.rows.length, 1);
  assert.equal(staffSection.rows[0].name, vendor.display_name);
  assert.equal(staffSection.rows[0].meta.includes('Phạm Văn Kỹ'), true);
  assert.equal(staffSection.linkSummary, 'Liên kết nhà cung cấp đã ghi nhận');
  assert.equal(staffSection.unlinkControls, 1);
  evaluate(
    'sgn73-staff',
    9336,
    `(() => { document.querySelector('.lang-switch button[lang=en]').click(); return true; })()`,
  );
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelector('[data-od-id="panel-vendors"] h2')?.textContent?.trim() === 'Vendors'`,
  );
  const englishSection = vendorSection('sgn73-staff', 9336);
  assert.equal(englishSection.lang, 'en');
  assert.equal(englishSection.linkSummary, 'Link a recorded vendor');
  assert.equal(englishSection.unlinkControls, 1);
  evaluate(
    'sgn73-staff',
    9336,
    `(() => { document.querySelector('.lang-switch button[lang=vi]').click(); return true; })()`,
  );
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelector('[data-od-id="panel-vendors"] h2')?.textContent?.trim() === 'Nhà cung cấp'`,
  );
  observed('the property vendor section renders equivalent English labels');

  // Remove the mistaken link through the rendered confirmation.
  evaluate('sgn73-staff', 9336, clickPanelButton('Gỡ liên kết'));
  await waitFor(
    'sgn73-staff',
    9336,
    `() => [...document.querySelectorAll('[data-od-id="panel-vendors"] button')].some((node) => node.textContent.trim() === 'Xác nhận gỡ liên kết')`,
  );
  evaluate('sgn73-staff', 9336, clickPanelButton('Xác nhận gỡ liên kết'));
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelectorAll('[data-od-id="panel-vendors"] .record').length === 0`,
  );
  const afterUnlink = vendorSection('sgn73-staff', 9336);
  assert.equal(afterUnlink.rows.length, 0);
  assert.equal(
    afterUnlink.history.some((row) => row.target === 'Liên kết nhà cung cấp'),
    false,
    'The unlink stays out of property history',
  );
  observed(
    'an active employee removes a mistaken link in the UI without writing property history',
  );

  // Link the company again through the rendered picker.
  evaluate(
    'sgn73-staff',
    9336,
    `(() => { const details = document.querySelector('[data-od-id="panel-vendors"] details'); details.open = true; return details.open; })()`,
  );
  evaluate(
    'sgn73-staff',
    9336,
    setInput('#vendor-link-search', vendor.display_name),
  );
  evaluate('sgn73-staff', 9336, clickPanelButton('Tìm nhà cung cấp'));
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelectorAll('#vendor-link-choose option').length === 1`,
  );
  evaluate(
    'sgn73-staff',
    9336,
    clickPanelButton('Liên kết với bất động sản này'),
  );
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelector('[data-od-id="panel-vendors"] .record-title')?.textContent?.trim() === ${JSON.stringify(vendor.display_name)}`,
  );
  assert.equal(vendorSection('sgn73-staff', 9336).rows.length, 1);
  observed(
    'an active employee links a recorded vendor from the property record',
  );

  await browserSignIn(
    'sgn73-sales',
    9336,
    manifest.identities.sales.email,
    manifest.identities.sales.password,
    '/properties',
  );
  browser('sgn73-sales', 9336, [
    'open',
    `${appUrl}/properties/${liveProperty}`,
  ]);
  await waitFor(
    'sgn73-sales',
    9336,
    `() => Boolean(document.querySelector('[data-od-id="panel-vendors"] .record'))`,
  );
  const salesSection = vendorSection('sgn73-sales', 9336);
  assert.equal(salesSection.rows.length, 1);
  assert.equal(salesSection.rows[0].name, vendor.display_name);
  assert.equal(salesSection.linkSummary, 'Liên kết nhà cung cấp đã ghi nhận');
  assert.equal(salesSection.unlinkControls, 1);
  observed(
    'a sales employee sees the property vendor link and unlink controls',
  );
}

// ------------------------------------------------------------------ run
const before = { vendors: null, employees: null };
let manifest = null;
const report = {
  issue: 73,
  issues: [73, 74],
  namespace,
  run_token: runToken,
  started_at: new Date().toISOString(),
  observations,
  retained_vendors: [],
  retained_properties: [],
  before,
  limitations: [
    'Supabase Auth email delivery and invitation acceptance are outside this slice.',
    'The vendor slice has no deletion path, so the synthetic SGN73 vendor rows are retained; the report lists their exact ids and the fixture identities those rows reference.',
    'Ticket #74 link fixtures are synthetic properties created by this harness, and their link and history rows are removed with them; a retained vendor keeps no property link.',
    'A hosted/staging concurrent-session write race remains a gate; embedded contention is covered by the schema harness.',
  ],
};
let failure = null;
try {
  // A previous interrupted run may have left identities behind; remove what it can and
  // record what must stay before this run creates fresh, uniquely named fixtures.
  report.previous_cleanup = await removeFixtures(await readManifest());
  manifest = await createFixtures();
  report.retained_vendors = manifest.retainedVendorIds;
  const staff = await signInClient(
    manifest.identities.staff.email,
    manifest.identities.staff.password,
  );
  const manager = await signInClient(
    manifest.identities.manager.email,
    manifest.identities.manager.password,
  );
  const admin = await signInClient(
    manifest.identities.admin.email,
    manifest.identities.admin.password,
  );
  const sales = await signInClient(
    manifest.identities.sales.email,
    manifest.identities.sales.password,
  );
  const inactive = await signInClient(
    manifest.identities.inactive.email,
    manifest.identities.inactive.password,
  );
  const unlinked = await signInClient(
    manifest.unlinked.email,
    manifest.unlinked.password,
  );
  before.employees = (
    await retryResult('baseline employees', () =>
      ownerClient.from('employees').select('id'),
    )
  ).data.length;
  before.vendors = (
    await retryResult('baseline vendors', () =>
      sales.from('vendors').select('id'),
    )
  ).data.length;

  // A separately named fixture per role proves one confirmed identity per permitted create.
  const staffVendorName = fixtureName('Nhà cung cấp chính');
  const staffVendor = await createVendor(staff, {
    displayName: staffVendorName,
    contactName: 'Nguyễn Văn Ứng',
    phones: ['090 123 4567', '+84 (0)28 3822 1234'],
    email: 'ung.dung@example.test',
    sourceAddress: '12 Lý Thường Kiệt, Phường 14, Quận 10, TP.HCM',
    notes: 'Giao hàng buổi sáng\nThanh toán theo tháng',
  });
  manifest.retainedVendorIds.push(staffVendor.id);
  const managerVendor = await createVendor(manager, {
    displayName: fixtureName('Đại lý sắt thép'),
  });
  manifest.retainedVendorIds.push(managerVendor.id);
  const adminVendor = await createVendor(admin, {
    displayName: fixtureName('Công ty hạ tầng'),
    phones: ['028 7300 1234'],
  });
  manifest.retainedVendorIds.push(adminVendor.id);
  for (let index = 0; index < pagingRows; index++) {
    const vendor = await createVendor(staff, {
      displayName: fixtureName(`page ${String(index).padStart(2, '0')}`),
      contactName: index % 2 === 0 ? fixtureName(`liên hệ ${index}`) : null,
    });
    manifest.retainedVendorIds.push(vendor.id);
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  observed(
    'staff, manager and admin create one confirmed vendor each through guarded sessions',
    { vendors: manifest.retainedVendorIds.length },
  );

  // ---------------------------------------------------------------- direct RLS
  const anonymousRead = await anonClient.from('vendors').select(VENDOR_COLUMNS);
  assert.ok(anonymousRead.error, 'Anonymous table read must fail');
  const anonymousList = await anonClient.rpc('list_vendors', {});
  assert.ok(anonymousList.error, 'Anonymous bounded list must fail');
  const anonymousCreate = await anonClient.rpc('create_vendor', {
    p_key: randomUUID(),
    p_display_name: fixtureName('forged'),
  });
  assert.equal(anonymousCreate.error?.code, '42501');
  assert.equal(
    (
      await sales
        .from('vendors')
        .select('id')
        .eq('display_name', fixtureName('forged'))
    ).data.length,
    0,
  );
  observed('anonymous callers read no vendor row and cannot create one');

  const unlinkedRead = await unlinked.from('vendors').select(VENDOR_COLUMNS);
  assert.equal(unlinkedRead.error, null);
  assert.equal(unlinkedRead.data.length, 0, 'Unlinked read is empty');
  const unlinkedList = await unlinked.rpc('list_vendors', {});
  assert.equal(unlinkedList.error, null);
  assert.equal(unlinkedList.data.length, 0, 'Unlinked bounded list is empty');
  const unlinkedCreate = await unlinked.rpc('create_vendor', {
    p_key: randomUUID(),
    p_display_name: fixtureName('unlinked forged'),
  });
  assert.equal(unlinkedCreate.error?.code, '42501');
  observed(
    'an authenticated unlinked identity reads nothing and cannot create',
  );

  const inactiveRead = await inactive.from('vendors').select(VENDOR_COLUMNS);
  assert.equal(inactiveRead.error, null);
  assert.equal(inactiveRead.data.length, 0, 'Inactive read is empty');
  const inactiveCreate = await inactive.rpc('create_vendor', {
    p_key: randomUUID(),
    p_display_name: fixtureName('inactive forged'),
  });
  assert.equal(inactiveCreate.error?.code, '42501');
  observed('an inactive identity reads nothing and cannot create');

  const salesRead = await sales.from('vendors').select(VENDOR_COLUMNS);
  assert.equal(salesRead.error, null);
  assert.ok(salesRead.data.length >= manifest.retainedVendorIds.length);
  const salesCreate = await sales.rpc('create_vendor', {
    p_key: randomUUID(),
    p_display_name: fixtureName('sales forged'),
  });
  assert.equal(salesCreate.error?.code, '42501');
  const salesInsert = await sales.from('vendors').insert({
    display_name: fixtureName('forged direct'),
    created_by: manifest.identities.sales.employeeId,
    submission_key: randomUUID(),
  });
  assert.ok(salesInsert.error, 'A direct vendor insert must fail');
  const salesUpdate = await sales
    .from('vendors')
    .update({ display_name: 'Rewritten' })
    .eq('id', staffVendor.id)
    .select('id');
  assert.ok(salesUpdate.error || (salesUpdate.data ?? []).length === 0);
  const salesDelete = await sales
    .from('vendors')
    .delete()
    .eq('id', staffVendor.id)
    .select('id');
  assert.ok(salesDelete.error || (salesDelete.data ?? []).length === 0);
  const preserved = await sales
    .from('vendors')
    .select('display_name')
    .eq('id', staffVendor.id)
    .single();
  assert.equal(preserved.data.display_name, staffVendor.display_name);
  observed(
    'a sales employee reads the directory while every mutation path stays denied',
  );

  // Same-key retry and conflicting reuse on a real session.
  const retryKey = randomUUID();
  const retryPayload = {
    p_key: retryKey,
    p_display_name: fixtureName('retry'),
  };
  const first = await staff.rpc('create_vendor', retryPayload);
  assert.equal(first.error, null);
  const retried = await staff.rpc('create_vendor', retryPayload);
  assert.equal(retried.error, null);
  assert.equal(retried.data.id, first.data.id);
  manifest.retainedVendorIds.push(first.data.id);
  const conflicted = await staff.rpc('create_vendor', {
    p_key: retryKey,
    p_display_name: fixtureName('retry changed'),
  });
  assert.equal(conflicted.error?.code, '23505');
  const malformed = await staff.rpc('create_vendor', {
    p_key: randomUUID(),
    p_display_name: '   ',
  });
  assert.equal(malformed.error?.code, '23514');
  observed(
    'a same-key retry converges on one vendor and a conflicting or malformed create changes nothing',
  );

  // ---------------------------------------------------------------- bounded reads
  const wide = await sales.rpc('list_vendors', { p_limit: 100 });
  assert.equal(wide.error, null);
  assert.ok(wide.data.length <= 31, 'The database clamps the page');
  const overLong = await sales.rpc('list_vendors', {
    p_query: 'a'.repeat(121),
  });
  assert.equal(overLong.error, null);
  assert.equal(overLong.data.length, 0, 'An over-long query returns no rows');
  const literal = await sales.rpc('list_vendors', {
    p_query: '%_',
  });
  assert.equal(literal.error, null);
  assert.ok(
    literal.data.every((row) => row.display_name.includes('%')),
    'A literal fragment does not act as a wildcard',
  );
  const accented = await sales.rpc('list_vendors', {
    p_query: `${runToken} nha cung cap chinh`,
  });
  assert.equal(accented.error, null);
  assert.deepEqual(
    accented.data.map((row) => row.id),
    [staffVendor.id],
  );
  observed(
    'bounded queries clamp the page, fold accents, and treat % and _ literally',
  );

  // ---------------------------------------------------------------- application
  await startApp();
  const anonymousListRoute = await appGet(null, '/api/vendors');
  assert.equal(anonymousListRoute.status, 401);
  const inactiveLogin = await appLoginResponse(
    manifest.identities.inactive.email,
    manifest.identities.inactive.password,
  );
  assert.equal(inactiveLogin.status, 403);
  const unlinkedLogin = await appLoginResponse(
    manifest.unlinked.email,
    manifest.unlinked.password,
  );
  assert.equal(unlinkedLogin.status, 403);
  observed(
    'the application refuses anonymous, inactive and unlinked identities before any vendor read',
  );

  const salesCookies = await appLogin(
    manifest.identities.sales.email,
    manifest.identities.sales.password,
  );
  const salesList = await appGet(salesCookies, '/api/vendors');
  assert.equal(salesList.status, 200);
  assert.ok(salesList.body.vendors.length <= 30);
  const salesDenied = await appPost(salesCookies, '/api/vendors', {
    key: randomUUID(),
    displayName: fixtureName('route forged'),
  });
  assert.equal(salesDenied.status, 403);
  const halfCursor = await appGet(salesCookies, '/api/vendors?before=1');
  assert.equal(halfCursor.status, 400);
  const longQuery = await appGet(
    salesCookies,
    '/api/vendors?query=' + 'a'.repeat(121),
  );
  assert.equal(longQuery.status, 400);
  const unknownQuery = await appGet(salesCookies, '/api/vendors?after=1');
  assert.equal(unknownQuery.status, 400);
  const detailRoute = await appGet(
    salesCookies,
    '/api/vendors/' + staffVendor.id,
  );
  assert.equal(detailRoute.status, 200);
  assert.equal(detailRoute.body.vendor.displayName, staffVendor.display_name);
  assert.equal(detailRoute.body.vendor.contactName, 'Nguyễn Văn Ứng');
  assert.equal(detailRoute.body.vendor.sourceAddress.includes('Quận 10'), true);
  assert.equal(detailRoute.body.vendor.notes.includes('\n'), true);
  const unknownDetail = await appGet(
    salesCookies,
    '/api/vendors/' + managerVendor.id,
  );
  assert.equal(unknownDetail.status, 200);
  assert.equal(unknownDetail.body.vendor.contactName, null);
  assert.equal(unknownDetail.body.vendor.phones, null);
  const invalidDetail = await appGet(salesCookies, '/api/vendors/not-a-uuid');
  assert.equal(invalidDetail.status, 400);
  const missingDetail = await appGet(
    salesCookies,
    '/api/vendors/00000000-0000-4000-8000-00000000dead',
  );
  assert.equal(missingDetail.status, 404);
  observed(
    'the application bounds its reads and refuses a sales mutation with 403',
  );

  const pages = await readAllPages(salesCookies);
  const returned = new Set(pages.entries.map((entry) => entry.id));
  for (const id of manifest.retainedVendorIds)
    assert.ok(returned.has(id), `Every created vendor is on a page: ${id}`);
  for (let index = 1; index < pages.entries.length; index++)
    assert.ok(
      pages.entries[index - 1].createdAt >= pages.entries[index].createdAt,
      'The directory stays newest-first across pages',
    );
  observed(
    'every created vendor is reachable through bounded newest-first pages',
    {
      pages: pages.pages,
      vendors: pages.entries.length,
    },
  );

  const staffCookies = await appLogin(
    manifest.identities.staff.email,
    manifest.identities.staff.password,
  );
  const createRouteKey = randomUUID();
  const createRoute = await appPost(staffCookies, '/api/vendors', {
    key: createRouteKey,
    displayName: fixtureName('route created'),
    contactName: 'Trần Văn Route',
    phones: ['0912 345 678'],
    email: null,
    sourceAddress: null,
    notes: null,
  });
  assert.equal(createRoute.status, 201);
  assert.equal(createRoute.body.vendor.contactName, 'Trần Văn Route');
  assert.deepEqual(createRoute.body.vendor.phones, ['0912 345 678']);
  assert.equal(createRoute.body.vendor.email, null);
  manifest.retainedVendorIds.push(createRoute.body.vendor.id);
  const after = await appGet(
    staffCookies,
    '/api/vendors/' + createRoute.body.vendor.id,
  );
  assert.equal(after.status, 200);
  assert.equal(after.body.vendor.displayName, fixtureName('route created'));
  const forgedField = await appPost(staffCookies, '/api/vendors', {
    key: randomUUID(),
    displayName: fixtureName('forged field'),
    role: 'admin',
  });
  assert.equal(forgedField.status, 400);
  observed(
    'a permitted create returns the identity the detail read then confirms',
  );
  const conflictRoute = await appPost(staffCookies, '/api/vendors', {
    key: createRouteKey,
    displayName: fixtureName('route conflicting'),
  });
  assert.equal(conflictRoute.status, 409);
  assert.equal(conflictRoute.body.error, 'vendor-conflict');
  const unchangedRoute = await appGet(
    staffCookies,
    '/api/vendors/' + createRoute.body.vendor.id,
  );
  assert.equal(unchangedRoute.status, 200);
  assert.equal(
    unchangedRoute.body.vendor.displayName,
    fixtureName('route created'),
  );
  observed(
    'conflicting reuse of the submission key is 409/vendor-conflict at the endpoint',
  );

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });

  // ---------------------------------------------------------------- browser
  await startBrowser(9336);
  browser('sgn73-anon', 9336, ['open', `${appUrl}/login?lang=vi`]);
  browser('sgn73-anon', 9336, ['open', `${appUrl}/people/vendors`]);
  await waitFor('sgn73-anon', 9336, `() => location.pathname === '/login'`);
  observed(
    'an anonymous visit to the vendor destination is redirected to sign-in',
  );

  await browserSignIn(
    'sgn73-staff',
    9336,
    manifest.identities.staff.email,
    manifest.identities.staff.password,
    '/properties',
  );
  browser('sgn73-staff', 9336, [
    'open',
    `${appUrl}/people/vendors?query=${encodeURIComponent(staffVendorName)}`,
  ]);
  await waitFor(
    'sgn73-staff',
    9336,
    `() => Boolean(document.querySelector('main table.data-table'))`,
  );
  const staffScreen = vendorScreen('sgn73-staff', 9336);
  assert.equal(staffScreen.heading, 'Nhà cung cấp');
  assert.equal(
    staffScreen.createForm,
    true,
    'A maintainer sees the create form',
  );
  assert.equal(staffScreen.rows.length, 1);
  assert.equal(staffScreen.rows[0][0].includes('Nhà cung cấp chính'), true);
  assert.equal(staffScreen.rows[0][1], 'Nguyễn Văn Ứng');
  assert.equal(staffScreen.rows[0][2].includes('090 123 4567'), true);
  assert.equal(
    (
      await appGet(
        staffCookies,
        `/api/vendors?query=${encodeURIComponent(staffVendorName)}`,
      )
    ).status,
    200,
  );
  const rowLink = evaluate(
    'sgn73-staff',
    9336,
    `() => document.querySelector('main table.data-table tbody th a')?.getAttribute('href') ?? null`,
  );
  browser('sgn73-staff', 9336, ['open', appUrl + rowLink]);
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelector('h1')?.textContent?.trim() === ${JSON.stringify(staffVendorName)}`,
  );
  const staffDetail = detailScreen('sgn73-staff', 9336);
  const staffFacts = Object.fromEntries(
    staffDetail.facts.map((fact) => [fact.label, fact]),
  );
  assert.equal(staffFacts['Tên người liên hệ'].value, 'Nguyễn Văn Ứng');
  assert.equal(staffFacts['Tên người liên hệ'].unknown, false);
  assert.equal(
    staffFacts['Địa chỉ / văn bản nguồn'].value.includes('Quận 10'),
    true,
  );
  assert.equal(
    staffDetail.editControls,
    0,
    'The slice exposes no edit control',
  );
  observed(
    'a maintainer reads the created vendor detail with its recorded source text intact',
  );

  browser('sgn73-staff', 9336, ['open', appUrl + '/people/vendors']);
  await waitFor(
    'sgn73-staff',
    9336,
    `() => Boolean(document.querySelector('main table.data-table'))`,
  );
  evaluate(
    'sgn73-staff',
    9336,
    `(() => { document.querySelector('.lang-switch button[lang=en]').click(); return true; })()`,
  );
  await waitFor(
    'sgn73-staff',
    9336,
    `() => document.querySelector('h1')?.textContent?.trim() === 'Vendors'`,
  );
  const english = vendorScreen('sgn73-staff', 9336);
  assert.equal(english.lang, 'en');
  assert.equal(english.createForm, true);
  observed('the vendor directory renders equivalent English labels');

  await browserSignIn(
    'sgn73-sales',
    9336,
    manifest.identities.sales.email,
    manifest.identities.sales.password,
    '/properties',
  );
  browser('sgn73-sales', 9336, [
    'open',
    `${appUrl}/people/vendors?query=${encodeURIComponent(staffVendorName)}`,
  ]);
  await waitFor(
    'sgn73-sales',
    9336,
    `() => Boolean(document.querySelector('main table.data-table'))`,
  );
  const salesScreen = vendorScreen('sgn73-sales', 9336);
  assert.equal(salesScreen.createPanel, false);
  assert.equal(salesScreen.createForm, false);
  assert.equal(salesScreen.rows.length, 1);
  assert.equal(salesScreen.rows[0][0].includes('Nhà cung cấp chính'), true);
  observed(
    'a sales employee reads the directory through the UI with no create control',
  );

  for (const identity of ['inactive', 'unlinked']) {
    browser(`sgn73-${identity}`, 9336, ['open', `${appUrl}/login?lang=vi`]);
    if (identity === 'inactive') {
      evaluate(
        `sgn73-${identity}`,
        9336,
        setInput('#email', manifest.identities.inactive.email),
      );
      evaluate(
        `sgn73-${identity}`,
        9336,
        setInput('#password', manifest.identities.inactive.password),
      );
    } else {
      evaluate(
        `sgn73-${identity}`,
        9336,
        setInput('#email', manifest.unlinked.email),
      );
      evaluate(
        `sgn73-${identity}`,
        9336,
        setInput('#password', manifest.unlinked.password),
      );
    }
    evaluate(
      `sgn73-${identity}`,
      9336,
      `(() => { document.querySelector('form').requestSubmit(); return true; })()`,
    );
    await waitFor(
      `sgn73-${identity}`,
      9336,
      `() => Boolean(document.querySelector('[role=alert]')) || location.pathname === '/access-denied'`,
    );
    const denied = evaluate(
      `sgn73-${identity}`,
      9336,
      `() => ({ path: location.pathname, alert: document.querySelector('[role=alert]')?.textContent?.trim() ?? null })`,
    );
    assert.ok(
      denied.path === '/access-denied' || denied.alert,
      `${identity} must be refused with a visible denial`,
    );
    assert.equal(
      evaluate(
        `sgn73-${identity}`,
        9336,
        `() => Boolean(document.querySelector('main table.data-table'))`,
      ),
      false,
      `${identity} must not reach the vendor list`,
    );
  }
  observed(
    'inactive and unlinked identities are refused before the directory renders',
  );

  // ---------------------------------------------------------------- ticket #74
  await vendorLinkJourney({
    manifest,
    staff,
    admin,
    sales,
    inactive,
    unlinked,
    anonymous: anonClient,
    staffCookies,
    salesCookies,
    inactiveCookies: inactiveLogin.cookies,
    unlinkedCookies: unlinkedLogin.cookies,
  });
} catch (error) {
  failure = error;
} finally {
  await stopBrowsers().catch(() => {});
  await stopApp().catch(() => {});
  report.cleanup = await removeFixtures(manifest);
  report.finished_at = new Date().toISOString();
  report.retries = retryCount;
  if (failure) report.failure = String(failure?.message ?? failure);
  if (reportPath) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
  if (keep) console.log('KEEP=1: fixture manifest left at', manifestPath);
  else await fs.rm(manifestPath, { force: true }).catch(() => {});
}
if (failure) throw failure;
console.log(`${observations.length} observations passed`);
