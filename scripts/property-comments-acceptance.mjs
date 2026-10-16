// Issue #44/#45/#46 hosted acceptance: shared Property discussion, accountable removal and
// author editing with retained revisions.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and
// real Chrome sessions. Mock, shim and readiness-page results are not acceptance. Mutates
// only the declared SGN-TEST-44/45/46 synthetic namespace and restores the declared fixture
// activation on every exit path.
//
// Usage:
//   SGN_ACCEPTANCE_FIXTURES=<private manifest> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi.js>] \
//   [SGN_ACCEPTANCE_BROWSER_URLS='{"session":"http://127.0.0.1:port"}'] \
//   node --env-file-if-exists=.env.local scripts/property-comments-acceptance.mjs \
//     --allow-deactivation [--report <sanitized json path>]
//
// The manifest supplies the synthetic namespace identities, properties and passwords; the operator
// config supplies the owner connection string and Auth admin key for fixture-only reads and
// resets. Neither file is ever printed.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

if (process.argv.includes('--help')) {
  console.log(
    'Real development acceptance for the shared Property discussion. Requires SGN_ACCEPTANCE_FIXTURES, SGN_ACCEPTANCE_OPERATOR, a running authenticated build at the configured app URL and --allow-deactivation. Writes a sanitized report with --report.',
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
assert.match(
  fixtures.namespace,
  /^SGN-TEST-4[456]$/,
  'Only a declared synthetic namespace is allowed',
);
for (const name of ['alpha', 'beta', 'staff', 'reviewer', 'inactive']) {
  assert.equal(
    typeof fixtures.identities[name]?.employeeId,
    'string',
    'Missing declared fixture identity',
  );
  assert.equal(
    typeof fixtures.displayNames?.[name],
    'string',
    'Missing declared fixture display name',
  );
}
assert.equal(
  typeof fixtures.unlinked?.email,
  'string',
  'Missing unlinked identity',
);
assert.ok(
  Object.values(fixtures.properties).every((property) =>
    property.code.startsWith(fixtures.namespace + '-'),
  ),
  'Only declared synthetic properties are allowed',
);
const origin = environment.appUrl;
const observations = [];
const applicationHead =
  process.env.SGN_ACCEPTANCE_APPLICATION_HEAD ??
  (() => {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  })();

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
// Polling must not block the event loop: a synchronous probe delays the very request it is
// meant to observe.
function operatorSqlAsync(statement) {
  return new Promise((resolve) => {
    const child = spawn('npx', [
      'supabase',
      'db',
      'query',
      '--db-url',
      operator.dbUrl,
      '--output-format',
      'json',
      statement,
    ]);
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.on('exit', () => {
      try {
        resolve(JSON.parse(output).rows ?? []);
      } catch {
        resolve([]);
      }
    });
  });
}
async function dbNow() {
  // The hosted database clock is authoritative for posting times; the local host clock can
  // drift, so recency is measured against the database rather than Date.now().
  const rows = await operatorSqlAsync('select now() as now');
  return Date.parse(rows[0].now);
}
function waitForExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.on('exit', resolve);
  });
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
const primary = 'sgn-comments-primary';
const secondary = 'sgn-comments-secondary';
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
  // A truncated result would otherwise be parsed as a partial value and could make an
  // assertion pass vacuously; fail loudly and keep the payload small instead.
  assert.ok(
    !/Result was truncated/.test(output),
    'Browser evaluation result was truncated; reduce the payload',
  );
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
// The app shell names its language buttons by lang attribute and keeps its sign-out control
// inside a user popover, so both are driven through the rendered elements rather than a
// label that the design-system shell can rename.
function switchLocale(code, session) {
  const clicked = evaluate(
    `() => {
      const button = document.querySelector('.lang-btn[lang="${code}"]');
      if (!button) return false;
      button.click();
      return true;
    }`,
    session,
  );
  assert.equal(clicked, true, `Language switch to ${code} is present`);
}
function signOut(session) {
  const opened = evaluate(
    `() => {
      const button = document.querySelector('.sgn-user-btn');
      if (!button) return false;
      button.click();
      return true;
    }`,
    session,
  );
  if (opened) {
    click('Đăng xuất', session);
    return;
  }
  // Not on a shell page (for example a denial screen): end the session through the
  // application route, then the caller lands on the login form.
  evaluate(
    `() => {
      fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'same-origin' });
      return true;
    }`,
    session,
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
function vietnamHistoryTime(value, locale) {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
function screen(session) {
  return evaluate(
    `() => {
      const discussion = document.querySelector('section.discussion');
      return {
        path: location.pathname,
        locale: document.documentElement.lang,
        code: document.querySelector('h1')?.textContent?.trim(),
        heading: discussion?.querySelector('h2')?.textContent ?? null,
        comments: [...(discussion?.querySelectorAll('.comment') ?? [])].map(node => ({
          id: node.getAttribute('data-comment-id'),
          author: node.querySelector('.comment-author')?.textContent ?? null,
          time: node.querySelector('time')?.dateTime ?? null,
          body: node.querySelector('.comment-body')?.textContent ?? null,
          removed: Boolean(node.querySelector('.comment-removed')),
          edited: Boolean(node.querySelector('.comment-edited')),
          actions: Boolean(node.querySelector('.comment-actions')),
        })),
        historyDetails: [...(discussion?.querySelectorAll('.comment-history li') ?? [])].map(node => ({
          body: node.querySelector('.comment-history-body')?.textContent ?? null,
          actor: node.querySelector('.comment-history-actor')?.textContent ?? null,
          time: node.querySelector('.comment-history-time')?.getAttribute('datetime') ?? null,
          displayedTime: node.querySelector('.comment-history-time')?.textContent?.trim() ?? null,
          timeLabel: node.querySelector('.comment-meta')?.textContent?.trim() ?? null,
          reason: node.querySelector('.comment-history-reason span[translate="no"]')?.textContent ?? null,
        })),
        removeControls: discussion ? [...discussion.querySelectorAll('button')].filter(node => /Gỡ bình luận|^Remove$/.test((node.getAttribute('aria-label') ?? node.textContent).trim())).length : 0,
        moderateControls: discussion ? [...discussion.querySelectorAll('button')].filter(node => /Gỡ kèm lý do|Remove with reason/.test(node.getAttribute('aria-label') ?? node.textContent)).length : 0,
        moderationReason: discussion?.querySelector('.comment-moderation textarea')?.value ?? null,
        commentEditControls: discussion ? [...discussion.querySelectorAll('button')].filter(node => /Chỉnh sửa bình luận|^Edit comment$/.test((node.getAttribute('aria-label') ?? node.textContent).trim())).length : 0,
        editedMarkers: discussion ? discussion.querySelectorAll('.comment-edited').length : 0,
        historyButtons: discussion ? [...discussion.querySelectorAll('button')].filter(node => /Xem lịch sử|View history|Ẩn lịch sử|Hide history/.test(node.textContent)).length : 0,
        historyEvents: discussion ? [...discussion.querySelectorAll('.comment-history li')].map(node => node.textContent?.trim() ?? '') : [],
        historyMore: Boolean(discussion?.querySelector('.comment-history-more')),
        historyMoreText: discussion?.querySelector('.comment-history-more')?.textContent?.trim() ?? null,
        historyError: discussion?.querySelector('.comment-history-error')?.textContent ?? null,
        editDraft: discussion?.querySelector('.comment-edit textarea')?.value ?? null,
        editCurrent: discussion?.querySelector('.comment-current .comment-body')?.textContent ?? null,
        editError: discussion?.querySelector('.comment-edit [role=alert]')?.textContent ?? null,
        statuses: [...(discussion?.querySelectorAll('[role=status],[role=alert]') ?? [])].map(node => node.textContent),
        empty: discussion ? discussion.innerText.includes('Chưa có bình luận nào.') || discussion.innerText.includes('No comments yet.') : null,
        more: discussion ? Boolean([...discussion.querySelectorAll('button')].find(node => /Xem bình luận cũ hơn|More comments/.test(node.textContent))) : null,
        refresh: discussion ? Boolean([...discussion.querySelectorAll('button')].find(node => /Làm mới|Refresh/.test(node.getAttribute('aria-label') ?? node.textContent))) : null,
        postButton: discussion ? Boolean([...discussion.querySelectorAll('button[type=submit]')].length) : null,
        maintenanceActions: Boolean(document.querySelector('.maintenance-actions')),
        injected: Boolean(document.querySelector('script[data-injected], img[data-injected]')),
        hasDiscussionText: discussion ? discussion.innerText.trim().length > 0 : false,
      };
    }`,
    session,
  );
}
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
function openHistory(commentId, session = primary) {
  const opened = evaluate(
    `() => {
      const target = document.querySelector('[data-comment-id="${commentId}"]');
      const button = [...(target?.querySelectorAll('.comment-actions button') ?? [])]
        .find(node => /Xem lịch sử|View history|Ẩn lịch sử|Hide history/.test(node.textContent));
      if (!button) return false;
      button.click();
      return true;
    }`,
    session,
  );
  assert.equal(opened, true, `History control exists for ${commentId}`);
}
// A discussion read is settled when its controls are no longer busy (ASCII-only predicate).
const settled = `() => {
  const discussion = document.querySelector('section.discussion');
  return Boolean(discussion) && !discussion.querySelector('button[disabled]');
}`;
async function settle(session = primary) {
  // The design-system detail places the discussion in a tab that starts hidden; activate it so
  // the accessibility snapshot used by click/fill reaches the discussion controls. The click is
  // retried until React has hydrated the tab, then the discussion is left to finish loading.
  for (let attempt = 0; attempt < 40; attempt++) {
    const visible = evaluate(
      `() => {
        const panel = document.getElementById('record-panel-comments');
        if (!panel) return false;
        if (panel.hidden) {
          const tab = document.getElementById('record-tab-comments');
          if (tab) tab.click();
        }
        return !panel.hidden;
      }`,
      session,
    );
    if (visible) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await waitUntil(settled, session);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await waitUntil(settled, session);
}
async function userClient(name) {
  const fixture =
    name === 'unlinked' ? fixtures.unlinked : fixtures.identities[name];
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
    const fixture = name === 'unlinked' ? fixtures.unlinked : fixtures.identities[name];
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
  fill('Email', fixture.email, session);
  const locale = evaluate(
    `() => document.querySelector('.sgn-auth')?.lang ?? document.documentElement.lang`,
    session,
  );
  fill(locale === 'en' ? 'Password' : 'Mật khẩu', fixture.password, session);
  click(locale === 'en' ? 'Sign in' : 'Đăng nhập', session);
  wait('Kho bất động sản', session);
}

const discussion = fixtures.properties.discussion;
const paging = fixtures.properties.paging;
const archived = fixtures.properties.archived;
const race = fixtures.properties.race;
const second = fixtures.properties.second;
const names = fixtures.displayNames;
const detail = (property) => origin + '/properties/' + property.id;

const alpha = await userClient('alpha');
const beta = await userClient('beta');
const staff = await userClient('staff');
const reviewer = await userClient('reviewer');
const alphaEmployee = fixtures.identities.alpha.employeeId;
const betaEmployee = fixtures.identities.beta.employeeId;
const inactiveEmployee = fixtures.identities.inactive.employeeId;
const reviewerEmployee = fixtures.identities.reviewer.employeeId;
const reviewerRole = operatorSql(
  `select role from public.employees where id='${reviewerEmployee}'`,
)[0]?.role;
assert.ok(
  reviewerRole === 'manager' || reviewerRole === 'admin',
  'Reviewer fixture must start as manager/admin',
);
function setBetaActive(active) {
  operatorSql(
    `do $$ begin update public.employees set is_active=${active} where id='${betaEmployee}'; end $$;`,
  );
}
function setReviewerRole(role) {
  assert.ok(['sales', 'staff', 'manager', 'admin'].includes(role));
  operatorSql(
    `update public.employees set role='${role}' where id='${reviewerEmployee}'`,
  );
}
// Any failure must still return the declared fixture identities to their original state.
function restoreAndExit(error) {
  try {
    setBetaActive(true);
    setReviewerRole(reviewerRole);
  } catch {
    console.error('FIXTURE RESTORE FAILED: reactivate ' + betaEmployee);
  }
  console.error(error);
  process.exit(1);
}
process.on('uncaughtException', restoreAndExit);
process.on('unhandledRejection', restoreAndExit);

// ------------------------------------------------------------------ browser journey
initializeBrowser(primary);
initializeBrowser(secondary);
await browserLogin('alpha', primary, 'vi');
browser(['open', detail(discussion)], primary);
await settle(primary);
{
  const page = screen(primary);
  assert.equal(page.locale, 'vi', 'VI is the default interface language');
  assert.equal(page.heading, 'Thảo luận bất động sản');
  assert.equal(page.empty, true, 'Empty discussion is visibly distinct');
  assert.equal(page.refresh, true, 'Explicit refresh control is present');
  assert.equal(page.postButton, true, 'Post control is present');
  observed(
    'discussion loads on a real protected detail with a visible empty state',
    {
      locale: page.locale,
      heading: page.heading,
      empty: page.empty,
    },
  );
}
const viBody =
  '  Chào anh,\nGiá 12 tỷ — còn thương lượng.\n  Liên hệ lại sau 15h.  ';
fill('Bình luận', viBody, primary);
click('Gửi bình luận', primary);
await waitUntil(
  `() => document.querySelectorAll('section.discussion .comment').length === 1`,
  primary,
);
{
  const page = screen(primary);
  const comment = page.comments[0];
  assert.equal(
    comment.body,
    viBody.trim(),
    'Trimming preserves accents and line breaks',
  );
  assert.equal(comment.author, names.alpha, 'Author is shown');
  assert.ok(
    comment.time &&
      Math.abs(Date.parse(comment.time) - (await dbNow())) < 300000,
    'Original Vietnam posting time is a real recent instant',
  );
  assert.ok(
    page.statuses.some((text) => /Đã gửi bình luận/.test(text)),
    'Success is reported',
  );
  assert.ok(
    !page.statuses.some((text) => /Chưa gửi được/.test(text)),
    'Committed post is not reported as failed',
  );
  observed(
    'VI comment with accents and line breaks posts and appears immediately',
    {
      author: comment.author,
      postedAt: comment.time,
      length: comment.body.length,
    },
  );
}
fill(
  'Bình luận',
  '<img data-injected src=x onerror="window.__xss=1"><script data-injected>window.__xss=2</script>',
  primary,
);
click('Gửi bình luận', primary);
await waitUntil(
  `() => document.querySelectorAll('section.discussion .comment').length === 2`,
  primary,
);
{
  const page = screen(primary);
  const raw = page.comments.find((comment) => comment.body.includes('onerror'));
  assert.ok(raw, 'HTML-like input is retained as source text');
  assert.ok(
    raw.body.includes('<img') && raw.body.includes('<script'),
    'Tags are shown literally',
  );
  assert.equal(page.injected, false, 'No injected element executed');
  assert.equal(
    evaluate('() => window.__xss === undefined', primary),
    true,
    'No script ran',
  );
  observed('HTML-like input renders as plain text without script execution', {
    retained: true,
    executed: false,
  });
}
click('Làm mới', primary);
await waitUntil(
  `() => document.querySelectorAll('section.discussion .comment').length === 2`,
  primary,
);
{
  const page = screen(primary);
  assert.equal(
    page.comments.length,
    2,
    'Refresh does not duplicate committed comments',
  );
  assert.equal(
    new Set(page.comments.map((comment) => comment.body)).size,
    2,
    'Refreshed list keeps distinct comments',
  );
  observed(
    'explicit refresh retrieves the committed list without duplication',
    {
      comments: page.comments.length,
    },
  );
}
browser(['open', detail(paging)], primary);
await settle(primary);
{
  const first = screen(primary);
  assert.equal(first.comments.length, 30, 'A page returns at most 30 entries');
  assert.equal(first.more, true, 'A following page is offered');
  assert.equal(
    new Set(first.comments.map((comment) => comment.body)).size,
    30,
    'First page has no duplicates',
  );
  click('Xem bình luận cũ hơn', primary);
  await waitUntil(
    `() => document.querySelectorAll('section.discussion .comment').length === 35`,
    primary,
  );
  const after = screen(primary);
  const bodies = after.comments.map((comment) => comment.body);
  assert.equal(bodies.length, 35, 'Both pages together hold every comment');
  assert.equal(new Set(bodies).size, 35, 'No comment is duplicated or omitted');
  assert.ok(
    after.comments
      .map((comment) => comment.time)
      .every((time) => time === after.comments[0].time),
    'Every entry shares the same posting time (tie-breaker case)',
  );
  observed('tied-time paging is newest-first without duplication or omission', {
    page: first.comments.length,
    total: after.comments.length,
    tiedTimes: true,
  });
}
{
  // Posting while an editor is open on the oldest rendered row must keep that row and its draft.
  const seededId = randomUUID();
  await operatorSqlAsync(
    `insert into public.property_comments(id,property_id,author_id,author_name,body,created_at,revision,idempotency_key) values('${seededId}','${paging.id}','${alphaEmployee}','${names.alpha.replace(/'/g, "''")}','Bình luận cũ đang sửa','2000-01-01T00:00:00Z','${randomUUID()}','${randomUUID()}')`,
  );
  browser(['open', detail(paging)], primary);
  await settle(primary);
  click('Xem bình luận cũ hơn', primary);
  await waitUntil(
    `() => document.querySelectorAll('section.discussion .comment').length === 36`,
    primary,
  );
  evaluate(
    `() => {
      const target = [...document.querySelectorAll('section.discussion .comment')].find((node) => (node.querySelector('.comment-body')?.textContent ?? '') === 'Bình luận cũ đang sửa');
      [...target.querySelectorAll('.comment-actions button')].find((button) => (button.getAttribute('aria-label') ?? button.textContent).trim() === 'Chỉnh sửa bình luận').click();
      return true;
    }`,
    primary,
  );
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    primary,
  );
  fill('Chỉnh sửa bình luận', 'Bản nháp đang mở', primary);
  fill('Bình luận', 'Bình luận mới trong khi đang sửa', primary);
  click('Gửi bình luận', primary);
  await waitUntil(
    `() => [...document.querySelectorAll('section.discussion .comment-body')].some((node) => node.textContent === 'Bình luận mới trong khi đang sửa')`,
    primary,
  );
  const afterPost = screen(primary);
  assert.equal(
    afterPost.editDraft,
    'Bản nháp đang mở',
    'Posting keeps the open editor and its draft',
  );
  assert.ok(
    afterPost.comments.some(
      (comment) => comment.body === 'Bình luận mới trong khi đang sửa',
    ),
    'The new comment is rendered',
  );
  observed('posting while an editor is open keeps the edited row and draft', {
    entries: afterPost.comments.length,
    draftKept: afterPost.editDraft === 'Bản nháp đang mở',
  });
  click('Huỷ', primary);
  await waitUntil(
    `() => !document.querySelector('section.discussion .comment-edit textarea')`,
    primary,
  );
}
browser(['open', detail(discussion)], primary);
await settle(primary);
{
  const before = screen(primary);
  switchLocale('en', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Property discussion'`,
    primary,
  );
  await settle(primary);
  const english = screen(primary);
  assert.equal(english.locale, 'en', 'Interface language switched to EN');
  assert.equal(english.heading, 'Property discussion');
  assert.deepEqual(
    english.comments.map((comment) => comment.body),
    before.comments.map((comment) => comment.body),
    'Source comment text is not translated',
  );
  switchLocale('vi', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Thảo luận bất động sản'`,
    primary,
  );
  await settle(primary);
  const back = screen(primary);
  assert.equal(back.locale, 'vi', 'Interface language switched back to VI');
  assert.equal(
    back.code,
    before.code,
    'The open property survives the language switch',
  );
  assert.deepEqual(
    back.comments.map((comment) => comment.body),
    before.comments.map((comment) => comment.body),
    'Comment text is unchanged by switching language',
  );
  observed('VI to EN to VI keeps labels, source text and the open property', {
    property: back.code,
    comments: back.comments.length,
  });
}
await browserLogin('beta', secondary, 'vi');
browser(['open', detail(discussion)], secondary);
await settle(secondary);
{
  const page = screen(secondary);
  assert.equal(
    page.comments.length,
    2,
    'Colleague reads the shared discussion',
  );
  assert.equal(
    page.maintenanceActions,
    false,
    'No property-edit authority is granted',
  );
  fill('Bình luận', 'Beta xem nhà lúc 9h, nhà còn trống.', secondary);
  click('Gửi bình luận', secondary);
  await waitUntil(
    `() => document.querySelectorAll('section.discussion .comment').length === 3`,
    secondary,
  );
  const after = screen(secondary);
  assert.equal(
    after.comments.filter((comment) => comment.author === names.beta).length,
    1,
    'Colleague comment is attributed to the colleague',
  );
  assert.equal(
    after.maintenanceActions,
    false,
    'Still no property-edit authority',
  );
  observed(
    'colleague posts on another employee property without edit authority',
    {
      comments: after.comments.length,
      maintenanceActions: after.maintenanceActions,
    },
  );
}
signOut(secondary);
browser(['open', detail(discussion)], secondary);
{
  const page = screen(secondary);
  assert.equal(
    page.path,
    '/login',
    'Protected detail is not reachable after sign-out',
  );
  assert.equal(
    page.hasDiscussionText,
    false,
    'No cached discussion is displayed',
  );
  observed('sign-out and back-navigation expose no cached discussion', {
    path: page.path,
  });
}
await browserLogin('beta', secondary, 'vi');
browser(['open', detail(discussion)], secondary);
await settle(secondary);
{
  const before = screen(secondary);
  assert.equal(
    before.comments.length,
    3,
    'Colleague session displays the shared discussion',
  );
  setBetaActive(false);
  // Refocusing revalidates live membership; no navigation command is issued here, so the
  // redirect can only come from the refocus path detecting the denial.
  evaluate(
    `() => { window.dispatchEvent(new Event('focus')); return true; }`,
    secondary,
  );
  await waitUntil(
    `() => location.pathname === '/access-denied'`,
    secondary,
    30,
  );
  const page = screen(secondary);
  assert.equal(page.path, '/access-denied', 'Deactivated identity is denied');
  assert.equal(
    page.hasDiscussionText,
    false,
    'No discussion text survives the denial',
  );
  const leaked = evaluate(
    `() => [${JSON.stringify(names.alpha)}, ${JSON.stringify(names.beta)}, 'Beta xem nhà'].some((text) => document.body.innerText.includes(text))`,
    secondary,
  );
  assert.equal(leaked, false, 'No cached discussion text remains after denial');
  observed('live deactivation clears the displayed discussion on refocus', {
    path: page.path,
    pathBefore: before.path,
    commentsBefore: before.comments.length,
    cachedText: leaked,
  });
  setBetaActive(true);
}
{
  const seeded = await beta.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Bình luận beta để kiểm tra mất quyền',
    p_key: randomUUID(),
  });
  assert.equal(seeded.error, null, 'The beta reconciliation comment posts');
  browser(['open', detail(second)], secondary);
  await settle(secondary);
  click('Chỉnh sửa bình luận', secondary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    secondary,
  );
  fill('Chỉnh sửa bình luận', 'Bản nháp khi quyền thay đổi', secondary);
  const competingBeta = await userClient('beta');
  const competingEdit = await competingBeta.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: seeded.data.id,
    p_revision: seeded.data.revision,
    p_body: 'Phiên beta khác đã sửa',
    p_key: randomUUID(),
  });
  assert.equal(competingEdit.error, null, 'The competing beta edit commits');
  evaluate(
    `() => {
      const original = window.fetch.bind(window);
      let release;
      window.__editPatchPaused = false;
      window.__releaseEditPatch = () => release?.();
      window.fetch = async (...args) => {
        const input = args[0];
        const options = args[1] ?? {};
        const url = typeof input === 'string' ? input : input.url;
        const method = String(options.method ?? input?.method ?? 'GET').toUpperCase();
        const response = await original(...args);
        if (method === 'PATCH' && url.includes('/comments/')) {
          window.__editPatchPaused = true;
          await new Promise(resolve => { release = resolve; });
          window.fetch = original;
        }
        return response;
      };
      return true;
    }`,
    secondary,
  );
  click('Lưu thay đổi', secondary);
  await waitUntil(`() => window.__editPatchPaused === true`, secondary);
  setBetaActive(false);
  evaluate(`() => { window.__releaseEditPatch(); return true; }`, secondary);
  await waitUntil(
    `() => location.pathname === '/access-denied'`,
    secondary,
    30,
  );
  const denied = screen(secondary);
  assert.equal(denied.hasDiscussionText, false);
  observed('stale reconciliation denial clears the protected discussion', {
    path: denied.path,
    cachedText: denied.hasDiscussionText,
  });
  setBetaActive(true);
}

