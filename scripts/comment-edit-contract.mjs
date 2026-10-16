import assert from 'node:assert/strict';

// Issue #46 embedded regressions: author editing with retained revisions. Authority,
// atomic before/after retention, immutable identity/position, stale and no-op refusals,
// posting-key replay against the original submission, reviewer-only prior versions and
// the composed removal/moderation boundary. Real Auth/Data API/browser acceptance stays
// a staging gate; this proves the database rules the application depends on.
export async function commentEditContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const post = 'select public.post_property_comment($1,$2,$3) as created';
  const edit =
    'select public.edit_property_comment($1,$2,$3,$4,gen_random_uuid()) as edited';
  const editWithKey =
    'select public.edit_property_comment($1,$2,$3,$4,$5) as edited';
  const remove =
    'select public.remove_property_comment($1,$2,$3,$4,$5) as removed';
  const list = 'select * from public.list_property_comments($1,$2,$3,$4)';
  const history =
    'select * from public.list_property_comment_history($1,$2)';
  const own = async (id) =>
    (
      await db.query(
        'select property_id,author_id,author_name,body,created_at,revision,removed_at,edited_at,idempotency_key from public.property_comments where id=$1',
        [id],
      )
    ).rows[0];
  const editRows = async (commentId) =>
    (
      await db.query(
        'select edit_key,version,previous_body,body,previous_revision,revision,author_id,author_name,edited_by,edited_actor_name,edited_at from public.property_comment_edits where comment_id=$1 order by version asc',
        [commentId],
      )
    ).rows;
  const count = async (id) =>
    Number(
      (
        await db.query(
          'select count(*)::int as n from public.property_comments where property_id=$1',
          [id],
        )
      ).rows[0].n,
    );
  const editCount = async (commentId) =>
    Number(
      (
        await db.query(
          'select count(*)::int as n from public.property_comment_edits where comment_id=$1',
          [commentId],
        )
      ).rows[0].n,
    );
  // Direct fixture/inspection writes: drop both the role and the request claim so the
  // property and employee guards see an owner connection, not an employee session.
  const asAdmin = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const asUnlinked = async () => {
    await db.exec('reset role');
    await db.query(
      "select set_config('request.jwt.claim.sub',$1,false)",
      ['99999999-9999-4999-8999-999999999999'],
    );
    await db.exec('set role authenticated');
  };
  const iso = (value) => (value == null ? null : new Date(value).toISOString());
  const trim = (value) => value.trim();

  await asAdmin();
  const live = '24000000-0000-4000-8000-000000000001';
  const archived = '24000000-0000-4000-8000-000000000002';
  const other = '24000000-0000-4000-8000-000000000003';
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by,archived_at) values($1,'SGN-EDIT-1','sale','available',$2,null),($3,'SGN-EDIT-2','sale','available',$2,now()),($4,'SGN-EDIT-3','sale','available',$2,null)",
    [live, employees[0], archived, other],
  );
  // Deterministic posting times keep the order assertions independent of wall-clock order.
  const seed = async (id, propertyId, authorId, body, createdAt, key) =>
    db.query(
      'insert into public.property_comments(id,property_id,author_id,author_name,body,created_at,idempotency_key) values($1,$2,$3,$4,$5,$6,$7)',
      [
        id,
        propertyId,
        authorId,
        `Fixture ${employees.indexOf(authorId)}`,
        body,
        createdAt,
        key,
      ],
    );
  const ownComment = '24000000-0000-4000-8000-0000000000a1';
  const colleagueComment = '24000000-0000-4000-8000-0000000000a2';
  const replayComment = '24000000-0000-4000-8000-0000000000a3';
  const oldestComment = '24000000-0000-4000-8000-0000000000a4';
  await seed(
    ownComment,
    live,
    employees[1],
    'Nội dung gốc của tác giả',
    '2026-10-03T03:00:00.000Z',
    '24000000-0000-4000-8000-0000000000f1',
  );
  await seed(
    colleagueComment,
    live,
    employees[0],
    'Bình luận của đồng nghiệp',
    '2026-10-03T04:00:00.000Z',
    '24000000-0000-4000-8000-0000000000f2',
  );
  await seed(
    replayComment,
    live,
    employees[1],
    'Nội dung gốc để phát lại',
    '2026-10-03T05:00:00.000Z',
    '24000000-0000-4000-8000-0000000000f3',
  );
  await seed(
    oldestComment,
    live,
    employees[0],
    'Bình luận cũ nhất',
    '2026-10-03T02:00:00.000Z',
    '24000000-0000-4000-8000-0000000000f4',
  );
  const archivedComment = '24000000-0000-4000-8000-0000000000b1';
  const removedComment = '24000000-0000-4000-8000-0000000000b2';
  await seed(
    archivedComment,
    archived,
    employees[2],
    'Thảo luận lưu trữ của quản lý',
    '2026-10-03T03:00:00.000Z',
    '24000000-0000-4000-8000-0000000000f5',
  );
  await seed(
    removedComment,
    other,
    employees[1],
    'Nội dung sẽ bị gỡ',
    '2026-10-03T03:00:00.000Z',
    '24000000-0000-4000-8000-0000000000f6',
  );
  const revisionOf = async (id) => (await own(id)).revision;
  const propertyFacts = async (id) =>
    (
      await db.query(
        'select p.*,(select count(*)::int from public.property_contacts where property_id=p.id) as links,(select count(*)::int from public.activity_events where property_id=p.id) as events,(select count(*)::int from public.property_locks where property_id=p.id) as locks,(select count(*)::int from public.correction_requests where property_id=p.id) as corrections,(select count(*)::int from public.property_history where property_id=p.id) as history from public.properties p where p.id=$1',
        [id],
      )
    ).rows[0];

  await check(
    'edit evidence table carries explicit grants, reviewer RLS and one row per version',
    async () => {
      assert.equal(
        (
          await db.query(
            'select relrowsecurity from pg_class where relname=$1 and relnamespace=$2::regnamespace',
            ['property_comment_edits', 'public'],
          )
        ).rows[0].relrowsecurity,
        true,
      );
      for (const role of ['anon', 'authenticated'])
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
          assert.equal(
            (
              await db.query(
                'select has_table_privilege($1,$2,$3) as allowed',
                [role, 'public.property_comment_edits', privilege],
              )
            ).rows[0].allowed,
            false,
          );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('anon','public.property_comment_edits','SELECT') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
      assert.ok(
        (
          await db.query(
            'select 1 from pg_indexes where schemaname=$1 and indexname=$2',
            ['public', 'property_comment_edits_comment_id_version_key'],
          )
        ).rows.length,
        'one deterministic row per accepted edit version',
      );
      assert.ok(
        (
          await db.query(
            'select 1 from pg_indexes where schemaname=$1 and indexname=$2',
            ['public', 'property_comment_edits_edited_by_edit_key_key'],
          )
        ).rows.length,
        'one accepted edit operation per employee-scoped key',
      );
      assert.deepEqual(
        (
          await db.query(
            "select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='property_comments' and column_name='edited_at'",
          )
        ).rows,
        [{ column_name: 'edited_at', is_nullable: 'YES' }],
      );
    },
  );
  await check(
    'edit wrapper stays invoker while the guarded internals stay definer-only',
    async () => {
      const functions = (
        await db.query(
          "select p.proname,p.prosecdef,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('edit_property_comment','post_property_comment','list_property_comments','list_property_comment_history') order by p.proname,n.nspname",
        )
      ).rows;
      assert.deepEqual(
        functions.map(
          (row) => `${row.nspname}.${row.proname}:${row.prosecdef}`,
        ),
        [
          'private.edit_property_comment:true',
          'private.list_property_comment_history:false',
          'public.edit_property_comment:false',
          'public.list_property_comment_history:false',
          'public.list_property_comments:false',
          'private.post_property_comment:true',
          'public.post_property_comment:false',
        ],
      );
    },
  );

  let firstRevision;
  let firstEditKey;
  await check(
    'an active author replaces only the live text and retains before/after evidence atomically',
    async () => {
      firstRevision = await revisionOf(ownComment);
      const before = await own(ownComment);
      await asUser(1);
      const edited = (
        await db.query(edit, [
          live,
          ownComment,
          firstRevision,
          '  Nội dung đã sửa\nDòng thứ hai — giữ dấu.  ',
        ])
      ).rows[0].edited;
      assert.equal(edited.id, ownComment);
      assert.equal(
        edited.body,
        'Nội dung đã sửa\nDòng thứ hai — giữ dấu.',
        'trimmed text keeps accents and line breaks',
      );
      assert.equal(edited.author_name, 'Fixture 1');
      assert.equal(iso(edited.created_at), iso(before.created_at));
      assert.notEqual(edited.revision, firstRevision);
      assert.ok(!Number.isNaN(new Date(edited.edited_at).getTime()));
      assert.equal(Object.hasOwn(edited, 'previous_body'), false);
      const row = await own(ownComment);
      assert.equal(row.body, 'Nội dung đã sửa\nDòng thứ hai — giữ dấu.');
      assert.equal(row.author_id, employees[1]);
      assert.equal(row.author_name, 'Fixture 1');
      assert.equal(row.property_id, live);
      assert.equal(row.idempotency_key, before.idempotency_key);
      assert.equal(iso(row.created_at), iso(before.created_at));
      assert.equal(row.removed_at, null);
      assert.notEqual(row.revision, firstRevision);
      await asAdmin();
      const evidence = await editRows(ownComment);
      assert.equal(evidence.length, 1);
      firstEditKey = evidence[0].edit_key;
      assert.match(firstEditKey, /^[0-9a-f-]{36}$/);
      assert.deepEqual(
        {
          version: evidence[0].version,
          previous_body: evidence[0].previous_body,
          body: evidence[0].body,
          previous_revision: evidence[0].previous_revision,
          revision: evidence[0].revision,
          author_id: evidence[0].author_id,
          author_name: evidence[0].author_name,
          edited_by: evidence[0].edited_by,
          edited_actor_name: evidence[0].edited_actor_name,
        },
        {
          version: 1,
          previous_body: 'Nội dung gốc của tác giả',
          body: 'Nội dung đã sửa\nDòng thứ hai — giữ dấu.',
          previous_revision: firstRevision,
          revision: row.revision,
          author_id: employees[1],
          author_name: 'Fixture 1',
          edited_by: employees[1],
          edited_actor_name: 'Fixture 1',
        },
      );
      assert.ok(!Number.isNaN(new Date(evidence[0].edited_at).getTime()));
    },
  );
  await check(
    'an accepted edit key recovers only its operation while a different same-text edit stays stale',
    async () => {
      await asAdmin();
      const current = await own(ownComment);
      await asUser(1);
      const recovered = (
        await db.query(editWithKey, [
          live,
          ownComment,
          firstRevision,
          'Nội dung đã sửa\nDòng thứ hai — giữ dấu.',
          firstEditKey,
        ])
      ).rows[0].edited;
      assert.equal(recovered.id, ownComment);
      assert.equal(recovered.revision, current.revision);
      await fails(
        editWithKey,
        [
          live,
          ownComment,
          firstRevision,
          'Nội dung đã sửa\nDòng thứ hai — giữ dấu.',
          '24000000-0000-4000-8000-0000000000d1',
        ],
        'PT409',
      );
      await fails(
        editWithKey,
        [
          live,
          ownComment,
          firstRevision,
          'Dùng lại khóa cho nội dung khác',
          firstEditKey,
        ],
        '23505',
      );
      await asAdmin();
      assert.equal(await editCount(ownComment), 1);
      assert.equal(
        (await own(ownComment)).body,
        'Nội dung đã sửa\nDòng thứ hai — giữ dấu.',
      );
    },
  );
  await check(
    'an edit keeps comment identity, position and page accounting while exposing only the marker',
    async () => {
      await asUser(0);
      const rows = (await db.query(list, [live, null, null, 30])).rows;
      assert.deepEqual(
        rows.map((row) => row.id),
        [replayComment, colleagueComment, ownComment, oldestComment],
        'newest-first posting position is unchanged',
      );
      const entry = rows.find((row) => row.id === ownComment);
      assert.equal(entry.body, 'Nội dung đã sửa\nDòng thứ hai — giữ dấu.');
      assert.ok(!Number.isNaN(new Date(entry.edited_at).getTime()));
      assert.equal(
        Object.hasOwn(entry, 'previous_body'),
        false,
        'no preceding version appears in the read projection',
      );
      assert.equal(await count(live), 4, 'an edit adds no contribution');
    },
  );
  await check(
    'other employees, a staff Property editor and manager/admin cannot rewrite another author comment',
    async () => {
      await asAdmin();
      const revision = await revisionOf(colleagueComment);
      // Employee 0 authored this comment, so every other active role is a non-author here.
      for (const actor of [1, 2, 3, 5]) {
        await asUser(actor);
        await fails(
          edit,
          [live, colleagueComment, revision, `Thử sửa bởi ${actor}`],
          '42501',
        );
      }
      await asAdmin();
      assert.equal(
        (await own(colleagueComment)).body,
        'Bình luận của đồng nghiệp',
      );
      assert.equal(await editCount(colleagueComment), 0);
    },
  );
  await check(
    'archiving blocks the author while non-authors and unknown targets stay indistinguishable',
    async () => {
      await asAdmin();
      const revision = await revisionOf(archivedComment);
      for (const actor of [1, 3, 5]) {
        await asUser(actor);
        await fails(
          edit,
          [archived, archivedComment, revision, `Sửa lưu trữ ${actor}`],
          '42501',
        );
      }
      await asUser(2);
      await fails(
        edit,
        [archived, archivedComment, revision, 'Tác giả sửa trên hồ sơ lưu trữ'],
        'PT403',
      );
      await asUser(1);
      for (const property of [archived, live]) {
        await fails(
          edit,
          [
            property,
            '24000000-0000-4000-8000-00000000dead',
            revision,
            'Không lộ bình luận không tồn tại',
          ],
          '23514',
        );
      }
      await asAdmin();
      assert.equal(
        (await own(archivedComment)).body,
        'Thảo luận lưu trữ của quản lý',
      );
      assert.equal(await editCount(archivedComment), 0);
    },
  );
  await check(
    'a removed comment cannot be edited and its withdrawal evidence survives an edit attempt',
    async () => {
      await asAdmin();
      const revision = await revisionOf(removedComment);
      await asUser(1);
      await db.query(remove, [other, removedComment, revision, 'author', null]);
      await fails(
        edit,
        [
          other,
          removedComment,
          await revisionOf(removedComment),
          'Sửa sau khi gỡ',
        ],
        'PT409',
      );
      await asAdmin();
      assert.equal((await own(removedComment)).body, null);
      assert.equal(await editCount(removedComment), 0);
      assert.equal(
        (
          await db.query(
            'select body from public.property_comment_removals where comment_id=$1',
            [removedComment],
          )
        ).rows[0].body,
        'Nội dung sẽ bị gỡ',
      );
    },
  );
  await check(
    'stale and no-op saves are refused without changing text, revision or evidence',
    async () => {
      await asAdmin();
      const revision = await revisionOf(ownComment);
      await asUser(1);
      await fails(
        edit,
        [
          live,
          ownComment,
          '24000000-0000-4000-8000-0000000000ff',
          'Sửa sai phiên bản',
        ],
        'PT409',
      );
      await fails(
        edit,
        [
          live,
          ownComment,
          revision,
          'Nội dung đã sửa\nDòng thứ hai — giữ dấu.',
        ],
        'PT400',
      );
      await asAdmin();
      const row = await own(ownComment);
      assert.equal(row.body, 'Nội dung đã sửa\nDòng thứ hai — giữ dấu.');
      assert.equal(row.revision, revision);
      assert.equal(await editCount(ownComment), 1);
    },
  );
  await check(
    'text validation, unknown targets and a mismatched property leave the comment unchanged',
    async () => {
      await asAdmin();
      const revision = await revisionOf(replayComment);
      await asUser(1);
      for (const bad of [
        '',
        '   ',
        '\n\t ',
        '\u00a0\u2003\ufeff',
        'a'.repeat(2001),
      ])
        await fails(edit, [live, replayComment, revision, bad], '23514');
      await fails(edit, [live, replayComment, revision, null], '23514');
      await fails(
        edit,
        [
          live,
          '24000000-0000-4000-8000-00000000ffff',
          revision,
          'Không tồn tại',
        ],
        '23514',
      );
      await fails(
        edit,
        [other, replayComment, revision, 'Sai bất động sản'],
        '23514',
      );
      await fails(edit, [null, replayComment, revision, 'Thiếu'], '23514');
      await fails(
        editWithKey,
        [live, replayComment, revision, 'Thiếu khóa', null],
        '23514',
      );
      assert.deepEqual(
        await db
          .query('select body from public.property_comments where id=$1', [
            replayComment,
          ])
          .then((result) => result.rows),
        [{ body: 'Nội dung gốc để phát lại' }],
      );
      // 2000 characters and a deliberate revert to an earlier version are both accepted.
      const boundary = 'ế'.repeat(2000);
      await db.query(edit, [live, replayComment, revision, boundary]);
      await asAdmin();
      assert.equal((await own(replayComment)).body, boundary);
      assert.equal(await editCount(replayComment), 1);
    },
  );
  await check(
    'every saved version is retained in edit order with the original at the earliest version',
    async () => {
      await asAdmin();
      const revision = await revisionOf(replayComment);
      await asUser(1);
      await db.query(edit, [
        live,
        replayComment,
        revision,
        'Phiên bản thứ hai',
      ]);
      await asAdmin();
      const secondRevision = await revisionOf(replayComment);
      await asUser(1);
      // A deliberate revert is a new retained version, never a rewrite of history.
      await db.query(edit, [
        live,
        replayComment,
        secondRevision,
        'ế'.repeat(2000),
      ]);
      await asAdmin();
      const evidence = await editRows(replayComment);
      assert.deepEqual(
        evidence.map((row) => ({
          version: row.version,
          previous_body: trim(row.previous_body),
          body: trim(row.body),
        })),
        [
          {
            version: 1,
            previous_body: 'Nội dung gốc để phát lại',
            body: 'ế'.repeat(2000),
          },
          {
            version: 2,
            previous_body: 'ế'.repeat(2000),
            body: 'Phiên bản thứ hai',
          },
          {
            version: 3,
            previous_body: 'Phiên bản thứ hai',
            body: 'ế'.repeat(2000),
          },
        ],
        'versions stay ordered and gap-free with no automatic expiry',
      );
      assert.equal((await own(replayComment)).body, 'ế'.repeat(2000));
      assert.equal(
        iso((await own(replayComment)).created_at),
        '2026-10-03T05:00:00.000Z',
      );
    },
  );
  await check(
    'posting-key replay after edits converges on the original submission, not the latest text',
    async () => {
      // The comment now carries edited text; its original submission was the seeded text.
      await asUser(1);
      const recovered = (
        await db.query(post, [
          live,
          'Nội dung gốc để phát lại',
          '24000000-0000-4000-8000-0000000000f3',
        ])
      ).rows[0].created;
      assert.equal(recovered.id, replayComment);
      assert.equal(
        recovered.body,
        'ế'.repeat(2000),
        'recovery reports the current committed text',
      );
      assert.ok(
        !Number.isNaN(new Date(recovered.edited_at).getTime()),
        'recovery reports the edited marker',
      );
      await fails(
        post,
        [live, 'Phiên bản thứ hai', '24000000-0000-4000-8000-0000000000f3'],
        '23505',
        'the latest edited text is not the retained original submission',
      );
      await fails(
        post,
        [
          other,
          'Nội dung gốc để phát lại',
          '24000000-0000-4000-8000-0000000000f3',
        ],
        '23505',
      );
      assert.equal(await count(live), 4, 'replay creates no new contribution');
    },
  );
  await check(
    'a post-recovery key still refuses conflicting reuse after a removal',
    async () => {
      await asAdmin();
      const revision = await revisionOf(oldestComment);
      await asUser(0);
      await db.query(edit, [live, oldestComment, revision, 'Bản đã sửa']);
      await asAdmin();
      const editedRevision = await revisionOf(oldestComment);
      await asUser(0);
      const removed = (
        await db.query(remove, [
          live,
          oldestComment,
          editedRevision,
          'author',
          null,
        ])
      ).rows[0].removed;
      assert.equal(
        Object.hasOwn(removed, 'edited_at'),
        true,
        'the removal projection also carries the edited marker',
      );
      assert.ok(
        !Number.isNaN(new Date(removed.edited_at).getTime()),
        'an edited-then-removed comment keeps its edit time in the projection',
      );
      const recovered = (
        await db.query(post, [
          live,
          'Bình luận cũ nhất',
          '24000000-0000-4000-8000-0000000000f4',
        ])
      ).rows[0].created;
      assert.equal(recovered.id, oldestComment);
      assert.equal(recovered.body, null);
      assert.equal(recovered.removed_at !== null, true);
      await fails(
        post,
        [live, 'Bản đã sửa', '24000000-0000-4000-8000-0000000000f4'],
        '23505',
        'the edited text is not the retained original submission',
      );
      const marker = (await db.query(list, [live, null, null, 30])).rows.find(
        (row) => row.id === oldestComment,
      );
      assert.equal(marker.body, null);
      assert.equal(marker.removed_at !== null, true);
    },
  );
  await check(
    'prior versions are reviewer-only, and deactivation never erases them',
    async () => {
      for (const actor of [0, 1, 5]) {
        await asUser(actor);
        assert.deepEqual(
          (await db.query('select * from public.property_comment_edits')).rows,
          [],
        );
        const rows = (await db.query(list, [live, null, null, 30])).rows;
        assert.equal(
          rows.every((row) => !Object.hasOwn(row, 'previous_body')),
          true,
        );
      }
      for (const actor of [2, 3]) {
        await asUser(actor);
        const rows = (
          await db.query(
            'select comment_id,version,previous_body,body from public.property_comment_edits where comment_id=$1 order by version',
            [replayComment],
          )
        ).rows;
        assert.equal(rows.length, 3, `reviewer ${actor} reads every version`);
        assert.equal(rows[0].previous_body, 'Nội dung gốc để phát lại');
      }
      await asAdmin();
      // Read the revision while the author still has access; a deactivated identity cannot.
      const ownRevision = await revisionOf(ownComment);
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[1]],
      );
      await asUser(1);
      await fails(
        edit,
        [live, ownComment, ownRevision, 'Sau khi bị tắt'],
        '42501',
      );
      await asAdmin();
      assert.equal(
        await editCount(replayComment),
        3,
        'versions survive deactivation',
      );
      assert.equal(await editCount(ownComment), 1);
      await db.query('update public.employees set is_active=true where id=$1', [
        employees[1],
      ]);
      // A later display-name change never rewrites the retained edit attribution.
      await db.query(
        "update public.employees set display_name='Tên đã đổi' where id=$1",
        [employees[1]],
      );
      const evidence = await editRows(ownComment);
      assert.equal(evidence[0].author_name, 'Fixture 1');
      assert.equal(evidence[0].edited_actor_name, 'Fixture 1');
      assert.equal((await own(ownComment)).author_name, 'Fixture 1');
      await db.query(
        "update public.employees set display_name='Fixture 1' where id=$1",
        [employees[1]],
      );
    },
  );
  await check(
    'retained edit evidence and originals are immune to direct writes and direct transitions',
    async () => {
      await asUser(1);
      await fails(
        "insert into public.property_comment_edits(comment_id,property_id,author_id,author_name,edited_by,edited_actor_name,version,previous_body,body,previous_revision,revision) values($1,$2,$3,'Forged',$3,'Forged',1,'Giả mạo','Giả mạo',gen_random_uuid(),gen_random_uuid())",
        [ownComment, live, employees[1]],
        '42501',
      );
      await fails(
        "update public.property_comments set body='viết lại' where id=$1",
        [ownComment],
        '42501',
      );
      await fails('delete from public.property_comments where id=$1', [
        ownComment,
      ]);
      await asAdmin();
      await fails(
        "update public.property_comment_edits set body='khác' where comment_id=$1",
        [ownComment],
        '23514',
      );
      await fails(
        'delete from public.property_comment_edits where comment_id=$1',
        [ownComment],
      );
      // The owner connection cannot forge a transition that skips the edit marker or the
      // identity fields either.
      await fails(
        "update public.property_comments set body='thiếu mốc' where id=$1",
        [ownComment],
        '23514',
      );
      await fails(
        "update public.property_comments set edited_at=now(), body='đổi bất động sản', property_id=$1 where id=$2",
        [other, ownComment],
        '23514',
      );
      await fails(
        "update public.property_comments set edited_at=now(), body='đổi tác giả', author_id=$1 where id=$2",
        [employees[0], ownComment],
        '23514',
      );
      await fails(
        "update public.property_comments set edited_at=now() - interval '1 day', body='lùi mốc' where id=$1",
        [ownComment],
        '23514',
      );
      const row = await own(ownComment);
      assert.equal(row.body, 'Nội dung đã sửa\nDòng thứ hai — giữ dấu.');
      assert.equal(await editCount(ownComment), 1);
    },
  );
  await check(
    'editing changes no property facts, contacts, activity, reservations or corrections',
    async () => {
      const factsBefore = await propertyFacts(live);
      await asAdmin();
      const revision = await revisionOf(ownComment);
      await asUser(1);
      await db.query(edit, [
        live,
        ownComment,
        revision,
        'Kiểm tra không đổi dữ liệu',
      ]);
      await asAdmin();
      assert.deepEqual(await propertyFacts(live), factsBefore);
      assert.equal(await count(live), 4);
    },
  );
  await asUser(null);
  await check(
    'anonymous identities cannot edit or read prior versions',
    async () => {
      await fails(
        edit,
        [live, ownComment, '24000000-0000-4000-8000-0000000000ff', 'Ẩn danh'],
        '42501',
      );
      await fails('select * from public.property_comment_edits', [], '42501');
    },
  );
  await asUser(4);
  await check(
    'an inactive identity reaches neither edits nor evidence',
    async () => {
      assert.deepEqual(
        (await db.query('select * from public.property_comment_edits')).rows,
        [],
      );
      await fails(
        edit,
        [
          live,
          ownComment,
          '24000000-0000-4000-8000-0000000000ff',
          'Không hoạt động',
        ],
        '42501',
      );
    },
  );
  await check(
    'reviewer history returns complete ordered edits and author removal evidence while ordinary readers get no payload',
    async () => {
      for (const actor of [0, 1, 4, 5]) {
        await asUser(actor);
        await fails(history, [live, replayComment], '42501');
      }
      await asUnlinked();
      assert.deepEqual(
        (await db.query('select * from public.property_comment_edits')).rows,
        [],
      );
      await fails(history, [live, replayComment], '42501');
      for (const actor of [2, 3]) {
        await asUser(actor);
        const rows = (await db.query(history, [live, replayComment])).rows;
        assert.equal(rows.length, 4);
        assert.deepEqual(
          rows.map((row) => [row.event_kind, row.version]),
          [
            ['posting', 0],
            ['edit', 1],
            ['edit', 2],
            ['edit', 3],
          ],
        );
        assert.equal(rows[0].body, 'Nội dung gốc để phát lại');
        assert.equal(rows[3].body, 'ế'.repeat(2000));
        assert.equal(rows.every((row) => row.removal_kind === null), true);
        assert.equal(rows.every((row) => row.reason === null), true);
        assert.equal(rows.every((row) => row.has_more === false), true);
        const removed = (await db.query(history, [live, oldestComment])).rows;
        assert.equal(removed.at(-1).event_kind, 'removal');
        assert.equal(removed.at(-1).removal_kind, 'author');
        assert.equal(removed.at(-1).reason, null);
      }
    },
  );
  await check(
    'history SQL bounds an over-window comment and reports retained events beyond it',
    async () => {
      await asUser(1);
      const bounded = (
        await db.query(post, [
          live,
          'Bounded original',
          '24000000-0000-4000-8000-0000000000c1',
        ])
      ).rows[0].created;
      let revision = bounded.revision;
      for (let version = 1; version <= 64; version++) {
        const key =
          '24000000-0000-4000-8000-' + version.toString(16).padStart(12, '0');
        const edited = (
          await db.query(editWithKey, [
            live,
            bounded.id,
            revision,
            `Bounded version ${version}`,
            key,
          ])
        ).rows[0].edited;
        revision = edited.revision;
      }
      await asUser(2);
      const rows = (await db.query(history, [live, bounded.id])).rows;
      assert.equal(rows.length, 64);
      assert.equal(rows[0].event_kind, 'posting');
      assert.equal(rows[0].body, 'Bounded original');
      assert.equal(rows.at(-1).version, 63);
      assert.equal(rows.at(-1).has_more, true);
      assert.equal(await editCount(bounded.id), 64);
    },
  );
  await asAdmin();
  return live;
}
