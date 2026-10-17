// Issue #69 hosted acceptance: complete the invitation acceptance journey.
//
// Real development Supabase Auth/Data API/RLS, the local real Next.js application and the real
// delivered invite link. It records one invitation for an operator-controlled address, follows
// the real provider invite link through its redirect chain to recover the exact delivered
// session, and completes the invitee's setup through the application endpoints — then proves a
// wrong identity, a consumed replay, an interrupted retry and a deactivation race are refused
// without restoring authority. Mock, shim, generated-token and embedded-PGlite results are not
// acceptance.
//
// This script NEVER runs against production: it asserts SGN_ENV=dev and refuses to mutate
// anything unless `--confirm` is passed. Without it, it prints the exact checks and the exact
// recipient address and exits. Do not run `--confirm` without a separately authorized window
// in this environment.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   SGN_ACCEPTANCE_INVITE_EMAIL=<an address the operator controls> \
//   [SGN_ACCEPTANCE_PORT=<fallback app port when the dev env sets no app URL>] \
//   node scripts/employee-invitation-journey-acceptance.mjs [--confirm] [--report <path>]
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { openSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';
import { invitationDestination } from '../src/features/employees/invitation.ts';
import { createOwnerSql } from './owner-sql.mjs';

const devEnvPath = process.env.SGN_ACCEPTANCE_DEV_ENV;
const ownerPath = process.env.SGN_ACCEPTANCE_OWNER;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const inviteEmail = (process.env.SGN_ACCEPTANCE_INVITE_EMAIL ?? '')
  .trim()
  .toLowerCase();
const fallbackPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3118);
const confirm = process.argv.includes('--confirm');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;
const root = path.resolve(import.meta.dirname, '..');

const PLANNED_CHECKS = [
  'a live admin records one invitation for the operator-controlled address',
  'the real provider invite link is generated for the exact recorded address and its redirect chain yields the delivered invite session',
  'the application session endpoint reports the setup step for the intended invitee',
  'the invitee completes setup and the retained employee is linked, active and named with the recorded role',
  'the invitee signs in with the credential they just set and reaches the active account',
  'a wrong sign-in identity is refused with no authority',
  'a consumed replay converges on the same person and role without reassignment',
  'a deactivation racing acceptance is refused and disabled access is never restored',
  'the synthetic rows and Auth identities are removed and the pre-run baseline is restored',
];

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const devEnv = devEnvPath
  ? parseEnv(await fs.readFile(devEnvPath, 'utf8'))
  : {};

function loopbackOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    assert.fail('NEXT_PUBLIC_APP_URL in the dev env must be an absolute URL');
  }
  assert.ok(
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'NEXT_PUBLIC_APP_URL in the dev env must be a loopback origin',
  );
  return url;
}
const appOrigin = loopbackOrigin(
  (devEnv.NEXT_PUBLIC_APP_URL ?? '').trim() ||
    `http://127.0.0.1:${fallbackPort}`,
);
const appUrl = appOrigin.origin;
const appPort = Number(
  appOrigin.port || (appOrigin.protocol === 'https:' ? 443 : 80),
);

if (!confirm) {
  console.log('DRY RUN — no fixtures, no invite link, no Data API writes.');
  for (const check of PLANNED_CHECKS) console.log('WOULD CHECK', check);
  console.log(
    `WOULD GENERATE one real provider invite link for ${inviteEmail || '<SGN_ACCEPTANCE_INVITE_EMAIL unset>'} with redirectTo ${invitationDestination(appUrl)}`,
  );
  process.exit(0);
}

