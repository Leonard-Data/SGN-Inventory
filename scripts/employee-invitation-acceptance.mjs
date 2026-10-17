// Issue #68 hosted acceptance: send a role-bound employee invitation.
//
// Real development Supabase Auth/Data API/RLS, the local real Next.js application and the real
// provider invitation. It creates only the synthetic identities and rows the invitation needs
// under an exact-ID private manifest, sends exactly one real provider invitation to an address
// the operator controls, and removes exactly what it created through the supported owner
// paths. Mock, shim, generated-link and embedded-PGlite results are not acceptance.
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
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node scripts/employee-invitation-acceptance.mjs [--confirm] [--report <path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// server-only Auth admin capability and the owner SQL connection (`dbUrl`) used for synthetic
// employee rows. Both are read as data only. The owner URL is passed to the Supabase CLI
// without its password for the fixture statements and the password is supplied through the
// environment, so no credential appears in argv; captured CLI output is redacted.
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
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3117);
const confirm = process.argv.includes('--confirm');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;
const root = path.resolve(import.meta.dirname, '..');
const appUrl = `http://127.0.0.1:${appPort}`;

const PLANNED_CHECKS = [
  'a live admin records one invitation for the operator-controlled address and the requested role',
  'the created employee is unlinked and inactive, carries the requested role and the normalized address as its only recorded identity, and the invitation starts provider_pending',
  'the real provider invitation is sent to that recorded address with the fixed application destination, and the recorded state becomes `recorded` only after the provider returns the exact intended identity',
  'the invited employee still has no sign-in link and no access after the accepted request',
  'the admin employee list shows the recorded invitation marker for the invited address',
  'a same-actor/key retry, a second admin resume and the application endpoint converge on the same invitation with exactly one employee and one invitation row',
  'an existing active or imported (unlinked) employee address is refused with its row untouched, and a role conflicting with the open invitation is refused',
  'a failed/ambiguous provider outcome stays visible and reconcilable on the same invitation',
  'anonymous, unlinked, inactive, sales and manager callers are refused by the endpoint and the guarded RPC',
  'the synthetic rows and the synthetic Auth identity are removed and the pre-run baseline is restored',
];
if (!confirm) {
  console.log(
    'DRY RUN — no fixtures, no provider invitation, no Data API writes.',
  );
  for (const check of PLANNED_CHECKS) console.log('WOULD CHECK', check);
  console.log(
    `WOULD SEND one real provider invitation to ${inviteEmail || '<SGN_ACCEPTANCE_INVITE_EMAIL unset>'} with redirectTo ${appUrl}/auth/invite`,
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

// ---------------------------------------------------------------- fixtures
const namespace = 'SGN68';
const runToken = randomBytes(4).toString('hex');
const manifestPath = path.join(workdir, 'fixtures.json');
const manifest = {
  namespace,
  runToken,
  createdAt: new Date().toISOString(),
  inviteEmail,
  identities: {},
  invitations: [],
  invitedEmployeeId: null,
  invitedUserId: null,
  importedEmployeeId: null,
};
async function persistManifest() {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
}
async function createFixtures() {
  await persistManifest();
  for (const [name, role] of [
    ['adminA', 'admin'],
    ['adminB', 'admin'],
    ['sales', 'sales'],
    ['manager', 'manager'],
    ['inactive', 'sales'],
    ['unlinked', 'sales'],
  ]) {
    const email = `${namespace.toLowerCase()}.${runToken}.${name.toLowerCase()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const employeeId = name === 'unlinked' ? null : randomUUID();
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
    if (!employeeId) continue;
    const active = name === 'inactive' ? 'false' : 'true';
    const inserted = ownerSql(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
        `(${sqlText(employeeId)}::uuid,${sqlText(created.data.user.id)}::uuid,${sqlText(email)},${sqlText(`${namespace} ${name}`)},${sqlText(role)},${active}) returning id`,
    );
    assert.equal(inserted.length, 1, `create employee ${name}`);
  }
  // An imported person with no linked sign-in identity: its address is a recorded employee,
  // not a new invitee.
  manifest.importedEmployeeId = randomUUID();
  await persistManifest();
  const imported = ownerSql(
    'insert into public.employees(id,email,display_name,role,is_active) values ' +
      `(${sqlText(manifest.importedEmployeeId)}::uuid,${sqlText(`${namespace.toLowerCase()}.${runToken}.imported@example.test`)},'SGN68 Imported','sales',false) returning id`,
  );
  assert.equal(imported.length, 1, 'create the imported employee');
  await persistManifest();
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
  const employeeIds = [
    manifest.invitedEmployeeId,
    manifest.importedEmployeeId,
    ...Object.values(manifest.identities).map(
      (identity) => identity.employeeId,
    ),
  ].filter(Boolean);
  if (employeeIds.length) {
    const list = employeeIds.map(sqlText).join(',');
    // The invitation guard retains the recorded evidence, so the owner connection removes the
    // check's own synthetic invitations first; the private audit trail keeps that evidence.
    ownerSql(
      `delete from public.employee_invitations where employee_id in (${list}) or actor_id in (${list})`,
    );
    // Membership is disabled before the rows are removed so the last-active-admin guard stays
    // satisfied for the two synthetic admins.
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
  manifest.invitations = [];
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
  if (expectedStatus !== 200) {
    const body = await response.json().catch(() => null);
    assert.equal(
      body?.error,
      'access-denied',
      `sign-in refusal ${identity.email}`,
    );
    return null;
  }
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
  return { status: response.status, body };
}
async function findListed(cookie, employeeId) {
  let after = null;
  for (let page = 0; page < 20; page++) {
    const listing = await appFetch(
      cookie,
      '/api/employees' + (after ? `?after=${after}` : ''),
    );
    assert.equal(listing.status, 200, 'the admin employee list');
    const found = listing.body.employees.find(
      (employee) => employee.id === employeeId,
    );
    if (found) return found;
    if (!listing.body.nextCursor) return null;
    after = listing.body.nextCursor;
  }
  return null;
}

let cleaned = false;
try {
  await createFixtures();
  const baseline = employeeCount();
  await startApp();
  const adminACookie = await appLogin(manifest.identities.adminA);
  const adminA = await sessionFor(manifest.identities.adminA);
  const adminB = await sessionFor(manifest.identities.adminB);
  const begin = async (client, email, role, key) =>
    await client.rpc('begin_employee_invitation', {
      p_email: email,
      p_role: role,
      p_key: key,
    });
  const record = async (outcome, invitation, extra = {}) =>
    await ownerClient.rpc('record_employee_invitation_result', {
      p_invitation_id: invitation.id,
      p_revision: invitation.revision,
      p_actor_id: manifest.identities.adminA.employeeId,
      p_email: invitation.email,
      p_outcome: outcome,
      p_provider_user_id: extra.providerUserId ?? null,
      p_detail: extra.detail ?? null,
    });

  // --- The real invitation journey ---------------------------------------------------------
  const key = randomUUID();
  const begun = await begin(adminA, inviteEmail.toUpperCase(), 'staff', key);
  assert.equal(begun.error, null, 'guarded begin');
  manifest.invitations.push(begun.data.id);
  manifest.invitedEmployeeId = begun.data.employeeId;
  await persistManifest();
  observed('a live admin records one invitation for the operator address', {
    state: begun.data.state,
    role: begun.data.role,
    email: begun.data.email,
    revision: begun.data.revision,
  });
  const invitedRow = ownerSql(
    `select email,display_name,role,is_active,auth_user_id from public.employees where id=${sqlText(begun.data.employeeId)}`,
  )[0];
  assert.equal(begun.data.state, 'provider_pending');
  assert.equal(
    begun.data.email,
    inviteEmail,
    'the recorded address is normalized',
  );
  assert.equal(begun.data.role, 'staff');
  assert.equal(invitedRow.email, inviteEmail);
  assert.equal(invitedRow.is_active, false, 'sending is not activation');
  assert.equal(invitedRow.auth_user_id, null, 'sending does not link');
  assert.equal(
    invitedRow.display_name,
    invitedRow.email,
    'no name is invented',
  );
  observed(
    'the created employee is unlinked and inactive with the requested role',
    { employeeId: begun.data.employeeId },
  );

  const destination = invitationDestination(environment.appUrl);
  const sent = await ownerClient.auth.admin.inviteUserByEmail(inviteEmail, {
    redirectTo: destination,
  });
  assert.equal(
    sent.error,
    null,
    'the real provider invitation request must be accepted',
  );
  assert.equal(
    sent.data.user.email,
    inviteEmail,
    'the provider names the intended address',
  );
  manifest.invitedUserId = sent.data.user.id;
  await persistManifest();
  const recordedResult = await record('accepted', begun.data, {
    providerUserId: sent.data.user.id,
  });
  assert.equal(recordedResult.error, null, 'guarded provider result');
  assert.equal(recordedResult.data.state, 'recorded');
  const providerUser = await ownerClient.auth.admin.getUserById(
    sent.data.user.id,
  );
  observed(
    'the real provider accepted the invitation for the recorded address',
    {
      destination,
      providerEmail: providerUser.data.user?.email ?? null,
      invitedAt: providerUser.data.user?.invited_at ?? null,
      confirmationSentAt: providerUser.data.user?.confirmation_sent_at ?? null,
      state: recordedResult.data.state,
    },
  );
  assert.equal(
    providerUser.data.user?.email,
    inviteEmail,
    'the provider identity matches the recorded address',
  );
  const afterInvite = ownerSql(
    `select email,role,is_active,auth_user_id from public.employees where id=${sqlText(begun.data.employeeId)}`,
  )[0];
  assert.deepEqual(
    [
      afterInvite.email,
      afterInvite.role,
      afterInvite.is_active,
      Boolean(afterInvite.auth_user_id),
    ],
    [inviteEmail, 'staff', false, false],
  );
  observed('an accepted provider request links and activates nobody', {
    employeeId: begun.data.employeeId,
  });

  // --- Recorded marker, convergence and refusals ------------------------------------------
  const listed = await findListed(adminACookie, begun.data.employeeId);
  assert.ok(listed, 'the invited employee is listed');
  assert.equal(listed.access, 'unlinked');
  assert.equal(listed.invitation.state, 'recorded');
  assert.equal(listed.invitation.revision >= 2, true);
  observed('the recorded invitation marker is shown for the invited address', {
    access: listed.access,
    invitationState: listed.invitation.state,
  });

  const retried = await begin(adminA, inviteEmail, 'staff', key);
  assert.equal(retried.error, null);
  assert.equal(retried.data.id, begun.data.id, 'same-key retry converges');
  const resumed = await begin(adminB, inviteEmail, 'staff', randomUUID());
  assert.equal(resumed.error, null);
  assert.equal(
    resumed.data.id,
    begun.data.id,
    'another admin resumes the same invitation',
  );
  assert.equal(resumed.data.actorId, manifest.identities.adminA.employeeId);
  const endpoint = await appFetch(adminACookie, '/api/employees/invitations', {
    method: 'POST',
    body: JSON.stringify({
      email: inviteEmail,
      role: 'staff',
      key,
    }),
  });
  assert.equal(
    endpoint.status,
    200,
    'the endpoint returns the recorded invitation',
  );
  assert.equal(endpoint.body.invitation.state, 'recorded');
  assert.equal(endpoint.body.employee.id, begun.data.employeeId);
  const redisplayed = await appFetch(
    adminACookie,
    `/api/employees/invitations?email=${encodeURIComponent(inviteEmail)}`,
  );
  assert.equal(redisplayed.status, 200);
  assert.equal(redisplayed.body.invitation.state, 'recorded');
  const rows = ownerSql(
    `select (select count(*)::int from public.employees where email=${sqlText(inviteEmail)}) as employees,` +
      ` (select count(*)::int from public.employee_invitations where email=${sqlText(inviteEmail)}) as invitations`,
  )[0];
  assert.deepEqual(rows, { employees: 1, invitations: 1 });
  observed(
    'a retry, a second admin and the application endpoint converge on one invitation and one person',
    {
      invitationId: begun.data.id,
      endpointStatus: endpoint.status,
      endpointState: endpoint.body?.invitation?.state ?? null,
    },
  );

  const refusedExisting = await begin(
    adminA,
    manifest.identities.sales.email,
    'sales',
    randomUUID(),
  );
  assert.equal(refusedExisting.error?.code, 'P0020');
  const salesRow = ownerSql(
    `select role,is_active,auth_user_id from public.employees where id=${sqlText(manifest.identities.sales.employeeId)}`,
  )[0];
  assert.deepEqual(
    [salesRow.role, salesRow.is_active, Boolean(salesRow.auth_user_id)],
    ['sales', true, true],
  );
  const refusedImported = await begin(
    adminA,
    `${namespace.toLowerCase()}.${runToken}.imported@example.test`,
    'sales',
    randomUUID(),
  );
  assert.equal(refusedImported.error?.code, 'P0020');
  const importedRow = ownerSql(
    `select role,is_active,auth_user_id from public.employees where id=${sqlText(manifest.importedEmployeeId)}`,
  )[0];
  assert.deepEqual(
    [importedRow.role, importedRow.is_active, importedRow.auth_user_id],
    ['sales', false, null],
  );
  observed(
    'an existing active or imported employee address is refused unchanged',
  );

  const conflictEmail = `${namespace.toLowerCase()}.${runToken}.conflict@example.test`;
  const openInvitation = await begin(
    adminA,
    conflictEmail,
    'sales',
    randomUUID(),
  );
  assert.equal(openInvitation.error, null);
  manifest.invitations.push(openInvitation.data.id);
  const conflicting = await begin(adminB, conflictEmail, 'admin', randomUUID());
  assert.equal(conflicting.error?.code, 'P0022');
  const ambiguous = await record('ambiguous', openInvitation.data, {
    detail: 'acceptance check: recorded provider ambiguity',
  });
  assert.equal(ambiguous.error, null);
  assert.equal(ambiguous.data.state, 'provider_failed');
  assert.equal(ambiguous.data.providerOutcome, 'ambiguous');
  const resumedFailed = await begin(
    adminB,
    conflictEmail,
    'sales',
    randomUUID(),
  );
  assert.equal(resumedFailed.data.id, openInvitation.data.id);
  observed(
    'a conflicting role is refused and an ambiguous outcome reconciles',
    {
      invitationId: openInvitation.data.id,
      state: ambiguous.data.state,
    },
  );

  // --- Authority ---------------------------------------------------------------------------
  for (const name of ['sales', 'manager', 'inactive', 'unlinked']) {
    const identity = manifest.identities[name];
    const deniedAddress = `${namespace.toLowerCase()}.${runToken}.denied@example.test`;
    const attempt = await begin(
      await sessionFor(identity),
      deniedAddress,
      'sales',
      randomUUID(),
    );
    assert.equal(attempt.error?.code, '42501', `${name} begin`);
    // An inactive or unlinked identity cannot hold an app session at all, so its app sign-in
    // is refused before the endpoint; only the live non-admin roles reach the endpoint denial.
    const refusedSession = name === 'inactive' || name === 'unlinked';
    const cookie = await appLogin(identity, refusedSession ? 403 : 200);
    if (refusedSession) continue;
    const denied = await appFetch(cookie, '/api/employees/invitations', {
      method: 'POST',
      body: JSON.stringify({
        email: deniedAddress,
        role: 'sales',
        key: randomUUID(),
      }),
    });
    assert.equal(denied.status, 403, `${name} endpoint`);
  }
  const anonymous = await appFetch(null, '/api/employees/invitations', {
    method: 'POST',
    body: JSON.stringify({
      email: inviteEmail,
      role: 'sales',
      key: randomUUID(),
    }),
  });
  assert.equal(anonymous.status, 401);
  const malformed = await appFetch(adminACookie, '/api/employees/invitations', {
    method: 'POST',
    body: JSON.stringify({
      email: 'not-an-email',
      role: 'owner',
      key: randomUUID(),
    }),
  });
  assert.equal(malformed.status, 400);
  const writePolicies = Number(
    ownerSql(
      "select count(*)::int as count from pg_policies where tablename='employee_invitations' and cmd in ('INSERT','UPDATE','DELETE')",
    )[0].count,
  );
  assert.equal(writePolicies, 0, 'no client write policy exists');
  observed(
    'authority and input bounds hold at the endpoint, the RPC and the table',
  );

  assert.equal(
    employeeCount(),
    baseline + 2,
    'only the invited and conflict employees were added',
  );
  await cleanup();
  cleaned = true;
  const finalCount = employeeCount();
  assert.equal(finalCount, baseline, 'the pre-run employee baseline restored');
  observed('the synthetic rows and Auth identities are removed', {
    baseline,
    restored: finalCount,
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
            'A provider-accepted invitation is not proof that the mailbox received the message; the operator-confirmed mailbox observation is recorded separately in docs/testing.md.',
            'The rendered browser journey over /people/employees is driven separately in the same window; this harness covers the real application endpoints, the guarded RPCs, RLS and the real provider send.',
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
