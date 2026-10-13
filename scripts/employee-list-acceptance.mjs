// Issue #65 hosted acceptance: the admin employee list.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application. It
// creates only the synthetic identities and rows the list needs under an exact-ID private
// manifest and removes exactly what it created through the supported owner paths. Mock,
// shim and embedded-PGlite results are not acceptance.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node --env-file-if-exists=.env.local scripts/employee-list-acceptance.mjs \
//     [--report <sanitized json path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// owner capability. Both are read as data only and are never printed, shell sourced, or
// passed in argv/logs.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

const devEnvPath = process.env.SGN_ACCEPTANCE_DEV_ENV;
const ownerPath = process.env.SGN_ACCEPTANCE_OWNER;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3103);
const keep = process.env.SGN_ACCEPTANCE_KEEP === '1';
const root = path.resolve(import.meta.dirname, '..');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;

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
const environment = readEnvironment(
  { ...devEnv, NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${appPort}` },
  devEnv.EXPECTED_SUPABASE_PROJECT_REF,
);
const appUrl = environment.appUrl;
await fs.mkdir(workdir, { recursive: true });

const ownerClient = createClient(environment.supabaseUrl, owner.authAdminKey, {
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

// ------------------------------------------------------------------ fixtures
const namespace = 'SGN65';
// role, is_active. The unlinked person below has no employee row at all, which is the
// identity the list must never present as invited.
const identities = [
  ['admin', 'admin', true],
  ['manager', 'manager', true],
  ['staff', 'staff', true],
  ['sales', 'sales', true],
  ['inactive', 'sales', false],
];
// Enough unlinked rows to cross the 30-row page bound without creating Auth users.
const pagingRows = 32;
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
  const employeeIds = [
    ...Object.values(manifest.identities ?? {}).map(
      (identity) => identity.employeeId,
    ),
    ...(manifest.pagingEmployeeIds ?? []),
  ];
  if (employeeIds.length) {
    const employees = await retryResult('remove fixture employees', () =>
      ownerClient.from('employees').delete().in('id', employeeIds),
    );
    assert.equal(employees.error, null, 'remove fixture employees');
  }
  const userIds = [
    ...Object.values(manifest.identities ?? {}).map(
      (identity) => identity.userId,
    ),
    ...(manifest.unlinked ? [manifest.unlinked.userId] : []),
  ];
  for (const userId of userIds) {
    const removed = await retryThrown('remove fixture auth user', () =>
      ownerClient.auth.admin.deleteUser(userId),
    ).catch((error) => ({ error }));
    // An identity an earlier interrupted run already removed is not a failure.
    if (removed.error && !/not found/i.test(removed.error.message))
      assert.fail(`remove fixture auth user: ${removed.error.message}`);
  }
}
async function baseline() {
  const employees = await retryResult('baseline employees', () =>
    ownerClient.from('employees').select('id').order('id'),
  );
  assert.equal(employees.error, null, 'baseline employees');
  return {
    employees: employees.data.length,
    hash: employees.data.map((row) => row.id).join(',').length,
  };
}
async function createFixtures() {
  const manifest = {
    namespace,
    identities: {},
    unlinked: null,
    pagingEmployeeIds: [],
  };
  for (const [name, role, active] of identities) {
    const email = `${namespace.toLowerCase()}.${name}@example.test`;
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
    const inserted = await retryResult(`create employee ${name}`, () =>
      ownerClient.from('employees').insert({
        id: employeeId,
        auth_user_id: created.data.user.id,
        email,
        display_name: `${namespace} ${name}`,
        role,
        is_active: active,
      }),
    );
    assert.equal(inserted.error, null, `create employee ${name}`);
    manifest.identities[name] = {
      userId: created.data.user.id,
      employeeId,
      email,
      password,
      role,
      active,
    };
  }
  const unlinkedEmail = `${namespace.toLowerCase()}.unlinked@example.test`;
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
  for (let index = 0; index < pagingRows; index++) {
    const employeeId = randomUUID();
    const inserted = await retryResult(`create paging employee ${index}`, () =>
      ownerClient.from('employees').insert({
        id: employeeId,
        auth_user_id: null,
        email: `${namespace.toLowerCase()}.page${index}@example.test`,
        display_name: `${namespace} page ${index}`,
        role: 'sales',
        is_active: false,
      }),
    );
    assert.equal(inserted.error, null, `create paging employee ${index}`);
    manifest.pagingEmployeeIds.push(employeeId);
  }
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  return manifest;
}
async function setRole(employeeId, role) {
  const updated = await retryResult('set fixture role', () =>
    ownerClient.from('employees').update({ role }).eq('id', employeeId),
  );
  assert.equal(updated.error, null, 'set fixture role');
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
  return { status: response.status, body, headers: response.headers };
}
// Every page of the list, walked through the cursor the read returned.
async function readAllPages(cookies) {
  const entries = [];
  const seen = new Set();
  let after = null;
  let pages = 0;
  for (;;) {
    const { status, body } = await appGet(
      cookies,
      '/api/employees' + (after ? `?after=${after}` : ''),
    );
    assert.equal(status, 200, `Employee list read ${status}`);
    assert.ok(Array.isArray(body?.employees), 'Employee list shape');
    pages++;
    for (const entry of body.employees) {
      assert.ok(!seen.has(entry.id), 'No employee appears on two pages');
      seen.add(entry.id);
      entries.push(entry);
    }
    if (!body.nextCursor) break;
    after = body.nextCursor;
    assert.ok(pages < 40, 'Paging terminated');
  }
  return { entries, pages };
}

// ------------------------------------------------------------------ acceptance
const report = { checked_at: new Date().toISOString(), observations: [] };
let manifest = await readManifest();
const before = await baseline();
if (manifest) await removeFixtures(manifest);
manifest = await createFixtures();
try {
  await startApp();

  const adminCookies = await appLogin(
    manifest.identities.admin.email,
    manifest.identities.admin.password,
  );

  const firstPage = await appGet(adminCookies, '/api/employees');
  assert.equal(firstPage.status, 200, 'Admin reads the employee list');
  assert.equal(firstPage.body.employees.length, 30, 'Bounded page size');
  assert.ok(firstPage.body.nextCursor, 'A following page is signalled');
  assert.match(
    firstPage.headers.get('cache-control') ?? '',
    /private.*no-store/,
    'Protected list responses stay private/no-store',
  );
  observed('admin reads the bounded employee list', {
    pageSize: firstPage.body.employees.length,
    nextCursor: true,
  });

  const walk = await readAllPages(adminCookies);
  const ids = walk.entries.map((entry) => entry.id);
  assert.deepEqual(
    ids,
    [...ids].sort(),
    'Paging is deterministic and ascending by employee id',
  );
  assert.ok(walk.pages > 1, 'The fixture crossed the page bound');
  observed('paging is bounded, deterministic and complete', {
    pages: walk.pages,
    employees: walk.entries.length,
  });

  const byId = new Map(walk.entries.map((entry) => [entry.id, entry]));
  for (const [name, role, active] of identities) {
    const fixture = manifest.identities[name];
    const entry = byId.get(fixture.employeeId);
    assert.ok(entry, `Fixture ${name} appears in the list`);
    assert.equal(entry.displayName, `${namespace} ${name}`, `${name} name`);
    assert.equal(entry.email, fixture.email, `${name} email`);
    assert.equal(entry.role, role, `${name} role`);
    assert.equal(
      entry.access,
      active ? 'active' : 'inactive',
      `${name} access state`,
    );
    assert.ok(
      !Object.hasOwn(entry, 'invited') && entry.access !== 'invited',
      'No fabricated invitation state',
    );
  }
  const pagingEntry = byId.get(manifest.pagingEmployeeIds[0]);
  assert.equal(
    pagingEntry.access,
    'unlinked',
    'An imported person with no linked sign-in identity is unlinked, not invited',
  );
  observed('recorded name, email, role and access state are distinguishable', {
    active: 'active',
    inactive: 'inactive',
    unlinked: 'unlinked',
  });

  for (const name of ['manager', 'staff', 'sales']) {
    const cookies = await appLogin(
      manifest.identities[name].email,
      manifest.identities[name].password,
    );
    const denied = await appGet(cookies, '/api/employees');
    assert.equal(denied.status, 403, `${name} endpoint denial`);
    assert.equal(denied.body.error, 'access-denied', `${name} denial code`);
    const page = await fetch(`${appUrl}/people/employees`, {
      redirect: 'manual',
      headers: { cookie: cookies },
    });
    assert.ok(
      page.status >= 300 && page.status < 400,
      `${name} page denial status ${page.status}`,
    );
    assert.match(
      page.headers.get('location') ?? '',
      /\/access-denied$/,
      `${name} page denial target`,
    );
  }
  observed('manager, staff and sales are refused the endpoint and the page', {
    status: 403,
    redirect: '/access-denied',
  });

  const anonymous = await appGet(null, '/api/employees');
  assert.equal(anonymous.status, 401, 'Anonymous denial');
  observed('anonymous is refused with 401', { status: 401 });

  const malformed = await appGet(
    adminCookies,
    '/api/employees?after=not-a-uuid',
  );
  assert.equal(malformed.status, 400, 'Malformed cursor rejected');
  assert.equal(malformed.body.error, 'invalid-input', 'Malformed cursor code');
  observed('a malformed cursor is refused rather than served as page one', {
    status: 400,
  });

  const adminPage = await fetch(`${appUrl}/people/employees`, {
    redirect: 'manual',
    headers: { cookie: adminCookies },
  });
  assert.equal(adminPage.status, 200, 'Admin opens the page directly');
  observed('admin opens the page directly', { status: 200 });

  // The live guard re-reads the role on every request: the same already-issued session
  // gains and loses authority with the recorded role.
  const managerCookies = await appLogin(
    manifest.identities.manager.email,
    manifest.identities.manager.password,
  );
  assert.equal(
    (await appGet(managerCookies, '/api/employees')).status,
    403,
    'Manager is refused before promotion',
  );
  await setRole(manifest.identities.manager.employeeId, 'admin');
  assert.equal(
    (await appGet(managerCookies, '/api/employees')).status,
    200,
    'Promotion applies to the already-issued session',
  );
  await setRole(manifest.identities.manager.employeeId, 'manager');
  assert.equal(
    (await appGet(managerCookies, '/api/employees')).status,
    403,
    'Demotion removes authority from the already-issued session',
  );
  observed('the role guard follows the recorded role, not the issued token', {
    promoted: 200,
    demoted: 403,
  });

  // The attribution read the rest of the application depends on is not revoked: an active
  // staff session still reads employee rows through RLS while the admin page is refused.
  const staffClient = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const staffAuth = await retryThrown('staff fixture authentication', () =>
    staffClient.auth.signInWithPassword({
      email: manifest.identities.staff.email,
      password: manifest.identities.staff.password,
    }),
  );
  assert.equal(staffAuth.error, null, 'Staff fixture authentication');
  const attribution = await retryResult('staff attribution read', () =>
    staffClient
      .from('employees')
      .select('id,display_name')
      .eq('id', manifest.identities.manager.employeeId)
      .maybeSingle(),
  );
  assert.equal(attribution.error, null, 'Staff attribution read');
  assert.equal(
    attribution.data?.display_name,
    `${namespace} manager`,
    'Staff still reads the colleague row used for business attribution',
  );
  observed('the existing employee read used for attribution is preserved', {
    staffCanReadColleague: true,
  });

  const inactive = await appLogin(
    manifest.identities.inactive.email,
    manifest.identities.inactive.password,
  ).catch(() => null);
  // An inactive identity is refused by the application login/authority path; the denial
  // must be a refusal, never an empty list.
  if (inactive) {
    assert.equal(
      (await appGet(inactive, '/api/employees')).status,
      403,
      'Inactive denial',
    );
    observed('an inactive identity is refused', { status: 403 });
  } else {
    observed('an inactive identity cannot sign in at all', {
      login: 'refused',
    });
  }
} finally {
  await stopApp();
  await removeFixtures(manifest);
  if (keep) {
    console.log('KEEP=1: fixture manifest left at', manifestPath);
  } else {
    await fs.rm(manifestPath, { force: true });
  }
}

const after = await baseline();
assert.deepEqual(after, before, 'The pre-acceptance baseline is restored');
report.observations = observations;
report.baseline = before;
report.restored = after;
report.retries = retryCount;
if (reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(`${observations.length} observations passed`);
