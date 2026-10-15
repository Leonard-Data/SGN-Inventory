import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Ticket #74 embedded regressions: the property–vendor link's authority, duplicate-pair
// convergence, stale-context refusal, archived boundary, retained unlink and the property
// business-history projection. Real individual-session Data API/browser acceptance stays a
// hosted gate; this proves the database rules the application depends on.
export async function propertyVendorLinkContract({
  db,
  asUser,
  check,
  fails,
  employees,
  property,
  other,
}) {
  const link =
    'select public.link_property_vendor($1,$2,(select revision from public.properties where id=$1)) as link';
  const unlink = 'select public.unlink_property_vendor($1,$2,$3) as link';
  const links =
    'select * from public.property_vendors where property_id=$1 order by vendor_id';
  const history =
    'select target,actor_id,actor_name,changed_fields,before_values,after_values from public.property_history where property_id=$1 and target=$2 order by occurred_at,id';
  // An authenticated identity with no linked active employee row.
  const asIdentity = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  // Fixture/inspection writes: drop both the role and the request claim, so the employee
  // guard and the immutable-record guards see an owner connection.
  const asAdmin = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const count = async (sql, params = []) =>
    Number((await db.query(sql, params)).rows[0].n);
  const createVendor = async (name) => {
    await asUser(5);
    const created = await db.query(
      'select public.create_vendor($1,$2) as vendor',
      [randomUUID(), name],
    );
    return created.rows[0].vendor.id;
  };
  // Linking must add no ownership, occupancy or credited-access evidence: the deltas are
  // compared instead of absolute counts, so an unrelated earlier fixture cannot mask it.
  const evidence = async (id) => ({
    locks: await count(
      'select count(*)::int as n from public.property_locks where property_id=$1',
      [id],
    ),
    credits: await count(
      "select count(*)::int as n from public.activity_events where property_id=$1 and kind='owner_contact_access'",
      [id],
    ),
    contacts: await count(
      'select count(*)::int as n from public.property_contacts where property_id=$1',
      [id],
    ),
    facts: await count(
      "select count(*)::int as n from public.property_history where property_id=$1 and target<>'vendor_link'",
      [id],
    ),
    record: (
      await db.query(
        'select revision,record_review_status,status,legal_status,archived_at from public.properties where id=$1',
        [id],
      )
    ).rows[0],
  });

  const vendor = await createVendor('Công ty Vật tư Test');
  const related = await createVendor('Công ty Điện Test');
  const archivedProperty = '20000000-0000-4000-8000-0000000000a1';
  await asAdmin();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by,archived_at) values($1,'SGN-ARCH-1','sale','available',$2,now())",
    [archivedProperty, employees[5]],
  );

  await asUser(3);
  await check(
    'a link row carries explicit grants, RLS, the duplicate-pair key and both lookup indexes',
    async () => {
      const table = (
        await db.query(
          "select relrowsecurity from pg_class where relname='property_vendors' and relnamespace='public'::regnamespace",
        )
      ).rows[0];
      assert.equal(table.relrowsecurity, true);
      for (const role of ['anon', 'authenticated', 'service_role'])
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
          assert.equal(
            (
              await db.query(
                'select has_table_privilege($1,$2,$3) as allowed',
                [role, 'public.property_vendors', privilege],
              )
            ).rows[0].allowed,
            false,
          );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('anon','public.property_vendors','SELECT') as allowed",
          )
        ).rows[0].allowed,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select has_table_privilege('authenticated','public.property_vendors','SELECT') as allowed",
          )
        ).rows[0].allowed,
        true,
      );
      const key = (
        await db.query(
          `select array_agg(att.attname order by key.ord) as columns
           from pg_constraint con
           join pg_index idx on idx.indexrelid = con.conindid
           cross join lateral unnest(idx.indkey) with ordinality as key(attnum, ord)
           join pg_attribute att on att.attrelid = idx.indrelid and att.attnum = key.attnum
           where con.conrelid = 'public.property_vendors'::regclass and con.contype = 'p'
           group by con.oid`,
        )
      ).rows[0]?.columns;
      assert.deepEqual(key, ['property_id', 'vendor_id']);
      const vendorIndex = (
        await db.query(
          `select array_agg(att.attname order by key.ord) as columns
           from pg_class index_rel
           join pg_namespace index_ns on index_ns.oid = index_rel.relnamespace
           join pg_index idx on idx.indexrelid = index_rel.oid
           cross join lateral unnest(idx.indkey) with ordinality as key(attnum, ord)
           join pg_attribute att on att.attrelid = idx.indrelid and att.attnum = key.attnum
           where index_ns.nspname = 'public'
             and index_rel.relname = 'property_vendors_vendor_idx'
             and idx.indisvalid
           group by index_rel.oid`,
        )
      ).rows[0];
      assert.ok(vendorIndex, 'the vendor -> property lookup index is missing');
      assert.deepEqual(vendorIndex.columns, ['vendor_id', 'property_id']);
    },
  );

  await check(
    'the primary key refuses a direct duplicate property/vendor pair',
    async () => {
      const insert =
        'insert into public.property_vendors(property_id,vendor_id,created_by) values($1,$2,$3)';
      await asAdmin();
      await db.query(insert, [other, related, employees[5]]);
      await fails(insert, [other, related, employees[5]], '23505');
      await db.query(
        'delete from public.property_vendors where property_id=$1 and vendor_id=$2',
        [other, related],
      );
    },
  );

  await check(
    'a direct client write or anonymous read of the link table is refused',
    async () => {
      await asUser(5);
      await fails(
        'insert into public.property_vendors(property_id,vendor_id,created_by) values($1,$2,$3)',
        [property, vendor, employees[5]],
        '42501',
      );
      await fails(
        'update public.property_vendors set vendor_id=$2 where property_id=$1',
        [property, related],
        '42501',
      );
      await fails(
        'delete from public.property_vendors where property_id=$1',
        [property],
        '42501',
      );
      await asUser(null);
      await fails('select * from public.property_vendors', [], '42501');
      await fails(link, [property, vendor], '42501');
    },
  );

  await check(
    'linking needs a live active employee on an unarchived property',
    async () => {
      await asUser(null);
      await fails(link, [property, vendor], '42501');
      await asUser(4);
      await fails(link, [property, vendor], '42501');
      await asIdentity('00000000-0000-4000-8000-00000000dead');
      await fails(link, [property, vendor], '42501');
      await asUser(0);
      const salesLink = (await db.query(link, [other, related])).rows[0].link;
      assert.equal(salesLink.created, true);
      const salesUnlink = (
        await db.query(unlink, [other, related, salesLink.revision])
      ).rows[0].link;
      assert.equal(salesUnlink.removed, true);
      await asUser(2);
      assert.equal(
        (await db.query(link, [property, vendor])).rows[0].link.created,
        true,
      );
      await asUser(5);
      await fails(
        'select public.link_property_vendor($1,$2,null)',
        [property, related],
        '23514',
      );
      await fails(
        'select public.link_property_vendor($1,$2,$3)',
        [
          property,
          '30000000-0000-4000-8000-0000000000ff',
          (
            await db.query(
              'select revision from public.properties where id=$1',
              [property],
            )
          ).rows[0].revision,
        ],
        '23503',
      );
    },
  );

  await check(
    'a duplicate link converges on the recorded relationship and writes one history entry',
    async () => {
      await asUser(5);
      const first = (await db.query(link, [property, vendor])).rows[0].link;
      assert.equal(first.created, false);
      const again = (await db.query(link, [property, vendor])).rows[0].link;
      assert.equal(again.created, false);
      assert.equal(again.revision, first.revision);
      assert.equal((await db.query(links, [property])).rows.length, 1);
      await asAdmin();
      const events = (await db.query(history, [property, 'vendor_link'])).rows;
      assert.equal(events.length, 1);
      assert.equal(events[0].actor_id, employees[2]);
      assert.ok(events[0].actor_name);
      assert.deepEqual(events[0].changed_fields, ['vendor_id', 'vendor_name']);
      assert.deepEqual(events[0].before_values, {});
      assert.deepEqual(events[0].after_values, {
        vendor_id: vendor,
        vendor_name: 'Công ty Vật tư Test',
      });
    },
  );

  await check(
    'a stale property or link context is refused instead of changing the relationship',
    async () => {
      await asUser(5);
      await fails(
        'select public.link_property_vendor($1,$2,$3)',
        [property, '30000000-0000-4000-8000-0000000000fe', randomUUID()],
        'PT409',
      );
      await fails(
        'select public.link_property_vendor($1,$2,(select revision from public.properties where id=$3))',
        [property, '30000000-0000-4000-8000-0000000000fe', other],
        'PT409',
      );
      await fails(
        'select public.unlink_property_vendor($1,$2,$3)',
        [property, vendor, randomUUID()],
        'PT409',
      );
      await fails(
        'select public.unlink_property_vendor($1,$2,$3)',
        [property, '30000000-0000-4000-8000-0000000000fe', randomUUID()],
        'P0002',
      );
      assert.equal((await db.query(links, [property])).rows.length, 1);
    },
  );

  await check(
    'an archived property refuses a new link and hides its links outside reviewer authority',
    async () => {
      await asUser(0);
      await fails(link, [archivedProperty, vendor], '42501');
      await asAdmin();
      await db.query(
        'insert into public.property_vendors(property_id,vendor_id,created_by) values($1,$2,$3)',
        [archivedProperty, related, employees[5]],
      );
      await asUser(0);
      assert.equal(
        (
          await db.query('select * from public.list_property_vendors($1)', [
            archivedProperty,
          ])
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query('select * from public.list_vendor_properties($1)', [
            related,
          ])
        ).rows.length,
        0,
      );
      await asUser(3);
      assert.equal(
        (
          await db.query('select * from public.list_property_vendors($1)', [
            archivedProperty,
          ])
        ).rows.length,
        1,
      );
      const projection = (
        await db.query('select * from public.list_vendor_properties($1)', [
          related,
        ])
      ).rows;
      assert.equal(projection.length, 1);
      assert.ok(projection[0].archived_at);
    },
  );

  await check(
    'the authorized projections expose the recorded link and stay bounded',
    async () => {
      await asUser(0);
      const section = (
        await db.query('select * from public.list_property_vendors($1)', [
          property,
        ])
      ).rows;
      assert.equal(section.length, 1);
      assert.equal(section[0].vendor_id, vendor);
      assert.equal(section[0].display_name, 'Công ty Vật tư Test');
      assert.ok(section[0].revision);
      const reach = (
        await db.query('select * from public.list_vendor_properties($1)', [
          vendor,
        ])
      ).rows;
      assert.deepEqual(
        reach.map((row) => row.property_id),
        [property],
      );
      // The wrapper returns at most 51 rows (50 exposed plus the follow-page probe), even
      // when the caller asks for more.
      await asAdmin();
      await db.query(
        `insert into public.properties(id,property_code,listing_mode,status,created_by)
         select ('40000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'SGN-PV-'||g,'sale','available',$1
         from generate_series(1,51) g`,
        [employees[5]],
      );
      await db.query(
        `insert into public.property_vendors(property_id,vendor_id,created_by)
         select id,$1,$2 from public.properties where property_code like 'SGN-PV-%'`,
        [vendor, employees[5]],
      );
      await asUser(3);
      assert.equal(
        (
          await db.query(
            'select * from public.list_vendor_properties($1,1000)',
            [vendor],
          )
        ).rows.length,
        51,
      );
    },
  );

  await check(
    'linking never implies ownership, occupancy or owner-contact credit',
    async () => {
      await asUser(5);
      await asAdmin();
      const before = await evidence(other);
      await asUser(5);
      assert.equal(
        (await db.query(link, [other, vendor])).rows[0].link.created,
        true,
      );
      await asAdmin();
      assert.deepEqual(await evidence(other), before);
      assert.equal((await db.query(links, [other])).rows.length, 1);
    },
  );

  await check(
    'unlinking removes only the current relationship and keeps the vendor and earlier history',
    async () => {
      await asUser(5);
      const before = (
        await db.query(
          'select revision from public.property_vendors where property_id=$1 and vendor_id=$2',
          [property, vendor],
        )
      ).rows[0].revision;
      const removed = (await db.query(unlink, [property, vendor, before]))
        .rows[0].link;
      assert.equal(removed.removed, true);
      assert.equal(
        (
          await db.query(
            'select * from public.property_vendors where property_id=$1 and vendor_id=$2',
            [property, vendor],
          )
        ).rows.length,
        0,
      );
      // The relationship on the other property, the company identity and its details stay.
      assert.equal((await db.query(links, [other])).rows.length, 1);
      const company = (
        await db.query(
          'select display_name,contact_name,phones,email,source_address,notes,created_by,submission_key from public.vendors where id=$1',
          [vendor],
        )
      ).rows[0];
      assert.equal(company.display_name, 'Công ty Vật tư Test');
      assert.equal(company.created_by, employees[5]);
      assert.ok(company.submission_key);
      await asAdmin();
      const events = (await db.query(history, [property, 'vendor_link'])).rows;
      assert.equal(events.length, 2);
      assert.deepEqual(events[0].after_values, {
        vendor_id: vendor,
        vendor_name: 'Công ty Vật tư Test',
      });
      assert.deepEqual(events[1].changed_fields, ['vendor_id', 'vendor_name']);
      assert.deepEqual(events[1].before_values, {
        vendor_id: vendor,
        vendor_name: 'Công ty Vật tư Test',
      });
      assert.deepEqual(events[1].after_values, {});
      assert.equal(events[1].actor_id, employees[5]);
      assert.ok(events[1].actor_name);
    },
  );
}