// ------------------------------------------------------- author removal journey
{
  browser(['open', detail(discussion)], primary);
  await settle(primary);
  const before = screen(primary);
  const own = before.comments.find(
    (comment) => comment.author === names.alpha && !comment.removed,
  );
  assert.ok(own, 'The author has a current comment to withdraw');
  assert.ok(
    before.removeControls > 0,
    'An author sees the removal control for their own comment',
  );
  assert.equal(
    before.moderateControls,
    0,
    'An ordinary employee holds no moderation control',
  );
  click('Gỡ bình luận', primary);
  await waitUntil(
    `() => document.querySelectorAll('section.discussion .comment-removed').length === 1`,
    primary,
  );
  await settle(primary);
  const after = screen(primary);
  assert.equal(
    after.comments.length,
    before.comments.length,
    'Removal neither reorders nor adds an entry',
  );
  const marker = after.comments.find((comment) => comment.removed);
  assert.equal(marker.author, names.alpha, 'The marker keeps authorship');
  assert.equal(
    marker.actions,
    false,
    'A removed comment offers no further action',
  );
  assert.ok(marker.time, 'The marker keeps the original posting time');
  assert.ok(
    after.statuses.some((status) => /Bình luận đã được gỡ/.test(status)),
    'A committed removal is reported in VI',
  );
  assert.ok(
    !after.statuses.some((status) => /Chưa gỡ được/.test(status)),
    'A committed removal is never reported as failed',
  );
  const withdrawnText = own.body.replace(/\s+/g, ' ').trim();
  assert.ok(withdrawnText.length > 0, 'The withdrawn comment carried text');
  assert.equal(
    evaluate(
      `() => document.body.innerText.replace(/\\s+/g, ' ').includes(${JSON.stringify(withdrawnText)})`,
      primary,
    ),
    false,
    'Withdrawn text is absent from the rendered page',
  );
  // EN keeps the marker, the surviving source text and the Vietnam posting convention.
  switchLocale('en', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Property discussion'`,
    primary,
  );
  await settle(primary);
  const english = screen(primary);
  assert.ok(english.removeControls > 0, 'The author control is localized');
  assert.equal(
    english.comments.filter((comment) => comment.removed).length,
    1,
    'The marker survives the language switch',
  );
  assert.equal(
    english.comments.find((comment) => comment.removed).body,
    'Comment removed.',
    'EN shows a localized removal marker',
  );
  assert.ok(
    english.comments
      .filter((comment) => !comment.removed)
      .every((comment) => (comment.body ?? '').length > 0),
    'Surviving source text is unchanged by the language switch',
  );
  observed(
    'author removal hides the text and shows a localized marker in VI and EN',
    {
      markerVi: 'Bình luận đã được gỡ.',
      markerEn: 'Comment removed.',
      originalTimeRetained: Boolean(marker.time),
      entries: after.comments.length,
    },
  );
  switchLocale('vi', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Thảo luận bất động sản'`,
    primary,
  );
  await settle(primary);
}

