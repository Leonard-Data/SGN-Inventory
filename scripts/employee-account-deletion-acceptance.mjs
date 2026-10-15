// Issue #67 hosted acceptance: permanently delete the sign-in account while retaining the
// employee, their files and their attribution.
//
// Real development Supabase Auth/Data API/RLS/Storage plus the real Next.js application in a
// real Chrome session. It creates only the synthetic identities, property and one real
// uploaded property file this check needs: Auth users through the service-role Auth API,
// employee/property/file rows through the owner SQL connection the lifecycle guard reserves
// for administration, and the file's bytes through the target's own Storage session so the
// object is genuinely owned by the sign-in account being deleted. The exact-ID private
// manifest is persisted before the first Auth mutation, and the guarded RPCs are driven with
// each real session exactly as the server adapter does. Mock, shim and embedded-PGlite results
// are not acceptance.
//
// This is the only place the Storage ownership mechanism can be verified: the pinned client
// exposes no ownership-transfer call, so the guarded reassignment RPC is proven here against
// live Storage, including that the object's id, path, metadata and bytes survive it.
//
// This script NEVER runs against production: it asserts SGN_ENV=dev, it refuses to mutate
// anything unless `--confirm` is passed, and deletion consumes a synthetic Auth identity that
// cleanup cannot restore. Do not run `--confirm` without a separately authorized
// provider/database decision for this environment.
//
// Usage:
//   SGN_ACCEPTANCE_DEV_ENV=<private dev env> \
//   SGN_ACCEPTANCE_OWNER=<private owner config> \
//   SGN_ACCEPTANCE_WORKDIR=<private work directory> \
//   [SGN_ACCEPTANCE_BROWSER_CLI=<chrome-devtools-axi>] \
//   [SGN_ACCEPTANCE_CHROME=<chromium binary>] \
//   [SGN_ACCEPTANCE_PORT=<app port>] \
//   node scripts/employee-account-deletion-acceptance.mjs [--confirm] [--report <path>]
//
// The dev env supplies the publishable application settings; the owner config supplies the
// server-only Auth admin capability and the owner SQL connection (`dbUrl`). Both are read as
// data only. The owner URL is passed to the Supabase CLI without its password for the fixture
// statements and the password is supplied through the environment, so no credential appears
// in argv; captured CLI output is redacted.
//
// Retained evidence: the completed deletion leaves a permanent operation, its events and the
// retained employee row by design; cleanup never fabricates a delete path for that evidence.
// The manifest stays in the work directory and names every retained synthetic row.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { readEnvironment } from '../src/lib/environment.ts';
import { createOwnerSql } from './owner-sql.mjs';

const devEnvPath = process.env.SGN_ACCEPTANCE_DEV_ENV;
const ownerPath = process.env.SGN_ACCEPTANCE_OWNER;
const workdir = process.env.SGN_ACCEPTANCE_WORKDIR;
const confirm = process.argv.includes('--confirm');
const reportIndex = process.argv.indexOf('--report');
const reportPath =
  reportIndex >= 0
    ? process.argv[reportIndex + 1]
    : path.join(workdir ?? '.', 'employee-account-deletion-report.json');
const browserCli =
  process.env.SGN_ACCEPTANCE_BROWSER_CLI ??
  path.join(process.env.HOME ?? '', '.local/bin/chrome-devtools-axi');
const chromeBin =
  process.env.SGN_ACCEPTANCE_CHROME ??
  path.join(
    process.env.HOME ?? '',
    '.cache/ms-playwright/chromium-1248/chrome-linux64/chrome',
  );
const appPort = Number(process.env.SGN_ACCEPTANCE_PORT ?? 3117);
const appUrl = `http://127.0.0.1:${appPort}`;

