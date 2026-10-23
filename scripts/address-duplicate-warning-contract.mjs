import assert from 'node:assert/strict';

// Issue #279 embedded regressions: the pre-create address read. It composes the text from the
// parts a creation states, decides a match with the one rule the post-create group uses, names only
// unarchived properties the caller may already read, and answers nothing for an address nobody
// records. Nothing here creates, blocks or changes a record.
//
// The captain's decision (23 October 2026): "2 all is duplicate warning". The pre-create read
// compares the composed text against every address a record holds, not only the one it marks
// primary. The post-create group keeps its primary-address basis, because it exists to serve a
// merge that proves its connected set over primary addresses; the cases below pin that difference
// in both directions rather than assuming the two sides agree.
//
// Issue #280 pins the two together where they must agree: for a primary-address fixture, the read a
// creation asks about its address and the group of the record that creation becomes are driven
// against each other, so a change to the shared rule fails here instead of leaving both quietly
// wrong.
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
  const composed = '12 Lê Lợi, Fixture Commune, Fixture Province';
  const elsewhere = '99 Hai Bà Trưng, Fixture Commune, Fixture Province';
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
  const recordedText = '8 NGUYEN HUE, FIXTURE COMMUNE, FIXTURE PROVINCE';
  // `plain` already records the address; each `saved` is the record a creation of it becomes,
  // inserted first so its group can be read, while the read itself is given only the parts a
  // creation states.
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
  // One address recorded with a run of spaces inside a street, beside the same address written
  // with one space. Composition trims only the ends, so these are two different texts.
  const spaced = 'b7000000-0000-4000-8000-000000000016';
  const spacedTwin = 'b7000000-0000-4000-8000-000000000017';
  const spacedParts = {
    format: 'current',
    house_number: '21',
    street: 'Lý  Thường Kiệt',
    province_unit_id: province,
    commune_unit_id: commune,
    is_primary: true,
  };
  const spacedTwinParts = { ...spacedParts, street: 'Lý Thường Kiệt' };
  // Two records whose coordinate is their own address and nothing else: one at an address other
  // records hold, one at an address no other record holds, both marked non-primary.
  const savedNonPrimary = 'b7000000-0000-4000-8000-000000000018';
  const soloNonPrimary = 'b7000000-0000-4000-8000-000000000019';
  const soloParts = {
    format: 'current',
    house_number: '41',
    street: 'Đồng Khởi',
    province_unit_id: province,
    commune_unit_id: commune,
    is_primary: false,
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
  // One row's composed text, exactly as a save stores it.
  const compose = async (address) =>
    (
      await db.query(
        `select private.composed_address_text(
           jsonb_populate_record(null::public.property_addresses,$1::jsonb)) as text`,
        [JSON.stringify(address)],
      )
    ).rows[0].text;
  // A save stores the composition of the parts it was given, so a record built from stated parts
  // is inserted with exactly the text the creation read compares against. `isPrimary` is the mark
  // the record puts on it: the warning reads it either way, the group does not.
  const savedAddress = async (propertyId, address, isPrimary = true) =>
    db.query(
      `insert into public.property_addresses(property_id,format,address_text,house_number,street,
         province_unit_id,commune_unit_id,is_primary)
       values ($1,'current',
         private.composed_address_text(jsonb_populate_record(null::public.property_addresses,$2::jsonb)),
         $3,$4,$5,$6,$7)`,
      [
        propertyId,
        JSON.stringify(address),
        address.house_number,
        address.street,
        address.province_unit_id,
        address.commune_unit_id,
        isPrimary,
      ],
    );
  const codes = (rows) => rows.map((row) => row.propertyCode).sort();
  const group = async (propertyId) =>
    (
      await db.query('select public.property_address_group($1) as grp', [
        propertyId,
      ])
    ).rows[0].grp;
  // Both callers on one fixture, for a duplicate reached through primary addresses: what the read
  // names for the parts a creation states must be exactly the group of the record the same creation
  // becomes, and both must name the expected records.
  const pair = async (label, address, saved, expected) => {
    await check(label, async () => {
      const warned = codes(await duplicates(address));
      assert.deepEqual(warned, codes((await group(saved)).members));
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
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,property_type,status,created_by)
     values ($1,'SGN279-SPACED','sale','house','available',$3),
            ($2,'SGN279-TWIN','sale','house','available',$3)`,
    [spaced, spacedTwin, employees[0]],
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
  await savedAddress(spaced, spacedParts);
  await savedAddress(spacedTwin, spacedTwinParts);
  await db.query('update public.properties set archived_at=now() where id=$1', [
    retired,
  ]);

  await asUser(0);
  await check(
    'the save’s own composition is the text the address row holds',
    async () => {
      assert.equal(await compose(parts), composed);
    },
  );
  // The captain's correction: the house number and the street name one line, and the levels above
  // them keep the `, ` they always had.
  await check(
    'the house number and the street are joined by a space, the levels above by a comma',
    async () => {
      const text = await compose(parityParts);
      assert.equal(text, '8 Nguyễn Huệ, Fixture Commune, Fixture Province');
      assert.doesNotMatch(text, /8, /);
      assert.equal((text.match(/, /g) ?? []).length, 2);
    },
  );
  // A part the address does not record leaves no separator of its own and no doubled space.
  await check(
    'a missing house number leaves the street alone, with no stray separator',
    async () => {
      const text = await compose({ ...parityParts, house_number: null });
      assert.equal(text, 'Nguyễn Huệ, Fixture Commune, Fixture Province');
      assert.doesNotMatch(text, /^[, ]|  /);
    },
  );
  await check(
    'a missing street leaves the house number alone, with no stray separator',
    async () => {
      const text = await compose({ ...parityParts, street: null });
      assert.equal(text, '8, Fixture Commune, Fixture Province');
      assert.doesNotMatch(text, /^[, ]|  /);
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
    'case, accents and spacing around a part are ignored by both sides alike',
    { ...parityParts, house_number: ' 8 ', street: 'nguyen hue' },
    savedTyped,
    ['SGN279-PLAIN', 'SGN279-RECORDED', 'SGN279-SAVED', 'SGN279-TYPED'],
  );
  // The captain's requirement: the warning compares addresses without case. It does not do that
  // itself - `private.address_match_key` lowercases and accent-folds both sides - so this pins the
  // shared rule: an address typed in upper case, and one typed in mixed case, name exactly the
  // records an address typed in lower case names.
  await check(
    'an address typed in upper or mixed case warns about the same records as one in lower case',
    async () => {
      const lower = codes(await duplicates(parityParts));
      assert.deepEqual(
        codes(await duplicates({ ...parityParts, street: 'NGUYỄN HUỆ' })),
        lower,
      );
      assert.deepEqual(
        codes(
          await duplicates({
            ...parityParts,
            house_number: '8',
            street: 'nGuYễN hUệ',
          }),
        ),
        lower,
      );
      assert.deepEqual(lower, [
        'SGN279-PLAIN',
        'SGN279-RECORDED',
        'SGN279-SAVED',
        'SGN279-TYPED',
      ]);
    },
  );
  // A run of spaces inside a part is not folded: both sides treat the two texts as different
  // addresses, so neither names the record written the other way, in either direction.
  await pair(
    'a run of spaces inside a part is not folded, so neither side names the other record',
    spacedParts,
    spaced,
    ['SGN279-SPACED'],
  );
  await pair(
    'a run of spaces inside a part is not folded when the creation states the tighter part',
    spacedTwinParts,
    spacedTwin,
    ['SGN279-TWIN'],
  );
  // A third address on the fixture: the existing record holds it and the record this creation
  // becomes is inserted for it too, so both sides name both and neither names the parity records.
  await pair(
    'an address an existing record holds is named by both sides, with the creation’s own record',
    elsewhereParts,
    savedElsewhere,
    ['SGN279-ELSEWHERE', 'SGN279-OTHER'],
  );
  // The captain's decision (23 October 2026): "2 all is duplicate warning". Which address a record
  // marks primary does not decide whether the warning names it, so the warning widens to every
  // address a record holds. The group does not: it serves a merge that only operates on primary
  // addresses, so a duplicate reached only through a non-primary address is warned about and not
  // grouped - neither from the record holding it as non-primary nor from the record holding it as
  // primary.
  await asOwner();
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,property_type,status,created_by)
     values ($1,'SGN279-NONPRIMARY','sale','house','available',$3),
            ($2,'SGN279-SOLO','sale','house','available',$3)`,
    [savedNonPrimary, soloNonPrimary, employees[0]],
  );
  await savedAddress(savedNonPrimary, parityParts, false);
  await savedAddress(soloNonPrimary, soloParts, false);
  await asUser(0);
  // (a) A primary-address duplicate is warned about and grouped, both naming the same records:
  // the `pair` cases above assert exactly that, while every fixture address is primary.
  // (b) A non-primary duplicate is warned about and not grouped, in both directions.
  await check(
    'a non-primary submission is warned about every record the same primary submission names',
    async () => {
      assert.deepEqual(
        codes(await duplicates({ ...parityParts, is_primary: false })),
        [
          'SGN279-NONPRIMARY',
          'SGN279-PLAIN',
          'SGN279-RECORDED',
          'SGN279-SAVED',
          'SGN279-TYPED',
        ],
      );
      assert.deepEqual(
        codes(await duplicates({ ...parityParts, is_primary: false })),
        codes(await duplicates(parityParts)),
      );
    },
  );
  await check(
    'a record holding only a non-primary address has no group, though the warning names it',
    async () => {
      assert.deepEqual((await group(savedNonPrimary)).members, []);
    },
  );
  await check(
    'a group on the primary address does not name the record holding it as non-primary',
    async () => {
      assert.deepEqual(codes((await group(savedClean)).members), [
        'SGN279-PLAIN',
        'SGN279-RECORDED',
        'SGN279-SAVED',
        'SGN279-TYPED',
      ]);
    },
  );
  await check(
    'a non-primary address no other record holds is warned about and groups nothing',
    async () => {
      assert.deepEqual(codes(await duplicates(soloParts)), ['SGN279-SOLO']);
      assert.deepEqual((await group(soloNonPrimary)).members, []);
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
