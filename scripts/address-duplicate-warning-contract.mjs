import assert from 'node:assert/strict';

// Issue #279 embedded regressions: the pre-create address read. It composes the text from the
// parts a creation states, decides a match with the one rule and the primary-address basis the
// post-create group uses, names only unarchived properties the caller may already read, and
// answers nothing for an address nobody records. Nothing here creates, blocks or changes a record;
// the post-create group and its merge stay as issue #147 left them.
export async function addressDuplicateWarningContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const province = 'b6000000-0000-4000-8000-000000000001';
  const commune = 'b6000000-0000-4000-8000-000000000002';
  // The address a creation would state: house number, street, commune and the stated province.
  const parts = {
    format: 'current',
    house_number: '12',
    street: 'Lê Lợi',
    province_unit_id: province,
    commune_unit_id: commune,
    is_primary: true,
  };
  const composed = '12, Lê Lợi, Fixture Commune, Fixture Province';
  const elsewhere = '99, Hai Bà Trưng, Fixture Commune, Fixture Province';
  const existing = 'b7000000-0000-4000-8000-000000000001';
  const retired = 'b7000000-0000-4000-8000-000000000002';
  const other = 'b7000000-0000-4000-8000-000000000003';

  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const duplicates = async (address) =>
    (
      await db.query('select public.property_address_duplicates($1) as found', [
        JSON.stringify(address),
      ])
    ).rows[0].found;

  await asOwner();
  await db.query(
    `insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,valid_from,source_url)
     values ($1,'WARN-P','Fixture Province','province','2025-07-01','https://example.test/catalog')`,
    [province],
  );
  await db.query(
    `insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,parent_id,valid_from,source_url)
     values ($1,'WARN-C','Fixture Commune','commune',$2,'2025-07-01','https://example.test/catalog')`,
    [commune, province],
  );
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,property_type,status,created_by)
     values ($1,'SGN279-A','sale','house','available',$4),
            ($2,'SGN279-RETIRED','sale','house','available',$4),
            ($3,'SGN279-OTHER','sale','house','available',$4)`,
    [existing, retired, other, employees[0]],
  );
  await db.query(
    `insert into public.property_addresses(property_id,format,address_text,house_number,street,
       province_unit_id,commune_unit_id)
     values ($1,'current',$4,'12','Lê Lợi',$6,$7),
            ($2,'current',$4,'12','Lê Lợi',$6,$7),
            ($3,'current',$5,'99','Hai Bà Trưng',$6,$7)`,
    [existing, retired, other, composed, elsewhere, province, commune],
  );
  await db.query('update public.properties set archived_at=now() where id=$1', [
    retired,
  ]);

  await asUser(0);
  await check(
    'the save’s own composition is the text the address row holds',
    async () => {
      const text = (
        await db.query(
          `select private.composed_address_text(
             jsonb_populate_record(null::public.property_addresses,$1::jsonb)) as text`,
          [JSON.stringify(parts)],
        )
      ).rows[0].text;
      assert.equal(text, composed);
    },
  );
  await check(
    'an address already recorded is named before the record exists',
    async () => {
      const found = await duplicates(parts);
      // Exactly what naming and opening a property needs, and nothing about its owner.
      assert.deepEqual(found, [{ id: existing, propertyCode: 'SGN279-A' }]);
    },
  );
  await check(
    'a match is decided by the one rule, not by the typing',
    async () => {
      // The same address written in another case and without accents is the same address.
      const found = await duplicates({
        ...parts,
        street: 'le loi',
        house_number: ' 12 ',
      });
      assert.deepEqual(
        found.map((row) => row.id),
        [existing],
      );
    },
  );
  await check(
    'the warning and the post-create group name the same records',
    async () => {
      const found = await duplicates(parts);
      const group = (
        await db.query('select public.property_address_group($1) as grp', [
          existing,
        ])
      ).rows[0].grp;
      assert.deepEqual(
        found.map((row) => row.id),
        group.members.map((member) => member.id),
      );
    },
  );
  await check('an archived record is not named', async () => {
    const found = await duplicates(parts);
    assert.equal(
      found.some((row) => row.id === retired),
      false,
    );
  });
  await check('a new address finds nothing and adds no step', async () => {
    assert.deepEqual(
      await duplicates({
        format: 'legacy',
        house_number: '77',
        street: 'Trần Hưng Đạo',
        province_unit_id: province,
        district_text: 'Quận 1',
        commune_unit_id: commune,
        is_primary: true,
      }),
      [],
    );
  });
  await check(
    'an address created as non-primary joins no group, so it is not warned about',
    async () => {
      assert.deepEqual(await duplicates({ ...parts, is_primary: false }), []);
      const unstated = { ...parts };
      delete unstated.is_primary;
      assert.deepEqual(await duplicates(unstated), []);
    },
  );
  await check('an address stating no part matches nothing', async () => {
    assert.deepEqual(
      await duplicates({ format: 'current', is_primary: true }),
      [],
    );
  });
  await check('anonymous pre-create read denied', async () => {
    await asUser(null);
    await fails(
      'select public.property_address_duplicates($1)',
      [JSON.stringify(parts)],
      '42501',
    );
  });
  await check('inactive employee pre-create read denied', async () => {
    await asUser(4);
    await fails(
      'select public.property_address_duplicates($1)',
      [JSON.stringify(parts)],
      '42501',
    );
  });
  await asOwner();
}
