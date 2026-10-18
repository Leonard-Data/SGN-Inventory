import assert from 'node:assert/strict';

// Ticket #140 embedded regressions: the inventory list states how many properties match and
// pages by offset instead of walking a cursor trail. It proves that the matching total and the
// rows come from one filtered read, that paging walks a filtered result set without repeats or
// gaps under both orderings, that an unusable page number is refused rather than answered with
// a different result set, that a page past the end is corrected onto the same result set, and
// that the archived boundary applies to the count exactly as it applies to the rows. Real
// Data API pagination and browser acceptance stay a staging gate.
export async function inventoryPagingContract({
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
  const id = (suffix) => `4a000000-0000-4000-8000-0000000000${suffix}`;
  const sales = employees[0];
  const marker = 'PACEFIX Kiem Thu';
  // Twenty-four dated rows on four dates plus two unknown dates, one archived row of each, and
  // one ineligible status: enough to page with a page size of five and to cross date ties.
  const dated = [];
  for (let index = 0; index < 24; index++)
    dated.push({
      id: id(`${(index + 16).toString(16).padStart(2, '0')}`),
      code: `SGN-PACE-${String(index).padStart(2, '0')}`,
      entryOn: `2025-0${(index % 4) + 1}-0${(index % 5) + 1}`,
      status: index % 3 === 0 ? 'negotiating' : 'available',
    });
  const unknownDated = { id: id('aa'), code: 'SGN-PACE-AA', entryOn: null };
  const unknownSecond = { id: id('ab'), code: 'SGN-PACE-AB', entryOn: null };
  const archived = { id: id('ac'), code: 'SGN-PACE-AC', entryOn: '2025-01-01' };
  const archivedUnknown = {
    id: id('ad'),
    code: 'SGN-PACE-AD',
    entryOn: null,
  };
  const sold = {
    id: id('ae'),
    code: 'SGN-PACE-AE',
    entryOn: '2025-01-01',
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
    page = 1,
    pageSize = 5,
    query = 'pacefix',
    status = null,
  } = {}) {
    const result = await db.query(
      `select * from public.page_inventory($1::text,$2::text,$3::integer,$4::integer,$5::text)`,
      [order, query, page, pageSize, status],
    );
    return {
      rows: result.rows,
      total: result.rows.length ? Number(result.rows[0].total_count) : 0,
      page: result.rows.length ? Number(result.rows[0].page_number) : 1,
    };
  }

  await asOwner();
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,created_by,entry_on,entry_source,archived_at)
    select * from unnest($1::uuid[],$2::text[],$3::text[],$4::text[],$5::uuid[],$6::date[],$7::text[],$8::timestamptz[])`,
    [
      all.map((row) => row.id),
      all.map((row) => row.code),
      all.map(() => 'sale'),
      all.map((row) => row.status ?? 'available'),
      all.map(() => sales),
      all.map((row) => row.entryOn),
      all.map((row) => (row.entryOn === null ? 'unknown' : 'legacy')),
      all.map((row) =>
        row.id === archived.id || row.id === archivedUnknown.id
          ? new Date()
          : null,
      ),
    ],
  );
  await db.query(
    "insert into public.property_addresses(property_id,format,address_text) select p.id,'legacy',$2||' '||p.property_code from public.properties p where p.id = any($1::uuid[])",
    [all.map((row) => row.id), marker],
  );

  // The ordinary browse lists every unarchived status by identity; the chronology lists the
  // eligible statuses by entry date then identity with the unknown dates placed last. Either way
  // one total order covers the whole filtered set, and the total counts exactly that set.
  const browseOrder = [
    ...dated.map((row) => row.id),
    unknownDated.id,
    unknownSecond.id,
    sold.id,
  ];
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
  for (const [order, expected] of [
    [null, browseOrder],
    ['oldest', oldestOrder],
    ['newest', newestOrder],
  ]) {
    const label = order ?? 'browse';
    await check(
      `the ${label} read counts exactly the rows it lists`,
      async () => {
        const first = await read({ order, pageSize: 5 });
        assert.equal(first.total, expected.length);
        assert.equal(first.page, 1);
        assert.equal(first.rows.length, 5);
        // The total is stated by every page of the same read, never by a second query.
        for (const row of first.rows)
          assert.equal(Number(row.total_count), expected.length);
      },
    );
    await check(
      `the ${label} read walks the whole result set without repeats or gaps`,
      async () => {
        const pageSize = 5;
        const pages = Math.ceil(expected.length / pageSize);
        const seen = [];
        for (let page = 1; page <= pages; page++)
          seen.push(...(await read({ order, page, pageSize })).rows);
        assert.deepEqual(
          seen.map((row) => row.id),
          expected,
          `${label} order`,
        );
        assert.equal(new Set(seen.map((row) => row.id)).size, seen.length);
      },
    );
  }

  await check(
    'the total follows the same filter and search as the rows',
    async () => {
      const negotiating = await read({ status: 'negotiating', pageSize: 50 });
      assert.ok(negotiating.total > 0);
      assert.equal(negotiating.rows.length, negotiating.total);
      for (const row of negotiating.rows)
        assert.equal(row.status, 'negotiating');
      const searched = await read({ query: 'pace-ab', pageSize: 50 });
      assert.deepEqual(
        searched.rows.map((row) => row.id),
        [unknownSecond.id],
      );
      assert.equal(searched.total, 1);
      // A search that matches nothing states a total of zero with no rows, never a count of
      // some other inventory.
      const none = await read({ query: 'pacefix no such address' });
      assert.deepEqual(none.rows, []);
      assert.equal(none.total, 0);
    },
  );

  await check(
    'the archived boundary excludes the row from the count as well as the page',
    async () => {
      await asUser(2);
      // A reviewer may read the archived rows directly; the paged read still excludes both.
      for (const row of [archived, archivedUnknown])
        assert.equal(
          (
            await db.query('select 1 from public.properties where id=$1', [
              row.id,
            ])
          ).rows.length,
          1,
        );
      const browse = await read({ pageSize: 50 });
      assert.equal(browse.total, browseOrder.length);
      assert.ok(!browse.rows.some((row) => row.id === archived.id));
      const search = await read({ query: 'pacefix-ac', pageSize: 50 });
      assert.deepEqual(search.rows, []);
      assert.equal(search.total, 0);
      await asUser(0);
    },
  );

  await check(
    'an ineligible status is outside the chronological count and page together',
    async () => {
      const oldest = await read({ order: 'oldest', pageSize: 50 });
      assert.equal(oldest.total, oldestOrder.length);
      assert.ok(!oldest.rows.some((row) => row.id === sold.id));
      // The same row is ordinary unarchived inventory, so the browse counts and lists it.
      const browse = await read({ pageSize: 50 });
      assert.equal(browse.total, browseOrder.length);
      assert.ok(browse.rows.some((row) => row.id === sold.id));
    },
  );

  await check(
    'a page past the end is corrected onto the same result set',
    async () => {
      const lastPage = Math.ceil(browseOrder.length / 5);
      const beyond = await read({ page: 9, pageSize: 5 });
      assert.equal(beyond.total, browseOrder.length);
      assert.equal(beyond.page, lastPage);
      assert.deepEqual(
        beyond.rows.map((row) => row.id),
        browseOrder.slice((lastPage - 1) * 5),
      );
      // A corrected page reports the page it served, so pager links follow the served page.
      for (const row of beyond.rows)
        assert.equal(Number(row.page_number), lastPage);
    },
  );

  await check(
    'an unusable page or ordering is refused, not executed',
    async () => {
      for (const page of [0, -3, null])
        await fails(
          'select * from public.page_inventory(p_page => $1::integer)',
          [page],
          '22023',
        );
      for (const order of ['random', 'OLDEST', ''])
        await fails(
          'select * from public.page_inventory(p_order => $1::text)',
          [order],
          '22023',
        );
    },
  );

  await asOwner();
}
