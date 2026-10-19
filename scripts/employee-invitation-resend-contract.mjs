import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Sending a recorded invitation again: the embedded regressions for the database rules.
// Only a live admin may do it, only for one recorded invitation whose person is still
// unlinked and whose account is neither active nor in account deletion, the recorded role and
// provider identity are untouched, each further send is recorded as its own attempt with the
// acting admin's name, and no second invitation row is ever created. Real provider delivery
// and the delivered-link browser journey stay a separately authorized staging gate.
export async function employeeInvitationResendContract({ db, check, fails }) {
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
  const asAnonymous = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.exec('set role anon');
  };

  const adminUser = '71000000-0000-4000-8000-0000000000a1';
  const adminUser2 = '71000000-0000-4000-8000-0000000000a2';
  const salesUser = '71000000-0000-4000-8000-0000000000a3';
  const inactiveUser = '71000000-0000-4000-8000-0000000000a4';
  const adminEmployee = '72000000-0000-4000-8000-0000000000a1';
  const adminEmployee2 = '72000000-0000-4000-8000-0000000000a2';
  const salesEmployee = '72000000-0000-4000-8000-0000000000a3';
  const inactiveEmployee = '72000000-0000-4000-8000-0000000000a4';

  const beginSql =
    'select public.begin_employee_invitation($1,$2,$3) as result';
  const recordSql =
    'select public.record_employee_invitation_result($1,$2,$3,$4,$5,$6,$7) as result';
  const resendSql =
    'select public.resend_employee_invitation($1,$2,$3,$4,$5) as result';
  const begin = async (email, role, key) =>
    (await db.query(beginSql, [email, role, key])).rows[0].result;
  const record = async (
    invitationId,
    revision,
    actorId,
    email,
    providerUserId,
  ) =>
    (
      await db.query(recordSql, [
        invitationId,
        revision,
        actorId,
        email,
        'accepted',
        providerUserId,
        null,
      ])
    ).rows[0].result;
  const resend = async (
    invitationId,
    resendCount,
    outcome,
    detail = null,
    providerUserId = null,
  ) =>
    (
      await db.query(resendSql, [
        invitationId,
        resendCount,
        outcome,
        detail,
        providerUserId,
      ])
    ).rows[0].result;
  const count = async (sql, params = []) =>
    Number((await db.query(sql, params)).rows[0].count);
  const invitationRow = async (id) =>
    (
      await db.query(
        'select state,revision,role,provider_outcome,provider_user_id,resend_count,resend_outcome,resend_detail,resend_actor_id,resend_attempted_at from public.employee_invitations where id = $1',
        [id],
      )
    ).rows[0];

  // The provider identities an invitation records must exist as sign-in identities, because the
  // retained employee row may only link one of them.
  const providerIdentities = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7'].map(
    (suffix) => `73000000-0000-4000-8000-0000000000${suffix}`,
  );
  // An identity no invitation records, for refusals that must never reach the provider.
  const probeIdentity = '73000000-0000-4000-8000-0000000000bf';
  providerIdentities.push(probeIdentity);
  await asOwner();
  await db.query('insert into auth.users values ($1),($2),($3),($4)', [
    adminUser,
    adminUser2,
    salesUser,
    inactiveUser,
  ]);
  for (const providerIdentity of providerIdentities)
    await db.query('insert into auth.users values ($1)', [providerIdentity]);
  await db.query(
    'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values' +
      " ($1,$2,'resend-admin@example.test','Resend Admin','admin',true)," +
      " ($3,$4,'resend-admin2@example.test','Resend Admin Two','admin',true)," +
      " ($5,$6,'resend-sales@example.test','Resend Sales','sales',true)",
    [
      adminEmployee,
      adminUser,
      adminEmployee2,
      adminUser2,
      salesEmployee,
      salesUser,
    ],
  );
  await db.query(
    "insert into public.employees(id,email,display_name,role,is_active) values ($1,'resend-inactive@example.test','Resend Inactive','staff',false)",
    [inactiveEmployee],
  );

  // Each recorded invitation names its own provider identity, because the recorded identity is
  // unique per invitation.
  let identities = 0;
  const nextIdentity = () => providerIdentities[identities++];
  const beginAndRecord = async (email, role = 'sales') => {
    await asActor(adminUser);
    const begun = await begin(email, role, randomUUID());
    const providerIdentity = nextIdentity();
    await asService();
    const recorded = await record(
      begun.id,
      begun.revision,
      adminEmployee,
      begun.email,
      providerIdentity,
    );
    return { begun, recorded, providerIdentity };
  };

  const first = await beginAndRecord('  Resend-Newcomer@Example.Test  ');
  const invitationId = first.begun.id;
  const employeeId = first.begun.employeeId;
  const identity = first.providerIdentity;

  // --- Live admin authority ---------------------------------------------------------------
  await asAnonymous();
  await check(
    'an anonymous caller cannot send a recorded invitation again',
    () =>
      fails(resendSql, [invitationId, 0, 'accepted', null, identity], '42501'),
  );
  for (const [who, userId] of [
    ['sales', salesUser],
    ['inactive', inactiveUser],
  ]) {
    await asActor(userId);
    await check(`a ${who} caller cannot send a recorded invitation again`, () =>
      fails(resendSql, [invitationId, 0, 'accepted', null, identity], '42501'),
    );
  }
  await asService();
  await check(
    'the trusted server role cannot record a further send under an admin name',
    () =>
      fails(resendSql, [invitationId, 0, 'accepted', null, identity], '42501'),
  );

  // --- The live admin sends it again ------------------------------------------------------
  await asActor(adminUser);
  await check('a live admin sends the recorded invitation again', async () => {
    const resent = await resend(invitationId, 0, 'accepted', null, identity);
    assert.equal(resent.id, invitationId);
    assert.equal(resent.resendCount, 1);
    assert.equal(resent.resendOutcome, 'accepted');
    assert.equal(resent.resendDetail, null);
    assert.equal(resent.resendActorId, adminEmployee);
    assert.ok(
      resent.resendAttemptedAt,
      'the further send is recorded with its own time',
    );
    // The recorded invitation itself is unchanged: the recorded role, revision and provider
    // acceptance stay exactly as the first send recorded them.
    assert.equal(resent.state, 'recorded');
    assert.equal(resent.providerOutcome, 'accepted');
    const row = await invitationRow(invitationId);
    assert.equal(row.role, 'sales');
    assert.equal(row.revision, first.recorded.revision);
    assert.equal(row.provider_outcome, 'accepted');
    assert.equal(row.provider_user_id, identity);
    assert.equal(row.resend_count, 1);
    assert.equal(row.resend_actor_id, adminEmployee);
  });
  await check(
    'no second invitation or employee row is created for the same address',
    async () => {
      assert.equal(
        await count(
          'select count(*)::int as count from public.employee_invitations where employee_id = $1',
          [employeeId],
        ),
        1,
      );
      assert.equal(
        await count(
          'select count(*)::int as count from public.employees where email = $1',
          ['resend-newcomer@example.test'],
        ),
        1,
      );
    },
  );
  await check(
    'a second admin records a further send under their own name',
    async () => {
      await asActor(adminUser2);
      const resent = await resend(invitationId, 1, 'failed', 'rate limited');
      assert.equal(resent.resendCount, 2);
      assert.equal(resent.resendOutcome, 'failed');
      assert.equal(resent.resendDetail, 'rate limited');
      assert.equal(resent.resendActorId, adminEmployee2);
      // The earlier recorded acceptance stays readable next to the refusal.
      assert.equal(resent.state, 'recorded');
      assert.equal(resent.providerOutcome, 'accepted');
      assert.equal(resent.revision, first.recorded.revision);
    },
  );

  // --- Stale and malformed attempts -------------------------------------------------------
  await asActor(adminUser);
  await check('a stale resend count is refused', () =>
    fails(resendSql, [invitationId, 1, 'accepted', null, identity], 'PT409'),
  );
  await check('an unknown provider outcome is refused', async () => {
    await fails(resendSql, [invitationId, 2, 'sent', null, null], '23514');
    assert.equal((await invitationRow(invitationId)).resend_count, 2);
  });
  await check(
    'an accepted further send must name the recorded provider identity',
    async () => {
      await fails(
        resendSql,
        [invitationId, 2, 'accepted', null, randomUUID()],
        '23514',
      );
      await fails(
        resendSql,
        [invitationId, 2, 'accepted', null, null],
        '23514',
      );
      assert.equal((await invitationRow(invitationId)).resend_count, 2);
    },
  );

  // --- An accepted invitation is never sent again -----------------------------------------
  const accepted = await beginAndRecord('resend-accepted@example.test');
  await asOwner();
  await db.query(
    'update public.employees set auth_user_id = $1, is_active = true where id = $2',
    [accepted.providerIdentity, accepted.begun.employeeId],
  );
  await asActor(adminUser);
  await check(
    'an accepted, linked and active person is never sent again',
    async () => {
      await fails(
        resendSql,
        [accepted.begun.id, 0, 'accepted', null, accepted.providerIdentity],
        'P0023',
      );
      const row = await invitationRow(accepted.begun.id);
      assert.equal(row.resend_count, 0);
      assert.equal(row.resend_attempted_at, null);
    },
  );
  await check(
    'a deactivated but linked person is never sent again',
    async () => {
      await asOwner();
      await db.query(
        'update public.employees set is_active = false where id = $1',
        [accepted.begun.employeeId],
      );
      await asActor(adminUser);
      await fails(
        resendSql,
        [accepted.begun.id, 0, 'accepted', null, accepted.providerIdentity],
        'P0023',
      );
      assert.equal((await invitationRow(accepted.begun.id)).resend_count, 0);
    },
  );

  const deleted = await beginAndRecord('resend-deleted@example.test');
  await asOwner();
  await db.query(
    'update public.employees set auth_user_id = null, is_active = false, account_deleted_at = clock_timestamp() where id = $1',
    [deleted.begun.employeeId],
  );
  await asActor(adminUser);
  await check('an account-deleted person is never sent again', async () => {
    await fails(
      resendSql,
      [deleted.begun.id, 0, 'accepted', null, deleted.providerIdentity],
      'P0023',
    );
    assert.equal((await invitationRow(deleted.begun.id)).resend_count, 0);
  });

  // --- A deletion in flight: the unlinked, inactive shape is still refused ------------------
  // The real shape a begun account deletion leaves behind: the identity unlinked and the
  // membership disabled, exactly like someone who was only invited.
  const deleting = await beginAndRecord('resend-deleting@example.test');
  await asOwner();
  await db.query(
    'update public.employees set auth_user_id = $1, is_active = true where id = $2',
    [deleting.providerIdentity, deleting.begun.employeeId],
  );
  await asActor(adminUser);
  await db.query('select public.begin_employee_account_deletion($1,$2)', [
    deleting.begun.employeeId,
    randomUUID(),
  ]);
  await check(
    'an account deletion in flight is never re-invited, and the deletion stays resumable',
    async () => {
      await fails(
        resendSql,
        [deleting.begun.id, 0, 'accepted', null, deleting.providerIdentity],
        'P0023',
      );
      assert.equal((await invitationRow(deleting.begun.id)).resend_count, 0);
      assert.equal(
        await count(
          'select count(*)::int as count from public.employee_admin_operations where employee_id = $1 and kind = $2 and state <> $3',
          [deleting.begun.employeeId, 'delete', 'completed'],
        ),
        1,
      );
      // The begun deletion left the person unlinked and inactive, and it stays that way.
      const employee = (
        await db.query(
          'select auth_user_id,is_active from public.employees where id = $1',
          [deleting.begun.employeeId],
        )
      ).rows[0];
      assert.equal(employee.auth_user_id, null);
      assert.equal(employee.is_active, false);
    },
  );

  // --- Only a recorded invitation has anything to send again -------------------------------
  await asActor(adminUser);
  const pending = await begin(
    'resend-pending@example.test',
    'sales',
    randomUUID(),
  );
  await check(
    'an invitation the provider never accepted is refused',
    async () => {
      await fails(
        resendSql,
        [pending.id, 0, 'accepted', null, probeIdentity],
        'P0024',
      );
      assert.equal((await invitationRow(pending.id)).resend_count, 0);
    },
  );
  const failed = await begin(
    'resend-failed@example.test',
    'manager',
    randomUUID(),
  );
  await asService();
  await db.query(recordSql, [
    failed.id,
    failed.revision,
    adminEmployee,
    failed.email,
    'failed',
    null,
    'mailbox refused',
  ]);
  await asActor(adminUser);
  await check(
    'a reconcilable failed invitation resumes instead of being sent again',
    async () => {
      await fails(
        resendSql,
        [failed.id, 0, 'accepted', null, probeIdentity],
        'P0024',
      );
      const row = await invitationRow(failed.id);
      assert.equal(row.state, 'provider_failed');
      assert.equal(row.resend_count, 0);
      assert.equal(row.role, 'manager');
    },
  );

  // --- A changed recorded address is refused ----------------------------------------------
  const changed = await beginAndRecord('resend-changed@example.test');
  await asOwner();
  await db.query(
    "update public.employees set email = 'resend-moved@example.test' where id = $1",
    [changed.begun.employeeId],
  );
  await asActor(adminUser);
  await check(
    'a changed recorded address is refused, not re-invited',
    async () => {
      await fails(
        resendSql,
        [changed.begun.id, 0, 'accepted', null, changed.providerIdentity],
        '23514',
      );
      assert.equal((await invitationRow(changed.begun.id)).resend_count, 0);
    },
  );

  // --- Direct writes stay refused, and the recorded attempt keeps its own name -------------
  await asActor(adminUser);
  await check(
    'a client cannot write the further-send columns directly',
    async () => {
      await fails(
        'update public.employee_invitations set resend_count = resend_count + 1, resend_outcome = $1, resend_attempted_at = clock_timestamp(), resend_actor_id = $2 where id = $3',
        ['accepted', adminEmployee, invitationId],
        '42501',
      );
      await fails(
        'update public.employee_invitations set provider_detail = $1 where id = $2',
        ['rewritten', invitationId],
        '42501',
      );
      const row = await invitationRow(invitationId);
      assert.equal(row.resend_count, 2);
      assert.equal(row.provider_outcome, 'accepted');
    },
  );
  await asOwner();
  await check(
    'the recorded attempt still names the admin who sent it, and the row keeps the recorded role',
    async () => {
      // An admin being deactivated later changes nothing about the recorded attempt.
      await db.query(
        'update public.employees set is_active = false where id = $1',
        [adminEmployee2],
      );
      const row = await invitationRow(invitationId);
      assert.equal(row.resend_actor_id, adminEmployee2);
      assert.equal(row.resend_count, 2);
      assert.equal(row.role, 'sales');
      assert.equal(row.provider_user_id, identity);
    },
  );
}
