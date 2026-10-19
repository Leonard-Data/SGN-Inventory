import assert from 'node:assert/strict';

// Ticket #174 embedded regressions: sold and rented as a manager decision on the same trail.
// It proves a non-reviewer changes nothing when asking, one request waits per property, only a
// manager or admin decides, approval applies the status and keeps the request on the trail as
// one decided event naming requester and decider, rejection leaves the status alone, an archived
// record or a moved-on status is refused rather than applied, a reviewer still sets sold or
// rented directly with no case, and no completed-sale credit appears anywhere.
export async function statusRequestContract({
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
  const setStatus = 'select public.set_property_status($1,$2,$3) as change';
  const decide = 'select public.decide_status_request($1,$2,$3) as change';
  const reason = 'Owner confirmed the sale; contract signed today';
  const trail = async (property) =>
    (
      await db.query(
        'select id,origin,state,from_status,to_status,requested_by,requested_by_name,requested_at,note,decided_by,decided_by_name,decided_at,decision_reason from public.property_status_changes where property_id=$1 order by requested_at,id',
        [property],
      )
    ).rows;
  const status = async (property) =>
    (
      await db.query('select status from public.properties where id=$1', [
        property,
      ])
    ).rows[0].status;
  // The completed-sale report is a reviewer read, so this helper assumes the manager session and
  // the calling check states its own acting role afterwards.
  const credit = async () => {
    await asUser(2);
    const ranking = (
      await db.query(
        "select public.completed_sale_ranking('2026-01-01','2026-12-31') as result",
      )
    ).rows[0].result;
    return {
      completions: (
        await db.query('select count(*)::int as n from public.sale_completions')
      ).rows[0].n,
      rows: ranking.rows,
      totalCompletedSales: ranking.totalCompletedSales,
      unknownAttribution: ranking.unknownAttribution,
    };
  };
  const create = async (code) =>
    (
      await db.query(
        "insert into public.properties(property_code,listing_mode,status,created_by) values($1,'sale','available',$2) returning id",
        [code, employees[0]],
      )
    ).rows[0].id;

  // Every fixture is created as the owner before any employee session is assumed.
  await owner();
  const asked = await create('SGN-STATUS-REQUEST');
  const refused = await create('SGN-STATUS-REJECT');
  const moved = await create('SGN-STATUS-MOVED');
  const archived = await create('SGN-STATUS-ARCHIVED-REQUEST');
  const direct = await create('SGN-STATUS-DIRECT');
  await asUser(0);
  await check(
    'a non-reviewer asking for sold changes nothing and raises one request',
    async () => {
      const before = await credit();
      await asUser(0);
      const request = (
        await db.query(setStatus, [asked, 'sold', 'Owner says sold'])
      ).rows[0].change;
      assert.deepEqual(
        [request.origin, request.state, request.from_status, request.to_status],
        ['request', 'pending', 'available', 'sold'],
      );
      assert.equal(request.requested_by_name, 'Fixture 0');
      assert.equal(request.note, 'Owner says sold');
      assert.equal(request.decided_by, null);
      assert.equal(await status(asked), 'available');
      const rows = await trail(asked);
      assert.equal(rows.length, 1);
      assert.deepEqual(
        [
          rows[0].origin,
          rows[0].state,
          rows[0].decided_at,
          rows[0].decision_reason,
        ],
        ['request', 'pending', null, null],
      );
      assert.deepEqual(await credit(), before);
    },
  );
  await check(
    'a second request waits for the first decision instead of queueing',
    async () => {
      await asUser(0);
      await fails(setStatus, [asked, 'rented', null], 'P0027');
    },
  );
  await check('the requester cannot decide their own request', async () => {
    await asUser(0);
    await fails(decide, [(await trail(asked))[0].id, true, reason], '42501');
  });
  await asUser(1);
  await check('an ordinary colleague cannot decide a request', async () => {
    await asUser(1);
    await fails(decide, [(await trail(asked))[0].id, true, reason], '42501');
  });
  await asUser(2);
  await check('a decision needs a reason', async () =>
    fails(decide, [(await trail(asked))[0].id, true, 'yes'], '22023'),
  );
  await check(
    'a manager approval applies the status and keeps one decided event',
    async () => {
      const before = await credit();
      await asUser(2);
      const request = (await trail(asked))[0];
      const decided = (await db.query(decide, [request.id, true, reason]))
        .rows[0].change;
      assert.deepEqual(
        [decided.origin, decided.state, decided.from_status, decided.to_status],
        ['request', 'applied', 'available', 'sold'],
      );
      assert.equal(decided.requested_by, employees[0]);
      assert.equal(decided.requested_by_name, 'Fixture 0');
      assert.equal(decided.decided_by, employees[2]);
      assert.equal(decided.decided_by_name, 'Fixture 2');
      assert.equal(decided.decision_reason, reason);
      assert.ok(
        Date.parse(decided.decided_at) >= Date.parse(decided.requested_at),
      );
      assert.equal(await status(asked), 'sold');
      const rows = await trail(asked);
      assert.equal(
        rows.length,
        1,
        'the request row becomes the recorded change',
      );
      assert.equal(rows[0].id, request.id);
      // No credit is created and no employee's ranking moves. The record does move into the
      // completion report's honest unknown-attribution count, because it is now sold with no
      // recorded completion; that bucket is never assigned to an employee.
      const after = await credit();
      assert.deepEqual(
        {
          completions: after.completions,
          rows: after.rows,
          total: after.totalCompletedSales,
        },
        {
          completions: before.completions,
          rows: before.rows,
          total: before.totalCompletedSales,
        },
      );
      assert.equal(after.unknownAttribution, before.unknownAttribution + 1);
    },
  );
  await check('an already-decided request is refused as decided', async () =>
    fails(decide, [(await trail(asked))[0].id, false, reason], 'P0028'),
  );
  await check(
    'a decided event cannot be rewritten by a browser role',
    async () => {
      const row = (await trail(asked))[0];
      await fails(
        "update public.property_status_changes set state='rejected' where id=$1",
        [row.id],
        '42501',
      );
      await fails(
        'delete from public.property_status_changes where id=$1',
        [row.id],
        '42501',
      );
      await fails(
        "insert into public.property_status_changes(property_id,origin,state,from_status,to_status,requested_by,requested_by_name) values($1,'direct','applied','available','sold',$2,'Forged')",
        [asked, employees[0]],
        '42501',
      );
      assert.deepEqual(await trail(asked), [row]);
    },
  );

  await asUser(0);
  const rejected = (await db.query(setStatus, [refused, 'rented', null]))
    .rows[0].change;
  await asUser(2);
  await check(
    'a rejection leaves the status alone and states why',
    async () => {
      const decided = (
        await db.query(decide, [
          rejected.id,
          false,
          'The tenant withdrew before signing',
        ])
      ).rows[0].change;
      assert.deepEqual(
        [
          decided.state,
          decided.to_status,
          decided.decided_by,
          decided.decision_reason,
        ],
        [
          'rejected',
          'rented',
          employees[2],
          'The tenant withdrew before signing',
        ],
      );
      assert.equal(await status(refused), 'available');
      assert.equal((await trail(refused)).length, 1);
    },
  );
  await check('the refused request does not block the next one', async () => {
    await asUser(0);
    const next = (await db.query(setStatus, [refused, 'rented', null])).rows[0]
      .change;
    assert.equal(next.state, 'pending');
    assert.equal((await trail(refused)).length, 2);
  });

  // ── a record that moved on is refused rather than applied ─────────────────
  await asUser(0);
  const stale = (await db.query(setStatus, [moved, 'sold', null])).rows[0]
    .change;
  await db.query(setStatus, [
    moved,
    'withdrawn',
    'Listing withdrawn by the owner',
  ]);
  await asUser(2);
  await check(
    'an approval refuses when the status moved after the request',
    async () => {
      await fails(decide, [stale.id, true, reason], 'P0029');
      assert.equal(await status(moved), 'withdrawn');
      assert.equal(
        (await trail(moved)).find((row) => row.id === stale.id).state,
        'pending',
      );
    },
  );

  // ── the archived boundary ─────────────────────────────────────────────────
  await asUser(0);
  const onArchived = (await db.query(setStatus, [archived, 'sold', null]))
    .rows[0].change;
  await owner();
  await db.query('update public.properties set archived_at=now() where id=$1', [
    archived,
  ]);
  await asUser(2);
  await check(
    'an archived record refuses approval and records nothing',
    async () => {
      await fails(decide, [onArchived.id, true, reason], 'P0017');
      assert.equal((await trail(archived))[0].state, 'pending');
      await fails(setStatus, [archived, 'available', null], 'P0017');
    },
  );

  // ── the reviewer keeps a direct path ──────────────────────────────────────
  await asUser(3);
  await check(
    'a manager or admin sets sold or rented directly with no case',
    async () => {
      const change = (
        await db.query(setStatus, [direct, 'rented', 'Let from today'])
      ).rows[0].change;
      assert.deepEqual(
        [
          change.origin,
          change.state,
          change.from_status,
          change.to_status,
          change.decided_by,
        ],
        ['direct', 'applied', 'available', 'rented', null],
      );
      assert.equal(change.requested_by, employees[3]);
      assert.equal(await status(direct), 'rented');
      const rows = await trail(direct);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].note, 'Let from today');
    },
  );
  await check(
    'the trail names who asked and who decided, in order',
    async () => {
      const rows = await trail(asked);
      assert.deepEqual(
        rows.map((row) => [
          row.requested_by_name,
          row.state,
          row.decided_by_name,
        ]),
        [['Fixture 0', 'applied', 'Fixture 2']],
      );
    },
  );
  await asUser(2);
  await check(
    'a reviewer reads the pending request of a colleague',
    async () => {
      const pending = await db.query(
        "select property_id,to_status,requested_by_name from public.property_status_changes where state='pending' and property_id=$1",
        [refused],
      );
      assert.deepEqual(
        pending.rows.map((row) => row.to_status),
        ['rented'],
      );
    },
  );
}
