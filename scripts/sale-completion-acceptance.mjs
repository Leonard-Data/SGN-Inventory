// Issue #38 hosted acceptance: versioned logical sale completion and completed-sale ranking.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and
// real Chrome sessions. Mock, shim, source-text and readiness-page results are not
// acceptance. Existing inventory is used read-only: the declared properties are unarchived
// available/negotiating records that carry no completion and no reservation row, except the
// declared rental-committed property, which must already carry an active rental agreement.
// The harness removes exactly the completion, reservation, event, history and activity rows
// it creates, by exact ID, restores the declared property statuses and the fixture
// identities it deactivates, and re-reads the row identities it recorded before the journey.
//
// Usage:
//   SGN_ACCEPTANCE_FIXTURES=<private manifest> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi.js>] \
//   [SGN_ACCEPTANCE_BROWSER_URLS='{"session":"http://127.0.0.1:port"}'] \
//   node --env-file-if-exists=.env.local scripts/sale-completion-acceptance.mjs \
//     --allow-deactivation [--report <sanitized json path>]
//
// The manifest supplies the SGN-TEST-38 identities — a sales claimant/credited closer, a
// second sales rival, a manager and an admin — the declared inventory properties and
// passwords; the operator config supplies the owner connection string for fixture-only
// reads and resets. Neither file is ever printed or committed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

if (process.argv.includes('--help')) {
  console.log(
    'Real development acceptance for sale completion and completed-sale ranking. Requires SGN_ACCEPTANCE_FIXTURES, SGN_ACCEPTANCE_OPERATOR, a running authenticated build at the configured app URL and --allow-deactivation. Writes a sanitized report with --report.',
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
  'SGN-TEST-38',
  'Only the declared synthetic namespace is allowed',
);
for (const name of ['claimant', 'rival', 'manager', 'admin'])
  assert.equal(
    typeof fixtures.identities[name]?.employeeId,
    'string',
    'Missing declared fixture identity',
  );
for (const name of ['main', 'race', 'same', 'conflict', 'rental', 'control'])
  assert.equal(
    typeof fixtures.properties[name]?.id,
    'string',
    'Missing declared inventory property',
  );
const origin = environment.appUrl;
const observations = [];
const reference = 'HĐ-38/2026-SGN-TEST';
const releaseReason = 'Giải phóng đặt chỗ xung đột để ghi nhận bán đã hoàn tất';
const decisionReason =
  'Đã kiểm tra thông tin và xác nhận độc lập cho đặt chỗ này';
const requestReason = 'Khách đã đồng ý điều kiện, chờ quản lý xác nhận đặt chỗ';

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
const browserUrls = process.env.SGN_ACCEPTANCE_BROWSER_URLS
  ? JSON.parse(process.env.SGN_ACCEPTANCE_BROWSER_URLS)
  : {};
const primary = 'sgn-sale-primary';
const secondary = 'sgn-sale-secondary';
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
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
const setSelect = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return false;
  if (![...el.options].some((option) => option.value === ${JSON.stringify(value)})) return false;
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('change', { bubbles: true }));
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
function selected(selector, value, session, what) {
  act(setSelect(selector, value), session, what);
}
function submitted(selector, session, what) {
  act(submitForm(selector), session, what);
}
async function waitForText(text, session = primary, attempts = 60) {
  return waitUntil(
    `() => document.body.innerText.includes(${JSON.stringify(text)})`,
    session,
    attempts,
  );
}
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
// What the browser actually rendered for the reviewer-only sale panel, including each form's
// field geometry, so the render itself is observed rather than assumed.
function saleScreen(session) {
  return evaluate(
    `() => {
      const panel = document.querySelector('section.sale-completion');
      const form = panel?.querySelector('form');
      return {
        path: location.pathname,
        locale: document.documentElement.lang,
        status: document.querySelector('.head-chips .badge')?.textContent?.trim() ?? null,
        heading: panel?.querySelector('h2')?.textContent ?? null,
        text: panel?.innerText ?? null,
        recorded: Boolean(panel?.querySelector('.sale-completion-recorded')),
        form: form
          ? {
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
            }
          : null,
      };
    }`,
    session,
  );
}
function rankingScreen(session) {
  return evaluate(
    `() => {
      const panel = document.querySelector('section.panel[aria-labelledby="completed-sales-ranking"]');
      const rows = [...(panel?.querySelectorAll('tbody tr') ?? [])].map((row) => ({
        cells: [...row.querySelectorAll('th, td')].map((cell) => cell.textContent.trim()),
        rowHeader: row.querySelector('th[scope="row"]')?.textContent?.trim() ?? null,
      }));
      return {
        path: location.pathname,
        locale: document.documentElement.lang,
        heading: panel?.querySelector('h2')?.textContent ?? null,
        rows,
        foot: panel?.querySelector('.panel-foot')?.innerText ?? null,
        empty: Boolean(panel?.querySelector('.state-panel')),
        text: panel?.innerText ?? null,
      };
    }`,
    session,
  );
}
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
  page.form?.fields.some((field) => field.label === label) ? page.form : null;
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
const settledSale = `() => {
  const panel = document.querySelector('section.sale-completion');
  return Boolean(panel) && panel.dataset.loaded === 'yes' && !panel.querySelector('[aria-busy="true"]');
}`;
async function settle(session = primary) {
  await waitUntil(settledSale, session);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await waitUntil(settledSale, session);
}
// The record's action bar opens the confirmation and reservation panels in dialogs, so the
// journey enters each panel through that rendered control. A dialog blocks the rest of the
// record: it is closed through its own control before the header is used again.
const saleAction = '^(Xác nhận bán thành công|Confirm completed sale)$';
const reservationAction = '^(Đặt chỗ|Reservations)$';
const headerActionReady = (pattern) =>
  `() => [...document.querySelectorAll('.detail-actions button')].some((button) => new RegExp(${JSON.stringify(pattern)}).test(button.textContent.trim()))`;