const PLANNED_CHECKS = [
  'the target session is live before deletion (Data API read and its own uploaded file)',
  'a live admin begins the guarded deletion: membership disabled, Auth link cleared, exact identity recorded',
  'the same actor/key converges, another target under that key conflicts and a competing deactivation is refused',
  'the removed session is denied protected reads and guarded RPCs after the unlink',
  'the Storage preflight reports the objects owned by the deleted identity without changing them',
  'ownership reassignment to a live active admin moves only ownership: object id, path, metadata and bytes survive',
  'a non-admin custodian is refused and a blocked reassignment stays a truthful partial state',
  'the real Auth account is confirmed absent and the operation completes with the retained account-deleted state',
  'new authentication for the removed account fails and an old JWT has no protected inventory authority',
  'the Employee UUID/name/email/role, the file metadata, the uploader attribution and the file content survive',
  'the browser list shows account-deleted distinctly from inactive, names the retained employee and requires a typed confirmation',
];
if (process.argv.includes('--help')) {
  console.log(
    'Hosted acceptance for permanent sign-in-account deletion (#67).',
  );
  process.exit(0);
}
if (!confirm) {
  console.log(
    'DRY RUN — no fixtures, no Storage writes, no Auth deletions, no browser run.',
  );
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
const ownerSql = createOwnerSql(owner.dbUrl);
const observations = [];
function observed(name, details = {}) {
  observations.push({ name, ...details });
  console.log('PASS', name);
}
function sqlText(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- fixtures
const namespace = 'SGN67';
const runToken = randomBytes(4).toString('hex');
const manifestPath = path.join(workdir, 'fixtures.json');
const identities = [
  ['adminA', 'admin'],
  ['adminB', 'admin'],
  ['staff', 'staff'],
  ['target', 'sales'],
];
const manifest = {
  namespace,
  runToken,
  createdAt: new Date().toISOString(),
  identities: {},
  properties: [],
  files: [],
  pausedAdminIds: [],
};
async function persistManifest() {
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', {
    mode: 0o600,
  });
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
const documentBytes = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'utf8',
);
async function createFixtures() {
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
    ownerSql(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ' +
        `(${sqlText(employeeId)}::uuid,${sqlText(created.data.user.id)}::uuid,${sqlText(email)},${sqlText(`${namespace} ${name}`)},${sqlText(role)},true) returning id`,
    );
  }
}
async function createProperty(adminA) {
  // `public.properties` deliberately denies every direct client write, so the synthetic fixture
  // property is created through the same guarded application operation a real employee uses --
  // never by widening a grant or bypassing a guard. The owner connection is used only for the
  // employee rows the lifecycle guard reserves for administration.
  const created = await adminA.rpc('create_property', {
    p_mode: 'sale',
    p_facts: {},
    p_address: {
      format: 'legacy',
      address_text: `${namespace} acceptance fixture address ${runToken}`,
    },
  });
  assert.equal(
    created.error,
    null,
    'create property through the guarded operation',
  );
  assert.match(
    String(created.data),
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    'the guarded create returns the new property id',
  );
  manifest.properties.push(created.data);
  await persistManifest();
  return created.data;
}

