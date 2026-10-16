import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #38 embedded regressions: versioned logical sale completion and completed-sale
// ranking. It proves reviewer-only independence, actual completion date and reference,
// atomic property/lock effects with retained reservation attribution, retry convergence,
// rental and conflicting-claimant refusals, honest unknown attribution, tied ranks and the
// direct-write boundary. Real Auth/Data API/RLS/browser acceptance stays a staging gate.
export async function saleCompletionContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const owner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const asManager = async () => asUser(2);
  const propertyId = async (code) =>
    (
      await db.query(
        'select id from public.properties where property_code=$1',
        [code],
      )
    ).rows[0]?.id ?? null;
  const completions = async (property) =>
    (
      await db.query(
        'select id,credited_employee_id,completed_on::text as completed_on,reference,previous_status,version,confirmed_by from public.sale_completions where property_id=$1 order by confirmed_at,id',
        [property],
      )
    ).rows;
  const ranking = async (from, to) =>
    (
      await db.query('select public.completed_sale_ranking($1,$2) as result', [
        from,
        to,
      ])
    ).rows[0].result;
  const day = async (offset) =>
    (
      await db.query(
        "select to_char((now() at time zone 'Asia/Ho_Chi_Minh')::date + $1::integer,'YYYY-MM-DD') as d",
        [offset],
      )
    ).rows[0].d;
  const today = await day(0);
  const yesterday = await day(-1);
  const tomorrow = await day(1);

  // Dedicated fixtures: never reuse the shared property, which other contracts mutate.
  await owner();
  await db.query(
    `insert into public.properties(id,property_code,listing_mode,status,created_by) values
      ($1,'SGN-SALE-38-1','sale','available',$7),
      ($2,'SGN-SALE-38-2','sale','available',$7),
      ($3,'SGN-SALE-38-3','both','available',$7),
      ($4,'SGN-SALE-38-4','sale','available',$7),
      ($5,'SGN-SALE-38-5','sale','sold',$7),
      ($6,'SGN-SALE-38-6','sale','available',$7),
      ($8,'SGN-SALE-38-7','sale','available',$7)`,
    [
      '20000000-0000-4000-8000-0000000000e1',
      '20000000-0000-4000-8000-0000000000e2',
      '20000000-0000-4000-8000-0000000000e3',
      '20000000-0000-4000-8000-0000000000e4',
      '20000000-0000-4000-8000-0000000000e5',
      '20000000-0000-4000-8000-0000000000e6',
      employees[0],
      '20000000-0000-4000-8000-0000000000e7',
    ],
  );
  const sameClaimProperty = await propertyId('SGN-SALE-38-1');
  const conflictProperty = await propertyId('SGN-SALE-38-2');
  const rentalProperty = await propertyId('SGN-SALE-38-3');
  const pendingProperty = await propertyId('SGN-SALE-38-4');
  const legacySoldProperty = await propertyId('SGN-SALE-38-5');
  const controlProperty = await propertyId('SGN-SALE-38-6');
  const archivedProperty = await propertyId('SGN-SALE-38-7');
  const tenant = '60000000-0000-4000-8000-0000000000f1';
  await db.query(
    "insert into public.contacts(id,display_name,contact_type) values($1,'Synthetic Sale Tenant','tenant')",
    [tenant],
  );
  await asUser(5);
  const rentalAgreement = (
    await db.query(
      "select public.create_rental_agreement($1,$2,'SGN-SALE-38-RENT','2026-01-01','2026-12-31',10000000) as id",
      [rentalProperty, tenant],
    )
  ).rows[0].id;
  await asUser(3);
  await db.query('select public.activate_rental_agreement($1)', [
    rentalAgreement,
  ]);
  await asManager();

  await asUser(null);
  await check('anonymous sale completion is denied', () =>
    fails(
      'select public.complete_property_sale($1,$2,$3,$4,$5)',
      [sameClaimProperty, employees[0], today, 'SGN-SALE-38 ref', randomUUID()],
      '42501',
    ),
  );
  await check('anonymous completed-sale ranking is denied', () =>
    fails(
      'select public.completed_sale_ranking($1,$2)',
      [today, today],
      '42501',
    ),
  );
  await check('anonymous completion read is denied', () =>
    fails('select * from public.sale_completions', [], '42501'),
  );
  await asUser(0);
  await check('a sales employee cannot confirm a completion', () =>
    fails(
      'select public.complete_property_sale($1,$2,$3,$4,$5)',
      [sameClaimProperty, employees[1], today, 'SGN-SALE-38 ref', randomUUID()],
      '42501',
    ),
  );
  await check(
    'a sales employee cannot read completions or the ranking',
    async () => {
      assert.equal(
        (await db.query('select * from public.sale_completions')).rows.length,
        0,
      );
      await fails(
        'select public.completed_sale_ranking($1,$2)',
        [today, today],
        '42501',
      );
    },
  );
  await asUser(5);
  await check(
    'a staff employee cannot confirm or rank completions',
    async () => {
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [
          sameClaimProperty,
          employees[0],
          today,
          'SGN-SALE-38 ref',
          randomUUID(),
        ],
        '42501',
      );
      await fails(
        'select public.completed_sale_ranking($1,$2)',
        [today, today],
        '42501',
      );
    },
  );

  await asManager();
  await check('a future completion date is refused', () =>
    fails(
      'select public.complete_property_sale($1,$2,$3,$4,$5)',
      [
        sameClaimProperty,
        employees[0],
        tomorrow,
        'SGN-SALE-38 ref',
        randomUUID(),
      ],
      'P0007',
    ),
  );
  await check('the confirming reviewer cannot credit themselves', () =>
    fails(
      'select public.complete_property_sale($1,$2,$3,$4,$5)',
      [sameClaimProperty, employees[2], today, 'SGN-SALE-38 ref', randomUUID()],
      'P0004',
    ),
  );
  await check(
    'a blank reference and an unknown credited employee are refused',
    async () => {
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [sameClaimProperty, employees[0], today, '   ', randomUUID()],
        '22023',
      );
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [
          sameClaimProperty,
          randomUUID(),
          today,
          'SGN-SALE-38 ref',
          randomUUID(),
        ],
        '22023',
      );
    },
  );

  // A conflicting effective reservation belongs to another employee: the completion is
  // refused until the existing audited release resolves it, with no partial change.
  await asUser(0);
  const conflictLock = (
    await db.query('select public.request_property_lock($1,$2) as id', [
      conflictProperty,
      'Synthetic conflicting claim awaiting an audited release',
    ])
  ).rows[0].id;
  await asUser(3);
  await db.query('select public.decide_property_lock($1,true,$2,7)', [
    conflictLock,
    'Synthetic approval for the conflicting-claimant regression',
  ]);
  await asManager();
  await check(
    'a conflicting effective claimant is refused until release',
    async () => {
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [
          conflictProperty,
          employees[5],
          today,
          'SGN-SALE-38-2/2026',
          randomUUID(),
        ],
        'P0003',
      );
      assert.equal((await completions(conflictProperty)).length, 0);
      assert.equal(
        (
          await db.query('select status from public.properties where id=$1', [
            conflictProperty,
          ])
        ).rows[0].status,
        'available',
      );
      assert.equal(
        (
          await db.query(
            'select status,requested_by from public.property_locks where id=$1',
            [conflictLock],
          )
        ).rows[0].status,
        'approved',
      );
    },
  );
  await check(
    'an approved or pending claim alone earns no completion credit',
    async () => {
      const result = await ranking(today, today);
      assert.deepEqual(result.rows, []);
      assert.equal(Number(result.totalCompletedSales), 0);
    },
  );
  await check(
    'the audited release resolves the conflict and retains the claimant',
    async () => {
      await db.query('select public.release_property_lock($1,$2)', [
        conflictLock,
        'Synthetic release resolving the conflicting claimant',
      ]);
      const released = (
        await db.query(
          'select status,requested_by,decided_by from public.property_locks where id=$1',
          [conflictLock],
        )
      ).rows[0];
      assert.equal(released.status, 'released');
      assert.equal(released.requested_by, employees[0]);
      assert.equal(released.decided_by, employees[3]);
      assert.deepEqual(
        (
          await db.query(
            'select action from public.lock_events where lock_id=$1 order by id',
            [conflictLock],
          )
        ).rows.map((event) => event.action),
        ['requested', 'approved', 'released'],
      );
      const completed = (
        await db.query(
          'select public.complete_property_sale($1,$2,$3,$4,$5) as id',
          [
            conflictProperty,
            employees[5],
            today,
            'SGN-SALE-38-2/2026',
            randomUUID(),
          ],
        )
      ).rows[0].id;
      const completion = (await completions(conflictProperty))[0];
      assert.equal(completion.id, completed);
      assert.equal(completion.credited_employee_id, employees[5]);
      assert.equal(completion.confirmed_by, employees[2]);
      assert.equal(completion.previous_status, 'available');
      assert.equal(completion.version, 1);
      assert.equal(completion.completed_on, today);
      assert.equal(
        (
          await db.query('select status from public.properties where id=$1', [
            conflictProperty,
          ])
        ).rows[0].status,
        'sold',
      );
    },
  );

  // A same-claimant effective reservation is closed by the completion with retained events.
  await asUser(0);
  const sameLock = (
    await db.query('select public.request_property_lock($1,$2) as id', [
      sameClaimProperty,
      'Synthetic same-claimant reservation for the completion regression',
    ])
  ).rows[0].id;
  await asUser(3);
  await db.query('select public.decide_property_lock($1,true,$2,7)', [
    sameLock,
    'Synthetic approval for the same-claimant completion regression',
  ]);
  await asManager();
  const retryKey = randomUUID();
  await check(
    'an independent reviewer completes a past-dated sale atomically',
    async () => {
      const id = (
        await db.query(
          'select public.complete_property_sale($1,$2,$3,$4,$5) as id',
          [
            sameClaimProperty,
            employees[0],
            yesterday,
            '  HĐ-38/2026  ',
            retryKey,
          ],
        )
      ).rows[0].id;
      const completion = (await completions(sameClaimProperty))[0];
      assert.equal(completion.id, id);
      assert.equal(completion.credited_employee_id, employees[0]);
      assert.equal(completion.confirmed_by, employees[2]);
      assert.equal(completion.reference, 'HĐ-38/2026');
      assert.equal(completion.completed_on, yesterday);
      assert.equal(completion.previous_status, 'available');
      assert.equal(
        (
          await db.query('select status from public.properties where id=$1', [
            sameClaimProperty,
          ])
        ).rows[0].status,
        'sold',
      );
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.property_history where property_id=$1',
            [sameClaimProperty],
          )
        ).rows[0].n,
        0,
        'A sale status change records no property-history row',
      );
    },
  );
  await check(
    'the completion closes the same-claimant reservation with retained attribution',
    async () => {
      const lock = (
        await db.query(
          'select status,requested_by,reason,decided_by,decision_reason from public.property_locks where id=$1',
          [sameLock],
        )
      ).rows[0];
      assert.equal(lock.status, 'closed_by_sale');
      assert.equal(lock.requested_by, employees[0]);
      assert.equal(lock.decided_by, employees[3]);
      assert.equal(
        lock.reason,
        'Synthetic same-claimant reservation for the completion regression',
      );
      assert.equal(
        lock.decision_reason,
        'Synthetic approval for the same-claimant completion regression',
      );
      assert.deepEqual(
        (
          await db.query(
            'select action,actor_id from public.lock_events where lock_id=$1 order by id',
            [sameLock],
          )
        ).rows.map((event) => event.action),
        ['requested', 'approved', 'sale_completed'],
      );
    },
  );
  await check(
    'a same-key retry converges on the committed completion without duplication',
    async () => {
      const retried = (
        await db.query(
          'select public.complete_property_sale($1,$2,$3,$4,$5) as id',
          [sameClaimProperty, employees[0], yesterday, 'HĐ-38/2026', retryKey],
        )
      ).rows[0].id;
      const rows = await completions(sameClaimProperty);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, retried);
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.property_history where property_id=$1',
            [sameClaimProperty],
          )
        ).rows[0].n,
        0,
      );
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [
          sameClaimProperty,
          employees[0],
          yesterday,
          'HĐ-38/2026-different',
          retryKey,
        ],
        'P0006',
      );
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [sameClaimProperty, employees[1], yesterday, 'HĐ-38/2026', retryKey],
        'P0006',
      );
    },
  );
  await check(
    'a fresh key on an already-sold property earns no second completion',
    async () => {
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [
          sameClaimProperty,
          employees[0],
          yesterday,
          'HĐ-38/2026',
          randomUUID(),
        ],
        'P0005',
      );
      assert.equal((await completions(sameClaimProperty)).length, 1);
    },
  );

  // Open requests are not reservations: the sale closes them with no fabricated approval.
  await asUser(0);
  const pendingLock = (
    await db.query('select public.request_property_lock($1,$2) as id', [
      pendingProperty,
      'Synthetic open request that a completed sale closes',
    ])
  ).rows[0].id;
  await asManager();
  await check(
    'a completed sale closes an open request without inventing an approval',
    async () => {
      await db.query('select public.complete_property_sale($1,$2,$3,$4,$5)', [
        pendingProperty,
        employees[5],
        today,
        'SGN-SALE-38-4/2026',
        randomUUID(),
      ]);
      const lock = (
        await db.query(
          'select status,requested_by,reason,decided_by from public.property_locks where id=$1',
          [pendingLock],
        )
      ).rows[0];
      assert.equal(lock.status, 'closed_by_sale');
      assert.equal(lock.requested_by, employees[0]);
      assert.equal(lock.decided_by, null);
      assert.equal(
        lock.reason,
        'Synthetic open request that a completed sale closes',
      );
      assert.deepEqual(
        (
          await db.query(
            'select action,actor_id from public.lock_events where lock_id=$1 order by id',
            [pendingLock],
          )
        ).rows.map((event) => event.action),
        ['requested', 'sale_completed'],
      );
    },
  );

  // An activated rental commitment blocks the sale with no partial change.
  await check(
    'an activated rental blocks sale completion with no partial change',
    async () => {
      await fails(
        'select public.complete_property_sale($1,$2,$3,$4,$5)',
        [
          rentalProperty,
          employees[5],
          today,
          'SGN-SALE-38-3/2026',
          randomUUID(),
        ],
        'P0002',
      );
      assert.equal((await completions(rentalProperty)).length, 0);
      assert.equal(
        (
          await db.query('select status from public.properties where id=$1', [
            rentalProperty,
          ])
        ).rows[0].status,
        'rented',
      );
      assert.equal(
        (
          await db.query(
            'select status from public.rental_agreements where property_id=$1',
            [rentalProperty],
          )
        ).rows[0].status,
        'active',
      );
    },
  );
  await check(
    'a direct sold status write is denied and earns no credit',
    async () => {
      const before = await ranking(today, today);
      await fails(
        "update public.properties set status='sold' where id=$1",
        [controlProperty],
        '42501',
      );
      const after = await ranking(today, today);
      assert.deepEqual(after.rows, before.rows);
      assert.equal(
        Number(after.totalCompletedSales),
        Number(before.totalCompletedSales),
      );
      assert.equal(
        (
          await db.query('select status from public.properties where id=$1', [
            controlProperty,
          ])
        ).rows[0].status,
        'available',
      );
      assert.equal((await completions(controlProperty)).length, 0);
    },
  );
  await check('an archived property cannot be completed', async () => {
    await owner();
    await db.query(
      'update public.properties set archived_at=now() where id=$1',
      [archivedProperty],
    );
    await asManager();
    await fails(
      'select public.complete_property_sale($1,$2,$3,$4,$5)',
      [
        archivedProperty,
        employees[0],
        today,
        'SGN-SALE-38-7/2026',
        randomUUID(),
      ],
      'P0005',
    );
    assert.equal((await completions(archivedProperty)).length, 0);
  });

  // Ranking: recorded completions only, honest unknown attribution, tied ranks, retained
  // inactive history and the effective-unreversed filter.
  await check(
    'the reviewer ranking counts recorded completions by credited employee only',
    async () => {
      const result = await ranking(today, today);
      const byId = new Map(result.rows.map((row) => [row.employeeId, row]));
      const staffRow = byId.get(employees[5]);
      assert.equal(Number(staffRow.completedSales), 2);
      assert.equal(Number(staffRow.rank), 1);
      // The yesterday-dated same-claimant completion belongs to yesterday, not today.
      assert.equal(byId.has(employees[0]), false);
      const yesterdayResult = await ranking(yesterday, yesterday);
      assert.equal(
        Number(
          yesterdayResult.rows.find((row) => row.employeeId === employees[0])
            .completedSales,
        ),
        1,
      );
      assert.equal(Number(yesterdayResult.totalCompletedSales), 1);
      // Legacy sold fixtures with no logical completion stay unknown attribution and never
      // become a row or a fabricated credit.
      assert.ok(Number(result.unknownAttribution) >= 1);
      assert.equal((await completions(legacySoldProperty)).length, 0);
      assert.equal(
        result.rows.some((row) => row.employeeId === null),
        false,
      );
    },
  );
  await check(
    'tied totals share a rank with deterministic ordering',
    async () => {
      await db.query('select public.complete_property_sale($1,$2,$3,$4,$5)', [
        controlProperty,
        employees[5],
        today,
        'SGN-SALE-38-6/2026',
        randomUUID(),
      ]);
      const tieProperty = '20000000-0000-4000-8000-0000000000e8';
      const tieProperty2 = '20000000-0000-4000-8000-0000000000e9';
      await owner();
      await db.query(
        "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-SALE-38-8','sale','available',$3),($2,'SGN-SALE-38-9','sale','available',$3)",
        [tieProperty, tieProperty2, employees[0]],
      );
      await asManager();
      await db.query('select public.complete_property_sale($1,$2,$3,$4,$5)', [
        tieProperty,
        employees[1],
        today,
        'SGN-SALE-38-8/2026',
        randomUUID(),
      ]);
      await db.query('select public.complete_property_sale($1,$2,$3,$4,$5)', [
        tieProperty2,
        employees[3],
        today,
        'SGN-SALE-38-9/2026',
        randomUUID(),
      ]);
      const result = await ranking(today, today);
      assert.equal(
        Number(
          result.rows.find((row) => row.employeeId === employees[5])
            .completedSales,
        ),
        3,
      );
      assert.equal(
        Number(result.rows.find((row) => row.employeeId === employees[5]).rank),
        1,
      );
      const singles = result.rows.filter(
        (row) => Number(row.completedSales) === 1,
      );
      assert.equal(singles.length, 2);
      assert.deepEqual(
        [...new Set(singles.map((row) => Number(row.rank)))],
        [2],
      );
      const names = singles.map((row) => row.employeeName);
      assert.deepEqual(names, [...names].sort());
    },
  );
  await check(
    'a deactivated credited employee keeps their completed history in the ranking',
    async () => {
      const before = (await ranking(today, today)).rows.find(
        (row) => row.employeeId === employees[1],
      );
      await owner();
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[1]],
      );
      await asManager();
      const after = (await ranking(today, today)).rows.find(
        (row) => row.employeeId === employees[1],
      );
      assert.equal(Number(after.completedSales), Number(before.completedSales));
      await owner();
      await db.query('update public.employees set is_active=true where id=$1', [
        employees[1],
      ]);
      await asManager();
    },
  );
  await check(
    'a reversed completion is excluded as an effective fact',
    async () => {
      const target = (await completions(pendingProperty))[0];
      const before = await ranking(today, today);
      await owner();
      await db.query(
        "update public.sale_completions set reversed_at=now(),reversed_by=$2,reversal_reason='Synthetic reversal for the effective-fact regression' where id=$1",
        [target.id, employees[2]],
      );
      await asManager();
      const after = await ranking(today, today);
      assert.equal(
        Number(
          after.rows.find((row) => row.employeeId === employees[5])
            .completedSales,
        ),
        Number(
          before.rows.find((row) => row.employeeId === employees[5])
            .completedSales,
        ) - 1,
      );
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.sale_completions where property_id=$1 and reversed_at is null',
            [pendingProperty],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    'invalid ranking ranges are rejected instead of zero-filled',
    async () => {
      await fails(
        'select public.completed_sale_ranking(null,$1)',
        [today],
        '22023',
      );
      await fails(
        'select public.completed_sale_ranking($1,null)',
        [today],
        '22023',
      );
      await fails(
        'select public.completed_sale_ranking($1,$2)',
        [today, yesterday],
        '22023',
      );
      await fails(
        'select public.completed_sale_ranking($1,$2)',
        ['2024-01-01', '2026-01-01'],
        '22023',
      );
    },
  );
  await check(
    'an empty period reports explicit zeros rather than unknown',
    async () => {
      const result = await ranking('2020-01-01', '2020-01-31');
      assert.deepEqual(result.rows, []);
      assert.equal(Number(result.totalCompletedSales), 0);
      assert.ok(Number(result.unknownAttribution) >= 1);
    },
  );
  await check('direct completion writes are denied at every role', async () => {
    const row = await completions(sameClaimProperty);
    await fails(
      'insert into public.sale_completions(property_id,credited_employee_id,completed_on,reference,previous_status,confirmed_by,idempotency_key) values($1,$2,$3,$4,$5,$6,$7)',
      [
        sameClaimProperty,
        employees[3],
        today,
        'direct write',
        'available',
        employees[2],
        randomUUID(),
      ],
      '42501',
    );
    await fails(
      "update public.sale_completions set reference='rewritten' where id=$1",
      [row[0].id],
      '42501',
    );
    await fails(
      'delete from public.sale_completions where id=$1',
      [row[0].id],
      '42501',
    );
    assert.equal(
      (await completions(sameClaimProperty))[0].reference,
      'HĐ-38/2026',
    );
  });
  await asUser(3);
  await check(
    'a second independent reviewer reads the same recorded completions',
    async () => {
      assert.equal((await completions(sameClaimProperty)).length, 1);
      assert.ok(Array.isArray((await ranking(today, today)).rows));
    },
  );
  await asUser(0);
  await check('an ordinary employee reads no completion rows', async () => {
    assert.equal(
      (await db.query('select * from public.sale_completions')).rows.length,
      0,
    );
  });
  await owner();
}
