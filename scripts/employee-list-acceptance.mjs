// Issue #65 hosted acceptance: the admin employee list.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and the
// rendered browser journey driven over CDP in a task-private headless Chromium. It creates
// only the synthetic identities and rows the list needs under an exact-ID private manifest and
// removes exactly what it created through the supported owner paths. Mock, shim and
// embedded-PGlite results are not acceptance.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   node --env-file-if-exists=.env.local scripts/employee-list-acceptance.mjs \
//     [--report <sanitized json path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// database URL and owner capability. Both are read as data only and are never printed, shell
// sourced, or passed in argv/logs.
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
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3103);
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
// Employee rows are provisioned, changed and removed over the owner SQL connection: the
// lifecycle guard refuses direct client writes, and the guarded administration operation is
// not a fixture-management API.
assert.ok(owner.dbUrl, 'The owner config needs the owner SQL connection');
function sqlText(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function ownerSql(statement) {
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
      'Owner SQL failed: ' + (result.stdout || result.stderr).slice(-800),
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
    ownerSql(
      `delete from public.employees where id in (${employeeIds.map(sqlText).join(',')})`,
    );
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
    const inserted = ownerSql(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
        `(${sqlText(employeeId)}::uuid,${sqlText(created.data.user.id)}::uuid,${sqlText(email)},${sqlText(`${namespace} ${name}`)},${sqlText(role)},${active}) returning id`,
    );
    assert.equal(inserted.length, 1, `create employee ${name}`);
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
  const pagingValues = [];
  for (let index = 0; index < pagingRows; index++) {
    const employeeId = randomUUID();
    manifest.pagingEmployeeIds.push(employeeId);
    pagingValues.push(
      `(${sqlText(employeeId)}::uuid,null,${sqlText(`${namespace.toLowerCase()}.page${index}@example.test`)},${sqlText(`${namespace} page ${index}`)},'sales',false)`,
    );
  }
  const paging = ownerSql(
    'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
      pagingValues.join(',') +
      ' returning id',
  );
  assert.equal(paging.length, pagingRows, 'create paging employees');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  return manifest;
}
async function setRole(employeeId, role) {
  const updated = ownerSql(
    `update public.employees set role=${sqlText(role)} where id=${sqlText(employeeId)} returning id`,
  );
  assert.equal(updated.length, 1, 'set fixture role');
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
// Every page of the list, walked through the cursor the read returned.
async function readAllPages(cookies) {
  const entries = [];
  const seen = new Set();
  // cursors[i] is the `after` cursor that returned page i; cursors[0] is null.
  const cursors = [];
  let after = null;
  let pages = 0;
  for (;;) {
    cursors.push(after);
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
  return { entries, pages, cursors };
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
      // The run stamp keeps every run's sessions distinct: chrome-devtools-axi
      // persists a bridge per session name, so a fixed name would connect a later
      // run to the previous run's bridge and its dead browser.
      CHROME_DEVTOOLS_AXI_SESSION: `${session}-${runStamp}`,
      CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
      CHROME_DEVTOOLS_AXI_BROWSER_URL: `http://127.0.0.1:${cdpPort}`,
      CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '',
      CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '180000',
    },
  });
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
  assert.fail('Timed out waiting for browser state');
}
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
async function browserSignIn(
  session,
  cdpPort,
  email,
  password,
  landing,
  locale,
) {
  browser(session, cdpPort, ['open', `${appUrl}/login?lang=${locale}`]);
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
// The rendered employee list: rows, column scope, per-cell mobile labels, pager and states.
const directoryScreenExpression = `() => {
  const table = document.querySelector('main table.data-table');
  const thead = table ? table.querySelector('thead') : null;
  const headings = thead ? [...thead.querySelectorAll('th')] : [];
  const rows = table
    ? [...table.querySelectorAll('tbody tr')].map((tr) => [...tr.children].map((cell) => cell.textContent.trim()))
    : [];
  const labelled = table ? [...table.querySelectorAll('tbody td[data-label]')] : [];
  const pager = [...document.querySelectorAll('.pagination .pager-btn')];
  return {
    path: location.pathname + location.search,
    lang: document.documentElement.lang,
    heading: document.querySelector('h1')?.textContent?.trim() ?? null,
    panelHeading: document.querySelector('#employees')?.textContent?.trim() ?? null,
    railLink: Boolean(document.querySelector('a[href="/people/employees"]')),
    hasTable: Boolean(table),
    empty: document.querySelector('.state-panel h3')?.textContent?.trim() ?? null,
    alerts: [...document.querySelectorAll('[role=alert]')].map((node) => node.textContent.trim()),
    headers: headings.map((th) => [th.textContent.trim(), th.getAttribute('scope')]),
    rows,
    rowHeaderCount: table ? table.querySelectorAll('tbody th[scope=row]').length : 0,
    labelledCells:
      labelled.length > 0 &&
      labelled.every(
        (cell) =>
          cell.getAttribute('data-label') ===
          (headings[cell.cellIndex]?.textContent.trim() ?? ''),
      ),
    captions: labelled
      .slice(0, 3)
      .map((cell) => (getComputedStyle(cell, '::before').content ?? '').replace(/^"|"$/g, '')),
    pageInfo: document.querySelector('.page-info')?.textContent?.trim() ?? null,
    pager: pager.map((link) => ({ text: link.textContent.trim(), href: link.getAttribute('href') })),
    theadDisplay: thead ? getComputedStyle(thead).display : null,
    overflowX: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
  };
}`;
function directoryScreen(session, cdpPort) {
  const value = evaluate(session, cdpPort, directoryScreenExpression);
  assert.equal(typeof value, 'object', 'Unexpected directory screen payload');
  return value;
}
let pageRetries = 0;
async function waitForDirectory(session, cdpPort, attempts = 120) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      last = evaluate(
        session,
        cdpPort,
        `() => ({
          table: Boolean(document.querySelector('main table.data-table')),
          empty: document.querySelector('.state-panel h3')?.textContent?.trim() ?? null,
          alert: document.querySelector('[role=alert]')?.textContent?.trim() ?? null,
          denied: location.pathname === '/access-denied',
        })`,
      );
      if (last.table || last.empty || last.denied) return last;
      if (last.alert && attempt % 8 === 7 && pageRetries < 5) {
        const clicked = evaluate(
          session,
          cdpPort,
          `(() => { const button = document.querySelector('[role=alert] button'); if (!button) return false; button.click(); return true; })()`,
        );
        if (clicked) {
          pageRetries++;
          console.log('RETRY directory-page', pageRetries);
        }
      }
    } catch {
      // mid-navigation
    }
    await sleep(500);
  }
  assert.fail(`Employee page did not load: ${JSON.stringify(last)}`);
}
const observeStatus = `(() => {
  window.__sgnStatusSeen = [];
  const record = () => {
    const text = document.querySelector('[role=status]')?.textContent?.trim();
    if (text && !window.__sgnStatusSeen.includes(text)) window.__sgnStatusSeen.push(text);
  };
  new MutationObserver(record).observe(document.body, { childList: true, subtree: true, characterData: true });
  record();
  return true;
})()`;
// The localized text the shipped page must render, asserted as rendered output rather than as
// source text. These are the owned strings of the application dictionaries.
const directoryText = {
  vi: {
    heading: 'Danh sách nhân viên',
    panel: 'Nhân viên',
    headers: ['Họ tên', 'Email', 'Vai trò', 'Trạng thái truy cập'],
    role: {
      admin: 'Quản trị viên',
      manager: 'Quản lý',
      staff: 'Nhân viên',
      sales: 'Kinh doanh',
    },
    access: {
      active: 'Đang hoạt động',
      inactive: 'Đã tắt truy cập',
      unlinked: 'Chưa liên kết đăng nhập',
    },
    empty: 'Chưa có danh tính nhân viên nào được ghi nhận.',
    failure: 'Không thể tải danh sách nhân viên.',
    loading: 'Đang tải…',
    pageInfo: (count) => `Trang này: ${count} nhân viên`,
    next: 'Trang tiếp',
    first: 'Trang đầu',
    denied: 'Không có quyền truy cập',
  },
  en: {
    heading: 'Employee list',
    panel: 'Employees',
    headers: ['Name', 'Email', 'Role', 'Access'],
    role: {
      admin: 'Administrator',
      manager: 'Manager',
      staff: 'Staff',
      sales: 'Sales',
    },
    access: {
      active: 'Active',
      inactive: 'Access disabled',
      unlinked: 'Not linked to sign-in',
    },
    empty: 'No employee identities are recorded.',
    failure: 'The employee list could not be loaded.',
    loading: 'Loading…',
    pageInfo: (count) => `This page: ${count} employees`,
    next: 'Next page',
    first: 'First page',
    denied: 'Access denied',
  },
};

