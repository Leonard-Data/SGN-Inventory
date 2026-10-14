import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

if (process.argv.includes('--help')) {
  console.log(
    'Real development acceptance: SGN_ACCEPTANCE_FIXTURES=<private JSON path> npm run test:acceptance -- --allow-deactivation [--report <sanitized JSON path>]. Requires the documented chrome-devtools-axi installation. Mutates only declared synthetic employee locale/access and records page views. Restores employee activation in finally. This automated run does not cover real mailbox recovery; see docs/testing.md for separately recorded human-coordinated acceptance.',
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
  'Provide an ignored, external fixture manifest',
);
const fixtures = JSON.parse(
  await fs.readFile(process.env.SGN_ACCEPTANCE_FIXTURES, 'utf8'),
);
for (const name of ['active', 'english', 'inactive', 'unlinked', 'operator']) {
  assert.equal(
    typeof fixtures[name]?.email,
    'string',
    'Missing declared fixture identity',
  );
  assert.equal(
    typeof fixtures[name]?.password,
    'string',
    'Missing private fixture credentials',
  );
}
assert.ok(
  fixtures.properties.every((property) =>
    property.code.startsWith('SGN-TEST-'),
  ),
  'Only synthetic inventory fixtures are allowed',
);
const npmRoot =
  process.platform === 'win32'
    ? spawnSync('cmd.exe', ['/d', '/s', '/c', 'npm root --global'], {
        encoding: 'utf8',
      })
    : spawnSync('npm', ['root', '--global'], { encoding: 'utf8' });
assert.equal(npmRoot.status, 0, 'Cannot locate the required browser CLI');
const browserBin = path.join(
  npmRoot.stdout.trim(),
  'chrome-devtools-axi/dist/bin/chrome-devtools-axi.js',
);
const primary = 'sgn-acceptance-primary';
const secondary = 'sgn-acceptance-secondary';
const origin = environment.appUrl;
const observations = [];
function browser(args, session = primary) {
  const result = spawnSync(process.execPath, [browserBin, ...args], {
    encoding: 'utf8',
    timeout: 90000,
    env: {
      ...process.env,
      CHROME_DEVTOOLS_AXI_SESSION: session,
      CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
      CHROME_DEVTOOLS_AXI_BROWSER_URL: '',
      CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '',
      CHROME_DEVTOOLS_AXI_USER_DATA_DIR: path.join(
        path.dirname(process.env.SGN_ACCEPTANCE_FIXTURES),
        'browser-profiles',
        session,
      ),
    },
  });
  // CLI arguments/results can contain credentials or recovery URLs: never echo them.
  assert.equal(result.status, 0, `Browser ${args[0]} failed`);
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
function waitUntil(expression, session = primary) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (evaluate(expression, session)) return;
    browser(['wait', '500'], session);
  }
  assert.fail('Timed out waiting for browser state');
}
function screen(session) {
  return evaluate(
    "() => ({path: location.pathname, query: location.search, locale: document.querySelector('main')?.lang, text: document.querySelector('main')?.innerText, codes: [...document.querySelectorAll('.property-card h2')].map(node=>node.textContent), today: [...document.querySelectorAll('section[aria-labelledby=today-activity] dd')].map(node=>node.textContent), scroll: scrollY})",
    session,
  );
}
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
function expectedToday(row, locale) {
  const format = new Intl.NumberFormat(locale === 'en' ? 'en-GB' : 'vi-VN');
  return [
    row.business_day.split('-').reverse().join('/'),
    format.format(Number(row.page_view_events)),
    format.format(Number(row.distinct_properties_viewed)),
    format.format(Number(row.owner_contact_properties)),
  ];
}
function completedApi(route, session = primary) {
  return evaluate(
    `async () => {
    const name = location.origin + ${JSON.stringify(route)};
    const completed = performance.getEntriesByType('resource').find(entry => entry.name === name);
    if (completed) return {status: completed.responseStatus};
    return await new Promise((resolve, reject) => {
      const observer = new PerformanceObserver(list => { const entry = list.getEntries().find(entry => entry.name === name); if (entry) { clearTimeout(deadline); observer.disconnect(); resolve({status: entry.responseStatus}); } });
      const deadline = setTimeout(() => { observer.disconnect(); reject(new Error('Application response did not complete')); }, 30000);
      observer.observe({type: 'resource', buffered: true});
    });
  }`,
    session,
  );
}
async function userClient(name) {
  const client = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await client.auth.signInWithPassword({
    email: fixtures[name].email,
    password: fixtures[name].password,
  });
  assert.equal(error, null, 'Real fixture authentication failed');
  assert.equal(
    data.user.id,
    fixtures[name].userId,
    'Fixture identity mismatch',
  );
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
      body: response.status === 204 ? null : await response.json(),
    };
  }
  login(name) {
    return this.request('/api/auth/login', {
      email: fixtures[name].email,
      password: fixtures[name].password,
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
function browserLogin(name, session, preferredLocale) {
  browser(['open', origin + '/login'], session);
  if (preferredLocale)
    click(preferredLocale === 'en' ? 'English' : 'Tiếng Việt', session);
  fill('Email', fixtures[name].email, session);
  const isEnglish = screen(session).locale === 'en';
  fill(isEnglish ? 'Password' : 'Mật khẩu', fixtures[name].password, session);
  click(isEnglish ? 'Sign in' : 'Đăng nhập', session);
  wait(
    name === 'inactive' || name === 'unlinked'
      ? isEnglish
        ? 'Access denied'
        : 'Không có quyền truy cập'
      : fixtures.properties[0].code,
    session,
  );
}
async function activity(client) {
  const result = await client
    .from('activity_events')
    .select('id,kind,property_id')
    .eq('employee_id', fixtures.active.employeeId)
    .order('id');
  assert.equal(result.error, null, 'Cannot read real employee activity');
  return result.data;
}
const active = await userClient('active');
const operator = await userClient('operator');
const target = await operator
  .from('employees')
  .select('display_name,auth_user_id,is_active')
  .eq('id', fixtures.active.employeeId)
  .single();
assert.equal(target.error, null, 'Declared employee fixture not readable');
assert.equal(
  target.data.display_name,
  'Test active',
  'Refusing to mutate a nonsynthetic employee',
);
assert.equal(target.data.auth_user_id, fixtures.active.userId);
assert.equal(target.data.is_active, true, 'Fixture must start active');
assert.equal(fixtures.archivedProperty?.code, 'SGN-TEST-ARCHIVED');
let deactivated = false;
let networkOffline = false;
try {
  const resetLocale = await active.rpc('set_my_locale', { p_locale: 'vi' });
  assert.equal(resetLocale.error, null);
  initializeBrowser(primary);
  initializeBrowser(secondary);
  const anonymous = new ApplicationSession();
  assert.equal((await anonymous.request('/api/properties')).status, 401);
  assert.equal((await anonymous.request('/api/activity/today')).status, 401);
  const anonDirect = await fetch(
    environment.supabaseUrl + '/rest/v1/properties?select=id',
    { headers: { apikey: environment.publishableKey } },
  );
  assert.equal(anonDirect.status, 401);
  const session = new ApplicationSession();
  assert.equal((await session.login('active')).status, 200);
  const first = await session.request('/api/properties');
  assert.equal(first.status, 200);
  assert.match(first.cache, /no-store/);
  assert.deepEqual(
    first.body.properties.map((property) => property.id),
    fixtures.properties.slice(0, 30).map((property) => property.id),
  );
  const second = await session.request(
    '/api/properties?' + new URLSearchParams({ after: first.body.nextCursor }),
  );
  assert.deepEqual(
    second.body.properties.map((property) => property.id),
    fixtures.properties.slice(30).map((property) => property.id),
  );
  observed('real authenticated keyset pages and anonymous denial', {
    appStatus: 200,
    anonymousStatus: 401,
    pageSizes: [30, 6],
  });
  for (const [query, expected] of [
    ['nguyen hue', [0, 1]],
    ['Nguyễn Huệ', [0, 1]],
    ['%', [2]],
    ['_', [4]],
    ['huệ nguyễn', []],
    ['no-matching-synthetic-address', []],
  ]) {
    const result = await session.request(
      '/api/properties?' + new URLSearchParams({ query }),
    );
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.properties.map((property) => property.id),
      expected.map((index) => fixtures.properties[index].id),
    );
  }
  assert.equal(
    (
      await session.request(
        '/api/properties?' + new URLSearchParams({ query: '%'.repeat(121) }),
      )
    ).status,
    400,
  );
  assert.equal(
    (await session.request('/api/properties?after=invalid')).status,
    400,
  );
  observed(
    'literal accent-insensitive contiguous search, controls and validation',
  );
  const detail = await session.request(
    '/api/properties/' + fixtures.properties[0].id,
  );
  assert.equal(detail.status, 200);
  assert.equal(detail.body.property.sale_price_vnd, '9007199254740993');
  assert.equal(detail.body.property.land_area_m2, 42.25);
  assert.deepEqual(
    detail.body.contacts.map((link) => [
      link.relation,
      link.is_primary,
      link.contacts.display_name,
      link.contacts.raw_phone_text,
    ]),
    [
      ['owner', true, 'Chủ nhà thử nghiệm', '0900 000 001 / +84 900 000 001'],
      ['broker', false, 'Môi giới thử nghiệm', '0900 000 002'],
    ],
  );
  assert.equal(
    detail.body.addresses.find((address) => address.format === 'legacy')
      .address_text,
    fixtures.properties[0].address,
  );
  assert.equal(
    detail.body.addresses.find((address) => address.format === 'current')
      .mapping_status,
    'candidate',
  );
  const missing = await session.request(
    '/api/properties/' + fixtures.properties[1].id,
  );
  assert.deepEqual(missing.body.contacts, []);
  assert.equal(missing.body.property.sale_price_vnd, null);
  const key = randomUUID();
  const route = '/api/properties/' + fixtures.properties[0].id + '/page-view';
  const event = await session.request(route, { key });
  assert.equal(event.status, 200);
  assert.equal(
    (await session.request(route, { key })).body.eventId,
    event.body.eventId,
  );
  observed(
    'exact decimal-string money, recorded contact links and same-key page view',
  );
  assert.equal(
    (await session.request('/api/properties/' + fixtures.archivedProperty.id))
      .status,
    404,
  );
  assert.equal(
    (
      await session.request(
        '/api/properties/00000000-0000-0000-0000-000000000000',
      )
    ).status,
    404,
  );
  const reviewer = new ApplicationSession();
  assert.equal((await reviewer.login('operator')).status, 200);
  assert.equal(
    (await reviewer.request('/api/properties/' + fixtures.archivedProperty.id))
      .body.property.property_code,
    fixtures.archivedProperty.code,
  );
  const archiveKey = randomUUID();
  const archivedRoute =
    '/api/properties/' + fixtures.archivedProperty.id + '/page-view';
  const archiveEvent = await reviewer.request(archivedRoute, {
    key: archiveKey,
  });
  assert.equal(archiveEvent.status, 200);
  assert.equal(
    (await reviewer.request(archivedRoute, { key: archiveKey })).body.eventId,
    archiveEvent.body.eventId,
  );
  assert.equal(
    (
      await operator.rpc('record_property_activity', {
        p_property_id: fixtures.archivedProperty.id,
        p_kind: 'site_visit',
        p_key: randomUUID(),
      })
    ).error?.code,
    'P0001',
  );
  observed(
    'reviewer-only archived detail/page view and retired physical-visit submission',
  );
  for (const name of ['inactive', 'unlinked']) {
    const denied = new ApplicationSession();
    assert.equal((await denied.login(name)).status, 403);
    for (const route of [
      '/api/session',
      '/api/properties',
      '/api/properties/' + fixtures.properties[0].id,
      '/api/activity/today',
    ]) {
      const result = await denied.request(route);
      assert.equal(result.status, 403);
      assert.deepEqual(result.body, { error: 'access-denied' });
    }
    assert.equal(
      (await denied.request('/api/locale', { locale: 'en' })).status,
      403,
    );
    const client = await userClient(name);
    for (const table of [
      'properties',
      'contacts',
      'property_addresses',
      'property_contacts',
    ]) {
      const result = await client.from(table).select('*');
      assert.equal(result.error, null);
      assert.deepEqual(result.data, []);
    }
    assert.equal(
      (await client.rpc('set_my_locale', { p_locale: 'en' })).error?.code,
      '42501',
    );
    assert.equal((await client.rpc('my_today_activity')).error?.code, '42501');
    assert.equal(
      (
        await client.rpc('record_property_activity', {
          p_property_id: fixtures.properties[0].id,
          p_kind: 'page_view',
          p_key: crypto.randomUUID(),
        })
      ).error?.code,
      '42501',
    );
    browserLogin(name, primary, name === 'unlinked' ? 'en' : 'vi');
    assert.equal(screen().path, '/access-denied');
    assert.ok(!screen().text.includes(fixtures.properties[0].code));
    browser(
      ['open', origin + '/properties/' + fixtures.properties[0].id],
      primary,
    );
    wait(name === 'unlinked' ? 'Access denied' : 'Không có quyền truy cập');
    assert.equal(screen().path, '/access-denied');
    assert.ok(!screen().text.includes('Chủ nhà thử nghiệm'));
    click(screen().locale === 'en' ? 'Sign out' : 'Đăng xuất');
  }
  observed('inactive and unlinked browser/application/direct-RLS denial');
  browserLogin('active', primary);
  browserLogin('active', secondary);
  assert.deepEqual(
    screen().codes,
    fixtures.properties.slice(0, 30).map((property) => property.code),
  );
  fill('Tìm địa chỉ', 'quan');
  click('Tìm địa chỉ');
  wait(fixtures.properties[0].code);
  assert.equal(new URLSearchParams(screen().query).get('query'), 'quan');
  click('Trang tiếp');
  wait(fixtures.properties[30].code);
  const secondPage = screen();
  assert.deepEqual(
    secondPage.codes,
    fixtures.properties.slice(30).map((property) => property.code),
  );
  evaluate('() => { scrollTo(0, 300); return {scroll:scrollY}; }');
  const position = screen();
  click('English');
  wait('Property inventory');
  assert.equal(screen().query, secondPage.query);
  assert.deepEqual(screen().codes, secondPage.codes);
  assert.equal(screen().scroll, position.scroll);
  click('Tiếng Việt');
  wait('Kho bất động sản');
  click('Trang trước');
  wait(fixtures.properties[0].code);
  fill('Tìm địa chỉ', 'nguyen hue');
  click('Tìm địa chỉ');
  wait(fixtures.properties[0].code);
  assert.deepEqual(
    screen().codes,
    fixtures.properties.slice(0, 2).map((property) => property.code),
  );
  const beforeOpen = await activity(active);
  click(fixtures.properties[0].code);
  wait('Chủ nhà thử nghiệm');
  assert.ok(screen().text.includes('9.007.199.254.740.993 VND'));
  assert.ok(screen().text.includes('42,25 m²'));
  assert.ok(screen().text.includes(fixtures.properties[0].address));
  assert.equal(
    completedApi('/api/properties/' + fixtures.properties[0].id + '/page-view')
      .status,
    200,
  );
  const afterOpen = await activity(active);
  const opens = afterOpen.filter(
    (row) => !beforeOpen.some((old) => old.id === row.id),
  );
  assert.equal(opens.length, 1);
  assert.equal(opens[0].kind, 'page_view');
  waitUntil(
    "() => document.querySelectorAll('section[aria-labelledby=today-activity] dd').length === 4",
  );
  assert.ok(screen().text.includes('Hoạt động hôm nay của tôi'));
  const todayReport = await active.rpc('my_today_activity');
  assert.equal(todayReport.error, null, 'Cannot read the live personal report');
  const todayRow = todayReport.data[0];
  assert.deepEqual(screen().today, expectedToday(todayRow, 'vi'));
  observed(
    'real browser own-today page views and distinct properties match the live session report',
    {
      businessDay: todayRow.business_day,
      pageViewEvents: Number(todayRow.page_view_events),
      distinctPropertiesViewed: Number(todayRow.distinct_properties_viewed),
    },
  );
  assert.ok(screen().text.includes('Chủ nhà thử nghiệm'));
  assert.ok(screen().text.includes('Môi giới thử nghiệm'));
  assert.ok(screen().text.includes('Liên hệ chính'));
  assert.ok(!screen().text.includes('0900 000 001'));
  assert.ok(screen().text.includes('0900 000 002'));
  const detailLocation = screen().path + screen().query;
  browser(['emulate', '--network', 'Offline']);
  networkOffline = true;
  click('English');
  wait('Không lưu được ngôn ngữ');
  assert.equal(screen().locale, 'vi');
  browser(['emulate', '--network', 'Fast 4G']);
  networkOffline = false;
  click('English');
  wait('Property details');
  assert.equal(screen().path + screen().query, detailLocation);
  assert.ok(screen().text.includes('9,007,199,254,740,993 VND'));
  assert.ok(screen().text.includes('My activity today'));
  assert.deepEqual(screen().today, expectedToday(todayRow, 'en'));
  assert.ok(screen().text.includes('Chủ nhà thử nghiệm'));
  assert.ok(!screen().text.includes('0900 000 001'));
  assert.deepEqual(await activity(active), afterOpen);
  click('Tiếng Việt');
  wait('Chi tiết bất động sản');
  assert.equal(screen().path + screen().query, detailLocation);
  assert.ok(screen().text.includes('9.007.199.254.740.993 VND'));
  assert.ok(screen().text.includes('Hoạt động hôm nay của tôi'));
  assert.deepEqual(screen().today, expectedToday(todayRow, 'vi'));
  assert.ok(!screen().text.includes('0900 000 001'));
  assert.deepEqual(await activity(active), afterOpen);
  click('English');
  wait('Property details');
  const afterLanguage = await session.request(
    '/api/properties/' + fixtures.properties[0].id,
  );
  assert.deepEqual(afterLanguage.body, detail.body);
  observed(
    'real browser search/detail, failed locale save, state/source retention and no duplicate activity',
  );
  click('Back to results');
  wait(fixtures.properties[0].code);
  fill('Search address', 'x'.repeat(121));
  click('Search address');
  wait('Search addresses must be at most 120 characters');
  fill('Search address', 'no-matching-synthetic-address');
  click('Search address');
  wait('No properties found');
  assert.equal(screen().locale, 'en');
  browser(['open', origin + '/properties/' + fixtures.properties[1].id]);
  wait('No recorded contact links');
  assert.ok(screen().text.includes('No current address recorded'));
  assert.ok(screen().text.includes('Unknown'));
  observed('localized oversized/empty/missing-contact and unresolved states');
  browser(['open', origin + '/properties/' + fixtures.properties[0].id]);
  wait('Chủ nhà thử nghiệm');
  // Restore even if the update committed but its HTTP response was lost.
  deactivated = true;
  const changed = await operator
    .from('employees')
    .update({ is_active: false })
    .eq('id', fixtures.active.employeeId)
    .eq('auth_user_id', fixtures.active.userId)
    .select('id');
  assert.equal(changed.error, null);
  assert.deepEqual(
    changed.data.map((row) => row.id),
    [fixtures.active.employeeId],
  );
  assert.equal(
    (await session.request('/api/properties/' + fixtures.properties[0].id))
      .status,
    403,
  );
  assert.deepEqual((await active.from('properties').select('id')).data, []);
  assert.equal(
    (await active.rpc('set_my_locale', { p_locale: 'vi' })).error?.code,
    '42501',
  );
  evaluate(
    "() => { window.dispatchEvent(new Event('focus')); return {requested:true}; }",
  );
  wait('Access denied');
  assert.equal(screen().path, '/access-denied');
  assert.ok(!screen().text.includes('Chủ nhà thử nghiệm'));
  assert.ok(!screen().text.includes(fixtures.properties[0].code));
  observed(
    'live deactivation with original app/direct sessions and clearing on refocus',
    { appStatus: 403, directRows: 0 },
  );
  const restored = await operator
    .from('employees')
    .update({ is_active: true })
    .eq('id', fixtures.active.employeeId)
    .eq('auth_user_id', fixtures.active.userId);
  assert.equal(restored.error, null);
  deactivated = false;
  click('Sign out');
  browserLogin('active', primary);
  assert.equal(screen().locale, 'en');
  browser(['open', origin + '/properties/' + fixtures.properties[0].id]);
  wait('Chủ nhà thử nghiệm');
  click('Sign out');
  wait('Sign in');
  browser(['back']);
  assert.ok(!screen().text.includes('Chủ nhà thử nghiệm'));
  assert.ok(!screen().text.includes(fixtures.properties[0].code));
  browser(['open', origin + '/properties/' + fixtures.properties[0].id]);
  wait('Sign in');
  assert.equal(screen().path, '/login');
  browser(['open', origin + '/properties'], secondary);
  wait(fixtures.properties[0].code, secondary);
  assert.equal(screen(secondary).path, '/properties');
  observed(
    'preference survives sign-in, Back/direct navigation clears data and other device stays signed in',
  );
  browser(['open', origin + '/auth/callback?code=invalid']);
  wait('invalid or expired');
  assert.equal(screen().path, '/recover');
  click('Tiếng Việt');
  assert.ok(screen().text.includes('không hợp lệ hoặc đã hết hạn'));
  assert.equal(
    (await anonymous.request('/api/auth/recover', { email: 'invalid' })).status,
    400,
  );
  assert.equal(
    (
      await anonymous.request('/api/auth/password', {
        password: 'Password123!',
        confirmPassword: 'Password123!',
      })
    ).status,
    401,
  );
  observed(
    'localized invalid recovery callback/input without password or employee access',
  );
  browserLogin('english', primary);
  assert.equal(screen().locale, 'en');
  observed('independent employee saved language');
  const independent = new ApplicationSession();
  assert.equal((await independent.login('english')).status, 200);
  const independentToday = await independent.request('/api/activity/today');
  assert.equal(independentToday.status, 200);
  assert.deepEqual(Object.keys(independentToday.body).sort(), [
    'businessDay',
    'distinctPropertiesViewed',
    'ownerContactProperties',
    'pageViewEvents',
  ]);
  assert.equal(independentToday.body.businessDay, todayRow.business_day);
  assert.ok(Number.isInteger(independentToday.body.pageViewEvents));
  assert.ok(Number.isInteger(independentToday.body.distinctPropertiesViewed));
  assert.ok(Number.isInteger(independentToday.body.ownerContactProperties));
  assert.ok(
    independentToday.body.distinctPropertiesViewed <=
      independentToday.body.pageViewEvents,
  );
  observed(
    'independent employee personal report uses the same database Vietnam day and exposes no other identity',
  );
  assert.ok(
    (await activity(active)).every((event) => event.kind === 'page_view'),
    'Reading detail must never create a physical visit',
  );
  browserLogin('operator', primary);
  browser(['open', origin + '/properties/' + fixtures.archivedProperty.id]);
  wait(fixtures.archivedProperty.code);
  wait('Hồ sơ lưu trữ');
  assert.equal(
    completedApi(
      '/api/properties/' + fixtures.archivedProperty.id + '/page-view',
    ).status,
    200,
  );
  assert.ok(!screen().text.includes('Chưa ghi nhận được lượt xem'));
  waitUntil(
    "() => document.querySelectorAll('section[aria-labelledby=today-activity] dd').length === 4",
  );
  const reviewerReport = await operator.rpc('my_today_activity');
  assert.equal(
    reviewerReport.error,
    null,
    'Cannot read the live personal report',
  );
  const reviewerRow = reviewerReport.data[0];
  assert.deepEqual(screen().today, expectedToday(reviewerRow, screen().locale));
  observed(
    'real archived reviewer detail surface without physical-visit creation',
  );
  observed(
    'reviewer who may read colleague activity still sees only their own',
    {
      businessDay: reviewerRow.business_day,
      pageViewEvents: Number(reviewerRow.page_view_events),
      distinctPropertiesViewed: Number(reviewerRow.distinct_properties_viewed),
    },
  );
} finally {
  if (networkOffline) browser(['emulate', '--network', 'Fast 4G']);
  if (deactivated) {
    const result = await operator
      .from('employees')
      .update({ is_active: true })
      .eq('id', fixtures.active.employeeId)
      .eq('auth_user_id', fixtures.active.userId);
    if (result.error)
      throw new Error('Failed to restore declared test employee activation');
  }
}
const report = {
  checkedAt: new Date().toISOString(),
  environment:
    'authorized hosted development Supabase / local real Next.js application',
  projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
  observations,
  recoveryEmailDelivery:
    'not covered by this automated run; see docs/testing.md for separately recorded human-coordinated recovery evidence',
  limitations: [
    'Not production/deployed application acceptance',
    'This automated run does not exercise real delivered-mail callbacks or password recovery for denied identities',
    'Broader MVP/Storage/import/rental/concurrent reservation gates are out of scope',
  ],
};
const reportIndex = process.argv.indexOf('--report');
if (reportIndex >= 0) {
  assert.ok(process.argv[reportIndex + 1], 'Report path required');
  await fs.writeFile(
    process.argv[reportIndex + 1],
    JSON.stringify(report, null, 2) + '\n',
  );
}
console.log(
  'Reachable automated browser/API gates passed. This run does not establish real-mailbox recovery acceptance; see docs/testing.md.',
);
