// Issue #44 hosted acceptance: shared Property discussion.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and
// real Chrome sessions. Mock, shim and readiness-page results are not acceptance. Mutates
// only the declared SGN-TEST-44 synthetic namespace and restores the declared fixture
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
// The manifest supplies the SGN-TEST-44 identities, properties and passwords; the operator
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
assert.equal(
  fixtures.namespace,
  'SGN-TEST-44',
  'Only the declared synthetic namespace is allowed',
);
for (const name of ['alpha', 'beta', 'reviewer', 'inactive'])
  assert.equal(
    typeof fixtures.identities[name]?.employeeId,
    'string',
    'Missing declared fixture identity',
  );
assert.equal(
  typeof fixtures.unlinked?.email,
  'string',
  'Missing unlinked identity',
);
assert.ok(
  Object.values(fixtures.properties).every((property) =>
    property.code.startsWith('SGN-TEST-44-'),
  ),
  'Only declared synthetic properties are allowed',
);
const origin = environment.appUrl;
const observations = [];

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
      const discussion = document.querySelector('section.discussion');
      return {
        path: location.pathname,
        locale: document.querySelector('main')?.lang,
        code: document.querySelector('h1')?.textContent?.trim(),
        heading: discussion?.querySelector('h2')?.textContent ?? null,
        comments: [...(discussion?.querySelectorAll('.comment') ?? [])].map(node => ({
          author: node.querySelector('.comment-meta span')?.textContent ?? null,
          time: node.querySelector('time')?.dateTime ?? null,
          body: node.querySelector('.comment-body')?.textContent ?? null,
        })),
        statuses: [...(discussion?.querySelectorAll('[role=status],[role=alert]') ?? [])].map(node => node.textContent),
        empty: discussion ? discussion.innerText.includes('Chưa có bình luận nào.') || discussion.innerText.includes('No comments yet.') : null,
        more: discussion ? Boolean([...discussion.querySelectorAll('button')].find(node => /Xem bình luận cũ hơn|More comments/.test(node.textContent))) : null,
        refresh: discussion ? Boolean([...discussion.querySelectorAll('button')].find(node => /Làm mới|Refresh/.test(node.textContent))) : null,
        postButton: discussion ? Boolean([...discussion.querySelectorAll('button[type=submit]')].length) : null,
        editControls: Boolean(document.querySelector('.maintenance-actions')),
        injected: Boolean(document.querySelector('script[data-injected], img[data-injected]')),
        discussionText: discussion?.innerText ?? null,
      };
    }`,
    session,
  );
}
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
// A discussion read is settled when its controls are no longer busy (ASCII-only predicate).
const settled = `() => {
  const discussion = document.querySelector('section.discussion');
  return Boolean(discussion) && !discussion.querySelector('button[disabled]');
}`;
async function settle(session = primary) {
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

const discussion = fixtures.properties.discussion;
const paging = fixtures.properties.paging;
const archived = fixtures.properties.archived;
const race = fixtures.properties.race;
const second = fixtures.properties.second;
const detail = (property) => origin + '/properties/' + property.id;

const alpha = await userClient('alpha');
const beta = await userClient('beta');
const reviewer = await userClient('reviewer');
const alphaEmployee = fixtures.identities.alpha.employeeId;
const betaEmployee = fixtures.identities.beta.employeeId;
function setBetaActive(active) {
  operatorSql(
    `do $$ begin update public.employees set is_active=${active} where id='${betaEmployee}'; end $$;`,
  );
}
// Any failure must still return the declared fixture identity to active.
function restoreAndExit(error) {
  try {
    setBetaActive(true);
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
  assert.equal(comment.author, 'SGN44 Alpha', 'Author is shown');
  assert.ok(
    comment.time && Math.abs(Date.parse(comment.time) - Date.now()) < 300000,
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
browser(['open', detail(discussion)], primary);
await settle(primary);
{
  const before = screen(primary);
  click('English', primary);
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
  click('Tiếng Việt', primary);
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
    page.editControls,
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
    after.comments.filter((comment) => comment.author === 'SGN44 Beta').length,
    1,
    'Colleague comment is attributed to the colleague',
  );
  assert.equal(after.editControls, false, 'Still no property-edit authority');
  observed(
    'colleague posts on another employee property without edit authority',
    {
      comments: after.comments.length,
      editControls: after.editControls,
    },
  );
}
click('Đăng xuất', secondary);
browser(['open', detail(discussion)], secondary);
{
  const page = screen(secondary);
  assert.equal(
    page.path,
    '/login',
    'Protected detail is not reachable after sign-out',
  );
  assert.equal(page.discussionText, null, 'No cached discussion is displayed');
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
    page.discussionText,
    null,
    'No discussion text survives the denial',
  );
  const leaked = evaluate(
    `() => ['SGN44 Alpha', 'SGN44 Beta', 'Beta xem nhà'].some((text) => document.body.innerText.includes(text))`,
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
    'SGN44 Alpha',
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
    Math.abs(Date.parse(created.data.created_at) - Date.now()) < 300000,
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
  const archivedNow = await archive(
    reviewer,
    archived.id,
    revision,
    'SGN-TEST-44 archived fixture',
  );
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
async function isArchived(propertyId) {
  const rows = await operatorSqlAsync(
    `select archived_at is not null as archived from public.properties where id = '${propertyId}'`,
  );
  return Boolean(rows[0]?.archived);
}
async function resetRaceProperty(propertyId) {
  // Fixture-only operator reset of the declared synthetic row, including its own synthetic
  // comments, in one transaction (the immutability trigger guards client writes).
  await operatorSqlAsync(
    `do $$
     begin
       execute 'alter table public.property_comments disable trigger comment_original';
       delete from public.property_comments where property_id = '${propertyId}';
       execute 'alter table public.property_comments enable trigger comment_original';
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
// immediately when it is dispatched. The accompanying notes value is the archive's own
// server-timestamped property-history marker: archiving alone is not a history field.
function archive(client, propertyId, revision, marker) {
  return client.rpc('maintain_property', {
    p_property_id: propertyId,
    p_target: 'property',
    p_target_id: propertyId,
    p_expected_revision: revision,
    p_changes: { archived_at: new Date().toISOString(), notes: marker },
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
// Server-side ordering evidence for one round: the archive records its own update in
// property_history with clock_timestamp(), directly comparable with the comment's
// clock_timestamp posting time.
async function raceEvidence(propertyId, marker) {
  const rows = await operatorSqlAsync(
    `select
       (select count(*)::int from public.property_comments where property_id = '${propertyId}') as comments,
       (select max(created_at) from public.property_comments where property_id = '${propertyId}') as comment_at,
       (select max(occurred_at) from public.property_history
          where property_id = '${propertyId}' and after_values->>'notes' = '${marker}') as archived_at`,
  );
  const row = rows[0] ?? {};
  return {
    comments: Number(row.comments ?? 0),
    commentAt: row.comment_at ?? null,
    archivedAt: row.archived_at ?? null,
  };
}
// One round: the parent Property row is held, then both real sessions compete for it. The two
// requests serialize on that row, and the server timestamps prove which one committed first.
async function runRaceRound(round) {
  await resetRaceProperty(race.id);
  const revision = await archiveRevision(reviewer, race.id);
  const marker = `SGN44 race round ${round}`;
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
    Promise.resolve(archive(reviewer, race.id, revision, marker)),
  ]);
  await waitForExit(holder);
  assert.equal(archivedResult.error, null, 'The competing archive commits');
  const evidence = await raceEvidence(race.id, marker);
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
    assert.ok(
      evidence.archivedAt !== null,
      'The archive recorded its own update in the property history',
    );
    assert.ok(
      Date.parse(evidence.commentAt) < Date.parse(evidence.archivedAt),
      'A committed comment always precedes the archive that later closed the property',
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

const report = {
  checkedAt: new Date().toISOString(),
  environment:
    'authorized hosted development Supabase / local real Next.js application',
  projectRef: process.env.EXPECTED_SUPABASE_PROJECT_REF,
  namespace: fixtures.namespace,
  observations,
  limits: [
    'Fixture-only writes: the SGN-TEST-44 namespace is created and removed by this task.',
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
