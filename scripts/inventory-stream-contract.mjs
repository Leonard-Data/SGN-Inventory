import assert from 'node:assert/strict';

// Ticket #154 embedded regressions: the inventory list is one stream of everything, ordered
// most-recently-changed first by default, fetched as consecutive offset windows of one filtered
// read. It proves that the default order is the record's own modification time (identity breaking
// ties) and not its creation time, that an edit moves a record to the top of that order while the
// chronology is left alone, that consecutive windows walk the whole result set without repeats or
// gaps under all three orderings - including across records that share one change timestamp - that
// the matching total rides on every window and comes from the same read, that the archived and
// eligible-status boundaries apply to the count exactly as they apply to the rows, that a window
// past the end answers no rows with the real total, and that an unusable offset or ordering is
// refused rather than answered with a different result set.
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
  // Twenty-four dated rows on four dates with six distinct creation times and four distinct
  // modification times (six rows each), two unknown entry dates, one archived row of each and one
  // ineligible status: enough to walk the stream with a window of five, to cross date ties, to
  // prove the default order is neither the creation time nor the identity order, and to prove a
  // shared modification timestamp is decided by identity alone. One row also carries a rent price
  // so the window's price fields are exercised, and each row records a frontage and twice it as
  // depth so a dimension range selects known rows - except the first, which records neither, so a
  // stated bound has to leave an unmeasured row out.
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  // The access states cycle over the dated rows, so the access filter has several rows of each
  // state to keep and several to drop.
  const ACCESS_CYCLE = [
    'street_front',
    'car_alley',
    'motorbike_alley',
    'three_wheeler_alley',
  ];
  const dated = [];
  for (let index = 0; index < 24; index++)
    dated.push({
      id: id(`${(index + 16).toString(16).padStart(2, '0')}`),
      code: `SGN-STRM-${String(index).padStart(2, '0')}`,
      entryOn: `2025-0${(index % 4) + 1}-0${(index % 5) + 1}`,
      createdAt: new Date(base + (index % 6) * 3_600_000),
      // Deliberately not the creation time and deliberately shared by six rows: the browse order
      // follows this value, and the six rows on one value are what the identity tie-break decides.
      updatedAt: new Date(base + (index % 4) * 7_200_000),
      status: index % 3 === 0 ? 'negotiating' : 'available',
      accessType: ACCESS_CYCLE[index % ACCESS_CYCLE.length],
      frontage: index === 0 ? null : index + 1,
      depth: index === 0 ? null : (index + 1) * 2,
    });
  const unknownDated = {
    id: id('aa'),
    accessType: 'unknown',
    code: 'SGN-STRM-AA',
    entryOn: null,
    createdAt: new Date(base - 86_400_000),
    updatedAt: new Date(base - 86_400_000),
  };
  const unknownSecond = {
    id: id('ab'),
    accessType: 'unknown',
    code: 'SGN-STRM-AB',
    entryOn: null,
    createdAt: new Date(base - 172_800_000),
    updatedAt: new Date(base - 172_800_000),
  };
  const archived = {
    id: id('ac'),
    accessType: 'street_front',
    code: 'SGN-STRM-AC',
    entryOn: '2025-01-01',
    createdAt: new Date(base + 10 * 3_600_000),
    // The most recently changed of all the fixtures, and archived: the boundary excludes it from
    // the first window it would otherwise lead.
    updatedAt: new Date(base + 20 * 3_600_000),
  };
  const archivedUnknown = {
    id: id('ad'),
    accessType: 'unknown',
    code: 'SGN-STRM-AD',
    entryOn: null,
    createdAt: new Date(base - 259_200_000),
    updatedAt: new Date(base - 259_200_000),
  };
  const sold = {
    id: id('ae'),
    accessType: 'street_front',
    code: 'SGN-STRM-AE',
    entryOn: '2025-01-01',
    createdAt: new Date(base + 11 * 3_600_000),
    // Changed on the same instant as the six newest-changed dated rows, so the identity tie-break
    // decides a group the default window slices through.
    updatedAt: new Date(base + 6 * 3_600_000),
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
    communes = null,
    accessType = null,
    frontageMin = null,
    frontageMax = null,
    depthMin = null,
    depthMax = null,
    createdByMe = null,
  } = {}) {
    const result = await db.query(
      `select * from public.stream_inventory(p_order => $1::text,p_query => $2::text,p_offset => $3::integer,
        p_limit => $4::integer,p_status => $5::text,p_address_format => $6::text,p_province_id => $7::uuid,
        p_district_id => $8::uuid,p_commune_ids => $9::uuid[],p_access_type => $10::text,
        p_frontage_min => $11::numeric,p_frontage_max => $12::numeric,p_depth_min => $13::numeric,
        p_depth_max => $14::numeric,p_created_by_me => $15::boolean)`,
      [
        order,
        query,
        offset,
        limit,
        status,
        addressFormat,
        province,
        district,
        communes,
        accessType,
        frontageMin,
        frontageMax,
        depthMin,
        depthMax,
        createdByMe,
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
  // The property guard stamps `updated_at` on every write, so setting the fixtures' own change
  // times states them with the guard off; every later edit in this contract runs with it on.
  await db.exec('alter table public.properties disable trigger property_guard');
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,property_type,monthly_rent_vnd,created_by,entry_on,entry_source,created_at,updated_at,archived_at,access_type,frontage_m,depth_m)
    select * from unnest($1::uuid[],$2::text[],$3::text[],$4::text[],$5::text[],$6::numeric[],$7::uuid[],$8::date[],$9::text[],$10::timestamptz[],$11::timestamptz[],$12::timestamptz[],$13::text[],$14::numeric[],$15::numeric[])`,
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
      all.map((row) => row.updatedAt),
      all.map((row) =>
        row.id === archived.id || row.id === archivedUnknown.id
          ? new Date()
          : null,
      ),
      all.map((row) => row.accessType),
      all.map((row) => row.frontage ?? null),
      all.map((row) => row.depth ?? null),
    ],
  );
  await db.exec('alter table public.properties enable trigger property_guard');
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

  // Two imported-shaped addresses: free text only, no unit ids, and abbreviated the way a source
  // sheet writes it. They carry no STRMFIX marker, so the reads above and below that state a query
  // neither see them nor count them.
  const textImported = id('b1');
  const textNearMiss = id('b2');
  const textNames = await db.query(
    'select id,name_vi from public.admin_unit_versions where id = any($1::uuid[])',
    [[legacyProvince, legacyDistrict.id, legacyWard.id]],
  );
  const unitName = (unitId) =>
    textNames.rows.find((row) => row.id === unitId).name_vi;
  // The abbreviation the source sheets use for a unit's own type; a type with no common
  // abbreviation keeps its official name, which the text path matches once folded.
  const TYPE_ABBREVIATION = {
    'Thành phố': 'TP. ',
    Tỉnh: 'T. ',
    Quận: 'Q. ',
    Phường: 'P. ',
    Xã: 'X. ',
    'Thị trấn': 'TT ',
    'Thị xã': 'TX ',
  };
  const abbreviated = (name) => {
    const [, type, rest] =
      name.match(
        /^(Thành phố|Tỉnh|Quận|Huyện|Thị trấn|Thị xã|Phường|Xã)\s+(.*)$/u,
      ) ?? [];
    return type && TYPE_ABBREVIATION[type]
      ? `${TYPE_ABBREVIATION[type]}${rest}`
      : name;
  };
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,property_type,created_by,entry_on,entry_source)
      values ($1,'SGN-TXT-01','sale','available','house',$2,'2025-02-02','legacy'),
        ($3,'SGN-TXT-02','sale','available','house',$2,'2025-02-03','legacy')`,
    [textImported, sales, textNearMiss],
  );
  await db.query(
    `insert into public.property_addresses(property_id,format,address_text,province_text,district_text,commune_text)
      values ($1,'legacy','TXT cu 01',$2,$3,$4),
        ($5,'legacy','TXT cu 02',$6,$7,$8)`,
    [
      textImported,
      abbreviated(unitName(legacyProvince)),
      abbreviated(unitName(legacyDistrict.id)),
      abbreviated(unitName(legacyWard.id)),
      textNearMiss,
      `${abbreviated(unitName(legacyProvince))} cu`,
      `${unitName(legacyDistrict.id)} cu`,
      `${unitName(legacyWard.id)} cu`,
    ],
  );

  // Two wards of one district whose names differ only by their administrative type. The text path
  // expands the type abbreviation but never drops the type, so a filter for one ward must not answer
  // addresses recorded under the other.
  const yenVien = await db.query(
    "select id,name_vi from public.admin_unit_versions where unit_level='commune' and valid_to='2025-07-01' and name_vi in ('Xã Yên Viên','Thị trấn Yên Viên')",
  );
  const xaYenVien = yenVien.rows.find((row) => row.name_vi === 'Xã Yên Viên');
  const thiTranYenVien = yenVien.rows.find(
    (row) => row.name_vi === 'Thị trấn Yên Viên',
  );
  assert.ok(xaYenVien && thiTranYenVien, 'both Yên Viên wards are seeded');
  const textXaYenVien = id('b3');
  const textThiTranYenVien = id('b4');
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,property_type,created_by,entry_on,entry_source)
      values ($1,'SGN-TXT-03','sale','available','house',$2,'2025-02-04','legacy'),
        ($3,'SGN-TXT-04','sale','available','house',$2,'2025-02-05','legacy')`,
    [textXaYenVien, sales, textThiTranYenVien],
  );
  await db.query(
    `insert into public.property_addresses(property_id,format,address_text,commune_text)
      values ($1,'legacy','TXT cu 03','Xa Yen Vien'),
        ($2,'legacy','TXT cu 04','Thi tran Yen Vien')`,
    [textXaYenVien, textThiTranYenVien],
  );

  // The default stream is most-recently-changed first with identity breaking ties; the chronology
  // lists the eligible statuses by entry date then identity with unknown dates placed last. Either
  // way one total order covers the whole unarchived filtered set.
  const browseOrder = [...all]
    .filter((row) => row.id !== archived.id && row.id !== archivedUnknown.id)
    .sort(
      (left, right) =>
        right.updatedAt.getTime() - left.updatedAt.getTime() ||
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
    'the default window is most-recently-changed first with the matching total on every row',
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
      // Neither the newest creation time nor the highest identity leads: the order is the recorded
      // modification time, and the seven rows sharing the newest one are decided by identity alone.
      const newestCreated = [...all]
        .filter(
          (row) => row.id !== archived.id && row.id !== archivedUnknown.id,
        )
        .sort(
          (left, right) =>
            right.createdAt.getTime() - left.createdAt.getTime() ||
            right.id.localeCompare(left.id),
        )
        .map((row) => row.id);
      assert.notDeepEqual(browseOrder, newestCreated);
      const newestChangedAt = Math.max(
        ...all
          .filter(
            (row) => row.id !== archived.id && row.id !== archivedUnknown.id,
          )
          .map((row) => row.updatedAt.getTime()),
      );
      const tiedOnNewest = all
        .filter((row) => row.updatedAt.getTime() === newestChangedAt)
        .map((row) => row.id)
        .sort((left, right) => right.localeCompare(left));
      assert.ok(tiedOnNewest.length > 1, 'the fixtures share one change time');
      assert.deepEqual(
        first.rows.map((row) => row.id),
        tiedOnNewest.slice(0, 5),
      );
    },
  );

  for (const [order, expected] of [
    [null, browseOrder],
    ['oldest', oldestOrder],
    ['newest', newestOrder],
  ]) {
    const label = order ?? 'changed';
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
    'a window boundary inside one change timestamp neither repeats nor drops a row',
    async () => {
      // The fixtures state seven rows on one modification time, and a window of three starts in
      // the middle of them: the identity tie-break is what keeps the two windows contiguous.
      const newestChangedAt = Math.max(
        ...all
          .filter(
            (row) => row.id !== archived.id && row.id !== archivedUnknown.id,
          )
          .map((row) => row.updatedAt.getTime()),
      );
      const tiedOnNewest = all
        .filter((row) => row.updatedAt.getTime() === newestChangedAt)
        .map((row) => row.id)
        .sort((left, right) => right.localeCompare(left));
      const before = await read({ offset: 0, limit: 3 });
      const after = await read({ offset: 3, limit: 3 });
      assert.deepEqual(
        [...before.rows, ...after.rows].map((row) => row.id),
        browseOrder.slice(0, 6),
      );
      assert.deepEqual(
        before.rows.map((row) => row.id),
        tiedOnNewest.slice(0, 3),
      );
      assert.equal(
        new Set([...before.rows, ...after.rows].map((row) => row.id)).size,
        6,
      );
    },
  );

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
      // An access state is one of the five recorded values, never a re-spelling or a shorter word.
      for (const access of ['car', 'Street_Front', 'street front', 'any'])
        await fails(
          'select * from public.stream_inventory(p_access_type => $1::text)',
          [access],
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
    'an access type keeps only the recorded value it states, and the not-known state is a value',
    async () => {
      const stating = (value) =>
        browseOrder.filter(
          (propertyId) =>
            all.find((row) => row.id === propertyId).accessType === value,
        );
      for (const value of [
        'street_front',
        'car_alley',
        'motorbike_alley',
        'three_wheeler_alley',
        'unknown',
      ]) {
        const kept = await read({ accessType: value, limit: 100 });
        const expected = stating(value);
        assert.ok(expected.length > 0, value);
        assert.deepEqual(
          kept.rows.map((row) => row.id),
          expected,
          `${value} keeps its own records in order`,
        );
        assert.equal(kept.total, expected.length, `${value} total`);
        for (const row of kept.rows)
          assert.equal(row.access_type, value, `${value} recorded state`);
      }
      // A recorded "not known" is a state to narrow to, never the unfiltered read.
      const unknown = await read({ accessType: 'unknown', limit: 100 });
      assert.equal(unknown.total, 2);
      assert.ok(unknown.total < browseOrder.length);
      // The archived record of a stated access state stays outside the answer.
      assert.ok(
        !(await read({ accessType: 'street_front', limit: 100 })).rows.some(
          (row) => row.id === archived.id,
        ),
      );
    },
  );

  await check(
    'the access type composes with the other filters and their total',
    async () => {
      const streetFront = await read({
        accessType: 'street_front',
        status: 'negotiating',
        limit: 100,
      });
      const expected = browseOrder.filter((propertyId) => {
        const row = all.find((entry) => entry.id === propertyId);
        return (
          row.accessType === 'street_front' && row.status === 'negotiating'
        );
      });
      assert.ok(expected.length > 0);
      assert.deepEqual(
        streetFront.rows.map((row) => row.id),
        expected,
      );
      assert.equal(streetFront.total, expected.length);
      // The address format and the access state narrow the same read: one record here records a
      // current address and a street front, so both conditions must hold on it.
      const scoped = await read({
        accessType: 'street_front',
        addressFormat: 'current',
        limit: 100,
      });
      assert.deepEqual(
        scoped.rows.map((row) => row.id),
        [dated[0].id],
      );
      // An absent access parameter applies no access condition, which every earlier caller gets.
      assert.equal(
        (await read({ accessType: null, limit: 100 })).total,
        browseOrder.length,
      );
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
        communes: [legacyWard.id],
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
        communes: [currentCommune.id],
        limit: 100,
      });
      assert.deepEqual(
        current.rows.map((row) => row.id),
        [dated[0].id],
      );
    },
  );

  await check(
    'an area level matches the recorded text of an imported legacy address',
    async () => {
      // The imported inventory records each old address as free text and no unit ids, so a level
      // filter has to read that level's own text. These fixtures name the catalog units the way
      // the source sheets abbreviate them, and one states an extra word that is not the unit.
      // Each stated level matches the text recorded for that same level, though the address records
      // no unit id at all.
      for (const level of [
        { province: legacyProvince },
        { district: legacyDistrict.id },
        { communes: [legacyWard.id] },
      ]) {
        const result = await read({ ...level, query: '', limit: 200 });
        assert.ok(
          result.rows.some((row) => row.id === textImported),
          JSON.stringify(level),
        );
        // Matching is equality after normalisation, so a text carrying another word is not the
        // unit and is not read as one.
        assert.ok(!result.rows.some((row) => row.id === textNearMiss));
      }
      // A level's text is compared with that level alone: the ward recorded here is no province.
      const crossLevel = await read({
        province: legacyWard.id,
        query: '',
        limit: 200,
      });
      assert.ok(!crossLevel.rows.some((row) => row.id === textImported));
    },
  );

  await check(
    'an area text match keeps the administrative type of the unit',
    async () => {
      // The same name under two types is two units: equality is on the expanded type, never on the
      // name with the type dropped, so neither ward answers the other's filter.
      const byXa = await read({
        communes: [xaYenVien.id],
        query: '',
        limit: 200,
      });
      assert.ok(byXa.rows.some((row) => row.id === textXaYenVien));
      assert.ok(!byXa.rows.some((row) => row.id === textThiTranYenVien));
      const byThiTran = await read({
        communes: [thiTranYenVien.id],
        query: '',
        limit: 200,
      });
      assert.ok(byThiTran.rows.some((row) => row.id === textThiTranYenVien));
      assert.ok(!byThiTran.rows.some((row) => row.id === textXaYenVien));
    },
  );

  await check(
    'a set of communes answers the union of what each answers alone',
    async () => {
      // One commune at a time, then both together: the set is the union of the two, never the last
      // one replacing the one before it, and the recorded-unit and recorded-text paths both join
      // it. The text fixtures here name their commune only in the recorded text.
      const one = await read({
        communes: [legacyWard.id],
        query: '',
        limit: 200,
      });
      const other = await read({
        communes: [xaYenVien.id],
        query: '',
        limit: 200,
      });
      const union = await read({
        communes: [legacyWard.id, xaYenVien.id],
        query: '',
        limit: 200,
      });
      const expected = [
        ...new Set([...one.rows, ...other.rows].map((row) => row.id)),
      ].sort();
      assert.deepEqual(union.rows.map((row) => row.id).sort(), expected);
      assert.equal(union.total, expected.length);
      assert.ok(expected.includes(textImported));
      assert.ok(expected.includes(textXaYenVien));
      // The ward whose name differs only by its administrative type is not in the set.
      assert.ok(!union.rows.some((row) => row.id === textThiTranYenVien));
      // The order the set is stated in never changes the answer, and the set composes with the
      // other conditions, including the selected address format.
      const reversed = await read({
        communes: [xaYenVien.id, legacyWard.id],
        query: '',
        limit: 200,
      });
      assert.deepEqual(
        reversed.rows.map((row) => row.id),
        union.rows.map((row) => row.id),
      );
      const withFormat = await read({
        communes: [legacyWard.id, xaYenVien.id],
        addressFormat: 'legacy',
        query: '',
        limit: 200,
      });
      assert.deepEqual(withFormat.rows.map((row) => row.id).sort(), expected);
      // A set with no entry, a commune stated twice or an absent entry is refused rather than read
      // as the smaller set it would become once those entries were dropped.
      for (const communes of [
        [],
        [legacyWard.id, legacyWard.id],
        [legacyWard.id, null],
      ])
        await assert.rejects(
          read({ communes, query: '', limit: 200 }),
          JSON.stringify(communes),
        );
    },
  );

  await check(
    'a frontage or depth range keeps only the properties inside it',
    async () => {
      // Each dated row states its index as frontage and twice it as depth; the first records
      // neither, so a stated bound has an unmeasured row to leave out.
      const one = await read({ frontageMin: 2, frontageMax: 2, limit: 100 });
      assert.deepEqual(
        one.rows.map((row) => row.id),
        [dated[1].id],
      );
      assert.equal(one.total, 1);
      const pair = await read({ frontageMin: 2, frontageMax: 3, limit: 100 });
      assert.deepEqual(
        pair.rows.map((row) => row.id).sort(),
        [dated[1].id, dated[2].id].sort(),
      );
      // The depth range is its own condition, and half a range is still a range.
      const depth = await read({ depthMin: 10, depthMax: 12, limit: 100 });
      assert.deepEqual(
        depth.rows.map((row) => row.id).sort(),
        [dated[4].id, dated[5].id].sort(),
      );
      const open = await read({ depthMin: 40, limit: 100 });
      assert.deepEqual(
        open.rows.map((row) => row.id).sort(),
        dated
          .slice(19)
          .map((row) => row.id)
          .sort(),
      );
      // Both dimensions compose with each other and with the other filters.
      const composed = await read({
        frontageMin: 5,
        frontageMax: 8,
        depthMax: 12,
        status: 'available',
        limit: 100,
      });
      assert.deepEqual(
        composed.rows.map((row) => row.id).sort(),
        [dated[4].id, dated[5].id].sort(),
      );
      // A property recording no dimension never matches a stated bound: the unmeasured row is
      // outside the range rather than at its start, so zero is not read as a frontage of zero.
      const unmeasured = await read({ frontageMax: 1, limit: 100 });
      assert.deepEqual(unmeasured.rows, []);
      assert.equal(unmeasured.total, 0);
    },
  );

  await check(
    'an edit moves the record to the top of the browse and leaves the chronology alone',
    async () => {
      // The oldest-created fixture, changed now: it leads the default browse because the order is
      // the modification time, and the chronological orders are untouched because they read the
      // recorded entry date - the modes' meaning did not change with the order.
      const edited = dated[2];
      // Written as the owner so the property guard - which stamps `updated_at` on every write - is
      // the only thing that sets the change time; the employee write path is exercised elsewhere.
      await asOwner();
      await db.query(
        "update public.properties set notes='STRMFIX edited just now' where id=$1",
        [edited.id],
      );
      await asUser(0);
      const browse = await read({ limit: 5 });
      assert.equal(browse.rows[0].id, edited.id);
      assert.equal(browse.total, browseOrder.length);
      const moved = await read({ limit: 200 });
      assert.deepEqual(
        moved.rows.map((row) => row.id),
        [edited.id, ...browseOrder.filter((rowId) => rowId !== edited.id)],
      );
      for (const [order, expected] of [
        ['oldest', oldestOrder],
        ['newest', newestOrder],
      ]) {
        const chronological = await read({ order, limit: 200 });
        assert.deepEqual(
          chronological.rows.map((row) => row.id),
          expected,
          order,
        );
      }
      // The property's own row is what the read orders by, so the change time it states is the
      // one the order used.
      const stamped = (
        await db.query('select updated_at from public.properties where id=$1', [
          edited.id,
        ])
      ).rows[0].updated_at;
      assert.ok(
        stamped.getTime() >
          Math.max(...all.map((row) => row.updatedAt.getTime())),
      );
    },
  );

  // What the index is, not what the planner does with it at fixture size: the plan is measured at
  // the imported stock's size in scripts/recent-change-order-evidence.mjs.
  await check(
    'an invalid or reversed dimension bound is refused, not matched',
    async () => {
      const bounds =
        'select * from public.stream_inventory(p_query => $1::text,p_frontage_min => $2::numeric,p_frontage_max => $3::numeric,p_depth_min => $4::numeric,p_depth_max => $5::numeric)';
      for (const stated of [
        [0, null, null, null],
        [null, 12.345, null, null],
        [10000000000, null, null, null],
        [null, null, 0, null],
        [null, null, null, 12.345],
        [null, null, null, 10000000000],
        [10, 9, null, null],
        [null, null, 910, 900],
      ])
        await fails(bounds, [marker, ...stated], '22023');
    },
  );

  await check(
    'the change-order index exists over unarchived rows',
    async () => {
      const index = (
        await db.query(
          "select indexdef from pg_indexes where schemaname='public' and indexname='properties_recent_change_idx'",
        )
      ).rows[0];
      assert.ok(index, 'the browse order index exists');
      assert.match(index.indexdef, /updated_at DESC, id DESC/i);
      assert.match(index.indexdef, /WHERE \(archived_at IS NULL\)\s*$/i);
    },
  );

  // The table's headers order by their own column. A dedicated set of six rows states
  // each sortable value, one of every workflow status, a shared price, and rows that record no
  // price, no area, no frontage and no depth - enough to prove the column orderings, that a missing
  // value sorts last whichever way the column runs, and that the identity decides a tie.
  const columnRows = [
    {
      id: id('c1'),
      code: 'SGN-SRTF-01',
      mode: 'sale',
      price: 500_000_000,
      sale: 500_000_000,
      rent: null,
      floor: null,
      land: 100,
      frontage: 4,
      depth: 20,
      status: 'available',
      changed: 1,
    },
    {
      id: id('c2'),
      code: 'SGN-SRTF-02',
      mode: 'sale',
      price: 500_000_000,
      sale: 500_000_000,
      rent: null,
      floor: 80,
      land: 100,
      frontage: null,
      depth: null,
      status: 'negotiating',
      changed: 2,
    },
    // A rent listing leads with its monthly rent, exactly as its row states the price.
    {
      id: id('c3'),
      code: 'SGN-SRTF-03',
      mode: 'rent',
      price: 25_000_000,
      sale: null,
      rent: 25_000_000,
      floor: 60,
      land: 60,
      frontage: 6,
      depth: 12,
      status: 'draft',
      changed: 3,
    },
    {
      id: id('c4'),
      code: 'SGN-SRTF-04',
      mode: 'sale',
      price: null,
      sale: null,
      rent: null,
      floor: null,
      land: null,
      frontage: 8,
      depth: 18,
      status: 'sold',
      changed: 4,
    },
    {
      id: id('c5'),
      code: 'SGN-SRTF-05',
      mode: 'sale',
      price: 900_000_000,
      sale: 900_000_000,
      rent: null,
      floor: 200,
      land: 200,
      frontage: null,
      depth: 24,
      status: 'rented',
      changed: 5,
    },
    {
      id: id('c6'),
      code: 'SGN-SRTF-06',
      mode: 'sale',
      price: 100_000_000,
      sale: 100_000_000,
      rent: null,
      floor: 40,
      land: 50,
      frontage: 10,
      depth: 30,
      status: 'withdrawn',
      changed: 6,
    },
  ];
  // Two of the six are recorded by another employee, so the creator selection has a colleague's
  // records to leave out and the reader's own to return.
  const colleagueRows = new Set([columnRows[4].id, columnRows[5].id]);
  const creatorOf = (row) => (colleagueRows.has(row.id) ? employees[1] : sales);
  const baseChange = Date.parse('2026-09-20T00:00:00.000Z');
  await asOwner();
  await db.exec('alter table public.properties disable trigger property_guard');
  for (const row of columnRows)
    await db.query(
      `insert into public.properties(id,property_code,listing_mode,status,property_type,sale_price_vnd,monthly_rent_vnd,land_area_m2,floor_area_m2,frontage_m,depth_m,created_by,entry_on,entry_source,created_at,updated_at)
      values ($1,$2,$3,$4,'house',$5,$6,$7,$8,$9,$10,$11,null,'unknown',$12,$13)`,
      [
        row.id,
        row.code,
        row.mode,
        row.status,
        row.sale,
        row.rent,
        row.land,
        row.floor,
        row.frontage,
        row.depth,
        creatorOf(row),
        new Date(baseChange),
        new Date(baseChange + row.changed * 3_600_000),
      ],
    );
  await db.exec('alter table public.properties enable trigger property_guard');
  // The one order each column states, computed from the fixtures with the read's own rule: a
  // missing value sorts last in both directions and the identity decides what is left.
  const WORKFLOW = [
    'draft',
    'available',
    'negotiating',
    'sold',
    'rented',
    'withdrawn',
  ];
  const columnOrder = (pick, direction) =>
    [...columnRows]
      .sort((left, right) => {
        const a = pick(left);
        const b = pick(right);
        // A missing value sorts last whichever way the column runs, and the identity decides the
        // rest - including a tie between two records that state nothing.
        const order =
          a === null || b === null
            ? a === null
              ? b === null
                ? 0
                : 1
              : -1
            : a === b
              ? 0
              : direction === 'asc'
                ? a - b
                : b - a;
        if (order !== 0) return order;
        return direction === 'asc'
          ? left.id.localeCompare(right.id)
          : right.id.localeCompare(left.id);
      })
      .map((row) => row.id);
  const COLUMN_KEYS = [
    ['price', (row) => row.price],
    ['area', (row) => row.floor ?? row.land],
    ['frontage', (row) => row.frontage],
    ['depth', (row) => row.depth],
    ['status', (row) => WORKFLOW.indexOf(row.status)],
    ['changed', (row) => row.changed],
  ];

  await asUser(0);
  for (const [field, pick] of COLUMN_KEYS)
    for (const direction of ['asc', 'desc']) {
      const order = `${field}-${direction}`;
      const expected = columnOrder(pick, direction);
      await check(
        `the ${order} stream is that column's total order, with missing values last`,
        async () => {
          const first = await read({ order, query: 'srtf', limit: 2 });
          assert.equal(first.total, expected.length);
          assert.deepEqual(
            first.rows.map((row) => row.id),
            expected.slice(0, 2),
          );
          // The window boundary falls inside the tie the identity decides, so consecutive fetches
          // neither repeat nor drop a row.
          const seen = [];
          for (let offset = 0; offset < expected.length; offset += 2)
            seen.push(
              ...(await read({ order, query: 'srtf', offset, limit: 2 })).rows,
            );
          assert.deepEqual(
            seen.map((row) => row.id),
            expected,
            `${order} order`,
          );
          assert.equal(new Set(seen.map((row) => row.id)).size, seen.length);
        },
      );
    }

  await check(
    'a column ordering is the ordinary browse, not the eligible-status chronology',
    async () => {
      // Every workflow status is in this set: a column ordering reorders the ordinary browse, which
      // an unarchived record is in whatever its status. Only the entry chronology narrows the
      // statuses, and it still does.
      const byPrice = await read({
        order: 'price-asc',
        query: 'srtf',
        limit: 20,
      });
      assert.equal(byPrice.total, columnRows.length);
      const draft = byPrice.rows.find((row) => row.id === columnRows[2].id);
      assert.ok(draft, 'the draft record is listed');
      const sold = byPrice.rows.find((row) => row.id === columnRows[3].id);
      assert.ok(sold, 'the sold record is listed');
      // The chronology keeps its own boundary: of these six rows only the available and the
      // negotiating one are eligible, and the other four are absent from it entirely.
      const chronology = await read({
        order: 'oldest',
        query: 'srtf',
        limit: 20,
      });
      const eligible = columnRows
        .filter((row) => ['available', 'negotiating'].includes(row.status))
        .map((row) => row.id)
        .sort();
      assert.deepEqual(chronology.rows.map((row) => row.id).sort(), eligible);
      assert.equal(chronology.total, eligible.length);
    },
  );

  await check(
    'a column ordering without the identity tie-break would not be a total order',
    async () => {
      // Two records state the same price, and a window of one walks both of them: the order is the
      // value and then the identity, so the two windows are the same pair in the same sequence.
      const first = await read({
        order: 'price-asc',
        query: 'srtf',
        offset: 2,
        limit: 1,
      });
      const second = await read({
        order: 'price-asc',
        query: 'srtf',
        offset: 3,
        limit: 1,
      });
      const tied = columnRows
        .filter((row) => row.price === 500_000_000)
        .map((row) => row.id)
        .sort((left, right) => left.localeCompare(right));
      assert.deepEqual([first.rows[0].id, second.rows[0].id], tied);
    },
  );

  // A header ordering and the creator selection are criteria of the one read, so an address that
  // states both is answered by both: the ordering walks only the reader's own records, never a
  // wider set, and the eligible chronology keeps its own boundary beside the criterion.
  await asUser(0);
  const mine = columnRows.filter((row) => creatorOf(row) === sales);
  const colleagues = columnRows.filter(
    (row) => creatorOf(row) === employees[1],
  );
  await check(
    'the creator selection narrows every ordering to the employee’s own records',
    async () => {
      assert.ok(
        mine.length > 0 && colleagues.length > 0,
        'both employees recorded rows',
      );
      // Without the criterion the same ordering states the whole filtered set, so the criterion is
      // what narrows it and no ordering ever does.
      const wider = await read({
        order: 'price-asc',
        query: 'srtf',
        limit: 20,
      });
      assert.equal(wider.total, columnRows.length);
      for (const [field, pick] of COLUMN_KEYS)
        for (const direction of ['asc', 'desc']) {
          const order = `${field}-${direction}`;
          const expected = columnOrder(pick, direction).filter((id) =>
            mine.some((row) => row.id === id),
          );
          const scoped = await read({
            order,
            query: 'srtf',
            limit: 20,
            createdByMe: true,
          });
          assert.equal(scoped.total, expected.length, `${order} total`);
          assert.deepEqual(
            scoped.rows.map((row) => row.id),
            expected,
            `${order} rows`,
          );
        }
      const browse = await read({
        query: 'srtf',
        limit: 20,
        createdByMe: true,
      });
      assert.equal(browse.total, mine.length);
      assert.deepEqual(
        browse.rows.map((row) => row.id).sort(),
        mine.map((row) => row.id).sort(),
      );
      // The entry chronology is the eligible-status view, and the criterion composes with it rather
      // than replacing it.
      const chronology = await read({
        order: 'oldest',
        query: 'srtf',
        limit: 20,
        createdByMe: true,
      });
      const eligibleMine = mine
        .filter((row) => ['available', 'negotiating'].includes(row.status))
        .map((row) => row.id)
        .sort();
      assert.equal(chronology.total, eligibleMine.length);
      assert.deepEqual(
        chronology.rows.map((row) => row.id).sort(),
        eligibleMine,
      );
    },
  );

  await asUser(1);
  await check(
    'the creator selection is the employee reading the list, not a name the caller states',
    async () => {
      const theirs = await read({
        order: 'price-asc',
        query: 'srtf',
        limit: 20,
        createdByMe: true,
      });
      assert.equal(theirs.total, colleagues.length);
      assert.deepEqual(
        theirs.rows.map((row) => row.id).sort(),
        colleagues.map((row) => row.id).sort(),
      );
      // The two employees' selections are disjoint: neither read can answer with the other's rows.
      assert.equal(
        theirs.rows.filter((row) => mine.some((own) => own.id === row.id))
          .length,
        0,
      );
    },
  );

  await check(
    'the creator selection is refused without an active employee rather than ignored',
    async () => {
      // An inactive employee has no employee identity for the criterion to compare against.
      await asUser(4);
      await fails(
        'select * from public.stream_inventory(p_query => $1::text,p_created_by_me => true)',
        [marker],
        '42501',
      );
      // The same holds for a session with no employee at all, which the owner role reaches past
      // RLS and so cannot answer by accident.
      await asOwner();
      await fails(
        'select * from public.stream_inventory(p_query => $1::text,p_created_by_me => true)',
        [marker],
        '42501',
      );
      // The read is unchanged for a caller that states no creator criterion.
      assert.equal((await read({ query: 'strmfix' })).total > 0, true);
    },
  );

  await asOwner();
}