// ------------------------------------------------------- direct Data API and RPC
{
  const anonymous = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const rows = await anonymous
    .from('property_comments')
    .select('id')
    .eq('property_id', discussion.id);
  assert.ok(
    rows.error || (rows.data ?? []).length === 0,
    'Anonymous reads no rows',
  );
  for (const call of [
    anonymous.rpc('list_property_comments', { p_property_id: discussion.id }),
    anonymous.rpc('post_property_comment', {
      p_property_id: discussion.id,
      p_body: 'anonymous',
      p_key: '52000000-0000-4000-8000-0000000000a1',
    }),
  ]) {
    const result = await call;
    assert.ok(result.error, 'Anonymous RPC is rejected');
  }
  const unlinked = await userClient('unlinked');
  const unlinkedRows = await unlinked
    .from('property_comments')
    .select('id')
    .eq('property_id', discussion.id);
  assert.ok(
    unlinkedRows.error || (unlinkedRows.data ?? []).length === 0,
    'Unlinked identity reads no rows',
  );
  const unlinkedPost = await unlinked.rpc('post_property_comment', {
    p_property_id: discussion.id,
    p_body: 'unlinked',
    p_key: '52000000-0000-4000-8000-0000000000a2',
  });
  assert.ok(unlinkedPost.error, 'Unlinked identity cannot post');
  observed(
    'anonymous and unlinked identities reach no discussion through the API',
    {
      anonymousRows: rows.data?.length ?? 0,
      anonymousError: rows.error?.code ?? null,
      unlinkedError: unlinkedPost.error?.code ?? null,
    },
  );
}
{
  const inactive = await userClient('inactive');
  const rows = await inactive
    .from('property_comments')
    .select('id')
    .eq('property_id', discussion.id);
  assert.ok(
    rows.error || (rows.data ?? []).length === 0,
    'Inactive reads no rows',
  );
  const post = await inactive.rpc('post_property_comment', {
    p_property_id: discussion.id,
    p_body: 'inactive',
    p_key: '52000000-0000-4000-8000-0000000000a3',
  });
  assert.equal(post.error?.code, '42501', 'Inactive posting is denied');
  // A session established while active must lose access immediately after deactivation.
  const beforeDeactivation = await beta
    .from('property_comments')
    .select('id')
    .eq('property_id', discussion.id);
  assert.equal(beforeDeactivation.error, null, 'Active beta reads through RLS');
  assert.ok(
    (beforeDeactivation.data ?? []).length > 0,
    'Active beta sees discussion',
  );
  setBetaActive(false);
  const rowsAfter = await beta
    .from('property_comments')
    .select('id')
    .eq('property_id', discussion.id);
  assert.ok(
    rowsAfter.error || (rowsAfter.data ?? []).length === 0,
    'Deactivated session exposes no rows',
  );
  const postAfter = await beta.rpc('post_property_comment', {
    p_property_id: discussion.id,
    p_body: 'after deactivation',
    p_key: '52000000-0000-4000-8000-0000000000a4',
  });
  assert.equal(
    postAfter.error?.code,
    '42501',
    'Deactivated session cannot post',
  );
  setBetaActive(true);
  observed('inactive identity and an existing deactivated session are denied', {
    inactiveSelectRows: rows.data?.length ?? 0,
    deactivatedPost: postAfter.error?.code ?? null,
  });
}
{
  const forger = await userClient('beta');
  const inserted = await forger.from('property_comments').insert({
    property_id: discussion.id,
    author_id: betaEmployee,
    author_name: 'Forged',
    body: 'forged',
    idempotency_key: '52000000-0000-4000-8000-0000000000a5',
  });
  assert.ok(inserted.error, 'Direct insert is rejected');
  const updated = await forger
    .from('property_comments')
    .update({ body: 'rewritten' })
    .eq('property_id', discussion.id)
    .select('id');
  assert.ok(
    updated.error || (updated.data ?? []).length === 0,
    'Direct update is rejected or matches nothing',
  );
  const deleted = await forger
    .from('property_comments')
    .delete()
    .eq('property_id', discussion.id)
    .select('id');
  assert.ok(
    deleted.error || (deleted.data ?? []).length === 0,
    'Direct delete is rejected or matches nothing',
  );
  const original = await forger
    .from('property_comments')
    .select('id,body,author_id,author_name,created_at,revision')
    .eq('property_id', discussion.id)
    .order('created_at', { ascending: true });
  assert.equal(original.error, null, 'Colleague reads the discussion');
  assert.equal(
    (original.data ?? []).length,
    3,
    'No direct write changed the list',
  );
  assert.equal(
    original.data[0].author_name,
    names.alpha,
    'Original attribution is retained',
  );
  assert.ok(
    original.data[0].revision,
    'Revision identity is exposed for later slices',
  );
  const propertyEdit = await forger
    .from('properties')
    .update({ notes: 'forged' })
    .eq('id', discussion.id)
    .select('id');
  assert.ok(
    propertyEdit.error || (propertyEdit.data ?? []).length === 0,
    'No property-edit authority is granted by the discussion',
  );
  observed('direct client writes are denied and originals stay immutable', {
    insertError: inserted.error?.code ?? 'blocked',
    comments: original.data.length,
  });
}
{
  const key = '52000000-0000-4000-8000-0000000000b1';
  const blank = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: '   \n\t ',
    p_key: key,
  });
  assert.equal(
    blank.error?.code,
    '23514',
    'Blank text is rejected at the database',
  );
  const long = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'x'.repeat(2001),
    p_key: key,
  });
  assert.equal(long.error?.code, '23514', 'Over-limit text is rejected');
  const boundary = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'ế'.repeat(2000),
    p_key: '52000000-0000-4000-8000-0000000000b2',
  });
  assert.equal(boundary.error, null, '2000 characters are accepted');
  const nullKey = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'missing key',
    p_key: null,
  });
  assert.equal(
    nullKey.error?.code,
    '23514',
    'Missing submission key is rejected',
  );
  observed(
    'validation boundaries reject blank and 2001 characters and accept 2000',
    {
      blanks: blank.error?.code,
      overLimit: long.error?.code,
      accepted: boundary.error === null,
    },
  );
}
{
  const key = '52000000-0000-4000-8000-0000000000b3';
  const body = 'Khách xem nhà\nHẹn thứ Bảy';
  const created = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: body,
    p_key: key,
  });
  assert.equal(created.error, null, 'First submission commits');
  assert.equal(
    created.data.author_id,
    alphaEmployee,
    'Actor comes from the session',
  );
  assert.equal(
    created.data.property_id,
    second.id,
    'Property association is the request target',
  );
  assert.ok(
    Math.abs(Date.parse(created.data.created_at) - (await dbNow())) < 300000,
    'Posting time is server generated',
  );
  const retried = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: `  ${body}  `,
    p_key: key,
  });
  assert.equal(retried.error, null, 'Same key and text recovers the original');
  assert.equal(
    retried.data.id,
    created.data.id,
    'Recovery returns one comment identity',
  );
  assert.equal(
    retried.data.created_at,
    created.data.created_at,
    'Original time is retained',
  );
  const conflicting = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung khác',
    p_key: key,
  });
  assert.equal(
    conflicting.error?.code,
    '23505',
    'Conflicting text reuse is rejected',
  );
  const otherProperty = await alpha.rpc('post_property_comment', {
    p_property_id: discussion.id,
    p_body: body,
    p_key: key,
  });
  assert.equal(
    otherProperty.error?.code,
    '23505',
    'Conflicting property reuse is rejected',
  );
  const forgedActor = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'forged actor',
    p_key: '52000000-0000-4000-8000-0000000000b4',
    p_author_id: betaEmployee,
    p_created_at: '2000-01-01T00:00:00Z',
  });
  assert.ok(forgedActor.error, 'Unknown parameters cannot forge actor or time');
  const freshKey = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: body,
    p_key: '52000000-0000-4000-8000-0000000000b5',
  });
  assert.equal(
    freshKey.error,
    null,
    'A new key deliberately creates another comment',
  );
  assert.notEqual(
    freshKey.data.id,
    created.data.id,
    'New key is a distinct comment',
  );
  observed(
    'submission key converges, conflicts are rejected and actor cannot be forged',
    {
      recovered: retried.data.id === created.data.id,
      conflicting: conflicting.error?.code,
      distinct: freshKey.data.id !== created.data.id,
    },
  );
}
{
  const archivedInitial = await reviewer.rpc('post_property_comment', {
    p_property_id: archived.id,
    p_body: 'Thảo luận trước khi lưu trữ',
    p_key: '52000000-0000-4000-8000-0000000000b6',
  });
  assert.equal(
    archivedInitial.error,
    null,
    'Fixture comment posted before archiving',
  );
  const revision = await archiveRevision(reviewer, archived.id);
  const archivedNow = await archive(reviewer, archived.id, revision);
  assert.equal(
    archivedNow.error,
    null,
    'Reviewer archives through the normal RPC',
  );
  const reviewerRows = await reviewer
    .from('property_comments')
    .select('id,body')
    .eq('property_id', archived.id);
  assert.equal(reviewerRows.error, null, 'Reviewer reads archived discussion');
  assert.equal(
    (reviewerRows.data ?? []).length,
    1,
    'Archived comment is retained',
  );
  const ordinaryRows = await beta
    .from('property_comments')
    .select('id')
    .eq('property_id', archived.id);
  assert.ok(
    ordinaryRows.error || (ordinaryRows.data ?? []).length === 0,
    'Ordinary employee cannot read archived discussion',
  );
  for (const [name, client] of [
    ['alpha', alpha],
    ['beta', beta],
    ['reviewer', reviewer],
  ]) {
    const denied = await client.rpc('post_property_comment', {
      p_property_id: archived.id,
      p_body: `${name} posting to an archived property`,
      p_key: '52000000-0000-4000-8000-0000000000b7',
    });
    assert.equal(
      denied.error?.code,
      '42501',
      `${name} posting to an archived property is denied`,
    );
  }
  // Recovery must not become a later route to restricted text.
  const recovery = await reviewer.rpc('post_property_comment', {
    p_property_id: archived.id,
    p_body: 'Thảo luận trước khi lưu trữ',
    p_key: '52000000-0000-4000-8000-0000000000b6',
  });
  assert.equal(
    recovery.error?.code,
    '42501',
    'Recovery rechecks the archive state',
  );
  observed(
    'archived discussion is reviewer-only and posting is denied for every role',
    {
      reviewerRows: reviewerRows.data.length,
      ordinaryRows: ordinaryRows.data?.length ?? 0,
    },
  );
}
{
  const session = new ApplicationSession();
  assert.equal(
    (await session.login('alpha')).status,
    200,
    'Application login succeeded',
  );
  const read = await session.request(
    '/api/properties/' + discussion.id + '/comments',
  );
  assert.equal(read.status, 200, 'Discussed property returns the discussion');
  assert.equal(
    read.cache,
    'private, no-store, max-age=0',
    'Discussion is never publicly cached',
  );
  assert.equal(
    read.body.comments.length,
    3,
    'Route returns the committed comments',
  );
  assert.equal(read.body.nextCursor, null, 'Single page has no cursor');
  const extraField = await session.request(
    '/api/properties/' + discussion.id + '/comments',
    {
      body: 'extra',
      key: '52000000-0000-4000-8000-0000000000c1',
      authorId: alphaEmployee,
    },
  );
  assert.equal(extraField.status, 400, 'Unknown fields are rejected');
  const blank = await session.request(
    '/api/properties/' + discussion.id + '/comments',
    { body: '   ', key: '52000000-0000-4000-8000-0000000000c2' },
  );
  assert.equal(blank.status, 400, 'Application boundary rejects blank text');
  const recovered = await session.request(
    '/api/properties/' + second.id + '/comments',
    {
      body: 'Khách xem nhà\nHẹn thứ Bảy',
      key: '52000000-0000-4000-8000-0000000000b3',
    },
  );
  assert.equal(
    recovered.status,
    200,
    'Identical retry recovers the original comment',
  );
  const conflict = await session.request(
    '/api/properties/' + second.id + '/comments',
    {
      body: 'Nội dung khác hoàn toàn',
      key: '52000000-0000-4000-8000-0000000000b3',
    },
  );
  assert.equal(conflict.status, 409, 'Conflicting reuse is a conflict');
  assert.equal(conflict.body.error, 'comment-conflict');
  const cursorInvalid = await session.request(
    '/api/properties/' +
      discussion.id +
      '/comments?before=not-a-time&beforeId=' +
      alphaEmployee,
  );
  assert.equal(cursorInvalid.status, 400, 'A malformed cursor is rejected');
  observed(
    'application routes enforce session, validation and conflict contract',
    {
      readStatus: read.status,
      cacheControl: read.cache,
      recovered: recovered.status,
      conflict: conflict.body.error,
    },
  );
}

