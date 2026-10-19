import assert from 'node:assert/strict';

// Ticket #173 embedded regressions: the property status trail and direct status changes.
// It proves an active employee sets each non-final status with exactly one recorded event,
// the optional note, the archived refusal, the retained read boundary, the recorder on the
// maintenance path and that no completed-sale credit appears. Real Auth/Data API/RLS/browser
// acceptance stays a staging gate.
export async function statusTrailContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const setStatus = 'select public.set_property_status($1,$2,$3) as change';
  const trail = async (property) =>
    (
      await db.query(
        'select id,property_id,from_status,to_status,requested_by,requested_by_name,requested_at,note from public.property_status_changes where property_id=$1 order by requested_at,id',
        [property],
      )
    ).rows;
  const status = async (property) =>
    (
      await db.query(
        'select status,archived_at from public.properties where id=$1',
        [property],
      )
    ).rows[0];
  // The completed-sale report is a reviewer read, so this helper assumes the manager session and
  // the calling check states its own acting role afterwards.
  const completions = async () => {
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
      total: ranking.totalCompletedSales,
      unknown: ranking.unknownAttribution,
    };
  };
  const create = async (code, createdBy) =>
    (
      await db.query(
        "insert into public.properties(property_code,listing_mode,status,created_by) values($1,'sale','available',$2) returning id",
        [code, createdBy],
      )
    ).rows[0].id;

  // Every fixture is created as the owner before any employee session is assumed, so each check
  // starts from the same authority it is testing.
  const own = await create('SGN-STATUS-TRAIL', employees[0]);
  const archived = await create('SGN-STATUS-ARCHIVED', employees[0]);
  const maintained = await create('SGN-STATUS-MAINTENANCE', employees[0]);
  await db.query('update public.properties set archived_at=now() where id=$1', [
    archived,
  ]);

  // ── an active employee records each non-final status ──────────────────────
  await asUser(0);
  await check('an active employee sets every non-final status', async () => {
    const seen = [];
    for (const next of ['negotiating', 'withdrawn', 'draft', 'available']) {
      const before = await trail(own);
      const row = (await db.query(setStatus, [own, next, null])).rows[0].change;
      const after = await trail(own);
      assert.equal(
        after.length,
        before.length + 1,
        `${next} appends one event`,
      );
      assert.deepEqual(
        {
          from: row.from_status,
          to: row.to_status,
          actor: row.requested_by,
          name: row.requested_by_name,
          note: row.note,
        },
        {
          from: before.at(-1)?.to_status ?? 'available',
          to: next,
          actor: employees[0],
          name: 'Fixture 0',
          note: null,
        },
      );
      assert.ok(
        typeof row.requested_at === 'string' && row.requested_at.length > 0,
        'the event states its time',
      );
      seen.push(after.at(-1).to_status);
    }
    assert.deepEqual(seen, ['negotiating', 'withdrawn', 'draft', 'available']);
    assert.equal((await status(own)).status, 'available');
  });
  await check('the trail reads back in the order it happened', async () => {
    const rows = await trail(own);
    assert.deepEqual(
      rows.map((row) => [row.from_status, row.to_status]),
      [
        ['available', 'negotiating'],
        ['negotiating', 'withdrawn'],
        ['withdrawn', 'draft'],
        ['draft', 'available'],
      ],
    );
    assert.ok(
      rows.every(
        (row, index) =>
          index === 0 || row.requested_at >= rows[index - 1].requested_at,
      ),
    );
  });
  await check('a note is stored when given and absent when not', async () => {
    await db.query(setStatus, [
      own,
      'negotiating',
      '  Owner now considering an offer  ',
    ]);
    const withNote = (await trail(own)).at(-1);
    assert.equal(withNote.note, 'Owner now considering an offer');
    const plain = (await db.query(setStatus, [own, 'available', ''])).rows[0]
      .change;
    assert.equal(plain.note, null);
  });
  await check(
    'an unknown or unchanged status is refused without a trail row',
    async () => {
      const before = (await trail(own)).length;
      await fails(setStatus, [own, 'pending', null], '22023');
      await fails(setStatus, [own, 'available', null], 'P0030');
      await fails(setStatus, [own, 'available', 'x'.repeat(501)], '22023');
      assert.equal((await trail(own)).length, before);
    },
  );

  // Sold and rented keep their existing authority: with ticket #174 in place a non-reviewer
  // asking for one raises a request instead, and `status-request-contract.mjs` proves the record
  // does not move. This contract covers the direct statuses only.

  // ── the archived boundary ─────────────────────────────────────────────────
  await check(
    'an archived record refuses a status change and records nothing',
    async () => {
      await fails(
        setStatus,
        [archived, 'withdrawn', 'Called the owner'],
        'P0017',
      );
      assert.deepEqual(await trail(archived), []);
    },
  );
  await check('a missing property is refused as not found', () =>
    fails(
      setStatus,
      ['20000000-0000-4000-8000-00000000ffff', 'withdrawn', null],
      'P0002',
    ),
  );

  // ── authority and the write boundary ──────────────────────────────────────
  await asUser(null);
  await check('anonymous caller refused', () =>
    fails(setStatus, [own, 'withdrawn', null], '42501'),
  );
  await check('anonymous trail read denied', () =>
    fails('select * from public.property_status_changes', [], '42501'),
  );
  await asUser('unlinked');
  await check('unlinked caller refused', () =>
    fails(setStatus, [own, 'withdrawn', null], '42501'),
  );
  await asUser(4);
  await check('inactive employee refused and reads no trail', async () => {
    await fails(setStatus, [own, 'withdrawn', null], '42501');
    assert.equal(
      (await db.query('select * from public.property_status_changes')).rows
        .length,
      0,
    );
  });
  await asUser(1);
  await check(
    'a colleague with property access reads the same trail in order',
    async () => {
      const rows = await trail(own);
      assert.equal(rows.length, 6);
      assert.equal(rows[0].from_status, 'available');
    },
  );
  await asUser(0);
  await check('a browser role writes no trail row directly', async () => {
    await fails(
      "insert into public.property_status_changes(property_id,from_status,to_status,requested_by,requested_by_name) values($1,'available','sold',$2,'Forged')",
      [own, employees[0]],
      '42501',
    );
    const row = (await trail(own))[0];
    await fails(
      "update public.property_status_changes set to_status='sold' where id=$1",
      [row.id],
      '42501',
    );
    await fails(
      'delete from public.property_status_changes where id=$1',
      [row.id],
      '42501',
    );
    assert.equal((await trail(own)).length, 6);
  });

  // ── the maintenance path is recorded too ──────────────────────────────────
  await check(
    'a status change from the maintenance form is recorded on the trail',
    async () => {
      const revision = async (id) =>
        (
          await db.query('select revision from public.properties where id=$1', [
            id,
          ])
        ).rows[0].revision;
      await db.query(
        'select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1))',
        [
          maintained,
          'property',
          maintained,
          await revision(maintained),
          { status: 'negotiating' },
        ],
      );
      assert.equal((await status(maintained)).status, 'negotiating');
      const rows = await trail(maintained);
      assert.equal(rows.length, 1);
      assert.deepEqual(
        [
          rows[0].from_status,
          rows[0].to_status,
          rows[0].requested_by_name,
          rows[0].note,
        ],
        ['available', 'negotiating', 'Fixture 0', null],
      );
    },
  );

  // ── no sale credit appears anywhere ───────────────────────────────────────
  await check(
    'recording a status creates no completed-sale credit',
    async () => {
      const before = await completions();
      await asUser(0);
      await db.query(setStatus, [
        own,
        'withdrawn',
        'Owner withdrew the listing',
      ]);
      assert.deepEqual(await completions(), before);
    },
  );
}