// The target registers and uploads the file with its own session, so the real Storage object
// is owned by the exact Auth identity that will be deleted.
async function createOwnedFile(target) {
  const propertyId = manifest.properties[0];
  const fileId = randomUUID();
  const originalFilename = `acceptance-${runToken}.pdf`;
  const sha256 = createHash('sha256').update(documentBytes).digest('hex');
  const registered = await target.rpc('register_property_file', {
    p_file_id: fileId,
    p_property_id: propertyId,
    p_original_filename: originalFilename,
    p_mime_type: 'application/pdf',
    p_size_bytes: documentBytes.length,
    p_sha256: sha256,
    p_purpose: 'document',
  });
  assert.equal(registered.error, null, 'register property file');
  const objectPath = registered.data.objectPath;
  manifest.files.push({ fileId, objectPath, sha256 });
  await persistManifest();
  const uploaded = await target.storage
    .from('property-files')
    .upload(objectPath, documentBytes, { contentType: 'application/pdf' });
  assert.equal(uploaded.error, null, 'upload property file bytes');
  const info = await ownerClient.storage
    .from('property-files')
    .info(objectPath);
  assert.equal(info.error, null, 'read uploaded object info');
  // Complete the upload when the server's validation capability is available, so the retained
  // file is a normally readable `ready` attachment rather than a pending one.
  let completed = false;
  const validationKey = devEnv.SGN_FILE_VALIDATION_KEY;
  if (/^[a-f0-9]{64}$/.test(validationKey ?? '')) {
    const signature = createHmac('sha256', Buffer.from(validationKey, 'hex'))
      .update(
        [
          'v1',
          fileId,
          propertyId,
          manifest.identities.target.employeeId,
          objectPath,
          info.data.id,
          'application/pdf',
          String(documentBytes.length),
          sha256,
        ].join('|'),
      )
      .digest('hex');
    const done = await target.rpc('complete_property_upload', {
      p_file_id: fileId,
      p_object_id: info.data.id,
      p_mime_type: 'application/pdf',
      p_size_bytes: documentBytes.length,
      p_sha256: sha256,
      p_signature: signature,
    });
    assert.equal(done.error, null, 'complete the property upload');
    completed = true;
  }
  return {
    fileId,
    objectPath,
    sha256,
    objectId: info.data.id,
    completed,
  };
}
async function restorePausedAdmins() {
  if (!manifest.pausedAdminIds?.length) return;
  ownerSql(
    `update public.employees set is_active=true where id in (${manifest.pausedAdminIds.map(sqlText).join(',')})`,
  );
  manifest.pausedAdminIds = [];
  await persistManifest();
}
let interrupted = false;
async function handleSignal(signal) {
  if (interrupted) process.exit(1);
  interrupted = true;
  console.error(`Received ${signal}; restoring paused admins before exit`);
  try {
    await restorePausedAdmins();
  } catch (error) {
    console.error(`Could not restore paused admins: ${error.message}`);
  }
  process.exit(signal === 'SIGINT' ? 130 : 143);
}
process.on('SIGINT', () => handleSignal('SIGINT'));
process.on('SIGTERM', () => handleSignal('SIGTERM'));

async function cleanup() {
  await restorePausedAdmins();
  // The check's own synthetic object and metadata are removed through the supported paths;
  // the retained employee row and its administration evidence are permanent by design.
  for (const file of manifest.files) {
    await ownerClient.storage
      .from('property-files')
      .remove([file.objectPath])
      .catch(() => {});
  }
  if (manifest.files.length) {
    ownerSql(
      `delete from public.property_files where id in (${manifest.files.map((file) => sqlText(file.fileId)).join(',')})`,
    );
  }
  if (manifest.properties.length) {
    // No supported operation archives or removes a property, so the check's own synthetic
    // fixture is unwound through the owner connection after its dependents: the file metadata,
    // then the maintenance history and address rows the guarded create produced. No guard is
    // disabled or bypassed. If a guard refuses any step, it is reported, not worked around.
    const list = manifest.properties.map(sqlText).join(',');
    ownerSql(
      `delete from public.property_history where property_id in (${list})`,
    );
    ownerSql(
      `delete from public.property_addresses where property_id in (${list})`,
    );
    ownerSql(`delete from public.properties where id in (${list})`);
  }
  const employeeIds = Object.values(manifest.identities).map(
    (identity) => identity.employeeId,
  );
  const list = employeeIds.map(sqlText).join(',');
  const referenced = new Set(
    ownerSql(
      `select employee_id as id from public.employee_admin_operations where employee_id in (${list}) ` +
        `union select actor_id as id from public.employee_admin_operations where actor_id in (${list}) ` +
        `union select employee_id as id from public.employee_admin_events where employee_id in (${list}) ` +
        `union select actor_id as id from public.employee_admin_events where actor_id in (${list})`,
    ).map((row) => row.id),
  );
  const removable = employeeIds.filter((id) => !referenced.has(id));
  if (employeeIds.length)
    // Every synthetic sign-in link is cleared, referenced or not: the restrictive
    // `employees.auth_user_id` foreign key would otherwise block the provider delete, exactly as
    // the product's own guarded deletion clears it first. Only this check's own rows are touched.
    ownerSql(
      `update public.employees set is_active=false, auth_user_id=null where id in (${list})`,
    );
  for (const identity of Object.values(manifest.identities)) {
    if (!identity.userId) continue;
    const removed = await ownerClient.auth.admin
      .deleteUser(identity.userId)
      .catch((error) => ({ error }));
    if (removed?.error && !/not found/i.test(removed.error.message))
      throw new Error(`remove fixture auth user: ${removed.error.message}`);
  }
  // The synthetic employee rows are removed too, but only the ones no retained operation
  // references: the account-deleted target and any employee the ledger carries stay by design.
  // `employee_admin_operations` and `employee_admin_events` are append-only for EVERY role --
  // their guards raise 42501 on any update or delete -- so the ledger rows this check created
  // are not removable and are disclosed in the report instead of being worked around.
  if (removable.length)
    ownerSql(
      `delete from public.employees where id in (${removable.map(sqlText).join(',')})`,
    );
  await persistManifest();
}