// ------------------------------------------------------- removal authority and retention
{
  const seeded = await beta.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung cần gỡ để kiểm duyệt',
    p_key: '53000000-0000-4000-8000-000000000001',
  });
  assert.equal(seeded.error, null, 'Fixture comment posted for moderation');
  const seededId = seeded.data.id;
  const seededRevision = seeded.data.revision;
  // Authorship is not transferred by Property-edit authority or by an ordinary session.
  const claimed = await alpha.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_kind: 'author',
  });
  assert.equal(
    claimed.error?.code,
    '42501',
    'Another employee cannot claim authorship of a comment',
  );
  const ordinaryModeration = await beta.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_kind: 'moderation',
    p_reason: 'Lý do không có thẩm quyền',
  });
  assert.equal(
    ordinaryModeration.error?.code,
    '42501',
    'An ordinary employee cannot moderate',
  );
  // A nonblank moderation reason is mandatory.
  for (const reason of ['', '   ', '\n\t ', null]) {
    const blank = await reviewer.rpc('remove_property_comment', {
      p_property_id: second.id,
      p_comment_id: seededId,
      p_revision: seededRevision,
      p_kind: 'moderation',
      p_reason: reason,
    });
    assert.equal(
      blank.error?.code,
      '23514',
      'A blank moderation reason is rejected',
    );
  }
  const overlong = await reviewer.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_kind: 'moderation',
    p_reason: 'a'.repeat(2001),
  });
  assert.equal(
    overlong.error?.code,
    '23514',
    'An over-limit reason is rejected',
  );
  // A stale revision is refused rather than applied to newer text.
  const stale = await reviewer.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seededId,
    p_revision: '53000000-0000-4000-8000-0000000000ff',
    p_kind: 'moderation',
    p_reason: 'Lý do hợp lệ nhưng sai phiên bản',
  });
  assert.equal(stale.error?.code, 'PT409', 'A stale removal is refused');
  const unconsumed = await beta
    .from('property_comments')
    .select('body')
    .eq('id', seededId)
    .single();
  assert.equal(
    unconsumed.data.body,
    'Nội dung cần gỡ để kiểm duyệt',
    'A refused removal leaves the comment current',
  );
  const removed = await reviewer.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_kind: 'moderation',
    p_reason: '  Nội dung nhạy cảm, gỡ theo yêu cầu  ',
  });
  assert.equal(
    removed.error,
    null,
    'An active manager moderates with a reason',
  );
  assert.equal(removed.data.body, null, 'The removal response carries no text');
  assert.equal(
    removed.data.removed_at !== null,
    true,
    'The removal response is a marker',
  );
  assert.equal(
    Object.hasOwn(removed.data, 'removal_reason'),
    false,
    'No moderation reason reaches the ordinary projection',
  );
  const reviewerHistory = await reviewer.rpc(
    'list_property_comment_history',
    { p_property_id: second.id, p_comment_id: seededId },
  );
  assert.equal(reviewerHistory.error, null, 'Reviewer history read succeeds');
  assert.deepEqual(
    reviewerHistory.data.map((event) => [
      event.event_kind,
      event.removal_kind,
      event.reason,
    ]),
    [
      ['posting', null, null],
      ['removal', 'moderation', 'Nội dung nhạy cảm, gỡ theo yêu cầu'],
    ],
    'Moderated removal history keeps its kind and reason',
  );
  const staffHistory = await staff.rpc('list_property_comment_history', {
    p_property_id: second.id,
    p_comment_id: seededId,
  });
  assert.equal(staffHistory.error?.code, '42501', 'Staff history is denied');
  // Terminal and replay boundaries.
  const again = await reviewer.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_kind: 'moderation',
    p_reason: 'Gỡ lần hai',
  });
  assert.equal(again.error?.code, 'PT409', 'A removed comment is terminal');
  const replay = await beta.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung cần gỡ để kiểm duyệt',
    p_key: '53000000-0000-4000-8000-000000000001',
  });
  assert.equal(replay.error, null, 'The original posting key still recovers');
  assert.equal(
    replay.data.id,
    seededId,
    'Replay converges on the original identity',
  );
  assert.equal(replay.data.body, null, 'Replay never returns withdrawn text');
  assert.equal(
    replay.data.removed_at !== null,
    true,
    'Replay reports the removal marker',
  );
  // Only active manager/admin reach the retained evidence; the author has no exception.
  const managerRows = await reviewer
    .from('property_comment_removals')
    .select(
      'comment_id,body,removal_kind,removal_reason,removed_by,author_id,original_revision',
    )
    .eq('comment_id', seededId);
  assert.equal(managerRows.error, null, 'A manager reads retained evidence');
  assert.equal(managerRows.data.length, 1, 'The retained evidence row exists');
  assert.equal(
    managerRows.data[0].body,
    'Nội dung cần gỡ để kiểm duyệt',
    'The original text is retained',
  );
  assert.equal(managerRows.data[0].removal_kind, 'moderation');
  assert.equal(
    managerRows.data[0].removal_reason,
    'Nội dung nhạy cảm, gỡ theo yêu cầu',
    'The reason is retained trimmed',
  );
  assert.equal(
    managerRows.data[0].removed_by,
    fixtures.identities.reviewer.employeeId,
    'The removing actor is retained',
  );
  assert.equal(
    managerRows.data[0].author_id,
    betaEmployee,
    'The original author is retained rather than the moderator',
  );
  assert.equal(
    managerRows.data[0].original_revision,
    seededRevision,
    'The removed revision is retained',
  );
  for (const [name, client] of [
    ['author', beta],
    ['colleague', alpha],
  ]) {
    const hidden = await client
      .from('property_comment_removals')
      .select('comment_id')
      .eq('comment_id', seededId);
    assert.ok(
      hidden.error || hidden.data.length === 0,
      `${name} cannot read retained evidence`,
    );
  }
  const inactive = await userClient('inactive');
  const inactiveRows = await inactive
    .from('property_comment_removals')
    .select('comment_id');
  assert.ok(
    inactiveRows.error || inactiveRows.data.length === 0,
    'An inactive identity reads no retained evidence',
  );
  // No direct client write bypasses the transition, attribution or retention.
  const forged = await reviewer.from('property_comment_removals').insert({
    comment_id: seededId,
    property_id: second.id,
    author_id: alphaEmployee,
    author_name: 'Forged',
    body: 'forged',
    original_created_at: new Date().toISOString(),
    original_revision: randomUUID(),
    removed_by: alphaEmployee,
    removed_actor_name: 'Forged',
    removal_kind: 'moderation',
    removal_reason: 'forged',
  });
  assert.ok(forged.error, 'A direct retained-evidence insert is rejected');
  const rewritten = await reviewer
    .from('property_comments')
    .update({ body: 'rewritten' })
    .eq('id', seededId)
    .select('id');
  assert.ok(
    rewritten.error || rewritten.data.length === 0,
    'Withdrawn text cannot be rewritten in place',
  );
  const purged = await reviewer
    .from('property_comments')
    .delete()
    .eq('id', seededId)
    .select('id');
  assert.ok(
    purged.error || purged.data.length === 0,
    'A removed comment is never hard-deleted',
  );
  observed(
    'moderation requires a reason and retains the original text, actor and revision',
    {
      ordinaryDenied: ordinaryModeration.error?.code,
      claimedDenied: claimed.error?.code,
      staleDenied: stale.error?.code,
      terminalDenied: again.error?.code,
      replayMarker: replay.data.body === null,
      reasonRetained: managerRows.data[0].removal_reason,
    },
  );
  observed(
    'retained removal evidence is reviewer-only and immune to direct writes',
    {
      managerRows: managerRows.data.length,
      ordinaryRows: 0,
      inactiveRows: inactiveRows.data?.length ?? 0,
      forgedInsert: forged.error?.code ?? 'blocked',
    },
  );
}
{
  // Competing moderation sessions: exactly one transition and one retained record.
  const seeded = await beta.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Đua gỡ song song',
    p_key: '53000000-0000-4000-8000-000000000002',
  });
  assert.equal(
    seeded.error,
    null,
    'Fixture comment posted for the removal race',
  );
  const competingSession = await userClient('reviewer');
  const [firstAttempt, secondAttempt] = await Promise.all([
    reviewer.rpc('remove_property_comment', {
      p_property_id: second.id,
      p_comment_id: seeded.data.id,
      p_revision: seeded.data.revision,
      p_kind: 'moderation',
      p_reason: 'Phiên kiểm duyệt thứ nhất',
    }),
    competingSession.rpc('remove_property_comment', {
      p_property_id: second.id,
      p_comment_id: seeded.data.id,
      p_revision: seeded.data.revision,
      p_kind: 'moderation',
      p_reason: 'Phiên kiểm duyệt thứ hai',
    }),
  ]);
  const committed = [firstAttempt, secondAttempt].filter(
    (result) => !result.error,
  ).length;
  const refused = [firstAttempt, secondAttempt]
    .filter((result) => result.error)
    .map((result) => result.error.code);
  assert.equal(committed, 1, 'Exactly one competing removal commits');
  assert.ok(
    refused.every((code) => code === 'PT409' || code === '23505'),
    'The losing attempt is refused as stale',
  );
  const records = await reviewer
    .from('property_comment_removals')
    .select('comment_id')
    .eq('comment_id', seeded.data.id);
  assert.equal(records.error, null, 'Retained evidence stays readable');
  assert.equal(
    records.data.length,
    1,
    'Competing attempts never create duplicate history',
  );
  const marker = await alpha
    .from('property_comments')
    .select('body,removed_at')
    .eq('id', seeded.data.id)
    .single();
  assert.equal(marker.data.body, null, 'The surviving state is the marker');
  assert.equal(
    marker.data.removed_at !== null,
    true,
    'The surviving state records the removal time',
  );
  observed(
    'competing removal sessions serialize into one transition and one retained record',
    {
      committed,
      refused: refused.join(','),
      records: records.data.length,
    },
  );
}
{
  // Archived moderation: a manager acting as the author is blocked, reasoned moderation is not.
  const archivedRow = await reviewer
    .from('property_comments')
    .select('id,revision,author_id')
    .eq('property_id', archived.id)
    .single();
  assert.equal(archivedRow.error, null, 'Reviewer reads the archived comment');
  assert.equal(
    archivedRow.data.author_id,
    fixtures.identities.reviewer.employeeId,
    'The archived fixture comment is manager-authored',
  );
  const archivedAuthor = await reviewer.rpc('remove_property_comment', {
    p_property_id: archived.id,
    p_comment_id: archivedRow.data.id,
    p_revision: archivedRow.data.revision,
    p_kind: 'author',
  });
  assert.equal(
    archivedAuthor.error?.code,
    '42501',
    'A manager acting as the author cannot remove on an archived property',
  );
  signOut(secondary);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await browserLogin('reviewer', secondary, 'vi');
  browser(['open', detail(archived)], secondary);
  await settle(secondary);
  const before = screen(secondary);
  assert.equal(
    before.comments.length,
    1,
    'Reviewer reads the archived discussion',
  );
  assert.equal(
    before.removeControls,
    0,
    'Author removal is absent on an archived Property',
  );
  assert.equal(
    before.moderateControls,
    1,
    'Reasoned moderation stays available to a reviewer',
  );
  assert.equal(
    before.postButton,
    false,
    'An archived Property cannot receive comments',
  );
  click('Gỡ kèm lý do', secondary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-moderation textarea'))`,
    secondary,
  );
  fill('Lý do kiểm duyệt', 'Gỡ nội dung sau khi lưu trữ', secondary);
  click('Xác nhận gỡ', secondary);
  await waitUntil(
    `() => document.querySelectorAll('section.discussion .comment-removed').length === 1`,
    secondary,
  );
  await settle(secondary);
  const after = screen(secondary);
  assert.ok(
    after.statuses.some((status) => /Bình luận đã được gỡ/.test(status)),
    'Archived moderation is reported',
  );
  assert.ok(
    !after.comments.some((comment) =>
      (comment.body ?? '').includes('Thảo luận trước khi lưu trữ'),
    ),
    'The archived text is no longer shown',
  );
  assert.equal(
    after.comments.find((comment) => comment.removed).author,
    names.reviewer,
    'The retained author attribution is shown with the marker',
  );
  const archivedEvidence = await reviewer
    .from('property_comment_removals')
    .select('body,removal_kind,removal_reason')
    .eq('comment_id', archivedRow.data.id)
    .single();
  assert.equal(
    archivedEvidence.error,
    null,
    'The archived removal is retained',
  );
  assert.equal(
    archivedEvidence.data.body,
    'Thảo luận trước khi lưu trữ',
    'The archived original text is retained',
  );
  assert.equal(archivedEvidence.data.removal_kind, 'moderation');
  assert.equal(
    archivedEvidence.data.removal_reason,
    'Gỡ nội dung sau khi lưu trữ',
    'The archived moderation reason is retained',
  );
  observed(
    'archived moderation succeeds where author removal is blocked, with the reason retained',
    {
      authorRemoval: archivedAuthor.error?.code,
      markerAuthor: names.reviewer,
      reason: archivedEvidence.data.removal_reason,
    },
  );
}
{
  // A failed moderation keeps the typed reason and never claims success.
  const seeded = await beta.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung để thử giữ lý do',
    p_key: '53000000-0000-4000-8000-000000000003',
  });
  assert.equal(
    seeded.error,
    null,
    'Fixture comment posted for the failed moderation',
  );
  browser(['open', detail(second)], secondary);
  await settle(secondary);
  // Open the reason form on exactly this comment.
  evaluate(
    `() => {
      const target = [...document.querySelectorAll('section.discussion .comment')].find((node) => (node.querySelector('.comment-body')?.textContent ?? '').includes('Nội dung để thử giữ lý do'));
      target.querySelector('.comment-actions button').click();
      return true;
    }`,
    secondary,
  );
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-moderation textarea'))`,
    secondary,
  );
  fill('Lý do kiểm duyệt', 'Lý do cần được giữ lại', secondary);
  // A competing session removes the same comment before this form is submitted.
  const competing = await reviewer.rpc('remove_property_comment', {
    p_property_id: second.id,
    p_comment_id: seeded.data.id,
    p_revision: seeded.data.revision,
    p_kind: 'moderation',
    p_reason: 'Phiên khác đã gỡ',
  });
  assert.equal(competing.error, null, 'The competing removal commits');
  click('Xác nhận gỡ', secondary);
  await waitUntil(
    `() => [...document.querySelectorAll('section.discussion [role=alert]')].some((node) => /đã thay đổi|đã bị gỡ/.test(node.textContent))`,
    secondary,
  );
  const failed = screen(secondary);
  assert.equal(
    failed.moderationReason,
    'Lý do cần được giữ lại',
    'The unsent reason is preserved',
  );
  assert.ok(
    !failed.statuses.some((status) => /Bình luận đã được gỡ/.test(status)),
    'No success is claimed for the failed moderation',
  );
  observed('failed moderation keeps the typed reason and claims no success', {
    reasonKept: failed.moderationReason === 'Lý do cần được giữ lại',
    conflict: true,
  });
}

