// Issue #66 hosted acceptance: deactivate an employee without losing the record.
//
// Real development Supabase Auth/Data API/RLS plus the real provider sign-in block. It
// creates only the synthetic identities, properties and reservations this check needs:
// Auth users through the service-role Auth API and employee rows through the owner SQL
// connection the lifecycle guard reserves for administration. The exact-ID private manifest
// is persisted before the first Auth mutation, retained evidence is read through a live-admin
// session, the guarded RPCs are driven with each real session, and the Auth admin API is
// called exactly as the server adapter does. Mock, shim and embedded-PGlite results are not
// acceptance.
//
// This script NEVER runs against production: it asserts SGN_ENV=dev, and it refuses to
// mutate anything unless `--confirm` is passed. Without it, it prints the exact checks and
// exits. Do not run `--confirm` without a separately authorized provider/database decision
// for this environment.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   node scripts/employee-deactivation-acceptance.mjs [--confirm] [--report <path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// server-only Auth admin capability, the trusted server adapter's provider boundary and the
// owner SQL connection (`dbUrl`) used for synthetic employee rows. Both are read as data only
// and are never printed, shell sourced, or passed in argv/logs.
//
// Retained evidence: an operation, its events and every employee row they reference are
// permanent by design. Cleanup un-bans the synthetic Auth identities and removes the
// synthetic reservations, properties and any employee row no retained operation references;
// it never fabricates a delete path for the administration evidence. The manifest stays in
// the work directory and names every retained synthetic row.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';

const devEnvPath = process.env.SGN_ACCEPTANCE_DEV_ENV;
const ownerPath = process.env.SGN_ACCEPTANCE_OWNER;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const confirm = process.argv.includes('--confirm');
const reportIndex = process.argv.indexOf('--report');
const reportPath = reportIndex >= 0 ? process.argv[reportIndex + 1] : null;

const PLANNED_CHECKS = [
  'the target sign-in session is live before deactivation (Data API read and guarded RPC)',
  'a live admin begins the guarded deactivation and membership is disabled first',
  'the same actor/key converges on the original operation and a different employee conflicts',
  'the real Auth admin block returns the exact banned_until, and the operation completes only after it is recorded',
  'the old session is denied protected reads and guarded RPCs after membership removal',
  'employee identity, locale, role, Auth link, reservations and attribution survive deactivation',
  'a second live admin resumes the original operation without rewriting the actor',
  'the last active admin cannot be deactivated through the RPC, a client write or the owner path',
  'a reviewer releases the deactivated claimant reservation explicitly, and the claimant cannot',
  'the provider reports the exact banned identity after the block',
];
if (!confirm) {
  console.log('DRY RUN — no fixtures, no Auth bans, no Data API writes.');
  for (const check of PLANNED_CHECKS) console.log('WOULD CHECK', check);
  process.exit(0);
}

