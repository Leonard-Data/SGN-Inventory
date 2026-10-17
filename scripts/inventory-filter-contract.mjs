import assert from 'node:assert/strict';

// Advance Filter and Search Island embedded regressions for the advanced inventory filters. It proves the mode-aware
// asking-price range, the land-or-floor area range, the province/ward administrative-area match
// (a province includes its wards, a ward narrows), composition with the free-text query, the
// chronological cursor walk over a filtered eligible set, the retained archived exclusion, the
// database refusal of unknown and out-of-range bounds, the invoker/stable shape of both
// interfaces and the unchanged active-employee boundary. Real browser/Data API acceptance stays
// a staging gate.
export async function inventoryFilterContract({
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
  const id = (suffix) => `47000000-0000-4000-8000-0000000000${suffix}`;
  const sales = employees[0];
  const marker = 'FILTERFIX Kiem Thu';
  // Fixture-bound prices and areas are deliberately unlike any other contract's data, so a
  // bounded window matches this contract's rows and nothing else in the shared embedded schema.
  const saleHouse = id('01'); // sale 4,700,000,001 · land 4701 · floor 4751
  const rentHouse = id('02'); // rent 4,700,001 · land 4702 · floor 4702
  const bothFlat = id('03'); // both 4,700,000,002 / 4,700,002 · floor 4703
  const negotiatingLand = id('04'); // sale 4,700,000,003 · land 4704
  const draftHouse = id('05'); // draft, outside the chronological eligible set
  const archivedHouse = id('06'); // archived, must stay outside both filtered reads
  await asOwner();
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,property_type,sale_price_vnd,monthly_rent_vnd,land_area_m2,floor_area_m2,created_by,archived_at) values
      ($1,'SGN-FILTER-01','sale','available','house',4700000001,null,4701,4751,$7,null),
      ($2,'SGN-FILTER-02','rent','available','house',null,4700001,4702,4702,$7,null),
      ($3,'SGN-FILTER-03','both','available','apartment',4700000002,4700002,null,4703,$7,null),
      ($4,'SGN-FILTER-04','sale','negotiating','land',4700000003,null,4704,null,$7,null),
      ($5,'SGN-FILTER-05','sale','draft','house',4700000004,null,4705,4752,$7,null),
      ($6,'SGN-FILTER-06','sale','available','house',4700000005,null,4706,4706,$7,now())`,
    [
      saleHouse,
      rentHouse,
      bothFlat,
      negotiatingLand,
      draftHouse,
      archivedHouse,
      sales,
    ],
  );
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text) select p.id,'legacy',$2||' '||p.property_code from public.properties p where p.id=any($1::uuid[])",
    [
      [
        saleHouse,
        rentHouse,
        bothFlat,
        negotiatingLand,
        draftHouse,
        archivedHouse,
      ],
      marker,
    ],
  );
  // Two fixture provinces with a ward each, and one property left on a legacy address with no
  // official unit. The province/ward filter must use the recorded units, never the raw text.
  const provinceOne = '48000000-0000-4000-8000-000000000001';
  const provinceTwo = '48000000-0000-4000-8000-000000000002';
  const wardOne = '48000000-0000-4000-8000-000000000003';
  const wardTwo = '48000000-0000-4000-8000-000000000004';
  const wardThree = '48000000-0000-4000-8000-000000000005';
  await db.query(
    `insert into public.admin_unit_versions(id,official_code,name_vi,unit_level,parent_id,valid_from,source_url) values
      ($1,'FILTER-P1','Filter Province One','province',null,'2025-07-01','https://example.test/catalog'),
      ($2,'FILTER-P2','Filter Province Two','province',null,'2025-07-01','https://example.test/catalog'),
      ($3,'FILTER-C1','Filter Ward One','commune',$1,'2025-07-01','https://example.test/catalog'),
      ($4,'FILTER-C2','Filter Ward Two','commune',$1,'2025-07-01','https://example.test/catalog'),
      ($5,'FILTER-C3','Filter Ward Three','commune',$2,'2025-07-01','https://example.test/catalog')`,
    [provinceOne, provinceTwo, wardOne, wardTwo, wardThree],
  );
  // A verified legacy address stays immutable, so each area fixture is a current address beside
  // it, exactly as an addressed property records one.
  for (const [propertyId, provinceId, communeId] of [
    [saleHouse, provinceOne, wardOne],
    [rentHouse, provinceOne, wardTwo],
    [bothFlat, provinceTwo, wardThree],
    [draftHouse, provinceOne, wardOne],
    [archivedHouse, provinceOne, wardOne],
  ])
    await db.query(
      "insert into public.property_addresses(property_id,format,address_text,province_unit_id,commune_unit_id) values ($1,'current',$2,$3,$4)",
      [propertyId, `${marker} current`, provinceId, communeId],
    );
  await asUser(0);
  const mine = new Set([
    saleHouse,
    rentHouse,
    bothFlat,
    negotiatingLand,
    draftHouse,
    archivedHouse,
  ]);
  // Every assertion stays scoped to this contract's fixtures, so the shared embedded inventory
  // of the other contracts can neither satisfy nor break a filtered expectation.
  const scoped = (rows) =>
    rows.map((row) => row.id).filter((value) => mine.has(value));
  const search = (filters = {}) =>
    db
      .query(
        `select id from public.search_properties($1::text,$2::text,$3::text,$4::text,$5::uuid,null::uuid,50,
          $6::numeric,$7::numeric,$8::numeric,$9::numeric)`,
        [
          filters.query ?? '',
          filters.status ?? null,
          filters.mode ?? null,
          filters.type ?? null,
          filters.areaId ?? null,
          filters.priceMin ?? null,
          filters.priceMax ?? null,
          filters.areaMin ?? null,
          filters.areaMax ?? null,
        ],
      )
      .then((result) => scoped(result.rows));
  const age = (filters = {}, direction = 'oldest', cursor = {}, limit = 50) =>
    db
      .query(
        `select id from public.list_inventory_by_age($1::text,$2::text,$3::date,$4::uuid,$5::boolean,$6::integer,
          $7::text,$8::text,$9::text,$10::numeric,$11::numeric,$12::numeric,$13::numeric,$14::uuid)`,
        [
          direction,
          '',
          cursor.on ?? null,
          cursor.id ?? null,
          cursor.unknown ?? false,
          limit,
          filters.status ?? null,
          filters.mode ?? null,
          filters.type ?? null,
          filters.priceMin ?? null,
          filters.priceMax ?? null,
          filters.areaMin ?? null,
          filters.areaMax ?? null,
          filters.areaId ?? null,
        ],
      )
      .then((result) => scoped(result.rows));

  await check('an inventory status filter keeps only that status', async () => {
    assert.deepEqual(await search({ status: 'available' }), [
      saleHouse,
      rentHouse,
      bothFlat,
    ]);
    assert.deepEqual(await search({ status: 'draft' }), [draftHouse]);
  });
  await check(
    'a listing-mode filter keeps including a both listing',
    async () => {
      assert.deepEqual(await search({ mode: 'sale' }), [
        saleHouse,
        bothFlat,
        negotiatingLand,
        draftHouse,
      ]);
      assert.deepEqual(await search({ mode: 'rent' }), [rentHouse, bothFlat]);
      assert.deepEqual(await search({ mode: 'both' }), [bothFlat]);
    },
  );
  await check('a property-type filter keeps only that type', async () => {
    assert.deepEqual(await search({ type: 'house' }), [
      saleHouse,
      rentHouse,
      draftHouse,
    ]);
    assert.deepEqual(await search({ type: 'apartment' }), [bothFlat]);
  });
  await check(
    'a price range reads each listing price by its own mode',
    async () => {
      // A rent-only listing is inside its monthly asking rent, and a both listing is read by
      // its asking sale price when no mode is selected.
      assert.deepEqual(await search({ priceMin: 4700000, priceMax: 4700010 }), [
        rentHouse,
      ]);
      assert.deepEqual(
        await search({ priceMin: 4700000000, priceMax: 4700000010 }),
        [saleHouse, bothFlat, negotiatingLand, draftHouse],
      );
    },
  );
  await check(
    'a rent price range reads the monthly asking rent, including a both listing',
    async () => {
      assert.deepEqual(
        await search({ mode: 'rent', priceMin: 4700000, priceMax: 4700010 }),
        [rentHouse, bothFlat],
      );
      assert.deepEqual(
        await search({ mode: 'sale', priceMin: 4700000, priceMax: 4700010 }),
        [],
      );
    },
  );
  await check('each price bound stands alone', async () => {
    assert.deepEqual(await search({ mode: 'sale', priceMax: 4700000002 }), [
      saleHouse,
      bothFlat,
    ]);
    assert.deepEqual(await search({ mode: 'sale', priceMin: 4700000004 }), [
      draftHouse,
    ]);
    assert.deepEqual(
      await search({
        mode: 'sale',
        priceMin: 4700000003,
        priceMax: 4700000003,
      }),
      [negotiatingLand],
    );
  });
  await check(
    'an area range matches the land area or the floor area',
    async () => {
      assert.deepEqual(await search({ areaMin: 4700, areaMax: 4701.5 }), [
        saleHouse,
      ]);
      assert.deepEqual(await search({ areaMin: 4752, areaMax: 4752 }), [
        draftHouse,
      ]);
      assert.deepEqual(await search({ areaMin: 4703, areaMax: 4703 }), [
        bothFlat,
      ]);
      assert.deepEqual(await search({ areaMin: 4704, areaMax: 4704 }), [
        negotiatingLand,
      ]);
    },
  );
  await check('the filters compose with the free-text query', async () => {
    assert.deepEqual(await search({ query: marker }), [
      saleHouse,
      rentHouse,
      bothFlat,
      negotiatingLand,
      draftHouse,
    ]);
    assert.deepEqual(await search({ query: marker, status: 'draft' }), [
      draftHouse,
    ]);
    assert.deepEqual(
      await search({ query: marker, mode: 'rent', areaMax: 4703 }),
      [rentHouse, bothFlat],
    );
  });
  await check(
    'an archived match stays outside both filtered reads',
    async () => {
      for (const read of [search, age]) {
        assert.deepEqual(
          await read({
            mode: 'sale',
            priceMin: 4700000005,
            priceMax: 4700000005,
          }),
          [],
        );
      }
    },
  );
  await check(
    'a filtered chronological walk pages without omission or repetition',
    async () => {
      const filters = {
        mode: 'sale',
        priceMin: 4700000001,
        priceMax: 4700000003,
      };
      const first = await age(filters, 'oldest', {}, 1);
      assert.deepEqual(first, [saleHouse]);
      const second = await age(
        filters,
        'oldest',
        { unknown: true, id: first[0] },
        1,
      );
      assert.deepEqual(second, [bothFlat]);
      const third = await age(
        filters,
        'oldest',
        { unknown: true, id: second[0] },
        1,
      );
      assert.deepEqual(third, [negotiatingLand]);
      const end = await age(
        filters,
        'oldest',
        { unknown: true, id: third[0] },
        1,
      );
      assert.deepEqual(end, []);
      // The same filtered set walked newest-first visits the same rows in the other direction.
      assert.deepEqual(await age(filters, 'newest'), [
        negotiatingLand,
        bothFlat,
        saleHouse,
      ]);
    },
  );
  await check(
    'a province filter includes its wards and a ward filter narrows',
    async () => {
      assert.deepEqual(await search({ areaId: provinceOne }), [
        saleHouse,
        rentHouse,
        draftHouse,
      ]);
      assert.deepEqual(await search({ areaId: provinceTwo }), [bothFlat]);
      assert.deepEqual(await search({ areaId: wardOne }), [
        saleHouse,
        draftHouse,
      ]);
      assert.deepEqual(await search({ areaId: wardTwo }), [rentHouse]);
      // A legacy address without official units is never assigned to a province by text.
      assert.ok(
        !(await search({ areaId: provinceOne })).includes(negotiatingLand),
      );
    },
  );
  await check('the area filter composes with the other filters', async () => {
    assert.deepEqual(await search({ areaId: provinceOne, mode: 'rent' }), [
      rentHouse,
    ]);
    assert.deepEqual(await search({ areaId: wardOne, status: 'available' }), [
      saleHouse,
    ]);
    assert.deepEqual(await search({ areaId: provinceOne, query: marker }), [
      saleHouse,
      rentHouse,
      draftHouse,
    ]);
  });
  await check(
    'the area filter keeps the chronological walk paging consistently',
    async () => {
      assert.deepEqual(await age({ areaId: provinceOne }), [
        saleHouse,
        rentHouse,
      ]);
      assert.deepEqual(await age({ areaId: wardOne }), [saleHouse]);
      assert.deepEqual(await age({ areaId: provinceOne }, 'newest'), [
        rentHouse,
        saleHouse,
      ]);
      const first = await age({ areaId: provinceOne }, 'oldest', {}, 1);
      assert.deepEqual(first, [saleHouse]);
      const second = await age(
        { areaId: provinceOne },
        'oldest',
        { unknown: true, id: first[0] },
        1,
      );
      assert.deepEqual(second, [rentHouse]);
      assert.deepEqual(
        await age(
          { areaId: provinceOne },
          'oldest',
          { unknown: true, id: second[0] },
          1,
        ),
        [],
      );
    },
  );
  await check(
    'unknown or out-of-range bounds are refused, never silently matched',
    async () => {
      const rejected = [
        { status: 'archived' },
        { mode: 'lease' },
        { type: 'shophouse' },
        { priceMin: -1 },
        { priceMax: 1.5 },
        { priceMin: '1000000000000000000' },
        { areaMin: 0 },
        { areaMax: 12.345 },
        { areaMin: '10000000000' },
        { priceMin: 9000000000, priceMax: 8000000000 },
        { areaMin: 100.5, areaMax: 100.4 },
      ];
      for (const filters of rejected) {
        await fails(
          `select * from public.search_properties($1::text,$2::text,$3::text,$4::text,null::uuid,null::uuid,50,
            $5::numeric,$6::numeric,$7::numeric,$8::numeric)`,
          [
            '',
            filters.status ?? null,
            filters.mode ?? null,
            filters.type ?? null,
            filters.priceMin ?? null,
            filters.priceMax ?? null,
            filters.areaMin ?? null,
            filters.areaMax ?? null,
          ],
          '22023',
        );
        await fails(
          `select * from public.list_inventory_by_age('oldest','',null,null,false,50,$1::text,$2::text,$3::text,
            $4::numeric,$5::numeric,$6::numeric,$7::numeric)`,
          [
            filters.status ?? null,
            filters.mode ?? null,
            filters.type ?? null,
            filters.priceMin ?? null,
            filters.priceMax ?? null,
            filters.areaMin ?? null,
            filters.areaMax ?? null,
          ],
          '22023',
        );
      }
    },
  );
  await check(
    'both filtered reads stay stable invoker functions with a fixed search path',
    async () => {
      const shapes = await db.query(
        `select p.oid::regprocedure::text as signature, p.prosecdef, p.provolatile,
          coalesce(array_to_string(p.proconfig,','),'') as config
        from pg_proc p
        where p.oid in (
          'public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric)'::regprocedure,
          'public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid)'::regprocedure)
        order by signature`,
      );
      assert.equal(shapes.rows.length, 2);
      for (const shape of shapes.rows) {
        assert.equal(
          shape.prosecdef,
          false,
          `${shape.signature} must be invoker`,
        );
        assert.equal(
          shape.provolatile,
          's',
          `${shape.signature} must be stable`,
        );
        assert.match(shape.config, /search_path=/);
      }
      const granted = await db.query(
        `select has_function_privilege('authenticated',
            'public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric)', 'execute')
          and has_function_privilege('authenticated',
            'public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid)', 'execute')
          and not has_function_privilege('anon',
            'public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric)', 'execute')
          and not has_function_privilege('anon',
            'public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid)', 'execute') as allowed`,
      );
      assert.equal(granted.rows[0].allowed, true);
    },
  );
  await asUser(null);
  await check('anonymous filtered inventory reads are denied', () =>
    fails(
      "select * from public.search_properties('',null,null,null,null,null,50,'1',null,null,null)",
      [],
      '42501',
    ),
  );
  await asUser(4);
  await check('an inactive employee reads no filtered inventory', () =>
    fails("select * from public.list_inventory_by_age('oldest')", [], '42501'),
  );
  await asUser(0);
}