// ------------------------------------------------------- author edit journey
{
  browser(['open', detail(discussion)], primary);
  await settle(primary);
  const before = screen(primary);
  const liveAuthorComments = before.comments.filter(
    (comment) => comment.author === names.alpha && !comment.removed,
  );
  assert.equal(
    before.commentEditControls,
    liveAuthorComments.length,
    'The author sees one edit control per live own comment and no other entry offers one',
  );
  assert.equal(before.editedMarkers, 0, 'No entry is marked edited yet');
  const targetIndex = before.comments.findIndex(
    (comment) => comment.author === names.alpha && !comment.removed,
  );
  assert.ok(targetIndex >= 0, 'The author has a live comment to edit');
  click('Chỉnh sửa bình luận', primary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    primary,
  );
  const editedVi = '  Nội dung đã sửa\nGiá 12 tỷ — còn thương lượng.  ';
  fill('Chỉnh sửa bình luận', editedVi, primary);
  click('Lưu thay đổi', primary);
  await waitUntil(
    `() => document.querySelectorAll('section.discussion .comment-edited').length === 1`,
    primary,
  );
  await settle(primary);
  const after = screen(primary);
  assert.equal(
    after.comments.length,
    before.comments.length,
    'An edit adds no entry and removes none',
  );
  assert.equal(
    after.comments[targetIndex].body,
    editedVi.trim(),
    'Trimming preserves accents and line breaks',
  );
  assert.equal(
    after.comments[targetIndex].edited,
    true,
    'The entry is marked edited',
  );
  assert.equal(
    after.comments[targetIndex].time,
    before.comments[targetIndex].time,
    'The original posting time and position are preserved',
  );
  assert.ok(
    after.statuses.some((status) => /Đã cập nhật bình luận/.test(status)),
    'A committed edit is reported in VI',
  );
  observed(
    'VI author edit replaces the live text in place with an edited marker',
    {
      position: targetIndex,
      entries: after.comments.length,
      originalTimeRetained: true,
    },
  );
}
{
  switchLocale('en', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Property discussion'`,
    primary,
  );
  await settle(primary);
  const english = screen(primary);
  assert.ok(
    english.commentEditControls >= 1,
    'The edit control is localized in EN',
  );
  assert.equal(
    english.editedMarkers,
    1,
    'The edited marker survives the language switch',
  );
  assert.ok(
    english.comments.some((comment) =>
      (comment.body ?? '').includes('Nội dung đã sửa'),
    ),
    'Source comment text is not translated',
  );
  click('Edit comment', primary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    primary,
  );
  // Saving the unchanged text is an explicit no-op, not a silent success.
  click('Save changes', primary);
  await waitUntil(
    `() => /No changes to save/.test(document.querySelector('section.discussion .comment-edit [role=alert]')?.textContent ?? '')`,
    primary,
  );
  const noop = screen(primary);
  assert.equal(
    noop.editDraft,
    'Nội dung đã sửa\nGiá 12 tỷ — còn thương lượng.',
    'The editor keeps the unchanged draft',
  );
  assert.ok(
    !noop.statuses.some((status) => /Comment updated/.test(status)),
    'A no-op claims no success',
  );
  assert.equal(noop.editedMarkers, 1, 'A no-op adds no version');
  click('Cancel', primary);
  await waitUntil(
    `() => !document.querySelector('section.discussion .comment-edit textarea')`,
    primary,
  );
  switchLocale('vi', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Thảo luận bất động sản'`,
    primary,
  );
  await settle(primary);
  observed(
    'EN edit control, edited marker and no-op keep source text and claim no success',
    { markerEn: 'edited', noOp: true },
  );
}
{
  const rows = await operatorSqlAsync(
    `select id, revision from public.property_comments where property_id='${discussion.id}' and author_id='${alphaEmployee}' and removed_at is null order by created_at desc limit 1`,
  );
  assert.ok(rows[0]?.id, 'The author still has one live comment to race');
  browser(['open', detail(discussion)], primary);
  await settle(primary);
  click('Chỉnh sửa bình luận', primary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    primary,
  );
  fill('Chỉnh sửa bình luận', 'Bản nháp chưa gửi', primary);
  // A second real session of the same author commits first; the open editor is now stale.
  const competing = await userClient('alpha');
  const competingEdit = await competing.rpc('edit_property_comment', {
    p_property_id: discussion.id,
    p_comment_id: rows[0].id,
    p_revision: rows[0].revision,
    p_body: 'Bản nháp chưa gửi',
    p_key: randomUUID(),
  });
  assert.equal(
    competingEdit.error,
    null,
    'A competing author session commits first',
  );
  click('Làm mới', primary);
  await waitUntil(
    `() => document.querySelector('section.discussion .comment-current .comment-body')?.textContent === 'Bản nháp chưa gửi'`,
    primary,
  );
  const refreshedEditor = screen(primary);
  assert.equal(
    refreshedEditor.editDraft,
    'Bản nháp chưa gửi',
    'Refresh keeps the unsent edit draft',
  );
  assert.equal(
    refreshedEditor.editCurrent,
    'Bản nháp chưa gửi',
    'Refresh presents the current committed text beside the draft',
  );
  click('Lưu thay đổi', primary);
  await waitUntil(
    `() => /đã thay đổi|đã bị gỡ/.test(document.querySelector('section.discussion .comment-edit [role=alert]')?.textContent ?? '')`,
    primary,
  );
  const stale = screen(primary);
  assert.equal(
    stale.editDraft,
    'Bản nháp chưa gửi',
    'The unsent edit draft is kept',
  );
  assert.equal(
    stale.editCurrent,
    'Bản nháp chưa gửi',
    'A same-text stale save keeps the authoritative committed text visible',
  );
  assert.ok(
    !stale.statuses.some((status) => /Đã cập nhật bình luận/.test(status)),
    'A stale save claims no success',
  );
  click('Làm mới', primary);
  await waitUntil(
    `() => /đã thay đổi|đã bị gỡ/.test(document.querySelector('section.discussion .comment-edit [role=alert]')?.textContent ?? '') && document.querySelector('section.discussion .comment-current .comment-body')?.textContent === 'Bản nháp chưa gửi'`,
    primary,
  );
  const staleRefresh = screen(primary);
  assert.equal(staleRefresh.editDraft, 'Bản nháp chưa gửi');
  assert.equal(staleRefresh.editCurrent, 'Bản nháp chưa gửi');
  click('Huỷ', primary);
  await waitUntil(
    `() => !document.querySelector('section.discussion .comment-edit textarea')`,
    primary,
  );
  observed(
    'same-text competing edit stays stale after refresh with draft and current text visible',
    { conflict: true, draftKept: true, currentVisible: true },
  );
}
{
  // A save in flight cannot be orphaned: the author cannot open a second editor, so a failure
  // stays visible in the session that sent it with its unsent draft.
  browser(['open', detail(discussion)], primary);
  await settle(primary);
  const editable = screen(primary).comments.filter(
    (comment) => comment.author === names.alpha && !comment.removed,
  );
  assert.ok(
    editable.length >= 2,
    'The author has two editable comments for the in-flight save check',
  );
  click('Chỉnh sửa bình luận', primary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    primary,
  );
  fill('Chỉnh sửa bình luận', 'Bản nháp đang lưu', primary);
  evaluate(
    `() => {
      const original = window.fetch.bind(window);
      let release;
      window.__editSaveHeld = false;
      window.__releaseEditSave = () => release?.();
      window.fetch = async (...args) => {
        const input = args[0];
        const options = args[1] ?? {};
        const url = typeof input === 'string' ? input : input.url;
        const method = String(options.method ?? input?.method ?? 'GET').toUpperCase();
        if (method === 'PATCH' && url.includes('/comments/')) {
          window.__editSaveHeld = true;
          await new Promise((resolve) => { release = resolve; });
          window.fetch = original;
          return new Response(JSON.stringify({ error: 'unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return original(...args);
      };
      return true;
    }`,
    primary,
  );
  click('Lưu thay đổi', primary);
  await waitUntil(`() => window.__editSaveHeld === true`, primary);
  await waitUntil(
    `() => {
      const buttons = [...document.querySelectorAll('section.discussion .comment-actions button')]
        .filter((button) => /Chỉnh sửa bình luận|^Edit comment$/.test((button.getAttribute('aria-label') ?? button.textContent).trim()));
      return buttons.length > 0 && buttons.every((button) => button.disabled);
    }`,
    primary,
  );
  const held = screen(primary);
  assert.equal(
    held.editDraft,
    'Bản nháp đang lưu',
    'The in-flight save keeps its draft',
  );
  evaluate(
    `() => {
      const button = [...document.querySelectorAll('section.discussion .comment-actions button')]
        .find((node) => /Chỉnh sửa bình luận|^Edit comment$/.test((node.getAttribute('aria-label') ?? node.textContent).trim()));
      button?.click();
      return true;
    }`,
    primary,
  );
  assert.equal(
    screen(primary).editDraft,
    'Bản nháp đang lưu',
    'The attempted second editor does not replace the open draft',
  );
  assert.equal(
    evaluate(
      `() => document.querySelectorAll('section.discussion .comment-edit textarea').length`,
      primary,
    ),
    1,
    'Only the session that sent the save stays open',
  );
  evaluate(`() => { window.__releaseEditSave(); return true; }`, primary);
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit [role=alert]'))`,
    primary,
  );
  const failed = screen(primary);
  assert.equal(
    failed.editDraft,
    'Bản nháp đang lưu',
    'A failed save keeps the unsent draft in its own editor',
  );
  assert.ok(
    /Chưa lưu được thay đổi/.test(failed.editError ?? ''),
    'A failed save shows the localized error where the save was sent',
  );
  assert.ok(
    !failed.statuses.some((status) => /Đã cập nhật bình luận/.test(status)),
    'A failed save claims no success',
  );
  observed(
    'in-flight edit save blocks a second editor and keeps the failed draft and error',
    {
      otherEditors: editable.length - 1,
      draftKept: failed.editDraft === 'Bản nháp đang lưu',
      localizedError: true,
    },
  );
  click('Huỷ', primary);
  await waitUntil(
    `() => !document.querySelector('section.discussion .comment-edit textarea')`,
    primary,
  );
}
{
  // A lost edit response leaves the key open; a withdrawal before the retry is not an update.
  const seeded = await alpha.rpc('post_property_comment', {
    p_property_id: discussion.id,
    p_body: 'Nội dung phát lại sau khi gỡ',
    p_key: '55000000-0000-4000-8000-000000000201',
  });
  assert.equal(
    seeded.error,
    null,
    'Fixture comment posted for a replayed withdrawal',
  );
  browser(['open', detail(discussion)], primary);
  await settle(primary);
  evaluate(
    `() => {
      const target = [...document.querySelectorAll('section.discussion .comment')].find((node) => (node.querySelector('.comment-body')?.textContent ?? '') === 'Nội dung phát lại sau khi gỡ');
      [...target.querySelectorAll('.comment-actions button')].find((button) => (button.getAttribute('aria-label') ?? button.textContent).trim() === 'Chỉnh sửa bình luận').click();
      return true;
    }`,
    primary,
  );
  await waitUntil(
    `() => Boolean(document.querySelector('section.discussion .comment-edit textarea'))`,
    primary,
  );
  fill('Chỉnh sửa bình luận', 'Bản nháp phát lại được giữ', primary);
  evaluate(
    `() => {
      const original = window.fetch.bind(window);
      window.__replayedEdit = false;
      window.fetch = async (...args) => {
        const input = args[0];
        const options = args[1] ?? {};
        const url = typeof input === 'string' ? input : input.url;
        const method = String(options.method ?? input?.method ?? 'GET').toUpperCase();
        const response = await original(...args);
        if (method === 'PATCH' && url.includes('/comments/')) {
          window.__replayedEdit = true;
          window.fetch = original;
          throw new TypeError('simulated lost edit response');
        }
        return response;
      };
      return true;
    }`,
    primary,
  );
  click('Lưu thay đổi', primary);
  await waitUntil(`() => window.__replayedEdit === true`, primary);
  await waitUntil(
    `() => /Chưa lưu được thay đổi/.test(document.querySelector('section.discussion .comment-edit [role=alert]')?.textContent ?? '')`,
    primary,
  );
  const committed = await commentState(seeded.data.id);
  assert.equal(
    committed.body,
    'Bản nháp phát lại được giữ',
    'The lost-response edit committed on the server',
  );
  const withdrawn = await alpha.rpc('remove_property_comment', {
    p_property_id: discussion.id,
    p_comment_id: seeded.data.id,
    p_revision: committed.revision,
    p_kind: 'author',
  });
  assert.equal(
    withdrawn.error,
    null,
    'A competing author session withdraws the comment',
  );
  click('Lưu thay đổi', primary);
  await waitUntil(
    `() => /đã thay đổi|đã bị gỡ/.test(document.querySelector('section.discussion .comment-edit [role=alert]')?.textContent ?? '')`,
    primary,
  );
  await waitUntil(
    `() => document.querySelector('section.discussion .comment-current .comment-body')?.textContent === 'Bình luận đã được gỡ.'`,
    primary,
  );
  const replayed = screen(primary);
  assert.equal(
    replayed.editDraft,
    'Bản nháp phát lại được giữ',
    'The unsent draft survives the replayed withdrawal',
  );
  assert.ok(
    !replayed.statuses.some((status) => /Đã cập nhật bình luận/.test(status)),
    'A replayed edit on a withdrawn comment claims no success',
  );
  assert.equal(
    await editVersionCount(seeded.data.id),
    1,
    'The replay adds no further retained version',
  );
  observed(
    'replayed edit key after withdrawal keeps the draft and reports the removal',
    { draftKept: true, versions: 1 },
  );
  click('Huỷ', primary);
  await waitUntil(
    `() => !document.querySelector('section.discussion .comment-edit textarea')`,
    primary,
  );
}
{
  browser(['open', detail(discussion)], primary);
  await settle(primary);
  const page = screen(primary);
  const live = page.comments.filter(
    (comment) => comment.author === names.alpha && !comment.removed,
  );
  assert.equal(
    page.commentEditControls,
    live.length,
    'Only live own comments offer an edit control',
  );
  assert.ok(
    page.comments
      .filter((comment) => comment.removed)
      .every((comment) => !comment.edited),
    'A removed entry carries no edited marker and no edit control',
  );
  observed('removed entries expose no edit control or edited marker', {
    removed: page.comments.filter((comment) => comment.removed).length,
  });
}
{
  // An archived Property blocks author edits for every role, including the author.
  const reviewerEmployee = fixtures.identities.reviewer.employeeId;
  const seededId = randomUUID();
  const seededRevision = randomUUID();
  await operatorSqlAsync(
    `insert into public.property_comments(id,property_id,author_id,author_name,body,revision,idempotency_key) values('${seededId}','${archived.id}','${reviewerEmployee}','${names.reviewer.replace(/'/g, "''")}','Thảo luận lưu trữ còn hiệu lực','${seededRevision}','${randomUUID()}')`,
  );
  const archivedEdit = await reviewer.rpc('edit_property_comment', {
    p_property_id: archived.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_body: 'Sửa trên hồ sơ lưu trữ',
    p_key: randomUUID(),
  });
  assert.equal(
    archivedEdit.error?.code,
    'PT403',
    'An archived Property blocks an author edit for a reviewer too',
  );
  const ordinaryEdit = await alpha.rpc('edit_property_comment', {
    p_property_id: archived.id,
    p_comment_id: seededId,
    p_revision: seededRevision,
    p_body: 'Người khác sửa trên hồ sơ lưu trữ',
    p_key: randomUUID(),
  });
  assert.equal(
    ordinaryEdit.error?.code,
    '42501',
    'A non-author is refused without disclosing the archived Property state',
  );
  const unknownArchived = await alpha.rpc('edit_property_comment', {
    p_property_id: archived.id,
    p_comment_id: '54000000-0000-4000-8000-0000000000fe',
    p_revision: seededRevision,
    p_body: 'Không lộ bình luận không tồn tại trên hồ sơ lưu trữ',
    p_key: randomUUID(),
  });
  const unknownLive = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: '54000000-0000-4000-8000-0000000000fe',
    p_revision: seededRevision,
    p_body: 'Không lộ bình luận không tồn tại trên hồ sơ hiện tại',
    p_key: randomUUID(),
  });
  assert.equal(
    unknownArchived.error?.code,
    '23514',
    'An unknown comment is refused without disclosing the archived Property state',
  );
  assert.equal(
    unknownLive.error?.code,
    unknownArchived.error?.code,
    'An unknown comment answers identically on an unarchived Property',
  );
  const state = await commentState(seededId);
  assert.equal(state.body, 'Thảo luận lưu trữ còn hiệu lực');
  assert.equal(state.edited_at, null);
  assert.equal(
    await editVersionCount(seededId),
    0,
    'A refused archived edit retains no version',
  );
  await operatorSqlAsync(
    `do $$ begin
       execute 'alter table public.property_comments disable trigger comment_original';
       delete from public.property_comments where id='${seededId}';
       execute 'alter table public.property_comments enable trigger comment_original';
     end $$;`,
  );
  observed(
    'archived Property blocks the author edit while non-authors and unknown comments stay indistinguishable',
    {
      reviewer: archivedEdit.error?.code,
      ordinary: ordinaryEdit.error?.code,
      unknownArchived: unknownArchived.error?.code,
      unknownLive: unknownLive.error?.code,
    },
  );
}
{
  const seeded = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung để sửa',
    p_key: '54000000-0000-4000-8000-000000000001',
  });
  assert.equal(seeded.error, null, 'Fixture comment posted for editing');
  const id = seeded.data.id;
  const revision = seeded.data.revision;
  assert.equal(seeded.data.edited_at, null, 'A new comment is not edited');
  for (const [name, client] of [
    ['colleague', beta],
    ['reviewer', reviewer],
  ]) {
    const denied = await client.rpc('edit_property_comment', {
      p_property_id: second.id,
      p_comment_id: id,
      p_revision: revision,
      p_body: `${name} rewrite attempt`,
      p_key: randomUUID(),
    });
    assert.equal(
      denied.error?.code,
      '42501',
      `${name} cannot rewrite another author comment`,
    );
  }
  const stale = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: id,
    p_revision: '54000000-0000-4000-8000-0000000000ff',
    p_body: 'Sửa sai phiên bản',
    p_key: randomUUID(),
  });
  assert.equal(stale.error?.code, 'PT409', 'A stale edit is refused');
  const noop = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: id,
    p_revision: revision,
    p_body: 'Nội dung để sửa',
    p_key: randomUUID(),
  });
  assert.equal(
    noop.error?.code,
    'PT400',
    'Identical text is refused as unchanged',
  );
  for (const bad of ['', '   ', 'x'.repeat(2001)]) {
    const invalid = await alpha.rpc('edit_property_comment', {
      p_property_id: second.id,
      p_comment_id: id,
      p_revision: revision,
      p_body: bad,
      p_key: randomUUID(),
    });
    assert.equal(invalid.error?.code, '23514', 'Invalid edit text is rejected');
  }
  const editKey = randomUUID();
  const updated = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: id,
    p_revision: revision,
    p_body: '  Nội dung đã sửa\nGiữ dấu — và dòng.  ',
    p_key: editKey,
  });
  assert.equal(updated.error, null, 'The author edit commits');
  assert.equal(updated.data.id, id, 'Comment identity is preserved');
  assert.equal(
    updated.data.body,
    'Nội dung đã sửa\nGiữ dấu — và dòng.',
    'Trimmed text preserves accents and line breaks',
  );
  assert.equal(updated.data.author_id, alphaEmployee, 'Author is preserved');
  assert.equal(
    updated.data.created_at,
    seeded.data.created_at,
    'Original posting time is preserved',
  );
  assert.ok(
    !Number.isNaN(new Date(updated.data.edited_at).getTime()),
    'The edited marker is set',
  );
  assert.notEqual(updated.data.revision, revision, 'The revision advances');
  assert.equal(
    Object.hasOwn(updated.data, 'previous_body'),
    false,
    'No preceding version reaches the ordinary projection',
  );
  const recovered = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: id,
    p_revision: revision,
    p_body: 'Nội dung đã sửa\nGiữ dấu — và dòng.',
    p_key: editKey,
  });
  assert.equal(recovered.error, null, 'An exact edit-key retry recovers');
  assert.equal(
    recovered.data.revision,
    updated.data.revision,
    'An exact edit-key retry returns the committed revision',
  );
  assert.equal(
    await editVersionCount(id),
    1,
    'An exact edit-key retry adds no retained version',
  );
  const sameTextOtherKey = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: id,
    p_revision: revision,
    p_body: 'Nội dung đã sửa\nGiữ dấu — và dòng.',
    p_key: randomUUID(),
  });
  assert.equal(
    sameTextOtherKey.error?.code,
    'PT409',
    'The same text under another edit key stays stale',
  );
  const inactive = await userClient('inactive');
  const unlinked = await userClient('unlinked');
  for (const [name, client] of [
    ['author', alpha],
    ['colleague', beta],
    ['inactive', inactive],
    ['unlinked', unlinked],
  ]) {
    const hidden = await client
      .from('property_comment_edits')
      .select('comment_id')
      .eq('comment_id', id);
    assert.ok(
      hidden.error || hidden.data.length === 0,
      `${name} cannot read prior versions`,
    );
  }
  const anonymous = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const anonymousRows = await anonymous
    .from('property_comment_edits')
    .select('comment_id');
  assert.ok(
    anonymousRows.error || anonymousRows.data.length === 0,
    'Anonymous reads no prior versions',
  );
  const reviewerRows = await reviewer
    .from('property_comment_edits')
    .select('comment_id,version,previous_body,body')
    .eq('comment_id', id);
  const reviewerHistory = await reviewer.rpc(
    'list_property_comment_history',
    { p_property_id: second.id, p_comment_id: id },
  );
  assert.equal(reviewerHistory.error, null, 'A reviewer reads comment history');
  assert.deepEqual(
    reviewerHistory.data.map((event) => [
      event.event_kind,
      event.version,
      event.removal_kind,
      event.reason,
      event.has_more,
    ]),
    [
      ['posting', 0, null, null, false],
      ['edit', 1, null, null, false],
    ],
    'History returns the original and saved edit in order',
  );
  for (const [name, client] of [
    ['author', alpha],
    ['colleague', beta],
    ['staff', staff],
    ['inactive', inactive],
    ['unlinked', unlinked],
  ]) {
    const deniedHistory = await client.rpc('list_property_comment_history', {
      p_property_id: second.id,
      p_comment_id: id,
    });
    assert.equal(
      deniedHistory.error?.code,
      '42501',
      `${name} cannot read retained history`,
    );
  }
  const anonymousHistory = await anonymous.rpc('list_property_comment_history', {
    p_property_id: second.id,
    p_comment_id: id,
  });
  assert.ok(anonymousHistory.error, 'Anonymous history is denied');
  const unlinkedHistory = await unlinked.rpc('list_property_comment_history', {
    p_property_id: second.id,
    p_comment_id: id,
  });
  assert.equal(unlinkedHistory.error?.code, '42501', 'Unlinked history is denied');
  const ordinaryHistorySession = new ApplicationSession();
  assert.equal(
    (await ordinaryHistorySession.login('alpha')).status,
    200,
    'Ordinary history route session login succeeded',
  );
  const deniedHistoryRoute = await ordinaryHistorySession.request(
    `/api/properties/${second.id}/comments/${id}/history`,
  );
  assert.equal(
    deniedHistoryRoute.status,
    403,
    'Ordinary history route access is denied',
  );
  const unlinkedHistorySession = new ApplicationSession();
  assert.equal(
    (await unlinkedHistorySession.login('unlinked')).status,
    200,
    'Unlinked history route session login succeeded',
  );
  const deniedUnlinkedHistoryRoute = await unlinkedHistorySession.request(
    `/api/properties/${second.id}/comments/${id}/history`,
  );
  assert.equal(
    deniedUnlinkedHistoryRoute.status,
    403,
    'Unlinked history route access is denied',
  );
  assert.equal(
    reviewerRows.error,
    null,
    'A reviewer reads the retained versions',
  );
  assert.equal(reviewerRows.data.length, 1);
  assert.equal(reviewerRows.data[0].previous_body, 'Nội dung để sửa');
  assert.equal(
    reviewerRows.data[0].body,
    'Nội dung đã sửa\nGiữ dấu — và dòng.',
  );
  const forged = await alpha.from('property_comment_edits').insert({
    comment_id: id,
    property_id: second.id,
    author_id: alphaEmployee,
    author_name: 'Forged',
    edited_by: alphaEmployee,
    edited_actor_name: 'Forged',
    version: 9,
    previous_body: 'forged',
    body: 'forged',
    previous_revision: randomUUID(),
    revision: randomUUID(),
  });
  assert.ok(forged.error, 'A direct retained-edit insert is denied');
  const rewritten = await alpha
    .from('property_comments')
    .update({ body: 'rewritten' })
    .eq('id', id)
    .select('id');
  assert.ok(
    rewritten.error || rewritten.data.length === 0,
    'A direct comment update is denied',
  );
  const purged = await alpha
    .from('property_comment_edits')
    .delete()
    .eq('comment_id', id)
    .select('comment_id');
  assert.ok(
    purged.error || purged.data.length === 0,
    'Retained versions are never deleted',
  );
  // Posting-key replay compares against the original submission after an edit.
  const replayed = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung để sửa',
    p_key: '54000000-0000-4000-8000-000000000001',
  });
  assert.equal(replayed.error, null, 'The original posting key still recovers');
  assert.equal(replayed.data.id, id);
  assert.equal(
    replayed.data.body,
    'Nội dung đã sửa\nGiữ dấu — và dòng.',
    'Recovery reports the current committed text',
  );
  assert.ok(!Number.isNaN(new Date(replayed.data.edited_at).getTime()));
  const conflicting = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Nội dung đã sửa\nGiữ dấu — và dòng.',
    p_key: '54000000-0000-4000-8000-000000000001',
  });
  assert.equal(
    conflicting.error?.code,
    '23505',
    'The latest edited text is not the retained original submission',
  );
  observed(
    'author edit retains versions, refuses stale/no-op and keeps posting-key replay on the original',
    {
      stale: stale.error?.code,
      noOp: noop.error?.code,
      versions: reviewerRows.data.length,
      replay: replayed.data.id === id,
    },
  );
}

