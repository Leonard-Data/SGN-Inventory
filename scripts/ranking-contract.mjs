import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #34 embedded regressions: the reviewer-only Employee owner-contact activity ranking
// over an explicit Vietnam date range. It proves the live manager/admin boundary, the range
// totals built from the established daily distinct-property units, shared ranks with a stable
// order, explicit zero rows, the page-view separation and retained attribution for a
// contributor deactivated after recording. Real Auth/Data API/RLS and browser acceptance stay
// a staging gate; this proves the database rules the application reads.
export async function rankingContract({ db, asUser, check, fails, employees }) {
  const asOwner = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  // Own fixture namespace and fixed past Vietnam days, independent of the other contracts.
  const properties = [
    '80000000-0000-4000-8000-0000000000b1',
    '80000000-0000-4000-8000-0000000000b2',
    '80000000-0000-4000-8000-0000000000b3',
  ];
  const [sharedOne, sharedTwo, control] = properties;
  const days = ['2026-08-01', '2026-08-02', '2026-08-03'];
  const [first, second, empty] = days;
  const contributor = employees[0];
  const tied = employees[1];
  const reader = employees[2];
  const retained = employees[3];
  const absent = employees[4];
  const silent = employees[5];
  const manager = reader;

  await asOwner();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-RANK-1','sale','available',$4),($2,'SGN-RANK-2','sale','available',$4),($3,'SGN-RANK-3','sale','available',$4)",
    [...properties, contributor],
  );
  const event = (employee, property, kind, day, hour) =>
    db.query(
      'insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,$3,$4,$5)',
      [employee, property, kind, randomUUID(), `${day} ${hour}:00:00+07`],
    );
  // Contributor: three committed rows of one property on one Vietnam day collapse to one unit,
  // one more property on that day, and one repeat of the first property on the next day.
  await event(contributor, sharedOne, 'owner_contact_access', first, 9);
  await event(contributor, sharedOne, 'owner_contact_access', first, 10);
  await event(contributor, sharedTwo, 'owner_contact_access', first, 11);
  await event(contributor, sharedOne, 'owner_contact_access', second, 9);
  await event(contributor, control, 'page_view', second, 12);
  // Tied: the same three-unit total and no Page view at all, so equal totals share a rank even
  // though the separate Page-view metric differs.
  await event(tied, sharedOne, 'owner_contact_access', first, 9);
  await event(tied, sharedTwo, 'owner_contact_access', second, 9);
  await event(tied, control, 'owner_contact_access', second, 10);
  // Retained: one owner-contact unit and one Page view, then deactivated later in this contract.
  await event(retained, control, 'owner_contact_access', first, 13);
  await event(retained, control, 'page_view', first, 14);
  // The reviewer reads the report and records only a Page view: activity without owner-contact
  // credit stays a zero row. The silent employee records nothing at all in this range.
  await event(manager, sharedTwo, 'page_view', first, 15);

  const read = async (from = first, to = empty) =>
    (
      await db.query(
        'select employee_id,employee_name,employee_active,owner_contact_properties::int as owner_contact_properties,rank_position::int as rank_position from public.employee_owner_contact_ranking($1,$2)',
        [from, to],
      )
    ).rows;
  const rowOf = (rows, employeeId) => {
    const row = rows.find((value) => value.employee_id === employeeId);
    assert.ok(row, `missing ranking row for ${employeeId}`);
    return row;
  };
  const totalOf = (rows, employeeId) =>
    Number(rowOf(rows, employeeId).owner_contact_properties);
  const daily = async (from, to) =>
    (
      await db.query(
        'select employee_id,business_day::text as business_day,page_view_events::int as page_view_events,distinct_properties_viewed::int as distinct_properties_viewed,owner_contact_properties::int as owner_contact_properties from public.company_employee_daily_activity($1,$2)',
        [from, to],
      )
    ).rows;
  // A physical visit and a legacy page view are retained kinds, never owner-contact credit.
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at,visit_status,reviewed_by,reviewed_at) values($1,$2,'site_visit',$3,$4,'confirmed',$5,now())",
    [contributor, sharedOne, randomUUID(), `${first} 16:00:00+07`, manager],
  );
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at,source) values($1,$2,'page_view',$3,$4,'legacy_click')",
    [contributor, sharedTwo, randomUUID(), `${first} 16:30:00+07`],
  );

  await asUser(2);
  const rows = await read();
  await check(
    'the ranking covers the reviewer scope with explicit zero rows',
    () => {
      // Every currently active employee, plus the reviewer's Page-view-only row: zeros are
      // explicit rows rather than omitted totals.
      assert.equal(rows.length, 5);
      for (const employee of [contributor, tied, retained, reader, silent])
        assert.ok(
          rows.some((row) => row.employee_id === employee),
          `missing ranking row for ${employee}`,
        );
      // An inactive employee with no recorded activity in the range is not a ranking subject.
      assert.ok(!rows.some((row) => row.employee_id === absent));
      assert.equal(totalOf(rows, silent), 0);
      assert.ok(rows.every((row) => row.employee_active));
    },
  );
  await check(
    'each range total sums the daily distinct-property units for that employee',
    async () => {
      // Three committed rows of one property on the first day are one unit; the same property on
      // the next Vietnam day is another. The controlled values are asserted, not inferred.
      assert.equal(totalOf(rows, contributor), 3);
      const report = await daily(first, empty);
      const dayRows = (employeeId) =>
        report
          .filter((row) => row.employee_id === employeeId)
          .map((row) => row.business_day);
      assert.deepEqual(dayRows(manager), [empty, second, first]);
      const cell = (day) =>
        report.find(
          (row) => row.employee_id === contributor && row.business_day === day,
        );
      assert.equal(Number(cell(first).owner_contact_properties), 2);
      assert.equal(Number(cell(second).owner_contact_properties), 1);
      assert.equal(Number(cell(empty).owner_contact_properties), 0);
    },
  );
  await check(
    'ranked totals reconcile with the committed source rows and the daily report',
    async () => {
      const source = (
        await db.query(
          "select employee_id, count(distinct (business_day,property_id)) filter (where kind = 'owner_contact_access')::int as owner_contact_properties from public.activity_events where business_day between $1 and $2 and employee_id = any($3) group by employee_id",
          [first, empty, [contributor, tied, retained, reader, silent]],
        )
      ).rows;
      const report = await daily(first, empty);
      for (const employee of [contributor, tied, retained, reader, silent]) {
        const committed = source.find((row) => row.employee_id === employee);
        assert.equal(
          totalOf(rows, employee),
          Number(committed?.owner_contact_properties ?? 0),
          `the ranked total disagrees with the committed rows for ${employee}`,
        );
        // The same total equals the sum of that employee's daily report rows, so the company
        // report, the personal report and the ranking share one counting definition.
        const summed = report
          .filter((row) => row.employee_id === employee)
          .reduce((sum, row) => sum + Number(row.owner_contact_properties), 0);
        assert.equal(totalOf(rows, employee), summed);
      }
    },
  );
  await check(
    'Page views and distinct properties viewed stay separate and never enter the ranked total',
    async () => {
      // The reviewer's Page-view-only activity earns no owner-contact unit, and the tied pair
      // still shares a rank although the contributor also owns two separate Page views.
      const report = await daily(first, empty);
      const reported = (employeeId, key) =>
        report
          .filter((row) => row.employee_id === employeeId)
          .reduce((sum, row) => sum + Number(row[key]), 0);
      assert.equal(reported(reader, 'page_view_events'), 1);
      assert.equal(totalOf(rows, reader), 0);
      assert.equal(reported(contributor, 'page_view_events'), 2);
      assert.equal(reported(tied, 'page_view_events'), 0);
      assert.equal(totalOf(rows, contributor), totalOf(rows, tied));
      // A committed physical visit and a legacy page view never become owner-contact credit; the
      // legacy row still counts as the Page view it was recorded as.
      assert.equal(totalOf(rows, contributor), 3);
    },
  );
  await check(
    'equal totals share a rank with a stable deterministic order',
    async () => {
      assert.deepEqual(
        rows.map((row) => [row.employee_name, row.rank_position]),
        [
          ['Fixture 0', 1],
          ['Fixture 1', 1],
          ['Fixture 3', 3],
          ['Fixture 2', 4],
          ['Fixture 5', 4],
        ],
      );
      assert.deepEqual(
        await read(),
        rows,
        'the same request returns the same rows',
      );
    },
  );
  await check(
    'invalid date ranges are rejected instead of reported as zeros',
    async () => {
      for (const range of [
        [empty, first],
        [null, empty],
        [first, null],
        ['2025-01-01', '2026-10-01'],
      ])
        await fails(
          'select * from public.employee_owner_contact_ranking($1,$2)',
          range,
          '22023',
        );
      // The 366-day boundary itself is accepted, matching the company and personal reports.
      assert.ok((await read('2026-01-01', '2027-01-01')).length >= 5);
    },
  );

  await asUser(null);
  await check('anonymous ranking reads are denied', () =>
    fails(
      'select * from public.employee_owner_contact_ranking($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(4);
  await check('an inactive identity cannot read the ranking', () =>
    fails(
      'select * from public.employee_owner_contact_ranking($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(0);
  await check('a sales employee cannot read the ranking', () =>
    fails(
      'select * from public.employee_owner_contact_ranking($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(5);
  await check('a staff employee cannot read the ranking', () =>
    fails(
      'select * from public.employee_owner_contact_ranking($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(3);
  await check('an admin reads the complete ranking', async () =>
    assert.equal((await read()).length, 5),
  );

  await asUser(2);
  await asOwner();
  await db.query("update public.employees set role='sales' where id=$1", [
    manager,
  ]);
  await asUser(2);
  await check(
    'a role downgrade removes ranking authority on the next request',
    () =>
      fails(
        'select * from public.employee_owner_contact_ranking($1,$2)',
        [first, empty],
        '42501',
      ),
  );
  await asOwner();
  await db.query("update public.employees set role='manager' where id=$1", [
    manager,
  ]);
  await asUser(2);
  await check(
    'restoring the manager role restores ranking authority',
    async () => assert.equal((await read()).length, 5),
  );

  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    manager,
  ]);
  await asUser(2);
  await check('deactivation removes ranking authority', () =>
    fails(
      'select * from public.employee_owner_contact_ranking($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    manager,
  ]);

  // `retained` is the seeded admin seat, and it is the only active admin here. The guarded
  // employee admin state (issue #66/#98) refuses deactivating the last active admin, so lend
  // the admin role to the otherwise idle staff seat for this case only, and give it back once
  // `retained` is active again. Nothing else about the case changes.
  await asOwner();
  await db.query("update public.employees set role='admin' where id=$1", [
    silent,
  ]);
  await db.query('update public.employees set is_active=false where id=$1', [
    retained,
  ]);
  await asUser(2);
  await check(
    'a contributor deactivated after recording stays attributed with retained totals',
    async () => {
      const retainedRows = await read();
      const row = rowOf(retainedRows, retained);
      assert.equal(row.employee_active, false);
      assert.equal(Number(row.owner_contact_properties), 1);
      // The active-only company report drops the contributor, so a ranking that merely summed
      // those rows would lose the recorded work: the ranking reads the committed units instead.
      const report = await daily(first, empty);
      assert.ok(!report.some((value) => value.employee_id === retained));
      assert.equal(retainedRows.length, 5);
    },
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    retained,
  ]);
  // `retained` is the active admin again, so the lent role can return to its seeded seat.
  await db.query("update public.employees set role='staff' where id=$1", [
    silent,
  ]);

  await asOwner();
  await check(
    'a scope above the Data API row cap is rejected instead of truncated',
    async () => {
      await db.query(
        "insert into public.employees(email,display_name,role,is_active) select 'rank-scope-' || g || '@example.test','Rank Scope ' || g,'sales',false from generate_series(1,1001) g",
      );
      await db.query(
        "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) select e.id,$1,'owner_contact_access',gen_random_uuid(),$2 from public.employees e where e.email like 'rank-scope-%'",
        [sharedOne, `${first} 17:00:00+07`],
      );
      await asUser(2);
      await fails(
        'select * from public.employee_owner_contact_ranking($1,$2)',
        [first, empty],
        '54000',
      );
      await asUser(3);
      await fails(
        'select * from public.employee_owner_contact_ranking($1,$2)',
        [first, empty],
        '54000',
      );
    },
  );

  await asOwner();
  await check(
    'the public wrapper is an invoker function and the private definer stays unexposed',
    async () => {
      const signature = async (schema, name) =>
        (
          await db.query(
            'select prosecdef::text as definer from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2',
            [schema, name],
          )
        ).rows[0] ?? null;
      const allowed = async (role, schema, name) =>
        (
          await db.query(
            'select has_function_privilege($1,p.oid,$2) as allowed from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $3 and p.proname = $4',
            [role, 'execute', schema, name],
          )
        ).rows[0].allowed;
      // A public definer wrapper would be the bypass this contract forbids, and neither the
      // private definer nor the wrapper carries the default PUBLIC execute grant.
      assert.equal(
        (await signature('public', 'employee_owner_contact_ranking')).definer,
        'false',
      );
      assert.equal(
        (await signature('private', 'employee_owner_contact_ranking')).definer,
        'true',
      );
      assert.equal(
        await allowed(
          'authenticated',
          'public',
          'employee_owner_contact_ranking',
        ),
        true,
      );
      assert.equal(
        await allowed(
          'authenticated',
          'private',
          'employee_owner_contact_ranking',
        ),
        true,
      );
      assert.equal(
        await allowed('anon', 'public', 'employee_owner_contact_ranking'),
        false,
      );
      assert.equal(
        await allowed('anon', 'private', 'employee_owner_contact_ranking'),
        false,
      );
    },
  );
}
