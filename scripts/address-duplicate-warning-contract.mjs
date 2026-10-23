import assert from 'node:assert/strict';

// Issue #279 embedded regressions: the pre-create address read. It composes the text from the
// parts a creation states, decides a match with the one rule and the primary-address basis the
// post-create group uses, names only unarchived properties the caller may already read, and
// answers nothing for an address nobody records. Nothing here creates, blocks or changes a record;
// the post-create group and its merge stay as issue #147 left them.
//
// Issue #280 pins the two together: for the same fixture, the read before the record exists and
// the group of the record the creation becomes are driven against each other in both directions,
// so a change to one side alone fails here instead of leaving both quietly wrong.
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
  // The parity fixture: one address, recorded twice, beside the records creations of it become.
  const parityParts = {
    format: 'current',
    house_number: '8',
    street: 'Nguyễn Huệ',
    province_unit_id: province,
    commune_unit_id: commune,
    is_primary: true,
  };
  // The wording a record of that address was written with, which its parts would not compose.
  const recordedText = '8, NGUYEN HUE, FIXTURE COMMUNE, FIXTURE PROVINCE';
  // `plain` already records the address; each `saved` is the record a creation of it would become,
  // so its group is read afterwards while the read above answers about what is there before.
  const plain = 'b7000000-0000-4000-8000-000000000011';
  const recorded = 'b7000000-0000-4000-8000-000000000012';
  const savedClean = 'b7000000-0000-4000-8000-000000000013';
  const savedTyped = 'b7000000-0000-4000-8000-000000000014';
  const savedElsewhere = 'b7000000-0000-4000-8000-000000000015';
  const elsewhereParts = {
    format: 'current',
    house_number: '99',
    street: 'Hai Bà Trưng',
    province_unit_id: province,
    commune_unit_id: commune,
    is_primary: true,
  };

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
  // A save stores the composition of the parts it was given, so a record built from stated parts
  // is inserted with exactly the text the creation read compares against.
  const savedAddress = async (propertyId, address) =>
    db.query(
      `insert into public.property_addresses(property_id,format,address_text,house_number,street,
         province_unit_id,commune_unit_id)
       values ($1,'current',
         private.composed_address_text(jsonb_populate_record(null::public.property_addresses,$2::jsonb)),
         $3,$4,$5,$6)`,
      [
        propertyId,
        JSON.stringify(address),
        address.house_number,
        address.street,
        province,
        commune,
      ],
    );
  const codes = (rows) => rows.map((row) => row.propertyCode).sort();
  // Both callers on one fixture: what the read names before the record exists must be exactly the
  // group of the record the same creation becomes, and both must name the expected records.
  const pair = async (label, address, saved, expected) => {
    await check(label, async () => {
      const warned = codes(await duplicates(address));
      const group = (
        await db.query('select public.property_address_group($1) as grp', [
          saved,
        ])
      ).rows[0].grp;
      assert.deepEqual(warned, codes(group.members));
      assert.deepEqual(warned, expected);
    });
  };

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
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,property_type,status,created_by)
     values ($1,'SGN279-PLAIN','sale','house','available',$5),
            ($2,'SGN279-RECORDED','sale','house','available',$5),
            ($3,'SGN279-SAVED','sale','house','available',$5),
            ($4,'SGN279-TYPED','sale','house','available',$5),
            ($6,'SGN279-ELSEWHERE','sale','house','available',$5)`,
    [plain, recorded, savedClean, savedTyped, employees[0], savedElsewhere],
  );
  await savedAddress(plain, parityParts);
  // The one record whose text is the wording it was written with rather than a composition.
  await db.query(
    `insert into public.property_addresses(property_id,format,address_text,house_number,street,
       province_unit_id,commune_unit_id)
     values ($1,'current',$2,'8','Nguyễn Huệ',$3,$4)`,
    [recorded, recordedText, province, commune],
  );
  await savedAddress(savedClean, parityParts);
  await savedAddress(savedTyped, {
    ...parityParts,
    house_number: ' 8 ',
    street: 'nguyen hue',
  });
  await savedAddress(savedElsewhere, elsewhereParts);
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
  // A recorded text that differs from the composition of its own parts is still the same address,
  // and both sides say so: the read names it, and the group of the record creation produces holds
  // it. The set is pinned so a change to the rule fails here rather than keeping both sides wrong.
  await pair(
    'a recorded address text that differs from its composition is the same address to both',
    parityParts,
    savedClean,
    ['SGN279-PLAIN', 'SGN279-RECORDED', 'SGN279-SAVED', 'SGN279-TYPED'],
  );
  await pair(
    'case, accents and extra spacing are ignored by both sides alike',
    { ...parityParts, house_number: ' 8 ', street: 'nguyen hue' },
    savedTyped,
    ['SGN279-PLAIN', 'SGN279-RECORDED', 'SGN279-SAVED', 'SGN279-TYPED'],
  );
  // The other direction: an address these records do not hold is named by neither side, and the
  // group of the record created at it holds only what that address already recorded.
  await pair(
    'an address the records do not hold is absent from both sides',
    elsewhereParts,
    savedElsewhere,
    ['SGN279-ELSEWHERE', 'SGN279-OTHER'],
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