// --------------------------------------------------------- reviewer history journey
const authorHistoryEvidence = await reviewer
  .from('property_comment_removals')
  .select('comment_id,body,removal_kind,removal_reason,removed_by,removed_actor_name')
  .eq('property_id', discussion.id)
  .eq('body', viBody.trim())
  .eq('removal_kind', 'author')
  .single();
assert.equal(authorHistoryEvidence.error, null, 'Author withdrawal evidence is available');
const authorHistoryExpected = await reviewer.rpc('list_property_comment_history', {
  p_property_id: discussion.id,
  p_comment_id: authorHistoryEvidence.data.comment_id,
});
assert.equal(authorHistoryExpected.error, null, 'Author withdrawal history is readable');
assert.deepEqual(
  authorHistoryExpected.data.map((event) => [event.event_kind, event.removal_kind, event.reason]),
  [
    ['posting', null, null],
    ['removal', 'author', null],
  ],
  'Author withdrawal history has no moderation reason',
);
const moderationHistoryEvidence = await reviewer
  .from('property_comment_removals')
  .select('comment_id,body,removal_kind,removal_reason,removed_by,removed_actor_name')
  .eq('property_id', second.id)
  .eq('body', 'Nội dung cần gỡ để kiểm duyệt')
  .eq('removal_kind', 'moderation')
  .single();
