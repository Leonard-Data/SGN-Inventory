import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #68 embedded regressions: the recorded role-bound employee invitation.
// Live admin authority, normalized email and existing-role validation, one invitation per
// intended person under repeated or concurrent attempts, a retained employee that is never
// silently reactivated, relinked or reused, the server-only provider boundary, the
// reconcilable failed/ambiguous state and the refusal of every direct client write. Real
// Auth delivery, Data API RLS and browser acceptance stay a separately authorized staging
// gate; this proves the database rules the application relies on.
export async function employeeInvitationContract({ db, asUser, check, fails }) {
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
  const beginSql =
    'select public.begin_employee_invitation($1,$2,$3) as result';
  const begin = async (email, role, key) =>
    (await db.query(beginSql, [email, role, key])).rows[0].result;
  const recordSql =
    'select public.record_employee_invitation_result($1,$2,$3,$4,$5,$6,$7) as result';
  const record = async (
    invitationId,
    revision,
    actorId,
    email,
    outcome,
    providerUserId = null,
    detail = null,
  ) =>
    (
      await db.query(recordSql, [
        invitationId,
        revision,
        actorId,
        email,
        outcome,
        providerUserId,
        detail,
      ])
    ).rows[0].result;
  const count = async (sql, params = []) =>
    Number((await db.query(sql, params)).rows[0].count);

  const users = {
    admin: '98000000-0000-4000-8000-0000000000a1',
    admin2: '98000000-0000-4000-8000-0000000000a2',
    sales: '98000000-0000-4000-8000-0000000000a3',
    linked: '98000000-0000-4000-8000-0000000000a4',
    orphan: '98000000-0000-4000-8000-0000000000a5',
    promoted: '98000000-0000-4000-8000-0000000000a6',
  };
  const staff = {
    admin: '99000000-0000-4000-8000-0000000000a1',
    admin2: '99000000-0000-4000-8000-0000000000a2',
    sales: '99000000-0000-4000-8000-0000000000a3',
    inactive: '99000000-0000-4000-8000-0000000000a4',
    unlinked: '99000000-0000-4000-8000-0000000000a5',
    linkedExisting: '99000000-0000-4000-8000-0000000000a6',
    linkChanged: '99000000-0000-4000-8000-0000000000a7',
  };
  const providerIdentity = '93000000-0000-4000-8000-0000000000b1';

  await asOwner();
  for (const id of Object.values(users))
    await db.query('insert into auth.users values ($1)', [id]);
  await db.query(
    'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values' +
      " ($1,$2,'invite-admin@example.test','Invitation Admin','admin',true)," +
      " ($3,$4,'invite-admin2@example.test','Invitation Admin Two','admin',true)," +
      " ($5,$6,'invite-sales@example.test','Invitation Sales','sales',true)," +
      " ($7,$8,'invite-linked@example.test','Invitation Linked Existing','sales',true)",
    [
      staff.admin,
      users.admin,
      staff.admin2,
      users.admin2,
      staff.sales,
      users.sales,
      staff.linkedExisting,
      users.linked,
    ],
  );
  await db.query(
    'insert into public.employees(id,email,display_name,role,is_active) values' +
      " ($1,'invite-inactive@example.test','Invitation Inactive','staff',false)," +
      " ($2,'invite-unlinked@example.test','Invitation Unlinked','manager',false)",
    [staff.inactive, staff.unlinked],
  );

  // --- Live admin authority ---------------------------------------------------------------
  await asUser(null);
  await check(
    'anonymous cannot begin or record an employee invitation',
    async () => {
      await fails(
        beginSql,
        ['invite-anon@example.test', 'sales', randomUUID()],
        '42501',
      );
      await fails(
        recordSql,
        [
          randomUUID(),
          1,
          staff.admin,
          'invite-anon@example.test',
          'accepted',
          providerIdentity,
          null,
        ],
        '42501',
      );
    },
  );
  await asUser(0);
  await check('sales cannot begin an employee invitation', () =>
    fails(
      beginSql,
      ['invite-sales-caller@example.test', 'sales', randomUUID()],
      '42501',
    ),
  );
  await asUser(2);
  await check('a manager cannot begin an employee invitation', () =>
    fails(
      beginSql,
      ['invite-manager-caller@example.test', 'sales', randomUUID()],
      '42501',
    ),
  );
  await asUser(4);
  await check('an inactive employee cannot begin an employee invitation', () =>
    fails(
      beginSql,
      ['invite-inactive-caller@example.test', 'sales', randomUUID()],
      '42501',
    ),
  );
  await asActor(users.orphan);
  await check(
    'an authenticated identity with no employee row cannot begin',
    () =>
      fails(
        beginSql,
        ['invite-orphan-caller@example.test', 'sales', randomUUID()],
        '42501',
      ),
  );

  // --- Input bounds ----------------------------------------------------------------------
  await asActor(users.admin);
  await check('a malformed email address is refused', async () => {
    for (const email of [
      '',
      '   ',
      'not-an-email',
      'two@@example.test',
      'a b@example.test',
    ])
      await fails(beginSql, [email, 'sales', randomUUID()], '23514');
    await fails(
      beginSql,
      [`${'x'.repeat(250)}@example.test`, 'sales', randomUUID()],
      '23514',
    );
  });
  await check(
    'a role outside the existing company roles is refused',
    async () => {
      for (const role of ['', 'owner', 'support', 'ADMINISTRATor'])
        await fails(
          beginSql,
          ['invite-role@example.test', role, randomUUID()],
          '23514',
        );
    },
  );
  await check('a submission without a key is refused', () =>
    fails(beginSql, ['invite-key@example.test', 'sales', null], '23514'),
  );

  // --- One recorded invitation, not active membership -------------------------------------
  const key = randomUUID();
  const begun = await begin('  Invite-Newcomer@Example.Test  ', 'manager', key);
  await check(
    'an invite records the normalized email and requested role under the invitee it creates',
    async () => {
      assert.equal(begun.email, 'invite-newcomer@example.test');
      assert.equal(begun.role, 'manager');
      assert.equal(begun.actorId, staff.admin);
      assert.equal(begun.state, 'provider_pending');
      assert.equal(begun.revision, 1);
      assert.equal(begun.providerOutcome, null);
      assert.equal(begun.recordedAt, null);
      assert.equal(begun.providerUserId, undefined);
      const invited = await db.query(
        'select email,display_name,role,is_active,auth_user_id from public.employees where id=$1',
        [begun.employeeId],
      );
      assert.equal(invited.rows.length, 1);
      assert.equal(
        invited.rows[0].is_active,
        false,
        'sending is not activation',
      );
      assert.equal(
        invited.rows[0].auth_user_id,
        null,
        'sending does not link a sign-in identity',
      );
      assert.equal(invited.rows[0].role, 'manager');
      assert.equal(
        invited.rows[0].display_name,
        invited.rows[0].email,
        'no name is invented',
      );
    },
  );
  await check(
    'a same-actor retry with the same key converges on the original invitation',
    async () => {
      const retried = await begin(
        'invite-newcomer@example.test',
        'manager',
        key,
      );
      assert.equal(retried.id, begun.id);
      assert.equal(retried.revision, 1);
      assert.equal(
        await count(
          'select count(*)::int as count from public.employee_invitations where employee_id=$1',
          [begun.employeeId],
        ),
        1,
      );
      assert.equal(
        await count(
          'select count(*)::int as count from public.employees where email=$1',
          ['invite-newcomer@example.test'],
        ),
        1,
      );
    },
  );
  await check(
    'the same key under a different address or role conflicts',
    async () => {
      await fails(
        beginSql,
        ['invite-other@example.test', 'manager', key],
        '23505',
      );
      await fails(
        beginSql,
        ['invite-newcomer@example.test', 'admin', key],
        '23505',
      );
    },
  );

  // --- A different admin resumes instead of duplicating -----------------------------------
  await asActor(users.admin2);
  const resumed = await begin(
    'invite-newcomer@example.test',
    'manager',
    randomUUID(),
  );
  await check(
    'another live admin resumes the open invitation without a second person or a new actor',
    async () => {
      assert.equal(resumed.id, begun.id);
      assert.equal(
        resumed.actorId,
        staff.admin,
        'the original attribution is never rewritten',
      );
      assert.equal(resumed.role, 'manager');
      assert.equal(
        await count(
          'select count(*)::int as count from public.employees where email=$1',
          ['invite-newcomer@example.test'],
        ),
        1,
      );
    },
  );
  await check('a conflicting role for an open invitation is refused', () =>
    fails(
      beginSql,
      ['invite-newcomer@example.test', 'admin', randomUUID()],
      'P0022',
    ),
  );

  // --- Existing retained employees are never reused or activated --------------------------
  await asActor(users.admin);
  await check(
    'an existing active, inactive or unlinked employee email is not a new invitee',
    async () => {
      for (const email of [
        'invite-linked@example.test',
        'invite-inactive@example.test',
        'invite-unlinked@example.test',
      ])
        await fails(beginSql, [email, 'sales', randomUUID()], 'P0020');
      const untouched = await db.query(
        "select role,is_active,auth_user_id from public.employees where email in ('invite-inactive@example.test','invite-unlinked@example.test') order by email",
      );
      assert.deepEqual(
        untouched.rows.map((row) => [
          row.role,
          row.is_active,
          row.auth_user_id,
        ]),
        [
          ['staff', false, null],
          ['manager', false, null],
        ],
      );
      assert.equal(
        await count(
          "select count(*)::int as count from public.employee_invitations where email in ('invite-inactive@example.test','invite-unlinked@example.test')",
        ),
        0,
      );
    },
  );

  // --- The server-only provider boundary --------------------------------------------------
  const providerEmail = 'invite-resumable@example.test';
  const resumable = await begin(providerEmail, 'staff', randomUUID());
  await asActor(users.sales);
  await check('an authenticated client cannot record a provider result', () =>
    fails(
      recordSql,
      [
        resumable.id,
        resumable.revision,
        staff.admin,
        providerEmail,
        'accepted',
        providerIdentity,
        null,
      ],
      '42501',
    ),
  );
  await asService();
  await check(
    'an accepted request requires the provider identity it created',
    () =>
      fails(
        recordSql,
        [
          resumable.id,
          resumable.revision,
          staff.admin,
          providerEmail,
          'accepted',
          null,
          null,
        ],
        '23514',
      ),
  );
  await check('a stale revision cannot record a provider result', () =>
    fails(
      recordSql,
      [
        resumable.id,
        resumable.revision + 5,
        staff.admin,
        providerEmail,
        'accepted',
        providerIdentity,
        null,
      ],
      'PT409',
    ),
  );
  await check(
    'an address other than the recorded intended identity is refused',
    () =>
      fails(
        recordSql,
        [
          resumable.id,
          resumable.revision,
          staff.admin,
          'invite-elsewhere@example.test',
          'accepted',
          providerIdentity,
          null,
        ],
        '23514',
      ),
  );
  const failed = await record(
    resumable.id,
    resumable.revision,
    staff.admin,
    providerEmail,
    'ambiguous',
    null,
    'provider request did not complete',
  );
  await check(
    'an ambiguous attempt stays a reconcilable invitation without activating anyone',
    async () => {
      assert.equal(failed.state, 'provider_failed');
      assert.equal(failed.providerOutcome, 'ambiguous');
      assert.equal(failed.providerDetail, 'provider request did not complete');
      assert.equal(failed.recordedAt, null);
      assert.equal(failed.revision, resumable.revision + 1);
      const invited = await db.query(
        'select is_active,auth_user_id from public.employees where id=$1',
        [resumable.employeeId],
      );
      assert.equal(invited.rows[0].is_active, false);
      assert.equal(invited.rows[0].auth_user_id, null);
    },
  );
  await asActor(users.admin2);
  const resumedFailed = await begin(providerEmail, 'staff', randomUUID());
  await check(
    'a failed send is resumed on the same original invitation, never duplicated',
    async () => {
      assert.equal(resumedFailed.id, resumable.id);
      assert.equal(resumedFailed.revision, failed.revision);
    },
  );
  await asService();
  const accepted = await record(
    resumedFailed.id,
    resumedFailed.revision,
    staff.admin,
    providerEmail,
    'accepted',
    providerIdentity,
    'ignored on success',
  );
  await check(
    'an accepted provider request records the invitation without claiming delivery or activation',
    async () => {
      assert.equal(accepted.state, 'recorded');
      assert.equal(accepted.providerOutcome, 'accepted');
      assert.equal(accepted.providerDetail, null);
      assert.ok(Number.isFinite(Date.parse(accepted.recordedAt)));
      assert.equal(
        accepted.providerUserId,
        undefined,
        'no provider identity in the public projection',
      );
      const invited = await db.query(
        'select email,role,is_active,auth_user_id from public.employees where id=$1',
        [resumable.employeeId],
      );
      assert.deepEqual(invited.rows, [
        {
          email: providerEmail,
          role: 'staff',
          is_active: false,
          auth_user_id: null,
        },
      ]);
      // The exact provider identity stays in the protected administrative record; the server
      // key has no read path of its own and the public projection never carries it.
      await asActor(users.admin);
      const stored = await db.query(
        'select provider_user_id::text,provider_outcome from public.employee_invitations where id=$1',
        [accepted.id],
      );
      assert.equal(stored.rows[0].provider_user_id, providerIdentity);
      await asService();
    },
  );
  await check(
    'an identical accepted retry converges and a recorded invitation is terminal',
    async () => {
      const repeated = await record(
        accepted.id,
        accepted.revision,
        staff.admin,
        providerEmail,
        'accepted',
        providerIdentity,
      );
      assert.equal(repeated.revision, accepted.revision);
      await fails(
        recordSql,
        [
          accepted.id,
          accepted.revision + 1,
          staff.admin,
          providerEmail,
          'failed',
          null,
          'later failure',
        ],
        'P0023',
      );
      await fails(
        recordSql,
        [
          accepted.id,
          accepted.revision + 1,
          staff.admin,
          providerEmail,
          'accepted',
          randomUUID(),
          null,
        ],
        'P0023',
      );
    },
  );
  await check(
    'a recorded invitation refuses a second invitation for the same person',
    async () => {
      await asActor(users.admin);
      await fails(beginSql, [providerEmail, 'staff', randomUUID()], 'P0021');
    },
  );
  await asActor(users.admin);
  const second = await begin(
    'invite-second-identity@example.test',
    'sales',
    randomUUID(),
  );
  await asService();
  await check(
    'one provider identity cannot be recorded for two invitations',
    () =>
      fails(
        recordSql,
        [
          second.id,
          second.revision,
          staff.admin,
          second.email,
          'accepted',
          providerIdentity,
          null,
        ],
        '23505',
      ),
  );

  // --- Authority and state are re-read when the provider result is recorded ----------------
  await asActor(users.admin);
  const linkChanged = await begin(
    'invite-link-changed@example.test',
    'sales',
    randomUUID(),
  );
  await asOwner();
  await db.query(
    'update public.employees set is_active=true, auth_user_id=$2 where id=$1',
    [linkChanged.employeeId, users.promoted],
  );
  await asService();
  await check(
    'a provider result cannot be recorded once the invited employee already has access',
    () =>
      fails(
        recordSql,
        [
          linkChanged.id,
          linkChanged.revision,
          staff.admin,
          linkChanged.email,
          'accepted',
          randomUUID(),
          null,
        ],
        'P0023',
      ),
  );

  // --- Reads and direct writes ------------------------------------------------------------
  await asActor(users.admin);
  const adminRead = await db.query(
    'select id::text from public.employee_invitations order by requested_at',
  );
  await check('a live admin reads recorded invitations', () =>
    assert.ok(adminRead.rows.length >= 3),
  );
  await asActor(users.sales);
  await check('a non-admin sees no invitation row', async () =>
    assert.equal(
      (await db.query('select id from public.employee_invitations')).rows
        .length,
      0,
    ),
  );
  await asUser(null);
  await check('an anonymous caller cannot read invitations', () =>
    fails('select id from public.employee_invitations', [], '42501'),
  );
  await asActor(users.admin);
  const directWrite =
    'insert into public.employee_invitations(employee_id,actor_id,email,role,idempotency_key) values' +
    ` ('${staff.admin}','${staff.admin}','invite-direct@example.test','sales',gen_random_uuid())`;
  await check(
    'an authenticated client cannot write an invitation directly',
    async () => {
      await fails(directWrite, [], '42501');
      await fails(
        `update public.employee_invitations set role='admin' where id='${begun.id}'`,
        [],
        '42501',
      );
      await fails(
        `delete from public.employee_invitations where id='${begun.id}'`,
        [],
        '42501',
      );
    },
  );
  await asService();
  await check(
    'the trusted server key cannot write an invitation directly either',
    async () => {
      await fails(directWrite, [], '42501');
      await fails(
        `update public.employee_invitations set role='admin' where id='${begun.id}'`,
        [],
        '42501',
      );
      await fails(
        `delete from public.employee_invitations where id='${begun.id}'`,
        [],
        '42501',
      );
    },
  );
  await asOwner();
  await check(
    'the owner administrative connection keeps the removal path the application does not expose',
    async () => {
      const removed = await db.query(
        'delete from public.employee_invitations where id=$1 returning id::text',
        [linkChanged.id],
      );
      assert.equal(removed.rows.length, 1);
      assert.equal(
        await count(
          'select count(*)::int as count from private.audit_events where table_name=$1 and action=$2',
          ['employee_invitations', 'DELETE'],
        ),
        1,
      );
    },
  );
  await db.query('delete from public.employees where id=$1', [
    linkChanged.employeeId,
  ]);
  await check(
    'the retained employee row of a removed invitation follows it out',
    async () =>
      assert.equal(
        await count(
          'select count(*)::int as count from public.employees where id=$1',
          [linkChanged.employeeId],
        ),
        0,
      ),
  );
  await check(
    'a demoted admin loses invitation authority on the next call',
    async () => {
      await asOwner();
      await db.query("update public.employees set role='sales' where id=$1", [
        staff.admin,
      ]);
      await asActor(users.admin);
      await fails(
        beginSql,
        ['invite-demoted@example.test', 'sales', randomUUID()],
        '42501',
      );
      await asOwner();
      await db.query("update public.employees set role='admin' where id=$1", [
        staff.admin,
      ]);
    },
  );
}
