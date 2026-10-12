// Issue #18 hosted acceptance: reservation request and independent decision.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and
// real Chrome sessions. Mock, shim, source-text and readiness-page results are not
// acceptance. The run creates no fixture rows: it uses the identities and properties
// declared in the private manifest, releases every reservation it creates, and re-reads the
// row counts it recorded before the journey.
//
// Usage:
//   SGN_ACCEPTANCE_FIXTURES=<private manifest> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi.js>] \
//   [SGN_ACCEPTANCE_BROWSER_URLS='{"session":"http://127.0.0.1:port"}'] \
//   node --env-file-if-exists=.env.local scripts/reservation-acceptance.mjs \
//     --allow-deactivation [--report <sanitized json path>]
//
// The manifest supplies the SGN-TEST-18 identities, properties and passwords; the operator
// config supplies the owner connection string for fixture-only reads and resets. Neither
// file is ever printed or committed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

if (process.argv.includes('--help')) {
  console.log(
    'Real development acceptance for reservation request and independent decision. Requires SGN_ACCEPTANCE_FIXTURES, SGN_ACCEPTANCE_OPERATOR, a running authenticated build at the configured app URL and --allow-deactivation. Writes a sanitized report with --report.',
  );
  process.exit(0);
}
const environment = readEnvironment(
  process.env,
  process.env.EXPECTED_SUPABASE_PROJECT_REF,
);
assert.equal(
  environment.stage,
  'dev',
  'Acceptance must never target production',
);
assert.equal(
  process.env.EXPECTED_SUPABASE_PROJECT_REF,
  'tneucwzcrzteeixvttpu',
  'Only the expressly authorized development project is allowed',
);
assert.ok(
  process.argv.includes('--allow-deactivation'),
  'Explicit fixture-deactivation authorization is required',
);
assert.ok(
  process.env.SGN_ACCEPTANCE_FIXTURES,
  'Provide the private fixture manifest',
);
assert.ok(
  process.env.SGN_ACCEPTANCE_OPERATOR,
  'Provide the private operator config path',
);
const fixtures = JSON.parse(
  await fs.readFile(process.env.SGN_ACCEPTANCE_FIXTURES, 'utf8'),
);
const operator = JSON.parse(
  await fs.readFile(process.env.SGN_ACCEPTANCE_OPERATOR, 'utf8'),
);
assert.ok(operator.dbUrl, 'The operator config needs an owner connection');
assert.equal(
  fixtures.namespace,
  'SGN-TEST-18',
  'Only the declared synthetic namespace is allowed',
);
for (const name of ['claimant', 'rival', 'manager', 'admin'])
  assert.equal(
    typeof fixtures.identities[name]?.employeeId,
    'string',
    'Missing declared fixture identity',
  );
