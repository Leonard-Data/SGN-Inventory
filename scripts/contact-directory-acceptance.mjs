// Issue #71 hosted acceptance: the shared Contact directory and its Owners view.
//
// Real development Supabase Auth/Data API/RLS plus the local real Next.js application and the
// rendered browser journey driven over CDP in a task-private headless Chromium. Every probe
// uses an individual signed-in session; mock, shim and embedded-PGlite results are not
// acceptance. The synthetic SGN71 fixtures (employees, Auth users, properties, contact links,
// direct contacts) are removed after the run through the separately authorized owner
// connection, and the report records exactly what was created and removed.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_OPERATOR=<private operator config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   node --env-file-if-exists=.env.local scripts/contact-directory-acceptance.mjs \
//     [--report <sanitized json path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// server-only Auth admin capability (`authAdminKey`), which is never printed, shell sourced
// or passed in argv. The operator config supplies the owner connection (`dbUrl`), handed to
// the Supabase CLI in argv for the fixture statements that provision and remove synthetic
// employees and contacts, because client roles cannot write those rows. Captured CLI output
// is redacted of the connection string before it is recorded.
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
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3105);
const browserCli =
  process.env.SGN_ACCEPTANCE_BROWSER_CLI ??
  path.join(process.env.HOME ?? '', '.local/bin/chrome-devtools-axi');
const chromeBin =
  process.env.SGN_ACCEPTANCE_CHROME ??
  path.join(
    process.env.HOME ?? '',
    '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  );
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
// Employee lifecycle and shared-contact rows are guarded against every client role, so the
// fixtures are provisioned and removed with the separately authorized owner connection.
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
      console.log('RETRY', label, attempt);
      await sleep(1500 * attempt);
    }
  }
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
async function refused(label, work, code = null) {
  const { error } = await retryResult(label, work);
  assert.ok(error, `${label} must be refused`);
  if (code) assert.equal(error.code, code, `${label}: ${error.code}`);
  return error;
}
const anonClient = sessionClient();

// ------------------------------------------------------------------ fixtures
const namespace = 'SGN71';
const filePrefix = namespace.toLowerCase();
// Fresh identities and names per run: an interrupted earlier run leaves nothing behind
// (this slice removes its own fixtures), and a stale row can never satisfy an assertion.
const runToken = randomBytes(3).toString('hex');
const name = (suffix) => `${namespace} ${runToken} ${suffix}`;
const identities = [
  ['admin', 'admin', true],
  ['manager', 'manager', true],
  ['staff', 'staff', true],
  ['sales', 'sales', true],
  ['inactive', 'sales', false],
];
// Enough directory identities for this run's own query to cross the 31-row page probe.
const pagingRows = 32;
const manifestPath = path.join(workdir, 'fixtures.json');

