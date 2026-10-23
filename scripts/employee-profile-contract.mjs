import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Employee profile edit, embedded regressions: an admin edits a colleague's display name,
// phone, role and bio; every active employee edits their own name and bio; the recorded email
// is not editable anywhere; a non-admin cannot reach another employee through either path; the
// employee row read returns only the caller's own row, so no colleague's bio or phone is
// reachable through the table or the sanctioned name projection; the last-active-admin rule and
// the deactivated/deleted refusal hold; and the bio limit and its plain-text rule are enforced
// by the column as well as by the guarded functions. Live Data API RLS, HTTP and browser
// acceptance stay a separately authorized staging gate.
export async function employeeProfileContract({ db, asUser, check, fails }) {
  const asActor = async (userId) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      userId,
    ]);
    await db.exec('set role authenticated');
  };
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const ids = {
    adminUser: randomUUID(),
    admin: randomUUID(),
    personUser: randomUUID(),
    person: randomUUID(),
    inactiveUser: randomUUID(),
    inactive: randomUUID(),
    deleted: randomUUID(),
  };
  const email = (name) =>
    `${name.toLowerCase().replace(/ /g, '-')}@example.test`;
  await asOwner();
  for (const [userId, employeeId, name, role, active, deleted] of [
    [ids.adminUser, ids.admin, 'Profile Admin Fixture', 'admin', true, null],
    [ids.personUser, ids.person, 'Profile Person Fixture', 'sales', true, null],
    [
      ids.inactiveUser,
      ids.inactive,
      'Profile Inactive Fixture',
      'sales',
      false,
      null,
    ],
    [
      null,
      ids.deleted,
      'Profile Deleted Fixture',
      'sales',
      false,
      '2026-10-18T00:00:00Z',
    ],
  ]) {
    if (userId) await db.query('insert into auth.users values ($1)', [userId]);
    await db.query(
      'insert into public.employees(id,auth_user_id,email,display_name,role,is_active,account_deleted_at) values ($1,$2,$3,$4,$5,$6,$7)',
      [employeeId, userId, email(name), name, role, active, deleted],
    );
  }
  const row = async (employeeId) =>
    (
      await db.query(
        'select display_name,phone,role,bio,email,is_active from public.employees where id=$1',
        [employeeId],
      )
    ).rows[0];
  // The admin fixture carries the personal fields an ordinary employee must never read.
  await db.query(
    "update public.employees set phone='0901 222 333', bio='Quản trị viên của công ty.' where id=$1",
    [ids.admin],
  );
  const updateProfileSql =
    'select public.update_employee_profile($1,$2,$3,$4,$5) as result';
  const updateProfile = async (employeeId, name, phone, role, bio) =>
    (await db.query(updateProfileSql, [employeeId, name, phone, role, bio]))
      .rows[0].result;
  const updateMineSql = 'select public.update_my_profile($1,$2) as result';
  const updateMine = async (name, bio) =>
    (await db.query(updateMineSql, [name, bio])).rows[0].result;

  await asActor(ids.adminUser);
  await check(
    'an admin updates each recorded profile field and it persists',
    async () => {
      const result = await updateProfile(
        ids.person,
        'Nguyễn Thị An',
        '0909 111 222',
        'staff',
        'Phụ trách khu vực Quận 3.',
      );
      assert.deepEqual(result.changed.sort(), [
        'bio',
        'displayName',
        'phone',
        'role',
      ]);
      assert.deepEqual(await row(ids.person), {
        display_name: 'Nguyễn Thị An',
        phone: '0909 111 222',
        role: 'staff',
        bio: 'Phụ trách khu vực Quận 3.',
        email: email('Profile Person Fixture'),
        is_active: true,
      });
    },
  );
  await check(
    'a save that changes nothing reports no changed field',
    async () => {
      assert.deepEqual(
        (
          await updateProfile(
            ids.person,
            'Nguyễn Thị An',
            '0909 111 222',
            'staff',
            'Phụ trách khu vực Quận 3.',
          )
        ).changed,
        [],
      );
    },
  );
  await check(
    'the recorded email is not a field of the profile edit',
    async () => {
      // The identifying address is not a parameter, so the only way to name it is an arity the
      // function does not have; the recorded email is unchanged either way.
      await fails(
        'select public.update_employee_profile($1,$2,$3,$4,$5,$6)',
        [ids.person, 'An', '', 'staff', '', 'attacker@example.test'],
        '42883',
      );
      assert.equal(
        (await row(ids.person)).email,
        email('Profile Person Fixture'),
      );
    },
  );
  await check('an over-long bio is refused and nothing is saved', async () => {
    await fails(
      updateProfileSql,
      [ids.person, 'Nguyễn Thị An', '0909 111 222', 'staff', 'a'.repeat(281)],
      '23514',
    );
    assert.equal((await row(ids.person)).bio, 'Phụ trách khu vực Quận 3.');
    // The documented limit itself is accepted.
    await updateProfile(
      ids.person,
      'Nguyễn Thị An',
      '0909 111 222',
      'staff',
      'b'.repeat(280),
    );
    assert.equal((await row(ids.person)).bio.length, 280);
  });
  await check(
    'a bio stays plain text: markup and links are refused',
    async () => {
      for (const bio of [
        '<b>Nhà</b>',
        'Xem https://example.test',
        'Xem www.example.test',
      ])
        await fails(
          updateProfileSql,
          [ids.person, 'Nguyễn Thị An', '0909 111 222', 'staff', bio],
          '23514',
        );
    },
  );
  await check(
    'a blank submission of any whitespace is stored as no bio, never a recorded value',
    async () => {
      for (const blank of ['   ', '\t', '\n', '\r\n\t ', '\u00a0\u2003']) {
        await updateProfile(
          ids.person,
          'Nguyễn Thị An',
          '0909 111 222',
          'staff',
          blank,
        );
        assert.equal((await row(ids.person)).bio, null);
      }
      // The same whitespace set is trimmed from a recorded value, not stored at its edges.
      await updateProfile(
        ids.person,
        '\t Nguyễn Thị An \n',
        '0909 111 222',
        'staff',
        '\u00a0 Quận 3 \t',
      );
      assert.deepEqual(
        [(await row(ids.person)).display_name, (await row(ids.person)).bio],
        ['Nguyễn Thị An', 'Quận 3'],
      );
      await updateProfile(
        ids.person,
        'Nguyễn Thị An',
        '0909 111 222',
        'staff',
        '',
      );
      assert.equal((await row(ids.person)).bio, null);
    },
  );
  await check(
    'the column itself refuses an over-long, linked or whitespace-edged bio',
    async () => {
      await asOwner();
      for (const bio of [
        'a'.repeat(281),
        'Xem https://example.test',
        '  chưa cắt khoảng trắng',
        '\tchưa cắt',
        'chưa cắt\n',
        '\u00a0chưa cắt',
        '\t\n',
      ])
        await fails(
          'update public.employees set bio=$2 where id=$1',
          [ids.person, bio],
          '23514',
        );
      await asActor(ids.adminUser);
      assert.equal((await row(ids.person)).bio, null);
    },
  );
  await check('a deactivated employee cannot be edited', async () => {
    await fails(
      updateProfileSql,
      [ids.inactive, 'Sửa tên', '', 'sales', ''],
      'P0014',
    );
    assert.equal(
      (await row(ids.inactive)).display_name,
      'Profile Inactive Fixture',
    );
  });
  await check('a deleted account cannot be edited', async () => {
    await fails(
      updateProfileSql,
      [ids.deleted, 'Sửa tên', '', 'sales', ''],
      'P0014',
    );
    assert.equal(
      (await row(ids.deleted)).display_name,
      'Profile Deleted Fixture',
    );
  });
  await check('an unknown employee is refused as not found', async () => {
    await fails(
      updateProfileSql,
      [randomUUID(), 'Sửa tên', '', 'sales', ''],
      'P0013',
    );
  });
  await check('an unsupported role is refused', async () => {
    await fails(
      updateProfileSql,
      [ids.person, 'Nguyễn Thị An', '', 'owner', ''],
      '23514',
    );
    assert.equal((await row(ids.person)).role, 'staff');
  });
  await check(
    'the recorded role change is attributed to the acting admin',
    async () => {
      // The private audit trail is unexposed, so this evidence is read at owner level.
      await asOwner();
      const events = (
        await db.query(
          "select actor_user_id, before_data, after_data from private.audit_events where table_name='employees' and record_key=$1::text and action='UPDATE' order by id desc",
          [ids.person],
        )
      ).rows;
      const recorded = events.find(
        (event) =>
          event.before_data.role === 'sales' &&
          event.after_data.role === 'staff',
      );
      assert.ok(recorded, 'the role change is recorded');
      assert.equal(recorded.actor_user_id, ids.adminUser);
      assert.equal(recorded.before_data.email, recorded.after_data.email);
      await asActor(ids.adminUser);
    },
  );
  await check('a non-admin cannot edit another employee', async () => {
    await asActor(ids.personUser);
    await fails(
      updateProfileSql,
      [ids.admin, 'Bị đổi tên', '', 'sales', ''],
      '42501',
    );
    // The same write through the table is refused by the row policy as well.
    assert.equal(
      (
        await db.query(
          "update public.employees set bio='direct' where id=$1 returning id",
          [ids.admin],
        )
      ).rows.length,
      0,
    );
    await asActor(ids.adminUser);
    assert.equal((await row(ids.admin)).display_name, 'Profile Admin Fixture');
  });
  await check('an employee reads only their own employee row', async () => {
    await asActor(ids.personUser);
    const visible = (
      await db.query('select id,email,phone,bio from public.employees')
    ).rows;
    assert.deepEqual(
      visible.map((entry) => entry.id),
      [ids.person],
    );
    // Naming a colleague returns no row, so their bio, phone and email stay unreachable.
    assert.equal(
      (
        await db.query(
          'select id,phone,bio from public.employees where id=$1',
          [ids.admin],
        )
      ).rows.length,
      0,
    );
    // The sanctioned projection resolves names for the ids a surface references, and the
    // reviewer-only credited-closer read is not a second door for an ordinary employee.
    const names = (
      await db.query('select * from public.list_employee_names($1)', [
        [ids.person, ids.admin],
      ])
    ).rows;
    assert.deepEqual(
      names.map((entry) => entry.id).sort(),
      [ids.admin, ids.person].sort(),
    );
    assert.deepEqual(Object.keys(names[0]).sort(), ['display_name', 'id']);
    assert.equal(
      (await db.query('select * from public.list_employee_credit_options()'))
        .rows.length,
      0,
    );
    await asActor(ids.adminUser);
    const options = (
      await db.query('select * from public.list_employee_credit_options()')
    ).rows;
    assert.ok(options.some((entry) => entry.id === ids.admin));
    assert.deepEqual(Object.keys(options[0]).sort(), [
      'account_deleted_at',
      'auth_user_id',
      'display_name',
      'id',
      'is_active',
    ]);
  });
  await check('a person edits their own recorded name and bio', async () => {
    await asActor(ids.personUser);
    const result = await updateMine(
      '\t Trần Văn Bình \n',
      '\u00a0 Môi giới nhà phố Quận 7. \t',
    );
    assert.deepEqual(result, {
      displayName: 'Trần Văn Bình',
      bio: 'Môi giới nhà phố Quận 7.',
    });
    const mine = await row(ids.person);
    assert.equal(mine.display_name, 'Trần Văn Bình');
    assert.equal(mine.bio, 'Môi giới nhà phố Quận 7.');
    // The fields this path does not own keep their recorded values.
    assert.equal(mine.role, 'staff');
    assert.equal(mine.phone, '0909 111 222');
    assert.equal(mine.email, email('Profile Person Fixture'));
  });
  await check('the self path has no way to name another employee', async () => {
    // The guarded function takes only the person's own two fields, so an employee id is an
    // arity it does not accept, and the admin profile edit is refused to this caller.
    await fails(
      'select public.update_my_profile($1,$2,$3)',
      ['Tên khác', '', ids.admin],
      '42883',
    );
    await fails(
      updateProfileSql,
      [ids.person, 'Tự đổi vai trò', '', 'admin', ''],
      '42501',
    );
    await asActor(ids.adminUser);
    assert.equal((await row(ids.admin)).display_name, 'Profile Admin Fixture');
    assert.equal((await row(ids.person)).role, 'staff');
  });
  await check(
    'the self path refuses an over-long bio and a blank name',
    async () => {
      await asActor(ids.personUser);
      await fails(updateMineSql, ['Tên', 'a'.repeat(281)], '23514');
      for (const name of ['   ', '\t\n', '\u00a0\u2003'])
        await fails(updateMineSql, [name, ''], '23514');
      assert.equal((await row(ids.person)).display_name, 'Trần Văn Bình');
    },
  );
  await check('an inactive identity has no own profile to write', async () => {
    await asActor(ids.inactiveUser);
    await fails(updateMineSql, ['Tên', ''], '42501');
    // Read the retained row back with live authority: an inactive identity cannot read it.
    await asActor(ids.adminUser);
    assert.equal(
      (await row(ids.inactive)).display_name,
      'Profile Inactive Fixture',
    );
  });
  await check('the last active admin cannot be demoted', async () => {
    await asOwner();
    // Keep exactly one active admin: this fixture's admin. The other recorded admins are
    // demoted by an owner-level write -- which the guard permits while another active admin
    // exists -- and restored to their recorded role afterwards.
    const others = (
      await db.query(
        "select id from public.employees where role='admin' and id<>$1 order by id",
        [ids.admin],
      )
    ).rows.map((entry) => entry.id);
    await db.query(
      "update public.employees set role='manager' where id = any($1)",
      [others],
    );
    try {
      await asActor(ids.adminUser);
      await fails(
        updateProfileSql,
        [ids.admin, 'Profile Admin Fixture', '', 'manager', ''],
        'P0010',
      );
      assert.equal((await row(ids.admin)).role, 'admin');
    } finally {
      await asOwner();
      await db.query(
        "update public.employees set role='admin' where id = any($1)",
        [others],
      );
    }
    assert.equal(others.length > 0, true);
  });
  await check(
    'an admin may hand over the last admin seat to another admin',
    async () => {
      await asActor(ids.adminUser);
      await updateProfile(
        ids.person,
        'Trần Văn Bình',
        '0909 111 222',
        'admin',
        '',
      );
      // Now two admins exist, so demoting one of them is no longer the last seat.
      const result = await updateProfile(
        ids.person,
        'Trần Văn Bình',
        '0909 111 222',
        'staff',
        '',
      );
      assert.deepEqual(result.changed, ['role']);
      assert.equal((await row(ids.person)).role, 'staff');
    },
  );
  await check(
    'the profile functions are reachable only by an authenticated session',
    async () => {
      await asUser(null);
      await fails(updateMineSql, ['Tên', ''], '42501');
      await fails(
        updateProfileSql,
        [ids.person, 'Tên', '', 'sales', ''],
        '42501',
      );
      await asOwner();
      assert.equal((await row(ids.admin)).role, 'admin');
    },
  );
}
