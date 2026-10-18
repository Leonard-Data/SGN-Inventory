import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// The first admin is bootstrapped once by reviewable SQL rather than seeded: the migration
// promotes the already-created Auth account named in docs/migration-plan.md phase 1 step 4 and
// touches no other employee row. Every environment without that account must stay untouched, so
// these embedded regressions cover the absent no-op, both promotion paths (an existing unlinked
// employee row and a brand-new one) and repeat safety.
const MIGRATION = '20261018120000_bootstrap_first_admin.sql';
const EMAIL = 'phunghungbinh.work@gmail.com';
const AUTH_USER = '00000000-0000-4000-8000-0000000000a1';
const RECORDED_EMPLOYEE = '10000000-0000-4000-8000-0000000000a1';

export async function adminBootstrapContract({ root, db, check }) {
  const sql = await fs.readFile(
    path.join(root, 'supabase/migrations', MIGRATION),
    'utf8',
  );
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const employeeRows = async () =>
    (
      await db.query(
        'select id, auth_user_id, email, display_name, role, is_active, access_revision from public.employees order by id',
      )
    ).rows;
  const emailRows = async () =>
    (
      await db.query(
        'select id, auth_user_id, email, display_name, role, is_active from public.employees where email=$1 order by id',
        [EMAIL],
      )
    ).rows;
  const authUserCount = async () =>
    (await db.query('select count(*)::int as n from auth.users')).rows[0].n;
  const removeFixture = async () => {
    await asOwner();
    await db.query('delete from public.employees where email=$1', [EMAIL]);
    await db.query('delete from auth.users where lower(email)=$1', [EMAIL]);
  };
  await asOwner();
  const baseline = await employeeRows();
  const authBaseline = await authUserCount();

  await check(
    'first-admin bootstrap does nothing where the account is absent',
    async () => {
      assert.equal((await emailRows()).length, 0);
      await db.exec(sql);
      assert.equal((await emailRows()).length, 0);
      assert.deepEqual(await employeeRows(), baseline);
      assert.equal(await authUserCount(), authBaseline);
    },
  );

  // A recorded but never-linked person for that address stays exactly as reviewed while the
  // Auth account does not exist: no link, no activation and no role change.
  await db.query(
    "insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,null,$2,'Recorded Person','sales',false)",
    [RECORDED_EMPLOYEE, EMAIL],
  );
  const withRecorded = await employeeRows();
  await check(
    'an unlinked recorded person is left alone without the account',
    async () => {
      await db.exec(sql);
      assert.deepEqual(await employeeRows(), withRecorded);
    },
  );

  await db.query(
    'insert into auth.users(id,email,raw_user_meta_data) values ($1,$2,\'{"full_name":"Phùng Hưng Bình"}\'::jsonb)',
    [AUTH_USER, EMAIL],
  );
  await check(
    'the existing reviewed row becomes the linked active admin',
    async () => {
      await db.exec(sql);
      const rows = await emailRows();
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        id: RECORDED_EMPLOYEE,
        auth_user_id: AUTH_USER,
        email: EMAIL,
        display_name: 'Recorded Person',
        role: 'admin',
        is_active: true,
      });
    },
  );
  await check('no other employee row changes', async () => {
    const others = (await employeeRows()).filter((row) => row.email !== EMAIL);
    assert.deepEqual(
      others,
      baseline.filter((row) => row.email !== EMAIL),
    );
  });

  const promoted = await employeeRows();
  await check(
    'a second application changes nothing and creates no admin',
    async () => {
      await db.exec(sql);
      assert.deepEqual(await employeeRows(), promoted);
      assert.equal((await emailRows()).length, 1);
    },
  );

  // The other promoted path: no employee row exists yet, so the admin row is created from the
  // account's own profile data, falling back to the address local part when it is absent.
  await removeFixture();
  const freshUser = '00000000-0000-4000-8000-0000000000a2';
  const before = await employeeRows();
  await db.query('insert into auth.users(id,email) values ($1,$2)', [
    freshUser,
    EMAIL,
  ]);
  await check(
    'an absent employee row is created as the linked admin',
    async () => {
      await db.exec(sql);
      const rows = await emailRows();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].auth_user_id, freshUser);
      assert.equal(rows[0].display_name, 'phunghungbinh.work');
      assert.equal(rows[0].role, 'admin');
      assert.equal(rows[0].is_active, true);
    },
  );
  await check('creating the admin touches no other employee row', async () => {
    assert.deepEqual(
      (await employeeRows()).filter((row) => row.email !== EMAIL),
      before.filter((row) => row.email !== EMAIL),
    );
  });
  const created = await employeeRows();
  await check(
    'a second application after creation changes nothing',
    async () => {
      await db.exec(sql);
      assert.deepEqual(await employeeRows(), created);
    },
  );

  await removeFixture();
  await check(
    'the bootstrap leaves no residue in the fixture schema',
    async () => {
      assert.deepEqual(await employeeRows(), baseline);
      assert.equal((await emailRows()).length, 0);
    },
  );
}