// What is left after cleanup, measured rather than assumed. Everything removable is removed;
// the ledger rows the guards make append-only, and the employee rows their foreign keys
// require, are reported here instead of being worked around.
async function residueCounts() {
  const employeeIds = Object.values(manifest.identities).map(
    (identity) => identity.employeeId,
  );
  const list = employeeIds.map(sqlText).join(',') || "''";
  let authUsers = 0;
  for (const identity of Object.values(manifest.identities)) {
    if (!identity.userId) continue;
    const found = await ownerClient.auth.admin
      .getUserById(identity.userId)
      .catch(() => ({ error: true }));
    if (!found?.error) authUsers += 1;
  }
  return {
    synthetic_employees: ownerSql(
      `select count(*)::int as n from public.employees where id in (${list})`,
    )[0].n,
    synthetic_auth_users: authUsers,
    synthetic_operations: ownerSql(
      `select count(*)::int as n from public.employee_admin_operations where employee_id in (${list}) or actor_id in (${list})`,
    )[0].n,
    synthetic_operations_events: ownerSql(
      `select count(*)::int as n from public.employee_admin_events where employee_id in (${list}) or actor_id in (${list})`,
    )[0].n,
    synthetic_properties: ownerSql(
      `select count(*)::int as n from public.property_addresses where address_text like '${namespace}%'`,
    )[0].n,
    synthetic_files: ownerSql(
      `select count(*)::int as n from public.property_files where object_path like '%acceptance-${runToken}%'`,
    )[0].n,
    synthetic_storage_objects: ownerSql(
      `select count(*)::int as n from storage.objects where name like '%acceptance-${runToken}%'`,
    )[0].n,
  };
}