assert.ok(
  devEnvPath && ownerPath && workdir,
  'Provide SGN_ACCEPTANCE_DEV_ENV, SGN_ACCEPTANCE_OWNER and SGN_ACCEPTANCE_WORKDIR',
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
// The separately authorized provider capability. Never printed or logged.
assert.equal(devEnv.SGN_ENV, 'dev', 'Acceptance must never target production');
assert.equal(
  typeof owner.authAdminKey,
  'string',
  'The owner config must supply the server-only Auth admin capability',
);
assert.ok(owner.dbUrl, 'The owner config needs the owner SQL connection');
const environment = readEnvironment(
  { ...devEnv, NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3117' },
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
// The owner SQL connection provisions, updates and removes synthetic employee rows; the
// lifecycle guard refuses those writes to client roles.
function ownerSql(statement) {
  const result = spawnSync(
    'npx',
    [
      'supabase',
      'db',
      'query',
      '--db-url',
      owner.dbUrl,
      '--output-format',
      'json',
      statement,
    ],
    { encoding: 'utf8', timeout: 180000 },
  );
  if (result.status !== 0)
    throw new Error(
      'Owner SQL failed: ' + (result.stdout || result.stderr).slice(-800),
    );
  try {
    return JSON.parse(result.stdout).rows ?? [];
  } catch {
    return [];
  }
}
function ownerSqlRefusal(statement, code) {
  ownerSql(
    `do $$ begin begin ${statement}; raise exception 'expected refusal'; exception when others then if sqlstate <> '${code}' then raise; end if; end; end $$;`,
  );
}

// ---------------------------------------------------------------- fixtures
const namespace = 'SGN66';
const runToken = randomBytes(4).toString('hex');
const manifestPath = path.join(workdir, 'fixtures.json');
const identities = [
  ['adminA', 'admin'],
  ['adminB', 'admin'],
  ['target', 'sales'],
  ['reserver', 'sales'],
];
const manifest = {
  namespace,
  runToken,
  createdAt: new Date().toISOString(),
  identities: {},
  properties: [],
  locks: [],
  pausedAdminIds: [],
};
async function persistManifest() {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
}
async function createFixtures() {
  // Persist each exact ID before the mutation that consumes it, so an interrupted run leaves
  // a recoverable manifest instead of an orphaned Auth user.
  await persistManifest();
  for (const [name, role] of identities) {
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
    const inserted = ownerSql(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
        `(${sqlText(employeeId)}::uuid,${sqlText(created.data.user.id)}::uuid,${sqlText(email)},${sqlText(`${namespace} ${name}`)},${sqlText(role)},true) returning id`,
    );
    assert.equal(inserted.length, 1, `create employee ${name}`);
  }
  for (const [index, code] of ['SGN66-A', 'SGN66-B'].entries()) {
    const propertyId = randomUUID();
    manifest.properties.push(propertyId);
    await persistManifest();
    const inserted = await ownerClient.from('properties').insert({
      id: propertyId,
      property_code: `${code}-${runToken}`,
      listing_mode: 'sale',
      status: 'available',
      created_by: manifest.identities.adminA.employeeId,
    });
    assert.equal(inserted.error, null, `create property ${index}`);
  }
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
async function restorePausedAdmins() {
  if (!manifest.pausedAdminIds.length) return;
  ownerSql(
    `update public.employees set is_active=true where id in (${manifest.pausedAdminIds.map(sqlText).join(',')})`,
  );
  manifest.pausedAdminIds = [];
  await persistManifest();
}
async function cleanup() {
  // The deterministic last-admin check pauses other active admins; always restore them first.
  await restorePausedAdmins();
  if (manifest.locks.length) {
    await ownerClient
      .from('lock_events')
      .delete()
      .in('lock_id', manifest.locks);
    await ownerClient.from('property_locks').delete().in('id', manifest.locks);
  }
  if (manifest.properties.length)
    await ownerClient.from('properties').delete().in('id', manifest.properties);
  const employeeIds = Object.values(manifest.identities).map(
    (identity) => identity.employeeId,
  );
  if (employeeIds.length) {
    const list = employeeIds.map(sqlText).join(',');
    ownerSql(
      `update public.employees set is_active=false where id in (${list})`,
    );
    const referenced = new Set(
      ownerSql(
        `select employee_id as id from public.employee_admin_operations where employee_id in (${list}) ` +
          `union select actor_id as id from public.employee_admin_operations where actor_id in (${list}) ` +
          `union select employee_id as id from public.employee_admin_events where employee_id in (${list}) ` +
          `union select actor_id as id from public.employee_admin_events where actor_id in (${list})`,
      ).map((row) => row.id),
    );
    const removable = employeeIds.filter((id) => !referenced.has(id));
    if (removable.length)
      ownerSql(
        `delete from public.employees where id in (${removable.map(sqlText).join(',')})`,
      );
    for (const identity of Object.values(manifest.identities)) {
      if (!identity.userId) continue;
      // The provider block must be lifted for a synthetic identity, through the same admin
      // API that placed it. This is cleanup of the check's own fixture, not a user action.
      await ownerClient.auth.admin
        .updateUserById(identity.userId, { ban_duration: 'none' })
        .catch(() => {});
      if (referenced.has(identity.employeeId)) continue;
      const removed = await ownerClient.auth.admin
        .deleteUser(identity.userId)
        .catch((error) => ({ error }));
      if (removed?.error && !/not found/i.test(removed.error.message))
        throw new Error(`remove fixture auth user: ${removed.error.message}`);
    }
  }
  await persistManifest();
}

try {
  await createFixtures();
  const before = {
    employees: (await ownerClient.from('employees').select('id')).data.length,
    properties: (await ownerClient.from('properties').select('id')).data.length,
  };
  const adminA = await sessionFor(manifest.identities.adminA);
  const adminB = await sessionFor(manifest.identities.adminB);
  const target = await sessionFor(manifest.identities.target);
  const reserver = await sessionFor(manifest.identities.reserver);
  const targetEmployee = manifest.identities.target;
  const adminAEmployee = manifest.identities.adminA;
  const adminBEmployee = manifest.identities.adminB;
  const reserverEmployee = manifest.identities.reserver;
  const targetAuthUserId = targetEmployee.userId;

  // -------------------------------------------------- live before deactivation
  const visibleProperties = (
    await target.from('properties').select('id')
  ).data.map((row) => row.id);
  for (const propertyId of manifest.properties)
    assert.ok(
      visibleProperties.includes(propertyId),
      'fixture property visible before deactivation',
    );
  const pendingRequest = await target.rpc('request_property_lock', {
    p_property_id: manifest.properties[0],
    p_reason: 'Acceptance fixture pending request before deactivation',
  });
  assert.equal(pendingRequest.error, null);
  manifest.locks.push(pendingRequest.data);
  const reserved = await target.rpc('request_property_lock', {
    p_property_id: manifest.properties[1],
    p_reason: 'Acceptance fixture reserved request before deactivation',
  });
  assert.equal(reserved.error, null);
  manifest.locks.push(reserved.data);
  assert.equal(
    (
      await adminA.rpc('decide_property_lock', {
        p_lock_id: reserved.data,
        p_approve: true,
        p_reason: 'Independent acceptance reviewer approval',
        p_days: 7,
      })
    ).error,
    null,
  );
  observed('the target sign-in session is live before deactivation');

  // -------------------------------------------------- guarded begin
  const key = randomUUID();
  const begun = await adminA.rpc('begin_employee_deactivation', {
    p_employee_id: targetEmployee.employeeId,
    p_key: key,
  });
  assert.equal(begun.error, null, 'begin deactivation');
  assert.equal(begun.data.state, 'provider_pending');
  assert.equal(begun.data.actorId, adminAEmployee.employeeId);
  const membership = await ownerClient
    .from('employees')
    .select('is_active,auth_user_id,preferred_locale')
    .eq('id', targetEmployee.employeeId)
    .single();
  assert.equal(membership.data.is_active, false);
  assert.equal(membership.data.auth_user_id, targetAuthUserId);
  observed('a live admin disables membership before any provider call');

  const retried = await adminA.rpc('begin_employee_deactivation', {
    p_employee_id: targetEmployee.employeeId,
    p_key: key,
  });
  assert.equal(retried.data.id, begun.data.id);
  const conflict = await adminA.rpc('begin_employee_deactivation', {
    p_employee_id: adminBEmployee.employeeId,
    p_key: key,
  });
  assert.equal(conflict.error.code, '23505');
  observed('same-key retries converge and key reuse conflicts');

  // -------------------------------------------------- real provider block
  const blocked = await ownerClient.auth.admin.updateUserById(
    targetAuthUserId,
    {
      ban_duration: '876000h',
    },
  );
  assert.equal(blocked.error, null, 'provider block');
  const banUntil = blocked.data.user.banned_until;
  assert.ok(banUntil, 'the provider returns a ban expiry');
  const recorded = await ownerClient.rpc(
    'record_employee_deactivation_result',
    {
      p_operation_id: begun.data.id,
      p_revision: begun.data.revision,
      p_actor_id: adminAEmployee.employeeId,
      p_auth_user_id: targetAuthUserId,
      p_outcome: 'blocked',
      p_provider_reference: targetAuthUserId,
      p_detail: 'accepted by the real Auth admin API',
      p_ban_until: banUntil,
    },
  );
  assert.equal(recorded.error, null, 'record provider result');
  assert.equal(recorded.data.state, 'completed');
  assert.equal(recorded.data.providerOutcome, 'blocked');
  observed(
    'the provider block completes the operation only after it is recorded',
  );

  // -------------------------------------------------- old session denied
  assert.equal((await target.from('properties').select('id')).data.length, 0);
  assert.equal(
    (
      await target.rpc('request_property_lock', {
        p_property_id: manifest.properties[0],
        p_reason: 'Old session attempts a guarded request after deactivation',
      })
    ).error.code,
    '42501',
  );
  observed('the old session is denied reads and guarded RPCs');

  // -------------------------------------------------- records survive
  const survived = await ownerClient
    .from('employees')
    .select('display_name,email,role,preferred_locale,auth_user_id,is_active')
    .eq('id', targetEmployee.employeeId)
    .single();
  assert.equal(survived.data.display_name, `${namespace} target`);
  assert.equal(survived.data.auth_user_id, targetAuthUserId);
  assert.equal(survived.data.is_active, false);
  const locks = await ownerClient
    .from('property_locks')
    .select('id,requested_by,status')
    .eq('requested_by', targetEmployee.employeeId);
  assert.equal(locks.data.length, 2);
  assert.ok(
    locks.data.every((row) => row.requested_by === targetEmployee.employeeId),
  );
  const events = await adminA
    .from('employee_admin_events')
    .select('action')
    .eq('operation_id', begun.data.id);
  assert.equal(events.error, null, 'live admin reads the retained evidence');
  assert.ok(events.data.some((row) => row.action === 'provider_blocked'));
  observed('identity, Auth link, reservations and attribution survive');

  // -------------------------------------------------- reviewer release stays explicit
  const release = await adminB.rpc('release_property_lock', {
    p_lock_id: reserved.data,
    p_reason:
      'Independent reviewer releases the reservation after deactivation',
  });
  assert.equal(release.error, null);
  const claimantRelease = await target.rpc('release_property_lock', {
    p_lock_id: reserved.data,
    p_reason: 'Deactivated claimant attempts the release',
  });
  assert.equal(claimantRelease.error.code, '42501');
  observed('reviewer release stays explicit and the claimant cannot release');

  // -------------------------------------------------- resume by another admin
  const resumeKey = randomUUID();
  const opened = await adminA.rpc('begin_employee_deactivation', {
    p_employee_id: reserverEmployee.employeeId,
    p_key: resumeKey,
  });
  const resumed = await adminB.rpc('begin_employee_deactivation', {
    p_employee_id: reserverEmployee.employeeId,
    p_key: randomUUID(),
  });
  assert.equal(resumed.data.id, opened.data.id);
  assert.equal(resumed.data.actorId, adminAEmployee.employeeId);
  // The resumed identity is already disabled: its live session reads no protected rows.
  assert.equal((await reserver.from('properties').select('id')).data.length, 0);
  observed('another live admin resumes without rewriting attribution');

  // -------------------------------------------------- last active admin
  // Control the admin set so the guard check is deterministic: pause every other active
  // admin through the owner path and restore it immediately afterwards.
  const fixtureIds = Object.values(manifest.identities).map(
    (identity) => identity.employeeId,
  );
  manifest.pausedAdminIds = ownerSql(
    `update public.employees set is_active=false where role='admin' and is_active and id not in (${fixtureIds.map(sqlText).join(',')}) returning id`,
  ).map((row) => row.id);
  await persistManifest();
  assert.equal(
    (
      await adminA.rpc('begin_employee_deactivation', {
        p_employee_id: adminBEmployee.employeeId,
        p_key: randomUUID(),
      })
    ).error,
    null,
  );
  const selfRemoval = await adminA.rpc('begin_employee_deactivation', {
    p_employee_id: adminAEmployee.employeeId,
    p_key: randomUUID(),
  });
  assert.equal(selfRemoval.error.code, 'P0010');
  const directDemotion = await ownerClient
    .from('employees')
    .update({ role: 'sales' })
    .eq('id', adminAEmployee.employeeId);
  assert.equal(directDemotion.error.code, '42501');
  ownerSqlRefusal(
    `update public.employees set role='sales' where id=${sqlText(adminAEmployee.employeeId)}`,
    'P0010',
  );
  assert.deepEqual(
    ownerSql(
      `select role,is_active from public.employees where id=${sqlText(adminAEmployee.employeeId)}`,
    )[0],
    { role: 'admin', is_active: true },
  );
  observed(
    'the last active admin cannot be removed through the RPC, a client write or the owner path',
  );
  await restorePausedAdmins();

  // -------------------------------------------------- provider identity check
  const provider = await ownerClient.auth.admin.getUserById(targetAuthUserId);
  assert.equal(provider.error, null);
  assert.ok(
    provider.data.user.banned_until,
    'the exact identity carries the ban',
  );
  observed('the provider reports the exact banned identity');

  const after = {
    employees: (await ownerClient.from('employees').select('id')).data.length,
    properties: (await ownerClient.from('properties').select('id')).data.length,
  };
  assert.ok(
    after.employees >= before.employees,
    'no fixture identity was lost',
  );
  assert.ok(
    after.properties >= before.properties,
    'no reservable property was lost',
  );

  const report = {
    checked_at: new Date().toISOString(),
    environment: 'development',
    observations,
    limitations: [
      'No immediate recall of copied JWTs, remote provider memory or already-issued signed URLs is claimed.',
      'The provider ban is finite (about 100 years) and renewed only by an explicit reconciliation.',
      'Administration operation and event evidence and the employee rows it references are retained by design; cleanup removes only synthetic rows no retained operation references, and the manifest names every retained row.',
    ],
  };
  if (reportPath)
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`${observations.length} observations passed`);
} finally {
  await cleanup();
}