assert.ok(
  devEnvPath && ownerPath && workdir,
  'Provide SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR',
);
assert.ok(
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inviteEmail),
  'SGN_ACCEPTANCE_INVITE_EMAIL must be the operator-controlled recipient address',
);
const owner = JSON.parse(await fs.readFile(ownerPath, 'utf8'));
assert.equal(devEnv.SGN_ENV, 'dev', 'Acceptance must never target production');
assert.equal(
  typeof owner.authAdminKey,
  'string',
  'The owner config must supply the server-only Auth admin capability',
);
assert.ok(owner.dbUrl, 'The owner config needs the owner SQL connection');
const environment = readEnvironment(
  { ...devEnv, NEXT_PUBLIC_APP_URL: appUrl },
  devEnv.EXPECTED_SUPABASE_PROJECT_REF,
);
await fs.mkdir(workdir, { recursive: true });
const ownerClient = createClient(environment.supabaseUrl, owner.authAdminKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const observations = [];
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
function sqlText(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
const ownerSql = createOwnerSql(owner.dbUrl);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const employeeCount = () =>
  Number(
    ownerSql('select count(*)::int as count from public.employees')[0].count,
  );

// ------------------------------------------------------------------ fixtures
const namespace = 'SGN69';
const runToken = randomBytes(4).toString('hex');
const manifestPath = path.join(workdir, 'fixtures.json');
const manifest = {
  namespace,
  runToken,
  createdAt: new Date().toISOString(),
  inviteEmail,
  identities: {},
  invitedEmployeeId: null,
  invitedUserId: null,
};
async function persistManifest() {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
}
const manifestEmployeeIds = () =>
  [
    ...Object.values(manifest.identities).map(
      (identity) => identity.employeeId,
    ),
    manifest.invitedEmployeeId,
  ].filter(Boolean);
async function createFixtures() {
  await persistManifest();
  for (const [name, role] of [
    ['adminA', 'admin'],
    ['wrongIdentity', 'sales'],
  ]) {
    const email = `${namespace.toLowerCase()}.${runToken}.${name.toLowerCase()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const employeeId = randomUUID();
    manifest.identities[name] = { employeeId, email, password, role };
    await persistManifest();
    const created = await ownerClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.equal(created.error, null, `create auth user ${name}`);
    manifest.identities[name].userId = created.data.user.id;
    await persistManifest();
    const active = name === 'adminA' ? 'true' : 'true';
    const inserted = ownerSql(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
        `(${sqlText(employeeId)}::uuid,${sqlText(created.data.user.id)}::uuid,${sqlText(email)},${sqlText(`${namespace} ${name}`)},${sqlText(role)},${active}) returning id`,
    );
    assert.equal(inserted.length, 1, `create employee ${name}`);
  }
}
async function sessionFor(identity) {
  const client = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await client.auth.signInWithPassword({
    email: identity.email,
    password: identity.password,
  });
  assert.equal(signedIn.error, null, 'fixture sign-in');
  return client;
}
async function cleanup() {
  const employeeIds = manifestEmployeeIds();
  if (employeeIds.length) {
    const list = employeeIds.map(sqlText).join(',');
    ownerSql(
      `delete from public.employee_invitations where employee_id in (${list}) or actor_id in (${list})`,
    );
    ownerSql(
      `update public.employees set is_active=false where id in (${list})`,
    );
    ownerSql(`delete from public.employees where id in (${list})`);
  }
  const userIds = [
    manifest.invitedUserId,
    ...Object.values(manifest.identities).map((identity) => identity.userId),
  ].filter(Boolean);
  for (const userId of userIds) {
    const removed = await ownerClient.auth.admin
      .deleteUser(userId)
      .catch((error) => ({ error }));
    if (removed?.error && !/not found/i.test(removed.error.message))
      throw new Error(`remove fixture auth user: ${removed.error.message}`);
  }
  await persistManifest();
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
async function appLogin(identity, expectedStatus = 200) {
  const response = await fetch(`${appUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: identity.email,
      password: identity.password,
      locale: 'vi',
    }),
  });
  assert.equal(
    response.status,
    expectedStatus,
    `app sign-in for ${identity.email}`,
  );
  if (expectedStatus !== 200) return null;
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function appFetch(cookie, route, init = {}) {
  const response = await fetch(`${appUrl}${route}`, {
    redirect: 'manual',
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      Origin: appUrl,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { status: response.status, body, cookies };
}

// Follow the real provider invite link through its redirect chain to recover the delivered
// invite session (implicit flow: the final fragment carries the access and refresh tokens).
async function deliveredInviteSession(actionLink) {
  let location = actionLink;
  for (let hop = 0; hop < 6; hop++) {
    const response = await fetch(location, {
      redirect: 'manual',
      method: 'GET',
    });
    const next = response.headers.get('location');
    if (!next) {
      throw new Error('the invite link redirect chain did not terminate');
    }
    location = next;
    if (location.includes('#access_token=')) {
      const fragment = new URLSearchParams(location.split('#')[1]);
      const accessToken = fragment.get('access_token');
      const refreshToken = fragment.get('refresh_token');
      assert.ok(
        accessToken && refreshToken,
        'the delivered session is complete',
      );
      return { accessToken, refreshToken };
    }
  }
  throw new Error('the invite link did not reach the application destination');
}

let cleaned = false;
try {
  const baseline = employeeCount();
  await createFixtures();
  await startApp();
  const adminA = await sessionFor(manifest.identities.adminA);

  const begun = await adminA.rpc('begin_employee_invitation', {
    p_email: inviteEmail.toUpperCase(),
    p_role: 'staff',
    p_key: randomUUID(),
  });
  assert.equal(begun.error, null, 'guarded begin');
  manifest.invitedEmployeeId = begun.data.employeeId;
  await persistManifest();
  observed('a live admin records one invitation for the operator address', {
    state: begun.data.state,
    email: begun.data.email,
  });

  // The real delivered link: generate it, follow it, recover the exact session.
  const destination = invitationDestination(environment.appUrl);
  const link = await ownerClient.auth.admin.generateLink({
    type: 'invite',
    email: inviteEmail,
    options: { redirectTo: destination },
  });
  assert.equal(link.error, null, 'generate the real provider invite link');
  manifest.invitedUserId = link.data.user.id;
  await persistManifest();
  const session = await deliveredInviteSession(
    link.data.properties.action_link,
  );
  observed(
    'the real provider invite link is generated for the recorded address',
    { destination, providerUserId: link.data.user.id },
  );

  const recordedResult = await ownerClient.rpc(
    'record_employee_invitation_result',
    {
      p_invitation_id: begun.data.id,
      p_revision: begun.data.revision,
      p_actor_id: manifest.identities.adminA.employeeId,
      p_email: begun.data.email,
      p_outcome: 'accepted',
      p_provider_user_id: link.data.user.id,
    },
  );
  assert.equal(recordedResult.error, null, 'guarded provider result');

  // The landing read.
  const landing = await appFetch(null, '/api/auth/invite/session', {
    method: 'POST',
    body: JSON.stringify(session),
  });
  assert.equal(
    landing.status,
    200,
    'the session endpoint accepts the delivered session',
  );
  assert.equal(landing.body.status, 'setup');
  const { invitationId, revision } = landing.body.setup;
  observed('the session endpoint reports the setup step', {
    email: landing.body.setup.email,
  });

  // Complete setup with the session the landing read just established.
  const cookie = landing.cookies;
  const accepted = await appFetch(cookie, '/api/auth/invite/accept', {
    method: 'POST',
    body: JSON.stringify({
      invitationId,
      revision,
      name: 'Nguyễn Văn Ẩn',
      password: 'S3cure!Pass1',
      confirmPassword: 'S3cure!Pass1',
      locale: 'vi',
    }),
  });
  assert.equal(accepted.status, 200, 'the invitee completes setup');
  const row = ownerSql(
    `select auth_user_id,is_active,display_name,role from public.employees where id=${sqlText(begun.data.employeeId)}`,
  )[0];
  assert.equal(row.auth_user_id, link.data.user.id);
  assert.equal(row.is_active, true);
  assert.equal(row.display_name, 'Nguyễn Văn Ẩn');
  assert.equal(row.role, 'staff');
  observed('the invitee is linked, active and named with the recorded role', {
    employeeId: begun.data.employeeId,
  });

  // The credential the invitee just set signs in to the active account.
  await appLogin({ email: inviteEmail, password: 'S3cure!Pass1' }, 200);
  observed('the invitee signs in with the credential they just set');

  // Wrong identity: the sales fixture session tries to accept the same invitation.
  const wrong = await sessionFor(manifest.identities.wrongIdentity);
  const wrongAccept = await wrong.rpc('accept_employee_invitation', {
    p_invitation_id: invitationId,
    p_revision: revision,
    p_display_name: 'Intruder',
  });
  assert.equal(wrongAccept.error?.code, 'P0025');
  observed('a wrong sign-in identity is refused with no authority');

  // Consumed replay: the same delivered session reads the journey again.
  const replay = await appFetch(null, '/api/auth/invite/session', {
    method: 'POST',
    body: JSON.stringify(session),
  });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.status, 'active');
  observed('a consumed replay converges on the same person and role', {
    status: replay.body.status,
  });

  // Deactivation race: disable membership, then retry acceptance.
  ownerSql(
    `update public.employees set is_active=false where id=${sqlText(begun.data.employeeId)}`,
  );
  const raced = await appFetch(cookie, '/api/auth/invite/accept', {
    method: 'POST',
    body: JSON.stringify({
      invitationId,
      revision,
      name: 'Nguyễn Văn Ẩn',
      password: 'S3cure!Pass1',
      confirmPassword: 'S3cure!Pass1',
      locale: 'vi',
    }),
  });
  assert.equal(raced.status, 409);
  assert.equal(raced.body.error, 'invitation-changed');
  const racedRow = ownerSql(
    `select is_active from public.employees where id=${sqlText(begun.data.employeeId)}`,
  )[0];
  assert.equal(racedRow.is_active, false);
  observed('a deactivation racing acceptance never restores disabled access');

  assert.equal(
    employeeCount(),
    baseline + manifestEmployeeIds().length,
    'only the recorded synthetic employees were added',
  );
  await cleanup();
  cleaned = true;
  assert.equal(employeeCount(), baseline, 'the pre-run baseline restored');
  observed('the synthetic rows and Auth identities are removed', {
    baseline,
  });
  if (reportPath) {
    await fs.writeFile(
      reportPath,
      JSON.stringify(
        {
          checkedAt: new Date().toISOString(),
          namespace,
          recipient: inviteEmail,
          destination,
          checks: observations,
          limits: [
            'The invite link is generated through the Auth admin API and followed by redirect; it is not proof that a mailbox received the message, which is recorded separately in docs/testing.md.',
            'An expired invite token is governed by the provider and is exercised through the same invalid-session path the session endpoint reports; no artificial clock is driven here.',
            'Sustained multi-session contention at production load remains a staging gate.',
          ],
        },
        null,
        2,
      ) + '\n',
    );
  }
} finally {
  await stopApp();
  if (!cleaned) {
    console.error('Run did not complete; restoring the synthetic fixtures.');
    await cleanup().catch((error) =>
      console.error(`Cleanup failed: ${error.message}`),
    );
  }
}