async function createFixtures() {
  const manifest = {
    namespace,
    run_token: runToken,
    identities: {},
    unlinked: null,
    properties: {},
    contacts: {},
  };
  for (const [label, role, active] of identities) {
    const email = `${filePrefix}.${label}.${runToken}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const created = await retryResult(`create auth user ${label}`, () =>
      ownerClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      }),
    );
    assert.equal(created.error, null, `create auth user ${label}`);
    const employeeId = randomUUID();
    operatorSql(
      `insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ('${employeeId}','${created.data.user.id}','${email}','${name(label)}','${role}',${active})`,
    );
    manifest.identities[label] = {
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

async function propertyRevision(client, propertyId) {
  const { data, error } = await retryResult(
    'read fixture property revision',
    () =>
      client
        .from('properties')
        .select('revision')
        .eq('id', propertyId)
        .single(),
  );
  assert.equal(error, null, 'read fixture property revision');
  return data.revision;
}

async function createProperty(client, addressText) {
  const { data, error } = await retryResult('create fixture property', () =>
    client.rpc('create_property', {
      p_mode: 'sale',
      p_facts: {},
      p_address: { format: 'legacy', address_text: addressText },
    }),
  );
  assert.equal(error, null, `create property ${addressText}`);
  return data;
}

async function createContact(client, changes) {
  const { data, error } = await retryResult('create fixture contact', () =>
    client.rpc('create_contact', { p_changes: changes }),
  );
  assert.equal(error, null, `create contact ${changes.display_name}`);
  return data;
}

async function linkContact(
  client,
  propertyId,
  contactId,
  relation,
  primary = false,
) {
  const revision = await propertyRevision(client, propertyId);
  const { error } = await retryResult('link fixture contact', () =>
    client.rpc('maintain_property', {
      p_property_id: propertyId,
      p_target: 'link',
      p_target_id: null,
      p_expected_revision: revision,
      p_property_revision: revision,
      p_changes: {
        contact_id: contactId,
        relation,
        is_primary: primary,
      },
    }),
  );
  assert.equal(error, null, `link ${contactId} as ${relation}`);
}

async function archiveProperty(client, propertyId) {
  const revision = await propertyRevision(client, propertyId);
  const { error } = await retryResult('archive fixture property', () =>
    client.rpc('maintain_property', {
      p_property_id: propertyId,
      p_target: 'property',
      p_target_id: propertyId,
      p_expected_revision: revision,
      p_property_revision: revision,
      p_changes: { archived_at: new Date().toISOString() },
    }),
  );
  assert.equal(error, null, 'archive fixture property');
}

// This slice removes exactly its own namespace: property history first, then the links,
// the contacts, the properties, the employees and finally the Auth identities.
async function removeFixtures(manifest) {
  const cleanup = { removed: {}, failures: [] };
  if (!manifest) return cleanup;
  const propertyIds = Object.values(manifest.properties ?? {});
  const contactIds = [
    ...Object.values(manifest.contacts ?? {}),
    ...(manifest.pagingContacts ?? []),
  ];
  const employeeIds = Object.values(manifest.identities ?? {}).map(
    (identity) => identity.employeeId,
  );
  const quoted = (ids) => ids.map((id) => `'${id}'`).join(',');
  const statements = [
    [
      'history',
      `delete from public.property_history where property_id in (${quoted(propertyIds)})`,
    ],
    [
      'links',
      `delete from public.property_contacts where property_id in (${quoted(propertyIds)}) or contact_id in (${quoted(contactIds)})`,
    ],
    [
      'addresses',
      `delete from public.property_addresses where property_id in (${quoted(propertyIds)})`,
    ],
    [
      'contacts',
      `delete from public.contacts where id in (${quoted(contactIds)})`,
    ],
    [
      'properties',
      `delete from public.properties where id in (${quoted(propertyIds)})`,
    ],
    [
      'employees',
      `delete from public.employees where id in (${quoted(employeeIds)})`,
    ],
  ];
  for (const [label, statement] of statements) {
    if (
      label !== 'employees' &&
      propertyIds.length === 0 &&
      contactIds.length === 0
    )
      continue;
    if (label === 'contacts' && contactIds.length === 0) continue;
    try {
      operatorSql(statement);
      cleanup.removed[label] = true;
    } catch (error) {
      cleanup.failures.push(`${label}: ${error.message.slice(0, 200)}`);
    }
  }
  const users = [
    ...Object.values(manifest.identities ?? {}).map(
      (identity) => identity.userId,
    ),
    ...(manifest.unlinked ? [manifest.unlinked.userId] : []),
  ];
  cleanup.auth_users_removed = 0;
  for (const userId of users) {
    try {
      const removed = await retryThrown('remove fixture auth user', () =>
        ownerClient.auth.admin.deleteUser(userId),
      );
      if (!removed?.error || /not found/i.test(removed.error.message ?? ''))
        cleanup.auth_users_removed++;
      else cleanup.failures.push(`auth user: ${removed.error.message}`);
    } catch (error) {
      cleanup.failures.push(`auth user: ${error.message.slice(0, 200)}`);
    }
  }
  return cleanup;
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
  return { status: response.status, body };
}
async function appPost(cookies, route, payload) {
  const response = await fetch(appUrl + route, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      origin: appUrl,
      ...(cookies ? { cookie: cookies } : {}),
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}
async function readDirectoryPages(cookies, query) {
  const entries = [];
  const seen = new Set();
  let cursor = null;
  let pages = 0;
  for (;;) {
    const parameters = new URLSearchParams({ query });
    if (cursor) parameters.set('after', cursor);
    const { status, body } = await appGet(
      cookies,
      '/api/contacts?' + parameters.toString(),
    );
    assert.equal(status, 200, `Contact list read ${status}`);
    assert.ok(Array.isArray(body?.contacts), 'Contact list shape');
    pages++;
    for (const entry of body.contacts) {
      assert.ok(!seen.has(entry.id), 'No contact appears on two pages');
      seen.add(entry.id);
      entries.push(entry);
    }
    if (!body.nextCursor) break;
    assert.equal(
      body.contacts.length,
      30,
      'A non-final page exposes 30 contacts',
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
  const prototype = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;
async function browserSignIn(session, cdpPort, email, password) {
  browser(session, cdpPort, ['open', `${appUrl}/login?lang=vi`]);
  evaluate(session, cdpPort, setInput('#email', email));
  evaluate(session, cdpPort, setInput('#password', password));
  evaluate(
    session,
    cdpPort,
    `(() => { document.querySelector('form').requestSubmit(); return true; })()`,
  );
  await waitFor(session, cdpPort, `() => location.pathname === '/properties'`);
}
const directoryScreen = (session, cdpPort) => {
  const value = evaluate(
    session,
    cdpPort,
    `() => {
      const table = document.querySelector('main table.data-table');
      return {
        path: location.pathname + location.search,
        lang: document.documentElement.lang,
        heading: document.querySelector('h1')?.textContent?.trim() ?? null,
        panelHeading: document.querySelector('h2')?.textContent?.trim() ?? null,
        tabs: [...document.querySelectorAll('nav.tabs a.tab')].map((tab) => ({
          label: tab.textContent.trim(),
          current: tab.getAttribute('aria-current'),
          href: tab.getAttribute('href'),
        })),
        rows: table
          ? [...table.querySelectorAll('tbody tr:not(.row-detail)')].map((tr) =>
              [...tr.children].map((cell) => cell.textContent.trim()),
            )
          : [],
        expanded: Boolean(document.querySelector('tr.row-detail')),
        empty: document.querySelector('.state-panel h3')?.textContent?.trim() ?? null,
        pager: [...document.querySelectorAll('.pagination .pager-btn')].map((link) => link.getAttribute('href')),
      };
    }`,
  );
  assert.equal(typeof value, 'object', 'Unexpected directory screen payload');
  return value;
};
const expandedScreen = (session, cdpPort) => {
  const value = evaluate(
    session,
    cdpPort,
    `() => {
      const editor = document.querySelector('tr.row-detail .row-editor');
      if (!editor) return null;
      return {
        chips: [...editor.querySelectorAll('.impact .chip')].map((chip) => ({
          label: chip.textContent.trim(),
          href: chip.getAttribute('href'),
        })),
        facts: [...editor.querySelectorAll('.facts .fact')].map((fact) => ({
          label: fact.querySelector('dt')?.textContent?.trim() ?? null,
          value: fact.querySelector('dd')?.textContent?.trim() ?? null,
          unknown: Boolean(fact.querySelector('dd.is-unknown')),
        })),
        confirm: Boolean(editor.querySelector('form input[type=checkbox]')),
        phoneField: Boolean(editor.querySelector('form textarea[name=phones]')),
        submit: editor.querySelector('form button[type=submit]')?.textContent?.trim() ?? null,
      };
    }`,
  );
  return value;
};
const clickRowAction = (index = 0) => `(() => {
  const row = document.querySelectorAll('main table.data-table tbody tr:not(.row-detail)')[${index}];
  if (!row) return false;
  row.querySelector('button').click();
  return true;
})()`;

// ------------------------------------------------------------------ run
let manifest = null;
const report = {
  issue: 71,
  namespace,
  run_token: runToken,
  started_at: new Date().toISOString(),
  observations,
  created: {},
  cleanup: null,
  limitations: [
    'Supabase Auth email delivery and invitation acceptance are outside this slice.',
    'Two genuinely independent browser sessions are used for the read/denial rows; a sustained production-load contention benchmark is not claimed.',
    'The directory slice has no contact deletion path in the product; fixtures are removed through the separately authorized owner connection and the report records the exact ids.',
  ],
};
let failure = null;
let cdpPort = 9337;
try {
  manifest = await createFixtures();
  const staff = await signInClient(
    manifest.identities.staff.email,
    manifest.identities.staff.password,
  );
  const manager = await signInClient(
    manifest.identities.manager.email,
    manifest.identities.manager.password,
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

  // -------------------------------------------------------------- fixtures
  const left = await createProperty(staff, name('Parent Left'));
  const right = await createProperty(manager, name('Parent Right'));
  const archived = await createProperty(manager, name('Parent Archived'));
  const shared = await createContact(staff, {
    display_name: name('Shared Person'),
    phones: ['0900 000 001'],
    raw_phone_text: '0900 000 001 (Zalo)',
  });
  const classifiedOwner = await createContact(staff, {
    display_name: name('Classified Owner'),
    contact_type: 'owner',
  });
  const ownerElsewhere = await createContact(staff, {
    display_name: name('Owner Elsewhere'),
    contact_type: 'broker',
  });
  const unlinkedPerson = await createContact(staff, {
    display_name: name('Unlinked Person'),
  });
  const archivedOnly = await createContact(manager, {
    display_name: name('Archived Owner'),
  });
  const pagingContacts = [];
  for (let index = 1; index <= pagingRows; index++)
    pagingContacts.push(
      await createContact(staff, {
        display_name: name(`Page ${String(index).padStart(2, '0')}`),
      }),
    );
  const literal = await createContact(staff, {
    display_name: name('%_ literal person'),
  });
  await linkContact(staff, left, shared, 'owner', true);
  await linkContact(staff, right, shared, 'broker');
  await linkContact(staff, left, classifiedOwner, 'broker');
  await linkContact(staff, right, ownerElsewhere, 'owner');
  await linkContact(manager, archived, archivedOnly, 'owner');
  // Issue #109: a property–contact link is not a property business-history entry — the
  // relationship change is attributed in the private audit trail instead. Confirm the
  // freshly linked properties carry no link-derived `property_history` row.
  const linkedHistory = await retryResult('read linked-property history', () =>
    sales
      .from('property_history')
      .select('id')
      .in('property_id', [left, right])
      .limit(1),
  );
  assert.equal(linkedHistory.error, null, 'read linked-property history');
  assert.deepEqual(
    linkedHistory.data,
    [],
    'a property–contact link records no property_history row',
  );
  await archiveProperty(manager, archived);
  Object.assign(manifest.properties, { left, right, archived });
  Object.assign(manifest.contacts, {
    shared,
    classifiedOwner,
    ownerElsewhere,
    unlinked: unlinkedPerson,
    archivedOnly,
    literal,
  });
  manifest.pagingContacts = pagingContacts;
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
  report.created = {
    properties: [left, right, archived],
    contacts: [...Object.values(manifest.contacts), ...pagingContacts],
  };
  observed('the synthetic SGN71 fixture namespace is created and linked', {
    properties: 3,
    contacts: report.created.contacts.length,
  });

  // ------------------------------------------------- direct RLS/Data API
  await refused(
    'anonymous directory read is refused',
    () =>
      anonClient.rpc('list_contacts', {
        p_limit: 31,
      }),
    '42501',
  );
  await refused(
    'anonymous correction is refused',
    () =>
      anonClient.rpc('maintain_contact', {
        p_contact_id: shared,
        p_expected_revision: randomUUID(),
        p_changes: { notes: 'anonymous' },
      }),
    '42501',
  );
  const unlinkedRead = await retryResult('unlinked directory read', () =>
    unlinked.rpc('list_contacts', { p_limit: 31 }),
  );
  assert.equal(unlinkedRead.error, null, 'unlinked directory read');
  assert.deepEqual(unlinkedRead.data, []);
  await refused(
    'an unlinked authenticated identity cannot correct a shared contact',
    () =>
      unlinked.rpc('maintain_contact', {
        p_contact_id: shared,
        p_expected_revision: randomUUID(),
        p_changes: { notes: 'unlinked' },
      }),
    '42501',
  );
  const inactiveRead = await retryResult('inactive directory read', () =>
    inactive.rpc('list_contacts', { p_limit: 31 }),
  );
  assert.equal(inactiveRead.error, null, 'inactive directory read');
  assert.deepEqual(inactiveRead.data, []);
  await refused(
    'a deactivated membership cannot correct a shared contact',
    () =>
      inactive.rpc('maintain_contact', {
        p_contact_id: shared,
        p_expected_revision: randomUUID(),
        p_changes: { notes: 'inactive' },
      }),
    '42501',
  );
  observed(
    'anonymous, unlinked and inactive callers reach neither the directory nor the operation',
  );

  const owners = await retryResult('sales owner view', () =>
    sales.rpc('list_contacts', {
      p_query: name('Shared Person'),
      p_owners_only: true,
      p_limit: 31,
    }),
  );
  assert.equal(owners.error, null, 'sales owner view');
  assert.equal(owners.data.length, 1, 'exactly the shared identity');
  assert.deepEqual(
    Object.fromEntries(
      owners.data[0].links.map((link) => [link.property_id, link.relation]),
    ),
    { [left]: 'owner', [right]: 'broker' },
  );
  const classifiedOwners = await retryResult('classified owner view', () =>
    sales.rpc('list_contacts', {
      p_query: name('Classified Owner'),
      p_owners_only: true,
      p_limit: 31,
    }),
  );
  assert.equal(classifiedOwners.error, null, 'classified owner view');
  assert.deepEqual(classifiedOwners.data, []);
  const allView = await retryResult('all contacts view', () =>
    sales.rpc('list_contacts', {
      p_query: name('Classified Owner'),
      p_owners_only: false,
      p_limit: 31,
    }),
  );
  assert.equal(
    allView.data.length,
    1,
    'the identity is listed in the whole directory',
  );
  const elsewhereOwners = await retryResult('owner elsewhere view', () =>
    sales.rpc('list_contacts', {
      p_query: name('Owner Elsewhere'),
      p_owners_only: true,
      p_limit: 31,
    }),
  );
  assert.equal(elsewhereOwners.data.length, 1);
  assert.deepEqual(
    elsewhereOwners.data[0].links.map((link) => link.property_id),
    [right],
  );
  observed(
    'the Owners view follows the recorded relationship, not the identity classification',
  );

  const salesArchivedOwners = await retryResult(
    'archived owner view (sales)',
    () =>
      sales.rpc('list_contacts', {
        p_query: name('Archived Owner'),
        p_owners_only: true,
        p_limit: 31,
      }),
  );
  assert.deepEqual(salesArchivedOwners.data, []);
  const salesArchivedAll = await retryResult('archived contact (sales)', () =>
    sales.rpc('list_contacts', {
      p_query: name('Archived Owner'),
      p_owners_only: false,
      p_limit: 31,
    }),
  );
  assert.equal(salesArchivedAll.data.length, 1);
  assert.deepEqual(salesArchivedAll.data[0].links, []);
  const managerArchivedOwners = await retryResult(
    'archived owner view (manager)',
    () =>
      manager.rpc('list_contacts', {
        p_query: name('Archived Owner'),
        p_owners_only: true,
        p_limit: 31,
      }),
  );
  assert.equal(managerArchivedOwners.data.length, 1);
  assert.deepEqual(
    managerArchivedOwners.data[0].links.map((link) => link.property_id),
    [archived],
  );
  await refused(
    'an ordinary employee cannot preview an archived affected set',
    () => sales.rpc('contact_impact', { p_contact_id: archivedOnly }),
    'PT403',
  );
  await refused(
    'an ordinary employee cannot correct a contact linked to an archived property',
    () =>
      sales.rpc('maintain_contact', {
        p_contact_id: archivedOnly,
        p_expected_revision: randomUUID(),
        p_changes: { notes: 'archived' },
      }),
    'PT403',
  );
  await refused(
    'an ordinary employee cannot correct an unlinked identity',
    () =>
      sales.rpc('maintain_contact', {
        p_contact_id: unlinkedPerson,
        p_expected_revision: randomUUID(),
        p_changes: { notes: 'unlinked' },
      }),
    'PT403',
  );
  const unlinkedImpact = await retryResult('unlinked impact read', () =>
    sales.rpc('contact_impact', { p_contact_id: unlinkedPerson }),
  );
  assert.ok(unlinkedImpact.error, 'unlinked detail preview stays refused');
  observed(
    'the archived and unlinked boundaries hold for an ordinary employee while a reviewer keeps the archived read',
  );

  const sharedRow = await retryResult('read shared identity', () =>
    sales
      .from('contacts')
      .select('id,revision,display_name,phones,raw_phone_text')
      .eq('id', shared)
      .single(),
  );
  assert.equal(sharedRow.error, null, 'read shared identity');
  const preview = await retryResult('preview shared impact', () =>
    sales.rpc('contact_impact', { p_contact_id: shared }),
  );
  assert.equal(preview.error, null, 'preview shared impact');
  assert.deepEqual(
    preview.data.properties.map((property) => property.id).sort(),
    [left, right].sort(),
  );
  const correctedPhone = '0900 000 002 (Zalo) %_';
  const save = await retryResult('directory-origin correction', () =>
    sales.rpc('maintain_contact', {
      p_contact_id: shared,
      p_expected_revision: preview.data.revision,
      p_changes: {
        display_name: name('Shared Person'),
        phones: ['0900 000 002'],
        raw_phone_text: correctedPhone,
      },
    }),
  );
  assert.equal(save.error, null, 'directory-origin correction');
  await refused(
    'the same correction replayed with the stale revision is refused',
    () =>
      sales.rpc('maintain_contact', {
        p_contact_id: shared,
        p_expected_revision: preview.data.revision,
        p_changes: { raw_phone_text: 'stale directory save' },
      }),
    'PT409',
  );
  // A recorded shared-contact correction changes the shared person only: it appends no
  // property history row (issue #109 narrowed `property_history` to asking prices) and
  // still raises the pending review flag on every property linked at commit time.
  const history = await retryResult('read shared history', () =>
    sales
      .from('property_history')
      .select('property_id,actor_id,changed_fields')
      .eq('target', 'contact')
      .eq('target_id', shared),
  );
  assert.equal(history.error, null, 'read shared history');
  assert.deepEqual(history.data, []);
  const reviewFlags = await retryResult('read linked review flags', () =>
    sales
      .from('properties')
      .select('id,record_review_status')
      .in('id', [left, right])
      .order('id'),
  );
  assert.equal(reviewFlags.error, null, 'read linked review flags');
  assert.deepEqual(
    reviewFlags.data.map((row) => row.record_review_status),
    ['pending', 'pending'],
  );
  const freshLeft = await retryResult('fresh left read', () =>
    sales
      .from('property_contacts')
      .select('contacts(display_name,raw_phone_text)')
      .eq('property_id', left)
      .eq('contact_id', shared)
      .single(),
  );
  assert.equal(freshLeft.error, null, 'fresh left read');
  assert.equal(freshLeft.data.contacts.raw_phone_text, correctedPhone);
  const freshRight = await retryResult('fresh right read', () =>
    sales
      .from('property_contacts')
      .select('contacts(display_name,raw_phone_text)')
      .eq('property_id', right)
      .eq('contact_id', shared)
      .single(),
  );
  assert.equal(freshRight.error, null, 'fresh right read');
  assert.equal(freshRight.data.contacts.raw_phone_text, correctedPhone);
  observed(
    'a directory-origin correction commits once to the shared person, shows on every linked property and records no property history',
  );

  // The correction above legitimately bumped the identity's revision, so the forged write is
  // compared against a revision captured after it.
  const beforeWrite = await retryResult('re-read shared identity', () =>
    sales.from('contacts').select('notes,revision').eq('id', shared).single(),
  );
  assert.equal(beforeWrite.error, null, 're-read shared identity');
  const directWrite = await retryResult('direct contact write', () =>
    sales
      .from('contacts')
      .update({ notes: 'forged' })
      .eq('id', shared)
      .select('id'),
  );
  assert.ok(directWrite.error, 'a direct shared-contact write must be refused');
  const afterWrite = await retryResult('re-read shared identity', () =>
    sales.from('contacts').select('notes,revision').eq('id', shared).single(),
  );
  assert.equal(afterWrite.data.notes, null);
  assert.equal(afterWrite.data.revision, beforeWrite.data.revision);
  observed('a direct shared-contact write is refused and changes nothing');

  const paging = await retryResult('sales paging read', async () => {
    const entries = [];
    const seen = new Set();
    let after = null;
    let last = null;
    for (let page = 0; page < 10; page++) {
      const result = await sales.rpc('list_contacts', {
        p_query: name('Page'),
        ...(after ? { p_after_id: after } : {}),
        p_limit: 31,
      });
      if (result.error) return result;
      last = result.data;
      if (page === 0) assert.equal(result.data.length, 31, 'clamped page');
      for (const row of result.data) {
        assert.ok(!seen.has(row.id), 'no duplicate across pages');
        seen.add(row.id);
        entries.push(row);
      }
      if (result.data.length <= 30) break;
      after = result.data[result.data.length - 1].id;
    }
    return { error: null, data: entries, last };
  });
  assert.equal(paging.error, null, 'sales paging read');
  assert.equal(paging.data.length, pagingRows, 'no omission across pages');
  const literalRead = await retryResult('literal query read', () =>
    sales.rpc('list_contacts', {
      p_query: name('%_'),
      p_limit: 31,
    }),
  );
  assert.deepEqual(
    literalRead.data.map((row) => row.id),
    [literal],
  );
  const wildcardRead = await retryResult('literal underscore read', () =>
    sales.rpc('list_contacts', { p_query: name('_'), p_limit: 31 }),
  );
  assert.deepEqual(wildcardRead.data, []);
  const longQueryRead = await retryResult('over-long query read', () =>
    sales.rpc('list_contacts', { p_query: 'a'.repeat(121), p_limit: 31 }),
  );
  assert.deepEqual(longQueryRead.data, []);
  observed(
    'the directory reads bounded pages without omission and treats query metacharacters as data',
  );

  // ------------------------------------------------- application endpoints
  await startApp();
  const salesCookies = await appLogin(
    manifest.identities.sales.email,
    manifest.identities.sales.password,
  );
  const staffCookies = await appLogin(
    manifest.identities.staff.email,
    manifest.identities.staff.password,
  );
  const anonymousList = await appGet(null, '/api/contacts');
  assert.equal(anonymousList.status, 401, 'anonymous list');
  const staffUnlinked = await appGet(
    staffCookies,
    '/api/contacts?' +
      new URLSearchParams({ query: name('Unlinked Person') }).toString(),
  );
  assert.equal(staffUnlinked.status, 200, 'staff directory read');
  assert.equal(
    staffUnlinked.body.contacts[0]?.id,
    unlinkedPerson,
    'the unlinked identity is listed; only staff/manager/admin may correct it (issue #72)',
  );
  const unlinkedPreview = await appGet(
    staffCookies,
    '/api/contacts/' + unlinkedPerson,
  );
  assert.equal(unlinkedPreview.status, 200, 'unlinked identity detail read');
  const unlinkedSave = await appPost(
    staffCookies,
    '/api/contacts/' + unlinkedPerson,
    {
      revision: unlinkedPreview.body.impact.revision,
      changes: { notes: 'directory save on an unlinked identity' },
    },
  );
  assert.equal(
    unlinkedSave.status,
    200,
    'staff/manager/admin corrects an unlinked identity from the directory (issue #72)',
  );
  const allPages = await readDirectoryPages(salesCookies, 'SGN71');
  assert.equal(allPages.pages > 1, true, 'the directory paged');
  const ownersPage = await appGet(
    salesCookies,
    '/api/contacts?' +
      new URLSearchParams({
        query: name('Shared Person'),
        view: 'owners',
      }).toString(),
  );
  assert.equal(ownersPage.status, 200, 'owners endpoint');
  assert.equal(ownersPage.body.contacts.length, 1);
  assert.equal(ownersPage.body.contacts[0].id, shared);
  const badCursor = await appGet(
    salesCookies,
    '/api/contacts?after=not-a-uuid',
  );
  assert.equal(badCursor.status, 400, 'malformed cursor');
  const badView = await appGet(salesCookies, '/api/contacts?view=broker');
  assert.equal(badView.status, 400, 'unknown view');
  const archivedDetail = await appGet(
    salesCookies,
    '/api/contacts/' + archivedOnly,
  );
  assert.equal(archivedDetail.status, 403, 'archived affected set');
  assert.equal(archivedDetail.body.error, 'contact-refusal');
  const unlinkedDetail = await appGet(
    salesCookies,
    '/api/contacts/' + unlinkedPerson,
  );
  assert.equal(unlinkedDetail.status, 403, 'unlinked identity');
  assert.equal(unlinkedDetail.body.error, 'contact-refusal');
  const correctionEndpoint = await appPost(
    salesCookies,
    '/api/contacts/' + shared,
    {
      revision: preview.data.revision,
      changes: { notes: 'stale endpoint save' },
    },
  );
  assert.equal(correctionEndpoint.status, 409, 'stale endpoint save');
  const detailRead = await appGet(salesCookies, '/api/contacts/' + shared);
  assert.equal(detailRead.status, 200, 'contact detail read');
  assert.equal(detailRead.body.contact.id, shared);
  const endpointSave = await appPost(salesCookies, '/api/contacts/' + shared, {
    revision: detailRead.body.impact.revision,
    changes: { raw_phone_text: '0900 000 003 (Zalo)' },
  });
  assert.equal(endpointSave.status, 200, 'contact-scoped save');
  const propertyHistory = await appGet(
    salesCookies,
    '/api/properties/' + left + '/history',
  );
  assert.equal(propertyHistory.status, 200, 'property history read');
  // Issue #109: a shared-contact correction is not a property business history entry, so
  // the property's own history endpoint returns the recorded asking-price entries only.
  assert.equal(
    propertyHistory.body.events.some(
      (event) => event.target === 'contact' && event.target_id === shared,
    ),
    false,
    'a shared-contact correction records no property history row',
  );
  const correctedLeft = await appGet(salesCookies, '/api/contacts/' + shared);
  assert.equal(correctedLeft.status, 200, 'corrected identity read');
  assert.equal(
    correctedLeft.body.contact.raw_phone_text,
    '0900 000 003 (Zalo)',
  );
  // A refused sign-in and a refused protected read are both truthful denials; the app may
  // refuse the inactive membership at sign-in or serve the session and refuse its data.
  async function refusedDirectory(email, password, label) {
    const login = await appLoginResponse(email, password);
    if (login.status !== 200) {
      assert.equal(login.status, 403, `${label} sign-in refusal status`);
      return 'sign-in';
    }
    const list = await appGet(login.cookies, '/api/contacts?query=SGN71');
    assert.equal(list.status, 403, `${label} directory read`);
    return 'session';
  }
  const inactiveRefusal = await refusedDirectory(
    manifest.identities.inactive.email,
    manifest.identities.inactive.password,
    'inactive',
  );
  const unlinkedRefusal = await refusedDirectory(
    manifest.unlinked.email,
    manifest.unlinked.password,
    'unlinked',
  );
  observed(
    'the application endpoints refuse malformed input, inactive and unlinked sessions and keep the object-level refusal inline',
    {
      inactive_refused_at: inactiveRefusal,
      unlinked_refused_at: unlinkedRefusal,
    },
  );

  // ------------------------------------------------- rendered browser journey
  await startBrowser(cdpPort);
  browser('sgn71-anon', cdpPort, ['open', `${appUrl}/login?lang=vi`]);
  browser('sgn71-anon', cdpPort, ['open', `${appUrl}/people/contacts`]);
  await waitFor('sgn71-anon', cdpPort, `() => location.pathname === '/login'`);
  observed(
    'an anonymous visit to the contact destination is redirected to sign-in',
  );

  await browserSignIn(
    'sgn71-sales',
    cdpPort,
    manifest.identities.sales.email,
    manifest.identities.sales.password,
  );
  browser('sgn71-sales', cdpPort, [
    'open',
    `${appUrl}/people/contacts?query=${encodeURIComponent(name('Shared Person'))}`,
  ]);
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => Boolean(document.querySelector('main table.data-table'))`,
  );
  const viScreen = directoryScreen('sgn71-sales', cdpPort);
  assert.equal(viScreen.heading, 'Người liên hệ');
  assert.equal(viScreen.lang, 'vi');
  assert.equal(viScreen.rows.length, 1, 'one matching identity');
  assert.ok(
    viScreen.rows[0].join(' ').includes('Chủ nhà'),
    'the recorded owner relationship is presented',
  );
  assert.deepEqual(
    viScreen.tabs.map((tab) => tab.current),
    ['page', null],
    'the whole-directory view is current',
  );
  const ownersTab = viScreen.tabs.find((tab) =>
    tab.href?.includes('view=owners'),
  );
  assert.ok(ownersTab, 'the Owners view is offered');
  browser('sgn71-sales', cdpPort, ['open', appUrl + ownersTab.href]);
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => Boolean(document.querySelector('main table.data-table'))`,
  );
  const ownersScreen = directoryScreen('sgn71-sales', cdpPort);
  assert.equal(ownersScreen.panelHeading, 'Chủ nhà');
  assert.deepEqual(
    ownersScreen.tabs.map((tab) => tab.current),
    [null, 'page'],
    'the Owners view is current',
  );
  browser('sgn71-sales', cdpPort, [
    'open',
    `${appUrl}/people/contacts?view=owners&query=${encodeURIComponent(name('Classified Owner'))}`,
  ]);
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => Boolean(document.querySelector('main .state-panel'))`,
  );
  const classifiedScreen = directoryScreen('sgn71-sales', cdpPort);
  assert.equal(
    classifiedScreen.rows.length,
    0,
    'a classified owner without the link is not an owner',
  );
  assert.ok(classifiedScreen.empty, 'the empty Owners state is explicit');
  observed(
    'the rendered directory offers the Owners view and filters by the recorded relationship',
  );

  browser('sgn71-sales', cdpPort, [
    'open',
    `${appUrl}/people/contacts?query=${encodeURIComponent(name('Shared Person'))}`,
  ]);
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => Boolean(document.querySelector('main table.data-table tbody tr button'))`,
  );
  evaluate('sgn71-sales', cdpPort, clickRowAction(0));
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => Boolean(document.querySelector('tr.row-detail form textarea[name=phones]'))`,
  );
  const expanded = expandedScreen('sgn71-sales', cdpPort);
  assert.ok(expanded, 'the expansion renders');
  assert.equal(
    expanded.chips.length,
    2,
    'both affected properties are previewed',
  );
  assert.equal(expanded.confirm, true, 'same-person confirmation is required');
  assert.equal(
    expanded.phoneField,
    true,
    'the recorded phone field is offered',
  );
  const browserPhone = '0900 000 004 (Zalo)';
  evaluate(
    'sgn71-sales',
    cdpPort,
    setInput('tr.row-detail form textarea[name=phones]', browserPhone),
  );
  evaluate(
    'sgn71-sales',
    cdpPort,
    `(() => { document.querySelector('tr.row-detail form input[type=checkbox]').click(); return true; })()`,
  );
  evaluate(
    'sgn71-sales',
    cdpPort,
    `(() => { document.querySelector('tr.row-detail form').requestSubmit(); return true; })()`,
  );
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => !document.querySelector('tr.row-detail')`,
  );
  const savedScreen = directoryScreen('sgn71-sales', cdpPort);
  assert.ok(
    savedScreen.rows[0].join(' ').includes(browserPhone),
    'the corrected value is presented immediately',
  );
  observed(
    'a salesperson corrects the shared contact from the directory with its affected-set preview',
  );

  browser('sgn71-sales', cdpPort, ['open', appUrl + '/people/contacts']);
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => Boolean(document.querySelector('main table.data-table'))`,
  );
  evaluate(
    'sgn71-sales',
    cdpPort,
    `(() => { document.querySelector('.lang-switch button[lang=en]').click(); return true; })()`,
  );
  await waitFor(
    'sgn71-sales',
    cdpPort,
    `() => document.querySelector('h1')?.textContent?.trim() === 'Contacts'`,
  );
  const english = directoryScreen('sgn71-sales', cdpPort);
  assert.equal(english.lang, 'en');
  assert.equal(english.tabs[1].label, 'Owners');
  observed('the contact directory renders equivalent English labels');

  for (const [label, email, password] of [
    [
      'inactive',
      manifest.identities.inactive.email,
      manifest.identities.inactive.password,
    ],
    ['unlinked', manifest.unlinked.email, manifest.unlinked.password],
  ]) {
    const session = `sgn71-${label}`;
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
      `() => Boolean(document.querySelector('[role=alert]')) || location.pathname === '/access-denied'`,
    );
    const denied = evaluate(
      session,
      cdpPort,
      `() => ({ path: location.pathname, alert: document.querySelector('[role=alert]')?.textContent?.trim() ?? null })`,
    );
    assert.ok(
      denied.path === '/access-denied' || denied.alert,
      `${label} must be refused with a visible denial`,
    );
    browser(session, cdpPort, ['open', `${appUrl}/people/contacts`]);
    await waitFor(
      session,
      cdpPort,
      `() => location.pathname === '/access-denied'`,
    );
    observed(
      `a ${label === 'inactive' ? 'deactivated membership' : 'sign-in identity with no active employee'} is refused before the directory renders`,
    );
  }
} catch (error) {
  failure = error;
  console.log('FAILURE', error?.stack ?? error);
} finally {
  try {
    report.cleanup = await removeFixtures(manifest);
  } catch (error) {
    report.cleanup = { failures: [String(error?.message ?? error)] };
  }
  await stopBrowsers();
  await stopApp();
  report.finished_at = new Date().toISOString();
  report.failed = failure ? String(failure?.message ?? failure) : null;
  if (reportPath)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
}
if (failure) {
  console.error(report.cleanup);
  process.exit(1);
}
console.log(`All ${observations.length} observation groups passed`);