assert.ok(
  Object.values(fixtures.properties).every((property) =>
    property.code.startsWith('SGN-TEST-18-'),
  ),
  'Only declared synthetic properties are allowed',
);
const origin = environment.appUrl;
const observations = [];
const reason = 'Khách đã đồng ý điều kiện, chờ quản lý duyệt đặt chỗ';
const decisionReason =
  'Đã kiểm tra thông tin và xác nhận độc lập cho đặt chỗ này';

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
      'Operator SQL failed: ' + (result.stdout || result.stderr).slice(-800),
    );
  try {
    return JSON.parse(result.stdout).rows ?? [];
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------ browser harness
let browserBin = process.env.SGN_ACCEPTANCE_BROWSER_CLI ?? '';
if (!browserBin) {
  const npmRoot = spawnSync('npm', ['root', '--global'], { encoding: 'utf8' });
  assert.equal(npmRoot.status, 0, 'Cannot locate the required browser CLI');
  browserBin = path.join(
    npmRoot.stdout.trim(),
    'chrome-devtools-axi/dist/bin/chrome-devtools-axi.js',
  );
}
assert.ok(
  await fs.stat(browserBin).catch(() => null),
  'The browser CLI path is missing',
);
// Each identity needs its own browser: attach to the declared instance when supplied.
const browserUrls = process.env.SGN_ACCEPTANCE_BROWSER_URLS
  ? JSON.parse(process.env.SGN_ACCEPTANCE_BROWSER_URLS)
  : {};
const primary = 'sgn-reservations-primary';
const secondary = 'sgn-reservations-secondary';
function browser(args, session = primary) {
  const result = spawnSync(process.execPath, [browserBin, ...args], {
    encoding: 'utf8',
    timeout: 90000,
    env: {
      ...process.env,
      CHROME_DEVTOOLS_AXI_SESSION: session,
      CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
      CHROME_DEVTOOLS_AXI_BROWSER_URL: browserUrls[session] ?? '',
      CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '',
      CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '180000',
    },
  });
  // CLI arguments and results can contain credentials: never echo page content.
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
function evaluate(expression, session = primary) {
  const output = browser(['eval', expression], session);
  const row = output.match(/^result: (.+)$/m);
  assert.ok(row, 'Browser evaluation returned no result');
  let value = JSON.parse(row[1]);
  while (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  return value;
}
function control(kind, name, session) {
  const snapshot = browser(['snapshot', '--full'], session);
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = snapshot.match(new RegExp(`uid=([^ ]+) ${kind} "${escaped}"`));
  assert.ok(match, `Missing ${kind}: ${name}`);
  return '@' + match[1];
}
function fill(name, value, session) {
  browser(['fill', control('textbox', name, session), value], session);
}
function click(name, session) {
  browser(['click', control('(?:button|link)', name, session)], session);
}
function wait(text, session) {
  browser(['wait', text], session);
}
// Polling tolerates a transient command failure while a page navigates; the deadline decides.
async function waitUntil(expression, session = primary, attempts = 60) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      if (evaluate(expression, session)) return;
    } catch {
      // The document may be mid-navigation; retry until the deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.fail('Timed out waiting for browser state');
}
function screen(session) {
  return evaluate(
    `() => {
      const panel = document.querySelector('section.reservation');
      const effective = panel?.querySelector('.reservation-effective');
      const pending = panel?.querySelector('.reservation-pending');
      const requests = [...(panel?.querySelectorAll('.reservation-request') ?? [])];
      return {
        path: location.pathname,
        locale: document.querySelector('main')?.lang,
        code: document.querySelector('h1')?.textContent?.trim(),
        status: document.querySelector('.detail-status')?.textContent?.trim() ?? null,
        heading: panel?.querySelector('h2')?.textContent ?? null,
        effective: effective ? (effective.innerText ?? null) : null,
        pending: pending ? (pending.innerText ?? null) : null,
        requests: requests.map((node) => ({
          heading: node.querySelector('h3,h4')?.textContent ?? null,
          text: node.innerText ?? null,
          approve: Boolean([...node.querySelectorAll('button')].find((button) => /Duyệt đặt chỗ|Approve reservation/.test(button.textContent))),
          reject: Boolean([...node.querySelectorAll('button')].find((button) => /Từ chối yêu cầu|Reject request/.test(button.textContent))),
        })),
        reasonField: Boolean([...document.querySelectorAll('label')].find((label) => /^(Lý do đặt chỗ|Reservation reason)$/.test(label.textContent.trim()))),
        submit: Boolean([...document.querySelectorAll('button')].find((button) => /Gửi yêu cầu đặt chỗ|Submit reservation request/.test(button.textContent))),
        text: panel?.innerText ?? null,
      };
    }`,
    session,
  );
}
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
const settled = `() => {
  const panel = document.querySelector('section.reservation');
  return Boolean(panel) && panel.dataset.loaded === 'yes' && !panel.querySelector('button[disabled]');
}`;
async function settle(session = primary) {
  await waitUntil(settled, session);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await waitUntil(settled, session);
}
async function userClient(name) {
  const fixture = fixtures.identities[name];
  const client = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email: fixture.email,
    password: fixture.password,
  });
  assert.equal(error, null, 'Real fixture authentication failed');
  assert.equal(data.user.id, fixture.userId, 'Fixture identity mismatch');
  return client;
}
class ApplicationSession {
  cookies = new Map();
  async request(route, body) {
    const response = await fetch(origin + route, {
      redirect: 'manual',
      headers: {
        Connection: 'close',
        Cookie: [...this.cookies]
          .map(([name, value]) => name + '=' + value)
          .join('; '),
        ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const part = cookie.split(';')[0];
      const index = part.indexOf('=');
      this.cookies.set(part.slice(0, index), part.slice(index + 1));
    }
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body:
        response.status === 204
          ? null
          : await response.json().catch(() => null),
    };
  }
  login(name) {
    const fixture = fixtures.identities[name];
    return this.request('/api/auth/login', {
      email: fixture.email,
      password: fixture.password,
      locale: 'vi',
    });
  }
}
function initializeBrowser(session) {
  const pages = browser(['pages'], session);
  const firstPage = pages.match(/^\s*(\d+),/m);
  assert.ok(firstPage, 'Dedicated browser profile has no initial page');
  browser(['selectpage', firstPage[1]], session);
}
// The auth shell names its language buttons by aria-label, so the switch is selected by the
// button's lang attribute and the active locale is read from the shell element.
async function browserLogin(name, session, preferredLocale) {
  browser(['open', origin + '/login'], session);
  if (preferredLocale) {
    evaluate(
      `() => {
        const button = document.querySelector('.sgn-lang-btn[lang="${preferredLocale}"]');
        if (button) button.click();
        return Boolean(button);
      }`,
      session,
    );
    await waitUntil(
      `() => document.querySelector('.sgn-auth')?.lang === '${preferredLocale}'`,
      session,
      20,
    );
  }
  const fixture = fixtures.identities[name];
  fill('Email', fixture.email, session);
  const locale = evaluate(
    `() => document.querySelector('.sgn-auth')?.lang ?? document.documentElement.lang`,
    session,
  );
  fill(locale === 'en' ? 'Password' : 'Mật khẩu', fixture.password, session);
  click(locale === 'en' ? 'Sign in' : 'Đăng nhập', session);
  wait('Kho bất động sản', session);
}

const main = fixtures.properties.main;
const self = fixtures.properties.self;
const detail = (property) => origin + '/properties/' + property.id;
const reservationRoute = (property) =>
  '/api/properties/' + property.id + '/reservations';
const decisionRoute = (property) => reservationRoute(property) + '/decision';

// The declared fixture roles and display names are asserted before the journey so a sales
// decision denial and an independent manager/admin decision mean what the ticket says.
const declared = operatorSql(
  `select id, role, display_name, is_active from public.employees where id in ('${fixtures.identities.claimant.employeeId}','${fixtures.identities.rival.employeeId}','${fixtures.identities.manager.employeeId}','${fixtures.identities.admin.employeeId}')`,
);
const declaredBy = (name) =>
  declared.find((row) => row.id === fixtures.identities[name].employeeId);
assert.equal(declaredBy('claimant').role, 'sales');
assert.equal(declaredBy('rival').role, 'sales');
assert.equal(declaredBy('manager').role, 'manager');
assert.equal(declaredBy('admin').role, 'admin');
assert.ok(
  declared.every((row) => row.is_active),
  'Declared fixtures must start active',
);
const mainRow = operatorSql(
  `select id, status, archived_at from public.properties where id = '${main.id}'`,
)[0];
const selfRow = operatorSql(
  `select id, status, archived_at from public.properties where id = '${self.id}'`,
)[0];
assert.equal(mainRow.status, 'available');
assert.equal(mainRow.archived_at, null);
assert.equal(selfRow.status, 'negotiating');
assert.equal(selfRow.archived_at, null);

const baselineTables = [
  'properties',
  'employees',
  'property_locks',
  'lock_events',
  'activity_events',
];
const countOf = (table) =>
  Number(operatorSql(`select count(*)::int as n from public.${table}`)[0].n);
const baseline = Object.fromEntries(
  baselineTables.map((table) => [table, countOf(table)]),
);
assert.equal(
  Number(
    operatorSql(
      `select count(*)::int as n from public.property_locks where property_id in ('${main.id}','${self.id}')`,
    )[0].n,
  ),
  0,
  'The declared namespace must carry no reservation rows before the run',
);

const createdLocks = [];
function releaseCreated() {
  for (const lock of createdLocks)
    operatorSql(
      `do $$ begin update public.property_locks set status='released', released_at=now() where id='${lock.id}' and status in ('pending','approved'); end $$;`,
    );
}
function setActive(name, active) {
  operatorSql(
    `do $$ begin update public.employees set is_active=${active} where id='${fixtures.identities[name].employeeId}'; end $$;`,
  );
}
function lockRows(property) {
  return operatorSql(
    `select id, requested_by, status, expires_at, decided_by from public.property_locks where property_id = '${property.id}' order by requested_at`,
  );
}
function effectiveRows(property) {
  return operatorSql(
    `select id, requested_by, employee_name, expires_at from public.v_effective_property_locks where property_id = '${property.id}'`,
  );
}
// Any failure must still return the fixture identities and release the created reservations.
function restoreAndExit(error) {
  try {
    releaseCreated();
  } catch {
    console.error(
      'FIXTURE RESTORE FAILED: release ' +
        createdLocks.map((row) => row.id).join(','),
    );
  }
  for (const name of ['claimant', 'rival', 'manager', 'admin']) {
    try {
      setActive(name, true);
    } catch {
      console.error(
        'FIXTURE RESTORE FAILED: reactivate ' +
          fixtures.identities[name].employeeId,
      );
    }
  }
  console.error(error);
  process.exit(1);
}
process.on('uncaughtException', restoreAndExit);
process.on('unhandledRejection', restoreAndExit);

const claimant = await userClient('claimant');
const rival = await userClient('rival');
const manager = await userClient('manager');

// ------------------------------------------------------------------ anonymous boundary
{
  const anonymous = new ApplicationSession();
  assert.equal(
    (await anonymous.request(reservationRoute(main))).status,
    401,
    'Anonymous reservation reads are denied',
  );
  assert.equal(
    (await anonymous.request(reservationRoute(main), { reason })).status,
    401,
    'Anonymous reservation requests are denied',
  );
  for (const table of ['property_locks', 'lock_events']) {
    const response = await fetch(
      environment.supabaseUrl + '/rest/v1/' + table + '?select=id',
      { headers: { apikey: environment.publishableKey } },
    );
    assert.equal(response.status, 401);
  }
  observed('anonymous application and direct reservation access denied');
}

// ------------------------------------------------------------------ request and pending state
initializeBrowser(primary);
initializeBrowser(secondary);
await browserLogin('claimant', primary, 'vi');
browser(['open', detail(main)], primary);
await settle(primary);
{
  const page = screen(primary);
  assert.equal(page.locale, 'vi', 'VI is the default interface language');
  assert.equal(page.heading, 'Đặt chỗ');
  assert.equal(page.effective, null, 'Nothing is effective before a decision');
  assert.equal(page.pending, null, 'No pending request exists yet');
  assert.equal(page.reasonField, true, 'The request form is offered');
  assert.equal(page.submit, true, 'The submit control is present');
  fill('Lý do đặt chỗ', reason, primary);
  click('Gửi yêu cầu đặt chỗ', primary);
  await waitUntil(
    "() => document.querySelector('section.reservation .reservation-pending')",
    primary,
  );
  await settle(primary);
  const pending = screen(primary);
  assert.equal(
    pending.effective,
    null,
    'A submitted request must not render as an effective reservation',
  );
  assert.ok(pending.pending.includes('Yêu cầu của bạn đang chờ duyệt'));
  assert.ok(
    pending.pending.includes('Yêu cầu đang chờ không giữ bất động sản'),
    'The pending state states that the property is not held',
  );
  assert.equal(pending.status, 'Đang chào', 'Property status is unchanged');
  observed('VI detail action submits a request and shows only a pending state');
}
const firstLock = lockRows(main);
assert.equal(firstLock.length, 1, 'The UI request committed one pending row');
createdLocks.push({ id: firstLock[0].id });
assert.equal(firstLock[0].status, 'pending');
assert.equal(
  effectiveRows(main).length,
  0,
  'A pending request never appears in the effective view',
);
{
  const mine = new ApplicationSession();
  assert.equal((await mine.login('claimant')).status, 200);
  const state = await mine.request(reservationRoute(main));
  assert.equal(state.status, 200);
  assert.equal(state.body.effective, null);
  assert.equal(state.body.pending.length, 1);
  assert.equal(
    state.body.pending[0].claimantId,
    fixtures.identities.claimant.employeeId,
  );
  assert.equal(
    state.body.pending[0].claimantName,
    declaredBy('claimant').display_name,
  );
  assert.equal(state.body.canDecide, false, 'sales cannot decide');
  assert.match(state.cache, /no-store/);
  observed('pending request is visible to its own claimant, who cannot decide');
}

// ------------------------------------------------------------------ the rival's independent request
let rivalLock;
{
  const direct = await rival
    .from('property_locks')
    .insert({
      property_id: main.id,
      requested_by: fixtures.identities.rival.employeeId,
      reason,
    })
    .select('id');
  assert.equal(
    direct.error?.code,
    '42501',
    'Direct lock writes stay unavailable to the browser client',
  );
  const session = new ApplicationSession();
  assert.equal((await session.login('rival')).status, 200);
  const response = await session.request(reservationRoute(main), { reason });
  assert.equal(response.status, 200);
  assert.equal(response.body.pending.length, 1);
  assert.equal(response.body.canDecide, false);
  rivalLock = response.body.pending[0].id;
  createdLocks.push({ id: rivalLock });
}
{
  const rows = lockRows(main);
  assert.equal(
    rows.length,
    2,
    'Two independent employees hold pending requests',
  );
  assert.equal(
    effectiveRows(main).length,
    0,
    'Two pending requests still reserve nothing',
  );
}

// ------------------------------------------------------------------ sales cannot decide
{
  const session = new ApplicationSession();
  assert.equal((await session.login('claimant')).status, 200);
  const denied = await session.request(decisionRoute(main), {
    lockId: rivalLock,
    approve: true,
    reason: decisionReason,
    days: 7,
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: 'access-denied' });
  assert.equal(
    (
      await claimant.rpc('decide_property_lock', {
        p_lock_id: rivalLock,
        p_approve: true,
        p_reason: decisionReason,
        p_days: 7,
      })
    ).error?.code,
    '42501',
  );
  const directUpdate = await claimant
    .from('property_locks')
    .update({ status: 'approved' })
    .eq('id', rivalLock)
    .select('id');
  assert.equal(directUpdate.error?.code, '42501');
  const directInsert = await claimant
    .from('property_locks')
    .insert({
      property_id: self.id,
      requested_by: fixtures.identities.claimant.employeeId,
      reason,
    })
    .select('id');
  assert.equal(directInsert.error?.code, '42501');
  const directEvent = await claimant
    .from('lock_events')
    .insert({
      lock_id: rivalLock,
      action: 'approved',
      reason: decisionReason,
    })
    .select('id');
  assert.equal(directEvent.error?.code, '42501');
  observed('sales decision and direct lock/event writes are denied');
}

// ------------------------------------------------------------------ self approval is refused
let managerOwnLock;
{
  const session = new ApplicationSession();
  assert.equal((await session.login('manager')).status, 200);
  const requested = await session.request(reservationRoute(self), { reason });
  assert.equal(requested.status, 200);
  managerOwnLock = requested.body.pending[0].id;
  createdLocks.push({ id: managerOwnLock });
  const denied = await session.request(decisionRoute(self), {
    lockId: managerOwnLock,
    approve: true,
    reason: decisionReason,
    days: 7,
  });
  assert.equal(denied.status, 409);
  assert.deepEqual(denied.body, { error: 'self-approval-forbidden' });
  assert.equal(
    (
      await manager.rpc('decide_property_lock', {
        p_lock_id: managerOwnLock,
        p_approve: true,
        p_reason: decisionReason,
        p_days: 7,
      })
    ).error?.code,
    '42501',
  );
  assert.equal(
    lockRows(self)[0].status,
    'pending',
    'The refused self approval changed no committed state',
  );
  await browserLogin('manager', secondary, 'vi');
  browser(['open', detail(self)], secondary);
  await settle(secondary);
  const page = screen(secondary);
  assert.equal(page.effective, null);
  assert.ok(page.pending.includes('Yêu cầu của bạn đang chờ duyệt'));
  assert.equal(page.requests.length, 1);
  assert.equal(
    page.requests[0].approve,
    false,
    'A reviewer sees no decision control on their own request',
  );
  assert.equal(page.requests[0].reject, false);
  assert.ok(
    page.requests[0].text.includes('Bạn không thể tự duyệt yêu cầu của mình'),
  );
  observed(
    'manager cannot approve their own request through the UI, the application or the RPC',
  );
}

// ------------------------------------------------------------------ independent competing approvals
{
  const managerSession = new ApplicationSession();
  const adminSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  assert.equal((await adminSession.login('admin')).status, 200);
  // Genuinely independent sessions: a manager and an admin approve the two pending requests
  // for the same property without either waiting for the other to finish.
  const [managerResult, adminResult] = await Promise.all([
    managerSession.request(decisionRoute(main), {
      lockId: firstLock[0].id,
      approve: true,
      reason: decisionReason,
      days: 14,
    }),
    adminSession.request(decisionRoute(main), {
      lockId: rivalLock,
      approve: true,
      reason: decisionReason,
      days: 21,
    }),
  ]);
  const outcomes = [managerResult.status, adminResult.status].sort();
  assert.deepEqual(
    outcomes,
    [200, 409],
    'Exactly one competing approval commits',
  );
  const conflict = managerResult.status === 409 ? managerResult : adminResult;
  assert.equal(conflict.body.error, 'reservation-conflict');
  const rows = lockRows(main);
  assert.equal(
    rows.filter((row) => row.status === 'approved').length,
    1,
    'One approved reservation remains',
  );
  const effective = effectiveRows(main);
  assert.equal(effective.length, 1, 'One effective reservation remains');
  const approvals = operatorSql(
    `select action from public.lock_events where lock_id in ('${firstLock[0].id}','${rivalLock}') order by id`,
  ).filter((row) => row.action === 'approved');
  assert.equal(approvals.length, 1, 'One approval event was recorded');
  observed(
    'independent-session competing approvals leave exactly one effective reservation',
    { statuses: outcomes, effective: effective.length },
  );
  const winner = effective[0];
  const fresh = new ApplicationSession();
  assert.equal((await fresh.login('rival')).status, 200);
  const read = await fresh.request(reservationRoute(main));
  assert.deepEqual(
    {
      id: read.body.effective.id,
      claimantId: read.body.effective.claimantId,
      expiresAt: read.body.effective.expiresAt,
    },
    {
      id: winner.id,
      claimantId: winner.requested_by,
      expiresAt: winner.expires_at,
    },
    'The application read agrees with the committed reservation',
  );
  assert.equal(
    read.body.pending.length,
    0,
    'No pending request remains visible as effective',
  );
}

// ------------------------------------------------------------------ fresh detail and language journey
{
  const winner = effectiveRows(main)[0];
  browser(['open', detail(main)], primary);
  await settle(primary);
  const page = screen(primary);
  assert.ok(
    page.effective?.includes('Đã có đặt chỗ hiệu lực'),
    'A fresh detail shows the effective reservation',
  );
  assert.ok(
    page.effective.includes(winner.employee_name),
    'The effective reservation names the claimant',
  );
  assert.ok(
    page.effective.includes('/'),
    'The effective reservation shows the expiry date',
  );
  assert.equal(
    page.pending,
    null,
    'The approved claimant no longer sees a pending state',
  );
  assert.equal(
    page.reasonField,
    false,
    'No new request is offered while a reservation is effective',
  );
  evaluate(
    "() => { document.documentElement.dataset.probe = 'reservation'; return true; }",
    primary,
  );
  click('English', primary);
  await waitUntil(
    `() => document.querySelector('main')?.lang === 'en'`,
    primary,
  );
  await settle(primary);
  const english = screen(primary);
  assert.equal(english.heading, 'Reservations');
  assert.ok(english.effective?.includes('Effective reservation'));
  assert.ok(english.effective.includes(winner.employee_name));
  assert.ok(
    english.text.includes(
      'Only an approved, unexpired reservation holds the property.',
    ),
  );
  click('Tiếng Việt', primary);
  await waitUntil(
    `() => document.querySelector('main')?.lang === 'vi'`,
    primary,
  );
  await settle(primary);
  const vietnamese = screen(primary);
  assert.equal(vietnamese.heading, 'Đặt chỗ');
  assert.ok(vietnamese.effective?.includes('Đã có đặt chỗ hiệu lực'));
  assert.ok(vietnamese.effective.includes(winner.employee_name));
  assert.equal(
    evaluate('() => document.documentElement.dataset.probe', primary),
    'reservation',
    'The language switch kept the open property page',
  );
  observed(
    'VI/default and EN detail render the same effective reservation with claimant and expiry',
  );
}

// ------------------------------------------------------------------ inherited live deactivation
{
  setActive('claimant', false);
  const denied = new ApplicationSession();
  assert.equal((await denied.login('claimant')).status, 403);
  assert.equal(
    (
      await claimant.rpc('request_property_lock', {
        p_property_id: self.id,
        p_reason: reason,
      })
    ).error?.code,
    '42501',
  );
  const live = await userClient('claimant');
  assert.ok(
    (await live.auth.getUser()).data.user,
    'The Auth identity still authenticates',
  );
  const direct = await live.from('property_locks').select('id');
  assert.equal(direct.error, null);
  assert.deepEqual(
    direct.data,
    [],
    'A deactivated employee reads no reservations',
  );
  observed(
    'live deactivation denies the reservation surface without erasing committed reservations',
    { directRows: 0 },
  );
  setActive('claimant', true);
}

// ------------------------------------------------------------------ sign-out clears the surface
{
  const winner = effectiveRows(main)[0];
  browser(['open', detail(main)], primary);
  await settle(primary);
  assert.ok(
    screen(primary).effective,
    'The restored identity still reads the reservation',
  );
  click('Đăng xuất', primary);
  browser(['back'], primary);
  await waitUntil(
    `() => !document.body.innerText.includes(${JSON.stringify(winner.employee_name)})`,
    primary,
  );
  browser(['open', detail(main)], primary);
  wait('Đăng nhập', primary);
  assert.equal(screen(primary).path, '/login');
  observed('sign-out and Back navigation reveal no reservation detail');
}

// ------------------------------------------------------------------ restore and compare
releaseCreated();
for (const name of ['claimant', 'rival', 'manager', 'admin'])
  setActive(name, true);
const after = Object.fromEntries(
  baselineTables.map((table) => [table, countOf(table)]),
);
assert.equal(
  after.property_locks,
  baseline.property_locks + createdLocks.length,
  'The run created exactly the reservation rows it reports',
);
assert.equal(after.properties, baseline.properties);
assert.equal(after.employees, baseline.employees);
assert.equal(after.activity_events, baseline.activity_events);
const restored = lockRows(main).concat(lockRows(self));
assert.deepEqual(
  restored.map((row) => row.status),
  restored.map(() => 'released'),
  'No reservation created by this run stays approved or pending',
);

const report = {
  checkedAt: new Date().toISOString(),
  environment:
    'authorized hosted development Supabase / local real Next.js application',
  projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
  namespace: fixtures.namespace,
  observations,
  fixtureRows: {
    created: createdLocks.map((row) => row.id),
    released: restored.map((row) => ({ id: row.id, status: row.status })),
    baseline,
    after,
  },
  limits: [
    'Fixture-only writes: the declared SGN-TEST-18 identities and properties exist before the run and are returned to active; the created reservations are released and remain as fixture history, not as effective reservations.',
    'The competing approvals use two independent authenticated sessions; this is not a production contention gate.',
    'Real mailbox recovery, production import and deployment remain outside this run.',
  ],
};
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0 && process.argv[reportIndex + 1]) {
  await fs.writeFile(
    process.argv[reportIndex + 1],
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  JSON.stringify({ observations: observations.length, outcomes: report }),
);
