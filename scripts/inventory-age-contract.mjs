import assert from 'node:assert/strict';

// Issue #37 embedded regressions: explicit original inventory entry dates and the eligible
// oldest-first/newest-first reads. It proves the known/unknown provenance pairing, the
// immutability that survives relisting and ordinary updates, database-computed Vietnam age,
// stable date+identity keyset paging across a date tie and the known/unknown boundary,
// eligible-status and archived exclusions, the separate effective-reservation fact, the
// query/eligibility integration and the active-employee/denial boundaries. Real Auth/Data
// API/RLS and browser acceptance stay a staging gate.
export async function inventoryAgeContract({
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
  // PGlite returns a PostgreSQL date as a JS Date at UTC midnight; compare calendar days.
  const isoDate = (value) =>
    value instanceof Date
      ? value.toISOString().slice(0, 10)
      : String(value).slice(0, 10);
  const id = (suffix) => `37000000-0000-4000-8000-0000000000${suffix}`;
  const sales = employees[0];
  const manager = employees[2];
  // A unique marker address keeps the exact-order assertions scoped to this contract's
  // fixtures without depending on the other contracts' inventory.
  const marker = 'AGEFIX 37 Kiểm Thử';
  const oldLegacy = id('01'); // reliable legacy date
  const tieHigh = id('03'); // same date as tieLow
  const tieLow = id('02'); // same date, smaller identity -> first oldest
  const recent = id('04');
  const unknownOne = id('05');
  const unknownTwo = id('06');
  const reserved = id('07');
  const soldOut = id('08'); // ineligible status with the oldest date
  const archived = id('09'); // archived eligible status
  const negotiating = id('0a'); // eligible status
  const draft = id('0b');
  const withdrawn = id('0c');
  const knownDate = '2023-02-03';
  const tieDate = '2025-06-01';
  const expectedEligible = [
    oldLegacy,
    reserved,
    tieLow,
    tieHigh,
    negotiating,
    recent,
    unknownOne,
    unknownTwo,
  ];
  const oldestOrder = expectedEligible;
  const newestOrder = [
    recent,
    negotiating,
    tieHigh,
    tieLow,
    reserved,
    oldLegacy,
    unknownTwo,
    unknownOne,
  ];

  async function ageRows(direction, query = '', cursor = {}) {
    const rows = await db.query(
      'select * from public.list_inventory_by_age($1::text,$2::text,$3::date,$4::uuid,$5::boolean,$6::integer)',
      [
        direction,
        query,
        cursor.on ?? null,
        cursor.id ?? null,
        cursor.unknown ?? false,
        cursor.limit ?? 50,
      ],
    );
    return rows.rows;
  }
  // Walk the real keyset cursor the application uses and return every row once.
  async function walk(direction, limit, query = 'agefix') {
    const seen = [];
    let cursor = { on: null, id: null, unknown: false };
    for (let guard = 0; guard < 50; guard++) {
      const rows = await ageRows(direction, query, { ...cursor, limit });
      seen.push(...rows);
      if (rows.length < limit) break;
      const last = rows.at(-1);
      cursor = last.entry_on
        ? { on: last.entry_on, id: last.id, unknown: false }
        : { on: null, id: last.id, unknown: true };
    }
    return seen;
  }

  await asOwner();
  const today = (
    await db.query(
      "(select (now() at time zone 'Asia/Ho_Chi_Minh')::date as vn_today)",
    )
  ).rows[0].vn_today;
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,created_by,entry_on,entry_source,archived_at) values
      ($1,'SGN-AGE-01','sale','available',$13,date '${knownDate}','legacy',null),
      ($2,'SGN-AGE-03','sale','available',$13,date '${tieDate}','recorded',null),
      ($3,'SGN-AGE-02','sale','available',$13,date '${tieDate}','recorded',null),
      ($4,'SGN-AGE-04','sale','available',$13,date '2026-09-30','recorded',null),
      ($5,'SGN-AGE-05','sale','available',$13,null,'unknown',null),
      ($6,'SGN-AGE-06','rent','available',$13,null,'unknown',null),
      ($7,'SGN-AGE-07','sale','available',$13,date '2024-05-05','legacy',null),
      ($8,'SGN-AGE-08','sale','sold',$13,date '2020-01-01','legacy',null),
      ($9,'SGN-AGE-09','sale','available',$13,date '2021-01-01','legacy',now()),
      ($10,'SGN-AGE-0A','sale','negotiating',$13,date '2025-06-02','recorded',null),
      ($11,'SGN-AGE-0B','sale','draft',$13,date '2022-01-01','legacy',null),
      ($12,'SGN-AGE-0C','sale','withdrawn',$13,date '2022-02-01','legacy',null)`,
    [
      oldLegacy,
      tieHigh,
      tieLow,
      recent,
      unknownOne,
      unknownTwo,
      reserved,
      soldOut,
      archived,
      negotiating,
      draft,
      withdrawn,
      sales,
    ],
  );
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text) select p.id,$2,$3||' '||p.property_code from public.properties p where p.id = any($1::uuid[])",
    [
      [
        oldLegacy,
        tieHigh,
        tieLow,
        recent,
        unknownOne,
        unknownTwo,
        reserved,
        soldOut,
        archived,
        negotiating,
        draft,
        withdrawn,
      ],
      'legacy',
      marker,
    ],
  );
  // An effective reservation is a separate fact: it must not remove otherwise eligible inventory.
  await db.query(
    "insert into public.property_locks(property_id,requested_by,reason,status,requested_at,expires_at,decided_by,decided_at) values($1,$2,'Approved reservation for the age fixture','approved',now()-interval '1 hour',now()+interval '5 days',$3,now()-interval '30 minutes')",
    [reserved, sales, manager],
  );

  await asUser(0);
  await check(
    'eligible oldest-first inventory uses the recorded entry date then identity',
    async () => {
      const rows = await ageRows('oldest', 'agefix');
      assert.deepEqual(
        rows.map((row) => row.id),
        oldestOrder,
      );
    },
  );
  await check(
    'eligible newest-first inventory is the exact reverse chronology',
    async () => {
      const rows = await ageRows('newest', 'agefix');
      assert.deepEqual(
        rows.map((row) => row.id),
        newestOrder,
      );
    },
  );
  await check(
    'unknown dates stay in the list, placed explicitly after the dated rows',
    async () => {
      const oldest = await ageRows('oldest', 'agefix');
      const newest = await ageRows('newest', 'agefix');
      assert.deepEqual(
        oldest.filter((row) => row.entry_on === null).map((row) => row.id),
        [unknownOne, unknownTwo],
      );
      assert.deepEqual(
        newest.filter((row) => row.entry_on === null).map((row) => row.id),
        [unknownTwo, unknownOne],
      );
      assert.equal(
        oldest.length,
        expectedEligible.length,
        'unknown rows must be present, not missing',
      );
      for (const row of oldest.filter(
        (r) => r.id === unknownOne || r.id === unknownTwo,
      )) {
        assert.equal(row.entry_source, 'unknown');
        assert.equal(row.entry_on, null);
        assert.equal(row.age_days, null);
      }
    },
  );
  await check(
    'age is the database Vietnam business day minus the recorded entry date',
    async () => {
      const rows = await ageRows('oldest', 'agefix');
      const legacy = rows.find((row) => row.id === oldLegacy);
      const expected = (
        await db.query(
          `(select ((now() at time zone 'Asia/Ho_Chi_Minh')::date - date '${knownDate}') as days)`,
        )
      ).rows[0].days;
      assert.equal(isoDate(legacy.entry_on), knownDate);
      assert.equal(legacy.entry_source, 'legacy');
      assert.equal(Number(legacy.age_days), Number(expected));
      const sameDay = rows.find((row) => row.id === recent);
      assert.equal(
        Number(sameDay.age_days),
        Number(
          (
            await db.query(
              "(select ((now() at time zone 'Asia/Ho_Chi_Minh')::date - date '2026-09-30') as days)",
            )
          ).rows[0].days,
        ),
      );
    },
  );
  await check(
    'sold, draft, withdrawn and archived inventory is excluded',
    async () => {
      const rows = await ageRows('oldest', 'agefix');
      for (const excluded of [soldOut, draft, withdrawn, archived])
        assert.ok(
          !rows.some((row) => row.id === excluded),
          `${excluded} must be excluded`,
        );
    },
  );
  await check(
    'a reserved property stays eligible; the reservation is read separately',
    async () => {
      const rows = await ageRows('oldest', 'agefix');
      assert.ok(rows.some((row) => row.id === reserved));
      assert.ok(
        (
          await db.query(
            'select 1 from public.v_effective_property_locks where property_id=$1',
            [reserved],
          )
        ).rows.length === 1,
      );
    },
  );
  await check(
    'both directions page with the date+identity cursor across a date tie',
    async () => {
      for (const [direction, expected] of [
        ['oldest', oldestOrder],
        ['newest', newestOrder],
      ])
        for (const limit of [1, 2, 3, 5]) {
          const walked = await walk(direction, limit);
          assert.deepEqual(
            walked.map((row) => row.id),
            expected,
            `${direction} limit ${limit}`,
          );
          assert.equal(
            new Set(walked.map((row) => row.id)).size,
            walked.length,
            'no repeats',
          );
        }
    },
  );

  // A staff relist and a price edit must not reset the recorded original date or age.
  await asUser(5);
  const maintenanceSql =
    'select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1)) as id';
  async function maintain(propertyId, changes) {
    const revision = (
      await db.query('select revision from public.properties where id=$1', [
        propertyId,
      ])
    ).rows[0].revision;
    return db.query(maintenanceSql, [
      propertyId,
      'property',
      propertyId,
      revision,
      changes,
    ]);
  }
  const ageBefore = Number(
    (await ageRows('oldest', 'agefix')).find((row) => row.id === oldLegacy)
      .age_days,
  );
  await maintain(oldLegacy, { status: 'withdrawn' });
  await maintain(oldLegacy, { status: 'available' });
  await maintain(oldLegacy, { sale_price_vnd: '999999999999999999' });
  await check(
    'relisting and price edits preserve the original entry date and age',
    async () => {
      const row = (await ageRows('oldest', 'agefix')).find(
        (r) => r.id === oldLegacy,
      );
      assert.equal(isoDate(row.entry_on), knownDate);
      assert.equal(row.entry_source, 'legacy');
      assert.equal(Number(row.age_days), ageBefore);
      assert.deepEqual(
        (await ageRows('oldest', 'agefix')).map((r) => r.id),
        oldestOrder,
      );
    },
  );
  await asUser(0);
  await check(
    'ordinary maintenance cannot rewrite the original entry date',
    () =>
      fails(
        maintenanceSql,
        [
          oldLegacy,
          'property',
          oldLegacy,
          '00000000-0000-4000-8000-0000000000ff',
          { entry_on: '2026-10-01' },
        ],
        '23514',
      ),
  );
  await asOwner();
  await check(
    'the recorded original entry date is immutable even for a direct write',
    async () => {
      await fails(
        "update public.properties set entry_on=date '2026-10-01' where id=$1",
        [oldLegacy],
        '23514',
      );
      await fails(
        "update public.properties set entry_source='recorded' where id=$1",
        [oldLegacy],
        '23514',
      );
      const row = (
        await db.query(
          'select entry_on,entry_source from public.properties where id=$1',
          [oldLegacy],
        )
      ).rows[0];
      assert.equal(isoDate(row.entry_on), knownDate);
      assert.equal(row.entry_source, 'legacy');
    },
  );
  await check(
    'known and unknown provenance must pair exactly and reject a future date',
    async () => {
      await fails(
        "insert into public.properties(id,property_code,listing_mode,status,created_by,entry_on,entry_source) values($1,'SGN-AGE-D1','sale','available',$2,date '2024-01-01','unknown')",
        [id('d1'), sales],
        '23514',
      );
      await fails(
        "insert into public.properties(id,property_code,listing_mode,status,created_by,entry_on,entry_source) values($1,'SGN-AGE-D2','sale','available',$2,null,'legacy')",
        [id('d2'), sales],
        '23514',
      );
      await fails(
        "insert into public.properties(id,property_code,listing_mode,status,created_by,entry_on,entry_source) values($1,'SGN-AGE-D3','sale','available',$2,(now() at time zone 'Asia/Ho_Chi_Minh')::date + 5,'recorded')",
        [id('d3'), sales],
        '23514',
      );
    },
  );

  // A genuinely new identity records the authoritative Vietnam business day, not import time.
  await asUser(0);
  const created = (
    await db.query('select public.create_property($1,$2,$3) as id', [
      'sale',
      {},
      { format: 'legacy', address_text: 'AGEFIX newly created identity' },
    ])
  ).rows[0].id;
  await check(
    'a new property identity records today as its known original entry date',
    async () => {
      const row = (
        await db.query(
          'select entry_on,entry_source from public.properties where id=$1',
          [created],
        )
      ).rows[0];
      assert.equal(isoDate(row.entry_on), isoDate(today));
      assert.equal(row.entry_source, 'recorded');
      const listed = (await ageRows('newest', 'agefix newly created')).find(
        (r) => r.id === created,
      );
      assert.equal(Number(listed.age_days), 0);
    },
  );
  await check(
    'creation facts cannot pre-set or forge the entry provenance',
    () =>
      fails(
        'select public.create_property($1,$2,$3)',
        [
          'sale',
          { entry_on: '2020-01-01' },
          { format: 'legacy', address_text: 'AGEFIX forged' },
        ],
        '23514',
      ),
  );

  await check(
    'invalid ordering and cursor shapes are rejected, not executed',
    async () => {
      for (const params of [
        ['random', '', null, null, false],
        [null, '', null, null, false],
        ['oldest', '', null, null, true],
        ['oldest', '', '2025-06-01', null, true],
        ['oldest', '', null, id('01'), false],
        ['oldest', '', '2025-06-01', null, false],
      ])
        await fails(
          'select * from public.list_inventory_by_age($1::text,$2::text,$3::date,$4::uuid,$5::boolean,30)',
          params,
          '22023',
        );
    },
  );
  await check(
    'the query filter keeps eligible inventory search and chronological order together',
    async () => {
      const rows = await ageRows('oldest', 'sgn-age-0a');
      assert.deepEqual(
        rows.map((row) => row.id),
        [negotiating],
      );
      await fails(
        'select * from public.list_inventory_by_age($1::text,$2::text)',
        ['oldest', 'x'.repeat(121)],
        '22023',
      );
    },
  );
  await check(
    'the archived read boundary applies to reviewers inside the age read too',
    async () => {
      await asUser(2);
      assert.ok(
        (
          await db.query('select 1 from public.properties where id=$1', [
            archived,
          ])
        ).rows.length === 1,
      );
      assert.ok(
        !(await ageRows('oldest', 'agefix')).some((row) => row.id === archived),
      );
      await asUser(0);
    },
  );
  await asUser(null);
  await check('anonymous inventory age read denied', () =>
    fails(
      'select * from public.list_inventory_by_age($1::text)',
      ['oldest'],
      '42501',
    ),
  );
  await asUser(4);
  await check(
    'inactive identity inventory age read denied',
    () =>
      fails(
        'select * from public.list_inventory_by_age($1::text,$2::text)',
        ['oldest', 'agefix'],
        '42501',
      ),
  );
  await asOwner();
}
