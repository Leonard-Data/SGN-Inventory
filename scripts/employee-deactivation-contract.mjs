import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #66 embedded regressions: the guarded employee-administration operation model.
// Live admin authority, last-active-admin protection (including direct writes),
// revision/retry reconciliation, retained attribution, denial of direct client writes and
// the read path the directory uses for outstanding reservations. Real Auth provider bans,
// Data API RLS and browser acceptance stay a separately authorized staging gate; this proves
// the database rules the application relies on.
export async function employeeDeactivationContract({
  db,
  asUser,
  check,
  fails,
  employees,
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
    newAdmin: '94000000-0000-4000-8000-0000000000e1',
    secondAdmin: '94000000-0000-4000-8000-0000000000e2',
    adminA: '94000000-0000-4000-8000-0000000000e3',
    adminB: '94000000-0000-4000-8000-0000000000e4',
    target: '94000000-0000-4000-8000-0000000000e5',
    reserver: '94000000-0000-4000-8000-0000000000e6',
    linked: '94000000-0000-4000-8000-0000000000e7',
    relinked: '94000000-0000-4000-8000-0000000000e8',
    orphan: '94000000-0000-4000-8000-0000000000e9',
  };
  const staff = {
    newAdmin: '95000000-0000-4000-8000-0000000000e1',
    secondAdmin: '95000000-0000-4000-8000-0000000000e2',
    adminA: '95000000-0000-4000-8000-0000000000e3',
    adminB: '95000000-0000-4000-8000-0000000000e4',
    target: '95000000-0000-4000-8000-0000000000e5',
    reserver: '95000000-0000-4000-8000-0000000000e6',
    linked: '95000000-0000-4000-8000-0000000000e7',
    unlinked: '95000000-0000-4000-8000-0000000000ea',
    insertedActive: '95000000-0000-4000-8000-0000000000eb',
    insertedLinked: '95000000-0000-4000-8000-0000000000ec',
    insertedRole: '95000000-0000-4000-8000-0000000000ed',
  };
  const reservedProperty = '24000000-0000-4000-8000-000000000001';
  const pendingProperty = '24000000-0000-4000-8000-000000000002';
  const banUntil = '2126-10-13T00:00:00+00:00';
  const recordSql =
    'select public.record_employee_deactivation_result($1,$2,$3,$4,$5,$6,$7,$8) as result';
  const record = async (
    operationId,
    revision,
    actorId,
    authUserId,
    outcome,
    reference = null,
    detail = null,
    ban = null,
  ) =>
    (
      await db.query(recordSql, [
        operationId,
        revision,
        actorId,
        authUserId,
        outcome,
        reference,
        detail,
        ban,
      ])
    ).rows[0].result;
  const begin = async (employeeId, key) =>
    (
      await db.query(
        'select public.begin_employee_deactivation($1,$2) as result',
        [employeeId, key],
      )
    ).rows[0].result;

  await asOwner();
  for (const id of Object.values(users))
    await db.query('insert into auth.users values ($1)', [id]);
  await db.query(
    'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values' +
      " ($1,$2,'deactivate-admin@example.test','Fixture Admin One','admin',true)," +
      " ($3,$4,'deactivate-admin2@example.test','Fixture Admin Two','admin',true)," +
      " ($5,$6,'deactivate-admin3@example.test','Fixture Admin Three','admin',true)," +
      " ($7,$8,'deactivate-admin4@example.test','Fixture Admin Four','admin',true)," +
      " ($9,$10,'deactivate-target@example.test','Fixture Target','sales',true)," +
      " ($11,$12,'deactivate-reserver@example.test','Fixture Reserver','sales',true)," +
      " ($13,$14,'deactivate-linked@example.test','Fixture Linked','sales',true)",
    [
      staff.newAdmin,
      users.newAdmin,
      staff.secondAdmin,
      users.secondAdmin,
      staff.adminA,
      users.adminA,
      staff.adminB,
      users.adminB,
      staff.target,
      users.target,
      staff.reserver,
      users.reserver,
      staff.linked,
      users.linked,
    ],
  );
  await db.query(
    "insert into public.employees(id,email,display_name,role,is_active) values ($1,'deactivate-unlinked@example.test','Fixture Unlinked','sales',false)",
    [staff.unlinked],
  );
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values ($1,'SGN-DEACT-RESERVED','sale','available',$3),($2,'SGN-DEACT-PENDING','sale','available',$3)",
    [reservedProperty, pendingProperty, staff.reserver],
  );

  // --- Live admin authority ---------------------------------------------------------------
  await asUser(null);
  await check(
    'anonymous cannot begin or record an employee deactivation',
    async () => {
      await fails(
        'select public.begin_employee_deactivation($1,$2)',
        [staff.target, randomUUID()],
        '42501',
      );
      await fails(
        recordSql,
        [
          randomUUID(),
          1,
          staff.newAdmin,
          users.target,
          'blocked',
          'reference',
          null,
          banUntil,
        ],
        '42501',
      );
    },
  );
  for (const [index, role] of [
    [0, 'sales'],
    [5, 'staff'],
    [2, 'manager'],
  ]) {
    await asUser(index);
    await check(`${role} cannot begin an employee deactivation`, () =>
      fails(
        'select public.begin_employee_deactivation($1,$2)',
        [staff.target, randomUUID()],
        '42501',
      ),
    );
  }
  await asActor(users.orphan);
  await check(
    'an authenticated identity with no employee row cannot begin',
    () =>
      fails(
        'select public.begin_employee_deactivation($1,$2)',
        [staff.target, randomUUID()],
        '42501',
      ),
  );
  await asUser(4);
  await check('an inactive employee cannot begin a deactivation', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.target, randomUUID()],
      '42501',
    ),
  );

  // --- Begin, retry identity and resume ---------------------------------------------------
  await asActor(users.newAdmin);
  const key = randomUUID();
  const begun = await begin(staff.target, key);
  await check(
    'a live admin disables membership before any provider attempt',
    async () => {
      assert.equal(begun.state, 'provider_pending');
      assert.equal(begun.revision, 1);
      assert.equal(begun.employeeId, staff.target);
      assert.equal(begun.actorId, staff.newAdmin);
      assert.equal(begun.completedAt, null);
      assert.equal(begun.providerOutcome, null);
      assert.equal(
        (
          await db.query('select is_active from public.employees where id=$1', [
            staff.target,
          ])
        ).rows[0].is_active,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_events where operation_id=$1 and action='begun'",
            [begun.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    'the same actor and key converge on the original action',
    async () => {
      const retried = await begin(staff.target, key);
      assert.equal(retried.id, begun.id);
      assert.equal(retried.revision, begun.revision);
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.employee_admin_operations where employee_id=$1',
            [staff.target],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check('reusing the key for a different employee is a conflict', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.linked, key],
      '23505',
    ),
  );
  await check('a missing submission key is refused', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.linked, null],
      '23514',
    ),
  );
  await check('an unlinked employee has nothing to block', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.unlinked, randomUUID()],
      'P0011',
    ),
  );
  await check('an inactive employee without an open operation is refused', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [employees[4], randomUUID()],
      'P0011',
    ),
  );
  await asActor(users.secondAdmin);
  const resumeKey = randomUUID();
  await check(
    'another authorized admin resumes the original operation without rewriting attribution',
    async () => {
      const resumed = await begin(staff.target, resumeKey);
      assert.equal(resumed.id, begun.id);
      assert.equal(resumed.state, 'provider_pending');
      assert.equal(resumed.revision, 1);
      assert.equal(resumed.actorId, staff.newAdmin);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_events where operation_id=$1 and action='resumed' and actor_id=$2",
            [begun.id, staff.secondAdmin],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check(
    'a resuming admin key converges on the original operation without duplicate evidence',
    async () => {
      const retried = await begin(staff.target, resumeKey);
      assert.equal(retried.id, begun.id);
      assert.equal(retried.actorId, staff.newAdmin);
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_events where operation_id=$1 and action='resumed' and actor_id=$2",
            [begun.id, staff.secondAdmin],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await check('a resuming key reused for another employee is a conflict', () =>
    fails(
      'select public.begin_employee_deactivation($1,$2)',
      [staff.linked, resumeKey],
      '23505',
    ),
  );
  await check(
    'deactivation retains identity, locale, role and the restrictive Auth link',
    async () => {
      const row = (
        await db.query(
          'select display_name,email,role,preferred_locale,auth_user_id from public.employees where id=$1',
          [staff.target],
        )
      ).rows[0];
      assert.deepEqual(row, {
        display_name: 'Fixture Target',
        email: 'deactivate-target@example.test',
        role: 'sales',
        preferred_locale: 'vi',
        auth_user_id: users.target,
      });
    },
  );

  // --- Direct write denial ----------------------------------------------------------------
  await asActor(users.newAdmin);
  await check(
    'direct employee lifecycle, sign-in link and role writes are denied',
    async () => {
      await fails(
        "insert into public.employees(id,email,display_name,role,is_active) values($1,'insert-active@example.test','Inserted Active','sales',true)",
        [staff.insertedActive],
        '42501',
      );
      await fails(
        "insert into public.employees(id,auth_user_id,email,display_name,is_active) values($1,$2,'insert-linked@example.test','Inserted Linked',false)",
        [staff.insertedLinked, users.relinked],
        '42501',
      );
      await fails(
        "insert into public.employees(id,email,display_name,role,is_active) values($1,'insert-role@example.test','Inserted Role','sales',false)",
        [staff.insertedRole],
        '42501',
      );
      await fails(
        'update public.employees set is_active=false where id=$1',
        [staff.linked],
        '42501',
      );
      await fails(
        'update public.employees set auth_user_id=$1 where id=$2',
        [users.relinked, staff.linked],
        '42501',
      );
      await fails(
        "update public.employees set role='manager' where id=$1",
        [staff.linked],
        '42501',
      );
      assert.deepEqual(
        (
          await db.query(
            'select is_active,auth_user_id,role from public.employees where id=$1',
            [staff.linked],
          )
        ).rows[0],
        { is_active: true, auth_user_id: users.linked, role: 'sales' },
      );
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.employees where id in ($1,$2,$3)',
            [staff.insertedActive, staff.insertedLinked, staff.insertedRole],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    'client roles cannot write operations or evidence directly',
    async () => {
      await fails(
        'insert into public.employee_admin_operations(employee_id,actor_id,idempotency_key) values($1,$2,$3)',
        [staff.linked, staff.newAdmin, randomUUID()],
        '42501',
      );
      await fails(
        "update public.employee_admin_operations set state='completed' where id=$1",
        [begun.id],
        '42501',
      );
      await fails(
        'delete from public.employee_admin_operations where id=$1',
        [begun.id],
        '42501',
      );
      await fails(
        "insert into public.employee_admin_events(operation_id,employee_id,actor_id,action) values($1,$2,$3,'begun')",
        [begun.id, staff.target, staff.newAdmin],
        '42501',
      );
      await fails(
        "update public.employee_admin_events set action='provider_blocked' where operation_id=$1",
        [begun.id],
        '42501',
      );
      await fails(
        'delete from public.employee_admin_events where operation_id=$1',
        [begun.id],
        '42501',
      );
    },
  );
  await check(
    'a live admin reads the retained administration state',
    async () => {
      assert.equal(
        (
          await db.query(
            'select id from public.employee_admin_operations where id=$1',
            [begun.id],
          )
        ).rows.length,
        1,
      );
      assert.ok(
        (
          await db.query(
            'select id from public.employee_admin_events where operation_id=$1',
            [begun.id],
          )
        ).rows.length >= 1,
      );
    },
  );
  await asUser(0);
  await check('an ordinary employee sees no administration state', async () => {
    assert.deepEqual(
      (await db.query('select id from public.employee_admin_operations')).rows,
      [],
    );
    assert.deepEqual(
      (await db.query('select id from public.employee_admin_events')).rows,
      [],
    );
  });
  await asService();
  await check(
    'service_role cannot write operations or evidence directly',
    async () => {
      await fails(
        'insert into public.employee_admin_operations(employee_id,actor_id,idempotency_key) values($1,$2,$3)',
        [staff.linked, staff.newAdmin, randomUUID()],
        '42501',
      );
      await fails(
        "update public.employee_admin_operations set state='completed' where id=$1",
        [begun.id],
        '42501',
      );
    },
  );

  // --- Provider reconciliation ------------------------------------------------------------
  await asActor(users.newAdmin);
  await check('an authenticated admin cannot record a provider outcome', () =>
    fails(
      recordSql,
      [
        begun.id,
        1,
        staff.newAdmin,
        users.target,
        'blocked',
        'reference',
        null,
        banUntil,
      ],
      '42501',
    ),
  );
  await asService();
  await check(
    'a failed provider outcome leaves membership disabled and reconciliation required',
    async () => {
      const failed = await record(
        begun.id,
        1,
        staff.newAdmin,
        users.target,
        'failed',
        null,
        'provider rejected the block request',
        null,
      );
      assert.equal(failed.state, 'provider_failed');
      assert.equal(failed.revision, 2);
      assert.equal(failed.providerOutcome, 'failed');
      assert.equal(failed.completedAt, null);
      assert.equal(
        (
          await db.query('select is_active from public.employees where id=$1', [
            staff.target,
          ])
        ).rows[0].is_active,
        false,
      );
    },
  );
  await check('a stale operation revision is refused', () =>
    fails(
      recordSql,
      [
        begun.id,
        1,
        staff.newAdmin,
        users.target,
        'blocked',
        'reference',
        null,
        banUntil,
      ],
      'PT409',
    ),
  );
  await check('over-long provider detail is refused', () =>
    fails(
      recordSql,
      [
        begun.id,
        2,
        staff.newAdmin,
        users.target,
        'failed',
        null,
        'x'.repeat(501),
        null,
      ],
      '23514',
    ),
  );
  await check('an unknown recording actor is refused', () =>
    fails(
      recordSql,
      [
        begun.id,
        2,
        users.orphan,
        users.target,
        'failed',
        null,
        'provider unavailable',
        null,
      ],
      '23514',
    ),
  );
  await check(
    'an ambiguous provider outcome keeps the reconciliation state',
    async () => {
      const ambiguous = await record(
        begun.id,
        2,
        staff.newAdmin,
        users.target,
        'ambiguous',
        null,
        'provider response was lost',
        null,
      );
      assert.equal(ambiguous.state, 'provider_failed');
      assert.equal(ambiguous.providerOutcome, 'ambiguous');
      assert.equal(ambiguous.revision, 3);
    },
  );
  await check(
    'a confirmed block requires the provider reference and ban expiry',
    async () => {
      await fails(
        recordSql,
        [
          begun.id,
          3,
          staff.newAdmin,
          users.target,
          'blocked',
          null,
          null,
          banUntil,
        ],
        '23514',
      );
      await fails(
        recordSql,
        [
          begun.id,
          3,
          staff.newAdmin,
          users.target,
          'blocked',
          'reference',
          null,
          null,
        ],
        '23514',
      );
    },
  );
  await check('a provider result for another sign-in identity is refused', () =>
    fails(
      recordSql,
      [
        begun.id,
        3,
        staff.newAdmin,
        users.linked,
        'blocked',
        'reference',
        null,
        banUntil,
      ],
      'P0012',
    ),
  );
  await check(
    'a confirmed provider block completes the operation',
    async () => {
      const completed = await record(
        begun.id,
        3,
        staff.newAdmin,
        users.target,
        'blocked',
        'auth-target-reference',
        'sign-in blocked by provider',
        banUntil,
      );
      assert.equal(completed.state, 'completed');
      assert.equal(completed.revision, 4);
      assert.equal(completed.providerOutcome, 'blocked');
      assert.equal(completed.providerReference, 'auth-target-reference');
      assert.equal(
        Date.parse(completed.providerBanUntil),
        Date.parse(banUntil),
      );
      assert.ok(completed.completedAt);
    },
  );
  await asActor(users.secondAdmin);
  await check(
    'a resuming admin retry after completion returns the original result',
    async () => {
      const retried = await begin(staff.target, resumeKey);
      assert.equal(retried.id, begun.id);
      assert.equal(retried.state, 'completed');
      assert.equal(retried.actorId, staff.newAdmin);
      assert.equal(retried.revision, 4);
    },
  );
  await asActor(users.newAdmin);
  await check(
    'the confirmed block is recorded as one piece of evidence',
    async () => {
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_events where operation_id=$1 and action='provider_blocked'",
            [begun.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await asService();
  await check(
    'an identical confirmed retry converges without new evidence',
    async () => {
      const retried = await record(
        begun.id,
        4,
        staff.newAdmin,
        users.target,
        'blocked',
        'auth-target-reference',
        null,
        banUntil,
      );
      assert.equal(retried.revision, 4);
      assert.equal(retried.state, 'completed');
    },
  );
  await asActor(users.newAdmin);
  await check(
    'the identical retry added no duplicate confirmation evidence',
    async () => {
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_events where operation_id=$1 and action='provider_blocked'",
            [begun.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );
  await asService();
  await check('a different outcome cannot reopen a completed operation', () =>
    fails(
      recordSql,
      [
        begun.id,
        4,
        staff.newAdmin,
        users.target,
        'failed',
        null,
        'later failure',
        null,
      ],
      'P0012',
    ),
  );

  // --- Exact sign-in identity -------------------------------------------------------------
  await asActor(users.newAdmin);
  const linkedOperation = await begin(staff.linked, randomUUID());
  await asOwner();
  await db.query('update public.employees set auth_user_id=$1 where id=$2', [
    users.relinked,
    staff.linked,
  ]);
  await asService();
  await check('a provider result for a stale sign-in link is refused', () =>
    fails(
      recordSql,
      [
        linkedOperation.id,
        1,
        staff.newAdmin,
        users.linked,
        'blocked',
        'stale-reference',
        null,
        banUntil,
      ],
      'P0012',
    ),
  );
  await check(
    'the resumable operation confirms the new exact sign-in identity',
    async () => {
      const completed = await record(
        linkedOperation.id,
        1,
        staff.newAdmin,
        users.relinked,
        'blocked',
        'relinked-reference',
        null,
        banUntil,
      );
      assert.equal(completed.state, 'completed');
    },
  );
  await asActor(users.newAdmin);
  await check(
    'the confirmed sign-in identity is retained on the operation',
    async () => {
      assert.equal(
        (
          await db.query(
            'select provider_user_id from public.employee_admin_operations where id=$1',
            [linkedOperation.id],
          )
        ).rows[0].provider_user_id,
        users.relinked,
      );
    },
  );
  await asOwner();
  await db.query('update public.employees set auth_user_id=$1 where id=$2', [
    users.linked,
    staff.linked,
  ]);

  // --- Outstanding reservations remain attributed -----------------------------------------
  await asActor(users.reserver);
  const pendingLock = (
    await db.query('select public.request_property_lock($1,$2) as id', [
      pendingProperty,
      'Customer agreement awaiting independent manager review',
    ])
  ).rows[0].id;
  const reservedLock = (
    await db.query('select public.request_property_lock($1,$2) as id', [
      reservedProperty,
      'Reserved customer agreement awaiting independent review',
    ])
  ).rows[0].id;
  await asActor(users.secondAdmin);
  await db.query('select public.decide_property_lock($1,true,$2,7)', [
    reservedLock,
    'Evidence reviewed and independently approved',
  ]);
  const pendingBefore = (
    await db.query(
      'select status,requested_by,expires_at from public.property_locks where id=$1',
      [pendingLock],
    )
  ).rows[0];
  const lockCountBefore = (
    await db.query('select count(*)::int as n from public.property_locks')
  ).rows[0].n;
  await asActor(users.newAdmin);
  await begin(staff.reserver, randomUUID());
  await check(
    'deactivation leaves outstanding reservations attributed to the person',
    async () => {
      const pending = (
        await db.query(
          'select status,requested_by,expires_at from public.property_locks where id=$1',
          [pendingLock],
        )
      ).rows[0];
      assert.equal(pending.status, 'pending');
      assert.equal(pending.requested_by, staff.reserver);
      assert.deepEqual(pending.expires_at, pendingBefore.expires_at);
      const effective = (
        await db.query(
          'select requested_by,employee_name from public.v_effective_property_locks where id=$1',
          [reservedLock],
        )
      ).rows[0];
      assert.equal(effective.requested_by, staff.reserver);
      assert.equal(effective.employee_name, 'Fixture Reserver');
      assert.equal(
        (await db.query('select count(*)::int as n from public.property_locks'))
          .rows[0].n,
        lockCountBefore,
      );
    },
  );
  await asActor(users.reserver);
  await check(
    'a deactivated claimant cannot release their own reservation',
    () =>
      fails(
        'select public.release_property_lock($1,$2)',
        [reservedLock, 'Deactivated claimant attempts release'],
        '42501',
      ),
  );
  await asActor(users.secondAdmin);
  await check(
    'reviewer release stays explicit for a deactivated claimant',
    async () => {
      await db.query('select public.release_property_lock($1,$2)', [
        reservedLock,
        'Reviewer releases the reservation after employee deactivation',
      ]);
      assert.equal(
        (
          await db.query(
            'select status from public.property_locks where id=$1',
            [reservedLock],
          )
        ).rows[0].status,
        'released',
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.lock_events where lock_id=$1 and action='released'",
            [reservedLock],
          )
        ).rows[0].n,
        1,
      );
    },
  );

  // --- Last-active-admin protection -------------------------------------------------------
  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    staff.secondAdmin,
  ]);
  await db.query('update public.employees set is_active=false where id=$1', [
    employees[3],
  ]);
  await db.query('update public.employees set is_active=false where id=$1', [
    staff.adminA,
  ]);
  await asActor(users.newAdmin);
  await check(
    'a guarded deactivation is allowed while another active admin remains',
    async () => {
      const operation = await begin(staff.adminB, randomUUID());
      assert.equal(operation.state, 'provider_pending');
      assert.equal(
        (
          await db.query('select is_active from public.employees where id=$1', [
            staff.adminB,
          ])
        ).rows[0].is_active,
        false,
      );
    },
  );
  await check(
    'the last active admin cannot deactivate their own membership',
    () =>
      fails(
        'select public.begin_employee_deactivation($1,$2)',
        [staff.newAdmin, randomUUID()],
        'P0010',
      ),
  );
  await check(
    'the refused removal left membership and operation state unchanged',
    async () => {
      assert.equal(
        (
          await db.query('select is_active from public.employees where id=$1', [
            staff.newAdmin,
          ])
        ).rows[0].is_active,
        true,
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.employee_admin_operations where employee_id=$1 and state <> 'completed'",
            [staff.newAdmin],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    'a direct role demotion of the last active admin is denied to clients',
    () =>
      fails(
        "update public.employees set role='sales' where id=$1",
        [staff.newAdmin],
        '42501',
      ),
  );
  await check(
    'a direct deactivation of the last active admin is denied to clients',
    () =>
      fails(
        'update public.employees set is_active=false where id=$1',
        [staff.newAdmin],
        '42501',
      ),
  );
  await check('clients have no direct delete path on employees', () =>
    fails(
      'delete from public.employees where id=$1',
      [staff.newAdmin],
      '42501',
    ),
  );
  await check(
    'an admin link removal that would disable the last admin is denied to clients',
    () =>
      fails(
        'update public.employees set auth_user_id=null, is_active=false where id=$1',
        [staff.newAdmin],
        '42501',
      ),
  );
  await asOwner();
  await check(
    'the last-active-admin guard still protects trusted employee writes',
    async () => {
      await fails(
        "update public.employees set role='sales' where id=$1",
        [staff.newAdmin],
        'P0010',
      );
      await fails(
        'update public.employees set is_active=false where id=$1',
        [staff.newAdmin],
        'P0010',
      );
      await fails(
        'delete from public.employees where id=$1',
        [staff.newAdmin],
        'P0010',
      );
    },
  );
  await asService();
  await check(
    'service_role direct lifecycle writes cannot bypass the guarded operation',
    async () => {
      await fails(
        "update public.employees set role='sales' where id=$1",
        [staff.newAdmin],
        '42501',
      );
      await fails(
        'update public.employees set is_active=false where id=$1',
        [staff.newAdmin],
        '42501',
      );
      await fails(
        'delete from public.employees where id=$1',
        [staff.newAdmin],
        '42501',
      );
    },
  );
  await asActor(users.newAdmin);
  await check(
    'the existing own-locale operation remains valid for the last admin',
    async () => {
      await db.query("select public.set_my_locale('en')");
      assert.equal(
        (
          await db.query(
            'select preferred_locale from public.employees where id=$1',
            [staff.newAdmin],
          )
        ).rows[0].preferred_locale,
        'en',
      );
      await db.query("select public.set_my_locale('vi')");
    },
  );

  // --- Retained evidence and audit trail --------------------------------------------------
  await asOwner();
  await check(
    'administration evidence and the private audit trail are retained',
    async () => {
      assert.ok(
        (
          await db.query(
            'select id from public.employee_admin_operations where id=$1',
            [begun.id],
          )
        ).rows.length,
      );
      assert.ok(
        (
          await db.query(
            "select count(*)::int as n from private.audit_events where table_name in ('employee_admin_operations','employee_admin_events')",
          )
        ).rows[0].n > 0,
      );
    },
  );

  await asOwner();
  const adminBOperation = (
    await db.query(
      "select id,revision from public.employee_admin_operations where employee_id=$1 and state <> 'completed'",
      [staff.adminB],
    )
  ).rows[0];
  await asService();
  await record(
    adminBOperation.id,
    adminBOperation.revision,
    staff.newAdmin,
    users.adminB,
    'blocked',
    'fixture-block-reference',
    null,
    banUntil,
  );
  await asOwner();
  await db.query(
    'update public.employees set is_active=true where id in ($1,$2,$3,$4)',
    [employees[3], staff.secondAdmin, staff.adminA, staff.adminB],
  );
}
