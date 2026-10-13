import assert from 'node:assert/strict';

// Issue #36 embedded regressions: the property-scoped Asking-price history read seam.
// It proves separate sale/rent series over the allowlisted business history, exact whole-VND
// text, unknown gaps versus a recorded zero, keyset paging beyond one generic page, the
// optional explanation attached only to an authorized price revision, stale-edit and
// access boundaries. Real Auth/Data API/RLS and browser acceptance stay a staging gate.
export async function priceHistoryContract({
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
  const maintainSql = 'select public.maintain_property($1,$2,$3,$4,$5,$6,$7)';
  const revision = async (id) =>
    (await db.query('select revision from public.properties where id=$1', [id]))
      .rows[0].revision;
  const maintain = async (id, changes, explanation = null, rev = null) => {
    const expected = rev ?? (await revision(id));
    return db.query(maintainSql, [
      id,
      'property',
      id,
      expected,
      changes,
      expected,
      explanation,
    ]);
  };
  const series = async (id, which, before, beforeId) => {
    let sql =
      'select id,actor_name,occurred_at,explanation,before_value,after_value from public.property_price_history where property_id=$1 and series=$2';
    const params = [id, which];
    if (before) {
      sql += ' and (occurred_at<$3 or (occurred_at=$3 and id<$4))';
      params.push(before, beforeId);
    }
    sql += ' order by occurred_at desc,id desc limit 31';
    return (await db.query(sql, params)).rows;
  };
  await asUser(0);
  const actorName = (
    await db.query('select display_name from public.employees where id=$1', [
      employees[0],
    ])
  ).rows[0].display_name;
  const id = (
    await db.query('select public.create_property($1,$2,$3) as id', [
      'sale',
      {},
      { format: 'legacy', address_text: 'Nhà kiểm thử lịch sử giá chào' },
    ])
  ).rows[0].id;
  const control = (
    await db.query('select public.create_property($1,$2,$3) as id', [
      'sale',
      {},
      { format: 'legacy', address_text: 'Nhà đối chứng lịch sử giá' },
    ])
  ).rows[0].id;

  await check(
    'a sale-price save records one sale revision and no rent revision',
    async () => {
      // Creation recorded unknown optional facts: neither series invents a price row.
      assert.deepEqual(await series(id, 'sale'), []);
      assert.deepEqual(await series(id, 'rent'), []);
      await maintain(id, { sale_price_vnd: '4200000000' });
      const sale = await series(id, 'sale');
      assert.equal(sale.length, 1);
      assert.equal(sale[0].before_value, null);
      assert.equal(sale[0].after_value, '4200000000');
      assert.equal(sale[0].actor_name, actorName);
      assert.equal(sale[0].explanation, null);
      assert.deepEqual(await series(id, 'rent'), []);
      const event = (
        await db.query(
          "select changed_fields,before_values,after_values from public.property_history where property_id=$1 and 'sale_price_vnd'=any(changed_fields) order by occurred_at desc limit 1",
          [id],
        )
      ).rows[0];
      assert.deepEqual(event.changed_fields, ['sale_price_vnd']);
      // The absent prior value stays an explicit unknown gap, never a fabricated zero.
      assert.deepEqual(event.before_values, { sale_price_vnd: null });
      assert.deepEqual(event.after_values, { sale_price_vnd: '4200000000' });
    },
  );
  await check(
    'a rent-only save stays in the rent series and leaves the sale series untouched',
    async () => {
      await maintain(id, { monthly_rent_vnd: '12000000' });
      const rent = await series(id, 'rent');
      assert.equal(rent.length, 1);
      assert.equal(rent[0].before_value, null);
      assert.equal(rent[0].after_value, '12000000');
      assert.equal((await series(id, 'sale')).length, 1);
    },
  );
  await check(
    'one combined revision appears in both series with its own before/after values',
    async () => {
      await maintain(id, {
        sale_price_vnd: '4500000000',
        monthly_rent_vnd: '13000000',
      });
      const sale = await series(id, 'sale'),
        rent = await series(id, 'rent');
      assert.deepEqual(
        [sale[0].before_value, sale[0].after_value],
        ['4200000000', '4500000000'],
      );
      assert.deepEqual(
        [rent[0].before_value, rent[0].after_value],
        ['12000000', '13000000'],
      );
      // Both rows come from the one recorded revision; the sale row carries no rent value.
      assert.equal(sale[0].id, rent[0].id);
      assert.equal(rent[0].actor_name, actorName);
    },
  );
  await check(
    'an amount unsafe for JavaScript floating point stays exact whole-VND text',
    async () => {
      await maintain(id, { sale_price_vnd: '999999999999999999' });
      const newest = (await series(id, 'sale'))[0];
      assert.equal(newest.before_value, '4500000000');
      assert.equal(newest.after_value, '999999999999999999');
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [id],
          )
        ).rows[0].price,
        '999999999999999999',
      );
    },
  );
  await check(
    'a recorded zero is zero while a cleared price is an unknown gap',
    async () => {
      await maintain(id, { sale_price_vnd: '0' });
      assert.equal((await series(id, 'sale'))[0].after_value, '0');
      await maintain(id, { sale_price_vnd: null });
      const newest = (await series(id, 'sale'))[0];
      assert.equal(newest.before_value, '0');
      assert.equal(newest.after_value, null);
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [id],
          )
        ).rows[0].price,
        null,
      );
      // A fact change that is not a price never enters either price series.
      const saleCount = (await series(id, 'sale')).length,
        rentCount = (await series(id, 'rent')).length;
      await maintain(id, { notes: 'Ghi chú không phải giá' });
      assert.equal((await series(id, 'sale')).length, saleCount);
      assert.equal((await series(id, 'rent')).length, rentCount);
    },
  );
  await check(
    'an authorized price correction keeps its optional explanation on its own revision',
    async () => {
      await maintain(
        id,
        { sale_price_vnd: '1000' },
        '  Sửa lại giá đã ghi nhầm  ',
      );
      const events = await series(id, 'sale');
      assert.equal(events[0].after_value, '1000');
      assert.equal(events[0].explanation, 'Sửa lại giá đã ghi nhầm');
      // Every earlier revision keeps its own (absent) explanation.
      assert.ok(events.slice(1).every((event) => event.explanation === null));
    },
  );
  await check(
    'an explanation is refused without a recorded price change',
    async () => {
      const before = await series(id, 'sale');
      await fails(
        maintainSql,
        [
          id,
          'property',
          id,
          await revision(id),
          { notes: 'không đổi giá' },
          await revision(id),
          'Giải thích không có thay đổi giá',
        ],
        '23514',
      );
      await fails(
        maintainSql,
        [
          id,
          'property',
          id,
          await revision(id),
          { sale_price_vnd: '1000' },
          await revision(id),
          'Giá không thực sự đổi',
        ],
        '23514',
      );
      await fails(
        maintainSql,
        [
          id,
          'property',
          id,
          await revision(id),
          { sale_price_vnd: '2000' },
          await revision(id),
          'quá ngắn',
        ],
        '23514',
      );
      const after = await series(id, 'sale');
      assert.deepEqual(
        after.map((event) => event.id),
        before.map((event) => event.id),
      );
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [id],
          )
        ).rows[0].price,
        '1000',
      );
    },
  );
  await check(
    'an oversized padded explanation is refused before storage',
    async () => {
      const before = await series(id, 'sale');
      const currentPrice = (
        await db.query(
          'select sale_price_vnd::text as price from public.properties where id=$1',
          [id],
        )
      ).rows[0].price;
      const rev = await revision(id);
      await fails(
        maintainSql,
        [
          id,
          'property',
          id,
          rev,
          { sale_price_vnd: '3000' },
          rev,
          `${' '.repeat(1990)}Giải thích hợp lệ`,
        ],
        '23514',
      );
      const after = await series(id, 'sale');
      assert.deepEqual(
        after.map((event) => event.id),
        before.map((event) => event.id),
      );
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [id],
          )
        ).rows[0].price,
        currentPrice,
      );
    },
  );
  await check(
    'an explanation on a non-price target is refused before any change',
    async () => {
      const address = (
        await db.query(
          'select id,revision,house_number from public.property_addresses where property_id=$1 order by id limit 1',
          [id],
        )
      ).rows[0];
      const propertyRevision = await revision(id);
      await fails(
        maintainSql,
        [
          id,
          'address',
          address.id,
          address.revision,
          { house_number: '99' },
          propertyRevision,
          'Giải thích chỉ dành cho giá',
        ],
        '23514',
      );
      assert.equal(
        (
          await db.query(
            'select house_number from public.property_addresses where id=$1',
            [address.id],
          )
        ).rows[0].house_number,
        address.house_number,
      );
    },
  );
  await check(
    'a stale price edit is refused and records no overwrite',
    async () => {
      const staleRevision = await revision(id);
      await maintain(id, { monthly_rent_vnd: '14000000' });
      await fails(
        maintainSql,
        [
          id,
          'property',
          id,
          staleRevision,
          { sale_price_vnd: '1' },
          staleRevision,
          null,
        ],
        'PT409',
      );
      assert.ok(
        (await series(id, 'sale')).every((event) => event.after_value !== '1'),
      );
    },
  );
  await check(
    'the price view exposes only allowlisted business columns',
    async () => {
      const columns = (
        await db.query(
          "select column_name from information_schema.columns where table_schema='public' and table_name='property_price_history' order by column_name",
        )
      ).rows.map((row) => row.column_name);
      assert.deepEqual(columns, [
        'actor_id',
        'actor_name',
        'after_value',
        'before_value',
        'explanation',
        'id',
        'occurred_at',
        'property_id',
        'series',
      ]);
      assert.deepEqual(
        (
          await db.query(
            "select reloptions from pg_class where relname='property_price_history'",
          )
        ).rows[0].reloptions,
        ['security_invoker=true'],
      );
    },
  );
  await check(
    'keyset paging reads every sale revision once, newest first, beyond one page',
    async () => {
      // Force a same-instant tie on the newest two rows so the id tiebreak is exercised.
      const newest = await series(id, 'sale');
      await asOwner();
      await db.query(
        'update public.property_history set occurred_at=(select max(occurred_at) from public.property_history where id=$1) where id=$2',
        [newest[0].id, newest[1].id],
      );
      await asUser(0);
      for (let index = 0; index < 30; index++)
        await maintain(id, { sale_price_vnd: String(10001 + index) });
      const total = Number(
        (
          await db.query(
            "select count(*)::int as n from public.property_price_history where property_id=$1 and series='sale'",
            [id],
          )
        ).rows[0].n,
      );
      assert.ok(total > 30, `expected more than one page, got ${total}`);
      const seen = new Set();
      let cursor = null,
        pages = 0;
      for (;;) {
        const rows = await series(id, 'sale', cursor?.occurred_at, cursor?.id);
        pages++;
        const page = rows.slice(0, 30);
        for (let index = 0; index < page.length; index++) {
          if (index > 0)
            assert.ok(
              page[index - 1].occurred_at > page[index].occurred_at ||
                (page[index - 1].occurred_at.getTime() ===
                  page[index].occurred_at.getTime() &&
                  page[index - 1].id > page[index].id),
              'page stays newest-first on (occurred_at,id)',
            );
          assert.ok(!seen.has(page[index].id), 'each revision appears once');
          seen.add(page[index].id);
        }
        if (rows.length <= 30) break;
        cursor = page.at(-1);
        assert.ok(pages < 20, 'paging terminates');
      }
      assert.ok(pages >= 2, 'more than one page was read');
      assert.equal(seen.size, total);
      assert.ok(
        (await series(id, 'sale')).some(
          (event) => event.after_value === '10030',
        ),
      );
    },
  );
  await check(
    'the price series preserves an unaffected control property',
    async () => {
      await maintain(control, { sale_price_vnd: '777000' });
      await maintain(id, { notes: 'đối chứng không đổi giá' });
      const controlEvents = await series(control, 'sale');
      assert.equal(controlEvents.length, 1);
      assert.equal(controlEvents[0].before_value, null);
      assert.equal(controlEvents[0].after_value, '777000');
      assert.deepEqual(await series(control, 'rent'), []);
    },
  );
  await check(
    'an active colleague and a reviewer read the same recorded series',
    async () => {
      await asUser(0);
      const ownerPage = await series(id, 'sale');
      assert.equal(ownerPage.length, 31);
      await asUser(1);
      assert.deepEqual(await series(id, 'sale'), ownerPage);
      await asUser(2);
      assert.deepEqual(await series(id, 'sale'), ownerPage);
    },
  );
  await check(
    'anonymous, inactive and archived-property readers get no price history',
    async () => {
      await asUser(null);
      await fails('select id from public.property_price_history', [], '42501');
      await asUser(4);
      assert.deepEqual(await series(id, 'sale'), []);
      await asUser(0);
      const archived = (
        await db.query('select public.create_property($1,$2,$3) as id', [
          'sale',
          { sale_price_vnd: '3100000' },
          { format: 'legacy', address_text: 'Nhà lưu trữ lịch sử giá' },
        ])
      ).rows[0].id;
      await asOwner();
      await db.query(
        'update public.properties set archived_at=now() where id=$1',
        [archived],
      );
      await asUser(0);
      assert.deepEqual(await series(archived, 'sale'), []);
      await asUser(2);
      assert.equal((await series(archived, 'sale')).length, 1);
      await asOwner();
      await db.query(
        'update public.properties set archived_at=null where id=$1',
        [archived],
      );
      await asUser(0);
    },
  );
  await check('the price seam has no direct client write path', async () => {
    // The union-all view is never automatically updatable, and authenticated holds
    // SELECT alone; raw business-history rows remain select-only too.
    await fails(
      'update public.property_price_history set explanation=$1 where property_id=$2',
      ['rewrite history', id],
      '55000',
    );
    await fails(
      'delete from public.property_price_history where property_id=$1',
      [id],
      '55000',
    );
    await fails(
      "update public.property_history set explanation='forged' where property_id=$1",
      [id],
      '42501',
    );
  });
  await check(
    'shared-contact history never leaks into a price series',
    async () => {
      await asUser(5);
      const person = await db.query('select public.create_contact($1) as id', [
        { display_name: 'Người liên hệ giá', contact_type: 'owner' },
      ]);
      const contact = person.rows[0].id;
      const propertyRevision = await revision(id);
      await db.query(maintainSql, [
        id,
        'link',
        null,
        propertyRevision,
        { contact_id: contact, relation: 'owner', is_primary: true },
        propertyRevision,
        null,
      ]);
      const saleCount = (await series(id, 'sale')).length,
        rentCount = (await series(id, 'rent')).length;
      const contactRevision = (
        await db.query('select revision from public.contacts where id=$1', [
          contact,
        ])
      ).rows[0].revision;
      await db.query(maintainSql, [
        id,
        'contact',
        contact,
        contactRevision,
        { display_name: 'Người liên hệ đã sửa' },
        await revision(id),
        null,
      ]);
      assert.equal((await series(id, 'sale')).length, saleCount);
      assert.equal((await series(id, 'rent')).length, rentCount);
      await asOwner();
    },
  );
}