async function openSalePanel(session = primary) {
  await waitUntil(headerActionReady(saleAction), session);
  act(
    clickMatching(saleAction, '.detail-actions button'),
    session,
    'open the confirmation panel',
  );
  await settle(session);
}
async function openSaleDetail(property, session = primary) {
  browser(['open', detail(property)], session);
  await openSalePanel(session);
}
async function openReservationPanel(session = primary) {
  await waitUntil(headerActionReady(reservationAction), session);
  act(
    clickMatching(reservationAction, '.detail-actions button'),
    session,
    'open the reservation panel',
  );
  await waitUntil(
    "() => document.querySelector('section.reservation')?.dataset.loaded === 'yes'",
    session,
  );
}
async function closeActionPanel(session = primary) {
  act(
    "(() => { const button = document.querySelector('dialog.sgn-dialog[open] .sgn-dialog-close'); if (!button) return false; button.click(); return true; })()",
    session,
    'close the open panel',
  );
  await waitUntil(
    "() => !document.querySelector('dialog.sgn-dialog[open]')",
    session,
  );
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

// ------------------------------------------------------------------ declared fixtures
const propertyNames = ['main', 'race', 'same', 'conflict', 'rental', 'control'];
const detail = (property) => origin + '/properties/' + property.id;
const completionRoute = (property) =>
  '/api/properties/' + property.id + '/sale-completion';
const reservationRoute = (property) =>
  '/api/properties/' + property.id + '/reservations';
const decisionRoute = (property) => reservationRoute(property) + '/decision';
const rankingRoute = '/api/reports/completed-sales';
const employeeIds = Object.fromEntries(
  ['claimant', 'rival', 'manager', 'admin'].map((name) => [
    name,
    fixtures.identities[name].employeeId,
  ]),
);
const declared = operatorSql(
  `select id, role, display_name, is_active, auth_user_id from public.employees where id in ('${Object.values(employeeIds).join("','")}')`,
);
const declaredBy = (name) =>
  declared.find((row) => row.id === employeeIds[name]);
for (const [name, role] of [
  ['claimant', 'sales'],
  ['rival', 'sales'],
  ['manager', 'manager'],
  ['admin', 'admin'],
]) {
  assert.ok(declaredBy(name), `Missing declared ${name} employee`);
  assert.equal(declaredBy(name).role, role, `Declared ${name} role mismatch`);
}
assert.ok(
  declared.every((row) => row.is_active),
  'Declared fixtures must start active',
);
const declaredProperties = {};
for (const name of propertyNames) {
  const property = fixtures.properties[name];
  const row = operatorSql(
    `select p.id, p.property_code, p.status, p.record_review_status, p.updated_by, p.archived_at,
      (select count(*)::int from public.sale_completions c where c.property_id = p.id) as completions,
      (select count(*)::int from public.property_locks l where l.property_id = p.id) as locks,
      (select count(*)::int from public.rental_agreements a where a.property_id = p.id and a.status = 'active') as active_rentals
     from public.properties p where p.id = '${property.id}'`,
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
  assert.equal(
    Number(row.completions),
    0,
    `Declared inventory property ${row.property_code} already carries a sale completion: stop and report instead of clearing it.`,
  );
  if (name === 'rental') {
    assert.ok(
      Number(row.active_rentals) >= 1,
      `Declared rental property ${row.property_code} has no active rental agreement: stop and report instead of creating one.`,
    );
  } else {
    assert.ok(
      row.status === 'available' || row.status === 'negotiating',
      `Declared inventory property ${row.property_code} is ${row.status}, not available/negotiating: stop and report instead of clearing it.`,
    );
    assert.equal(
      Number(row.locks),
      0,
      `Declared inventory property ${row.property_code} already carries a reservation row: stop and report instead of clearing it.`,
    );
  }
  declaredProperties[name] = row;
}
const main = fixtures.properties.main;
const race = fixtures.properties.race;
const same = fixtures.properties.same;
const conflict = fixtures.properties.conflict;
const rental = fixtures.properties.rental;
const controlProperty = fixtures.properties.control;
const propertyIds = propertyNames.map((name) => fixtures.properties[name].id);
const propertyList = propertyIds.map((id) => `'${id}'`).join(',');
const today = operatorSql(
  "select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date,'YYYY-MM-DD') as d",
)[0].d;
const yesterday = operatorSql(
  "select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date - 1,'YYYY-MM-DD') as d",
)[0].d;
const tomorrow = operatorSql(
  "select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date + 1,'YYYY-MM-DD') as d",
)[0].d;

const baselineTables = [
  'properties',
  'employees',
  'sale_completions',
  'property_locks',
  'lock_events',
  'activity_events',
  'property_history',
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
const baselineIds = Object.fromEntries(
  baselineTables.map((table) => [table, idSetOf(table)]),
);
// Rows the run writes are removed by exact id or by their recorded time after this instant.
const runStart = operatorSql('select now() as t')[0].t;
const controlHistoryBefore = operatorSql(
  `select count(*)::int as n from public.property_history where property_id = '${controlProperty.id}'`,
)[0].n;
const mainHistoryBefore = operatorSql(
  `select count(*)::int as n from public.property_history where property_id = '${main.id}'`,
)[0].n;
const fixtureIds = Object.values(employeeIds)
  .map((id) => `'${id}'`)
  .join(',');
function completions(property) {
  return operatorSql(
    `select id, property_id, credited_employee_id, completed_on::text as completed_on, reference, previous_status, version, confirmed_by, idempotency_key, confirmed_at, reversed_at from public.sale_completions where property_id = '${property.id}' order by confirmed_at, id`,
  );
}
function lockRows(property) {
  return operatorSql(
    `select id, requested_by, status, reason, decided_by, decision_reason from public.property_locks where property_id = '${property.id}' order by requested_at`,
  );
}
function eventsFor(ids) {
  return operatorSql(
    ids.length
      ? `select id, lock_id, action, actor_id, reason from public.lock_events where lock_id in ('${ids.join("','")}') order by id`
      : `select id, lock_id, action, actor_id, reason from public.lock_events where false`,
  );
}
function propertyHistory(property, field = 'status') {
  return operatorSql(
    `select id, actor_id, changed_fields, before_values, after_values from public.property_history where property_id = '${property.id}' and changed_fields @> '{${field}}' order by occurred_at`,
  );
}
function myLockIds() {
  return operatorSql(
    `select id from public.property_locks where requested_by in (${fixtureIds}) order by id`,
  ).map((row) => row.id);
}
const fixtureActivity = `select id from public.activity_events where employee_id in (${fixtureIds})`;
const activityIds = (statement) => operatorSql(statement).map((row) => row.id);
const activityBefore = new Set(activityIds(fixtureActivity));
const createdCompletionIds = () =>
  operatorSql(
    `select id from public.sale_completions where property_id in (${propertyList}) order by id`,
  ).map((row) => row.id);
// Exact-ID cleanup of the rows this run wrote, then restoration of the declared property
// statuses and the identities the journey deactivates. Existing inventory is never archived,
// relinked or reactivated by this script.
function removeCreated() {
  for (const id of myLockIds())
    operatorSql(
      `do $$ begin delete from public.lock_events where lock_id='${id}'; delete from public.property_locks where id='${id}'; end $$;`,
    );
  operatorSql(
    `do $$ begin delete from public.sale_completions where property_id in (${propertyList}); end $$;`,
  );
  for (const name of propertyNames) {
    const row = declaredProperties[name];
    const id = fixtures.properties[name].id;
    operatorSql(
      `do $$ begin update public.properties set status='${row.status}' where id='${id}'; end $$;`,
    );
    operatorSql(
      `do $$ begin update public.properties set record_review_status='${row.record_review_status}', updated_by=${row.updated_by ? `'${row.updated_by}'` : 'null'} where id='${id}'; end $$;`,
    );
  }
  operatorSql(
    `do $$ begin delete from public.property_history where property_id in (${propertyList}) and occurred_at >= '${runStart}'::timestamptz; end $$;`,
  );
  for (const id of activityIds(fixtureActivity))
    if (!activityBefore.has(id))
      operatorSql(
        `do $$ begin delete from public.activity_events where id='${id}'; end $$;`,
      );
}
function setActive(name, active) {
  operatorSql(
    `do $$ begin update public.employees set is_active=${active} where id='${employeeIds[name]}'; end $$;`,
  );
}
function restoreAndExit(error) {
  try {
    removeCreated();
  } catch {
    console.error(
      'FIXTURE RESTORE FAILED: remove rows requested by the declared identities',
    );
  }
  for (const name of ['claimant', 'rival', 'manager', 'admin']) {
    try {
      setActive(name, true);
    } catch {
      console.error('FIXTURE RESTORE FAILED: reactivate ' + employeeIds[name]);
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
    (await anonymous.request(completionRoute(main))).status,
    401,
    'Anonymous completion reads are denied',
  );
  assert.equal(
    (
      await anonymous.request(completionRoute(main), {
        creditedEmployeeId: employeeIds.claimant,
        completedOn: today,
        reference,
        key: crypto.randomUUID(),
      })
    ).status,
    401,
    'Anonymous completions are denied',
  );
  assert.equal(
    (await anonymous.request(rankingRoute)).status,
    401,
    'Anonymous rankings are denied',
  );
  const response = await fetch(
    environment.supabaseUrl + '/rest/v1/sale_completions?select=id',
    { headers: { apikey: environment.publishableKey } },
  );
  assert.equal(response.status, 401);
  observed('anonymous application and direct completion access denied');
}

// ------------------------------------------------------------------ ordinary employee boundary
{
  const session = new ApplicationSession();
  assert.equal((await session.login('claimant')).status, 200);
  assert.equal((await session.request(completionRoute(main))).status, 403);
  assert.equal(
    (
      await session.request(completionRoute(main), {
        creditedEmployeeId: employeeIds.rival,
        completedOn: today,
        reference,
        key: crypto.randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal((await session.request(rankingRoute)).status, 403);
  assert.equal(
    (
      await claimant.rpc('complete_property_sale', {
        p_property_id: main.id,
        p_credited_employee_id: employeeIds.rival,
        p_completed_on: today,
        p_reference: reference,
        p_key: crypto.randomUUID(),
      })
    ).error?.code,
    '42501',
  );
  const directInsert = await claimant.from('sale_completions').insert({
    property_id: main.id,
    credited_employee_id: employeeIds.rival,
    completed_on: today,
    reference,
    previous_status: 'available',
    confirmed_by: employeeIds.manager,
    idempotency_key: crypto.randomUUID(),
  });
  assert.equal(directInsert.error?.code, '42501');
  const directRead = await claimant.from('sale_completions').select('id');
  assert.equal(directRead.error, null);
  assert.deepEqual(
    directRead.data,
    [],
    'An ordinary employee reads no completion rows',
  );
  observed(
    'a sales employee cannot confirm, read or directly write completions',
  );
}

// ------------------------------------------------------------------ independent-session race
{
  const managerSession = new ApplicationSession();
  const adminSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  assert.equal((await adminSession.login('admin')).status, 200);
  const managerKey = crypto.randomUUID();
  const adminKey = crypto.randomUUID();
  const [managerResult, adminResult] = await Promise.all([
    managerSession.request(completionRoute(race), {
      creditedEmployeeId: employeeIds.claimant,
      completedOn: today,
      reference: reference + '-manager',
      key: managerKey,
    }),
    adminSession.request(completionRoute(race), {
      creditedEmployeeId: employeeIds.rival,
      completedOn: today,
      reference: reference + '-admin',
      key: adminKey,
    }),
  ]);
  const outcomes = [managerResult.status, adminResult.status].sort();
  assert.deepEqual(
    outcomes,
    [200, 409],
    'Exactly one competing completion commits',
  );
  const loser = managerResult.status === 409 ? managerResult : adminResult;
  assert.equal(loser.body.error, 'sale-unavailable');
  const rows = completions(race);
  assert.equal(rows.length, 1, 'One logical completion remains');
  const winner = managerResult.status === 200 ? 'manager' : 'admin';
  assert.equal(
    rows[0].credited_employee_id,
    winner === 'manager' ? employeeIds.claimant : employeeIds.rival,
    'The committed credit belongs to the winning session',
  );
  assert.equal(rows[0].confirmed_by, employeeIds[winner]);
  assert.equal(rows[0].version, 1);
  assert.equal(
    operatorSql(`select status from public.properties where id='${race.id}'`)[0]
      .status,
    'sold',
    'The property is sold exactly once',
  );
  observed(
    'independent-session competing completions leave exactly one logical completion',
    { statuses: outcomes, winner },
  );
  // Replaying the winning body converges on the committed completion instead of duplicating.
  const replay = await (
    winner === 'manager' ? managerSession : adminSession
  ).request(completionRoute(race), {
    creditedEmployeeId: rows[0].credited_employee_id,
    completedOn: rows[0].completed_on,
    reference: rows[0].reference,
    key: rows[0].idempotency_key,
  });
  assert.equal(replay.status, 200, 'A same-key retry converges');
  assert.equal(replay.body.completion.id, rows[0].id);
  assert.equal(completions(race).length, 1);
  const conflictReplay = await (
    winner === 'manager' ? managerSession : adminSession
  ).request(completionRoute(race), {
    creditedEmployeeId: rows[0].credited_employee_id,
    completedOn: rows[0].completed_on,
    reference: rows[0].reference + '-changed',
    key: rows[0].idempotency_key,
  });
  assert.equal(conflictReplay.status, 409);
  assert.equal(conflictReplay.body.error, 'completion-conflict');
  assert.equal(completions(race).length, 1);
  observed('same-key retry convergence and conflicting reuse are exact');
}

// ------------------------------------------------------------------ invalid input and self credit
{
  const session = new ApplicationSession();
  assert.equal((await session.login('manager')).status, 200);
  const future = await session.request(completionRoute(controlProperty), {
    creditedEmployeeId: employeeIds.claimant,
    completedOn: tomorrow,
    reference,
    key: crypto.randomUUID(),
  });
  assert.equal(future.status, 400);
  assert.equal(future.body.error, 'future-date');
  const blankReference = await session.request(
    completionRoute(controlProperty),
    {
      creditedEmployeeId: employeeIds.claimant,
      completedOn: today,
      reference: '   ',
      key: crypto.randomUUID(),
    },
  );
  assert.equal(blankReference.status, 400);
  assert.equal(blankReference.body.error, 'invalid-input');
  const selfCredit = await session.request(completionRoute(controlProperty), {
    creditedEmployeeId: employeeIds.manager,
    completedOn: today,
    reference,
    key: crypto.randomUUID(),
  });
  assert.equal(selfCredit.status, 409);
  assert.equal(selfCredit.body.error, 'self-credit-forbidden');
  assert.equal(
    (
      await manager.rpc('complete_property_sale', {
        p_property_id: controlProperty.id,
        p_credited_employee_id: employeeIds.manager,
        p_completed_on: today,
        p_reference: reference,
        p_key: crypto.randomUUID(),
      })
    ).error?.code,
    'P0004',
  );
  assert.equal(
    (
      await manager.rpc('complete_property_sale', {
        p_property_id: controlProperty.id,
        p_credited_employee_id: employeeIds.claimant,
        p_completed_on: tomorrow,
        p_reference: reference,
        p_key: crypto.randomUUID(),
      })
    ).error?.code,
    'P0007',
  );
  assert.equal(completions(controlProperty).length, 0);
  assert.equal(
    operatorSql(
      `select status from public.properties where id='${controlProperty.id}'`,
    )[0].status,
    declaredProperties.control.status,
    'A refused completion changed no property status',
  );
  observed(
    'future dates, blank references and self credit are refused with no partial change',
  );
}

// ------------------------------------------------------------------ rendered confirmation
{
  initializeBrowser(primary);
  initializeBrowser(secondary);
  await browserLogin('manager', primary, 'vi');
  await openSaleDetail(main, primary);
  const page = saleScreen(primary);
  assert.equal(page.locale, 'vi', 'VI is the default interface language');
  assert.equal(page.heading, 'Xác nhận bán thành công');
  assert.equal(page.recorded, false);
  const form = formWithLabel(page, 'Hợp đồng/tham chiếu');
  assert.ok(
    designSystemForm(form, ['select', 'input', 'input']),
    'The confirmation form renders each field label above its control with the design-system classes',
  );
  selected(
    'section.sale-completion select[name="creditedEmployeeId"]',
    employeeIds.claimant,
    primary,
    'select the credited closer',
  );
  filled(
    'section.sale-completion input[name="completedOn"]',
    yesterday,
    primary,
    'fill the actual completion date',
  );
  filled(
    'section.sale-completion input[name="reference"]',
    reference,
    primary,
    'fill the contract reference',
  );
  submitted(
    'section.sale-completion form',
    primary,
    'confirm the completed sale',
  );
  await waitForText('Đã ghi nhận bán thành công', primary);
  await waitUntil(
    `() => location.pathname === '/properties/${main.id}'`,
    primary,
  );
  const after = saleScreen(primary);
  assert.equal(after.recorded, true, 'The recorded completion is shown');
  assert.ok(after.text.includes(declaredBy('claimant').display_name));
  assert.ok(after.text.includes(reference));
  assert.equal(after.status, 'Đã bán', 'The property now shows as sold');
  const row = completions(main)[0];
  assert.ok(row, 'The UI confirmation committed one completion row');
  assert.equal(row.credited_employee_id, employeeIds.claimant);
  assert.equal(row.confirmed_by, employeeIds.manager);
  assert.equal(row.reference, reference);
  assert.equal(row.completed_on, yesterday);
  assert.equal(row.previous_status, declaredProperties.main.status);
  assert.equal(row.reversed_at, null);
  assert.equal(row.version, 1);
  const history = propertyHistory(main);
  assert.equal(
    history.length,
    Number(mainHistoryBefore) + 1,
    'The sale recorded exactly one new property status change',
  );
  const change = history[history.length - 1];
  assert.equal(change.actor_id, employeeIds.manager);
  assert.equal(change.before_values.status, declaredProperties.main.status);
  assert.equal(change.after_values.status, 'sold');
  observed('a manager confirms a past-dated sale through the rendered form', {
    form,
  });
}

// ------------------------------------------------------------------ same-claimant reservation
{
  const session = new ApplicationSession();
  assert.equal((await session.login('claimant')).status, 200);
  const requested = await session.request(reservationRoute(same), {
    reason: requestReason,
  });
  assert.equal(requested.status, 200);
  const lockId = requested.body.pending[0].id;
  const reviewer = new ApplicationSession();
  assert.equal((await reviewer.login('admin')).status, 200);
  assert.equal(
    (
      await reviewer.request(decisionRoute(same), {
        lockId,
        approve: true,
        reason: decisionReason,
        days: 7,
      })
    ).status,
    200,
  );
  const managerSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  const completed = await managerSession.request(completionRoute(same), {
    creditedEmployeeId: employeeIds.claimant,
    completedOn: today,
    reference: reference + '-same',
    key: crypto.randomUUID(),
  });
  assert.equal(completed.status, 200);
  const lock = lockRows(same).find((row) => row.id === lockId);
  assert.equal(lock.status, 'closed_by_sale');
  assert.equal(
    lock.requested_by,
    employeeIds.claimant,
    'The claimant is retained',
  );
  assert.equal(
    lock.decided_by,
    employeeIds.admin,
    'The decision attribution is retained',
  );
  assert.equal(lock.reason, requestReason);
  assert.equal(lock.decision_reason, decisionReason);
  assert.deepEqual(
    eventsFor([lockId]).map((event) => event.action),
    ['requested', 'approved', 'sale_completed'],
  );
  observed(
    'a same-claimant effective reservation closes with retained claimant and events',
  );
}

// ------------------------------------------------------------------ conflicting claimant and release
{
  const rivalSession = new ApplicationSession();
  assert.equal((await rivalSession.login('rival')).status, 200);
  const requested = await rivalSession.request(reservationRoute(conflict), {
    reason: requestReason,
  });
  assert.equal(requested.status, 200);
  const lockId = requested.body.pending[0].id;
  const reviewer = new ApplicationSession();
  assert.equal((await reviewer.login('admin')).status, 200);
  assert.equal(
    (
      await reviewer.request(decisionRoute(conflict), {
        lockId,
        approve: true,
        reason: decisionReason,
        days: 7,
      })
    ).status,
    200,
  );
  const managerSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  const refused = await managerSession.request(completionRoute(conflict), {
    creditedEmployeeId: employeeIds.claimant,
    completedOn: today,
    reference: reference + '-conflict',
    key: crypto.randomUUID(),
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'reservation-conflict');
  assert.equal(
    completions(conflict).length,
    0,
    'No partial completion was written',
  );
  assert.equal(
    operatorSql(
      `select status from public.properties where id='${conflict.id}'`,
    )[0].status,
    declaredProperties.conflict.status,
    'The refusal left the property status unchanged',
  );
  assert.equal(lockRows(conflict)[0].status, 'approved');
  observed(
    'a conflicting effective claimant is refused with no partial sale or reservation change',
    { error: refused.body.error },
  );
  // The validated manager release interaction resolves the conflict through the rendered UI.
  await browserLogin('manager', secondary, 'vi');
  await openSaleDetail(conflict, secondary);
  // The conflict message is the rendered outcome of a refused submit, so the journey
  // exercises the real 409 path before asserting what the reviewer sees.
  selected(
    'section.sale-completion select[name="creditedEmployeeId"]',
    employeeIds.claimant,
    secondary,
    'select the credited closer',
  );
  filled(
    'section.sale-completion input[name="completedOn"]',
    today,
    secondary,
    'fill the actual completion date',
  );
  filled(
    'section.sale-completion input[name="reference"]',
    reference,
    secondary,
    'fill the contract reference',
  );
  submitted(
    'section.sale-completion form',
    secondary,
    'attempt the blocked confirmation',
  );
  await waitForText('Bất động sản đang có đặt chỗ hiệu lực', secondary);
  const before = saleScreen(secondary);
  assert.ok(
    before.text.includes('Bất động sản đang có đặt chỗ hiệu lực'),
    'The reviewer sees the conflicting effective reservation',
  );
  // The release control lives in the reservation panel, which replaces the closed
  // confirmation panel in the record's dialog.
  await closeActionPanel(secondary);
  await openReservationPanel(secondary);
  filled(
    'section.reservation textarea[name="reason"]',
    releaseReason,
    secondary,
    'fill the release reason',
  );
  submitted(
    'section.reservation .reservation-effective form',
    secondary,
    'release the conflicting reservation',
  );
  await waitForText('Đã giải phóng đặt chỗ', secondary);
  const released = lockRows(conflict).find((row) => row.id === lockId);
  assert.equal(released.status, 'released');
  assert.equal(
    released.requested_by,
    employeeIds.rival,
    'The claimant is retained',
  );
  assert.deepEqual(
    eventsFor([lockId]).map((event) => event.action),
    ['requested', 'approved', 'released'],
  );
  const completed = await managerSession.request(completionRoute(conflict), {
    creditedEmployeeId: employeeIds.claimant,
    completedOn: today,
    reference: reference + '-conflict',
    key: crypto.randomUUID(),
  });
  assert.equal(completed.status, 200);
  assert.equal(completions(conflict).length, 1);
  observed(
    'the audited manager release resolves the conflict and the completion then commits',
  );
}

// ------------------------------------------------------------------ rental blocks the sale
{
  const managerSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  const refused = await managerSession.request(completionRoute(rental), {
    creditedEmployeeId: employeeIds.claimant,
    completedOn: today,
    reference: reference + '-rental',
    key: crypto.randomUUID(),
  });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'rental-active');
  assert.equal(completions(rental).length, 0);
  assert.equal(
    operatorSql(
      `select status from public.properties where id='${rental.id}'`,
    )[0].status,
    'rented',
    'The rental-committed property is unchanged',
  );
  assert.ok(
    Number(
      operatorSql(
        `select count(*)::int as n from public.rental_agreements where property_id='${rental.id}' and status='active'`,
      )[0].n,
    ) >= 1,
    'The active rental agreement is unchanged',
  );
  observed('an activated rental blocks completion with no partial change');
}

// ------------------------------------------------------------------ ranking
{
  const managerSession = new ApplicationSession();
  assert.equal((await managerSession.login('manager')).status, 200);
  const report = await managerSession.request(
    rankingRoute + '?from=' + today + '&to=' + today,
  );
  assert.equal(report.status, 200);
  assert.match(report.cache, /no-store/);
  const rows = Object.fromEntries(
    report.body.rows.map((row) => [row.employeeId, row]),
  );
  const expected = operatorSql(
    `select credited_employee_id, count(*)::int as n from public.sale_completions where reversed_at is null and completed_on = '${today}' group by credited_employee_id`,
  );
  const expectedTotal = expected.reduce((sum, row) => sum + Number(row.n), 0);
  assert.equal(report.body.totalCompletedSales, expectedTotal);
  assert.equal(report.body.rows.length, expected.length);
  for (const row of expected) {
    assert.equal(
      Number(rows[row.credited_employee_id]?.completedSales),
      Number(row.n),
    );
  }
  const unknownExpected = Number(
    operatorSql(
      "select count(*)::int as n from public.properties p where p.status='sold' and p.archived_at is null and not exists (select 1 from public.sale_completions c where c.property_id=p.id and c.reversed_at is null)",
    )[0].n,
  );
  assert.equal(report.body.unknownAttribution, unknownExpected);
  assert.equal(
    report.body.rows.some((row) => row.employeeId === null),
    false,
    'Unknown attribution is never assigned to a fabricated employee',
  );
  const spectator = new ApplicationSession();
  assert.equal((await spectator.login('claimant')).status, 200);
  assert.equal(
    (await spectator.request(rankingRoute)).status,
    403,
    'Ordinary employees cannot read the ranking',
  );
  // The rendered ranking must agree with the endpoint, in both languages.
  browser(
    [
      'open',
      origin + '/reports/completed-sales?from=' + today + '&to=' + today,
    ],
    primary,
  );
  await waitUntil(
    "() => document.querySelector('section.panel[aria-labelledby=completed-sales-ranking]')",
    primary,
  );
  const rendered = rankingScreen(primary);
  assert.equal(rendered.rows.length, report.body.rows.length);
  for (const row of report.body.rows) {
    const match = rendered.rows.find(
      (entry) => entry.rowHeader === row.employeeName,
    );
    assert.ok(match, 'The rendered ranking names every credited employee');
    assert.equal(Number(match.cells[2]), Number(row.completedSales));
    assert.equal(Number(match.cells[0]), Number(row.rank));
  }
  const unknownLabel = new Intl.NumberFormat('vi-VN').format(
    Number(report.body.unknownAttribution),
  );
  assert.ok(
    rendered.foot.includes(unknownLabel),
    'The rendered ranking reports unknown attribution separately',
  );
  act(clickMatching('English', 'header button'), primary, 'switch to English');
  await waitUntil(`() => document.documentElement.lang === 'en'`, primary);
  await waitUntil(
    "() => document.querySelector('section.panel[aria-labelledby=completed-sales-ranking]')",
    primary,
  );
  const english = rankingScreen(primary);
  assert.equal(english.heading, 'Confirmed completed sales');
  assert.equal(english.rows.length, rendered.rows.length);
  act(
    clickMatching('Tiếng Việt', 'header button'),
    primary,
    'switch to Vietnamese',
  );
  await waitUntil(`() => document.documentElement.lang === 'vi'`, primary);
  await waitUntil(
    "() => document.querySelector('section.panel[aria-labelledby=completed-sales-ranking]')",
    primary,
  );
  assert.equal(rankingScreen(primary).rows.length, rendered.rows.length);
  observed(
    'the exact ranking matches the recorded completions and renders in VI and EN',
    { rows: report.body.rows.length, expectedTotal },
  );
}

// ------------------------------------------------------------------ language switch on the panel
{
  await openSaleDetail(main, primary);
  assert.ok(
    saleScreen(primary).recorded,
    'The recorded completion stays visible on a fresh detail',
  );
  await closeActionPanel(primary);
  act(clickMatching('English', 'header button'), primary, 'switch to English');
  await waitUntil(`() => document.documentElement.lang === 'en'`, primary);
  await openSalePanel(primary);
  const english = saleScreen(primary);
  assert.equal(english.heading, 'Confirm completed sale');
  assert.ok(english.text.includes(reference));
  assert.ok(english.text.includes(declaredBy('claimant').display_name));
  await closeActionPanel(primary);
  act(
    clickMatching('Tiếng Việt', 'header button'),
    primary,
    'switch to Vietnamese',
  );
  await waitUntil(`() => document.documentElement.lang === 'vi'`, primary);
  await openSalePanel(primary);
  const vietnamese = saleScreen(primary);
  assert.equal(vietnamese.heading, 'Xác nhận bán thành công');
  assert.ok(vietnamese.text.includes(reference));
  observed(
    'VI/default and EN render the same recorded completion with its source values',
  );
}

// ------------------------------------------------------------------ control property unaffected
{
  assert.equal(
    completions(controlProperty).length,
    0,
    'The control property earned no completion',
  );
  assert.equal(lockRows(controlProperty).length, 0);
  assert.equal(
    Number(
      operatorSql(
        `select count(*)::int as n from public.property_history where property_id = '${controlProperty.id}'`,
      )[0].n,
    ),
    Number(controlHistoryBefore),
    'The control property recorded no new history',
  );
  assert.equal(
    operatorSql(
      `select status from public.properties where id='${controlProperty.id}'`,
    )[0].status,
    declaredProperties.control.status,
  );
  observed(
    'the unaffected control property kept its state and earned no credit',
  );
}

// ------------------------------------------------------------------ live deactivation
{
  const staleSession = new ApplicationSession();
  assert.equal((await staleSession.login('manager')).status, 200);
  setActive('manager', false);
  const denied = await staleSession.request(completionRoute(controlProperty));
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error, 'access-denied');
  assert.equal((await staleSession.request(rankingRoute)).status, 403);
  assert.equal(
    (
      await manager.rpc('complete_property_sale', {
        p_property_id: controlProperty.id,
        p_credited_employee_id: employeeIds.claimant,
        p_completed_on: today,
        p_reference: reference,
        p_key: crypto.randomUUID(),
      })
    ).error?.code,
    '42501',
  );
  assert.equal(
    completions(main).length,
    1,
    'Committed completions survive a reviewer deactivation',
  );
  assert.equal(
    completions(race).length,
    1,
    'The race completion survives a reviewer deactivation',
  );
  setActive('manager', true);
  observed(
    'live deactivation denies the completion and ranking surface without erasing credit',
  );
}

// ------------------------------------------------------------------ restore and compare
const createdCompletions = createdCompletionIds();
const createdLockIds = myLockIds();
const createdEventIds = eventsFor(createdLockIds).map((row) => row.id);
const createdActivityIds = activityIds(fixtureActivity).filter(
  (id) => !activityBefore.has(id),
);
removeCreated();
for (const name of ['claimant', 'rival', 'manager', 'admin'])
  setActive(name, true);
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
for (const name of propertyNames) {
  const property = fixtures.properties[name];
  assert.equal(completions(property).length, 0);
  assert.equal(
    operatorSql(
      `select status from public.properties where id='${property.id}'`,
    )[0].status,
    declaredProperties[name].status,
    `${property.code} status restored`,
  );
}
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
    'Machine-generated by scripts/sale-completion-acceptance.mjs. The harness writes these bytes verbatim to the path given by its --report flag; a hand-written summary is not this file.',
  checkedAt: new Date().toISOString(),
  environment:
    'authorized hosted development Supabase / local real Next.js application',
  projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
  namespace: fixtures.namespace,
  observations,
  inventory: propertyNames.map((name) => ({
    role: name,
    code: declaredProperties[name].property_code,
    recordedStatus: declaredProperties[name].status,
  })),
  fixtureRows: {
    created: {
      completions: createdCompletions,
      locks: createdLockIds,
      lockEvents: createdEventIds,
      activityEvents: createdActivityIds,
      employees: 0,
      properties: 0,
    },
    removed: {
      completions: createdCompletions,
      locks: createdLockIds,
      lockEvents: createdEventIds,
      activityEvents: createdActivityIds,
    },
    restored: { baseline, after },
    unrelatedActivity,
  },
  limits: [
    'Fixture-only writes: the SGN-TEST-38 identities and their linked Auth users are created and removed by this task outside this script; the script itself writes only completion, reservation, event, history and activity rows and removes them by exact ID or by restored property status.',
    'Existing inventory is used read-only: the declared properties already existed with the declared statuses, the rental-committed property already carried its active agreement, and no property, address, contact or rental row is created, archived, relinked or reactivated. Cleanup restores each declared property’s status, record-review state and updater; the revision concurrency token, update timestamp and private audit rows written by the journey are not restored.',
    'Every pre-run row identity for the tracked tables still exists afterwards; unrelated activity rows written by another identity during the window are listed under fixtureRows.unrelatedActivity instead of being treated as this task’s restoration.',
    'The competing completions use two independent authenticated sessions; this is not a production contention gate.',
    'Reversal and correction of a recorded completion are the later correction slice; this run exercises only the effective-fact filter through direct fixture reads, not a delivered reversal UI.',
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