assert.equal(moderationHistoryEvidence.error, null, 'Moderation evidence is available');
const moderationHistoryExpected = await reviewer.rpc('list_property_comment_history', {
  p_property_id: second.id,
  p_comment_id: moderationHistoryEvidence.data.comment_id,
});
assert.equal(moderationHistoryExpected.error, null, 'Moderation history is readable');
const browserHistoryOriginal = 'Lịch sử trình duyệt nguyên bản';
const browserHistoryBodies = [browserHistoryOriginal];
const browserHistoryPosted = await alpha.rpc('post_property_comment', {
  p_property_id: second.id,
  p_body: browserHistoryOriginal,
  p_key: randomUUID(),
});
assert.equal(browserHistoryPosted.error, null, 'Browser history fixture posts');
let browserHistoryRevision = browserHistoryPosted.data.revision;
for (let version = 1; version <= 3; version++) {
  const body = `Lịch sử trình duyệt phiên ${version}`;
  const edited = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: browserHistoryPosted.data.id,
    p_revision: browserHistoryRevision,
    p_body: body,
    p_key: randomUUID(),
  });
  assert.equal(edited.error, null, `Browser history edit ${version} commits`);
  browserHistoryRevision = edited.data.revision;
  browserHistoryBodies.push(body);
}
const browserHistoryExpected = await reviewer.rpc('list_property_comment_history', {
  p_property_id: second.id,
  p_comment_id: browserHistoryPosted.data.id,
});
assert.equal(browserHistoryExpected.error, null, 'Edited browser history is readable');
assert.deepEqual(
  browserHistoryExpected.data.map((event) => event.body),
  browserHistoryBodies,
  'Browser history retains the original and every saved edit',
);
const boundedHistoryOriginal = 'Lịch sử giới hạn nguyên bản';
const boundedHistoryPosted = await alpha.rpc('post_property_comment', {
  p_property_id: second.id,
  p_body: boundedHistoryOriginal,
  p_key: randomUUID(),
});
assert.equal(boundedHistoryPosted.error, null, 'Bounded history fixture posts');
let boundedHistoryRevision = boundedHistoryPosted.data.revision;
for (let version = 1; version <= 64; version++) {
  const edited = await alpha.rpc('edit_property_comment', {
    p_property_id: second.id,
    p_comment_id: boundedHistoryPosted.data.id,
    p_revision: boundedHistoryRevision,
    p_body: `Lịch sử giới hạn phiên ${version}`,
    p_key: randomUUID(),
  });
  assert.equal(edited.error, null, `Bounded history edit ${version} commits`);
  boundedHistoryRevision = edited.data.revision;
}
const boundedHistoryExpected = await reviewer.rpc('list_property_comment_history', {
  p_property_id: second.id,
  p_comment_id: boundedHistoryPosted.data.id,
});
assert.equal(boundedHistoryExpected.error, null, 'Bounded history is readable');
assert.equal(boundedHistoryExpected.data.length, 64, 'Bounded history returns 64 events');
assert.equal(boundedHistoryExpected.data.at(-1).body, 'Lịch sử giới hạn phiên 63');
assert.equal(boundedHistoryExpected.data.at(-1).has_more, true);
const archivedInactiveHistoryId = randomUUID();
const archivedInactiveHistoryBody = 'Lịch sử của tác giả đã ngừng hoạt động';
await operatorSqlAsync(
  `insert into public.property_comments(id,property_id,author_id,author_name,body,revision,idempotency_key) values('${archivedInactiveHistoryId}','${archived.id}','${inactiveEmployee}','${names.inactive.replace(/'/g, "''")}','${archivedInactiveHistoryBody}','${randomUUID()}','${randomUUID()}')`,
);
const archivedInactiveHistoryExpected = await reviewer.rpc(
  'list_property_comment_history',
  { p_property_id: archived.id, p_comment_id: archivedInactiveHistoryId },
);
assert.equal(archivedInactiveHistoryExpected.error, null, 'Archived inactive-author history is readable');
{
  signOut(secondary);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await browserLogin('reviewer', secondary, 'vi');
  browser(['open', detail(discussion)], secondary);
  await settle(secondary);
  const before = screen(secondary);
  assert.ok(before.historyButtons > 0, 'Reviewer history controls are visible');
  openHistory(authorHistoryEvidence.data.comment_id, secondary);
  await waitUntil(
    `() => Boolean(document.querySelector('.comment-history'))`,
    secondary,
  );
  const authorHistory = screen(secondary);
  assert.deepEqual(
    authorHistory.historyDetails.map(({ body, actor, time, reason }) => [body, actor, time, reason]),
    authorHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at, event.reason]),
    'Author history shows the original text, withdrawal, actor and Vietnam times',
  );
  assert.deepEqual(
    authorHistory.historyDetails.map(({ displayedTime }) => displayedTime),
    authorHistoryExpected.data.map((event) => vietnamHistoryTime(event.occurred_at, 'vi')),
    'VI renders the retained posting and withdrawal times in Vietnam time',
  );
  assert.ok(
    authorHistory.historyDetails.every(({ timeLabel }) => timeLabel.includes('giờ Việt Nam')),
    'VI marks history times as Vietnam time',
  );
  assert.ok(
    authorHistory.historyEvents.some((event) => /Tác giả đã tự gỡ bình luận/.test(event)),
    'Author withdrawal has a distinct history label',
  );
  assert.equal(
    authorHistory.historyDetails.at(-1).reason,
    null,
    'Author withdrawal has no moderation reason',
  );
  switchLocale('en', secondary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Property discussion'`,
    secondary,
  );
  await settle(secondary);
  const authorHistoryEn = screen(secondary);
  assert.ok(
    authorHistoryEn.historyEvents.some((event) => /Author withdrew the comment/.test(event)),
    'Author withdrawal label is localized in English',
  );
  assert.deepEqual(
    authorHistoryEn.historyDetails.map(({ body, actor, time }) => [body, actor, time]),
    authorHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at]),
    'English history keeps source text, actors and instants',
  );
  assert.deepEqual(
    authorHistoryEn.historyDetails.map(({ displayedTime }) => displayedTime),
    authorHistoryExpected.data.map((event) => vietnamHistoryTime(event.occurred_at, 'en')),
    'EN renders the retained posting and withdrawal times in Vietnam time',
  );
  assert.ok(
    authorHistoryEn.historyDetails.every(({ timeLabel }) => timeLabel.includes('Vietnam time')),
    'EN marks history times as Vietnam time',
  );
  click('Hide history', secondary);
  evaluate(
    `() => {
      const original = window.fetch.bind(window);
      window.__historyFailureOnce = true;
      window.fetch = async (...args) => {
        const input = args[0];
        const options = args[1] ?? {};
        const url = typeof input === 'string' ? input : input.url;
        const method = String(options.method ?? input?.method ?? 'GET').toUpperCase();
        if (method === 'GET' && url.includes('/history') && window.__historyFailureOnce) {
          window.__historyFailureOnce = false;
          return new Response(JSON.stringify({ error: 'unavailable' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        window.fetch = original;
        return original(...args);
      };
      return true;
    }`,
    secondary,
  );
  openHistory(authorHistoryEvidence.data.comment_id, secondary);
  await waitUntil(
    `() => Boolean(document.querySelector('.comment-history-error'))`,
    secondary,
  );
  const failedHistory = screen(secondary);
  assert.ok(failedHistory.historyError, 'History failure is visible and retryable');
  assert.equal(failedHistory.historyDetails.length, 0, 'Failed history is not rendered as empty success');
  click('Retry', secondary);
  await waitUntil(
    `() => document.querySelectorAll('.comment-history li').length === ${authorHistoryExpected.data.length}`,
    secondary,
  );
  const retriedHistory = screen(secondary);
  assert.equal(retriedHistory.historyError, null, 'History retry clears the failure');
  assert.deepEqual(
    retriedHistory.historyDetails.map(({ body, actor, time }) => [body, actor, time]),
    authorHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at]),
    'History retry restores the retained events',
  );
  click('Hide history', secondary);
  switchLocale('vi', secondary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Thảo luận bất động sản'`,
    secondary,
  );
  await settle(secondary);
  openHistory(browserHistoryPosted.data.id, secondary);
  await waitUntil(
    `() => document.querySelectorAll('.comment-history li').length === ${browserHistoryExpected.data.length}`,
    secondary,
  );
  const editedHistory = screen(secondary);
  assert.deepEqual(
    editedHistory.historyDetails.map(({ body, actor, time, reason }) => [body, actor, time, reason]),
    browserHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at, event.reason]),
    'Every saved edit, actor and Vietnam edit time is rendered',
  );
  assert.deepEqual(
    editedHistory.historyDetails.map(({ displayedTime }) => displayedTime),
    browserHistoryExpected.data.map((event) => vietnamHistoryTime(event.occurred_at, 'vi')),
    'VI renders every saved edit time in Vietnam time',
  );
  assert.ok(
    editedHistory.historyDetails.every(({ timeLabel }) => timeLabel.includes('giờ Việt Nam')),
    'VI marks every edit time as Vietnam time',
  );
  assert.deepEqual(
    editedHistory.historyDetails.map(({ body }) => body),
    browserHistoryBodies,
    'The original and every saved edit remain in chronological order',
  );
  click('Làm mới', secondary);
  await waitUntil(
    `() => !document.querySelector('.comment-history')`,
    secondary,
  );
  assert.equal(screen(secondary).historyDetails.length, 0, 'Refresh invalidates loaded history');
  openHistory(boundedHistoryPosted.data.id, secondary);
  await waitUntil(
    `() => document.querySelectorAll('.comment-history li').length === 64`,
    secondary,
  );
  const boundedHistory = screen(secondary);
  assert.equal(boundedHistory.historyMore, true, 'The 64-event history window reports more history');
  assert.equal(
    boundedHistory.historyMoreText,
    'Cửa sổ này giữ 64 sự kiện cũ nhất; các sự kiện mới hơn chưa hiển thị.',
    'VI identifies the retained oldest window and omitted newer events',
  );
  assert.deepEqual(
    boundedHistory.historyDetails.map(({ body, actor, time }) => [body, actor, time]),
    boundedHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at]),
    'The bounded window keeps the oldest events and their actors and times',
  );
  assert.equal(boundedHistory.historyDetails[0].body, boundedHistoryOriginal);
  assert.equal(boundedHistory.historyDetails.at(-1).body, 'Lịch sử giới hạn phiên 63');
  assert.equal(
    boundedHistory.historyDetails.some(({ body }) => body === 'Lịch sử giới hạn phiên 64'),
    false,
    'The omitted newer event is not rendered as if complete',
  );
  switchLocale('en', secondary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Property discussion'`,
    secondary,
  );
  await settle(secondary);
  const boundedHistoryEn = screen(secondary);
  assert.equal(boundedHistoryEn.historyMore, true, 'The bounded notice is localized in English');
  assert.equal(
    boundedHistoryEn.historyMoreText,
    'This window keeps the 64 oldest events; newer events are not shown here.',
    'EN identifies the retained oldest window and omitted newer events',
  );
  assert.deepEqual(
    boundedHistoryEn.historyDetails.map(({ displayedTime }) => displayedTime),
    boundedHistoryExpected.data.map((event) => vietnamHistoryTime(event.occurred_at, 'en')),
    'EN renders bounded history times in Vietnam time',
  );
  assert.ok(
    boundedHistoryEn.historyDetails.every(({ timeLabel }) => timeLabel.includes('Vietnam time')),
    'EN marks bounded history times as Vietnam time',
  );
  assert.ok(
    boundedHistoryEn.historyEvents.some((event) => /Comment edited/.test(event)),
    'English event labels remain visible in the bounded history',
  );
  assert.deepEqual(
    boundedHistoryEn.historyDetails.map(({ body }) => body),
    boundedHistory.historyDetails.map(({ body }) => body),
    'VI to EN preserves bounded source text',
  );
  switchLocale('vi', secondary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Thảo luận bất động sản'`,
    secondary,
  );
  await settle(secondary);
  click('Ẩn lịch sử', secondary);
  browser(['open', detail(second)], secondary);
  await settle(secondary);
  openHistory(moderationHistoryEvidence.data.comment_id, secondary);
  await waitUntil(
    `() => document.querySelectorAll('.comment-history li').length === ${moderationHistoryExpected.data.length}`,
    secondary,
  );
  const moderationHistory = screen(secondary);
  assert.deepEqual(
    moderationHistory.historyDetails.map(({ body, actor, time, reason }) => [body, actor, time, reason]),
    moderationHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at, event.reason]),
    'Moderated history shows the acting and moderating identities, reason and times',
  );
  assert.ok(
    moderationHistory.historyEvents.some((event) => /Đã gỡ do kiểm duyệt/.test(event)),
    'Moderated removal has a distinct Vietnamese history label',
  );
  assert.ok(
    moderationHistory.historyEvents.some((event) => /Lý do kiểm duyệt/.test(event)),
    'Moderation reason is visible to the reviewer',
  );
  assert.deepEqual(
    moderationHistory.historyDetails.map(({ displayedTime }) => displayedTime),
    moderationHistoryExpected.data.map((event) => vietnamHistoryTime(event.occurred_at, 'vi')),
    'VI renders moderation and posting times in Vietnam time',
  );
  assert.ok(
    moderationHistory.historyDetails.every(({ timeLabel }) => timeLabel.includes('giờ Việt Nam')),
    'VI marks moderation times as Vietnam time',
  );
  switchLocale('en', secondary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Property discussion'`,
    secondary,
  );
  await settle(secondary);
  const moderationHistoryEn = screen(secondary);
  assert.ok(
    moderationHistoryEn.historyEvents.some((event) => /Removed by moderation/.test(event)),
    'Moderated removal has a distinct English history label',
  );
  assert.ok(
    moderationHistoryEn.historyEvents.some((event) => /Moderation reason/.test(event)),
    'English moderation reason is visible to the reviewer',
  );
  assert.deepEqual(
    moderationHistoryEn.historyDetails.map(({ displayedTime }) => displayedTime),
    moderationHistoryExpected.data.map((event) => vietnamHistoryTime(event.occurred_at, 'en')),
    'EN renders moderation and posting times in Vietnam time',
  );
  assert.ok(
    moderationHistoryEn.historyDetails.every(({ timeLabel }) => timeLabel.includes('Vietnam time')),
    'EN marks moderation times as Vietnam time',
  );
  switchLocale('vi', secondary);
  await waitUntil(
    `() => document.querySelector('section.discussion h2')?.textContent === 'Thảo luận bất động sản'`,
    secondary,
  );
  await settle(secondary);
  browser(['open', detail(archived)], secondary);
  await settle(secondary);
  const archivedPage = screen(secondary);
  assert.equal(
    archivedPage.comments.find((comment) => comment.id === archivedInactiveHistoryId)?.author,
    names.inactive,
    'Reviewer sees retained attribution from an inactive author on an archived Property',
  );
  openHistory(archivedInactiveHistoryId, secondary);
  await waitUntil(
    `() => document.querySelectorAll('.comment-history li').length === ${archivedInactiveHistoryExpected.data.length}`,
    secondary,
  );
  const archivedInactiveHistory = screen(secondary);
  assert.deepEqual(
    archivedInactiveHistory.historyDetails.map(({ body, actor, time }) => [body, actor, time]),
    archivedInactiveHistoryExpected.data.map((event) => [event.body, event.actor_name, event.occurred_at]),
    'Archived history keeps inactive-author text, attribution and Vietnam posting time',
  );
  setReviewerRole('sales');
  evaluate(`() => { window.dispatchEvent(new Event('focus')); return true; }`, secondary);
  await waitUntil(
    `() => location.pathname === '/access-denied'`,
    secondary,
    30,
  );
  const denied = screen(secondary);
  assert.equal(denied.historyEvents.length, 0, 'Role loss clears history');
  assert.equal(denied.historyDetails.length, 0, 'Role loss clears structured history');
  assert.equal(denied.hasDiscussionText, false, 'Role loss leaves no cached discussion');
  setReviewerRole(reviewerRole);
  observed('reviewer history covers bilingual events, bounded windows, retry, archived attribution and role loss', {
    editedEvents: editedHistory.historyDetails.length,
    boundedEvents: boundedHistory.historyDetails.length,
    boundedHasMore: boundedHistory.historyMore,
    roleChangePath: denied.path,
  });
}

