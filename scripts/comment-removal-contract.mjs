import assert from 'node:assert/strict';

// Issue #45 embedded regressions: accountable Property comment removal. Authority,
// mandatory moderation reason, retained evidence, terminal state, stale/replay
// boundaries and the reviewer-only history boundary. Real Auth/Data API/browser
// acceptance stays a staging gate; this proves the database rules the app depends on.
export async function commentRemovalContract({
  db,
  asUser,
  check,
  fails,
  employees,
}) {
  const remove =
    'select public.remove_property_comment($1,$2,$3,$4,$5) as removed';
  const list = 'select * from public.list_property_comments($1,$2,$3,$4)';
  const history =
    'select * from public.list_property_comment_history($1,$2)';
  const post = 'select public.post_property_comment($1,$2,$3) as created';
  const own = async (id) =>
    (
      await db.query(
        'select property_id,author_id,author_name,body,created_at,revision,removed_at,idempotency_key from public.property_comments where id=$1',
        [id],
      )
    ).rows[0];
  const count = async (id) =>
    Number(
      (
        await db.query(
          'select count(*)::int as n from public.property_comments where property_id=$1',
          [id],
        )
      ).rows[0].n,
    );
  const removalRow = async (commentId) =>
    (
      await db.query(
        'select comment_id,property_id,author_id,author_name,body,original_created_at,original_revision,removed_by,removed_actor_name,removal_kind,removal_reason from public.property_comment_removals where comment_id=$1',
        [commentId],
      )
    ).rows[0];
  // Direct fixture/inspection writes: drop both the role and the request claim so the
  // property and employee guards see an owner connection, not an employee session.
  const asAdmin = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  await asAdmin();
  const first = '23000000-0000-4000-8000-000000000001';
  const second = '23000000-0000-4000-8000-000000000002';
  const archived = '23000000-0000-4000-8000-000000000003';
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by,archived_at) values($1,'SGN-RMV-1','sale','available',$2,null),($3,'SGN-RMV-2','sale','available',$2,null),($4,'SGN-RMV-3','sale','available',$2,now())",
    [first, employees[0], second, archived],
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
  const ownComment = '23000000-0000-4000-8000-0000000000a1';
  const colleagueComment = '23000000-0000-4000-8000-0000000000a2';
  const replayComment = '23000000-0000-4000-8000-0000000000a3';
  const middleComment = '23000000-0000-4000-8000-0000000000a4';
  await seed(
    ownComment,
    first,
    employees[1],
    'Bình luận của tác giả',
    '2026-10-02T03:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f1',
  );
  await seed(
    colleagueComment,
    first,
    employees[0],
    'Bình luận của đồng nghiệp',
    '2026-10-02T04:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f2',
  );
  await seed(
    replayComment,
    first,
    employees[1],
    'Nội dung gốc để phát lại',
    '2026-10-02T05:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f3',
  );
  await seed(
    middleComment,
    first,
    employees[0],
    'Bình luận ở giữa',
    '2026-10-02T06:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f4',
  );
  const moderationComment = '23000000-0000-4000-8000-0000000000b1';
  const archivedAuthorComment = '23000000-0000-4000-8000-0000000000c1';
  const archivedManagerComment = '23000000-0000-4000-8000-0000000000c2';
  await seed(
    moderationComment,
    second,
    employees[0],
    'Nội dung cần kiểm duyệt',
    '2026-10-02T03:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f5',
  );
  await seed(
    archivedAuthorComment,
    archived,
    employees[1],
    'Thảo luận lưu trữ của tác giả',
    '2026-10-02T03:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f6',
  );
  await seed(
    archivedManagerComment,
    archived,
    employees[2],
    'Thảo luận lưu trữ của quản lý',
    '2026-10-02T04:00:00.000Z',
    '23000000-0000-4000-8000-0000000000f7',
  );
  const revisionOf = async (id) => (await own(id)).revision;
  const iso = (value) => (value == null ? null : new Date(value).toISOString());
  const before = {
    ownComment: await own(ownComment),
    middleComment: await own(middleComment),
  };
  const propertyFacts = async () =>
    (
      await db.query(
        'select p.*,(select count(*)::int from public.property_contacts where property_id=p.id) as links,(select count(*)::int from public.activity_events where property_id=p.id) as events,(select count(*)::int from public.property_locks where property_id=p.id) as locks,(select count(*)::int from public.correction_requests where property_id=p.id) as corrections,(select count(*)::int from public.property_history where property_id=p.id) as history from public.properties p where p.id=$1',
        [first],
      )
    ).rows[0];

  await check(
    'removal evidence table carries explicit grants, reviewer RLS and one row per comment',
    async () => {
      assert.equal(
        (
          await db.query(
            'select relrowsecurity from pg_class where relname=$1 and relnamespace=$2::regnamespace',
            ['property_comment_removals', 'public'],
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
                [role, 'public.property_comment_removals', privilege],
              )
            ).rows[0].allowed,
            false,
          );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('anon','public.property_comment_removals','SELECT') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
      const columns = (
        await db.query(
          "select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='property_comments' and column_name in ('body','removed_at') order by column_name",
        )
      ).rows;
      assert.deepEqual(columns, [
        { column_name: 'body', is_nullable: 'YES' },
        { column_name: 'removed_at', is_nullable: 'YES' },
      ]);
    },
  );
  await check(
    'removal wrapper stays invoker while the guarded internals stay definer-only',
    async () => {
      const functions = (
        await db.query(
          "select p.proname,p.prosecdef,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('remove_property_comment','list_property_comments') order by p.proname,n.nspname",
        )
      ).rows;
      assert.deepEqual(
        functions.map(
          (row) => `${row.nspname}.${row.proname}:${row.prosecdef}`,
        ),
        [
          'public.list_property_comments:false',
          'private.remove_property_comment:true',
          'public.remove_property_comment:false',
        ],
      );
    },
  );

  let ownRevision;
  await check(
    'an active author removes their own current comment on an unarchived property without a reason',
    async () => {
      ownRevision = await revisionOf(ownComment);
      await asUser(1);
      const removed = (
        await db.query(remove, [first, ownComment, ownRevision, 'author', null])
      ).rows[0].removed;
      assert.equal(removed.id, ownComment);
      assert.equal(removed.body, null);
      assert.equal(removed.author_name, 'Fixture 1');
      assert.equal(iso(removed.created_at), iso(before.ownComment.created_at));
      assert.ok(!Number.isNaN(new Date(removed.removed_at).getTime()));
      assert.notEqual(removed.revision, ownRevision);
      const row = await own(ownComment);
      assert.equal(row.body, null);
      assert.equal(row.author_id, employees[1]);
      assert.equal(row.author_name, 'Fixture 1');
      assert.equal(iso(row.created_at), iso(before.ownComment.created_at));
      assert.notEqual(row.revision, ownRevision);
      await asAdmin();
      const evidence = await removalRow(ownComment);
      assert.equal(evidence.body, 'Bình luận của tác giả');
      assert.equal(evidence.author_id, employees[1]);
      assert.equal(evidence.author_name, 'Fixture 1');
      assert.equal(
        iso(evidence.original_created_at),
        iso(before.ownComment.created_at),
      );
      assert.equal(evidence.original_revision, ownRevision);
      assert.equal(evidence.removed_by, employees[1]);
      assert.equal(evidence.removed_actor_name, 'Fixture 1');
      assert.equal(evidence.removal_kind, 'author');
      assert.equal(evidence.removal_reason, null);
    },
  );
  await check(
    'a removal marker keeps the original posting order and page accounting',
    async () => {
      await asUser(0);
      const rows = (await db.query(list, [first, null, null, 30])).rows;
      assert.deepEqual(
        rows.map((row) => row.id),
        [middleComment, replayComment, colleagueComment, ownComment],
        'removal neither reorders nor adds an entry',
      );
      const marker = rows.at(-1);
      assert.equal(marker.body, null);
      assert.ok(!Number.isNaN(new Date(marker.removed_at).getTime()));
      assert.equal(marker.author_name, 'Fixture 1');
      assert.equal(iso(marker.created_at), iso(before.ownComment.created_at));
      assert.equal(await count(first), 4);
    },
  );
  await check(
    'other employees, including a staff Property editor, cannot remove another author comment',
    async () => {
      await asAdmin();
      const revision = await revisionOf(colleagueComment);
      for (const actor of [1, 2, 3, 5]) {
        await asUser(actor);
        await fails(
          remove,
          [first, colleagueComment, revision, 'author', null],
          '42501',
        );
      }
      for (const actor of [1, 5]) {
        await asUser(actor);
        await fails(
          remove,
          [first, colleagueComment, revision, 'moderation', 'Lý do kiểm duyệt'],
          '42501',
        );
      }
      await asAdmin();
      assert.equal(
        (await own(colleagueComment)).body,
        'Bình luận của đồng nghiệp',
      );
      assert.equal(await removalRow(colleagueComment), undefined);
      assert.equal(await count(first), 4);
    },
  );
  await check(
    'a different author cannot claim authorship of another comment or supply a reason as author',
    async () => {
      const revision = await revisionOf(middleComment);
      await asUser(1);
      await fails(
        remove,
        [first, middleComment, revision, 'author', null],
        '42501',
      );
      await asUser(0);
      await fails(
        remove,
        [first, colleagueComment, revision, 'author', 'Lý do không hợp lệ'],
        '23514',
      );
      await fails(
        remove,
        [first, colleagueComment, revision, 'draft', null],
        '23514',
      );
      await asAdmin();
      assert.equal(await removalRow(colleagueComment), undefined);
    },
  );
  await check(
    'moderation requires a nonblank reason and cannot rewrite author or reason attribution',
    async () => {
      const revision = await revisionOf(moderationComment);
      await asUser(2);
      for (const blank of ['', '   ', '\n\t ', '\u00a0\u2003\ufeff', null]) {
        await fails(
          remove,
          [second, moderationComment, revision, 'moderation', blank],
          '23514',
        );
      }
      await fails(
        remove,
        [second, moderationComment, revision, 'moderation', 'a'.repeat(2001)],
        '23514',
      );
      const removed = (
        await db.query(remove, [
          second,
          moderationComment,
          revision,
          'moderation',
          '  Nội dung nhạy cảm — gỡ theo yêu cầu  ',
        ])
      ).rows[0].removed;
      assert.equal(removed.body, null);
      assert.equal(removed.removed_at !== null, true);
      assert.equal(Object.hasOwn(removed, 'removal_reason'), false);
      const evidence = await removalRow(moderationComment);
      assert.equal(evidence.body, 'Nội dung cần kiểm duyệt');
      assert.equal(
        evidence.author_id,
        employees[0],
        'author is retained, not the moderator',
      );
      assert.equal(evidence.author_name, 'Fixture 0');
      assert.equal(evidence.removed_by, employees[2]);
      assert.equal(evidence.removed_actor_name, 'Fixture 2');
      assert.equal(evidence.removal_kind, 'moderation');
      assert.equal(
        evidence.removal_reason,
        'Nội dung nhạy cảm — gỡ theo yêu cầu',
      );
      assert.equal(evidence.original_revision, revision);
      await asAdmin();
      const directInsert =
        "insert into public.property_comment_removals(comment_id,property_id,author_id,author_name,body,original_created_at,original_revision,removed_by,removed_actor_name,removal_kind,removal_reason) values($1,$2,$3,'Fixture 0','Bình luận của đồng nghiệp',now(),gen_random_uuid(),$4,'Fixture 2','moderation',null)";
      await fails(
        directInsert,
        [colleagueComment, first, employees[0], employees[2]],
        '23514',
      );
      await fails(
        "insert into public.property_comment_removals(comment_id,property_id,author_id,author_name,body,original_created_at,original_revision,removed_by,removed_actor_name,removal_kind,removal_reason) values($1,$2,$3,'Fixture 0','Bình luận của đồng nghiệp',now(),gen_random_uuid(),$4,'Fixture 2','author','Lý do thừa')",
        [colleagueComment, first, employees[0], employees[2]],
        '23514',
      );
      assert.equal(await removalRow(colleagueComment), undefined);
    },
  );
  await check(
    'history distinguishes author withdrawal from moderated removal and keeps absent reasons absent',
    async () => {
      for (const actor of [0, 1, 5]) {
        await asUser(actor);
        await fails(history, [first, ownComment], '42501');
      }
      for (const actor of [2, 3]) {
        await asUser(actor);
        const authorRows = (await db.query(history, [first, ownComment])).rows;
        assert.equal(authorRows.at(-1).event_kind, 'removal');
        assert.equal(authorRows.at(-1).removal_kind, 'author');
        assert.equal(authorRows.at(-1).reason, null);
        const moderationRows = (
          await db.query(history, [second, moderationComment])
        ).rows;
        assert.equal(moderationRows.at(-1).event_kind, 'removal');
        assert.equal(moderationRows.at(-1).removal_kind, 'moderation');
        assert.equal(
          moderationRows.at(-1).reason,
          'Nội dung nhạy cảm — gỡ theo yêu cầu',
        );
      }
    },
  );
  await check(
    'archiving blocks author removal for every role while reasoned moderation still works',
    async () => {
      await asAdmin();
      const authorRevision = await revisionOf(archivedAuthorComment);
      const managerRevision = await revisionOf(archivedManagerComment);
      await asUser(1);
      await fails(
        remove,
        [archived, archivedAuthorComment, authorRevision, 'author', null],
        '42501',
      );
      // The manager authored this comment: acting as author is still blocked on an archived property.
      await asUser(2);
      await fails(
        remove,
        [archived, archivedManagerComment, managerRevision, 'author', null],
        '42501',
      );
      await fails(
        remove,
        [
          archived,
          archivedManagerComment,
          managerRevision,
          'moderation',
          '   ',
        ],
        '23514',
      );
      await asUser(3);
      const removed = (
        await db.query(remove, [
          archived,
          archivedManagerComment,
          managerRevision,
          'moderation',
          'Gỡ nội dung sau khi lưu trữ',
        ])
      ).rows[0].removed;
      assert.equal(removed.body, null);
      await asAdmin();
      assert.equal(
        (await own(archivedAuthorComment)).body,
        'Thảo luận lưu trữ của tác giả',
      );
      assert.equal(
        (await removalRow(archivedManagerComment)).removal_kind,
        'moderation',
      );
    },
  );
  await check(
    'a removed comment is terminal: no second removal, edit, restore or delete',
    async () => {
      await asUser(1);
      await fails(
        remove,
        [first, ownComment, ownRevision, 'author', null],
        'PT409',
      );
      await asUser(2);
      await fails(
        remove,
        [
          first,
          ownComment,
          await revisionOf(ownComment),
          'moderation',
          'Gỡ lần hai',
        ],
        'PT409',
      );
      await asUser(1);
      await fails(
        "update public.property_comments set body='khôi phục' where id=$1",
        [ownComment],
        '42501',
      );
      await fails('delete from public.property_comments where id=$1', [
        ownComment,
      ]);
      await asAdmin();
      const revised = await revisionOf(ownComment);
      await fails(
        "update public.property_comments set body='khôi phục', removed_at=null, revision=gen_random_uuid() where id=$1",
        [ownComment],
        '23514',
      );
      await fails(
        'update public.property_comments set body=$1 where id=$2',
        ['khôi phục', middleComment],
        '23514',
      );
      await fails(
        'delete from public.property_comments where id=$1',
        [ownComment],
        '23514',
      );
      const row = await own(ownComment);
      assert.equal(row.body, null);
      assert.equal(row.revision, revised);
      assert.equal(
        await removalRow(ownComment).then((r) => r.original_revision),
        ownRevision,
      );
    },
  );
  await check(
    'retained removal evidence is immutable and cannot be expired or deleted',
    async () => {
      await asUser(1);
      await fails(
        "insert into public.property_comment_removals(comment_id,property_id,author_id,author_name,body,original_created_at,original_revision,removed_by,removed_actor_name,removal_kind,removal_reason) values($1,$2,$3,'Giả mạo','Giả mạo',now(),gen_random_uuid(),$3,'Giả mạo','moderation','Giả mạo')",
        [colleagueComment, first, employees[1]],
        '42501',
      );
      await fails(
        "update public.property_comment_removals set removal_reason='khác' where comment_id=$1",
        [ownComment],
        '42501',
      );
      await fails(
        'delete from public.property_comment_removals where comment_id=$1',
        [ownComment],
      );
      await asAdmin();
      await fails(
        "update public.property_comment_removals set removal_reason='khác' where comment_id=$1",
        [ownComment],
        '23514',
      );
      await fails(
        'delete from public.property_comment_removals where comment_id=$1',
        [ownComment],
        '23514',
      );
      assert.equal(
        (await removalRow(ownComment)).body,
        'Bình luận của tác giả',
      );
    },
  );
  await check(
    'replaying the original posting key reports the removal marker and never restores the text',
    async () => {
      const revision = await revisionOf(replayComment);
      await asUser(1);
      await db.query(remove, [first, replayComment, revision, 'author', null]);
      const recovered = (
        await db.query(post, [
          first,
          'Nội dung gốc để phát lại',
          '23000000-0000-4000-8000-0000000000f3',
        ])
      ).rows[0].created;
      assert.equal(recovered.id, replayComment);
      assert.equal(recovered.body, null);
      assert.equal(recovered.removed_at !== null, true);
      // Conflicting reuse is still rejected once the original text is only retained evidence.
      await fails(
        post,
        [
          first,
          'Nội dung khác sau khi gỡ',
          '23000000-0000-4000-8000-0000000000f3',
        ],
        '23505',
      );
      assert.equal(await count(first), 4, 'replay creates no new contribution');
      const rows = (await db.query(list, [first, null, null, 30])).rows;
      assert.equal(rows.filter((row) => row.body === null).length, 2);
      // A deliberate replacement with a new key is an ordinary new comment on an unarchived property.
      const replacement = (
        await db.query(post, [
          first,
          'Bình luận thay thế',
          '23000000-0000-4000-8000-0000000000f8',
        ])
      ).rows[0].created;
      assert.notEqual(replacement.id, replayComment);
      assert.equal(replacement.body, 'Bình luận thay thế');
    },
  );
  await check(
    'stale and mismatched removal requests are rejected instead of removing newer text',
    async () => {
      const revision = await revisionOf(colleagueComment);
      await asUser(2);
      await fails(
        remove,
        [
          first,
          colleagueComment,
          '23000000-0000-4000-8000-0000000000ff',
          'moderation',
          'Lý do',
        ],
        'PT409',
      );
      await fails(
        remove,
        [second, colleagueComment, revision, 'moderation', 'Lý do'],
        '23514',
      );
      await fails(
        remove,
        [
          '23000000-0000-4000-8000-00000000ffff',
          colleagueComment,
          revision,
          'moderation',
          'Lý do',
        ],
        '23514',
      );
      await fails(
        remove,
        [
          first,
          '23000000-0000-4000-8000-00000000ffff',
          revision,
          'moderation',
          'Lý do',
        ],
        '23514',
      );
      await fails(
        remove,
        [first, colleagueComment, null, 'moderation', 'Lý do'],
        '23514',
      );
      assert.equal(
        (await own(colleagueComment)).body,
        'Bình luận của đồng nghiệp',
      );
      assert.equal(await removalRow(colleagueComment), undefined);
    },
  );
  await check(
    'ordinary readers and the author cannot recover removed text or reasons through any route',
    async () => {
      for (const actor of [0, 1, 5]) {
        await asUser(actor);
        assert.deepEqual(
          (await db.query('select * from public.property_comment_removals'))
            .rows,
          [],
        );
        assert.deepEqual(
          (
            await db.query(
              'select body from public.property_comments where id=$1',
              [ownComment],
            )
          ).rows,
          [{ body: null }],
        );
        const rows = (await db.query(list, [first, null, null, 30])).rows;
        assert.equal(
          rows.every((row) => row.body === null || !row.removed_at),
          true,
        );
      }
      await asUser(2);
      const reviewerRows = (
        await db.query(
          'select comment_id,body,removal_kind,removal_reason from public.property_comment_removals where comment_id=$1',
          [ownComment],
        )
      ).rows;
      assert.equal(reviewerRows.length, 1);
      assert.equal(reviewerRows[0].body, 'Bình luận của tác giả');
      assert.equal(reviewerRows[0].removal_reason, null);
      await asAdmin();
    },
  );
  await check(
    'deactivation and an unlinked identity remove current authority but retain attribution',
    async () => {
      const revision = await revisionOf(colleagueComment);
      await asUser(4);
      assert.deepEqual(
        (await db.query('select * from public.property_comment_removals')).rows,
        [],
      );
      await fails(
        remove,
        [first, colleagueComment, revision, 'moderation', 'Lý do'],
        '42501',
      );
      await asAdmin();
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[2]],
      );
      await asUser(2);
      assert.deepEqual(
        (await db.query('select * from public.property_comment_removals')).rows,
        [],
      );
      await asAdmin();
      await db.query('update public.employees set is_active=true where id=$1', [
        employees[2],
      ]);
      await asUser('unlinked');
      assert.deepEqual(
        (await db.query('select * from public.property_comment_removals')).rows,
        [],
      );
      await fails(
        remove,
        [first, colleagueComment, revision, 'moderation', 'Lý do'],
        '42501',
      );
      await asAdmin();
      await db.query(
        "update public.employees set display_name='Tên đã đổi' where id=$1",
        [employees[1]],
      );
      const evidence = await removalRow(ownComment);
      assert.equal(evidence.author_name, 'Fixture 1');
      assert.equal(evidence.removed_actor_name, 'Fixture 1');
      assert.equal((await own(ownComment)).author_name, 'Fixture 1');
      await db.query(
        "update public.employees set display_name='Fixture 1' where id=$1",
        [employees[1]],
      );
    },
  );
  await check(
    'removal changes no property facts, contacts, activity, reservations or corrections',
    async () => {
      const factsBefore = await propertyFacts();
      await asAdmin();
      const revision = await revisionOf(colleagueComment);
      await asUser(2);
      await db.query(remove, [
        first,
        colleagueComment,
        revision,
        'moderation',
        'Gỡ nội dung sai',
      ]);
      await asAdmin();
      assert.deepEqual(await propertyFacts(), factsBefore);
      assert.equal(await count(first), 5);
    },
  );
  await asUser(null);
  await check(
    'anonymous identities cannot remove or read retained evidence',
    async () => {
      await fails(
        remove,
        [
          first,
          colleagueComment,
          '23000000-0000-4000-8000-0000000000ff',
          'moderation',
          'Lý do',
        ],
        '42501',
      );
      await fails(
        'select * from public.property_comment_removals',
        [],
        '42501',
      );
    },
  );
  await check(
    'manager and admin retrieve removed text and moderation reasons while staff do not',
    async () => {
      for (const actor of [2, 3]) {
        await asUser(actor);
        const rows = (
          await db.query(
            "select comment_id,body,removal_kind,removal_reason from public.property_comment_removals where removal_kind='moderation' order by comment_id",
          )
        ).rows;
        assert.ok(rows.length >= 2);
        assert.ok(
          rows.every(
            (row) => typeof row.body === 'string' && row.body.length > 0,
          ),
        );
        assert.ok(rows.some((row) => row.removal_reason !== null));
      }
      await asUser(5);
      assert.deepEqual(
        (await db.query('select * from public.property_comment_removals')).rows,
        [],
      );
    },
  );
  await asAdmin();
  return first;
}