// ------------------------------------------------------------------ acceptance
const report = { checked_at: new Date().toISOString(), observations: [] };
let manifest = await readManifest();
// Stale fixtures from an interrupted run are removed before the baseline is captured, so the
// closing comparison cannot count rows this run is about to delete.
await removeFixtures(manifest);
manifest = null;
const before = await baseline();
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

  // The authenticated identity with no employee row is the fixture the list must never present
  // as invited: it cannot sign in, and a session it still holds is refused the endpoint.
  const unlinked = await appLoginResponse(
    manifest.unlinked.email,
    manifest.unlinked.password,
  );
  assert.equal(unlinked.status, 403, 'Unlinked sign-in refusal');
  assert.equal(unlinked.body?.error, 'access-denied', 'Unlinked sign-in code');
  if (unlinked.cookies) {
    const unlinkedList = await appGet(unlinked.cookies, '/api/employees');
    assert.equal(unlinkedList.status, 403, 'Unlinked endpoint denial');
    assert.equal(
      unlinkedList.body?.error,
      'access-denied',
      'Unlinked endpoint denial code',
    );
  }
  observed(
    'an authenticated identity with no employee row is refused, never listed as invited',
    { signIn: 403, endpoint: 403 },
  );

  // Rendered journey on the shipped page: the VI/default and EN list, the distinct loading,
  // empty, query-failure and access-denied states, mobile stacked rows and keyboard/<th scope>
  // semantics, all as the live application renders them.
  const pageSize = firstPage.body.employees.length;
  const pageRows = (index) =>
    walk.entries.slice(index * pageSize, (index + 1) * pageSize);
  const pageOf = (employeeId) => {
    const index = walk.entries.findIndex((entry) => entry.id === employeeId);
    assert.ok(index >= 0, 'Fixture row is in the walk');
    return { page: Math.floor(index / pageSize), row: index % pageSize };
  };
  const rendered = (entries, text) =>
    entries.map((entry) => [
      entry.displayName,
      entry.email,
      text.role[entry.role],
      text.access[entry.access],
    ]);
  const openPage = async (index) => {
    const cursor = walk.cursors[index];
    browser('sgn65-vi', 9334, [
      'open',
      `${appUrl}/people/employees${cursor ? `?after=${cursor}` : ''}`,
    ]);
    await waitForDirectory('sgn65-vi', 9334);
    return directoryScreen('sgn65-vi', 9334);
  };

  await startBrowser(9334);
  await startBrowser(9335);
  await browserSignIn(
    'sgn65-vi',
    9334,
    manifest.identities.admin.email,
    manifest.identities.admin.password,
    '/properties',
    'vi',
  );
  const adminRow = pageOf(manifest.identities.admin.employeeId);
  const inactiveRow = pageOf(manifest.identities.inactive.employeeId);
  const unlinkedRow = pageOf(manifest.pagingEmployeeIds[0]);
  const pageIndexes = [
    ...new Set([
      0,
      adminRow.page,
      inactiveRow.page,
      unlinkedRow.page,
      walk.pages - 1,
    ]),
  ];
  const screens = new Map();
  for (const index of pageIndexes) {
    const text = directoryText.vi;
    const view = await openPage(index);
    screens.set(index, view);
    assert.equal(
      view.path,
      `/people/employees${walk.cursors[index] ? `?after=${walk.cursors[index]}` : ''}`,
      `page ${index} location`,
    );
    assert.equal(view.lang, 'vi', `page ${index} locale`);
    assert.equal(view.heading, text.heading, `page ${index} heading`);
    assert.equal(view.panelHeading, text.panel, `page ${index} panel heading`);
    assert.equal(
      view.railLink,
      true,
      'the admin rail offers the employee list',
    );
    assert.deepEqual(
      view.headers,
      text.headers.map((heading) => [heading, 'col']),
    );
    assert.deepEqual(
      view.rows,
      rendered(pageRows(index), text),
      `page ${index} rendered rows`,
    );
    assert.equal(
      view.rowHeaderCount,
      view.rows.length,
      'every row is headed by its name cell',
    );
    assert.equal(
      view.labelledCells,
      true,
      'every stacked cell carries its column label',
    );
    assert.equal(view.pageInfo, text.pageInfo(view.rows.length));
    assert.deepEqual(view.alerts, []);
    assert.equal(view.empty, null);
    const next = view.pager.find((link) => link.text === text.next);
    assert.equal(
      Boolean(next),
      index < walk.pages - 1,
      `next link on page ${index}`,
    );
    if (next)
      assert.equal(
        next.href,
        `/people/employees?after=${walk.cursors[index + 1]}`,
      );
    const first = view.pager.find((link) => link.text === text.first);
    assert.equal(Boolean(first), index > 0, `first link on page ${index}`);
    if (first) assert.equal(first.href, '/people/employees');
  }
  const row = (position) => screens.get(position.page).rows[position.row];
  assert.equal(row(adminRow)[3], directoryText.vi.access.active, 'active row');
  assert.equal(
    row(inactiveRow)[3],
    directoryText.vi.access.inactive,
    'inactive row',
  );
  assert.equal(
    row(unlinkedRow)[3],
    directoryText.vi.access.unlinked,
    'an employee with no linked sign-in identity is not presented as invited',
  );
  observed(
    'a live admin reads every rendered page with the recorded fields and the three access states',
    { pages: walk.pages, employees: walk.entries.length },
  );

  // Keyboard reachability of the pager on the last rendered page.
  const keyboard = evaluate(
    'sgn65-vi',
    9334,
    `(() => {
      const link = document.querySelector('.pagination .pager-btn');
      if (!link) return { present: false };
      link.focus();
      return {
        present: true,
        tag: link.tagName,
        href: link.getAttribute('href'),
        focused: document.activeElement === link,
      };
    })()`,
  );
  assert.equal(keyboard.present, true, 'the pager control is present');
  assert.equal(
    keyboard.focused,
    true,
    'the pager control is keyboard focusable',
  );
  assert.ok(
    keyboard.href?.startsWith('/people/employees'),
    'the pager control carries its destination',
  );
  observed('the pager stays keyboard reachable with its destination exposed');

  // Mobile stacked rows: the header row is replaced by per-cell column labels at 375px.
  const lastPageIndex = pageIndexes[pageIndexes.length - 1];
  browser('sgn65-vi', 9334, ['resize', '375', '900']);
  await sleep(500);
  const mobile = directoryScreen('sgn65-vi', 9334);
  assert.equal(
    mobile.theadDisplay,
    'none',
    'the header row is replaced by per-cell labels at 375px',
  );
  assert.deepEqual(
    mobile.captions,
    directoryText.vi.headers.slice(1),
    'each stacked cell shows its column label',
  );
  assert.deepEqual(
    mobile.rows,
    rendered(pageRows(lastPageIndex), directoryText.vi),
  );
  assert.equal(mobile.overflowX, 0, 'mobile viewport overflows horizontally');
  browser('sgn65-vi', 9334, ['resize', '1440', '900']);
  await sleep(500);
  observed(
    'the list stays readable at 375px with stacked labelled cells and no horizontal overflow',
  );

  // English: the same rows with localized role and access labels, no recorded value rewritten.
  const viFirst = await openPage(0);
  evaluate(
    'sgn65-vi',
    9334,
    `(() => { document.querySelector('.lang-switch button[lang=en]').click(); return true; })()`,
  );
  await waitFor(
    'sgn65-vi',
    9334,
    `() => document.documentElement.lang === 'en'`,
  );
  const en = directoryScreen('sgn65-vi', 9334);
  assert.equal(en.heading, directoryText.en.heading);
  assert.deepEqual(
    en.headers,
    directoryText.en.headers.map((heading) => [heading, 'col']),
  );
  assert.deepEqual(en.rows, rendered(pageRows(0), directoryText.en));
  assert.deepEqual(
    en.rows.map((cells) => cells.slice(0, 2)),
    viFirst.rows.map((cells) => cells.slice(0, 2)),
    'recorded name and email are unchanged by the language switch',
  );
  assert.deepEqual(en.alerts, []);
  observed(
    'switching to English re-renders the list with localized role and access labels and rewrites no recorded value',
  );

  const assertDirectoryStates = async (language) => {
    const text = directoryText[language];
    const label = language === 'vi' ? 'Vietnamese/default' : 'English';
    // The cursor past the last recorded employee is the real empty page of the walked list.
    browser('sgn65-vi', 9334, [
      'open',
      `${appUrl}/people/employees?after=${walk.entries.at(-1).id}`,
    ]);
    await waitForDirectory('sgn65-vi', 9334);
    const empty = directoryScreen('sgn65-vi', 9334);
    assert.equal(empty.hasTable, false, `empty page table in ${label}`);
    assert.equal(empty.empty, text.empty, `empty state in ${label}`);
    assert.deepEqual(empty.alerts, []);
    assert.equal(
      empty.pager.some((link) => link.text === text.first),
      true,
      `an empty page offers the first page in ${label}`,
    );
    observed(
      `an empty page renders the localized empty state instead of rows in ${label}`,
    );

    // A genuine transport failure is distinguishable from empty and loading, and Retry recovers.
    browser('sgn65-vi', 9334, ['open', `${appUrl}/people/employees`]);
    await waitForDirectory('sgn65-vi', 9334);
    browser('sgn65-vi', 9334, ['emulate', '--network', 'Offline']);
    evaluate('sgn65-vi', 9334, observeStatus);
    evaluate(
      'sgn65-vi',
      9334,
      `(() => { window.dispatchEvent(new Event('focus')); return true; })()`,
    );
    await waitFor(
      'sgn65-vi',
      9334,
      `() => (document.querySelector('[role=alert]')?.textContent ?? '').includes(${JSON.stringify(text.failure)})`,
      120,
    );
    const failure = directoryScreen('sgn65-vi', 9334);
    assert.equal(failure.hasTable, false, `failure table in ${label}`);
    assert.equal(failure.empty, null, `failure empty state in ${label}`);
    assert.ok(
      failure.alerts.some((value) => value.includes(text.failure)),
      `failure alert in ${label}`,
    );
    browser('sgn65-vi', 9334, ['emulate', '--network', 'Fast 4G']);
    evaluate(
      'sgn65-vi',
      9334,
      `(() => { const button = document.querySelector('[role=alert] button'); if (!button) return false; button.click(); return true; })()`,
    );
    await waitFor(
      'sgn65-vi',
      9334,
      `() => Boolean(document.querySelector('main table.data-table'))`,
    );
    const recovered = directoryScreen('sgn65-vi', 9334);
    assert.deepEqual(recovered.rows, rendered(pageRows(0), text));
    const statusSeen = evaluate(
      'sgn65-vi',
      9334,
      `() => window.__sgnStatusSeen ?? []`,
    );
    assert.ok(
      statusSeen.includes(text.loading),
      `loading state not observed in ${label}: ${JSON.stringify(statusSeen)}`,
    );
    observed(
      `a query failure renders the localized failure and loading states, and Retry recovers the list in ${label}`,
    );
  };
  await assertDirectoryStates('en');
  evaluate(
    'sgn65-vi',
    9334,
    `(() => { document.querySelector('.lang-switch button[lang=vi]').click(); return true; })()`,
  );
  await waitFor(
    'sgn65-vi',
    9334,
    `() => document.documentElement.lang === 'vi'`,
  );
  await assertDirectoryStates('vi');

  // The entry Back reaches after sign-out must be a list page that renders rows, or the check
  // below would pass whether or not sign-out cleared the protected surface.
  const signOutFrom = await openPage(1);
  assert.equal(
    signOutFrom.path,
    `/people/employees?after=${walk.cursors[1]}`,
    'a populated list entry sits behind the sign-out page',
  );
  assert.deepEqual(
    signOutFrom.rows,
    rendered(pageRows(1), directoryText.vi),
    'the page signed out from renders the list',
  );

  // Sign-out clears the list and Back exposes none of it.
  evaluate(
    'sgn65-vi',
    9334,
    `(() => { document.querySelector('.sgn-user-btn').click(); return true; })()`,
  );
  await sleep(300);
  evaluate(
    'sgn65-vi',
    9334,
    `(() => { const button = document.querySelector('.sgn-popover button'); if (!button) return false; button.click(); return true; })()`,
  );
  await waitFor('sgn65-vi', 9334, `() => location.pathname === '/login'`);
  evaluate('sgn65-vi', 9334, `(() => { history.back(); return true; })()`);
  await sleep(2000);
  const afterBack = evaluate(
    'sgn65-vi',
    9334,
    `() => ({ path: location.pathname, table: Boolean(document.querySelector('main table.data-table')) })`,
  );
  assert.equal(
    afterBack.table,
    false,
    'sign-out and Back expose no employee list',
  );
  observed('sign-out clears the list and Back exposes none of it');

  // Denial as rendered: anonymous and the unlinked/inactive identities never reach the list.
  // The first navigation binds the session on a URL that does not redirect:
  // chrome-devtools-axi records the page it created by matching the requested URL, and a
  // redirect (this page's /people/employees -> /login) leaves the session without a
  // selected page, failing the next call with `No page is currently selected`.
  browser('sgn65-alt', 9335, ['open', `${appUrl}/login`]);
  browser('sgn65-alt', 9335, ['open', `${appUrl}/people/employees`]);
  await waitFor('sgn65-alt', 9335, `() => location.pathname === '/login'`);
  const anonymousView = evaluate(
    'sgn65-alt',
    9335,
    `() => ({ path: location.pathname, table: Boolean(document.querySelector('main table.data-table')) })`,
  );
  assert.equal(anonymousView.table, false, 'anonymous sees no list');
  observed(
    'an anonymous visit is redirected to the login screen and renders no list',
  );
  for (const [language, identity] of [
    ['vi', manifest.unlinked],
    ['en', manifest.unlinked],
    ['vi', manifest.identities.inactive],
    ['en', manifest.identities.inactive],
  ]) {
    await browserSignIn(
      'sgn65-alt',
      9335,
      identity.email,
      identity.password,
      '/access-denied',
      language,
    );
    const denied = evaluate(
      'sgn65-alt',
      9335,
      `() => ({ heading: document.querySelector('h1')?.textContent?.trim() ?? null, table: Boolean(document.querySelector('main table.data-table')) })`,
    );
    assert.equal(
      denied.heading,
      directoryText[language].denied,
      `${language} denial heading`,
    );
    assert.equal(denied.table, false, `${language} denial exposes no list`);
  }
  observed(
    'an unlinked and an inactive identity are refused at sign-in in both languages and never reach the list',
  );

  await browserSignIn(
    'sgn65-alt',
    9335,
    manifest.identities.manager.email,
    manifest.identities.manager.password,
    '/properties',
    'vi',
  );
  await waitFor(
    'sgn65-alt',
    9335,
    `() => (document.querySelector('.sgn-user-btn')?.textContent ?? '').includes(${JSON.stringify(`${namespace} manager`)})`,
  );
  const rail = evaluate(
    'sgn65-alt',
    9335,
    `() => ({ link: Boolean(document.querySelector('a[href="/people/employees"]')) })`,
  );
  assert.equal(rail.link, false, 'the non-admin rail hides the employee list');
  browser('sgn65-alt', 9335, ['open', `${appUrl}/people/employees`]);
  await waitFor(
    'sgn65-alt',
    9335,
    `() => location.pathname === '/access-denied'`,
  );
  const managerDenied = evaluate(
    'sgn65-alt',
    9335,
    `() => ({ path: location.pathname, heading: document.querySelector('h1')?.textContent?.trim() ?? null, table: Boolean(document.querySelector('main table.data-table')) })`,
  );
  assert.equal(managerDenied.heading, directoryText.vi.denied);
  assert.equal(managerDenied.table, false);
  observed(
    'a manager is refused the page before the shell renders, and the rail does not offer it',
  );
} finally {
  await stopBrowsers();
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
report.pageRetries = pageRetries;
if (reportPath) {
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
console.log(`${observations.length} observations passed`);
