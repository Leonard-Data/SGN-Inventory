import assert from 'node:assert/strict';

// Issue #44 embedded regressions: shared Property discussion role, validation,
// atomicity, retry and paging invariants. Real Auth/Data API/browser acceptance
// stays a staging gate; this proves the database rules the app depends on.
export async function commentsContract({
  db,
  asUser,
  check,
  fails,
  employees,
  property,
}) {
  const post = 'select public.post_property_comment($1,$2,$3) as created';
  const list = 'select * from public.list_property_comments($1,$2,$3,$4)';
  // Default-arguments call: the route relies on PostgREST supplying defaults the same way.
  const listDefaults = 'select * from public.list_property_comments($1)';
  const own = async (id) =>
    (
      await db.query(
        'select property_id,author_id,author_name,body,created_at,revision,idempotency_key from public.property_comments where id=$1',
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

  // Direct fixture/inspection writes: drop both the role and the request claim so the
  // property and employee guards see an owner connection, not an employee session.
  const asAdmin = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  await asAdmin();
  const colleagueProperty = '21000000-0000-4000-8000-000000000001';
  const secondProperty = '21000000-0000-4000-8000-000000000002';
  const archivedProperty = '21000000-0000-4000-8000-000000000003';
  const pagedProperty = '21000000-0000-4000-8000-000000000004';
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by,archived_at) values($1,'SGN-CMT-1','sale','available',$2,null),($3,'SGN-CMT-2','sale','available',$2,null),($4,'SGN-CMT-3','sale','available',$2,now()),($5,'SGN-CMT-4','sale','available',$2,null)",
    [
      colleagueProperty,
      employees[0],
      secondProperty,
      archivedProperty,
      pagedProperty,
    ],
  );
  const archivedSeedId = '21000000-0000-4000-8000-0000000000f1';
  await db.query(
    "insert into public.property_comments(id,property_id,author_id,author_name,body,idempotency_key) values($1,$2,$3,'Fixture 0','Thảo luận lưu trữ',gen_random_uuid())",
    [archivedSeedId, archivedProperty, employees[0]],
  );
  await db.query(
    "insert into public.property_comments(property_id,author_id,author_name,body,created_at,idempotency_key) select $1,$2,'Fixture 0','Bình luận '||g,timestamptz '2026-10-01 03:00:00+00',gen_random_uuid() from generate_series(1,45) g",
    [pagedProperty, employees[0]],
  );

  await check(
    'new exposed table carries explicit grants, RLS and both paging/retry indexes',
    async () => {
      assert.equal(
        (
          await db.query(
            'select relrowsecurity from pg_class where relname=$1 and relnamespace=$2::regnamespace',
            ['property_comments', 'public'],
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
                [role, 'public.property_comments', privilege],
              )
            ).rows[0].allowed,
            false,
          );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('anon','public.property_comments','SELECT') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
      for (const index of [
        'property_comments_page_idx',
        'property_comments_author_id_idempotency_key_key',
      ])
        assert.ok(
          (
            await db.query(
              'select 1 from pg_indexes where schemaname=$1 and indexname=$2',
              ['public', index],
            )
          ).rows.length,
          index,
        );
    },
  );
  await check(
    'public wrappers are invoker functions and the guarded internals stay definer-only',
    async () => {
      const functions = (
        await db.query(
          "select p.proname,p.prosecdef,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('post_property_comment','list_property_comments') order by p.proname,n.nspname",
        )
      ).rows;
      assert.deepEqual(
        functions.map(
          (row) => `${row.nspname}.${row.proname}:${row.prosecdef}`,
        ),
        [
          'public.list_property_comments:false',
          'private.post_property_comment:true',
          'public.post_property_comment:false',
        ],
      );
    },
  );

  let firstId, firstRevision, firstCreatedAt;
  await check(
    'colleague without property edit authority reads and posts on another employee property',
    async () => {
      await asUser(1);
      const created = (
        await db.query(post, [
          colleagueProperty,
          '  Chào anh,\nGiá 12 tỷ — còn thương lượng.  ',
          '21000000-0000-4000-8000-000000000101',
        ])
      ).rows[0].created;
      firstId = created.id;
      firstRevision = created.revision;
      firstCreatedAt = created.created_at;
      assert.match(created.id, /^[0-9a-f-]{36}$/);
      assert.match(created.revision, /^[0-9a-f-]{36}$/);
      assert.equal(created.author_id, employees[1]);
      assert.equal(created.author_name, 'Fixture 1');
      assert.equal(created.body, 'Chào anh,\nGiá 12 tỷ — còn thương lượng.');
      const rows = (await db.query(listDefaults, [colleagueProperty])).rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].body, created.body);
      // The same identity through a plain Data API read, still under RLS.
      assert.equal(
        (
          await db.query(
            'select id from public.property_comments where id=$1',
            [firstId],
          )
        ).rows.length,
        1,
      );
      await fails(
        "update public.properties set notes='unauthorized' where id=$1 returning id",
        [colleagueProperty],
        '42501',
      );
      const unaffected = await own(firstId);
      assert.equal(unaffected.property_id, colleagueProperty);
      assert.equal(unaffected.author_id, employees[1]);
      assert.equal(unaffected.author_name, 'Fixture 1');
    },
  );
  await check(
    'posting changes no property facts, contacts, activity, reservations or corrections',
    async () => {
      await asAdmin();
      const before = (
        await db.query(
          'select p.*,(select count(*)::int from public.property_contacts where property_id=p.id) as links,(select count(*)::int from public.activity_events where property_id=p.id) as events,(select count(*)::int from public.property_locks where property_id=p.id) as locks,(select count(*)::int from public.correction_requests where property_id=p.id) as corrections,(select count(*)::int from public.property_history where property_id=p.id) as history from public.properties p where p.id=$1',
          [colleagueProperty],
        )
      ).rows[0];
      await asUser(1);
      await db.query(post, [
        colleagueProperty,
        'Kiểm tra không đổi dữ liệu bất động sản',
        '21000000-0000-4000-8000-000000000102',
      ]);
      await asAdmin();
      const after = (
        await db.query(
          'select p.*,(select count(*)::int from public.property_contacts where property_id=p.id) as links,(select count(*)::int from public.activity_events where property_id=p.id) as events,(select count(*)::int from public.property_locks where property_id=p.id) as locks,(select count(*)::int from public.correction_requests where property_id=p.id) as corrections,(select count(*)::int from public.property_history where property_id=p.id) as history from public.properties p where p.id=$1',
          [colleagueProperty],
        )
      ).rows[0];
      assert.deepEqual(after, before);
      assert.equal(await count(colleagueProperty), 2);
    },
  );

  await check(
    'blank and over-limit text is rejected at the database boundary while 2000 characters pass',
    async () => {
      await asUser(1);
      for (const blank of [
        '',
        '   ',
        '\n\t ',
        '\u00a0\u2003\ufeff',
        `${'a'.repeat(2001)}`,
      ])
        await fails(
          post,
          [colleagueProperty, blank, '21000000-0000-4000-8000-000000000200'],
          '23514',
        );
      await fails(
        post,
        [colleagueProperty, null, '21000000-0000-4000-8000-000000000201'],
        '23514',
      );
      await fails(post, [colleagueProperty, 'Thiếu khóa gửi', null], '23514');
      assert.equal(
        (
          await db.query(
            'select 1 from public.property_comments where author_id=$1 and idempotency_key=$2',
            [employees[1], '21000000-0000-4000-8000-000000000200'],
          )
        ).rows.length,
        0,
      );
      const boundary = 'ế'.repeat(2000);
      const accepted = (
        await db.query(post, [
          secondProperty,
          boundary,
          '21000000-0000-4000-8000-000000000203',
        ])
      ).rows[0].created;
      assert.equal((await own(accepted.id)).body, boundary);
    },
  );

  await check(
    'submission key is employee-scoped and retries converge on one original comment',
    async () => {
      await asUser(1);
      const key = '21000000-0000-4000-8000-000000000300';
      const body = 'Khách đã xem nhà\nHẹn thứ Bảy';
      const created = (await db.query(post, [colleagueProperty, body, key]))
        .rows[0].created;
      // Same key, same property, text that trims to the same value: one identity.
      const retried = (
        await db.query(post, [colleagueProperty, `  ${body}  `, key])
      ).rows[0].created;
      assert.equal(retried.id, created.id);
      assert.equal(retried.created_at, created.created_at);
      assert.equal(retried.revision, created.revision);
      assert.equal(
        (
          await db.query(
            'select count(*)::int as n from public.property_comments where author_id=$1 and idempotency_key=$2',
            [employees[1], key],
          )
        ).rows[0].n,
        1,
      );
      await fails(
        post,
        [colleagueProperty, 'Nội dung khác hoàn toàn', key],
        '23505',
      );
      await fails(post, [secondProperty, body, key], '23505');
      const other = (
        await db.query(post, [
          secondProperty,
          body,
          '21000000-0000-4000-8000-000000000301',
        ])
      ).rows[0].created;
      assert.notEqual(other.id, created.id);
      // The same key value is a different employee's submission.
      await asUser(0);
      const byColleague = (await db.query(post, [secondProperty, body, key]))
        .rows[0].created;
      assert.notEqual(byColleague.id, other.id);
      assert.equal(byColleague.author_id, employees[0]);
      assert.equal(await count(colleagueProperty), 3);
    },
  );

  await check(
    'recovery rechecks live access and archive state instead of returning a removed route',
    async () => {
      const key = '21000000-0000-4000-8000-000000000400';
      await asUser(1);
      const created = (
        await db.query(post, [colleagueProperty, 'Bình luận để khôi phục', key])
      ).rows[0].created;
      await asAdmin();
      await db.query(
        'update public.properties set archived_at=now() where id=$1',
        [colleagueProperty],
      );
      await asUser(1);
      await fails(
        post,
        [colleagueProperty, 'Bình luận để khôi phục', key],
        '42501',
      );
      await asAdmin();
      await db.query(
        'update public.properties set archived_at=null where id=$1',
        [colleagueProperty],
      );
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[1]],
      );
      await asUser(1);
      await fails(
        post,
        [colleagueProperty, 'Bình luận để khôi phục', key],
        '42501',
      );
      await asAdmin();
      await db.query('update public.employees set is_active=true where id=$1', [
        employees[1],
      ]);
      await asUser(1);
      assert.equal(
        (
          await db.query(post, [
            colleagueProperty,
            'Bình luận để khôi phục',
            key,
          ])
        ).rows[0].created.id,
        created.id,
      );
      assert.equal(await count(colleagueProperty), 4);
    },
  );

  await check(
    'originals are protected from ordinary clients and from every mutation route',
    async () => {
      await asUser(1);
      await fails(
        "insert into public.property_comments(property_id,author_id,author_name,body,idempotency_key) values($1,$2,'Forged','Giả mạo',gen_random_uuid())",
        [colleagueProperty, employees[1]],
        '42501',
      );
      await fails(
        "update public.property_comments set body='rewritten' where id=$1",
        [firstId],
        '42501',
      );
      await fails('delete from public.property_comments where id=$1', [
        firstId,
      ]);
      await asAdmin();
      await fails(
        "update public.property_comments set body='rewritten' where id=$1",
        [firstId],
        '23514',
      );
      await fails(
        'update public.property_comments set property_id=$1 where id=$2',
        [secondProperty, firstId],
        '23514',
      );
      await fails(
        'delete from public.property_comments where id=$1',
        [firstId],
        '23514',
      );
      const row = await own(firstId);
      assert.equal(row.body, 'Chào anh,\nGiá 12 tỷ — còn thương lượng.');
      assert.equal(row.author_name, 'Fixture 1');
      assert.equal(row.revision, firstRevision);
    },
  );

  await check(
    'retained attribution survives a later display-name change',
    async () => {
      await asAdmin();
      await db.query(
        "update public.employees set display_name='Tên mới' where id=$1",
        [employees[1]],
      );
      await asUser(1);
      const created = (
        await db.query(post, [
          secondProperty,
          'Sau khi đổi tên hiển thị',
          '21000000-0000-4000-8000-000000000500',
        ])
      ).rows[0].created;
      assert.equal(created.author_name, 'Tên mới');
      assert.equal((await own(firstId)).author_name, 'Fixture 1');
      await asAdmin();
      await db.query(
        "update public.employees set display_name='Fixture 1' where id=$1",
        [employees[1]],
      );
    },
  );

  await asUser(null);
  await check(
    'anonymous identities cannot read or post discussion',
    async () => {
      await fails('select * from public.property_comments', [], '42501');
      await fails(list, [colleagueProperty, null, null, 30], '42501');
      await fails(
        post,
        [colleagueProperty, 'Ẩn danh', '21000000-0000-4000-8000-000000000600'],
        '42501',
      );
    },
  );
  await asUser(4);
  await check(
    'inactive identities and their previously issued sessions reach nothing',
    async () => {
      assert.deepEqual(
        (await db.query('select * from public.property_comments')).rows,
        [],
      );
      assert.deepEqual(
        (await db.query(list, [colleagueProperty, null, null, 30])).rows,
        [],
      );
      await fails(
        post,
        [
          colleagueProperty,
          'Không hoạt động',
          '21000000-0000-4000-8000-000000000601',
        ],
        '42501',
      );
    },
  );
  await asUser(1);
  await check(
    'existing token loses discussion access immediately after deactivation',
    async () => {
      assert.ok(
        (await db.query(list, [colleagueProperty, null, null, 30])).rows
          .length > 0,
      );
      await asAdmin();
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[1]],
      );
      await db.exec('set role authenticated');
      assert.deepEqual(
        (await db.query(list, [colleagueProperty, null, null, 30])).rows,
        [],
      );
      await fails(
        post,
        [
          colleagueProperty,
          'Sau khi bị tắt',
          '21000000-0000-4000-8000-000000000602',
        ],
        '42501',
      );
      await asAdmin();
      await db.query('update public.employees set is_active=true where id=$1', [
        employees[1],
      ]);
    },
  );

  await asUser(2);
  await check('manager and admin read archived discussion', async () => {
    for (const actor of [2, 3]) {
      await asUser(actor);
      const rows = (await db.query(list, [archivedProperty, null, null, 30]))
        .rows;
      assert.equal(rows.length, 1);
      assert.equal(rows[0].body, 'Thảo luận lưu trữ');
    }
  });
  await check(
    'ordinary employees cannot read archived discussion and nobody can post to it',
    async () => {
      for (const actor of [0, 1, 5]) {
        await asUser(actor);
        assert.deepEqual(
          (await db.query(list, [archivedProperty, null, null, 30])).rows,
          [],
        );
        assert.deepEqual(
          await db
            .query(
              'select * from public.property_comments where property_id=$1',
              [archivedProperty],
            )
            .then((result) => result.rows),
          [],
        );
      }
      for (const actor of [0, 1, 2, 3, 5]) {
        await asUser(actor);
        await fails(
          post,
          [
            archivedProperty,
            'Bình luận vào hồ sơ lưu trữ',
            `21000000-0000-4000-8000-00000000070${actor}`,
          ],
          '42501',
        );
      }
      await asAdmin();
      assert.equal(await count(archivedProperty), 1);
      await asUser(2);
      assert.equal(
        (await db.query(list, [archivedProperty, null, null, 30])).rows.length,
        1,
      );
    },
  );
  await check(
    'an unchanged tied-time list pages newest-first without omission or duplication',
    async () => {
      await asUser(1);
      const probe = (await db.query(list, [pagedProperty, null, null, 31]))
        .rows;
      assert.equal(probe.length, 31, 'one extra row detects a following page');
      const page1 = probe.slice(0, 30);
      const last = page1.at(-1);
      const page2 = (
        await db.query(list, [pagedProperty, last.created_at, last.id, 31])
      ).rows;
      assert.equal(page2.length, 15);
      const ids = [...page1, ...page2].map((row) => row.id);
      assert.equal(new Set(ids).size, 45);
      const at = (row) => Date.parse(row.created_at);
      const ordered = [...page1, ...page2].every(
        (row, index, all) =>
          index === 0 ||
          at(all[index - 1]) > at(row) ||
          (at(all[index - 1]) === at(row) && all[index - 1].id > row.id),
      );
      assert.ok(
        ordered,
        `keyset order is newest-first with an id tie-breaker: ${JSON.stringify([
          last.created_at,
          last.id,
          page2[0]?.created_at,
          page2[0]?.id,
        ])}`,
      );
      assert.equal(
        (await db.query(list, [pagedProperty, null, null, 500])).rows.length,
        31,
      );
      assert.equal(
        (await db.query(list, [pagedProperty, null, null, 0])).rows.length,
        1,
      );
      assert.deepEqual(
        (await db.query(list, [pagedProperty, last.created_at, null, 30])).rows,
        [],
      );
      assert.deepEqual((await db.query(list, [null, null, null, 30])).rows, []);
    },
  );
  await check(
    'paged discussion keeps the retained author and Vietnam posting time',
    async () => {
      await asUser(1);
      const rows = (await db.query(list, [pagedProperty, null, null, 5])).rows;
      assert.equal(rows.length, 5);
      for (const row of rows) {
        assert.equal(row.author_name, 'Fixture 0');
        assert.equal(row.author_id, employees[0]);
        assert.equal(
          new Date(row.created_at).toISOString(),
          '2026-10-01T03:00:00.000Z',
        );
        assert.match(row.revision, /^[0-9a-f-]{36}$/);
      }
    },
  );
  await asUser(0);
  await check(
    'unknown properties and missing parameters are rejected without creating a comment',
    async () => {
      const before = await count(colleagueProperty);
      await fails(
        post,
        [
          '21000000-0000-4000-8000-00000000ffff',
          'Bất động sản không tồn tại',
          '21000000-0000-4000-8000-000000000800',
        ],
        '23514',
      );
      await fails(
        post,
        [null, 'Thiếu bất động sản', '21000000-0000-4000-8000-000000000801'],
        '23514',
      );
      assert.deepEqual((await db.query(list, [null, null, null, 30])).rows, []);
      assert.equal(await count(colleagueProperty), before);
      assert.equal(await count(property), 0);
    },
  );
  // Issue #46: author edits append retained revisions. The reader sees the current text and an
  // edited marker; preceding versions stay reviewer-only; a stale save is never merged.
  const edit = 'select public.edit_property_comment($1,$2,$3) as edited';
  const revisions = async (id) =>
    (
      await db.query(
        'select * from public.property_comment_revisions where comment_id=$1 order by sequence',
        [id],
      )
    ).rows;
  await check(
    'retained revisions carry explicit grants, RLS and a defined order',
    async () => {
      assert.equal(
        (
          await db.query(
            'select relrowsecurity from pg_class where relname=$1 and relnamespace=$2::regnamespace',
            ['property_comment_revisions', 'public'],
          )
        ).rows[0].relrowsecurity,
        true,
      );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('anon','public.property_comment_revisions','SELECT') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
      for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
        assert.equal(
          (
            await db.query('select has_table_privilege($1,$2,$3) as allowed', [
              'authenticated',
              'public.property_comment_revisions',
              privilege,
            ])
          ).rows[0].allowed,
          false,
        );
      assert.ok(
        (
          await db.query(
            "select 1 from pg_indexes where schemaname='public' and indexname='property_comment_revisions_comment_idx'",
          )
        ).rows.length,
      );
      assert.deepEqual(
        (
          await db.query(
            "select n.nspname||'.'||p.proname||':'||p.prosecdef as fn from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname='edit_property_comment' order by n.nspname",
          )
        ).rows.map((row) => row.fn),
        [
          'private.edit_property_comment:true',
          'public.edit_property_comment:false',
        ],
      );
    },
  );
  let firstEdit;
  await check(
    'the author edits their own comment on a colleague property without moving its identity',
    async () => {
      await asUser(1);
      firstEdit = (
        await db.query(edit, [
          firstId,
          '  Đã cập nhật: Giá 12 tỷ — còn thương lượng.  ',
          firstRevision,
        ])
      ).rows[0].edited;
      assert.equal(
        firstEdit.body,
        'Đã cập nhật: Giá 12 tỷ — còn thương lượng.',
      );
      assert.notEqual(firstEdit.revision, firstRevision);
      assert.ok(firstEdit.edited_at, 'an edit records its server time');
      assert.equal(firstEdit.author_id, employees[1]);
      assert.equal(firstEdit.author_name, 'Fixture 1');
      assert.equal(firstEdit.property_id, colleagueProperty);
      assert.equal(
        new Date(firstEdit.created_at).toISOString(),
        new Date(firstCreatedAt).toISOString(),
        'the original posting time and position never move',
      );
      const row = (
        await db.query(list, [colleagueProperty, null, null, 30])
      ).rows.find((entry) => entry.id === firstId);
      assert.equal(row.body, firstEdit.body);
      assert.ok(row.edited_at, 'ordinary readers see the edited marker');
      assert.equal(
        Object.values(row).some(
          (value) => typeof value === 'string' && value.includes('Chào anh'),
        ),
        false,
        'no preceding version appears in a reader row',
      );
    },
  );
  await check(
    "other employees, property editors and reviewers cannot rewrite another author's comment",
    async () => {
      for (const actor of [0, 2, 3, 5]) {
        await asUser(actor);
        await fails(
          edit,
          [firstId, 'Chiếm quyền sửa', firstEdit.revision],
          '42501',
        );
      }
      await asAdmin();
      assert.equal((await own(firstId)).body, firstEdit.body);
      assert.equal(await revisions(firstId).then((r) => r.length), 1);
    },
  );
  let secondEdit;
  await check(
    'every saved version is retained with its actor and time',
    async () => {
      await asUser(1);
      secondEdit = (
        await db.query(edit, [firstId, 'Bản sửa lần hai', firstEdit.revision])
      ).rows[0].edited;
      await asUser(2);
      const history = await revisions(firstId);
      assert.equal(history.length, 2);
      assert.equal(
        history[0].before_body,
        'Chào anh,\nGiá 12 tỷ — còn thương lượng.',
      );
      assert.equal(history[0].after_body, firstEdit.body);
      assert.equal(history[0].actor_id, employees[1]);
      assert.equal(history[0].actor_name, 'Fixture 1');
      assert.ok(history[0].edited_at);
      assert.equal(history[1].before_body, firstEdit.body);
      assert.equal(history[1].after_body, secondEdit.body);
      assert.equal(history[0].property_id, colleagueProperty);
    },
  );
  await check(
    'preceding versions are reviewer-only and never a route for ordinary readers or authors',
    async () => {
      for (const actor of [0, 1, 5]) {
        await asUser(actor);
        assert.deepEqual(await revisions(firstId), []);
        assert.deepEqual(
          (
            await db.query(
              'select sequence from public.property_comment_revisions',
            )
          ).rows,
          [],
        );
      }
      for (const actor of [2, 3]) {
        await asUser(actor);
        assert.equal((await revisions(firstId)).length, 2);
      }
    },
  );
  let thirdEdit;
  await check(
    'a stale expected revision is rejected instead of silently merging newer text',
    async () => {
      await asUser(1);
      await fails(edit, [firstId, 'Ghi đè im lặng', firstRevision], 'PT409');
      await fails(
        edit,
        [firstId, 'Ghi đè im lặng', firstEdit.revision],
        'PT409',
      );
      assert.equal((await own(firstId)).body, secondEdit.body);
      thirdEdit = (
        await db.query(edit, [firstId, 'Bản sửa lần ba', secondEdit.revision])
      ).rows[0].edited;
      assert.equal(thirdEdit.body, 'Bản sửa lần ba');
      await asAdmin();
      assert.equal((await revisions(firstId)).length, 3);
    },
  );
  await check(
    'edited text keeps the posting validation and an unchanged save adds no version',
    async () => {
      await asUser(1);
      for (const bad of ['', '   ', 'a'.repeat(2001), null])
        await fails(edit, [firstId, bad, thirdEdit.revision], '23514');
      await fails(edit, [firstId, 'Thiếu bản sửa', null], '23514');
      await fails(edit, [null, 'Thiếu bình luận', thirdEdit.revision], '23514');
      await asAdmin();
      assert.equal((await revisions(firstId)).length, 3);
      await asUser(1);
      const boundary = 'ế'.repeat(2000);
      const accepted = (
        await db.query(edit, [firstId, boundary, thirdEdit.revision])
      ).rows[0].edited;
      assert.equal((await own(firstId)).body, boundary);
      const unchanged = (
        await db.query(edit, [firstId, boundary, accepted.revision])
      ).rows[0].edited;
      assert.equal(unchanged.revision, accepted.revision);
      assert.equal(unchanged.edited_at, accepted.edited_at);
      await asAdmin();
      assert.equal(
        (await revisions(firstId)).length,
        4,
        'an unchanged save is a no-op success',
      );
      thirdEdit = unchanged;
    },
  );
  await check(
    'posting-key replay after an edit recovers the original identity without overwriting it',
    async () => {
      await asUser(1);
      const before = await count(colleagueProperty);
      const replayed = (
        await db.query(post, [
          colleagueProperty,
          '  Chào anh,\nGiá 12 tỷ — còn thương lượng.  ',
          '21000000-0000-4000-8000-000000000101',
        ])
      ).rows[0].created;
      assert.equal(replayed.id, firstId);
      assert.equal(replayed.created_at, firstCreatedAt);
      assert.equal(
        replayed.body,
        thirdEdit.body,
        'replay returns the current text and never reverts the edit',
      );
      assert.equal(replayed.revision, thirdEdit.revision);
      await fails(
        post,
        [
          colleagueProperty,
          'Nội dung khác hoàn toàn',
          '21000000-0000-4000-8000-000000000101',
        ],
        '23505',
      );
      assert.equal(await count(colleagueProperty), before);
      assert.ok(replayed.edited_at);
    },
  );
  await check(
    'a manager edits their own comment but no one edits on an archived property',
    async () => {
      await asUser(2);
      const mine = (
        await db.query(post, [
          colleagueProperty,
          'Bình luận của quản lý',
          '21000000-0000-4000-8000-000000000900',
        ])
      ).rows[0].created;
      const owned = (
        await db.query(edit, [mine.id, 'Quản lý tự sửa', mine.revision])
      ).rows[0].edited;
      assert.equal(owned.body, 'Quản lý tự sửa');
      await asAdmin();
      await db.query(
        'update public.properties set archived_at=now() where id=$1',
        [colleagueProperty],
      );
      for (const actor of [1, 2, 3]) {
        await asUser(actor);
        await fails(
          edit,
          [firstId, 'Sửa sau lưu trữ', thirdEdit.revision],
          '42501',
        );
      }
      await asAdmin();
      await db.query(
        'update public.properties set archived_at=null where id=$1',
        [colleagueProperty],
      );
      assert.equal((await own(firstId)).body, thirdEdit.body);
    },
  );
  await asAdmin();
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  return colleagueProperty;
}