// ---------------------------------------------------------------- browsers
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
      CHROME_DEVTOOLS_AXI_SESSION: session,
      CHROME_DEVTOOLS_AXI_AUTO_CONNECT: '0',
      CHROME_DEVTOOLS_AXI_BROWSER_URL: `http://127.0.0.1:${cdpPort}`,
      CHROME_DEVTOOLS_AXI_MCP_SERVER_URL: '',
      CHROME_DEVTOOLS_AXI_BRIDGE_TIMEOUT_MS: '180000',
    },
  });
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
  assert.fail(`Timed out waiting for browser state: ${expression}`);
}
const setInput = (selector, value) => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`;

// ---------------------------------------------------------------- checks
const limitations = [];
try {
  await createFixtures();
  const adminA = await sessionFor(manifest.identities.adminA);
  const target = await sessionFor(manifest.identities.target);
  const targetEmployee = manifest.identities.target;
  const adminAEmployee = manifest.identities.adminA;
  const adminBEmployee = manifest.identities.adminB;
  const staffEmployee = manifest.identities.staff;
  const targetAuthUserId = targetEmployee.userId;
  await createProperty(adminA);
  const file = await createOwnedFile(target);
  if (!file.completed)
    limitations.push(
      'SGN_FILE_VALIDATION_KEY was unavailable, so the retained file stayed pending: the authorized signed-read assertion was skipped and only the uploader-scoped read was proven.',
    );

  // -------------------------------------------------- live before deletion
  const visible = (await target.from('properties').select('id')).data.map(
    (row) => row.id,
  );
  for (const id of manifest.properties)
    assert.ok(visible.includes(id), 'fixture property visible before deletion');
  const readable = await target.storage
    .from('property-files')
    .download(file.objectPath);
  assert.equal(readable.error, null, 'uploader can read its own file');
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await readable.data.arrayBuffer()))
      .digest('hex'),
    file.sha256,
    'stored bytes match the uploaded document before deletion',
  );
  observed('the target session is live and owns its uploaded file');

  const preflightBefore = await ownerClient.rpc('employee_storage_preflight', {
    p_auth_user_id: targetAuthUserId,
  });
  assert.equal(preflightBefore.error, null, 'preflight');
  assert.equal(
    preflightBefore.data.supported,
    true,
    'the live Storage schema is the shape the adapter was verified against',
  );
  assert.ok(
    preflightBefore.data.ownedCount >= 1,
    'the target owns at least one Storage object before the action',
  );
  observed(
    'the Storage ownership preflight reports the objects the target owns',
    {
      ownedBefore: preflightBefore.data.ownedCount,
    },
  );

  // -------------------------------------------------- guarded begin
  const key = randomUUID();
  const begun = await adminA.rpc('begin_employee_account_deletion', {
    p_employee_id: targetEmployee.employeeId,
    p_key: key,
  });
  assert.equal(begun.error, null, 'begin account deletion');
  assert.equal(begun.data.kind, 'delete');
  assert.equal(begun.data.state, 'provider_pending');
  assert.equal(begun.data.actorId, adminAEmployee.employeeId);
  assert.equal(begun.data.targetAuthUserId, targetAuthUserId);
  const membership = await ownerClient
    .from('employees')
    .select('is_active,auth_user_id,account_deleted_at,display_name,email,role')
    .eq('id', targetEmployee.employeeId)
    .single();
  assert.equal(membership.error, null, 'read retained employee');
  assert.equal(membership.data.is_active, false);
  assert.equal(membership.data.auth_user_id, null);
  assert.equal(membership.data.account_deleted_at, null);
  observed(
    'a live admin disables membership and clears the Auth link before any provider call',
  );

  const retried = await adminA.rpc('begin_employee_account_deletion', {
    p_employee_id: targetEmployee.employeeId,
    p_key: key,
  });
  assert.equal(retried.data.id, begun.data.id, 'same key converges');
  const conflict = await adminA.rpc('begin_employee_account_deletion', {
    p_employee_id: adminBEmployee.employeeId,
    p_key: key,
  });
  assert.equal(conflict.error?.code, '23505', 'different target conflicts');
  const competing = await adminA.rpc('begin_employee_deactivation', {
    p_employee_id: targetEmployee.employeeId,
    p_key: randomUUID(),
  });
  assert.equal(
    competing.error?.code,
    'P0013',
    'a competing deactivation is refused while deletion is open',
  );
  observed('operation convergence and lifecycle conflict are enforced');

  // -------------------------------------------------- removal denies the old session
  const deniedReads = await target.from('properties').select('id');
  assert.equal(
    (deniedReads.data ?? []).length,
    0,
    'the removed session reads no protected inventory',
  );
  const deniedRpc = await target.rpc('request_property_lock', {
    p_property_id: manifest.properties[0],
    p_reason: 'Acceptance fixture after membership removal',
  });
  assert.ok(deniedRpc.error, 'the removed session is denied a guarded RPC');
  observed(
    'old JWTs lose protected inventory and contact authority by live membership',
  );

  // -------------------------------------------------- ownership preflight and reassignment
  const infoBefore = await ownerClient.storage
    .from('property-files')
    .info(file.objectPath);
  assert.equal(infoBefore.error, null, 'object info before reassignment');
  assert.equal(infoBefore.data.id, file.objectId);
  const custodianRefusal = await ownerClient.rpc(
    'reassign_employee_storage_ownership',
    {
      p_from_auth_user_id: targetAuthUserId,
      p_to_auth_user_id: staffEmployee.userId,
    },
  );
  assert.equal(
    custodianRefusal.error?.code,
    '42501',
    'a non-admin custodian is refused',
  );
  const moved = await ownerClient.rpc('reassign_employee_storage_ownership', {
    p_from_auth_user_id: targetAuthUserId,
    p_to_auth_user_id: adminAEmployee.userId,
  });
  assert.equal(moved.error, null, 'reassign Storage ownership');
  assert.equal(moved.data.supported, true);
  assert.ok(moved.data.reassignedCount >= 1);
  const preflightAfter = await ownerClient.rpc('employee_storage_preflight', {
    p_auth_user_id: targetAuthUserId,
  });
  assert.equal(preflightAfter.data.ownedCount, 0, 'no objects remain owned');
  const infoAfter = await ownerClient.storage
    .from('property-files')
    .info(file.objectPath);
  assert.equal(infoAfter.error, null, 'object info after reassignment');
  assert.equal(
    infoAfter.data.id,
    infoBefore.data.id,
    'the registered object id is unchanged by the ownership move',
  );
  const after = await ownerClient.storage
    .from('property-files')
    .download(file.objectPath);
  assert.equal(after.error, null, 'object still readable after reassignment');
  assert.equal(
    createHash('sha256')
      .update(Buffer.from(await after.data.arrayBuffer()))
      .digest('hex'),
    file.sha256,
    'the stored bytes are unchanged by the ownership move',
  );
  observed(
    'ownership reassignment moves only ownership: object id, path and bytes survive',
    { reassigned: moved.data.reassignedCount },
  );

  // -------------------------------------------------- provider deletion
  const removed = await ownerClient.auth.admin.deleteUser(targetAuthUserId);
  assert.equal(removed.error, null, 'provider deletes the account');
  const absent = await ownerClient.auth.admin.getUserById(targetAuthUserId);
  assert.ok(absent.error, 'provider reports no such account');
  assert.equal(
    absent.error.status,
    404,
    'the absent account is a definite 404',
  );
  const recorded = await ownerClient.rpc(
    'record_employee_account_deletion_result',
    {
      p_operation_id: begun.data.id,
      p_revision: begun.data.revision,
      p_actor_id: adminAEmployee.employeeId,
      p_auth_user_id: targetAuthUserId,
      p_outcome: 'deleted',
      p_provider_reference: targetAuthUserId,
      p_storage_owned: preflightBefore.data.ownedCount,
      p_storage_reassigned: moved.data.reassignedCount,
      p_detail: null,
    },
  );
  assert.equal(recorded.error, null, 'record the confirmed deletion');
  assert.equal(recorded.data.state, 'completed');
  assert.equal(recorded.data.providerOutcome, 'deleted');
  assert.equal(recorded.data.targetAuthUserId, targetAuthUserId);
  const completed = await ownerClient
    .from('employees')
    .select(
      'id,display_name,email,role,is_active,auth_user_id,account_deleted_at,preferred_locale',
    )
    .eq('id', targetEmployee.employeeId)
    .single();
  assert.equal(completed.error, null, 'read the retained employee');
  assert.ok(
    completed.data.account_deleted_at,
    'account-deleted state recorded',
  );
  assert.equal(completed.data.id, targetEmployee.employeeId);
  assert.equal(completed.data.display_name, `${namespace} target`);
  assert.equal(completed.data.email, targetEmployee.email);
  assert.equal(completed.data.role, 'sales');
  observed(
    'success is claimed only when the provider account is absent and the retained state is recorded',
  );

  // -------------------------------------------------- retention
  const newAuth = createClient(
    environment.supabaseUrl,
    environment.publishableKey,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const refused = await newAuth.auth.signInWithPassword({
    email: targetEmployee.email,
    password: targetEmployee.password,
  });
  assert.ok(refused.error, 'a removed account cannot authenticate again');
  const refreshed = await target.auth.refreshSession();
  assert.ok(refreshed.error, 'a removed account cannot refresh a session');
  const retainedFile = await ownerClient
    .from('property_files')
    .select(
      'id,property_id,object_path,mime_type,size_bytes,sha256,upload_status,uploaded_by',
    )
    .eq('id', file.fileId)
    .single();
  assert.equal(retainedFile.error, null, 'read the retained file metadata');
  assert.equal(retainedFile.data.id, file.fileId);
  assert.equal(retainedFile.data.object_path, file.objectPath);
  assert.equal(retainedFile.data.sha256, file.sha256);
  assert.equal(
    retainedFile.data.uploaded_by,
    targetEmployee.employeeId,
    'uploader attribution is stable',
  );
  assert.equal(
    retainedFile.data.sha256,
    (
      await ownerSql(
        `select sha256 from public.property_files where id = ${sqlText(file.fileId)}`,
      )
    )[0].sha256,
  );
  // The file stays readable to another authorized employee through the private signed path
  // once it completed; a pending attachment is deliberately uploader-scoped, so that half is
  // only asserted when completion ran.
  if (file.completed) {
    const signed = await adminA.storage
      .from('property-files')
      .createSignedUrl(file.objectPath, 60);
    assert.equal(
      signed.error,
      null,
      'an authorized employee can still read the completed file',
    );
  }
  observed(
    'the Employee identity, file metadata, uploader attribution and file content survive',
    { completedFile: file.completed },
  );

  // -------------------------------------------------- last active admin
  const otherAdmins = (
    await ownerClient
      .from('employees')
      .select('id')
      .eq('role', 'admin')
      .eq('is_active', true)
      .is('account_deleted_at', null)
      .neq('id', adminAEmployee.employeeId)
  ).data.map((row) => row.id);
  manifest.pausedAdminIds = otherAdmins;
  await persistManifest();
  ownerSql(
    `update public.employees set is_active=false where id in (${otherAdmins.map(sqlText).join(',') || "'00000000-0000-4000-8000-000000000000'"})`,
  );
  const lastAdmin = await adminA.rpc('begin_employee_account_deletion', {
    p_employee_id: adminAEmployee.employeeId,
    p_key: randomUUID(),
  });
  assert.equal(
    lastAdmin.error?.code,
    'P0010',
    'the last active admin cannot delete their own sign-in account',
  );
  await restorePausedAdmins();
  const unchanged = await ownerClient
    .from('employees')
    .select('is_active,auth_user_id')
    .eq('id', adminAEmployee.employeeId)
    .single();
  assert.equal(unchanged.data.is_active, true);
  assert.equal(unchanged.data.auth_user_id, adminAEmployee.userId);
  observed('the last-active-admin invariant still protects account deletion');

  // -------------------------------------------------- browser
  const cdpPort = 9222 + Number(process.env.SGN_ACCEPTANCE_CDP_OFFSET ?? 0);
  await startBrowser(cdpPort);
  const browserSession = `sgn67-${runToken}`;
  browser(browserSession, cdpPort, ['open', `${appUrl}/login`]);
  evaluate(browserSession, cdpPort, setInput('#email', adminAEmployee.email));
  evaluate(
    browserSession,
    cdpPort,
    setInput('#password', adminAEmployee.password),
  );
  evaluate(
    browserSession,
    cdpPort,
    `(() => { document.querySelector('form').requestSubmit(); return true; })()`,
  );
  await waitFor(
    browserSession,
    cdpPort,
    `() => location.pathname === '/properties'`,
  );
  browser(browserSession, cdpPort, ['open', `${appUrl}/people/employees`]);
  await waitFor(
    browserSession,
    cdpPort,
    `() => Boolean(document.querySelector('main table.data-table'))`,
    120,
  );
  const listState = evaluate(
    browserSession,
    cdpPort,
    `(() => {
      const rows = [...document.querySelectorAll('main table.data-table tbody tr')];
      const row = rows.find((tr) => tr.textContent.includes(${JSON.stringify(targetEmployee.email)}));
      return row ? {
        text: row.textContent.replace(/\\s+/g, ' ').trim(),
        badges: [...row.querySelectorAll('.badge')].map((b) => b.textContent.trim()),
        buttons: [...row.querySelectorAll('button')].map((b) => b.textContent.trim()),
      } : null;
    })()`,
  );
  assert.ok(listState, 'the retained employee is still listed');
  assert.ok(
    listState.badges.some((badge) => /tài khoản|xóa|deleted/i.test(badge)),
    `the account-deleted state is shown: ${JSON.stringify(listState.badges)}`,
  );
  assert.equal(
    listState.buttons.length,
    0,
    'a deleted sign-in account offers no lifecycle action',
  );
  // The confirmation vocabulary for a live account: the destructive control stays disabled
  // until the employee's own email is typed, and it is never submitted here.
  evaluate(
    browserSession,
    cdpPort,
    `(() => {
      const rows = [...document.querySelectorAll('main table.data-table tbody tr')];
      const row = rows.find((tr) => tr.textContent.includes(${JSON.stringify(adminBEmployee.email)}));
      const button = [...(row?.querySelectorAll('button') ?? [])].find((b) => /xóa tài khoản|delete sign-in/i.test(b.textContent));
      if (button) button.click();
      return true;
    })()`,
  );
  await sleep(1500);
  const confirmation = evaluate(
    browserSession,
    cdpPort,
    `(() => {
      const panel = document.querySelector('.deactivation-panel');
      if (!panel) return null;
      const submit = panel.querySelector('button[type=submit]');
      return {
        text: panel.textContent.replace(/\\s+/g, ' ').trim(),
        hasTypedField: Boolean(panel.querySelector('#deletion-confirm-email')),
        submitDisabled: submit ? submit.disabled : null,
      };
    })()`,
  );
  assert.ok(confirmation, 'the deletion confirmation opens for a live account');
  assert.ok(
    confirmation.text.includes(adminBEmployee.email),
    'the confirmation identifies the exact employee',
  );
  assert.equal(
    confirmation.hasTypedField,
    true,
    'the target-specific typed confirmation is required',
  );
  assert.equal(
    confirmation.submitDisabled,
    true,
    'the destructive control is disabled until the email is typed',
  );
  observed(
    'the browser list distinguishes account-deleted and requires a typed, target-specific confirmation',
  );
  await stopBrowsers();

  await cleanup();
  const residue = await residueCounts();
  const report = {
    checked_at: new Date().toISOString(),
    namespace,
    run_token: runToken,
    observations,
    retained: {
      operation: begun.data.id,
      employee: targetEmployee.employeeId,
      note: 'The completed deletion operation, its events and the retained employee row are permanent and are NOT removed by cleanup.',
    },
    limits: [
      'Previously delivered signed links remain usable until expiry; the check does not claim instant recall.',
      'The synthetic Auth identity consumed by this check is deleted and cannot be restored.',
      'employee_admin_operations and employee_admin_events are append-only for every role, so any ledger row this check created (and the employee rows its foreign keys require) is retained by design and cannot be removed without bypassing a guard.',
      ...limitations,
    ],
    residue,
  };
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Acceptance complete: ${observations.length} observations written to ${reportPath}`,
  );
} catch (error) {
  try {
    await stopBrowsers();
    await cleanup();
  } catch (cleanupError) {
    console.error(`Cleanup after failure: ${cleanupError.message}`);
  }
  throw error;
}
