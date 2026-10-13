import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Issue #73 embedded regressions: the Vendor directory's authority, validation,
// unknown-value preservation, create atomicity, retry convergence and paging/query
// bounds. Real Auth/Data API/browser acceptance stays a hosted gate; this proves the
// database rules the application depends on.
export async function vendorContract({ db, asUser, check, fails, employees }) {
  const create = 'select public.create_vendor($1,$2,$3,$4,$5,$6,$7) as created';
  const createDefaults = 'select public.create_vendor($1,$2) as created';
  const list = 'select * from public.list_vendors($1,$2,$3,$4)';
  const listDefaults = 'select * from public.list_vendors()';

  // Direct fixture/inspection writes: drop both the role and the request claim so the
  // employee guard sees an owner connection, not an employee session.
  const asAdmin = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  // An authenticated identity with no linked active employee row (unlinked caller).
  const asIdentity = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  const stored = async (id) =>
    (
      await db.query(
        'select id,display_name,contact_name,phones,email,source_address,notes,created_by,created_at,submission_key from public.vendors where id=$1',
        [id],
      )
    ).rows[0];
  const vendorCount = async () =>
    Number(
      (await db.query('select count(*)::int as n from public.vendors')).rows[0]
        .n,
    );

  await check(
    'the vendors table carries explicit grants, RLS and the paging/retry indexes',
    async () => {
      assert.equal(
        (
          await db.query(
            'select relrowsecurity from pg_class where relname=$1 and relnamespace=$2::regnamespace',
            ['vendors', 'public'],
          )
        ).rows[0].relrowsecurity,
        true,
      );
      for (const role of ['anon', 'authenticated', 'service_role'])
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
          assert.equal(
            (
              await db.query(
                'select has_table_privilege($1,$2,$3) as allowed',
                [role, 'public.vendors', privilege],
              )
            ).rows[0].allowed,
            false,
          );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('anon','public.vendors','SELECT') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('authenticated','public.vendors','SELECT') as allowed",
          )
        ).rows[0].allowed,
        true,
      );
      for (const index of [
        'vendors_page_idx',
        'vendors_search_trgm_idx',
        'vendors_created_by_submission_key_key',
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
    'the guarded create and bounded list stay invoker wrappers around a private definer',
    async () => {
      const functions = (
        await db.query(
          "select p.proname,p.prosecdef,n.nspname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in ('create_vendor','list_vendors') order by p.proname,n.nspname",
        )
      ).rows;
      assert.deepEqual(
        functions.map(
          (row) => `${row.nspname}.${row.proname}:${row.prosecdef}`,
        ),
        [
          'private.create_vendor:true',
          'public.create_vendor:false',
          'public.list_vendors:false',
        ],
      );
    },
  );

  await check(
    'read authority is every active employee; only staff/manager/admin may create',
    async () => {
      await asUser(null);
      await fails(
        createDefaults,
        ['71000000-0000-4000-8000-000000000001', 'Khách sạn ABC'],
        '42501',
      );
      await asIdentity(randomUUID());
      await fails(
        createDefaults,
        ['71000000-0000-4000-8000-000000000002', 'Khách sạn ABC'],
        '42501',
      );
      await asUser(4);
      await fails(
        createDefaults,
        ['71000000-0000-4000-8000-000000000003', 'Khách sạn ABC'],
        '42501',
      );
      for (const sales of [0, 1]) {
        await asUser(sales);
        await fails(
          createDefaults,
          ['71000000-0000-4000-8000-000000000004', 'Khách sạn ABC'],
          '42501',
        );
      }
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub','',false)");
      await db.exec('set role service_role');
      await fails(
        createDefaults,
        ['71000000-0000-4000-8000-000000000005', 'Khách sạn ABC'],
        '42501',
      );
      await asAdmin();
      assert.equal(await vendorCount(), 0);
    },
  );

  let staffVendor, managerVendor;
  await check(
    'a permitted create returns one confirmed company identity with the recorded contact block',
    async () => {
      await asUser(5);
      staffVendor = (
        await db.query(create, [
          '71000000-0000-4000-8000-000000000101',
          'Công ty TNHH Vật tư Ứng Dụng',
          'Nguyễn Văn Ứng',
          ['090 123 4567', '+84 (0)28 3822 1234'],
          'ung.dung@example.test',
          '12 Lý Thường Kiệt, Phường 14, Quận 10, TP.HCM',
          'Giao hàng buổi sáng\nThanh toán theo tháng',
        ])
      ).rows[0].created;
      assert.match(staffVendor.id, /^[0-9a-f-]{36}$/);
      assert.equal(staffVendor.display_name, 'Công ty TNHH Vật tư Ứng Dụng');
      assert.equal(staffVendor.contact_name, 'Nguyễn Văn Ứng');
      // Phone strings are preserved exactly as typed, including grouping and masks.
      assert.deepEqual(staffVendor.phones, [
        '090 123 4567',
        '+84 (0)28 3822 1234',
      ]);
      assert.equal(staffVendor.email, 'ung.dung@example.test');
      // Legacy district-bearing source text is never rewritten into current units.
      assert.equal(
        staffVendor.source_address,
        '12 Lý Thường Kiệt, Phường 14, Quận 10, TP.HCM',
      );
      assert.equal(
        staffVendor.notes,
        'Giao hàng buổi sáng\nThanh toán theo tháng',
      );
      assert.equal(typeof staffVendor.created_at, 'string');
      // The same identity is visible through the ordinary RLS read.
      assert.equal(
        (await stored(staffVendor.id)).display_name,
        staffVendor.display_name,
      );
      await asUser(2);
      managerVendor = (
        await db.query(createDefaults, [
          '71000000-0000-4000-8000-000000000102',
          'Đại lý sắt thép Bình Tân',
        ])
      ).rows[0].created;
      assert.equal(managerVendor.display_name, 'Đại lý sắt thép Bình Tân');
      assert.equal(managerVendor.contact_name, null);
      assert.equal(managerVendor.phones, null);
      assert.equal(managerVendor.email, null);
      assert.equal(managerVendor.source_address, null);
      assert.equal(managerVendor.notes, null);
      assert.equal(await vendorCount(), 2);
    },
  );

  await check(
    'each optional detail is independently unknown, never an invented default',
    async () => {
      await asUser(3);
      const partial = (
        await db.query(create, [
          '71000000-0000-4000-8000-000000000103',
          'Công ty Cổ phần Hạ tầng',
          null,
          ['028 7300 1234'],
          null,
          null,
          'Chỉ liên hệ qua điện thoại',
        ])
      ).rows[0].created;
      assert.equal(partial.contact_name, null);
      assert.deepEqual(partial.phones, ['028 7300 1234']);
      assert.equal(partial.email, null);
      assert.equal(partial.source_address, null);
      assert.equal(partial.notes, 'Chỉ liên hệ qua điện thoại');
      // Blank optional text is unknown, not an empty recorded value.
      const blank = (
        await db.query(create, [
          '71000000-0000-4000-8000-000000000104',
          'Công ty Trống',
          '   ',
          null,
          '\t',
          ' ',
          '\n',
        ])
      ).rows[0].created;
      assert.equal(blank.contact_name, null);
      assert.equal(blank.email, null);
      assert.equal(blank.source_address, null);
      assert.equal(blank.notes, null);
      const row = await stored(blank.id);
      assert.equal(row.contact_name, null);
      assert.equal(row.source_address, null);
    },
  );

  await check(
    'malformed company, contact, phone, email and length input is rejected atomically',
    async () => {
      await asUser(5);
      const key = () => randomUUID();
      const before = await vendorCount();
      await fails(createDefaults, [key(), null], '23514');
      await fails(createDefaults, [key(), ''], '23514');
      await fails(createDefaults, [key(), '   '], '23514');
      await fails(createDefaults, [key(), '\u00a0\ufeff'], '23514');
      await fails(createDefaults, [key(), 'a'.repeat(201)], '23514');
      await fails(
        create,
        [key(), 'Company', 'a'.repeat(201), null, null, null, null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, [], null, null, null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, [''], null, null, null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, ['  '], null, null, null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, ['a'.repeat(41)], null, null, null],
        '23514',
      );
      await fails(
        create,
        [
          key(),
          'Company',
          null,
          ['1', '2', '3', '4', '5', '6'],
          null,
          null,
          null,
        ],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, ['090 123 4567', null], null, null, null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, null, 'not-an-email', null, null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, null, 'a@b', null, null],
        '23514',
      );
      await fails(
        create,
        [
          key(),
          'Company',
          null,
          null,
          `${'a'.repeat(250)}@example.test`,
          null,
          null,
        ],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, null, null, 'a'.repeat(501), null],
        '23514',
      );
      await fails(
        create,
        [key(), 'Company', null, null, null, null, 'a'.repeat(2001)],
        '23514',
      );
      await fails(createDefaults, [null, 'Company'], '23514');
      await fails(createDefaults, [key(), null], '23514');
      assert.equal(await vendorCount(), before);
    },
  );

  await check(
    'the submission key is employee-scoped and a retry converges on one original vendor',
    async () => {
      await asUser(5);
      const key = '71000000-0000-4000-8000-000000000201';
      const details = [
        key,
        'Công ty Thử Lại',
        'Trần Văn B',
        ['0912 345 678'],
        'retry@example.test',
        '1 Nguyễn Trãi, Quận 5',
        'Ghi chú thử lại',
      ];
      const created = (await db.query(create, details)).rows[0].created;
      const before = await vendorCount();
      // Surrounding whitespace that trims to the same recorded values is a retry, not a duplicate.
      const retried = (
        await db.query(create, [
          key,
          `  ${details[1]}  `,
          ` ${details[2]} `,
          ['0912 345 678'],
          details[4],
          details[5],
          details[6],
        ])
      ).rows[0].created;
      assert.equal(retried.id, created.id);
      assert.equal(retried.created_at, created.created_at);
      assert.equal(await vendorCount(), before);
      // Reusing the key for different vendor details conflicts and changes nothing.
      await fails(
        create,
        [key, 'Công ty Khác', details[2], null, null, null, null],
        '23505',
      );
      const original = await stored(created.id);
      assert.equal(original.display_name, 'Công ty Thử Lại');
      // The key is scoped to the employee: a colleague's same key is their own vendor.
      await asUser(2);
      const colleague = (
        await db.query(create, [
          key,
          'Công ty Của Quản Lý',
          null,
          null,
          null,
          null,
          null,
        ])
      ).rows[0].created;
      assert.notEqual(colleague.id, created.id);
      assert.equal(colleague.display_name, 'Công ty Của Quản Lý');
    },
  );

  await check(
    'direct client writes are refused and recorded vendors are immutable',
    async () => {
      const id = staffVendor.id;
      await asUser(5);
      await fails(
        "insert into public.vendors(display_name,created_by,submission_key) values('Forged',(select id from public.employees where role='staff' limit 1),gen_random_uuid())",
        [],
        '42501',
      );
      await fails(
        "update public.vendors set display_name='Rewritten' where id=$1",
        [id],
        '42501',
      );
      await fails('delete from public.vendors where id=$1', [id], '42501');
      await asUser(null);
      await fails(
        "insert into public.vendors(display_name,created_by,submission_key) values('Forged',(select id from public.employees limit 1),gen_random_uuid())",
        [],
        '42501',
      );
      // Even the owner cannot rewrite recorded vendor identity in this slice.
      await asAdmin();
      await fails(
        "update public.vendors set contact_name='Rewritten' where id=$1",
        [id],
        '23514',
      );
      await fails('delete from public.vendors where id=$1', [id], '23514');
      assert.equal(
        (await stored(id)).display_name,
        'Công ty TNHH Vật tư Ứng Dụng',
      );
    },
  );

  await check(
    'the directory pages newest-first without omission and bounds the exposed page',
    async () => {
      await asAdmin();
      for (let index = 0; index < 35; index += 1)
        await db.query(
          `insert into public.vendors(display_name,contact_name,created_by,created_at,submission_key)
           values($1,$2,$3,timestamptz '2026-10-01 00:00:00+00' + ($4 || ' minutes')::interval,$5)`,
          [
            `Nhà cung cấp ${String(index).padStart(2, '0')}`,
            index % 2 === 0 ? `Liên hệ ${index}` : null,
            employees[0],
            index,
            randomUUID(),
          ],
        );
      const total = await vendorCount();
      assert.ok(total >= 40, `expected the paging fixtures, saw ${total}`);
      await asUser(0);
      // The route asks for one row more than it exposes; the database clamps at 31.
      const first = (await db.query(list, [null, null, null, 31])).rows;
      assert.equal(first.length, 31);
      assert.ok(first.length > 30, 'the follow-page probe row is present');
      assert.ok(
        (await db.query(list, [null, null, null, 100])).rows.length <= 31,
      );
      assert.equal(
        (await db.query(list, [null, null, null, 0])).rows.length,
        1,
      );
      assert.equal((await db.query(listDefaults)).rows.length, 31);
      const seen = new Set();
      let cursor = null;
      let lastCreatedAt = null;
      let pages = 0;
      while (true) {
        const rows = (
          await db.query(list, [
            null,
            cursor ? cursor.createdAt : null,
            cursor ? cursor.id : null,
            31,
          ])
        ).rows;
        const page = rows.slice(0, 30);
        for (const row of page) {
          assert.ok(!seen.has(row.id), `duplicate row ${row.id}`);
          seen.add(row.id);
          if (lastCreatedAt !== null)
            assert.ok(
              lastCreatedAt >= row.created_at,
              'newest-first ordering is stable across pages',
            );
          lastCreatedAt = row.created_at;
        }
        pages += 1;
        if (rows.length <= 30) break;
        const last = page[page.length - 1];
        cursor = { createdAt: last.created_at, id: last.id };
      }
      assert.ok(pages >= 2, `expected several pages, saw ${pages}`);
      assert.equal(seen.size, total);
      // The newest recorded vendor is the first row of the first page.
      await asUser(2);
      const newest = (
        await db.query(
          'select id from public.vendors order by created_at desc, id desc limit 1',
        )
      ).rows[0].id;
      await asUser(0);
      assert.equal(first[0].id, newest);
    },
  );

  await check(
    'the directory query is a bounded literal accent-insensitive fragment',
    async () => {
      await asAdmin();
      await db.query(
        `insert into public.vendors(display_name,contact_name,created_by,created_at,submission_key)
         values('Vật tư 50%_Chính','Nguyễn Văn B', $1, now(), $2),
               ('Vật tư 500XKiểm', null, $1, now(), $3),
               ('Công ty Đặc Biệt', 'Lê Thị B', $1, now(), $4)`,
        [employees[0], randomUUID(), randomUUID(), randomUUID()],
      );
      const names = async (query) =>
        (await db.query(list, [query, null, null, 31])).rows
          .map((row) => row.display_name)
          .sort();
      await asUser(1);
      // Accent-insensitive contiguous fragments cover the company and contact names.
      assert.deepEqual(await names('vat tu 50%'), ['Vật tư 50%_Chính']);
      assert.deepEqual(await names('VẬT TƯ'), [
        'Công ty TNHH Vật tư Ứng Dụng',
        'Vật tư 50%_Chính',
        'Vật tư 500XKiểm',
      ]);
      assert.deepEqual(await names('van b'), [
        'Công ty Thử Lại',
        'Vật tư 50%_Chính',
      ]);
      assert.deepEqual(await names('le thi b'), ['Công ty Đặc Biệt']);
      // `%`, `_` and `\` are ordinary characters, not wildcards.
      assert.deepEqual(await names('50%'), ['Vật tư 50%_Chính']);
      assert.deepEqual(await names('%_'), ['Vật tư 50%_Chính']);
      assert.deepEqual(await names('0X'), ['Vật tư 500XKiểm']);
      assert.deepEqual(await names('%'), ['Vật tư 50%_Chính']);
      assert.deepEqual(await names('\\'), []);
      // A blank query browses the whole directory; an over-long query returns no rows.
      assert.ok((await names('')).length > 30);
      assert.equal((await names('   ')).length, 31);
      assert.deepEqual(await names('a'.repeat(121)), []);
      assert.deepEqual(await names('không tồn tại'), []);
      assert.deepEqual(await names('trai nguyen'), []);
    },
  );

  await check(
    'live deactivation denies the next create and hides the directory without erasing it',
    async () => {
      await asUser(5);
      const key = '71000000-0000-4000-8000-000000000301';
      const created = (
        await db.query(createDefaults, [key, 'Công ty Sắp Nghỉ'])
      ).rows[0].created;
      await asAdmin();
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[5]],
      );
      await db.exec('set role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        '10000000-0000-4000-8000-000000000006',
      ]);
      await fails(
        createDefaults,
        [randomUUID(), 'Công ty Bị Từ Chối'],
        '42501',
      );
      assert.equal(
        (await db.query('select id from public.vendors')).rows.length,
        0,
      );
      assert.equal((await db.query(listDefaults)).rows.length, 0);
      // The recorded vendor survives; restoration exposes it again.
      await asAdmin();
      const preserved = await stored(created.id);
      assert.equal(preserved.display_name, 'Công ty Sắp Nghỉ');
      await db.query('update public.employees set is_active=true where id=$1', [
        employees[5],
      ]);
      await asUser(1);
      assert.ok((await db.query(listDefaults)).rows.length > 0);
      assert.equal((await stored(created.id)).id, created.id);
    },
  );

  await check(
    'anonymous and unlinked identities read no vendor rows, and an inactive one sees none',
    async () => {
      await asUser(null);
      await fails('select * from public.vendors', [], '42501');
      await fails('select * from public.list_vendors()', [], '42501');
      await asIdentity('00000000-0000-4000-8000-00000000dead');
      assert.equal(
        (await db.query('select id from public.vendors')).rows.length,
        0,
      );
      assert.equal((await db.query(listDefaults)).rows.length, 0);
      await asUser(4);
      assert.equal(
        (await db.query('select id from public.vendors')).rows.length,
        0,
      );
      assert.equal((await db.query(listDefaults)).rows.length, 0);
      await asUser(0);
      assert.ok(
        (await db.query('select id from public.vendors')).rows.length > 0,
      );
    },
  );
}
