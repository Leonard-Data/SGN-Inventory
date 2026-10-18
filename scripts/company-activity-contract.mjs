import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #31 embedded regressions: the company employee-by-day report's live manager/admin
// boundary, complete employee/date matrix, per-employee/Vietnam-day metric definitions and
// retention of committed credit. Real Auth/Data API/RLS and browser acceptance stay a staging
// gate; this proves the database rules the application reads.
export async function companyActivityContract({
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
    '20000000-0000-4000-8000-0000000000c1',
    '20000000-0000-4000-8000-0000000000c2',
    '20000000-0000-4000-8000-0000000000c3',
    '20000000-0000-4000-8000-0000000000c4',
  ];
  const [ownerOne, ownerTwo, brokerOnly, phoneGap] = properties;
  const sharedOwner = '60000000-0000-4000-8000-0000000000c1';
  const brokerContact = '60000000-0000-4000-8000-0000000000c2';
  const emptyOwner = '60000000-0000-4000-8000-0000000000c3';
  const days = ['2026-10-01', '2026-10-02', '2026-10-03'];
  const [first, second, empty] = days;
  // Active employees are indexes 0, 1, 2, 3 and 5; index 4 is inactive and records nothing.
  const active = [
    employees[0],
    employees[1],
    employees[2],
    employees[3],
    employees[5],
  ];

  await asOwner();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-COMPANY-1','sale','available',$5),($2,'SGN-COMPANY-2','sale','available',$5),($3,'SGN-COMPANY-BROKER','sale','available',$5),($4,'SGN-COMPANY-GAP','sale','available',$5)",
    [...properties, employees[0]],
  );
  await db.query(
    "insert into public.contacts(id,display_name,phones,raw_phone_text,contact_type) values($1,'Company Shared Owner','{0901234567}','090 123 4567','broker'),($2,'Company Broker Only','{0911111111}','091 111 1111','owner'),($3,'Company Owner No Phone','{}',null,'owner')",
    [sharedOwner, brokerContact, emptyOwner],
  );
  await db.query(
    "insert into public.property_contacts(property_id,contact_id,relation,is_primary) values($1,$5,'owner',true),($2,$5,'owner',false),($3,$6,'broker',true),($4,$7,'owner',true)",
    [
      ownerOne,
      ownerTwo,
      brokerOnly,
      phoneGap,
      sharedOwner,
      brokerContact,
      emptyOwner,
    ],
  );
  // Committed events on two fixed Vietnam days: employee 0 has two Page views on two
  // properties, employee 1 repeats one property; the owner-contact rows already carry credit,
  // so the report never re-derives eligibility from the current contact state.
  const at = (day) => `${day} 12:00:00+07`;
  for (const property of [ownerOne, ownerTwo])
    await db.query(
      "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'page_view',$3,$4)",
      [employees[0], property, randomUUID(), at(first)],
    );
  for (let repeat = 0; repeat < 2; repeat++)
    await db.query(
      "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'page_view',$3,$4)",
      [employees[1], ownerOne, randomUUID(), at(first)],
    );
  for (const property of [ownerOne, ownerTwo])
    await db.query(
      "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'owner_contact_access',$3,$4)",
      [employees[0], property, randomUUID(), at(first)],
    );
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'owner_contact_access',$3,$4)",
    [employees[1], ownerOne, randomUUID(), at(first)],
  );
  await db.query(
    "insert into public.activity_events(employee_id,property_id,kind,idempotency_key,occurred_at) values($1,$2,'owner_contact_access',$3,$4)",
    [employees[1], ownerOne, randomUUID(), at(second)],
  );

  const read = async (from, to) =>
    (
      await db.query(
        'select employee_id,employee_name,employee_email,business_day::text as business_day,page_view_events,distinct_properties_viewed,owner_contact_properties from public.company_employee_daily_activity($1,$2)',
        [from, to],
      )
    ).rows;
  const cell = (rows, employeeId, day) => {
    const row = rows.find(
      (value) => value.employee_id === employeeId && value.business_day === day,
    );
    assert.ok(row, `missing report row for ${employeeId} on ${day}`);
    return {
      pageViewEvents: Number(row.page_view_events),
      distinctPropertiesViewed: Number(row.distinct_properties_viewed),
      ownerContactProperties: Number(row.owner_contact_properties),
    };
  };

  await asUser(2);
  const rows = await read(first, empty);
  await check(
    'company report covers every active employee and requested day, including empty days',
    () => {
      assert.equal(rows.length, active.length * days.length);
      const seen = new Set(
        rows.map((row) => `${row.employee_id}|${row.business_day}`),
      );
      for (const employee of active)
        for (const day of days) assert.ok(seen.has(`${employee}|${day}`));
      // The inactive employee records nothing and is not an authorized report subject.
      assert.ok(!seen.has(`${employees[4]}|${first}`));
      for (const row of rows.filter((value) => value.business_day === empty))
        assert.deepEqual(
          {
            pageViewEvents: Number(row.page_view_events),
            distinctPropertiesViewed: Number(row.distinct_properties_viewed),
            ownerContactProperties: Number(row.owner_contact_properties),
          },
          {
            pageViewEvents: 0,
            distinctPropertiesViewed: 0,
            ownerContactProperties: 0,
          },
        );
    },
  );
  await check(
    'every report row carries the employee email the group label uses',
    async () => {
      for (const row of rows)
        assert.equal(
          row.employee_email,
          (
            await db.query('select email from public.employees where id = $1', [
              row.employee_id,
            ])
          ).rows[0].email,
        );
      // The email is the same recorded identity in every day row of one employee.
      const emails = new Set(
        rows
          .filter((row) => row.employee_id === employees[0])
          .map((row) => row.employee_email),
      );
      assert.deepEqual([...emails], ['fixture0@example.test']);
    },
  );
  await check(
    'an employee with no events still reports explicit zeros for every day',
    () => {
      for (const day of days)
        assert.deepEqual(cell(rows, employees[2], day), {
          pageViewEvents: 0,
          distinctPropertiesViewed: 0,
          ownerContactProperties: 0,
        });
    },
  );
  await check(
    'page view events, distinct properties viewed and owner-contact access stay separate per employee and day',
    () => {
      assert.deepEqual(cell(rows, employees[0], first), {
        pageViewEvents: 2,
        distinctPropertiesViewed: 2,
        ownerContactProperties: 2,
      });
      assert.deepEqual(cell(rows, employees[0], second), {
        pageViewEvents: 0,
        distinctPropertiesViewed: 0,
        ownerContactProperties: 0,
      });
      assert.deepEqual(cell(rows, employees[1], first), {
        pageViewEvents: 2,
        distinctPropertiesViewed: 1,
        ownerContactProperties: 1,
      });
      assert.deepEqual(cell(rows, employees[1], second), {
        pageViewEvents: 0,
        distinctPropertiesViewed: 0,
        ownerContactProperties: 1,
      });
    },
  );
  await check(
    'two employees disclosing one property each keep their own count and separate properties sharing an owner stay separate',
    () => {
      // Employee 0 opened the owner contact of two properties that share one owner: two units,
      // not one company-wide property and not one contact row.
      assert.equal(cell(rows, employees[0], first).ownerContactProperties, 2);
      // Employee 1 counts the same property independently of employee 0.
      assert.equal(cell(rows, employees[1], first).ownerContactProperties, 1);
    },
  );
  await check(
    'the report is deterministic and ordered by day descending',
    async () => {
      assert.deepEqual(rows, await read(first, empty));
      const order = rows.map((row) => row.business_day);
      assert.deepEqual(order, [...order].sort().reverse());
    },
  );
  await check(
    'invalid ranges are rejected instead of reported as zeros',
    async () => {
      await fails(
        'select * from public.company_employee_daily_activity($1,$2)',
        [empty, first],
        '22023',
      );
      await fails(
        'select * from public.company_employee_daily_activity($1,$2)',
        ['2025-01-01', '2026-10-01'],
        '22023',
      );
      await fails(
        'select * from public.company_employee_daily_activity($1,$2)',
        [null, empty],
        '22023',
      );
    },
  );
  await check(
    'a scope above the Data API row cap is rejected instead of truncated',
    () =>
      fails(
        'select * from public.company_employee_daily_activity($1,$2)',
        ['2025-01-01', '2026-01-01'],
        '54000',
      ),
  );

  await asUser(null);
  await check('anonymous company reporting denied', () =>
    fails(
      'select * from public.company_employee_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(4);
  await check('inactive identity company reporting denied', () =>
    fails(
      'select * from public.company_employee_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(0);
  await check('sales employee company reporting denied', () =>
    fails(
      'select * from public.company_employee_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(5);
  await check('staff employee company reporting denied', () =>
    fails(
      'select * from public.company_employee_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asUser(3);
  await check('admin company reporting allowed', async () =>
    assert.equal(
      (await read(first, empty)).length,
      active.length * days.length,
    ),
  );

  await asUser(2);
  await asOwner();
  await db.query("update public.employees set role='sales' where id=$1", [
    employees[2],
  ]);
  await asUser(2);
  await check(
    'a role downgrade removes company reporting authority on the next request',
    () =>
      fails(
        'select * from public.company_employee_daily_activity($1,$2)',
        [first, empty],
        '42501',
      ),
  );
  await asOwner();
  await db.query("update public.employees set role='manager' where id=$1", [
    employees[2],
  ]);
  await asUser(2);
  await check(
    'restoring the manager role restores company reporting authority',
    async () =>
      assert.equal(
        (await read(first, empty)).length,
        active.length * days.length,
      ),
  );

  await asUser(2);
  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    employees[2],
  ]);
  await asUser(2);
  await check('deactivation removes company reporting authority', () =>
    fails(
      'select * from public.company_employee_daily_activity($1,$2)',
      [first, empty],
      '42501',
    ),
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    employees[2],
  ]);

  await asOwner();
  await db.query('update public.employees set is_active=false where id=$1', [
    employees[0],
  ]);
  await asUser(2);
  await check(
    'a deactivated employee leaves the matrix even with committed activity',
    async () => {
      const retained = await read(first, empty);
      assert.ok(!retained.some((row) => row.employee_id === employees[0]));
      const remaining = active.filter((id) => id !== employees[0]);
      assert.equal(retained.length, remaining.length * days.length);
    },
  );
  await asOwner();
  await db.query('update public.employees set is_active=true where id=$1', [
    employees[0],
  ]);

  // Personal/company reconciliation on the database's own current Vietnam day.
  await asUser(0);
  await db.query('select public.record_property_activity($1,$2,$3)', [
    ownerOne,
    'page_view',
    randomUUID(),
  ]);
  await db.query('select public.reveal_owner_contact($1,$2)', [
    ownerOne,
    randomUUID(),
  ]);
  await asUser(2);
  await check(
    'the company row for today agrees with the employee personal report',
    async () => {
      const today = (
        await db.query(
          "select (now() at time zone 'Asia/Ho_Chi_Minh')::date::text as day",
        )
      ).rows[0].day;
      await asUser(0);
      const personal = (
        await db.query(
          'select page_view_events,distinct_properties_viewed,owner_contact_properties from public.my_today_activity()',
        )
      ).rows[0];
      await asUser(2);
      assert.deepEqual(cell(await read(today, today), employees[0], today), {
        pageViewEvents: Number(personal.page_view_events),
        distinctPropertiesViewed: Number(personal.distinct_properties_viewed),
        ownerContactProperties: Number(personal.owner_contact_properties),
      });
      assert.ok(Number(personal.owner_contact_properties) >= 1);
    },
  );

  await asUser(0);
  await check(
    'broker-only and missing-owner-phone disclosures add no owner-contact credit',
    async () => {
      await fails(
        'select public.reveal_owner_contact($1,$2)',
        [brokerOnly, randomUUID()],
        'P0003',
      );
      await fails(
        'select public.reveal_owner_contact($1,$2)',
        [phoneGap, randomUUID()],
        'P0004',
      );
      await asUser(2);
      const retained = await read(first, empty);
      assert.equal(
        cell(retained, employees[0], first).ownerContactProperties,
        2,
      );
      assert.deepEqual(cell(retained, employees[0], second), {
        pageViewEvents: 0,
        distinctPropertiesViewed: 0,
        ownerContactProperties: 0,
      });
    },
  );

  await asOwner();
  await db.query('update public.properties set archived_at=now() where id=$1', [
    ownerOne,
  ]);
  await asUser(2);
  await check(
    'archiving a property keeps earlier owner-contact credit and page views',
    async () => {
      const retained = await read(first, empty);
      assert.equal(
        cell(retained, employees[0], first).ownerContactProperties,
        2,
      );
      assert.equal(
        cell(retained, employees[1], first).ownerContactProperties,
        1,
      );
      assert.equal(cell(retained, employees[0], first).pageViewEvents, 2);
    },
  );

  await asOwner();
  await db.query("update public.contacts set phones='{}' where id=$1", [
    sharedOwner,
  ]);
  await asUser(2);
  await check(
    'correcting the shared owner phone keeps earlier committed credit',
    async () => {
      const retained = await read(first, empty);
      assert.equal(
        cell(retained, employees[0], first).ownerContactProperties,
        2,
      );
      assert.equal(
        cell(retained, employees[1], second).ownerContactProperties,
        1,
      );
    },
  );
  await asOwner();
}
