import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #30 embedded regressions: the personal daily-activity report over an explicit Vietnam
// date range. It proves the own-employee scope for a reviewer role whose RLS spans colleagues,
// exact per-metric/per-day values against the committed events, explicit zero days, Vietnam-day
// attribution across midnight and the active-employee/range boundaries the application reads.
// Real Auth/Data API/RLS and browser acceptance stay a staging gate.
export async function myActivityContract({
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
  const properties = [
    '70000000-0000-4000-8000-0000000000a1',
    '70000000-0000-4000-8000-0000000000a2',
  ];
  const [firstProperty, secondProperty] = properties;
  // Fixed past Vietnam days: independent of the other contracts' fixture days and of today.
  const days = ['2026-09-01', '2026-09-02', '2026-09-03'];
  const [first, second, empty] = days;
  // The reader is a manager, so activity_events RLS would return colleagues' rows; only the
  // function's own-employee predicate keeps this report personal.
  const reader = employees[2];
  const colleague = employees[0];

  await asOwner();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-MINE-1','sale','available',$3),($2,'SGN-MINE-2','sale','available',$3)",
    [...properties, reader],
  );
  // Committed events for the reader: two Page views of one property on the first day, then one
  // Page view and owner-contact accesses of a second property on the second day. Owner-contact
  // credit comes from the committed rows, never re-derived from the current contact state.
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'page_view',$3,$4),($1,$2,'page_view',$5,$4),($1,$6,'page_view',$7,$8)",
    [
      reader,
      firstProperty,
      randomUUID(),
      `${first} 09:00:00+07`,
      randomUUID(),
      secondProperty,
      randomUUID(),
      `${second} 09:00:00+07`,
    ],
  );
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'owner_contact_access',$3,$4),($1,$2,'owner_contact_access',$5,$4),($1,$6,'owner_contact_access',$7,$8)",
    [
      reader,
      firstProperty,
      randomUUID(),
      `${first} 10:00:00+07`,
      randomUUID(),
      secondProperty,
      randomUUID(),
      `${second} 10:00:00+07`,
    ],
  );
  // A colleague's events on the same days must never appear in the reader's report.
  for (let index = 0; index < 5; index++)
    await db.query(
      "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'page_view',$3,$4)",
      [colleague, firstProperty, randomUUID(), `${first} 11:00:00+07`],
    );
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'owner_contact_access',$3,$4)",
    [colleague, secondProperty, randomUUID(), `${first} 11:30:00+07`],
  );

  const read = async (from, to) =>
    (
      await db.query(
        'select business_day::text as business_day,page_view_events,distinct_properties_viewed,owner_contact_properties from public.my_daily_activity($1,$2)',
        [from, to],
      )
    ).rows.map((row) => ({
      businessDay: row.business_day,
      pageViewEvents: Number(row.page_view_events),
      distinctPropertiesViewed: Number(row.distinct_properties_viewed),
      ownerContactProperties: Number(row.owner_contact_properties),
    }));
  const cell = (rows, day) => {
    const row = rows.find((value) => value.businessDay === day);
    assert.ok(row, `missing personal report row for ${day}`);
    return {
      pageViewEvents: row.pageViewEvents,
      distinctPropertiesViewed: row.distinctPropertiesViewed,
      ownerContactProperties: row.ownerContactProperties,
    };
  };

  await asUser(2);
  await check(
    'personal report covers every requested day with exact per-metric values',
    async () => {
      const rows = await read(first, empty);
      assert.deepEqual(
        rows.map((row) => row.businessDay),
        [empty, second, first],
        'rows are one per requested Vietnam day, newest first',
      );
      // Repeated events on one property stay one distinct property; metrics stay separate.
      assert.deepEqual(cell(rows, first), {
        pageViewEvents: 2,
        distinctPropertiesViewed: 1,
        ownerContactProperties: 1,
      });
      assert.deepEqual(cell(rows, second), {
        pageViewEvents: 1,
        distinctPropertiesViewed: 1,
        ownerContactProperties: 1,
      });
      // A requested day with no recorded event appears with explicit zeros, not omitted.
      assert.deepEqual(cell(rows, empty), {
        pageViewEvents: 0,
        distinctPropertiesViewed: 0,
        ownerContactProperties: 0,
      });
    },
  );

  await check(
    'the personal range report agrees with the company report same-period row',
    async () => {
      // The reviewer reads the manager/admin company report for the same period; the caller's
      // own row must carry exactly the personal report's separated metrics on every day,
      // including a zero day, so the two reports share one counting definition.
      const company = (
        await db.query(
          'select business_day::text as business_day,page_view_events,distinct_properties_viewed,owner_contact_properties from public.company_employee_daily_activity($1,$2) where employee_id=$3',
          [first, empty, reader],
        )
      ).rows;
      const personal = await read(first, empty);
      assert.equal(company.length, personal.length);
      for (const day of days) {
        const companyRow = company.find((row) => row.business_day === day);
        assert.ok(companyRow, `missing company report row for ${day}`);
        assert.deepEqual(
          {
            pageViewEvents: Number(companyRow.page_view_events),
            distinctPropertiesViewed: Number(
              companyRow.distinct_properties_viewed,
            ),
            ownerContactProperties: Number(companyRow.owner_contact_properties),
          },
          cell(personal, day),
        );
      }
    },
  );

  await check(
    'personal totals equal the eligible committed events for this employee alone',
    async () => {
      const rows = await read(first, empty);
      const committed = (
        await db.query(
          'select kind,count(*) as events,count(distinct (business_day,property_id)) as daily_properties from public.activity_events where employee_id=$1 and business_day between $2 and $3 group by kind',
          [reader, first, empty],
        )
      ).rows;
      const byKind = Object.fromEntries(
        committed.map((row) => [row.kind, row]),
      );
      const totals = rows.reduce(
        (sum, row) => ({
          pageViewEvents: sum.pageViewEvents + row.pageViewEvents,
          distinctPropertiesViewed:
            sum.distinctPropertiesViewed + row.distinctPropertiesViewed,
          ownerContactProperties:
            sum.ownerContactProperties + row.ownerContactProperties,
        }),
        {
          pageViewEvents: 0,
          distinctPropertiesViewed: 0,
          ownerContactProperties: 0,
        },
      );
      // Page views count events; both property metrics count one distinct property per day, so
      // repeated reveals of one property never become a second day of credit.
      assert.equal(totals.pageViewEvents, Number(byKind.page_view.events));
      assert.equal(
        totals.distinctPropertiesViewed,
        Number(byKind.page_view.daily_properties),
      );
      assert.equal(
        totals.ownerContactProperties,
        Number(byKind.owner_contact_access.daily_properties),
      );
      // The colleague's five Page views and one disclosure on the same days stay out entirely.
      assert.equal(totals.pageViewEvents, 3);
      assert.equal(Number(byKind.owner_contact_access.events), 3);
      assert.equal(totals.ownerContactProperties, 2);
    },
  );

  await check(
    'a reviewer whose RLS spans colleagues still reads only their own activity',
    async () => {
      const colleagueRows = await read(first, second);
      assert.deepEqual(cell(colleagueRows, first), {
        pageViewEvents: 2,
        distinctPropertiesViewed: 1,
        ownerContactProperties: 1,
      });
      // Sales/staff and reviewers alike see one personal scope; the colleague's own read is its
      // own five Page views, never the reader's events.
      await asUser(0);
      const own = await read(first, second);
      assert.deepEqual(cell(own, first), {
        pageViewEvents: 5,
        distinctPropertiesViewed: 1,
        ownerContactProperties: 1,
      });
      assert.deepEqual(cell(own, second), {
        pageViewEvents: 0,
        distinctPropertiesViewed: 0,
        ownerContactProperties: 0,
      });
      await asUser(5);
      assert.deepEqual(
        (await read(first, second)).map((row) => row.pageViewEvents),
        [0, 0],
        'a staff employee with no events reads explicit zeros, not a colleague report',
      );
      await asUser(2);
    },
  );

  await check(
    'Vietnam-day attribution holds before and after midnight and never follows another zone',
    async () => {
      // 16:59:59Z is 23:59:59 on the first Vietnam day; 17:00:00Z starts the second.
      await asOwner();
      for (const [instant, expected] of [
        [`${first} 16:59:59Z`, first],
        [`${first} 17:00:00Z`, second],
      ]) {
        const inserted = await db.query(
          "insert into public.activity_events(employee_id,property_id,kind,occurred_at,idempotency_key) values($1,$2,'page_view',$3,$4) returning business_day::text as business_day",
          [reader, firstProperty, instant, randomUUID()],
        );
        // The database derives the Vietnam day from the instant, not from the caller.
        assert.equal(inserted.rows[0].business_day, expected);
      }
      await asUser(2);
      const before = await read(first, second);
      assert.equal(cell(before, first).pageViewEvents, 3);
      assert.equal(cell(before, second).pageViewEvents, 2);
      // A session timezone change moves no committed fact between requested days.
      await db.exec("set timezone='Pacific/Honolulu'");
      assert.deepEqual(await read(first, second), before);
      await db.exec('reset timezone');
    },
  );

  await check(
    'reversed, missing and over-long ranges are rejected, not zero-filled',
    async () => {
      await fails(
        'select * from public.my_daily_activity($1,$2)',
        [second, first],
        '22023',
      );
      await fails(
        'select * from public.my_daily_activity($1,$2)',
        [null, second],
        '22023',
      );
      await fails(
        'select * from public.my_daily_activity($1,$2)',
        [first, null],
        '22023',
      );
      await fails(
        'select * from public.my_daily_activity($1,$2)',
        ['2025-01-01', '2026-01-02'],
        '22023',
      );
      // The 366-day boundary is accepted and stays inside the configured row cap.
      const widest = await read('2025-01-01', '2026-01-01');
      assert.equal(widest.length, 366);
    },
  );

  await asUser(null);
  await check('anonymous personal report denied', () =>
    fails(
      'select * from public.my_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(3);
  await check('unlinked personal report denied', async () => {
    // A signed-in Auth identity with no linked employee row has no personal scope.
    await asOwner();
    const unlinked = '00000000-0000-4000-8000-0000000000ff';
    await db.query('insert into auth.users values ($1)', [unlinked]);
    await asOwner();
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      unlinked,
    ]);
    await db.exec('set role authenticated');
    await fails(
      'select * from public.my_daily_activity($1,$2)',
      [first, empty],
      '42501',
    );
  });
  await asUser(4);
  await check('inactive personal report denied', () =>
    fails(
      'select * from public.my_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );

  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    reader,
  ]);
  await asUser(2);
  await check(
    'deactivation denies the next personal read with the existing identity',
    () =>
      fails(
        'select * from public.my_daily_activity($1,$2)',
        [first, empty],
        '42501',
      ),
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    reader,
  ]);

  // Committed credit is read from the event rows, so a later archive or contact correction
  // cannot rewrite a past day for the employee who earned it.
  await db.query('update public.properties set archived_at=now() where id=$1', [
    firstProperty,
  ]);
  await asUser(2);
  await check(
    'archiving a property keeps that day’s committed personal credit',
    async () => {
      const rows = await read(first, empty);
      assert.deepEqual(cell(rows, first), {
        pageViewEvents: 3,
        distinctPropertiesViewed: 1,
        ownerContactProperties: 1,
      });
    },
  );
  await asOwner();
}
