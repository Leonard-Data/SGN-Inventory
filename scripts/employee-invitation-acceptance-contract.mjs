import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #69 embedded regressions: accepting a recorded employee invitation.
// The caller's own session is the only authority; only a recorded invitation whose recorded
// provider identity matches auth.uid() can link, activate and name the retained employee, and
// a consumed, stale, deactivated, deleted or mismatched invitation is refused without
// restoring authority. Real Auth delivery and the delivered-link browser journey stay a
// separately authorized staging gate; this proves the database rules the application relies on.
export async function employeeInvitationAcceptanceContract({
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

  const adminUser = '77000000-0000-4000-8000-0000000000a1';
  const adminEmployee = '78000000-0000-4000-8000-0000000000a1';
  const inviteeUser = '77000000-0000-4000-8000-0000000000b1';
  const otherUser = '77000000-0000-4000-8000-0000000000b2';
  const inviteeUser2 = '77000000-0000-4000-8000-0000000000b3';
  const inviteeUser3 = '77000000-0000-4000-8000-0000000000b4';

  const beginSql =
    'select public.begin_employee_invitation($1,$2,$3) as result';
  const recordSql =
    'select public.record_employee_invitation_result($1,$2,$3,$4,$5,$6,$7) as result';
  const acceptSql =
    'select public.accept_employee_invitation($1,$2,$3) as result';
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
  const accept = async (invitationId, revision, name) =>
    (await db.query(acceptSql, [invitationId, revision, name])).rows[0].result;
  const employeeRow = async (id) =>
    (
      await db.query(
        'select auth_user_id,is_active,display_name,role,account_deleted_at from public.employees where id = $1',
        [id],
      )
    ).rows[0];

  await asOwner();
  await db.query('insert into auth.users values ($1),($2),($3),($4),($5)', [
    adminUser,
    inviteeUser,
    otherUser,
    inviteeUser2,
    inviteeUser3,
  ]);
  await db.query(
    'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values' +
      " ($1,$2,'accept-admin@example.test','Acceptance Admin','admin',true)",
    [adminEmployee, adminUser],
  );

  const beginAndRecord = async (email, role, providerUserId) => {
    const key = randomUUID();
    await asActor(adminUser);
    const begun = await begin(email, role, key);
    await asService();
    const recorded = await record(
      begun.id,
      begun.revision,
      adminEmployee,
      begun.email,
      providerUserId,
    );
    return { begun, recorded };
  };

  // --- The first invitation: the successful journey ---------------------------------------
  const first = await beginAndRecord(
    '  Invitee@Example.Test  ',
    'staff',
    inviteeUser,
  );
  const invitationId = first.begun.id;
  const employeeId = first.begun.employeeId;
  assert.equal(first.begun.email, 'invitee@example.test');
  assert.equal(first.recorded.state, 'recorded');
  const recordedRevision = first.recorded.revision;

  await asUser(null);
  await check('anonymous cannot accept an employee invitation', () =>
    fails(acceptSql, [invitationId, recordedRevision, 'Invitee'], '42501'),
  );
  await asActor(adminUser);
  await check(
    'a different sign-in identity cannot accept the recorded invitation',
    () =>
      fails(acceptSql, [invitationId, recordedRevision, 'Invitee'], 'P0025'),
  );

  await asActor(inviteeUser);
  const accepted = await accept(
    invitationId,
    recordedRevision,
    '  Nguyễn Văn Ẩn  ',
  );
  await check(
    'the invitee links, activates and names the retained employee',
    async () => {
      assert.equal(accepted.id, employeeId);
      assert.equal(accepted.displayName, 'Nguyễn Văn Ẩn');
      assert.equal(accepted.email, 'invitee@example.test');
      assert.equal(accepted.role, 'staff');
      const row = await employeeRow(employeeId);
      assert.equal(
        row.auth_user_id,
        inviteeUser,
        'the exact identity is linked',
      );
      assert.equal(row.is_active, true, 'membership is enabled');
      assert.equal(
        row.display_name,
        'Nguyễn Văn Ẩn',
        'the recorded spelling is kept',
      );
      assert.equal(row.role, 'staff', 'the recorded role is never changed');
    },
  );

  await check(
    'a repeated acceptance converges on the same person and role',
    async () => {
      const again = await accept(
        invitationId,
        recordedRevision,
        'Nguyễn Văn Ẩn',
      );
      assert.equal(again.id, employeeId);
      assert.equal(again.displayName, 'Nguyễn Văn Ẩn');
      assert.equal(again.role, 'staff');
    },
  );

  await asOwner();
  await db.query(
    'update public.employees set is_active = false where id = $1',
    [employeeId],
  );
  await asActor(inviteeUser);
  await check(
    'a deactivated employee is never restored by a repeated acceptance',
    async () => {
      await fails(
        acceptSql,
        [invitationId, recordedRevision, 'Nguyễn Văn Ẩn'],
        'P0023',
      );
      await asOwner();
      const row = await employeeRow(employeeId);
      assert.equal(row.is_active, false, 'disabled access stays disabled');
      assert.equal(
        row.auth_user_id,
        inviteeUser,
        'the recorded link is retained while membership is disabled',
      );
    },
  );

  // --- The second invitation: stale, name-bounds and linked-to-another --------------------
  const second = await beginAndRecord(
    'second@example.test',
    'sales',
    inviteeUser2,
  );
  const secondId = second.begun.id;
  const secondEmployeeId = second.begun.employeeId;

  await asActor(inviteeUser2);
  await check('a stale revision is refused before linking', () =>
    fails(acceptSql, [secondId, 1, 'Second'], 'PT409'),
  );
  await check('a name outside the bounds is refused', async () => {
    await fails(
      acceptSql,
      [secondId, second.recorded.revision, '   '],
      '23514',
    );
    await fails(
      acceptSql,
      [secondId, second.recorded.revision, 'x'.repeat(201)],
      '23514',
    );
  });

  await asOwner();
  await db.query(
    'update public.employees set auth_user_id = $1, is_active = true where id = $2',
    [otherUser, secondEmployeeId],
  );
  await asActor(inviteeUser2);
  await check(
    'an employee already linked to another identity is never reassigned',
    () =>
      fails(acceptSql, [secondId, second.recorded.revision, 'Second'], 'P0023'),
  );

  // --- The third invitation: an account-deleted employee ----------------------------------
  const third = await beginAndRecord(
    'third@example.test',
    'sales',
    inviteeUser3,
  );
  await asOwner();
  await db.query(
    'update public.employees set auth_user_id = null, is_active = false, account_deleted_at = clock_timestamp() where id = $1',
    [third.begun.employeeId],
  );
  await asActor(inviteeUser3);
  await check('an account-deleted employee is refused', () =>
    fails(
      acceptSql,
      [third.begun.id, third.recorded.revision, 'Third'],
      'P0023',
    ),
  );

  // --- A provider-pending invitation is refused -------------------------------------------
  await asActor(adminUser);
  const pending = await begin('pending@example.test', 'sales', randomUUID());
  await asActor(inviteeUser);
  await check('an invitation the provider never accepted is refused', () =>
    fails(acceptSql, [pending.id, pending.revision, 'Pending'], 'P0024'),
  );

  // --- Direct client writes stay refused ---------------------------------------------------
  await asService();
  await check('a client cannot link or activate an employee directly', () =>
    fails(
      "update public.employees set auth_user_id = '77000000-0000-4000-8000-0000000000b1', is_active = true where id = '78000000-0000-4000-8000-0000000000a1'",
      [],
      '42501',
    ),
  );
}
