// Issue #44 hosted acceptance: shared Property discussion.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and
// real Chrome sessions. Mock, shim and readiness-page results are not acceptance. Mutates
// only the lane's declared synthetic namespace and restores the declared fixture
// activation on every exit path.
//
// Usage:
//   SGN_ACCEPTANCE_NAMESPACE=SGN-TEST-46 \
//   SGN_ACCEPTANCE_FIXTURES=<private manifest> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi.js>] \
//   [SGN_ACCEPTANCE_BROWSER_URLS='{"session":"http://127.0.0.1:port"}'] \
//   node --env-file-if-exists=.env.local scripts/property-comments-acceptance.mjs \
//     --allow-deactivation [--report <sanitized json path>]
//
// The manifest supplies the lane's synthetic identities, properties and passwords; the operator
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
    'Real development acceptance for the shared Property discussion and the author edit. Requires SGN_ACCEPTANCE_NAMESPACE, SGN_ACCEPTANCE_FIXTURES, SGN_ACCEPTANCE_OPERATOR, a running authenticated build at the configured app URL and --allow-deactivation. Writes a sanitized report with --report.',
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
// The lane declares its own synthetic namespace explicitly, so this journey can never be
// pointed at real rows: the declared value must be a synthetic namespace, must match the
// manifest it runs with, and every fixture property must live inside it.
const namespace = process.env.SGN_ACCEPTANCE_NAMESPACE ?? '';
assert.match(
  namespace,
  /^SGN-TEST-\d+$/,
  'Provide SGN_ACCEPTANCE_NAMESPACE as the declared synthetic namespace',
);
assert.equal(
  fixtures.namespace,
  namespace,
  'The manifest namespace must match SGN_ACCEPTANCE_NAMESPACE',
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
    property.code.startsWith(namespace + '-'),
  ),
  'Only declared synthetic properties are allowed',
);
// Display names are manifest-supplied so one harness serves any lane namespace.
const authorNames = {
  alpha: fixtures.displayNames?.alpha ?? 'SGN44 Alpha',
  beta: fixtures.displayNames?.beta ?? 'SGN44 Beta',
};
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
      const discussion = document.querySelector('#record-panel-comments');
      return {
        path: location.pathname,
        locale: document.documentElement.lang,
        code: document.querySelector('h1')?.textContent?.trim(),
        heading: discussion?.querySelector('h2')?.textContent ?? null,
        comments: [...(discussion?.querySelectorAll('.comment') ?? [])].map(node => ({
          author: node.querySelector('.comment-author')?.textContent ?? null,
          time: node.querySelector('time')?.dateTime ?? null,
          body: node.querySelector('.comment-body')?.textContent ?? null,
          meta: node.querySelector('.comment-meta')?.textContent ?? null,
          edited: /(đã chỉnh sửa|edited)/.test(node.querySelector('.comment-meta')?.textContent ?? ''),
          editing: Boolean(node.querySelector('textarea[name=comment-edit]')),
          canEdit: [...node.querySelectorAll('button')].some(button => /Sửa bình luận|Edit comment/.test(button.textContent)),
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
  const discussion = document.querySelector('#record-panel-comments');
  return Boolean(discussion) && !discussion.querySelector('button[disabled]');
}`;
async function settle(session = primary) {
  await waitUntil(settled, session);
  await new Promise((resolve) => setTimeout(resolve, 600));
  await waitUntil(settled, session);
}
// The record page groups facts, documents and the discussion into tabs, and only the visible
// tabpanel renders its text, so the journey selects the discussion tab after every fresh load.
function openCommentsTab(session = primary) {
  evaluate(
    `() => {
      const tab = document.getElementById('record-tab-comments');
      if (tab) tab.click();
      return Boolean(tab);
    }`,
    session,
  );
}
async function openDiscussion(property, session = primary) {
  browser(['open', detail(property)], session);
  openCommentsTab(session);
  await settle(session);
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
        const button = document.querySelector('.sgn-auth .lang-btn[lang="${preferredLocale}"]');
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
  click(locale === 'en' ? 'Login' : 'Đăng nhập', session);
  await waitUntil(
    `() => Boolean(document.querySelector('.sgn-user-btn'))`,
    session,
    60,
  );
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
await openDiscussion(discussion, primary);
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
  `() => document.querySelectorAll('#record-panel-comments .comment').length === 1`,
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
  assert.equal(comment.author, authorNames.alpha, 'Author is shown');
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
  `() => document.querySelectorAll('#record-panel-comments .comment').length === 2`,
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
  `() => document.querySelectorAll('#record-panel-comments .comment').length === 2`,
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
await openDiscussion(paging, primary);
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
    `() => document.querySelectorAll('#record-panel-comments .comment').length === 35`,
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
await openDiscussion(discussion, primary);
{
  const before = screen(primary);
  evaluate(
    `() => {
      const button = document.querySelector('.lang-btn[lang="en"]');
      if (button) button.click();
      return Boolean(button);
    }`,
    primary,
  );
  await waitUntil(
    `() => document.documentElement.lang === 'en' && document.querySelector('#record-panel-comments h2')?.textContent === 'Property discussion'`,
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
  evaluate(
    `() => {
      const button = document.querySelector('.lang-btn[lang="vi"]');
      if (button) button.click();
      return Boolean(button);
    }`,
    primary,
  );
  await waitUntil(
    `() => document.documentElement.lang === 'vi' && document.querySelector('#record-panel-comments h2')?.textContent === 'Thảo luận bất động sản'`,
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
// ------------------------------------------------------ ticket #46 author edit
function appSession(name) {
  const session = new ApplicationSession();
  return session.login(name).then((login) => {
    assert.equal(login.status, 200, 'Real application session login succeeded');
    return session;
  });
}
async function readComments(session, propertyId) {
  const page = await session.request(
    '/api/properties/' + propertyId + '/comments',
  );
  assert.equal(page.status, 200, 'Application discussion read succeeded');
  return page.body.comments;
}
// A targeted read of every page: the older-page conflict needs a row outside the first page.
async function readAllComments(session, propertyId) {
  const rows = [];
  let route = '/api/properties/' + propertyId + '/comments';
  for (;;) {
    const page = await session.request(route);
    assert.equal(page.status, 200, 'Application discussion read succeeded');
    rows.push(...page.body.comments);
    if (!page.body.nextCursor) return rows;
    route =
      '/api/properties/' +
      propertyId +
      '/comments?' +
      new URLSearchParams(page.body.nextCursor);
  }
}
// An expression locating the comment whose current text is `body` in the rendered discussion.
function commentNode(body) {
  return `[...document.querySelectorAll('#record-panel-comments .comment')].find((node) => node.querySelector('.comment-body')?.textContent === ${JSON.stringify(body)})`;
}
function openEditor(body, session = primary) {
  evaluate(
    `() => {
      const node = ${commentNode(body)};
      const button = [...node.querySelectorAll('button')].find((candidate) => /Sửa bình luận|Edit comment/.test(candidate.textContent));
      button.click();
      return true;
    }`,
    session,
  );
}
const editOpen = `() => Boolean(document.querySelector('#record-panel-comments textarea[name=comment-edit]'))`;
const editedBody = 'Chào anh,\nGiá 12 tỷ — đã chốt sau khi xem nhà.';
{
  const original = viBody.trim();
  const before = screen(primary);
  const mine = before.comments.find((comment) => comment.body === original);
  assert.ok(mine, 'The author comment is displayed');
  assert.equal(
    mine.canEdit,
    true,
    'The author sees an edit control on their own comment',
  );
  assert.equal(mine.edited, false, 'A new comment carries no edited marker');
  assert.equal(
    before.comments.every(
      (comment) => !comment.canEdit || comment.author === authorNames.alpha,
    ),
    true,
    'No edit control appears on another author comment',
  );
  openEditor(original, primary);
  await waitUntil(editOpen, primary);
  fill('Sửa bình luận', editedBody, primary);
  click('Lưu bình luận', primary);
  await waitUntil(`() => Boolean(${commentNode(editedBody)})`, primary);
  await settle(primary);
  const after = screen(primary);
  const updated = after.comments.find((comment) => comment.body === editedBody);
  assert.ok(updated, 'The corrected text is shown in the discussion');
  assert.equal(updated.author, authorNames.alpha, 'The author is unchanged');
  assert.equal(
    updated.time,
    mine.time,
    'The original posting time and position are unchanged',
  );
  assert.equal(updated.edited, true, 'The reader sees an edited marker');
  assert.equal(
    after.comments.some((comment) => comment.body === original),
    false,
    'The discussion shows the current text, not the preceding version',
  );
  assert.equal(
    after.comments.length,
    before.comments.length,
    'The edit is not presented as a newly posted comment',
  );
  assert.ok(
    after.statuses.some((status) => /Đã cập nhật bình luận/.test(status)),
    'The update is reported',
  );
  observed(
    'the author corrects their own comment and readers see the edited marker',
    {
      author: updated.author,
      edited: updated.edited,
      marker: updated.meta,
      comments: after.comments.length,
      postedAt: updated.time,
    },
  );
}
{
  // A second real author session advances the revision while this editor still holds the old
  // one, so the browser save is genuinely stale and must not silently overwrite it.
  const peer = await appSession('alpha');
  const current = (await readComments(peer, discussion.id)).find(
    (row) => row.body === editedBody,
  );
  assert.ok(current, 'The peer session reads the edited comment');
  const peerBody = 'Bản sửa từ phiên khác';
  const peerEdit = await peer.request(
    '/api/properties/' + discussion.id + '/comments/' + current.id,
    { body: peerBody, revision: current.revision },
  );
  assert.equal(peerEdit.status, 200, 'The peer session saves first');
  openEditor(editedBody, primary);
  await waitUntil(editOpen, primary);
  click('Lưu bình luận', primary);
  await waitUntil(
    `() => /đã được sửa ở nơi khác/.test(document.querySelector('#record-panel-comments')?.innerText ?? '')`,
    primary,
  );
  await waitUntil(
    `() => (document.querySelector('#record-panel-comments')?.innerText ?? '').includes(${JSON.stringify(peerBody)})`,
    primary,
  );
  const conflict = evaluate(
    `() => {
      const panel = document.querySelector('#record-panel-comments');
      const area = panel.querySelector('textarea[name=comment-edit]');
      const article = area?.closest('article') ?? null;
      return {
        draft: area?.value ?? null,
        current: article ? [...article.querySelectorAll('.comment-body')].map((node) => node.textContent).join(' | ') : null,
        alert: [...panel.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' '),
      };
    }`,
    primary,
  );
  assert.equal(conflict.draft, editedBody, 'The unsent draft is retained');
  assert.ok(
    conflict.current?.includes(peerBody),
    'The current saved text is presented for reconciliation',
  );
  assert.ok(
    /đã được sửa ở nơi khác/.test(conflict.alert ?? ''),
    'A localized stale error is shown',
  );
  // Reconciled deliberately: the newer text is visible, so saving again is not a silent merge.
  click('Lưu bình luận', primary);
  await waitUntil(`() => Boolean(${commentNode(editedBody)})`, primary);
  await settle(primary);
  const reconciled = screen(primary);
  assert.ok(
    reconciled.comments.some((comment) => comment.body === editedBody),
    'The reconciled draft saves',
  );
  assert.equal(
    reconciled.comments.some((comment) => comment.body === peerBody),
    false,
    'The stale draft replaced the newer text only after it was shown',
  );
  observed(
    'a stale save keeps the draft, shows current text and reconciles explicitly',
    {
      draftRetained: conflict.draft === editedBody,
      currentShown: conflict.current?.includes(peerBody) ?? false,
      reconciled: true,
    },
  );
}
{
  // The same conflict on a comment outside the refreshed first page: without the conflict
  // payload the reconciliation block could only show the row's pre-conflict text. Build a
  // deterministic multi-page discussion, let a second real session advance the older target,
  // then save stale from the browser.
  const run = randomUUID().slice(0, 8);
  const targetBody = `Mốc đối chiếu ${run}`;
  const postComment = (body) =>
    alpha.rpc('post_property_comment', {
      p_property_id: paging.id,
      p_body: body,
      p_key: randomUUID(),
    });
  assert.equal(
    (await postComment(targetBody)).error,
    null,
    'The older-page target commits',
  );
  for (let index = 1; index <= 30; index++)
    assert.equal(
      (await postComment(`Đệm đối chiếu ${run} ${index}`)).error,
      null,
      'The paging filler commits',
    );
  await openDiscussion(paging, primary);
  click('Xem bình luận cũ hơn', primary);
  await waitUntil(`() => Boolean(${commentNode(targetBody)})`, primary);
  await settle(primary);
  const loaded = screen(primary);
  const mine = loaded.comments.find((comment) => comment.body === targetBody);
  assert.ok(mine, 'The older-page target is rendered');
  assert.ok(
    loaded.comments.indexOf(mine) >= 30,
    'The target sits beyond the first page',
  );
  const peer = await appSession('alpha');
  const older = await readAllComments(peer, paging.id);
  const target = older.find((row) => row.body === targetBody);
  assert.ok(target, 'The peer session reads the older comment');
  const newerBody = `Bản sửa mới hơn ${run}`;
  const peerEdit = await peer.request(
    '/api/properties/' + paging.id + '/comments/' + target.id,
    { body: newerBody, revision: target.revision },
  );
  assert.equal(peerEdit.status, 200, 'The peer session saves the newer text');
  openEditor(mine.body, primary);
  await waitUntil(editOpen, primary);
  fill('Sửa bình luận', editedBody, primary);
  click('Lưu bình luận', primary);
  await waitUntil(
    `() => /đã được sửa ở nơi khác/.test(document.querySelector('#record-panel-comments')?.innerText ?? '')`,
    primary,
  );
  const conflict = evaluate(
    `() => {
      const panel = document.querySelector('#record-panel-comments');
      const area = panel.querySelector('textarea[name=comment-edit]');
      const article = area?.closest('article') ?? null;
      return {
        draft: area?.value ?? null,
        current: article ? [...article.querySelectorAll('.comment-body')].map((node) => node.textContent).join(' | ') : null,
        alert: [...panel.querySelectorAll('[role=alert]')].map((node) => node.textContent).join(' '),
        count: panel.querySelectorAll('.comment').length,
      };
    }`,
    primary,
  );
  assert.equal(conflict.draft, editedBody, 'The unsent draft is retained');
  assert.ok(
    conflict.current?.includes(newerBody),
    'The current saved text shown for reconciliation is the newer text',
  );
  assert.ok(
    /đã được sửa ở nơi khác/.test(conflict.alert ?? ''),
    'A localized stale error is shown',
  );
  // The editor adopted the revision from the conflict response, so the retry converges.
  click('Lưu bình luận', primary);
  await waitUntil(`() => Boolean(${commentNode(editedBody)})`, primary);
  await settle(primary);
  const reconciled = screen(primary);
  assert.ok(
    reconciled.comments.some((comment) => comment.body === editedBody),
    'The reconciled draft saves on the older page',
  );
  assert.equal(
    reconciled.comments.length,
    conflict.count,
    'The older row stays present after the conflict refresh',
  );
  observed(
    'an older-page stale save keeps the draft, shows the newer text and converges',
    {
      page: 2,
      draftRetained: conflict.draft === editedBody,
      currentShown: conflict.current?.includes(newerBody) ?? false,
      reconciled: true,
    },
  );
}
await browserLogin('beta', secondary, 'vi');
await openDiscussion(discussion, secondary);
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
    `() => document.querySelectorAll('#record-panel-comments .comment').length === 3`,
    secondary,
  );
  const after = screen(secondary);
  assert.equal(
    after.comments.filter((comment) => comment.author === authorNames.beta)
      .length,
    1,
    'Colleague comment is attributed to the colleague',
  );
  assert.equal(after.editControls, false, 'Still no property-edit authority');
  assert.equal(
    after.comments
      .filter((comment) => comment.author === authorNames.alpha)
      .every((comment) => comment.canEdit === false),
    true,
    'No edit control is offered on another author comment',
  );
  assert.equal(
    after.comments
      .filter((comment) => comment.author === authorNames.beta)
      .every((comment) => comment.canEdit === true),
    true,
    'The colleague may edit only their own comment',
  );
  observed(
    'colleague posts on another employee property without edit authority',
    {
      comments: after.comments.length,
      editControls: after.editControls,
      ownEditable: true,
    },
  );
}
evaluate(
  `() => {
    const trigger = document.querySelector('.sgn-user-btn');
    if (trigger) trigger.click();
    return Boolean(trigger);
  }`,
  secondary,
);
await waitUntil(
  `() => Boolean(document.querySelector('.sgn-popover button'))`,
  secondary,
  20,
);
evaluate(
  `() => {
    const button = document.querySelector('.sgn-popover button:not([disabled])');
    if (button) button.click();
    return Boolean(button);
  }`,
  secondary,
);
browser(['open', detail(discussion)], secondary);
await waitUntil(`() => location.pathname === '/login'`, secondary, 30);
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
await openDiscussion(discussion, secondary);
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
    `() => [${JSON.stringify(authorNames.alpha)}, ${JSON.stringify(authorNames.beta)}, 'Beta xem nhà'].some((text) => document.body.innerText.includes(text))`,
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
    authorNames.alpha,
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
  const archivedEdit = await reviewer.rpc('edit_property_comment', {
    p_comment_id: archivedInitial.data.id,
    p_body: 'Thảo luận đã sửa trước khi lưu trữ',
    p_expected_revision: archivedInitial.data.revision,
  });
  assert.equal(
    archivedEdit.error,
    null,
    'The author edits while the property is still unarchived',
  );
  const revision = await archiveRevision(reviewer, archived.id);
  const archivedNow = await archive(
    reviewer,
    archived.id,
    revision,
    `${namespace} archived fixture`,
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
  // Archival blocks the author edit for every role but never rewrites the retained evidence.
  const deniedEdit = await reviewer.rpc('edit_property_comment', {
    p_comment_id: archivedInitial.data.id,
    p_body: 'Sửa sau khi lưu trữ',
    p_expected_revision: archivedEdit.data.revision,
  });
  assert.equal(
    deniedEdit.error?.code,
    '42501',
    'Archived properties block comment edits for every role',
  );
  const retainedAfterArchive = await reviewer
    .from('property_comment_revisions')
    .select('before_body,after_body')
    .eq('comment_id', archivedInitial.data.id);
  assert.equal(
    retainedAfterArchive.error,
    null,
    'Reviewer reads retained evidence',
  );
  assert.equal(
    (retainedAfterArchive.data ?? []).length,
    1,
    'Retained evidence survives archival',
  );
  const ordinaryRetained = await beta
    .from('property_comment_revisions')
    .select('sequence')
    .eq('comment_id', archivedInitial.data.id);
  assert.ok(
    ordinaryRetained.error || (ordinaryRetained.data ?? []).length === 0,
    'Ordinary employees read no retained versions of archived discussion',
  );
  observed(
    'archived discussion is reviewer-only and posting is denied for every role',
    {
      reviewerRows: reviewerRows.data.length,
      ordinaryRows: ordinaryRows.data?.length ?? 0,
      authorEdit: deniedEdit.error?.code ?? null,
      retained: (retainedAfterArchive.data ?? []).length,
    },
  );
}
{
  // Ticket #46 direct-boundary proof: only the author may edit, every version is retained,
  // a stale revision is rejected and the original posting key still recovers the comment.
  const key = '52000000-0000-4000-8000-0000000000d1';
  const originalText = 'Bản gốc để sửa';
  const created = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: originalText,
    p_key: key,
  });
  assert.equal(created.error, null, 'Original comment commits');
  const edit = (body, revision) =>
    alpha.rpc('edit_property_comment', {
      p_comment_id: created.data.id,
      p_body: body,
      p_expected_revision: revision,
    });
  assert.equal(
    (await edit('   ', created.data.revision)).error?.code,
    '23514',
    'Blank edited text is rejected',
  );
  assert.equal(
    (await edit('y'.repeat(2001), created.data.revision)).error?.code,
    '23514',
    'Over-limit edited text is rejected',
  );
  assert.equal(
    (
      await alpha.rpc('edit_property_comment', {
        p_comment_id: created.data.id,
        p_body: 'Thiếu bản sửa',
        p_expected_revision: null,
      })
    ).error?.code,
    '23514',
    'A missing expected revision is rejected',
  );
  const firstEdit = await edit('Bản sửa lần một', created.data.revision);
  assert.equal(firstEdit.error, null, 'The author edit commits');
  assert.equal(firstEdit.data.body, 'Bản sửa lần một');
  assert.notEqual(firstEdit.data.revision, created.data.revision);
  assert.equal(
    firstEdit.data.created_at,
    created.data.created_at,
    'The original posting time is preserved',
  );
  assert.equal(
    firstEdit.data.author_id,
    alphaEmployee,
    'Author attribution is preserved',
  );
  assert.ok(firstEdit.data.edited_at, 'The edit time is recorded');
  const stale = await edit('Ghi đè cũ', created.data.revision);
  assert.equal(stale.error?.code, 'PT409', 'A stale revision is rejected');
  const currentRow = await alpha
    .from('property_comments')
    .select('body,revision,created_at')
    .eq('id', created.data.id)
    .single();
  assert.equal(
    currentRow.data.body,
    'Bản sửa lần một',
    'The stale save changed nothing',
  );
  assert.equal(currentRow.data.revision, firstEdit.data.revision);
  const secondEdit = await edit('Bản sửa lần hai', firstEdit.data.revision);
  assert.equal(secondEdit.error, null, 'A fresh revision saves again');
  // The reader page carries only the current text and the edited marker, and the ordinary
  // author cannot read preceding versions; a manager/admin with property access can.
  const readerRows = await alpha.rpc('list_property_comments', {
    p_property_id: second.id,
  });
  assert.equal(readerRows.error, null, 'The reader page loads');
  const readerRow = (readerRows.data ?? []).find(
    (row) => row.id === created.data.id,
  );
  assert.equal(readerRow.body, 'Bản sửa lần hai');
  assert.ok(readerRow.edited_at, 'The reader row carries the edited marker');
  assert.equal(
    Object.values(readerRow).some(
      (value) => typeof value === 'string' && value.includes(originalText),
    ),
    false,
    'No preceding version appears in a reader row',
  );
  const authorVersions = await alpha
    .from('property_comment_revisions')
    .select('sequence')
    .eq('comment_id', created.data.id);
  assert.ok(
    authorVersions.error || (authorVersions.data ?? []).length === 0,
    'The ordinary author reads no preceding version',
  );
  const reviewerVersions = await reviewer
    .from('property_comment_revisions')
    .select(
      'before_body,after_body,before_revision,after_revision,actor_id,actor_name,edited_at',
    )
    .eq('comment_id', created.data.id)
    .order('sequence');
  assert.equal(
    reviewerVersions.error,
    null,
    'A reviewer reads retained evidence',
  );
  assert.equal(
    (reviewerVersions.data ?? []).length,
    2,
    'Every saved version is retained',
  );
  assert.equal(
    reviewerVersions.data[0].before_body,
    originalText,
    'The original validated submission is retained',
  );
  assert.equal(reviewerVersions.data[0].after_body, 'Bản sửa lần một');
  assert.equal(
    reviewerVersions.data[0].actor_id,
    alphaEmployee,
    'The editing actor is retained',
  );
  assert.ok(reviewerVersions.data[0].edited_at, 'The edit time is retained');
  assert.equal(reviewerVersions.data[1].before_body, 'Bản sửa lần một');
  assert.equal(reviewerVersions.data[1].after_body, 'Bản sửa lần hai');
  // Property-edit authority and reviewer roles do not grant comment-edit authority.
  for (const [name, client] of [
    ['beta', beta],
    ['reviewer', reviewer],
  ]) {
    const denied = await client.rpc('edit_property_comment', {
      p_comment_id: created.data.id,
      p_body: `${name} rewrite`,
      p_expected_revision: secondEdit.data.revision,
    });
    assert.equal(
      denied.error?.code,
      '42501',
      `${name} cannot rewrite another author comment`,
    );
  }
  const forgedEdit = await alpha.rpc('edit_property_comment', {
    p_comment_id: created.data.id,
    p_body: 'forged edit',
    p_expected_revision: secondEdit.data.revision,
    p_actor_id: betaEmployee,
    p_edited_at: '2000-01-01T00:00:00Z',
  });
  assert.ok(
    forgedEdit.error,
    'Unknown parameters cannot forge the edit actor or time',
  );
  // The original posting key still recovers the comment and never reverts the edit.
  const replay = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: originalText,
    p_key: key,
  });
  assert.equal(
    replay.error,
    null,
    'The original posting key recovers the comment',
  );
  assert.equal(replay.data.id, created.data.id, 'Replay returns one identity');
  assert.equal(
    replay.data.body,
    'Bản sửa lần hai',
    'Replay never reverts the edit',
  );
  assert.equal(replay.data.revision, secondEdit.data.revision);
  const conflictingReplay = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Không phải bản gốc',
    p_key: key,
  });
  assert.equal(
    conflictingReplay.error?.code,
    '23505',
    'A replay that never matched the original submission is rejected',
  );
  // Retained evidence has no client write path and stays unchanged.
  const forgedRevision = await beta.from('property_comment_revisions').insert({
    comment_id: created.data.id,
    property_id: second.id,
    actor_id: betaEmployee,
    actor_name: 'Forged',
    before_revision: randomUUID(),
    after_revision: randomUUID(),
    before_body: 'forged',
    after_body: 'forged',
  });
  assert.ok(forgedRevision.error, 'Direct revision insertion is denied');
  const forgedRevisionUpdate = await beta
    .from('property_comment_revisions')
    .update({ after_body: 'rewritten' })
    .eq('comment_id', created.data.id)
    .select('sequence');
  assert.ok(
    forgedRevisionUpdate.error ||
      (forgedRevisionUpdate.data ?? []).length === 0,
    'Direct revision update is denied or matches nothing',
  );
  const unchanged = await reviewer
    .from('property_comment_revisions')
    .select('sequence')
    .eq('comment_id', created.data.id);
  assert.equal((unchanged.data ?? []).length, 2, 'Evidence is unchanged');
  observed(
    'the guarded edit retains every version, rejects stale saves and refuses other authors',
    {
      versions: 2,
      stale: stale.error?.code ?? null,
      replayRevertedEdit: replay.data.body !== 'Bản sửa lần hai',
      retained: (unchanged.data ?? []).length,
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
  // Ticket #46 route boundary: the shape is validated here and the database still rechecks
  // author, revision and archive state; a stale revision is never merged.
  const target = read.body.comments.find(
    (row) => row.authorId === alphaEmployee && row.body === editedBody,
  );
  assert.ok(target, 'The route returns the edited comment');
  assert.ok(target.editedAt, 'The route returns the edited marker');
  const editRoute = (body) =>
    session.request(
      '/api/properties/' + discussion.id + '/comments/' + target.id,
      body,
    );
  assert.equal(
    (
      await editRoute({
        body: 'extra',
        revision: target.revision,
        authorId: alphaEmployee,
      })
    ).status,
    400,
    'Unknown edit fields are rejected',
  );
  assert.equal(
    (await editRoute({ body: '   ', revision: target.revision })).status,
    400,
    'Blank edited text is rejected at the application boundary',
  );
  assert.equal(
    (await editRoute({ body: 'Thiếu bản sửa' })).status,
    400,
    'A missing revision is rejected',
  );
  assert.equal(
    (
      await session.request(
        '/api/properties/' + discussion.id + '/comments/not-a-uuid',
        { body: 'x', revision: target.revision },
      )
    ).status,
    400,
    'A malformed comment identity is rejected',
  );
  const staleEdit = await editRoute({
    body: 'Sửa với bản cũ',
    revision: randomUUID(),
  });
  assert.equal(staleEdit.status, 409, 'A stale revision is a conflict');
  assert.equal(staleEdit.body.error, 'stale-edit');
  assert.equal(
    staleEdit.body.comment?.body,
    target.body,
    'The conflict response carries the current text for reconciliation',
  );
  assert.equal(
    staleEdit.body.comment?.revision,
    target.revision,
    'The conflict response carries the current revision so a retry converges',
  );
  assert.equal(
    staleEdit.body.comment?.editedAt,
    target.editedAt,
    'The conflict response carries the current edited marker',
  );
  assert.equal(
    staleEdit.cache,
    'private, no-store, max-age=0',
    'Edit responses are never publicly cached',
  );
  observed(
    'application routes enforce session, validation and conflict contract',
    {
      readStatus: read.status,
      cacheControl: read.cache,
      recovered: recovered.status,
      conflict: conflict.body.error,
      editedMarker: target.editedAt !== null,
      staleEdit: staleEdit.body.error,
      staleCurrent: staleEdit.body.comment?.revision === target.revision,
    },
  );
}

// --------------------------------------------------------- post and archive race
// The holder takes the parent Property row lock, then takes a transaction-scoped advisory lock
// that a second connection observes in pg_locks immediately. Unlike the previous uncommitted
// marker row, the advisory lock proves the row lock is held before the holder commits; the
// competing requests are dispatched only after that readiness is observed.
function holdPropertyLock(propertyId, seconds, lockKey) {
  return spawn(
    'npx',
    [
      'supabase',
      'db',
      'query',
      '--db-url',
      operator.dbUrl,
      `with locked as (select id from public.properties where id='${propertyId}' for update)
       select pg_sleep(${seconds})
       from (select pg_advisory_xact_lock(${lockKey}) from locked) held`,
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
  // comments and their retained revisions, in one transaction (the immutability trigger guards
  // client writes, and retained evidence references its comment).
  await operatorSqlAsync(
    `do $$
     begin
       execute 'alter table public.property_comments disable trigger comment_original';
       delete from public.property_comment_revisions where property_id = '${propertyId}';
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
async function lockCount(lockKey) {
  const rows = await operatorSqlAsync(
    `select count(*)::int as n from pg_locks
      where locktype = 'advisory' and granted
        and classid::bigint * 4294967296 + objid::bigint = ${lockKey}`,
  );
  return Number(rows[0]?.n ?? 0);
}
async function waitForLock(lockKey) {
  for (let attempt = 0; attempt < 10; attempt++) {
    if ((await lockCount(lockKey)) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}
function readinessKey() {
  return BigInt('0x' + randomUUID().replaceAll('-', '').slice(0, 15));
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
  const lockKey = readinessKey();
  // Short hold: both requests must queue and still finish inside the 8s authenticated
  // statement timeout.
  const holder = holdPropertyLock(race.id, 5, lockKey);
  assert.ok(
    await waitForLock(lockKey),
    'The holder holds the parent property row before the competing requests',
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
// ----------------------------------------------------------- edit/edit race
{
  // Two independent real author sessions hold the same revision and save at once.
  const created = await alpha.rpc('post_property_comment', {
    p_property_id: second.id,
    p_body: 'Đua sửa — bản gốc',
    p_key: '52000000-0000-4000-8000-0000000000f1',
  });
  assert.equal(created.error, null, 'The edit-race comment commits');
  const sessionA = await appSession('alpha');
  const sessionB = await appSession('alpha');
  const target = (await readComments(sessionA, second.id)).find(
    (row) => row.id === created.data.id,
  );
  assert.ok(target, 'Both competing sessions read the same revision');
  const [a, b] = await Promise.all([
    sessionA.request(
      '/api/properties/' + second.id + '/comments/' + target.id,
      { body: 'Đua A', revision: target.revision },
    ),
    sessionB.request(
      '/api/properties/' + second.id + '/comments/' + target.id,
      { body: 'Đua B', revision: target.revision },
    ),
  ]);
  const statuses = [a.status, b.status].sort((left, right) => left - right);
  assert.deepEqual(statuses, [200, 409], 'Exactly one competing edit wins');
  const winner = a.status === 200 ? 'Đua A' : 'Đua B';
  const loser = a.status === 200 ? b : a;
  assert.equal(
    loser.body.error,
    'stale-edit',
    'The losing edit is a stale conflict, not a silent merge',
  );
  const committed = await reviewer
    .from('property_comments')
    .select('body')
    .eq('id', target.id)
    .single();
  assert.equal(
    committed.data.body,
    winner,
    'The committed text is the single winner',
  );
  const versions = await reviewer
    .from('property_comment_revisions')
    .select('sequence')
    .eq('comment_id', target.id);
  assert.equal(
    (versions.data ?? []).length,
    1,
    'A losing edit appended no retained evidence',
  );
  observed(
    'two real author sessions: an edit/edit race keeps one winner and one stale conflict',
    { rounds: 1, statuses: statuses.join(','), versions: 1 },
  );
}
// ------------------------------------------------------- edit and archive race
// The holder takes the parent Property row lock and the readiness lock, so both competing
// requests are dispatched inside that genuinely held window.
async function runEditRaceRound(round) {
  await resetRaceProperty(race.id);
  const created = await alpha.rpc('post_property_comment', {
    p_property_id: race.id,
    p_body: `Đua sửa lưu trữ ${round}`,
    p_key: `52000000-0000-4000-8000-0000000000fa${round}`,
  });
  assert.equal(created.error, null, 'The race fixture comment commits');
  const revision = await archiveRevision(reviewer, race.id);
  const session = await appSession('alpha');
  const marker = `SGN44 edit race round ${round}`;
  const lockKey = readinessKey();
  const holder = holdPropertyLock(race.id, 5, lockKey);
  assert.ok(
    await waitForLock(lockKey),
    'The holder takes the parent property row before the competing requests',
  );
  const [edited, archivedResult] = await Promise.all([
    session.request(
      '/api/properties/' + race.id + '/comments/' + created.data.id,
      { body: `Sửa trong đua ${round}`, revision: created.data.revision },
    ),
    archive(reviewer, race.id, revision, marker),
  ]);
  await waitForExit(holder);
  assert.equal(archivedResult.error, null, 'The competing archive commits');
  const rows = await operatorSqlAsync(
    `select body from public.property_comments where id = '${created.data.id}'`,
  );
  const body = rows[0]?.body ?? null;
  if (edited.status === 200) {
    assert.equal(
      body,
      `Sửa trong đua ${round}`,
      'The winning edit committed before the archive',
    );
    assert.ok(
      edited.body.comment.editedAt,
      'The winning edit records its edited marker',
    );
  } else {
    assert.equal(edited.status, 403, 'A losing edit is denied as archived');
    assert.equal(
      body,
      `Đua sửa lưu trữ ${round}`,
      'A denied edit left the current text unchanged',
    );
    const appended = await operatorSqlAsync(
      `select count(*)::int as n from public.property_comment_revisions where comment_id = '${created.data.id}'`,
    );
    assert.equal(
      Number(appended[0]?.n ?? 0),
      0,
      'A denied edit appended no retained evidence',
    );
  }
  assert.equal(
    await isArchived(race.id),
    true,
    'The property is archived after the round',
  );
  return edited.status === 200 ? 'edited' : 'denied';
}
{
  const outcomes = { edited: 0, denied: 0 };
  for (let round = 0; round < 2; round++) {
    outcomes[await runEditRaceRound(round)]++;
  }
  assert.equal(
    outcomes.edited + outcomes.denied,
    2,
    'Every round produced one of the two legal serializations',
  );
  observed(
    'held parent lock: competing edit and archive serialize with the state rechecked',
    { rounds: 2, ...outcomes },
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
    `Fixture-only writes: the ${namespace} namespace is created and removed by this task; retained revisions reference their comment and are removed first.`,
    'The held-lock races use the operator connection to hold the parent property row; they do not replace a staging gate for production contention.',
    'The readiness gate is an advisory lock visible in pg_locks while the parent row lock is held; the earlier #44 rounds recorded posted: 0 and denied: 4 because their uncommitted marker row became visible only after the holder released the lock, so the competing requests were dispatched with no lock held.',
    'The harness was reconciled for the design-system record page (tabbed record, shell language switch and account menu) and extended for the ticket #46 edit journey at this head.',
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
