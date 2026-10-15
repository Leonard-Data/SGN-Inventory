import assert from 'node:assert/strict';

export async function correctionContract({
  db,
  asUser,
  check,
  fails,
  employees,
  property,
}) {
  const row = async () =>
    (
      await db.query(
        'select revision,notes from public.properties where id=$1',
        [property],
      )
    ).rows[0];
  const submit =
    'select public.submit_correction($1,$2,$3,$4,$5,$6,$7,$8) as id';
  const decide = 'select public.decide_correction($1,$2,$3,$4,$5)';
  const amend = 'select public.amend_correction($1,$2,$3,$4,$5,$6)';
  const request = async (id) =>
    (
      await db.query('select * from public.correction_requests where id=$1', [
        id,
      ])
    ).rows[0];
  await asUser(1);
  let id, original;
  await check(
    'issue-only correction submission captures observed state without editing inventory',
    async () => {
      const before = await row();
      id = (
        await db.query(submit, [
          property,
          'property',
          property,
          'incorrect',
          'Thông tin nguồn cần đính chính',
          {},
          before.revision,
          before.revision,
        ])
      ).rows[0].id;
      original = await request(id);
      assert.equal(original.requester_id, employees[1]);
      assert.equal(original.status, 'open');
      assert.deepEqual(original.proposed_values, {});
      assert.deepEqual(await row(), before);
    },
  );
  await asUser(0);
  await check(
    'shared property readership does not disclose another salesperson correction',
    async () => {
      assert.equal(
        (
          await db.query('select id from public.properties where id=$1', [
            property,
          ])
        ).rows.length,
        1,
      );
      assert.deepEqual(
        (
          await db.query(
            'select id from public.correction_requests where id=$1',
            [id],
          )
        ).rows,
        [],
      );
      await fails(
        decide,
        [
          id,
          original.revision,
          'apply',
          'Trying to bypass correction authority',
          { notes: 'forged' },
        ],
        '42501',
      );
    },
  );
  await asUser(1);
  await check(
    'amendment preserves original submission and attributes a separate proposal',
    async () => {
      const state = await row();
      await db.query(amend, [
        id,
        original.revision,
        'Bổ sung từ nguồn mới',
        { notes: 'Đã chỉnh đúng nguồn' },
        state.revision,
        state.revision,
      ]);
      const after = await request(id);
      for (const key of [
        'explanation',
        'proposed_values',
        'observed_values',
        'observed_revision',
        'property_revision',
        'requester_id',
        'created_at',
      ])
        assert.deepEqual(after[key], original[key]);
      const amendments = (
        await db.query(
          'select actor_id,explanation,proposed_values from public.correction_amendments where request_id=$1',
          [id],
        )
      ).rows;
      assert.deepEqual(amendments, [
        {
          actor_id: employees[1],
          explanation: 'Bổ sung từ nguồn mới',
          proposed_values: { notes: 'Đã chỉnh đúng nguồn' },
        },
      ]);
    },
  );
  await asUser(5);
  await check(
    'staff atomically applies a non-price correction with no history and no review handoff',
    async () => {
      const current = await request(id);
      // A pre-existing clock-skew control must never acquire this request's reason.
      await db.exec('reset role');
      const control = (
        await db.query(
          `insert into public.property_history(property_id,actor_id,actor_name,occurred_at,target,target_id,changed_fields,before_values,after_values)
        select $1,id,display_name,clock_timestamp()+interval '1 minute','property',$1,array['notes'],'{"notes":"Earlier control"}','{"notes":"Retained independent control"}' from public.employees where id=$2 returning *`,
          [property, employees[5]],
        )
      ).rows[0];
      await asUser(5);
      await db.query(decide, [
        id,
        current.revision,
        'apply',
        'Applied the supported source correction',
        null,
      ]);
      assert.deepEqual(
        (
          await db.query('select * from public.property_history where id=$1', [
            control.id,
          ])
        ).rows[0],
        control,
      );
      const after = await request(id);
      assert.equal(after.status, 'applied');
      assert.equal(after.outcome_actor_id, employees[5]);
      assert.equal((await row()).notes, 'Đã chỉnh đúng nguồn');
      // A non-price correction changes the record but is no longer recorded anywhere.
      assert.deepEqual(
        (
          await db.query(
            'select id,explanation from public.property_history where property_id=$1 and explanation=$2',
            [property, 'Applied the supported source correction'],
          )
        ).rows,
        [],
      );
      assert.deepEqual(
        (
          await db.query(
            'select id from public.property_price_history where property_id=$1 and explanation=$2',
            [property, 'Applied the supported source correction'],
          )
        ).rows,
        [],
      );
      await fails(
        decide,
        [
          id,
          after.revision,
          'apply',
          'Cannot reapply a terminal request',
          { notes: 'overwrite' },
        ],
        '23514',
      );
      assert.equal((await row()).notes, 'Đã chỉnh đúng nguồn');
    },
  );
  await asUser(1);
  await check(
    'a proposal matching the live observed value is refused without closing the request',
    async () => {
      const observed = await row();
      const noop = (
        await db.query(submit, [
          property,
          'property',
          property,
          'incorrect',
          'Proposal that repeats the live observed value',
          { notes: observed.notes },
          observed.revision,
          observed.revision,
        ])
      ).rows[0].id;
      await asUser(5);
      const pending = await request(noop);
      await fails(
        decide,
        [
          noop,
          pending.revision,
          'apply',
          'A proposal that changes nothing must be refused',
          null,
        ],
        '23514',
      );
      assert.equal((await request(noop)).status, 'open');
      assert.deepEqual(await row(), observed);
      await asUser(1);
    },
  );
  await check(
    'an oversized padded outcome reason is refused and a valid reason is stored trimmed',
    async () => {
      await asUser(1);
      const observed = await row();
      const padded = (
        await db.query(submit, [
          property,
          'property',
          property,
          'incorrect',
          'Giá chào cần đính chính từ nguồn',
          { sale_price_vnd: '1500000000' },
          observed.revision,
          observed.revision,
        ])
      ).rows[0].id;
      await asUser(5);
      const pending = await request(padded),
        beforePrice = (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [property],
          )
        ).rows[0].price,
        beforeHistory = (
          await db.query(
            'select id from public.property_history where property_id=$1 order by id',
            [property],
          )
        ).rows;
      await fails(
        decide,
        [
          padded,
          pending.revision,
          'apply',
          `${' '.repeat(1990)}Giải thích kết quả hợp lệ`,
          null,
        ],
        '23514',
      );
      assert.equal((await request(padded)).status, 'open');
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [property],
          )
        ).rows[0].price,
        beforePrice,
      );
      assert.deepEqual(
        (
          await db.query(
            'select id from public.property_history where property_id=$1 order by id',
            [property],
          )
        ).rows,
        beforeHistory,
      );
      await db.query(decide, [
        padded,
        pending.revision,
        'apply',
        '  Giải thích kết quả hợp lệ  ',
        null,
      ]);
      const terminal = await request(padded);
      assert.equal(terminal.status, 'applied');
      assert.equal(terminal.outcome_reason, 'Giải thích kết quả hợp lệ');
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price from public.properties where id=$1',
            [property],
          )
        ).rows[0].price,
        '1500000000',
      );
      assert.deepEqual(
        (
          await db.query(
            'select explanation from public.property_price_history where property_id=$1 and after_value=$2',
            [property, '1500000000'],
          )
        ).rows,
        [{ explanation: 'Giải thích kết quả hợp lệ' }],
      );
    },
  );
  await asUser(1);
  await check(
    'an unchanged price alongside a real non-price correction applies without history',
    async () => {
      const observed = await row();
      const price = (
        await db.query(
          'select sale_price_vnd::text as price from public.properties where id=$1',
          [property],
        )
      ).rows[0].price;
      const beforeHistory = (
        await db.query(
          'select id,explanation from public.property_history where property_id=$1 order by id',
          [property],
        )
      ).rows;
      const mixed = (
        await db.query(submit, [
          property,
          'property',
          property,
          'incorrect',
          'Price is unchanged but the note needs correction',
          { sale_price_vnd: price, notes: 'Mixed correction note' },
          observed.revision,
          observed.revision,
        ])
      ).rows[0].id;
      await asUser(5);
      const pending = await request(mixed);
      await db.query(decide, [
        mixed,
        pending.revision,
        'apply',
        'Applied the mixed correction without a price change',
        null,
      ]);
      assert.equal((await request(mixed)).status, 'applied');
      assert.equal((await row()).notes, 'Mixed correction note');
      assert.deepEqual(
        (
          await db.query(
            'select id,explanation from public.property_history where property_id=$1 order by id',
            [property],
          )
        ).rows,
        beforeHistory,
      );
      assert.deepEqual(
        (
          await db.query(
            'select explanation from public.property_price_history where property_id=$1 and explanation=$2',
            [property, 'Applied the mixed correction without a price change'],
          )
        ).rows,
        [],
      );
    },
  );
  await asUser(1);
  let stale;
  await check(
    'stale proposal application fails while original evidence remains available for reconciliation',
    async () => {
      const observed = await row();
      stale = (
        await db.query(submit, [
          property,
          'property',
          property,
          'incorrect',
          'Another source correction proposed',
          { notes: 'old proposal' },
          observed.revision,
          observed.revision,
        ])
      ).rows[0].id;
      await asUser(5);
      await db.query('select public.maintain_property($1,$2,$3,$4,$5,$6)', [
        property,
        'property',
        property,
        observed.revision,
        { notes: 'Newer independent edit' },
        observed.revision,
      ]);
      const pending = await request(stale);
      await fails(
        decide,
        [
          stale,
          pending.revision,
          'apply',
          'Attempting stale correction application',
          null,
        ],
        'PT409',
      );
      assert.equal((await row()).notes, 'Newer independent edit');
      assert.equal((await request(stale)).status, 'open');
    },
  );
  await check(
    'rejection requires a reason and closed outcomes cannot be changed',
    async () => {
      const pending = await request(stale);
      await fails(
        decide,
        [stale, pending.revision, 'reject', '', null],
        '23514',
      );
      await db.query(decide, [
        stale,
        pending.revision,
        'reject',
        'The observed source has been superseded',
        null,
      ]);
      const terminal = await request(stale);
      assert.equal(terminal.status, 'rejected');
      assert.equal(
        terminal.outcome_reason,
        'The observed source has been superseded',
      );
      await fails(
        decide,
        [stale, terminal.revision, 'withdraw', null, null],
        '42501',
      );
    },
  );
  await asUser(1);
  await check(
    'requester withdraws own open request; competing stale decisions cannot win later',
    async () => {
      const current = await row();
      const withdraw = (
        await db.query(submit, [
          property,
          'property',
          property,
          'missing',
          'Issue with unknown replacement',
          {},
          current.revision,
          current.revision,
        ])
      ).rows[0].id;
      const open = await request(withdraw);
      await db.query(decide, [withdraw, open.revision, 'withdraw', null, null]);
      assert.equal((await request(withdraw)).status, 'withdrawn');
      await asUser(5);
      await fails(
        decide,
        [
          withdraw,
          open.revision,
          'reject',
          'Racing outcome must not overwrite withdrawal',
          null,
        ],
        '23514',
      );
      assert.equal((await request(withdraw)).status, 'withdrawn');
    },
  );
  await check(
    'failed history application rolls back facts, history and request closure together',
    async () => {
      await asUser(1);
      const current = await row();
      const failure = (
        await db.query(submit, [
          property,
          'property',
          property,
          'incorrect',
          'Synthetic correction rollback fixture',
          { sale_price_vnd: '888000' },
          current.revision,
          current.revision,
        ])
      ).rows[0].id;
      const pending = await request(failure);
      await db.exec('reset role');
      await db.exec(
        "create function private.fixture_fail_apply() returns trigger language plpgsql as $$ begin raise exception 'synthetic history failure' using errcode='23514'; end $$; create trigger fixture_fail_apply before insert on public.property_history for each row execute function private.fixture_fail_apply();",
      );
      await asUser(5);
      const history = (
        await db.query(
          'select id from public.property_history where property_id=$1 order by id',
          [property],
        )
      ).rows;
      await fails(
        decide,
        [
          failure,
          pending.revision,
          'apply',
          'Failure must preserve the open request',
          null,
        ],
        '23514',
      );
      assert.deepEqual(await row(), current);
      assert.deepEqual(await request(failure), pending);
      assert.deepEqual(
        (
          await db.query(
            'select id from public.property_history where property_id=$1 order by id',
            [property],
          )
        ).rows,
        history,
      );
      await db.exec('reset role');
      await db.exec(
        'drop trigger fixture_fail_apply on public.property_history;drop function private.fixture_fail_apply();',
      );
      await asUser(5);
    },
  );
  await check(
    'inactive and anonymous identities lose correction/history access on subsequent requests',
    async () => {
      await asUser(4);
      assert.deepEqual(
        (await db.query('select id from public.correction_requests')).rows,
        [],
      );
      assert.deepEqual(
        (await db.query('select id from public.correction_amendments')).rows,
        [],
      );
      assert.deepEqual(
        (await db.query('select id from public.property_history')).rows,
        [],
      );
      await fails(
        decide,
        [
          id,
          original.revision,
          'apply',
          'An inactive identity must not apply',
          {},
        ],
        '42501',
      );
      await asUser(null);
      for (const table of [
        'correction_requests',
        'correction_amendments',
        'property_history',
      ])
        await fails(`select id from public.${table}`, [], '42501');
      await asUser(5);
    },
  );
  await check(
    'direct correction evidence and outcome mutations are denied',
    async () => {
      await fails(
        'update public.correction_requests set explanation=$1 where id=$2',
        ['rewrite original', id],
        '42501',
      );
      await fails(
        'delete from public.correction_amendments where request_id=$1',
        [id],
        '42501',
      );
    },
  );
}
