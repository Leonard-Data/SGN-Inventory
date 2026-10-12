// Issue #18 hosted acceptance: reservation request and independent decision.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and
// real Chrome sessions. Mock, shim, source-text and readiness-page results are not
// acceptance. The run creates no property fixture: it uses existing unarchived available or
// negotiating inventory read-only, plus the synthetic SGN-TEST-18 identities declared in the
// private manifest. It removes exactly the lock and lock-event rows it creates, by exact ID,
// and re-reads the row counts it recorded before the journey.
//
// Usage:
//   SGN_ACCEPTANCE_FIXTURES=<private manifest> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi.js>] \
//   [SGN_ACCEPTANCE_BROWSER_URLS='{"session":"http://127.0.0.1:port"}'] \
//   node --env-file-if-exists=.env.local scripts/reservation-acceptance.mjs \
//     --allow-deactivation [--report <sanitized json path>]
//
// The manifest supplies the SGN-TEST-18 identities (a sales claimant, a manager and an
// admin), the two existing inventory properties the run reserves, and passwords; the
// operator config supplies the owner connection string for fixture-only reads and resets.
// Neither file is ever printed or committed.
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
for (const name of ['claimant', 'manager', 'admin'])
  assert.equal(
    typeof fixtures.identities[name]?.employeeId,
    'string',
    'Missing declared fixture identity',
  );
for (const name of ['main', 'reject'])
  assert.equal(
    typeof fixtures.properties[name]?.id,
    'string',
    'Missing declared inventory property',
  );
const origin = environment.appUrl;
const observations = [];
const reason = 'Khách đã đồng ý điều kiện, chờ quản lý duyệt đặt chỗ';
const decisionReason =
  'Đã kiểm tra thông tin và xác nhận độc lập cho đặt chỗ này';
