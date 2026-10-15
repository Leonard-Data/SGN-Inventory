import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #67 embedded regressions: permanent sign-in-account deletion on the retained employee.
// Deletion disables membership and clears the restrictive Auth link before any provider call,
// preflights and reassigns Storage ownership without touching object identity, and completes
// only for a confirmed absent account. The retained Employee UUID/name, every business foreign
// key, the uploader attribution and the historical Auth identifier survive; a blocked or only
// partially completed action stays truthful and resumable.
//
// Real Auth account absence, Data API RLS and browser acceptance stay a separately authorized
// staging gate (see docs/testing.md); this proves the database rules the application relies on.
export async function employeeAccountDeletionContract({
  db,
  asUser,
  check,
  fails,
}) {
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const asActor = async (userId) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      userId,
    ]);
    await db.exec('set role authenticated');
  };
  const asService = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role service_role');
  };

  const users = {
    // A live admin who performs and custodians the deletion, a second admin so the first is
    // never the only one until the last-admin case runs, the deleted target, a salesperson
    // whose deletion is blocked on Storage ownership, and an unlinked imported person.
    admin: '92000000-0000-4000-8000-0000000000d1',
    secondAdmin: '92000000-0000-4000-8000-0000000000d2',
    target: '92000000-0000-4000-8000-0000000000d3',
    sales: '92000000-0000-4000-8000-0000000000d4',
  };
  const staff = {
    admin: '93000000-0000-4000-8000-0000000000d1',
    secondAdmin: '93000000-0000-4000-8000-0000000000d2',
    target: '93000000-0000-4000-8000-0000000000d3',
    sales: '93000000-0000-4000-8000-0000000000d4',
    unlinked: '93000000-0000-4000-8000-0000000000d5',
  };
  const property = '9a000000-0000-4000-8000-000000000001';
  const fileId = '9b000000-0000-4000-8000-000000000001';
  const objectId = '9c000000-0000-4000-8000-000000000001';
  const objectPath = `${property}/${fileId}/fixture-deed.pdf`;
  const commentId = '9d000000-0000-4000-8000-000000000001';
  const lockId = '9e000000-0000-4000-8000-000000000001';
  const activityId = '9f000000-0000-4000-8000-000000000001';

  const begin = async (employeeId, key) =>
    (
      await db.query(
        'select public.begin_employee_account_deletion($1,$2) as result',
        [employeeId, key],
      )
    ).rows[0].result;
  const record = async (
    operationId,
    revision,
    actorId,
    authUserId,
    outcome,
    reference = null,
    owned = null,
    reassigned = null,
    detail = null,
  ) =>
    (
      await db.query(
        'select public.record_employee_account_deletion_result($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
        [
          operationId,
          revision,
          actorId,
          authUserId,
          outcome,
          reference,
          owned,
          reassigned,
          detail,
        ],
      )
    ).rows[0].result;
  const preflight = async (authUserId) =>
    (
      await db.query('select public.employee_storage_preflight($1) as result', [
        authUserId,
      ])
    ).rows[0].result;
  const reassign = async (fromAuthUserId, toAuthUserId) =>
    (
      await db.query(
        'select public.reassign_employee_storage_ownership($1,$2) as result',
        [fromAuthUserId, toAuthUserId],
      )
    ).rows[0].result;

  // Every single-column foreign key referencing public.employees, except the administration
  // ledger itself (which legitimately appends new evidence while the action runs and is
  // asserted separately below). Counting the target's rows across all business tables before
  // and after the deletion proves nothing was cascaded, nulled or repointed.
  const employeeReferences = async (employeeId) => {
    const columns = (
      await db.query(
        `select ns.nspname as schema, rel.relname as table_name, att.attname as column_name
           from pg_constraint c
           join pg_class rel on rel.oid = c.conrelid
           join pg_namespace ns on ns.oid = rel.relnamespace
           join pg_attribute att on att.attrelid = c.conrelid and att.attnum = any(c.conkey)
          where c.contype = 'f' and c.confrelid = 'public.employees'::regclass
            and array_length(c.conkey, 1) = 1
            and not (ns.nspname = 'public' and rel.relname like 'employee_admin_%')
          order by 1, 2, 3`,
      )
    ).rows;
    const counts = new Map();
    for (const column of columns) {
      const key = `${column.schema}.${column.table_name}.${column.column_name}`;
      counts.set(
        key,
        (
          await db.query(
            `select count(*)::int as n from ${column.schema}.${column.table_name} where ${column.column_name} = $1`,
            [employeeId],
          )
        ).rows[0].n,
      );
    }
    return counts;
  };

  // The retained administration ledger: completing the action appends evidence but must
  // never remove or rewrite the rows the employee is attached to.
  const ledgerCounts = async (employeeId) =>
    (
      await db.query(
        `select
           (select count(*)::int from public.employee_admin_operations where employee_id = $1) as operations,
           (select count(*)::int from public.employee_admin_events where employee_id = $1) as events`,
        [employeeId],
      )
    ).rows[0];

  await asOwner();
  for (const id of Object.values(users))
    await db.query('insert into auth.users values ($1)', [id]);
  await db.query(
    'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values' +
      " ($1,$2,'delete-admin@example.test','Fixture Deletion Admin','admin',true)," +
      " ($3,$4,'delete-admin2@example.test','Fixture Deletion Admin Two','admin',true)," +
      " ($5,$6,'delete-target@example.test','Fixture Deletion Target','sales',true)," +
      " ($7,$8,'delete-sales@example.test','Fixture Deletion Sales','sales',true)," +
      " ($9,null,'delete-unlinked@example.test','Fixture Deletion Unlinked','sales',false)",
    [
      staff.admin,
      users.admin,
      staff.secondAdmin,
      users.secondAdmin,
      staff.target,
      users.target,
      staff.sales,
      users.sales,
      staff.unlinked,
    ],
  );
  // Fixtures that record the target's work: a created property, an uploaded document, a
  // posted comment, a page view and an outstanding reservation request.
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values ($1,'SGN-DEL-1','sale','available',$2)",
    [property, staff.target],
  );
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text) values ($1,'legacy','12 Fixture Đường, Phường 1, Quận 1')",
    [property],
  );
  await db.query(
    "insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,upload_status,uploaded_by) values ($1,$2,'land_certificate',$3,'fixture-deed.pdf','application/pdf',1024,'ready',$4)",
    [fileId, property, objectPath, staff.target],
  );
  await db.query(
    "insert into public.property_comments(id,property_id,author_id,author_name,body,idempotency_key) values ($1,$2,$3,'Fixture Deletion Target','Giữ lại bình luận này',$4)",
    [commentId, property, staff.target, randomUUID()],
  );
  await db.query(
    "insert into public.activity_events(id,employee_id,property_id,kind,idempotency_key) values ($1,$2,$3,'page_view',$4)",
    [activityId, staff.target, property, randomUUID()],
  );
  await db.query(
    "insert into public.property_locks(id,property_id,requested_by,reason,status,requested_at,expires_at) values ($1,$2,$3,'Khách đã đồng ý giá chốt','pending',now(),now()+interval '24 hours')",
    [lockId, property, staff.target],
  );
  await db.query(
    "insert into storage.objects(id,bucket_id,name,owner_id,owner) values ($1,'property-files',$2,$3,$3)",
    [objectId, objectPath, users.target],
  );

  // --- Authority and the begin step -------------------------------------------------------
  await asActor(users.sales);
  await check('a non-admin cannot begin account deletion', () =>
    fails(
      'select public.begin_employee_account_deletion($1,$2)',
      [staff.target, randomUUID()],
      '42501',
    ),
  );
  await asUser(null);
  await check('an anonymous caller cannot begin account deletion', () =>
    fails(
      'select public.begin_employee_account_deletion($1,$2)',
      [staff.target, randomUUID()],
      '42501',
    ),
  );

  const key = randomUUID();
  let operation;
  await asActor(users.admin);
  await check(
    'the admin begin disables membership, clears the restrictive Auth link and records the exact identity',
    async () => {
      operation = await begin(staff.target, key);
      assert.equal(operation.kind, 'delete');
      assert.equal(operation.state, 'provider_pending');
      assert.equal(operation.providerOutcome, null);
      assert.equal(operation.targetAuthUserId, users.target);
      assert.equal(operation.actorId, staff.admin);
      assert.equal(operation.employeeId, staff.target);
      assert.ok(operation.membershipDisabledAt);
      await asOwner();
      const row = (
        await db.query(
          'select id,display_name,is_active,auth_user_id,account_deleted_at from public.employees where id=$1',
          [staff.target],
        )
      ).rows[0];
      assert.equal(row.is_active, false);
      assert.equal(row.auth_user_id, null);
      assert.equal(row.account_deleted_at, null);
      // The retained identity is unchanged: same row, same UUID, same recorded name.
      assert.equal(row.id, staff.target);
      assert.equal(row.display_name, 'Fixture Deletion Target');
    },
  );
  await check(
    'the outstanding reservation stays attributed to the departing employee',
    async () => {
      assert.equal(
        (
          await db.query(
            'select requested_by from public.property_locks where id=$1',
            [lockId],
          )
        ).rows[0].requested_by,
        staff.target,
      );
    },
  );

  // --- Operation convergence --------------------------------------------------------------
  await asActor(users.admin);
  await check(
    'the same admin and key converge on the original operation',
    async () => {
      const again = await begin(staff.target, key);
      assert.equal(again.id, operation.id);
      assert.equal(again.revision, operation.revision);
    },
  );
  await check('a different target under the same key is refused', () =>
    fails(
      'select public.begin_employee_account_deletion($1,$2)',
      [staff.sales, key],
      '23505',
    ),
  );
  await check('a different action under the same key is refused', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.sales, key],
      '23505',
    ),
  );
  await check(
    'a competing deactivation of the same employee is refused while deletion is open',
    () =>
      fails(
        'select public.begin_employee_deactivation($1,$2)',
        [staff.target, randomUUID()],
        'P0013',
      ),
  );
  await check(
    'a different live admin resumes the open deletion without rewriting its actor',
    async () => {
      await asActor(users.secondAdmin);
      const resumed = await begin(staff.target, randomUUID());
      assert.equal(resumed.id, operation.id);
      assert.equal(resumed.actorId, staff.admin);
      assert.equal(resumed.revision, operation.revision);
    },
  );
  await check('an employee with no linked sign-in cannot be deleted', () =>
    fails(
      'select public.begin_employee_account_deletion($1,$2)',
      [staff.unlinked, randomUUID()],
      'P0011',
    ),
  );
  await check('an unknown employee cannot be deleted', () =>
    fails(
      'select public.begin_employee_account_deletion($1,$2)',
      ['9e000000-0000-4000-8000-0000000000ff', randomUUID()],
      'P0011',
    ),
  );
  await asActor(users.admin);

  // --- Storage ownership preflight and reassignment ---------------------------------------
  await asActor(users.admin);
  await check('an authenticated client cannot read the Storage preflight', () =>
    fails(
      'select public.employee_storage_preflight($1)',
      [users.target],
      '42501',
    ),
  );
  await check('an authenticated client cannot move Storage ownership', () =>
    fails(
      'select public.reassign_employee_storage_ownership($1,$2)',
      [users.target, users.admin],
      '42501',
    ),
  );
  await asService();
  await check(
    'the preflight reports the owned objects without changing them',
    async () => {
      const before = await preflight(users.target);
      assert.deepEqual(before, { supported: true, ownedCount: 1 });
      await asOwner();
      const object = (
        await db.query(
          'select id,bucket_id,name,owner_id from storage.objects where id=$1',
          [objectId],
        )
      ).rows[0];
      assert.equal(object.id, objectId);
      assert.equal(object.bucket_id, 'property-files');
      assert.equal(object.name, objectPath);
      assert.equal(object.owner_id, users.target);
    },
  );
  await check(
    'reassignment requires a live active admin as custodian',
    async () => {
      await asService();
      await fails(
        'select public.reassign_employee_storage_ownership($1,$2)',
        [users.target, users.sales],
        '42501',
      );
    },
  );
  await check(
    'reassignment moves only ownership and preserves object identity',
    async () => {
      const moved = await reassign(users.target, users.admin);
      assert.deepEqual(moved, { supported: true, reassignedCount: 1 });
      assert.deepEqual(await preflight(users.target), {
        supported: true,
        ownedCount: 0,
      });
      assert.deepEqual(await preflight(users.admin), {
        supported: true,
        ownedCount: 1,
      });
      await asOwner();
      const object = (
        await db.query(
          'select id,bucket_id,name,owner_id,owner from storage.objects where id=$1',
          [objectId],
        )
      ).rows[0];
      // The registered file UUID, path and bucket are untouched; both ownership columns moved.
      assert.equal(object.id, objectId);
      assert.equal(object.bucket_id, 'property-files');
      assert.equal(object.name, objectPath);
      assert.equal(object.owner_id, users.admin);
      assert.equal(object.owner, users.admin);
      const file = (
        await db.query(
          'select id,object_path,uploaded_by from public.property_files where id=$1',
          [fileId],
        )
      ).rows[0];
      assert.equal(file.id, fileId);
      assert.equal(file.object_path, objectPath);
      assert.equal(file.uploaded_by, staff.target);
    },
  );
  await check(
    'reassignment refuses a custodian identical to the deleted account',
    async () => {
      await asService();
      await fails(
        'select public.reassign_employee_storage_ownership($1,$2)',
        [users.target, users.target],
        '23514',
      );
    },
  );

  // --- Truthful partial states ------------------------------------------------------------
  await asService();
  await check(
    'a confirmed deletion requires the preflight count and the absent provider reference',
    async () => {
      await fails(
        'select public.record_employee_account_deletion_result($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          operation.id,
          operation.revision,
          staff.admin,
          users.target,
          'deleted',
          null,
          1,
          1,
        ],
        '23514',
      );
      await fails(
        'select public.record_employee_account_deletion_result($1,$2,$3,$4,$5,$6,$7,$8)',
        [
          operation.id,
          operation.revision,
          staff.admin,
          users.target,
          'deleted',
          users.target,
          null,
          null,
        ],
        '23514',
      );
    },
  );
  await check('an invalid provider outcome is refused', () =>
    fails(
      'select public.record_employee_account_deletion_result($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        operation.id,
        operation.revision,
        staff.admin,
        users.target,
        'blocked',
        users.target,
        1,
        1,
      ],
      '23514',
    ),
  );
  await check('a stale operation revision is refused', () =>
    fails(
      'select public.record_employee_account_deletion_result($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        operation.id,
        operation.revision + 5,
        staff.admin,
        users.target,
        'failed',
        null,
        1,
        1,
      ],
      'PT409',
    ),
  );
  await check('the deactivation recorder refuses a deletion operation', () =>
    fails(
      'select public.record_employee_deactivation_result($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        operation.id,
        operation.revision,
        staff.admin,
        users.target,
        'blocked',
        users.target,
        null,
        '2126-10-13T00:00:00+00:00',
      ],
      'P0012',
    ),
  );

  // --- Storage-blocked outcome on a second employee ---------------------------------------
  await asActor(users.admin);
  const blockedKey = randomUUID();
  const blockedOperation = await begin(staff.sales, blockedKey);
  await asService();
  await check(
    'a blocked Storage ownership step is a truthful partial state, not a deletion',
    async () => {
      const blocked = await record(
        blockedOperation.id,
        blockedOperation.revision,
        staff.admin,
        users.sales,
        'storage_blocked',
        null,
        3,
        0,
        'storage ownership reassignment unavailable',
      );
      assert.equal(blocked.state, 'provider_failed');
      assert.equal(blocked.providerOutcome, 'storage_blocked');
      assert.equal(blocked.storageOwnedCount, 3);
      assert.equal(blocked.storageReassignedCount, 0);
      assert.equal(blocked.completedAt, null);
      await asOwner();
      const row = (
        await db.query(
          'select is_active,auth_user_id,account_deleted_at,display_name from public.employees where id=$1',
          [staff.sales],
        )
      ).rows[0];
      // Access is removed but the account and the employee record are untouched.
      assert.equal(row.is_active, false);
      assert.equal(row.auth_user_id, null);
      assert.equal(row.account_deleted_at, null);
      assert.equal(row.display_name, 'Fixture Deletion Sales');
    },
  );
  await asActor(users.admin);
  await check(
    'the same key resumes the blocked operation instead of starting another',
    async () => {
      const resumed = await begin(staff.sales, blockedKey);
      assert.equal(resumed.id, blockedOperation.id);
      assert.equal(resumed.providerOutcome, 'storage_blocked');
    },
  );

  // --- Completed deletion -----------------------------------------------------------------
  await asOwner();
  const referencesBefore = await employeeReferences(staff.target);
  const ledgerBefore = await ledgerCounts(staff.target);
  assert.equal(ledgerBefore.operations, 1);
  assert.equal(ledgerBefore.events, 2);
  await asService();
  await check(
    'a confirmed deletion completes and records the absent account',
    async () => {
      const done = await record(
        operation.id,
        operation.revision,
        staff.admin,
        users.target,
        'deleted',
        users.target,
        1,
        1,
      );
      assert.equal(done.state, 'completed');
      assert.equal(done.providerOutcome, 'deleted');
      assert.equal(done.providerReference, users.target);
      assert.equal(done.targetAuthUserId, users.target);
      assert.equal(done.storageOwnedCount, 1);
      assert.equal(done.storageReassignedCount, 1);
      assert.ok(done.completedAt);
    },
  );
  await check(
    'a completed deletion is terminal and an identical retry converges',
    async () => {
      const again = await record(
        operation.id,
        operation.revision,
        staff.admin,
        users.target,
        'deleted',
        users.target,
        1,
        1,
      );
      assert.equal(again.state, 'completed');
      assert.equal(again.revision, operation.revision + 1);
    },
  );
  await asOwner();
  await check(
    'the retained employee row keeps its identity and records account-deleted',
    async () => {
      const row = (
        await db.query(
          'select id,display_name,email,role,is_active,auth_user_id,account_deleted_at from public.employees where id=$1',
          [staff.target],
        )
      ).rows[0];
      assert.equal(row.id, staff.target);
      assert.equal(row.display_name, 'Fixture Deletion Target');
      assert.equal(row.email, 'delete-target@example.test');
      assert.equal(row.role, 'sales');
      assert.equal(row.is_active, false);
      assert.equal(row.auth_user_id, null);
      assert.ok(row.account_deleted_at);
    },
  );
  await check(
    'every business reference to the employee survives the deletion unchanged',
    async () => {
      const after = await employeeReferences(staff.target);
      assert.deepEqual(
        Object.fromEntries(after),
        Object.fromEntries(referencesBefore),
      );
      // The references this fixture actually created are still non-zero, so the comparison
      // above is not an empty match.
      for (const key of [
        'public.properties.created_by',
        'public.property_files.uploaded_by',
        'public.property_comments.author_id',
        'public.activity_events.employee_id',
        'public.property_locks.requested_by',
      ]) {
        assert.ok(after.has(key), `${key} must exist`);
        assert.ok(after.get(key) >= 1, `${key} must retain rows`);
      }
      assert.equal(after.get('public.property_comments.author_id'), 1);
      assert.equal(after.get('public.activity_events.employee_id'), 1);
      assert.equal(after.get('public.property_locks.requested_by'), 1);
      // The ledger keeps its operation and appends the deletion evidence; nothing is removed.
      const ledgerAfter = await ledgerCounts(staff.target);
      assert.equal(ledgerAfter.operations, 1);
      assert.ok(ledgerAfter.events > ledgerBefore.events);
    },
  );
  await check(
    'the file, its bytes reference, object path and uploader attribution are unchanged',
    async () => {
      const file = (
        await db.query(
          'select id,property_id,object_path,original_filename,upload_status,uploaded_by from public.property_files where id=$1',
          [fileId],
        )
      ).rows[0];
      assert.equal(file.id, fileId);
      assert.equal(file.property_id, property);
      assert.equal(file.object_path, objectPath);
      assert.equal(file.original_filename, 'fixture-deed.pdf');
      assert.equal(file.upload_status, 'ready');
      assert.equal(file.uploaded_by, staff.target);
      const object = (
        await db.query(
          'select id,name,owner_id from storage.objects where id=$1',
          [objectId],
        )
      ).rows[0];
      assert.equal(object.id, objectId);
      assert.equal(object.name, objectPath);
    },
  );
  await check(
    'the historical Auth identifier stays on the operation after the Auth row is gone',
    async () => {
      // The retained attribution must not depend on a living Auth row.
      await db.query('delete from auth.users where id=$1', [users.target]);
      const row = (
        await db.query(
          'select target_auth_user_id,provider_user_id,provider_reference,state from public.employee_admin_operations where id=$1',
          [operation.id],
        )
      ).rows[0];
      assert.equal(row.state, 'completed');
      assert.equal(row.target_auth_user_id, users.target);
      assert.equal(row.provider_user_id, users.target);
      assert.equal(row.provider_reference, users.target);
    },
  );
  await check(
    'an account-deleted employee cannot be re-linked or reactivated',
    async () => {
      await fails(
        'update public.employees set auth_user_id=$2 where id=$1',
        [staff.target, users.target],
        '23514',
      );
      await fails(
        'update public.employees set is_active=true where id=$1',
        [staff.target],
        '23514',
      );
      await fails(
        'update public.employees set account_deleted_at=now() where id=$1',
        [staff.target],
        '23514',
      );
    },
  );
  await asActor(users.admin);
  await check('a deleted sign-in account cannot be deactivated', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.target, randomUUID()],
      'P0011',
    ),
  );
  await check('a deleted sign-in account cannot be deleted again', () =>
    fails(
      'select public.begin_employee_account_deletion($1,$2)',
      [staff.target, randomUUID()],
      'P0011',
    ),
  );

  // --- Direct-write refusal and RLS -------------------------------------------------------
  await asService();
  await check(
    'service_role cannot write the account-deleted state directly',
    () =>
      fails(
        'update public.employees set account_deleted_at=now() where id=$1',
        [staff.secondAdmin],
        '42501',
      ),
  );
  await asActor(users.sales);
  await check(
    'a non-admin cannot read the recorded deletion operations',
    async () => {
      const rows = (
        await db.query(
          'select id from public.employee_admin_operations where employee_id=$1',
          [staff.target],
        )
      ).rows;
      assert.equal(rows.length, 0);
    },
  );
  await asActor(users.admin);
  await check(
    'a live admin reads the recorded deletion operation',
    async () => {
      const rows = (
        await db.query(
          'select kind,state,provider_outcome from public.employee_admin_operations where employee_id=$1',
          [staff.target],
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        kind: 'delete',
        state: 'completed',
        provider_outcome: 'deleted',
      });
    },
  );
  await check(
    'the append-only evidence records the deletion steps without carrying the target key',
    async () => {
      await asOwner();
      const actions = (
        await db.query(
          'select action from public.employee_admin_events where operation_id=$1 order by created_at, id',
          [operation.id],
        )
      ).rows.map((row) => row.action);
      assert.ok(actions.includes('begun'));
      assert.ok(actions.includes('account_deleted'));
      await asActor(users.admin);
      await fails(
        'delete from public.employee_admin_events where operation_id=$1',
        [operation.id],
        '42501',
      );
      await fails(
        'delete from public.employee_admin_operations where id=$1',
        [operation.id],
        '42501',
      );
    },
  );

  // --- Last-active-admin protection -------------------------------------------------------
  await asOwner();
  await check(
    'the last active admin cannot delete their own sign-in account',
    async () => {
      const otherAdmins = (
        await db.query(
          "select id from public.employees where role='admin' and is_active and id <> $1 and account_deleted_at is null",
          [staff.admin],
        )
      ).rows.map((row) => row.id);
      for (const id of otherAdmins)
        await db.query(
          'update public.employees set is_active=false where id=$1',
          [id],
        );
      await asActor(users.admin);
      await fails(
        'select public.begin_employee_account_deletion($1,$2)',
        [staff.admin, randomUUID()],
        'P0010',
      );
      // The refusal rolled the whole transaction back: no open operation and no disabled
      // membership claim is left behind.
      await asOwner();
      const row = (
        await db.query(
          'select is_active,auth_user_id from public.employees where id=$1',
          [staff.admin],
        )
      ).rows[0];
      assert.equal(row.is_active, true);
      assert.equal(row.auth_user_id, users.admin);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_operations where employee_id=$1 and kind='delete'",
            [staff.admin],
          )
        ).rows[0].n,
        0,
      );
      // Restore exactly the administrators this check disabled.
      for (const id of otherAdmins)
        await db.query(
          'update public.employees set is_active=true where id=$1',
          [id],
        );
    },
  );
  await check(
    'the last-active-admin guard still protects a trusted administrative write',
    async () => {
      const otherAdmins = (
        await db.query(
          "select id from public.employees where role='admin' and is_active and id <> $1 and account_deleted_at is null",
          [staff.admin],
        )
      ).rows.map((row) => row.id);
      for (const id of otherAdmins)
        await db.query(
          'update public.employees set is_active=false where id=$1',
          [id],
        );
      await fails(
        'update public.employees set role=$2 where id=$1',
        [staff.admin, 'sales'],
        'P0010',
      );
      for (const id of otherAdmins)
        await db.query(
          'update public.employees set is_active=true where id=$1',
          [id],
        );
    },
  );
}
