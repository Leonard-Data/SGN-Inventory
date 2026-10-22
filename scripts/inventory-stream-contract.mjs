import assert from 'node:assert/strict';

// Ticket #154 embedded regressions: the inventory list is one stream of everything, ordered
// newest-created first by default, fetched as consecutive offset windows of one filtered read.
// It proves that the default order is the recorded creation time (identity breaking ties), that
// consecutive windows walk the whole result set without repeats or gaps under all three
// orderings, that the matching total rides on every window and comes from the same read, that
// the archived and eligible-status boundaries apply to the count exactly as they apply to the
// rows, that a window past the end answers no rows with the real total, and that an unusable
// offset or ordering is refused rather than answered with a different result set.
// Real Data API windowing and browser acceptance stay a staging gate.
export async function inventoryStreamContract({
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
  const id = (suffix) => `4b000000-0000-4000-8000-0000000000${suffix}`;
  const sales = employees[0];
  const marker = 'STRMFIX Kiem Thu';
  // Twenty-four dated rows on four dates with six distinct creation times, two unknown entry
  // dates, one archived row of each and one ineligible status: enough to walk the stream with a
  // window of five, to cross date ties and to prove the creation-time default is not identity
  // order. One row also carries a rent price so the window's price fields are exercised.
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  const dated = [];
  for (let index = 0; index < 24; index++)
    dated.push({
      id: id(`${(index + 16).toString(16).padStart(2, '0')}`),
      code: `SGN-STRM-${String(index).padStart(2, '0')}`,
      entryOn: `2025-0${(index % 4) + 1}-0${(index % 5) + 1}`,
      createdAt: new Date(base + (index % 6) * 3_600_000),
      status: index % 3 === 0 ? 'negotiating' : 'available',
    });
  const unknownDated = {
    id: id('aa'),
    code: 'SGN-STRM-AA',
    entryOn: null,
    createdAt: new Date(base - 86_400_000),
  };
  const unknownSecond = {
    id: id('ab'),
    code: 'SGN-STRM-AB',
    entryOn: null,
    createdAt: new Date(base - 172_800_000),
  };
  const archived = {
    id: id('ac'),
    code: 'SGN-STRM-AC',
    entryOn: '2025-01-01',
    createdAt: new Date(base + 10 * 3_600_000),
  };
  const archivedUnknown = {
    id: id('ad'),
    code: 'SGN-STRM-AD',
    entryOn: null,
    createdAt: new Date(base - 259_200_000),
  };
  const sold = {
    id: id('ae'),
    code: 'SGN-STRM-AE',
    entryOn: '2025-01-01',
    createdAt: new Date(base + 11 * 3_600_000),
    status: 'sold',
  };
  const all = [
    ...dated,
    unknownDated,
    unknownSecond,
    archived,
    archivedUnknown,
    sold,
  ];

  async function read({
    order = null,
    offset = 0,
    limit = 5,
    query = 'strmfix',
    status = null,
    addressFormat = null,
    province = null,
    district = null,
    commune = null,
  } = {}) {
    const result = await db.query(
      `select * from public.stream_inventory(p_order => $1::text,p_query => $2::text,p_offset => $3::integer,
        p_limit => $4::integer,p_status => $5::text,p_address_format => $6::text,p_province_id => $7::uuid,
        p_district_id => $8::uuid,p_commune_id => $9::uuid)`,
      [
        order,
        query,
        offset,
        limit,
        status,
        addressFormat,
        province,
        district,
        commune,
      ],
    );
    // Every read answers at least one row: the window's rows, or the counting row alone when the
    // window has run out.
    assert.ok(result.rows.length >= 1, 'every read states the total');
    return {
      total: Number(result.rows[0].total_count),
      rows: result.rows.filter((row) => row.id !== null),
    };
  }

  await asOwner();
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,property_type,monthly_rent_vnd,created_by,entry_on,entry_source,created_at,archived_at)
    select * from unnest($1::uuid[],$2::text[],$3::text[],$4::text[],$5::text[],$6::numeric[],$7::uuid[],$8::date[],$9::text[],$10::timestamptz[],$11::timestamptz[])`,
    [
      all.map((row) => row.id),
      all.map((row) => row.code),
      all.map((row) => (row === dated[1] ? 'rent' : 'sale')),
      all.map((row) => row.status ?? 'available'),
      all.map(() => 'house'),
      all.map((row) => (row === dated[1] ? '25000000' : null)),
      all.map(() => sales),
      all.map((row) => row.entryOn),
      all.map((row) => (row.entryOn === null ? 'unknown' : 'legacy')),
      all.map((row) => row.createdAt),
      all.map((row) =>
        row.id === archived.id || row.id === archivedUnknown.id
          ? new Date()
          : null,
      ),
    ],
  );
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text,house_number,street,commune_text,district_text) select p.id,'legacy',$2||' '||p.property_code,'12','Le Loi','Ben Nghe','Quan 1' from public.properties p where p.id = any($1::uuid[])",
    [all.map((row) => row.id), marker],
  );
  // Two of those properties also record a current address, so the format filter has both kinds of
  // record to tell apart: one searched through the legacy text and one through the current text.
  const currentOnly = [dated[0], dated[2]];
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text) select p.id,'current',$2||' nuoc moi '||p.property_code from public.properties p where p.id = any($1::uuid[])",
    [currentOnly.map((row) => row.id), marker],
  );

  // Two fixtures also record the official units their address names, read from the seeded catalog:
  // a legacy province, district and ward on the property that records both formats, and a current
  // province and commune on that same property's current address, so one property's two addresses
  // sit in different generations. A second property names only the legacy province.
  const catalogRow = async (sql, params) =>
    (await db.query(sql, params)).rows[0];
  const legacyWard = await catalogRow(
    "select id,parent_id from public.admin_unit_versions where unit_level='commune' and valid_to='2025-07-01' order by official_code limit 1",
  );
  const legacyDistrict = await catalogRow(
    'select id,parent_id from public.admin_unit_versions where id=$1',
    [legacyWard.parent_id],
  );
  const currentCommune = await catalogRow(
    "select id,parent_id from public.admin_unit_versions where unit_level='commune' and valid_from='2025-07-01' order by official_code limit 1",
  );
  const legacyProvince = legacyDistrict.parent_id;
  const currentProvince = currentCommune.parent_id;
  // A recorded address is immutable, so these are their own rows rather than an edit.
  await db.query(
    `insert into public.property_addresses(property_id,format,address_text,province_unit_id,district_unit_id,commune_unit_id,is_primary)
      values ($1,'legacy','STRMFIX legacy units',$2,$3,$4,false),
        ($1,'current','STRMFIX current units',$5,null,$6,false),
        ($7,'legacy','STRMFIX legacy province',$2,null,null,false)`,
    [
      dated[0].id,
      legacyProvince,
      legacyDistrict.id,
      legacyWard.id,
      currentProvince,
      currentCommune.id,
      dated[1].id,
    ],
  );

  // The default stream is newest-created first with identity breaking ties; the chronology lists
  // the eligible statuses by entry date then identity with unknown dates placed last. Either way
  // one total order covers the whole unarchived filtered set.
  const browseOrder = [...all]
    .filter((row) => row.id !== archived.id && row.id !== archivedUnknown.id)
    .sort(
      (left, right) =>
        right.createdAt.getTime() - left.createdAt.getTime() ||
        right.id.localeCompare(left.id),
    )
    .map((row) => row.id);
  const byEntryDate = [...dated].sort(
    (left, right) =>
      left.entryOn.localeCompare(right.entryOn) ||
      left.id.localeCompare(right.id),
  );
  const oldestOrder = [
    ...byEntryDate.map((row) => row.id),
    unknownDated.id,
    unknownSecond.id,
  ];
  const newestOrder = [
    ...[...byEntryDate].reverse().map((row) => row.id),
    unknownSecond.id,
    unknownDated.id,
  ];

  await asUser(0);
  await check(
    'the default window is newest-created first with the matching total on every row',
    async () => {
      const first = await read({ limit: 5 });
      assert.equal(first.total, browseOrder.length);
      assert.equal(first.rows.length, 5);
      assert.deepEqual(
        first.rows.map((row) => row.id),
        browseOrder.slice(0, 5),
      );
      // The total rides on every row of the same read, never on a second query.
      for (const row of first.rows)
        assert.equal(Number(row.total_count), browseOrder.length);
      // A creation time older than every fixture's is not first: the order is the recorded
      // creation time, not identity order.
      assert.ok(!browseOrder.slice(0, 5).includes(unknownSecond.id));
    },
  );

  for (const [order, expected] of [
    [null, browseOrder],
    ['oldest', oldestOrder],
    ['newest', newestOrder],
  ]) {
    const label = order ?? 'created';
    await check(
      `the ${label} stream walks the whole result set without repeats or gaps`,
      async () => {
        const windowSize = 5;
        const windows = Math.ceil(expected.length / windowSize);
        const seen = [];
        for (let window = 0; window < windows; window++)
          seen.push(
            ...(
              await read({
                order,
                offset: window * windowSize,
                limit: windowSize,
              })
            ).rows,
          );
        assert.deepEqual(
          seen.map((row) => row.id),
          expected,
          `${label} order`,
        );
        assert.equal(new Set(seen.map((row) => row.id)).size, seen.length);
      },
    );
    await check(
      `the ${label} stream states the full total from a single window`,
      async () => {
        const window = await read({ order, offset: 5, limit: 5 });
        assert.equal(window.total, expected.length);
        assert.deepEqual(
          window.rows.map((row) => row.id),
          expected.slice(5, 10),
        );
      },
    );
  }

  await check(
    'a window past the end answers no rows and still states the real total',
    async () => {
      const beyond = await read({ offset: 9_000, limit: 100 });
      assert.deepEqual(beyond.rows, []);
      assert.equal(beyond.total, browseOrder.length);
      // The total rides on the counting row alone, whose window columns are absent.
      const raw = await db.query(
        `select * from public.stream_inventory($1::text,$2::text,$3::integer,$4::integer)`,
        [null, 'strmfix', 9_000, 100],
      );
      assert.equal(raw.rows.length, 1);
      assert.equal(raw.rows[0].id, null);
      assert.equal(Number(raw.rows[0].total_count), browseOrder.length);
      // A window that starts on the last row still lists it and the same total.
      const last = await read({ offset: browseOrder.length - 1, limit: 100 });
      assert.deepEqual(
        last.rows.map((row) => row.id),
        browseOrder.slice(-1),
      );
      assert.equal(last.total, browseOrder.length);
    },
  );

  await check(
    'the total follows the same filter and search as the window',
    async () => {
      const negotiating = await read({ status: 'negotiating', limit: 100 });
      assert.ok(negotiating.total > 0);
      assert.equal(negotiating.rows.length, negotiating.total);
      for (const row of negotiating.rows)
        assert.equal(row.status, 'negotiating');
      const searched = await read({ query: 'strm-ab', limit: 100 });
      assert.deepEqual(
        searched.rows.map((row) => row.id),
        [unknownSecond.id],
      );
      assert.equal(searched.total, 1);
      // A search that matches nothing states a total of zero with no rows, never a count of
      // some other inventory.
      const none = await read({ query: 'strmfix no such address' });
      assert.deepEqual(none.rows, []);
      assert.equal(none.total, 0);
    },
  );

  await check(
    'the archived boundary excludes the row from the total as well as the window',
    async () => {
      await asUser(2);
      // A reviewer may read the archived rows directly; the stream still excludes both.
      for (const row of [archived, archivedUnknown])
        assert.equal(
          (
            await db.query('select 1 from public.properties where id=$1', [
              row.id,
            ])
          ).rows.length,
          1,
        );
      const browse = await read({ limit: 100 });
      assert.equal(browse.total, browseOrder.length);
      assert.ok(!browse.rows.some((row) => row.id === archived.id));
      const search = await read({ query: 'strm-ac', limit: 100 });
      assert.deepEqual(search.rows, []);
      assert.equal(search.total, 0);
      await asUser(0);
    },
  );

  await check(
    'an ineligible status is outside the chronological total and window together',
    async () => {
      const oldest = await read({ order: 'oldest', limit: 100 });
      assert.equal(oldest.total, oldestOrder.length);
      assert.ok(!oldest.rows.some((row) => row.id === sold.id));
      // The same row is ordinary unarchived inventory, so the default stream counts and lists it.
      const browse = await read({ limit: 100 });
      assert.equal(browse.total, browseOrder.length);
      assert.ok(browse.rows.some((row) => row.id === sold.id));
    },
  );

  await check('each window row carries the recorded list fields', async () => {
    const window = await read({ limit: 100 });
    const row = window.rows.find((entry) => entry.id === dated[1].id);
    assert.ok(row, 'the rent fixture is listed');
    assert.equal(row.property_type, 'house');
    assert.equal(row.monthly_rent_vnd, '25000000');
    assert.equal(row.sale_price_vnd, null);
    assert.equal(row.listing_mode, 'rent');
    assert.ok(row.created_at instanceof Date);
    assert.ok(row.updated_at instanceof Date);
    // PGlite returns a PostgreSQL date as a JS Date at UTC midnight; compare calendar days.
    const isoDate = (value) =>
      value instanceof Date
        ? value.toISOString().slice(0, 10)
        : String(value).slice(0, 10);
    assert.equal(isoDate(row.entry_on), dated[1].entryOn);
  });

  await check(
    'an unusable offset or ordering is refused, not executed',
    async () => {
      for (const offset of [null, -3])
        await fails(
          'select * from public.stream_inventory(p_offset => $1::integer)',
          [offset],
          '22023',
        );
      for (const order of ['random', 'OLDEST', ''])
        await fails(
          'select * from public.stream_inventory(p_order => $1::text)',
          [order],
          '22023',
        );
      // A recorded other address is no format this read searches through.
      for (const format of ['alternate', 'LEGACY', 'both'])
        await fails(
          'select * from public.stream_inventory(p_address_format => $1::text)',
          [format],
          '22023',
        );
    },
  );

  await check(
    'the address format states which recorded address the search reads',
    async () => {
      // Every fixture records a legacy address, so the legacy format is the whole stream of them.
      const legacy = await read({ addressFormat: 'legacy', limit: 100 });
      assert.equal(legacy.total, browseOrder.length);
      assert.deepEqual(
        legacy.rows.map((row) => row.id),
        browseOrder,
      );
      // Only the two properties that record a current address match it: a property with no address
      // in the selected format does not match, and nothing is inferred on its behalf.
      const current = await read({ addressFormat: 'current', limit: 100 });
      assert.deepEqual(
        current.rows.map((row) => row.id).sort(),
        currentOnly.map((row) => row.id).sort(),
      );
      assert.equal(current.total, 2);
      // A word recorded only in the current address is answered by that format and by no other,
      // so one query is never matched through the address it did not select.
      const scoped = await read({
        addressFormat: 'current',
        query: 'nuoc moi',
        limit: 100,
      });
      assert.deepEqual(
        scoped.rows.map((row) => row.id).sort(),
        currentOnly.map((row) => row.id).sort(),
      );
      const wrong = await read({
        addressFormat: 'legacy',
        query: 'nuoc moi',
        limit: 100,
      });
      assert.deepEqual(wrong.rows, []);
      assert.equal(wrong.total, 0);
      // The property code still matches in either format, as it does in the ordinary read.
      const byCode = await read({
        addressFormat: 'current',
        query: dated[2].code.toLowerCase(),
        limit: 100,
      });
      assert.deepEqual(
        byCode.rows.map((row) => row.id),
        [dated[2].id],
      );
    },
  );

  await check(
    'the address format composes with the other filters and totals together',
    async () => {
      const narrowed = await read({
        addressFormat: 'current',
        status: 'available',
        limit: 100,
      });
      const available = currentOnly.filter(
        (row) => (row.status ?? 'available') === 'available',
      );
      assert.deepEqual(
        narrowed.rows.map((row) => row.id).sort(),
        available.map((row) => row.id).sort(),
      );
      assert.equal(narrowed.total, available.length);
      // An absent format applies no format condition, which is the read every earlier caller of
      // this function still gets.
      const unfiltered = await read({ addressFormat: null, limit: 100 });
      assert.equal(unfiltered.total, browseOrder.length);
    },
  );

  await check(
    'the stated administrative levels compose on one address of the searched format',
    async () => {
      // The province alone takes both properties that record it in a legacy address.
      const province = await read({
        province: legacyProvince,
        limit: 100,
      });
      assert.deepEqual(
        province.rows.map((row) => row.id).sort(),
        [dated[0].id, dated[1].id].sort(),
      );
      assert.equal(province.total, 2);
      // A district narrows its province and a ward its district, each on the same address.
      const district = await read({
        province: legacyProvince,
        district: legacyDistrict.id,
        limit: 100,
      });
      assert.deepEqual(
        district.rows.map((row) => row.id),
        [dated[0].id],
      );
      const ward = await read({
        province: legacyProvince,
        district: legacyDistrict.id,
        commune: legacyWard.id,
        limit: 100,
      });
      assert.deepEqual(
        ward.rows.map((row) => row.id),
        [dated[0].id],
      );
      // A level from another address, or another province's district, matches nothing rather than
      // a mixture of two recorded addresses.
      const mismatched = await read({
        province: legacyProvince,
        district: currentCommune.id,
        limit: 100,
      });
      assert.deepEqual(mismatched.rows, []);
      assert.equal(mismatched.total, 0);
      const absent = await read({ district: legacyDistrict.id, limit: 100 });
      assert.equal(absent.total, 1);
      // The levels apply to the address of the stated format: the one property here records a
      // legacy address in one province and a current address in another, so asking for the legacy
      // province through the current format does not match it.
      const scoped = await read({
        addressFormat: 'current',
        province: legacyProvince,
        limit: 100,
      });
      assert.deepEqual(scoped.rows, []);
      const current = await read({
        addressFormat: 'current',
        province: currentProvince,
        commune: currentCommune.id,
        limit: 100,
      });
      assert.deepEqual(
        current.rows.map((row) => row.id),
        [dated[0].id],
      );
    },
  );

  await asOwner();
}