const rejectReason = 'Thông tin chưa đủ để giữ bất động sản cho khách này';

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
// The reservation request and decision forms are driven through the browser CLI's own
// snapshot/fill/click path, by accessible name, so the run exercises the controls the user
// sees; a control the bridge cannot reach fails by name instead of falling back. The auth
// form, language switch and account menu keep the same real handlers (the input's native
// value setter plus an input event, the form's own requestSubmit and the control's own
// activation) the earlier harnesses use.
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
const submitForm = (selector) => `(() => {
  const form = document.querySelector(${JSON.stringify(selector)});
  if (!form) return false;
  form.requestSubmit();
  return true;
})()`;
const clickMatching = (pattern, scope = 'body') => `(() => {
  const node = [...document.querySelectorAll(${JSON.stringify(scope)})].find((el) => new RegExp(${JSON.stringify(pattern)}).test(el.textContent.trim()));
  if (!node) return false;
  node.click();
  return true;
})()`;
function act(expression, session, what) {
  assert.equal(evaluate(expression, session), true, `Could not ${what}`);
}
function filled(selector, value, session, what) {
  act(setInput(selector, value), session, what);
}
function submitted(selector, session, what) {
  act(submitForm(selector), session, what);
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
function requestFormFilled(value, session) {
  fill('Lý do đặt chỗ', value, session);
  click('Gửi yêu cầu đặt chỗ', session);
}
function decisionFormFilled(value, session) {
  fill('Lý do quyết định', value, session);
}
function waitForText(text, session = primary, attempts = 60) {
  return waitUntil(
    `() => document.body.innerText.includes(${JSON.stringify(text)})`,
    session,
    attempts,
  );
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
        locale: document.documentElement.lang,
        code: document.querySelector('h1')?.textContent?.trim(),
        status:
          document.querySelector('.head-chips .badge')?.textContent?.trim() ??
          null,
        heading: panel?.querySelector('h2')?.textContent ?? null,
        effective: effective ? (effective.innerText ?? null) : null,
        pending: pending ? (pending.innerText ?? null) : null,
        requests: requests.map((node) => ({
          heading: node.querySelector('h3,h4')?.textContent?.trim() ?? null,
          text: node.innerText ?? null,
          approve: Boolean([...node.querySelectorAll('button')].find((button) => /Duyệt đặt chỗ|Approve reservation/.test(button.textContent))),
          reject: Boolean([...node.querySelectorAll('button')].find((button) => /Từ chối yêu cầu|Reject request/.test(button.textContent))),
        })),
        reasonField: Boolean([...document.querySelectorAll('label')].find((label) => /^(Lý do đặt chỗ|Reservation reason)$/.test(label.textContent.trim()))),
        submit: Boolean([...document.querySelectorAll('button')].find((button) => /Gửi yêu cầu đặt chỗ|Submit reservation request/.test(button.textContent))),
        forms: [...(panel?.querySelectorAll('form') ?? [])].map((form) => ({
          fields: [...form.querySelectorAll('.field')].map((field) => {
            const label = field.querySelector('label');
            const control = field.querySelector('input, select, textarea');
            const labelBox = label?.getBoundingClientRect();
            const controlBox = control?.getBoundingClientRect();
            return {
              label: label?.textContent?.trim() ?? null,
              tag: control?.tagName.toLowerCase() ?? null,
              className: control?.getAttribute('class') ?? null,
              labelAboveControl: Boolean(labelBox && controlBox) && labelBox.bottom <= controlBox.top,
            };
          }),
          buttons: [...form.querySelectorAll('button')].map((button) => button.getAttribute('class') ?? ''),
        })),
        text: panel?.innerText ?? null,
      };
    }`,
    session,
  );
}
// The rendered control vocabulary is observed, not assumed: each field's label must sit above
// its control and the control must carry the design-system class for its own element.
function designSystemForm(form, tags) {
  const classes = (value) => (value ?? '').split(/\s+/);
  return (
    Boolean(form) &&
    form.fields.length === tags.length &&
    form.fields.every(
      (field, index) =>
        field.labelAboveControl &&
        field.tag === tags[index] &&
        classes(field.className).includes(tags[index]),
    ) &&
    form.buttons.length > 0 &&
    form.buttons.every((button) => classes(button).includes('btn'))
  );
}
const formWithLabel = (page, label) =>
  page.forms.find((form) =>
    form.fields.some((field) => field.label === label),
  );
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
        const button = document.querySelector('.lang-btn[lang="${preferredLocale}"]');
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
  filled('#email', fixture.email, session, 'fill the fixture email');
  filled('#password', fixture.password, session, 'fill the fixture password');
  submitted('.sgn-auth form', session, 'submit the sign-in form');
  await waitUntil(`() => location.pathname === '/properties'`, session);
}

const main = fixtures.properties.main;
const reject = fixtures.properties.reject;
const detail = (property) => origin + '/properties/' + property.id;
const reservationRoute = (property) =>
  '/api/properties/' + property.id + '/reservations';
const decisionRoute = (property) => reservationRoute(property) + '/decision';

// The declared identities, roles and inventory are asserted before the journey. Existing
// inventory stays read-only: no property, address or contact row is written by this run.
const declared = operatorSql(
  `select id, role, display_name, is_active from public.employees where id in ('${fixtures.identities.claimant.employeeId}','${fixtures.identities.manager.employeeId}','${fixtures.identities.admin.employeeId}')`,
);
const declaredBy = (name) =>
  declared.find((row) => row.id === fixtures.identities[name].employeeId);
assert.ok(declaredBy('claimant'), 'Missing declared claimant employee');
assert.equal(declaredBy('claimant').role, 'sales');
assert.equal(declaredBy('manager').role, 'manager');
assert.equal(declaredBy('admin').role, 'admin');
assert.ok(
  declared.every((row) => row.is_active),
  'Declared fixtures must start active',
);
function eligibleInventory(property) {
  const row = operatorSql(
    `select p.id, p.property_code, p.status, p.archived_at, (select count(*)::int from public.property_locks l where l.property_id = p.id) as locks from public.properties p where p.id = '${property.id}'`,
  )[0];
  assert.ok(
    row,
    `Declared inventory property ${property.code} does not exist: stop and report instead of creating a property fixture.`,
  );
  assert.equal(
    row.archived_at,
    null,
    `Declared inventory property ${row.property_code} is archived: stop and report instead of creating a property fixture.`,
  );
  assert.ok(
    row.status === 'available' || row.status === 'negotiating',
    `Declared inventory property ${row.property_code} is ${row.status}, not available/negotiating: stop and report instead of creating a property fixture.`,
  );
  assert.equal(
    Number(row.locks),
    0,
    `Declared inventory property ${row.property_code} already carries a reservation row: stop and report instead of clearing it.`,
  );
  return row;
}
const mainRow = eligibleInventory(main);
const rejectRow = eligibleInventory(reject);

const baselineTables = [
  'properties',
  'employees',
  'property_locks',
  'lock_events',
  'activity_events',
];
const countOf = (table) =>
  Number(operatorSql(`select count(*)::int as n from public.${table}`)[0].n);
const idSetOf = (table) =>
  new Set(
    operatorSql(`select id::text as id from public.${table} order by id`).map(
      (row) => row.id,
    ),
  );
const baseline = Object.fromEntries(
  baselineTables.map((table) => [table, countOf(table)]),
);
// The whole shared project is not quiet: the row identities recorded here prove that no
// pre-run row disappears, and any addition this run did not write is listed rather than
// silently accepted. Additions are only tolerated for activity events.
const baselineIds = Object.fromEntries(
  baselineTables.map((table) => [table, idSetOf(table)]),
);
// The browser journey records page views for these identities; they are fixture writes and
// are removed by exact ID with the reservation rows this run creates.
const fixtureIds = ['claimant', 'manager', 'admin']
  .map((name) => `'${fixtures.identities[name].employeeId}'`)
  .join(',');
const activityIds = (statement) => operatorSql(statement).map((row) => row.id);
const fixtureActivity = `select id from public.activity_events where employee_id in (${fixtureIds})`;
const activityBefore = new Set(activityIds(fixtureActivity));

function lockRows(property) {
  return operatorSql(
    `select id, requested_by, status, expires_at, decided_at, decision_reason, decided_by from public.property_locks where property_id = '${property.id}' order by requested_at`,
  );
}
// Every reservation row this run can write belongs to a declared fixture identity, so cleanup
// is exact even when the run stops before it records the row it just created.
function myLockIds() {
  return operatorSql(
    `select id from public.property_locks where requested_by in (${fixtureIds}) order by id`,
  ).map((row) => row.id);
}
function eventsFor(ids) {
  return operatorSql(
    ids.length
      ? `select id, lock_id, action, reason from public.lock_events where lock_id in ('${ids.join("','")}') order by id`
      : `select id, lock_id, action, reason from public.lock_events where false`,
  );
}
function effectiveRows(property) {
  return operatorSql(
    `select id, requested_by, employee_name, expires_at from public.v_effective_property_locks where property_id = '${property.id}'`,
  );
}
// Exact-ID cleanup of the rows this run wrote. Existing inventory is never touched.
function removeCreated() {
  for (const id of myLockIds())
    operatorSql(
      `do $$ begin delete from public.lock_events where lock_id='${id}'; delete from public.property_locks where id='${id}'; end $$;`,
    );
  for (const id of activityIds(fixtureActivity))
    if (!activityBefore.has(id))
      operatorSql(
        `do $$ begin delete from public.activity_events where id='${id}'; end $$;`,
      );
}
function setActive(name, active) {
  operatorSql(
    `do $$ begin update public.employees set is_active=${active} where id='${fixtures.identities[name].employeeId}'; end $$;`,
  );
}
// Any failure must still remove the created rows and return the fixture identities to active.
function restoreAndExit(error) {
  try {
    removeCreated();
  } catch {
    console.error(
      'FIXTURE RESTORE FAILED: remove rows requested by the declared identities',
    );
  }
  for (const name of ['claimant', 'manager', 'admin']) {
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
  const requestForm = formWithLabel(page, 'Lý do đặt chỗ');
  assert.ok(
    designSystemForm(requestForm, ['textarea']),
    'The request form renders each field label above its control with the design-system classes',
  );
  requestFormFilled(reason, primary);
  await waitUntil(
    "() => Boolean(document.querySelector('section.reservation .reservation-pending'))",
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
  observed('VI detail action submits a request and shows only a pending state', {
    requestForm,
  });
}
const firstLock = lockRows(main);
assert.equal(firstLock.length, 1, 'The UI request committed one pending row');
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

// ------------------------------------------------------------------ a second pending request
let managerLock;
{
  const direct = await claimant
    .from('property_locks')
    .insert({
      property_id: main.id,
      requested_by: fixtures.identities.claimant.employeeId,
      reason,
    })
    .select('id');
  assert.equal(
    direct.error?.code,
    '42501',
    'Direct lock writes stay unavailable to the browser client',
  );
  const session = new ApplicationSession();
  assert.equal((await session.login('manager')).status, 200);
  const response = await session.request(reservationRoute(main), { reason });
  assert.equal(response.status, 200);
  // A reviewer sees every open request on the property, including their own.
  assert.equal(
    response.body.pending.length,
    2,
    'The reviewer sees both open requests',
  );
  assert.equal(response.body.canDecide, true);
  managerLock = response.body.pending.find(
    (request) => request.claimantId === fixtures.identities.manager.employeeId,
  )?.id;
  assert.ok(managerLock, 'The manager request is listed for the reviewer');
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
  const mine = new ApplicationSession();
  assert.equal((await mine.login('claimant')).status, 200);
  const state = await mine.request(reservationRoute(main));
  assert.equal(
    state.body.pending.length,
    1,
    'A sales employee sees only their own pending request',
  );
  assert.equal(
    state.body.pending[0].claimantId,
    fixtures.identities.claimant.employeeId,
  );
  assert.equal(state.body.canDecide, false);
}

// ------------------------------------------------------------------ sales cannot decide
{
  const session = new ApplicationSession();
  assert.equal((await session.login('claimant')).status, 200);
  const denied = await session.request(decisionRoute(main), {
    lockId: managerLock,
    approve: true,
    reason: decisionReason,
    days: 7,
  });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body, { error: 'access-denied' });
  assert.equal(
    (
      await claimant.rpc('decide_property_lock', {
        p_lock_id: managerLock,
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
    .eq('id', managerLock)
    .select('id');
  assert.equal(directUpdate.error?.code, '42501');
  const directInsert = await claimant
    .from('property_locks')
    .insert({
      property_id: reject.id,
      requested_by: fixtures.identities.claimant.employeeId,
      reason,
    })
    .select('id');
  assert.equal(directInsert.error?.code, '42501');
  const directEvent = await claimant
    .from('lock_events')
    .insert({
      lock_id: managerLock,
      action: 'approved',
      reason: decisionReason,
    })
    .select('id');
  assert.equal(directEvent.error?.code, '42501');
  observed('sales decision and direct lock/event writes are denied');
}

// ------------------------------------------------------------------ self approval is refused
{
  const session = new ApplicationSession();
  assert.equal((await session.login('manager')).status, 200);
  const denied = await session.request(decisionRoute(main), {
    lockId: managerLock,
    approve: true,
    reason: decisionReason,
    days: 7,
  });
  assert.equal(denied.status, 409);
  assert.deepEqual(denied.body, { error: 'self-approval-forbidden' });
  assert.equal(
    (
      await manager.rpc('decide_property_lock', {
        p_lock_id: managerLock,
        p_approve: true,
        p_reason: decisionReason,
        p_days: 7,
      })
    ).error?.code,
    '42501',
  );
  assert.equal(
    lockRows(main).find((row) => row.id === managerLock).status,
    'pending',
    'The refused self approval changed no committed state',
  );
  await browserLogin('manager', secondary, 'vi');
  browser(['open', detail(main)], secondary);
  await settle(secondary);
  const page = screen(secondary);
  assert.equal(page.effective, null);
  assert.ok(
    page.pending?.includes('Yêu cầu của bạn đang chờ duyệt'),
    'The manager sees their own request as pending',
  );
  assert.equal(page.requests.length, 2, 'Both pending requests are listed');
  const own = page.requests.find(
    (request) => request.heading === declaredBy('manager').display_name,
  );
  const other = page.requests.find(
    (request) => request.heading === declaredBy('claimant').display_name,
  );
  assert.ok(own && other, 'Both claimants are named');
  assert.equal(
    own.approve,
    false,
    'A reviewer sees no decision control on their own request',
  );
  assert.equal(own.reject, false);
  assert.ok(own.text.includes('Bạn không thể tự duyệt yêu cầu của mình'));
  assert.equal(other.approve, true, 'Another employee request is decidable');
  assert.equal(other.reject, true);
  observed(
    'manager cannot approve their own request through the UI, the application or the RPC',
  );
}

// ------------------------------------------------------------------ reject through the surface
let rejectedLock;
{
  const session = new ApplicationSession();
  assert.equal((await session.login('claimant')).status, 200);
  const requested = await session.request(reservationRoute(reject), {
    reason,
  });
  assert.equal(requested.status, 200);
  rejectedLock = requested.body.pending[0].id;
  browser(['open', detail(reject)], secondary);
  await settle(secondary);
  const before = screen(secondary);
  assert.equal(before.effective, null);
  assert.equal(
    before.requests.length,
    1,
    'The pending request is offered to the reviewer',
  );
  const decisionForm = formWithLabel(before, 'Lý do quyết định');
  assert.ok(
    designSystemForm(decisionForm, ['textarea', 'select']),
    'The decision form renders each field label above its control with the design-system classes',
  );
  decisionFormFilled(rejectReason, secondary);
  click('Từ chối yêu cầu', secondary);
  await waitForText('Đã từ chối yêu cầu.', secondary);
  await settle(secondary);
  const after = screen(secondary);
  assert.equal(after.effective, null, 'A rejected request reserves nothing');
  assert.equal(after.requests.length, 0);
  assert.ok(
    after.reasonField,
    'The property is offered again after the rejection',
  );
  const row = lockRows(reject).find((lock) => lock.id === rejectedLock);
  assert.equal(row.status, 'rejected');
  assert.equal(row.decided_by, fixtures.identities.manager.employeeId);
  assert.equal(
    row.decision_reason,
    rejectReason,
    'The rejected row stored the reason submitted through the surface',
  );
  const eventRows = eventsFor([rejectedLock]);
  assert.deepEqual(
    eventRows.map((event) => event.action),
    ['requested', 'rejected'],
  );
  assert.equal(
    eventRows.find((event) => event.action === 'rejected').reason,
    rejectReason,
    'The rejected event carries the reason submitted through the surface',
  );
  assert.equal(effectiveRows(reject).length, 0);
  observed(
    'a manager rejects another employee request with a reason and no reservation is created',
    { decisionForm },
  );
}

// ------------------------------------------------------------------ independent competing approvals
{
  const managerSession = new ApplicationSession();
  const adminSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  assert.equal((await adminSession.login('admin')).status, 200);
  // Genuinely independent sessions: the manager approves the sales request while the admin
  // approves the manager's own request for the same property, neither waiting for the other.
  const [managerResult, adminResult] = await Promise.all([
    managerSession.request(decisionRoute(main), {
      lockId: firstLock[0].id,
      approve: true,
      reason: decisionReason,
      days: 14,
    }),
    adminSession.request(decisionRoute(main), {
      lockId: managerLock,
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
  const approvedRows = rows.filter((row) => row.status === 'approved');
  assert.equal(approvedRows.length, 1, 'One approved reservation remains');
  assert.equal(
    approvedRows[0].decision_reason,
    decisionReason,
    'The winning approval stored the reason it submitted',
  );
  assert.equal(
    (Date.parse(approvedRows[0].expires_at) -
      Date.parse(approvedRows[0].decided_at)) /
      86400000,
    managerResult.status === 200 ? 14 : 21,
    'The approved reservation expires after the day count its session submitted',
  );
  const effective = effectiveRows(main);
  assert.equal(effective.length, 1, 'One effective reservation remains');
  const approvals = eventsFor([firstLock[0].id, managerLock]).filter(
    (event) => event.action === 'approved',
  );
  assert.equal(approvals.length, 1, 'One approval event was recorded');
  assert.equal(
    approvals[0].reason,
    decisionReason,
    'The approval event carries the reason its session submitted',
  );
  observed(
    'independent-session competing approvals leave exactly one effective reservation',
    { statuses: outcomes, effective: effective.length },
  );
  const winner = effective[0];
  const claimantId = fixtures.identities.claimant.employeeId;
  const claimantWon = winner.requested_by === claimantId;
  const losingLockId = claimantWon ? managerLock : firstLock[0].id;
  const fresh = new ApplicationSession();
  assert.equal((await fresh.login('claimant')).status, 200);
  const read = await fresh.request(reservationRoute(main));
  assert.equal(read.body.effective.id, winner.id);
  assert.equal(read.body.effective.claimantId, winner.requested_by);
  // PostgREST serializes the instant as Z while the SQL client reports +00:00.
  assert.equal(
    Date.parse(read.body.effective.expiresAt),
    Date.parse(winner.expires_at),
    'The application expiry is the committed instant',
  );
  assert.notEqual(
    read.body.effective.id,
    losingLockId,
    'A losing request is never shown as effective',
  );
  assert.ok(
    read.body.pending.every((row) => row.claimantId === claimantId),
    'A claimant only ever sees their own request',
  );
  if (claimantWon) {
    assert.equal(
      read.body.pending.length,
      0,
      'The winning claimant has nothing pending',
    );
  } else {
    assert.equal(read.body.pending.length, 1);
    assert.equal(read.body.pending[0].id, firstLock[0].id);
  }
  observed('the application read agrees with the committed reservation row');
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
    page.reasonField,
    false,
    'No new request is offered while a reservation is effective',
  );
  if (winner.requested_by === fixtures.identities.claimant.employeeId) {
    assert.equal(
      page.pending,
      null,
      'The winning claimant has nothing pending',
    );
  } else {
    assert.ok(
      page.pending?.includes('Yêu cầu của bạn đang chờ duyệt'),
      'A losing claimant still sees only a pending state, never an effective one',
    );
  }
  assert.equal(page.status, 'Đang chào', 'Property status is still unchanged');
  evaluate(
    "() => { document.documentElement.dataset.probe = 'reservation'; return true; }",
    primary,
  );
  act(clickMatching('English', 'header button'), primary, 'switch to English');
  await waitUntil(`() => document.documentElement.lang === 'en'`, primary);
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
  act(
    clickMatching('Tiếng Việt', 'header button'),
    primary,
    'switch to Vietnamese',
  );
  await waitUntil(`() => document.documentElement.lang === 'vi'`, primary);
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
  browser(['open', detail(main)], primary);
  await settle(primary);
  const open = screen(primary);
  assert.ok(
    open.effective || open.pending,
    'The claimant browser holds displayed reservation state',
  );
  const shownName = effectiveRows(main)[0].employee_name;
  const staleSession = new ApplicationSession();
  assert.equal((await staleSession.login('claimant')).status, 200);
  setActive('claimant', false);
  const stale = await staleSession.request(reservationRoute(reject));
  assert.equal(stale.status, 403);
  assert.equal(stale.body.error, 'access-denied');
  const denied = new ApplicationSession();
  assert.equal((await denied.login('claimant')).status, 403);
  assert.equal(
    (
      await claimant.rpc('request_property_lock', {
        p_property_id: reject.id,
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
  assert.equal(
    effectiveRows(main).length,
    1,
    'The committed effective reservation survives a claimant deactivation',
  );
  evaluate(
    "() => { window.dispatchEvent(new Event('focus')); return {requested:true}; }",
    primary,
  );
  await waitUntil(`() => location.pathname === '/access-denied'`, primary);
  assert.ok(
    evaluate(
      `() => !document.querySelector('section.reservation .reservation-effective') && !document.querySelector('section.reservation .reservation-pending') && !document.body.innerText.includes(${JSON.stringify(shownName)})`,
      primary,
    ),
    'The reservation surface is not left displayed after deactivation',
  );
  setActive('claimant', true);
  observed(
    'live deactivation denies the reservation surface without erasing committed reservations',
    { directRows: 0 },
  );
}

// ------------------------------------------------------------------ sign-out clears the surface
{
  const winner = effectiveRows(main)[0];
  browser(['open', detail(main)], secondary);
  await settle(secondary);
  assert.ok(
    screen(secondary).effective,
    'The signed-in reviewer still reads the reservation',
  );
  act(
    "(() => { const button = document.querySelector('.sgn-user-btn'); if (!button) return false; button.click(); return true; })()",
    secondary,
    'open the account menu',
  );
  await waitUntil(
    "() => Boolean(document.querySelector('.sgn-popover button'))",
    secondary,
    20,
  );
  act(
    clickMatching('^(Đăng xuất|Sign out)$', '.sgn-popover button'),
    secondary,
    'sign out',
  );
  browser(['back'], secondary);
  await waitUntil(
    `() => !document.body.innerText.includes(${JSON.stringify(winner.employee_name)})`,
    secondary,
  );
  browser(['open', detail(main)], secondary);
  await waitUntil(`() => location.pathname === '/login'`, secondary);
  assert.equal(screen(secondary).path, '/login');
  observed('sign-out and Back navigation reveal no reservation detail');
}

// ------------------------------------------------------------------ restore and compare
// Read what actually exists before removing it, so the report lists the rows that were really
// written even if a step failed before the flow recorded them.
const createdLockIds = myLockIds();
const createdEventIds = eventsFor(createdLockIds).map((row) => row.id);
const createdActivityIds = activityIds(fixtureActivity).filter(
  (id) => !activityBefore.has(id),
);
removeCreated();
for (const name of ['claimant', 'manager', 'admin']) setActive(name, true);
const after = Object.fromEntries(
  baselineTables.map((table) => [table, countOf(table)]),
);
const foreignAdditions = {};
for (const table of baselineTables) {
  const now = idSetOf(table);
  const missing = [...baselineIds[table]].filter((id) => !now.has(id));
  assert.deepEqual(missing, [], `${table}: the run removed original rows`);
  const added = [...now].filter((id) => !baselineIds[table].has(id));
  if (table === 'activity_events') foreignAdditions[table] = added;
  else
    assert.deepEqual(
      added,
      [],
      `${table}: rows appeared that this run did not remove`,
    );
}
assert.equal(lockRows(main).length, 0);
assert.equal(lockRows(reject).length, 0);
assert.equal(effectiveRows(main).length, 0);
assert.equal(effectiveRows(reject).length, 0);
assert.equal(myLockIds().length, 0);
assert.equal(eventsFor(createdLockIds).length, 0);
assert.deepEqual(
  activityIds(fixtureActivity).sort(),
  [...activityBefore].sort(),
);
// Another identity browsing the shared project is not this task's write: report it, do not
// treat it as restored, and do not hide it behind an equality assertion.
const unrelatedActivity = foreignAdditions.activity_events?.length
  ? operatorSql(
      `select a.id, a.recorded_at, a.kind, e.display_name, p.property_code from public.activity_events a left join public.employees e on e.id = a.employee_id left join public.properties p on p.id = a.property_id where a.id in ('${foreignAdditions.activity_events.join("','")}') order by a.recorded_at`,
    )
  : [];

const report = {
  provenance:
    'Machine-generated by scripts/reservation-acceptance.mjs. The harness writes these bytes verbatim to the path given by its --report flag; a hand-written summary is not this file.',
  checkedAt: new Date().toISOString(),
  environment:
    'authorized hosted development Supabase / local real Next.js application',
  projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
  namespace: fixtures.namespace,
  observations,
  inventory: [
    { code: mainRow.property_code, status: mainRow.status },
    { code: rejectRow.property_code, status: rejectRow.status },
  ],
  fixtureRows: {
    created: {
      locks: createdLockIds,
      lockEvents: createdEventIds,
      activityEvents: createdActivityIds,
      employees: 0,
      properties: 0,
    },
    removed: {
      locks: createdLockIds,
      lockEvents: createdEventIds,
      activityEvents: createdActivityIds,
    },
    restored: { baseline, after },
    unrelatedActivity,
  },
  limits: [
    'Fixture-only writes: the SGN-TEST-18 identities and their linked Auth users are created and removed by this task outside this script; the script itself writes only reservation rows and removes them by exact ID.',
    'Existing inventory is used read-only: no property, address, contact or activity row is written, archived, relinked or reactivated.',
    'Every pre-run row identity for the tracked tables still exists afterwards; unrelated activity rows written by another identity during the window are listed under fixtureRows.unrelatedActivity instead of being treated as this task’s restoration.',
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
