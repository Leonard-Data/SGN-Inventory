import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

// The legacy creator attribution, embedded: the import wrote each colleague's sign-in address into
// `employees.display_name`, so every `properties.created_by` reference resolved to an address (which
// the application never renders) or to the sheet's own `Admintrator` label. Migration
// `20261021020505_legacy_creator_display_names.sql` replaces that placeholder with the name the
// archived import rows record for the account, matched on the account's own address.
//
// The migration has already run against an empty table when the schema is applied, so this contract
// seeds accounts in the state production is in - the address as display name - and applies the
// migration's own statement again. What it pins: a named account takes the archive's name; a `Thư ký`
// account takes that label instead of an invented person; the `Admintrator` account keeps the label
// it already carries; an account the archive cannot name keeps its address, which states no name at
// all; and an account someone has already named is never overwritten.
export async function legacyCreatorNamesContract({ db, root, check }) {
  const sql = await fs.readFile(
    path.join(
      root,
      'supabase/migrations/20261021020505_legacy_creator_display_names.sql',
    ),
    'utf8',
  );
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const nameOf = async (email) =>
    (
      await db.query(
        'select display_name from public.employees where email = $1',
        [email],
      )
    ).rows[0]?.display_name;
  // The accounts in the placeholder state the import left them in: inactive and unlinked, so no
  // last-active-admin rule is involved, with the address as the display name.
  const seed = async (email, displayName = email) =>
    db.query(
      `insert into public.employees(auth_user_id,email,display_name,role,is_active)
       values (null,$1,$2,'sales',false)`,
      [email, displayName],
    );
  await asOwner();
  await seed('tansang.bt@gmail.com'); // a person's name in the archive
  await seed('thukysaigonnewhouse@gmail.com'); // the secretarial label
  await seed('manager.sgnewhouse@gmail.com'); // the administrator label
  await seed('tramtramsgnh@gmail.com'); // only ever an editor in the archive
  await seed('hong.nhapho@gmail.com', 'Nguyễn Thu Hà'); // already named by someone
  await db.exec(sql);

  await check(
    'a creation attribution names the person the archive records',
    () =>
      nameOf('tansang.bt@gmail.com').then((name) =>
        assert.equal(name, 'Tấn Sang'),
      ),
  );
  await check(
    'a secretarial account keeps the source label instead of an invented name',
    () =>
      nameOf('thukysaigonnewhouse@gmail.com').then((name) =>
        assert.equal(name, 'Thư ký'),
      ),
  );
  await check(
    'the administrator account keeps the label it already carries',
    () =>
      nameOf('manager.sgnewhouse@gmail.com').then((name) =>
        assert.equal(name, 'Admintrator'),
      ),
  );
  // The honest unresolved case: the sheet has no editor-name column, so an account that only ever
  // modified records keeps its address, which the application states as no name at all.
  await check('an account the archive cannot name keeps its address', () =>
    nameOf('tramtramsgnh@gmail.com').then((name) =>
      assert.equal(name, 'tramtramsgnh@gmail.com'),
    ),
  );
  await check('an account already named is never overwritten', () =>
    nameOf('hong.nhapho@gmail.com').then((name) =>
      assert.equal(name, 'Nguyễn Thu Hà'),
    ),
  );
  // A forward repair of a placeholder, not a rename path: applied again, it changes nothing.
  await check('applying the repair twice is a no-op', async () => {
    const read = async () =>
      (
        await db.query(
          'select id, display_name from public.employees order by id',
        )
      ).rows;
    const before = await read();
    await db.exec(sql);
    assert.deepEqual(await read(), before);
  });
  // Naming an account is not an identity change: no row was created, removed or relinked by it.
  await check(
    'naming an account changes no identity, role or access',
    async () => {
      const rows = (
        await db.query(
          `select distinct auth_user_id, role, is_active from public.employees
          where email = any($1::text[])`,
          [
            [
              'tansang.bt@gmail.com',
              'thukysaigonnewhouse@gmail.com',
              'manager.sgnewhouse@gmail.com',
              'tramtramsgnh@gmail.com',
              'hong.nhapho@gmail.com',
            ],
          ],
        )
      ).rows;
      assert.deepEqual(rows, [
        { auth_user_id: null, role: 'sales', is_active: false },
      ]);
    },
  );
}