// --------------------------------------------------------- post and archive race
// The holder takes the parent Property row lock and only then records its marker, so the
// marker is proof the lock is held; the competing requests are dispatched inside that window.
function holdPropertyLock(propertyId, seconds, markerKey) {
  return spawn(
    'npx',
    [
      'supabase',
      'db',
      'query',
      '--db-url',
      operator.dbUrl,
      `with locked as (select id from public.properties where id='${propertyId}' for update),
       marker as (insert into public.activity_events(employee_id,property_id,kind,idempotency_key)
         select '${alphaEmployee}'::uuid,'${propertyId}'::uuid,'page_view','${markerKey}'::uuid from locked returning id)
       select pg_sleep(${seconds}) from marker`,
    ],
    { encoding: 'utf8', stdio: 'ignore' },
  );
}
async function commentCount(propertyId) {
  const rows = await operatorSqlAsync(
    `select count(*)::int as n from public.property_comments where property_id = '${propertyId}'`,
  );
  return Number(rows[0]?.n ?? 0);
}
async function removalCount(commentId) {
  const rows = await operatorSqlAsync(
    `select count(*)::int as n from public.property_comment_removals where comment_id = '${commentId}'`,
  );
  return Number(rows[0]?.n ?? 0);
}
async function editVersionCount(commentId) {
  const rows = await operatorSqlAsync(
    `select count(*)::int as n from public.property_comment_edits where comment_id = '${commentId}'`,
  );
  return Number(rows[0]?.n ?? 0);
}
async function commentState(commentId) {
  const rows = await operatorSqlAsync(
    `select body, removed_at, edited_at, revision from public.property_comments where id = '${commentId}'`,
  );
  return rows[0] ?? {};
}
async function isArchived(propertyId) {
  const rows = await operatorSqlAsync(
    `select archived_at is not null as archived from public.properties where id = '${propertyId}'`,
  );
  return Boolean(rows[0]?.archived);
}
async function resetRaceProperty(propertyId) {
  // Fixture-only operator reset of the declared synthetic row, including its own synthetic
  // comments and removal evidence, in one transaction (the immutability triggers guard
  // client writes).
  await operatorSqlAsync(
    `do $$
     begin
       execute 'alter table public.property_comments disable trigger comment_original';
       execute 'alter table public.property_comment_removals disable trigger comment_removal_guard';
       execute 'alter table public.property_comment_edits disable trigger comment_edit_guard';
       delete from public.property_comment_removals where property_id = '${propertyId}';
       delete from public.property_comment_edits where property_id = '${propertyId}';
       delete from public.property_comments where property_id = '${propertyId}';
       execute 'alter table public.property_comments enable trigger comment_original';
       execute 'alter table public.property_comment_removals enable trigger comment_removal_guard';
       execute 'alter table public.property_comment_edits enable trigger comment_edit_guard';
       update public.properties set archived_at = null where id = '${propertyId}';
     end $$;`,
  );
  assert.equal(await commentCount(propertyId), 0, 'Race fixture reset');
  assert.equal(
    await isArchived(propertyId),
    false,
    'Race fixture is unarchived',
  );
}
async function archiveRevision(client, propertyId) {
  const revision = await client
    .from('properties')
    .select('revision')
    .eq('id', propertyId)
    .single();
  assert.equal(revision.error, null, 'Property revision is readable');
  return revision.data.revision;
}
// The revision is read beforehand so the archive RPC request itself reaches the database
// immediately when it is dispatched. Archiving alone is not a recorded history field.
function archive(client, propertyId, revision) {
  return client.rpc('maintain_property', {
    p_property_id: propertyId,
    p_target: 'property',
    p_target_id: propertyId,
    p_expected_revision: revision,
    p_changes: { archived_at: new Date().toISOString() },
    p_property_revision: revision,
  });
}
async function attempt(propertyId, key, body) {
  return alpha.rpc('post_property_comment', {
    p_property_id: propertyId,
    p_body: body,
    p_key: key,
  });
}
async function markerCount(markerKey) {
  const rows = await operatorSqlAsync(
    `select count(*)::int as n from public.activity_events where idempotency_key = '${markerKey}'`,
  );
  return Number(rows[0]?.n ?? 0);
}
async function waitForMarker(markerKey) {
  for (let attempt = 0; attempt < 6; attempt++) {
    if ((await markerCount(markerKey)) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}
// The archive/comment commit ordering is not observable after the price-only history change, so
// this evidence keeps only durable outcomes and post-archive retry behavior.
async function raceEvidence(propertyId) {
  const rows = await operatorSqlAsync(
    `select (select count(*)::int from public.property_comments where property_id = '${propertyId}') as comments`,
  );
  const row = rows[0] ?? {};
  return { comments: Number(row.comments ?? 0) };
}
// One round: the parent Property row is held, then both real sessions compete for it. The two
// requests serialize on that row, but this harness does not expose which one committed first.
async function runRaceRound(round) {
  await resetRaceProperty(race.id);
  const revision = await archiveRevision(reviewer, race.id);
  const markerKey = randomUUID();
  // Short hold: both requests must queue and still finish inside the 8s authenticated
  // statement timeout.
  const holder = holdPropertyLock(race.id, 5, markerKey);
  assert.ok(
    await waitForMarker(markerKey),
    'The holder records its marker only after locking the parent property',
  );
  const [posted, archivedResult] = await Promise.all([
    Promise.resolve(
      attempt(
        race.id,
        `52000000-0000-4000-8000-0000000000e${round}`,
        `Đua số ${round}`,
      ),
    ),
    Promise.resolve(archive(reviewer, race.id, revision)),
  ]);
  await waitForExit(holder);
  assert.equal(archivedResult.error, null, 'The competing archive commits');
  const evidence = await raceEvidence(race.id);
  assert.equal(
    await isArchived(race.id),
    true,
    'The property is archived after the round',
  );
  assert.ok(evidence.comments <= 1, 'A race never leaves a duplicate comment');
  if (posted.error) {
    assert.equal(
      posted.error.code,
      '42501',
      'A losing post is denied as archived',
    );
    assert.equal(evidence.comments, 0, 'A denied post committed no comment');
  } else {
    assert.equal(
      evidence.comments,
      1,
      'The winning post left exactly one comment',
    );
    const lateRetry = await attempt(
      race.id,
      `52000000-0000-4000-8000-0000000000e${round}`,
      `Đua số ${round}`,
    );
    assert.equal(
      lateRetry.error?.code,
      '42501',
      'Recovery cannot bypass the archive',
    );
  }
  return posted.error ? 'denied' : 'posted';
}
{
  const outcomes = { posted: 0, denied: 0 };
  for (let round = 0; round < 4; round++) {
    outcomes[await runRaceRound(round)]++;
  }
  assert.ok(
    outcomes.posted + outcomes.denied === 4,
    'Every round produced one of the two legal serializations',
  );
  observed(
    'held parent lock: competing post and archive serialize with the state rechecked',
    {
      rounds: 4,
      ...outcomes,
    },
  );
}

// --------------------------------------------------- removal and archive race
// The same held parent lock serializes a removal against an archive. Author removal is legal
// only while unarchived; reasoned moderation stays legal on the archived Property.
{
  const authorOutcomes = { removed: 0, denied: 0 };
  for (let round = 0; round < 3; round++) {
    await resetRaceProperty(race.id);
    const posted = await attempt(
      race.id,
      `53000000-0000-4000-8000-0000000001${round}0`,
      `Đua gỡ ${round}`,
    );
    assert.equal(posted.error, null, 'The race comment posts before archiving');
    const revision = await archiveRevision(reviewer, race.id);
    const markerKey = randomUUID();
    const holder = holdPropertyLock(race.id, 5, markerKey);
    assert.ok(
      await waitForMarker(markerKey),
      'The holder records its marker before releasing the parent lock',
    );
    const [removal, archivedResult] = await Promise.all([
      Promise.resolve(
        alpha.rpc('remove_property_comment', {
          p_property_id: race.id,
          p_comment_id: posted.data.id,
          p_revision: posted.data.revision,
          p_kind: 'author',
        }),
      ),
      Promise.resolve(archive(reviewer, race.id, revision)),
    ]);
    await waitForExit(holder);
    assert.equal(archivedResult.error, null, 'The competing archive commits');
    assert.equal(await isArchived(race.id), true, 'The property ends archived');
    if (removal.error) {
      assert.equal(
        removal.error.code,
        '42501',
        'A losing author removal is denied as archived',
      );
      assert.equal(
        await removalCount(posted.data.id),
        0,
        'A denied removal retains no evidence row',
      );
      authorOutcomes.denied++;
    } else {
      assert.equal(
        await removalCount(posted.data.id),
        1,
        'A winning removal retains exactly one evidence row',
      );
      authorOutcomes.removed++;
    }
  }
  observed(
    'held parent lock: competing author removal and archive serialize with the exception honoured',
    { rounds: 3, ...authorOutcomes },
  );
}
{
  // Reasoned moderation remains legal on the archived Property regardless of the ordering.
  await resetRaceProperty(race.id);
  const posted = await attempt(
    race.id,
    '53000000-0000-4000-8000-000000000200',
    'Đua gỡ kiểm duyệt',
  );
  assert.equal(posted.error, null, 'The moderation race comment posts');
  const revision = await archiveRevision(reviewer, race.id);
  const markerKey = randomUUID();
  const holder = holdPropertyLock(race.id, 5, markerKey);
  assert.ok(await waitForMarker(markerKey), 'The holder records its marker');
  const [moderation, archivedResult] = await Promise.all([
    Promise.resolve(
      reviewer.rpc('remove_property_comment', {
        p_property_id: race.id,
        p_comment_id: posted.data.id,
        p_revision: posted.data.revision,
        p_kind: 'moderation',
        p_reason: 'Gỡ nội dung nhạy cảm sau lưu trữ',
      }),
    ),
    Promise.resolve(archive(reviewer, race.id, revision)),
  ]);
  await waitForExit(holder);
  assert.equal(archivedResult.error, null, 'The competing archive commits');
  assert.equal(
    moderation.error,
    null,
    'Reasoned moderation succeeds whichever side holds the lock first',
  );
  assert.equal(await isArchived(race.id), true, 'The property ends archived');
  assert.equal(
    await removalCount(posted.data.id),
    1,
    'The archived moderation retains exactly one evidence row',
  );
  const evidence = await reviewer
    .from('property_comment_removals')
    .select('body,removal_kind,removal_reason')
    .eq('comment_id', posted.data.id)
    .single();
  assert.equal(evidence.error, null, 'The archived moderation is retained');
  assert.equal(evidence.data.body, 'Đua gỡ kiểm duyệt');
  assert.equal(evidence.data.removal_kind, 'moderation');
  assert.equal(
    evidence.data.removal_reason,
    'Gỡ nội dung nhạy cảm sau lưu trữ',
    'The archived moderation reason is retained',
  );
  observed(
    'archived moderation survives an archive/removal race with one retained record',
    { committed: 1, records: 1 },
  );
}

// ------------------------------------------------------- edit and edit race
// Two independent real sessions of the same author submit against one revision. They serialize
// on the parent Property row, so exactly one edit commits and one retained version exists.
{
  await resetRaceProperty(race.id);
  const posted = await attempt(
    race.id,
    '54000000-0000-4000-8000-000000000010',
    'Đua sửa nội dung',
  );
  assert.equal(posted.error, null, 'The edit race comment posts');
  const firstSession = await userClient('alpha');
  const secondSession = await userClient('alpha');
  const [firstAttempt, secondAttempt] = await Promise.all([
    firstSession.rpc('edit_property_comment', {
      p_property_id: race.id,
      p_comment_id: posted.data.id,
      p_revision: posted.data.revision,
      p_body: 'Phiên sửa thứ nhất',
      p_key: randomUUID(),
    }),
    secondSession.rpc('edit_property_comment', {
      p_property_id: race.id,
      p_comment_id: posted.data.id,
      p_revision: posted.data.revision,
      p_body: 'Phiên sửa thứ hai',
      p_key: randomUUID(),
    }),
  ]);
  const committed = [firstAttempt, secondAttempt].filter(
    (result) => !result.error,
  ).length;
  const refused = [firstAttempt, secondAttempt]
    .filter((result) => result.error)
    .map((result) => result.error.code);
  assert.equal(committed, 1, 'Exactly one competing edit commits');
  assert.ok(
    refused.every((code) => code === 'PT409'),
    'The losing edit is refused as stale',
  );
  const state = await commentState(posted.data.id);
  assert.ok(
    ['Phiên sửa thứ nhất', 'Phiên sửa thứ hai'].includes(state.body),
    'The committed edit is one of the two submitted texts',
  );
  assert.equal(
    await editVersionCount(posted.data.id),
    1,
    'One accepted edit retains exactly one version',
  );
  observed(
    'competing author sessions serialize into one edit and one retained version',
    { committed, refused: refused.join(','), versions: 1 },
  );
}

// ---------------------------------------------------- edit and archive race
// The held parent lock serializes an author edit against an archive. An edit is legal only while
// unarchived, so a losing edit is denied without leaving text or a version behind.
{
  const outcomes = { edited: 0, denied: 0 };
  for (let round = 0; round < 3; round++) {
    await resetRaceProperty(race.id);
    const posted = await attempt(
      race.id,
      `54000000-0000-4000-8000-00000000002${round}`,
      `Đua sửa lưu trữ ${round}`,
    );
    assert.equal(posted.error, null, 'The edit/archive race comment posts');
    const revision = await archiveRevision(reviewer, race.id);
    const markerKey = randomUUID();
    const holder = holdPropertyLock(race.id, 5, markerKey);
    assert.ok(
      await waitForMarker(markerKey),
      'The holder records its marker before releasing the parent lock',
    );
    const [editResult, archivedResult] = await Promise.all([
      Promise.resolve(
        alpha.rpc('edit_property_comment', {
          p_property_id: race.id,
          p_comment_id: posted.data.id,
          p_revision: posted.data.revision,
          p_body: `Đã sửa trước lưu trữ ${round}`,
          p_key: randomUUID(),
        }),
      ),
      Promise.resolve(archive(reviewer, race.id, revision)),
    ]);
    await waitForExit(holder);
    assert.equal(archivedResult.error, null, 'The competing archive commits');
    assert.equal(await isArchived(race.id), true, 'The property ends archived');
    const state = await commentState(posted.data.id);
    if (editResult.error) {
      assert.equal(
        editResult.error.code,
        'PT403',
        'A losing edit is denied as archived',
      );
      assert.equal(
        state.body,
        `Đua sửa lưu trữ ${round}`,
        'A denied edit leaves the original text',
      );
      assert.equal(
        await editVersionCount(posted.data.id),
        0,
        'A denied edit retains no version',
      );
      outcomes.denied++;
    } else {
      assert.equal(
        state.body,
        `Đã sửa trước lưu trữ ${round}`,
        'The winning edit committed its text',
      );
      assert.equal(
        await editVersionCount(posted.data.id),
        1,
        'The winning edit retains exactly one version',
      );
      outcomes.edited++;
    }
  }
  observed(
    'held parent lock: competing author edit and archive serialize with the archive exception honoured',
    { rounds: 3, ...outcomes },
  );
}

// ---------------------------------------------------- edit and removal race
// Edit and removal are both author transitions on the same revision. The parent lock serializes
// them into exactly one accepted transition with exactly one retained record.
let lastEditRemovalRaceCommentId = null;
let lastEditRemovalRaceHistory = null;
{
  const outcomes = { edited: 0, removed: 0 };
  for (let round = 0; round < 3; round++) {
    await resetRaceProperty(race.id);
    const posted = await attempt(
      race.id,
      `54000000-0000-4000-8000-00000000003${round}`,
      `Đua sửa gỡ ${round}`,
    );
    assert.equal(posted.error, null, 'The edit/removal race comment posts');
    const markerKey = randomUUID();
    const holder = holdPropertyLock(race.id, 5, markerKey);
    assert.ok(
      await waitForMarker(markerKey),
      'The holder records its marker before releasing the parent lock',
    );
    const [editResult, removalResult] = await Promise.all([
      Promise.resolve(
        alpha.rpc('edit_property_comment', {
          p_property_id: race.id,
          p_comment_id: posted.data.id,
          p_revision: posted.data.revision,
          p_body: `Đã sửa khi đua ${round}`,
          p_key: randomUUID(),
        }),
      ),
      Promise.resolve(
        alpha.rpc('remove_property_comment', {
          p_property_id: race.id,
          p_comment_id: posted.data.id,
          p_revision: posted.data.revision,
          p_kind: 'author',
        }),
      ),
    ]);
    await waitForExit(holder);
    const committed = [editResult, removalResult].filter(
      (result) => !result.error,
    ).length;
    const refused = [editResult, removalResult]
      .filter((result) => result.error)
      .map((result) => result.error.code);
    assert.equal(committed, 1, 'Exactly one competing transition commits');
    assert.ok(
      refused.every((code) => code === 'PT409'),
      'The losing transition is refused as stale',
    );
    const state = await commentState(posted.data.id);
    if (!editResult.error) {
      assert.equal(state.body, `Đã sửa khi đua ${round}`);
      assert.equal(await editVersionCount(posted.data.id), 1);
      assert.equal(await removalCount(posted.data.id), 0);
      outcomes.edited++;
    } else {
      assert.equal(state.body, null);
      assert.equal(state.removed_at !== null, true);
      assert.equal(await removalCount(posted.data.id), 1);
      assert.equal(await editVersionCount(posted.data.id), 0);
      outcomes.removed++;
    }
    const raceHistory = await reviewer.rpc('list_property_comment_history', {
      p_property_id: race.id,
      p_comment_id: posted.data.id,
    });
    assert.equal(raceHistory.error, null, 'Race history remains readable to the reviewer');
    assert.equal(raceHistory.data.length, 2, 'Race history has posting and one committed transition');
    assert.deepEqual(
      raceHistory.data.map((event) => event.event_kind),
      ['posting', editResult.error ? 'removal' : 'edit'],
      'Race history matches the serialized committed outcome',
    );
    lastEditRemovalRaceCommentId = posted.data.id;
    lastEditRemovalRaceHistory = raceHistory.data;
  }
  observed(
    'held parent lock: competing author edit and removal serialize into exactly one transition',
    { rounds: 3, ...outcomes },
  );
}
{
  await browserLogin('reviewer', secondary, 'vi');
  browser(['open', detail(race)], secondary);
  await settle(secondary);
  openHistory(lastEditRemovalRaceCommentId, secondary);
  await waitUntil(
    `() => document.querySelectorAll('.comment-history li').length === ${lastEditRemovalRaceHistory.length}`,
    secondary,
  );
  const raceHistoryPage = screen(secondary);
  assert.deepEqual(
    raceHistoryPage.historyDetails.map(({ body, actor, time, reason }) => [body, actor, time, reason]),
    lastEditRemovalRaceHistory.map((event) => [event.body, event.actor_name, event.occurred_at, event.reason]),
    'Browser history matches the edit/removal race outcome',
  );
  observed('browser history reflects the serialized edit/removal race outcome', {
    events: raceHistoryPage.historyDetails.length,
    commentId: lastEditRemovalRaceCommentId,
  });
}

const report = {
  checkedAt: new Date().toISOString(),
  environment:
    'authorized hosted development Supabase / local real Next.js application',
  projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
  applicationHead,
  namespace: fixtures.namespace,
  observations,
  limits: [
    `Fixture-only writes: the ${fixtures.namespace} namespace is created and removed by this task.`,
    'The held-lock race uses the operator connection to hold the parent property row; it does not replace a staging gate for production contention.',
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
