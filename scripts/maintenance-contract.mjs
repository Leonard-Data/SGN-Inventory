import assert from 'node:assert/strict';

export async function maintenanceContract({
  db,
  asUser,
  check,
  fails,
  employees,
  property,
  other,
}) {
  await asUser(0);
  let created;
  await check(
    'minimal known-address creation assigns stable identity with unknown optional facts and no history',
    async () => {
      created = (
        await db.query('select public.create_property($1,$2,$3) as id', [
          'sale',
          {},
          { format: 'legacy', address_text: 'Nhà nguồn 50%_ Lý Thường Kiệt' },
        ])
      ).rows[0].id;
      const row = (
        await db.query(
          'select property_code,created_by,sale_price_vnd,land_area_m2,revision from public.properties where id=$1',
          [created],
        )
      ).rows[0];
      assert.match(row.property_code, /^SGN-[0-9]+$/);
      assert.equal(row.created_by, employees[0]);
      assert.equal(row.sale_price_vnd, null);
      assert.equal(row.land_area_m2, null);
      assert.ok(row.revision);
      assert.equal(
        (
          await db.query(
            'select address_text from public.property_addresses where property_id=$1',
            [created],
          )
        ).rows[0].address_text,
        'Nhà nguồn 50%_ Lý Thường Kiệt',
      );
      // An address-only creation carries no asking-price change, so it records no history.
      assert.deepEqual(
        (
          await db.query(
            'select id from public.property_history where property_id=$1',
            [created],
          )
        ).rows,
        [],
      );
    },
  );
  const revision = async (table, id) =>
    (await db.query(`select revision from public.${table} where id=$1`, [id]))
      .rows[0].revision;
  const mutate =
    'select public.maintain_property($1,$2,$3,$4,$5,(select revision from public.properties where id=$1)) as id';
  await check(
    'ordinary exact-VND edit saves immediately with attributable history and rejects stale overwrite',
    async () => {
      const rev = await revision('properties', created);
      await db.query(mutate, [
        created,
        'property',
        created,
        rev,
        { sale_price_vnd: '999999999999999999', notes: 'Nguồn tiếng Việt' },
      ]);
      assert.equal(
        (
          await db.query(
            'select sale_price_vnd::text as price,notes from public.properties where id=$1',
            [created],
          )
        ).rows[0].price,
        '999999999999999999',
      );
      await fails(
        mutate,
        [created, 'property', created, rev, { notes: 'stale' }],
        'PT409',
      );
      const event = (
        await db.query(
          "select before_values,after_values,actor_id from public.property_history where property_id=$1 and 'sale_price_vnd'=any(changed_fields) order by occurred_at desc limit 1",
          [created],
        )
      ).rows[0];
      assert.equal(event.before_values.sale_price_vnd, null);
      assert.equal(event.after_values.sale_price_vnd, '999999999999999999');
      assert.equal(event.actor_id, employees[0]);
      assert.deepEqual(
        (
          await db.query('select id from public.search_properties($1)', [
            'nguon 50%_',
          ])
        ).rows,
        [{ id: created }],
      );
    },
  );
  await check(
    'creation validation and failed address roll back all property/history writes',
    async () => {
      const before = (
        await db.query('select id from public.properties order by id')
      ).rows;
      for (const address of [
        { format: 'legacy', address_text: ' ' },
        {
          format: 'current',
          address_text: 'Valid',
          district_text: 'not current',
        },
      ])
        await fails(
          'select public.create_property($1,$2,$3)',
          ['sale', {}, address],
          '23514',
        );
      for (const facts of [
        { sale_price_vnd: '1.5' },
        { land_area_m2: '1.001' },
        { sale_price_vnd: 9007199254740992 },
        { property_code: 'forged' },
      ])
        await fails(
          'select public.create_property($1,$2,$3)',
          [
            'sale',
            facts,
            { format: 'current', address_text: 'Known raw address' },
          ],
          '23514',
        );
      assert.deepEqual(
        (await db.query('select id from public.properties order by id')).rows,
        before,
      );
    },
  );
  await check(
    'sales cross-owner and direct mutation bypasses are denied without state/history changes',
    async () => {
      const before = (
        await db.query(
          'select notes,revision from public.properties where id=$1',
          [other],
        )
      ).rows;
      await fails(
        mutate,
        [other, 'property', other, before[0].revision, { notes: 'forged' }],
        '42501',
      );
      await fails(
        "update public.properties set notes='forged' where id=$1",
        [created],
        '42501',
      );
      await fails(
        "update public.property_addresses set address_text='forged' where property_id=$1",
        [created],
        '42501',
      );
      await fails(
        'insert into public.property_history(property_id) values($1)',
        [created],
        '42501',
      );
      assert.deepEqual(
        (
          await db.query(
            'select notes,revision from public.properties where id=$1',
            [other],
          )
        ).rows,
        before,
      );
    },
  );
  await check(
    'legacy correction retains original and current primary replacement retains preceding rows',
    async () => {
      let original = (
        await db.query(
          'select id,revision,address_text from public.property_addresses where property_id=$1',
          [created],
        )
      ).rows[0];
      const replacement = (
        await db.query(mutate, [
          created,
          'address',
          original.id,
          original.revision,
          { address_text: 'Nhà đính chính Nguyễn Trãi' },
        ])
      ).rows[0].id;
      assert.deepEqual(
        (
          await db.query(
            'select address_text,is_primary from public.property_addresses where id=$1',
            [original.id],
          )
        ).rows,
        [{ address_text: original.address_text, is_primary: false }],
      );
      assert.equal(
        (
          await db.query(
            'select supersedes_address_id from public.property_addresses where id=$1',
            [replacement],
          )
        ).rows[0].supersedes_address_id,
        original.id,
      );
      const current = (
        await db.query(mutate, [
          created,
          'address',
          null,
          await revision('properties', created),
          {
            format: 'current',
            address_text: 'Current raw',
            province_text: 'Tỉnh chưa có',
            commune_text: 'Xã chưa có',
          },
        ])
      ).rows[0].id;
      await db.query(mutate, [
        created,
        'address',
        current,
        await revision('property_addresses', current),
        { address_text: 'Current corrected' },
      ]);
      assert.equal(
        (
          await db.query(
            'select is_primary from public.property_addresses where id=$1',
            [current],
          )
        ).rows[0].is_primary,
        false,
      );
      assert.equal(
        (
          await db.query(
            "select id from public.property_addresses where property_id=$1 and format='current' and is_primary",
            [created],
          )
        ).rows.length,
        1,
      );
      assert.deepEqual(
        (
          await db.query(
            "select id from public.search_properties('ly thuong kiet') where id=$1",
            [created],
          )
        ).rows,
        [{ id: created }],
      );
      assert.deepEqual(
        (
          await db.query(
            "select id from public.search_properties('nguyen trai') where id=$1",
            [created],
          )
        ).rows,
        [{ id: created }],
      );
    },
  );
  await asUser(5);
  await check(
    'staff edits shared facts but cannot designate verified mapping or final status',
    async () => {
      await db.query(mutate, [
        created,
        'property',
        created,
        await revision('properties', created),
        { monthly_rent_vnd: '12000000' },
      ]);
      await fails(
        mutate,
        [
          created,
          'property',
          created,
          await revision('properties', created),
          { status: 'sold' },
        ],
        '42501',
      );
      const addr = (
        await db.query(
          "select id,revision from public.property_addresses where property_id=$1 and format='current' and is_primary",
          [created],
        )
      ).rows[0];
      await fails(
        mutate,
        [
          created,
          'mapping',
          addr.id,
          addr.revision,
          { mapping_status: 'verified' },
        ],
        '42501',
      );
    },
  );
  let shared, unrelated, replacementContact;
  await check(
    'shared contact edit updates the shared identity without touching unrelated identities or property history',
    async () => {
      shared = (
        await db.query('select public.create_contact($1) as id', [
          {
            display_name: 'Người chung',
            phones: ['0900123456'],
            raw_phone_text: '0900 123 456',
          },
        ])
      ).rows[0].id;
      unrelated = (
        await db.query('select public.create_contact($1) as id', [
          { display_name: 'Control person', phones: ['0888888888'] },
        ])
      ).rows[0].id;
      replacementContact = (
        await db.query('select public.create_contact($1) as id', [
          { display_name: 'Replacement person' },
        ])
      ).rows[0].id;
      for (const id of [created, property])
        await db.query(mutate, [
          id,
          'link',
          null,
          await revision('properties', id),
          { contact_id: shared, relation: 'owner', is_primary: true },
        ]);
      await db.query(mutate, [
        other,
        'link',
        null,
        await revision('properties', other),
        { contact_id: unrelated, relation: 'broker' },
      ]);
      const preview = (
        await db.query('select public.contact_impact($1) as impact', [shared])
      ).rows[0].impact;
      assert.deepEqual(
        preview.properties.map((r) => r.id).sort(),
        [created, property].sort(),
      );
      await db.query(mutate, [
        created,
        'contact',
        shared,
        preview.revision,
        { raw_phone_text: '0900 mới %_', phones: ['0900999999'] },
      ]);
      // The shared person row carries the correction; no property records contact history.
      assert.equal(
        (
          await db.query(
            'select raw_phone_text from public.contacts where id=$1',
            [shared],
          )
        ).rows[0].raw_phone_text,
        '0900 mới %_',
      );
      for (const id of [created, property, other]) {
        assert.equal(
          (
            await db.query(
              "select id from public.property_history where property_id=$1 and target='contact' and target_id=$2",
              [id, shared],
            )
          ).rows.length,
          0,
        );
      }
      assert.equal(
        (
          await db.query(
            'select raw_phone_text from public.contacts where id=$1',
            [unrelated],
          )
        ).rows[0].raw_phone_text,
        null,
      );
      await fails(
        mutate,
        [
          created,
          'contact',
          shared,
          preview.revision,
          { raw_phone_text: 'stale' },
        ],
        'PT409',
      );
    },
  );
  await check(
    'wrong-person link replacement and unlink preserve the shared identity without property history',
    async () => {
      const link = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, shared],
        )
      ).rows[0];
      await db.query(mutate, [
        created,
        'link',
        shared,
        link.revision,
        {
          contact_id: replacementContact,
          relation: 'representative',
          is_primary: true,
        },
      ]);
      assert.equal(
        (
          await db.query(
            'select display_name from public.contacts where id=$1',
            [shared],
          )
        ).rows[0].display_name,
        'Người chung',
      );
      assert.equal(
        (
          await db.query(
            'select contact_id from public.property_contacts where property_id=$1',
            [property],
          )
        ).rows[0].contact_id,
        shared,
      );
      const next = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, replacementContact],
        )
      ).rows[0];
      await db.query(mutate, [
        created,
        'link',
        replacementContact,
        next.revision,
        { remove: true },
      ]);
      assert.equal(
        (
          await db.query(
            'select contact_id from public.property_contacts where property_id=$1',
            [created],
          )
        ).rows.length,
        0,
      );
      assert.equal(
        (
          await db.query('select id from public.contacts where id=$1', [
            replacementContact,
          ])
        ).rows.length,
        1,
      );
      assert.equal(
        (
          await db.query(
            "select id from public.property_history where property_id=$1 and target='contact' and target_id=$2",
            [created, shared],
          )
        ).rows.length,
        0,
      );
    },
  );
  await check(
    'one primary link is replaced atomically and changed membership invalidates contact preview',
    async () => {
      await db.query(mutate, [
        created,
        'link',
        null,
        await revision('properties', created),
        { contact_id: shared, relation: 'owner' },
      ]);
      const before = (
        await db.query('select public.contact_impact($1) as impact', [shared])
      ).rows[0].impact;
      await db.query(mutate, [
        property,
        'link',
        null,
        await revision('properties', property),
        {
          contact_id: replacementContact,
          is_primary: true,
          relation: 'broker',
        },
      ]);
      assert.equal(
        (
          await db.query(
            'select contact_id from public.property_contacts where property_id=$1 and is_primary',
            [property],
          )
        ).rows[0].contact_id,
        replacementContact,
      );
      const link = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [property, shared],
        )
      ).rows[0];
      await db.query(mutate, [
        property,
        'link',
        shared,
        link.revision,
        { remove: true },
      ]);
      await fails(
        mutate,
        [
          created,
          'contact',
          shared,
          before.revision,
          { display_name: 'stale affected set' },
        ],
        'PT409',
      );
      assert.equal(
        (
          await db.query(
            'select display_name from public.contacts where id=$1',
            [shared],
          )
        ).rows[0].display_name,
        'Người chung',
      );
      const cleanupLink = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, shared],
        )
      ).rows[0];
      await db.query(mutate, [
        created,
        'link',
        shared,
        cleanupLink.revision,
        { remove: true },
      ]);
    },
  );
  // Sales journey fixture: a shared contact linked to two of another employee's readable properties,
  // plus an unlinked identity that stays outside the settled linked-detail permission.
  await db.query(mutate, [
    created,
    'link',
    null,
    await revision('properties', created),
    { contact_id: shared, relation: 'owner', is_primary: true },
  ]);
  await db.query(mutate, [
    property,
    'link',
    null,
    await revision('properties', property),
    { contact_id: shared, relation: 'broker' },
  ]);
  await db.query(mutate, [
    other,
    'link',
    null,
    await revision('properties', other),
    { contact_id: shared, relation: 'representative' },
  ]);
  const unlinkedContact = (
    await db.query('select public.create_contact($1) as id', [
      { display_name: 'Unlinked person' },
    ])
  ).rows[0].id;
  await asUser(0);
  await check(
    'any Active employee corrects a shared linked contact without property history',
    async () => {
      const preview = (
        await db.query('select public.contact_impact($1) as impact', [shared])
      ).rows[0].impact;
      assert.deepEqual(
        preview.properties.map((r) => r.id).sort(),
        [created, property, other].sort(),
      );
      // Opened from another employee's property (SGN-002, created_by employees[1]) so the correction
      // is only possible when contact-detail authority is separate from property-fact authority.
      await db.query(mutate, [
        other,
        'contact',
        shared,
        preview.revision,
        {
          display_name: 'Người chung đính chính',
          raw_phone_text: '0900 %_ mới',
        },
      ]);
      assert.deepEqual(
        (
          await db.query(
            'select display_name,raw_phone_text from public.contacts where id=$1',
            [shared],
          )
        ).rows[0],
        {
          display_name: 'Người chung đính chính',
          raw_phone_text: '0900 %_ mới',
        },
      );
      // A contact correction is no longer recorded in any property's history.
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.property_history where target='contact' and target_id=$1",
            [shared],
          )
        ).rows[0].n,
        0,
      );
      await fails(
        mutate,
        [
          created,
          'contact',
          shared,
          preview.revision,
          { display_name: 'stale' },
        ],
        'PT409',
      );
      const historyCount = async () =>
        (
          await db.query(
            "select count(*)::int as n from public.property_history where target='contact' and target_id=$1",
            [shared],
          )
        ).rows[0].n;
      const committed = await historyCount();
      await db.query(mutate, [
        property,
        'contact',
        shared,
        await revision('contacts', shared),
        { display_name: 'Người chung đính chính' },
      ]);
      assert.equal(await historyCount(), committed);
    },
  );
  await check(
    'the intentional shared-contact editor exposes recorded details without owner-contact credit',
    async () => {
      const ownerCredit = async () =>
        (
          await db.query(
            "select count(*)::int as n from public.activity_events where kind='owner_contact_access'",
          )
        ).rows[0].n;
      assert.equal(await ownerCredit(), 0);
      const preview = (
        await db.query('select public.contact_impact($1) as impact', [shared])
      ).rows[0].impact;
      assert.deepEqual(
        preview.properties.map((r) => r.id).sort(),
        [created, property, other].sort(),
      );
      assert.deepEqual(
        (
          await db.query(
            'select phones,raw_phone_text from public.contacts where id=$1',
            [shared],
          )
        ).rows[0],
        { phones: ['0900999999'], raw_phone_text: '0900 %_ mới' },
      );
      assert.equal(await ownerCredit(), 0);
    },
  );
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await check(
    'live deactivation removes the shared-contact correction authority of an existing session',
    async () => {
      const before = (
        await db.query(
          'select display_name,revision from public.contacts where id=$1',
          [shared],
        )
      ).rows[0];
      await asUser(0);
      await db.exec('reset role');
      await db.query(
        'update public.employees set is_active=false where id=$1',
        [employees[0]],
      );
      await db.exec('set role authenticated');
      try {
        await fails('select public.contact_impact($1)', [shared], '42501');
        await fails(
          mutate,
          [
            created,
            'contact',
            shared,
            before.revision,
            { display_name: 'forged after deactivation' },
          ],
          '42501',
        );
      } finally {
        await db.exec('reset role');
        await db.query(
          'update public.employees set is_active=true where id=$1',
          [employees[0]],
        );
      }
      assert.deepEqual(
        (
          await db.query(
            'select display_name,revision from public.contacts where id=$1',
            [shared],
          )
        ).rows[0],
        before,
      );
    },
  );
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await check(
    'an injected history failure rolls back a price edit',
    async () => {
      const current = (
        await db.query(
          'select sale_price_vnd::text as price,revision from public.properties where id=$1',
          [created],
        )
      ).rows[0];
      await db.exec(
        "create function private.fixture_fail_contact_history() returns trigger language plpgsql as $$ begin raise exception 'synthetic history failure' using errcode='23514'; end $$; create trigger fixture_fail_contact_history before insert on public.property_history for each row execute function private.fixture_fail_contact_history();",
      );
      await asUser(0);
      await fails(
        mutate,
        [
          created,
          'property',
          created,
          current.revision,
          { sale_price_vnd: '7654321' },
        ],
        '23514',
      );
      assert.deepEqual(
        (
          await db.query(
            'select sale_price_vnd::text as price,revision from public.properties where id=$1',
            [created],
          )
        ).rows[0],
        current,
      );
      await db.exec('reset role');
      await db.exec(
        'drop trigger fixture_fail_contact_history on public.property_history;drop function private.fixture_fail_contact_history();',
      );
    },
  );
  await asUser(0);
  await check(
    'sales creation, link, unlink and unlinked-contact correction remain denied',
    async () => {
      await fails(
        'select public.create_contact($1)',
        [{ display_name: 'forged' }],
        '42501',
      );
      await fails(
        mutate,
        [
          created,
          'link',
          null,
          await revision('properties', created),
          { contact_id: unrelated },
        ],
        '42501',
      );
      const link = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, shared],
        )
      ).rows[0];
      await fails(
        mutate,
        [created, 'link', shared, link.revision, { remove: true }],
        '42501',
      );
      const identityBefore = (
        await db.query(
          'select id,display_name,revision from public.contacts where id in ($1,$2) order by id',
          [unrelated, unlinkedContact],
        )
      ).rows;
      await fails(
        mutate,
        [
          created,
          'contact',
          unrelated,
          await revision('contacts', unrelated),
          { display_name: 'wrong parent' },
        ],
        '23514',
      );
      const unlinkedBefore = (
        await db.query(
          'select display_name,revision from public.contacts where id=$1',
          [unlinkedContact],
        )
      ).rows[0];
      await fails(
        mutate,
        [
          created,
          'contact',
          unlinkedContact,
          unlinkedBefore.revision,
          { display_name: 'forged' },
        ],
        '23514',
      );
      await fails(
        'select public.contact_impact($1)',
        [unlinkedContact],
        'PT403',
      );
      const linkedPreview = (
        await db.query('select public.contact_impact($1) as impact', [shared])
      ).rows[0].impact;
      assert.deepEqual(
        linkedPreview.properties.map((r) => r.id).sort(),
        [created, property, other].sort(),
      );
      assert.deepEqual(
        (
          await db.query(
            'select id,display_name,revision from public.contacts where id in ($1,$2) order by id',
            [unrelated, unlinkedContact],
          )
        ).rows,
        identityBefore,
      );
    },
  );
  await asUser(5);
  await check(
    'staff correct an unlinked identity through the shared boundary without property fan-out',
    async () => {
      const preview = (
        await db.query('select public.contact_impact($1) as impact', [
          unlinkedContact,
        ])
      ).rows[0].impact;
      assert.ok(preview.revision);
      assert.deepEqual(preview.properties, []);
      await db.query(mutate, [
        created,
        'contact',
        unlinkedContact,
        preview.revision,
        { display_name: 'Người chưa liên kết đính chính' },
      ]);
      assert.equal(
        (
          await db.query(
            'select display_name from public.contacts where id=$1',
            [unlinkedContact],
          )
        ).rows[0].display_name,
        'Người chưa liên kết đính chính',
      );
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.property_history where target='contact' and target_id=$1",
            [unlinkedContact],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await asUser(0);
  await check(
    'shared-contact edit rejects a stale opened parent after serialization',
    async () => {
      const parentRevision = await revision('properties', created);
      const contactRevision = await revision('contacts', shared);
      await db.exec('reset role');
      await db.exec(`
        create table private.fixture_parent_revision_bump(property_id uuid primary key);
        create or replace function private.maintenance_gate() returns void language plpgsql security definer set search_path='' as $$
        declare parent uuid;
        begin
          perform pg_advisory_xact_lock(7317,7);
          select property_id into parent from private.fixture_parent_revision_bump limit 1;
          if parent is not null then
            delete from private.fixture_parent_revision_bump;
            update public.properties set notes=coalesce(notes,'')||' synthetic parent race' where id=parent;
          end if;
        end;
        $$;
      `);
      await db.query(
        'insert into private.fixture_parent_revision_bump(property_id) values($1)',
        [created],
      );
      await asUser(0);
      try {
        await fails(
          'select public.maintain_property($1,$2,$3,$4,$5,$6)',
          [
            created,
            'contact',
            shared,
            contactRevision,
            { display_name: 'stale parent race' },
            parentRevision,
          ],
          'PT409',
        );
      } finally {
        await db.exec('reset role');
        await db.exec(`
          create or replace function private.maintenance_gate() returns void language sql security invoker set search_path='' as $$
            select pg_advisory_xact_lock(7317,7);
          $$;
          drop table if exists private.fixture_parent_revision_bump;
        `);
        await asUser(0);
      }
      assert.notEqual(
        (
          await db.query(
            'select display_name from public.contacts where id=$1',
            [shared],
          )
        ).rows[0].display_name,
        'stale parent race',
      );
    },
  );
  await asUser(2);
  await check(
    'a shared contact linked to an archived property denies an ordinary employee the preview and the correction',
    async () => {
      const archivedParent = (
        await db.query('select public.create_property($1,$2,$3) as id', [
          'sale',
          {},
          { format: 'legacy', address_text: 'Synthetic archived parent' },
        ])
      ).rows[0].id;
      await db.query(mutate, [
        archivedParent,
        'link',
        null,
        await revision('properties', archivedParent),
        { contact_id: shared, relation: 'owner' },
      ]);
      await db.query(mutate, [
        archivedParent,
        'property',
        archivedParent,
        await revision('properties', archivedParent),
        { archived_at: new Date().toISOString() },
      ]);
      const archivedRevision = await revision('properties', archivedParent);
      await asUser(0);
      await fails('select public.contact_impact($1)', [shared], 'PT403');
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5,$6)',
        [
          archivedParent,
          'contact',
          shared,
          await revision('contacts', shared),
          { display_name: 'forged' },
          archivedRevision,
        ],
        '42501',
      );
      // Unarchived parent: only the affected-set boundary inside the operation can refuse this.
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5,$6)',
        [
          created,
          'contact',
          shared,
          await revision('contacts', shared),
          { display_name: 'forged' },
          await revision('properties', created),
        ],
        'PT403',
      );
      await asUser(2);
    },
  );
  await asUser(2);
  await check(
    'ordinary maintenance does not bypass independently owned sale transitions',
    async () => {
      await fails(
        mutate,
        [
          created,
          'property',
          created,
          await revision('properties', created),
          { status: 'sold' },
        ],
        '23514',
      );
      assert.equal(
        (
          await db.query('select status from public.properties where id=$1', [
            created,
          ])
        ).rows[0].status,
        'available',
      );
    },
  );
  await check(
    'same editor optionally verifies mapping; mapped correction clears it while unrelated edits preserve it',
    async () => {
      const addr = (
        await db.query(
          "select id,revision from public.property_addresses where property_id=$1 and format='current' and is_primary",
          [created],
        )
      ).rows[0];
      const evidence = {
        province_unit_id: '50000000-0000-4000-8000-000000000001',
        commune_unit_id: '50000000-0000-4000-8000-000000000003',
        mapping_status: 'verified',
        verification_method: 'manual',
        source_url: 'https://example.test/property-evidence',
        effective_on: '2026-10-10',
        mapping_evidence:
          'The property parcel boundary establishes this commune',
      };
      await fails(
        mutate,
        [
          created,
          'mapping',
          addr.id,
          addr.revision,
          { ...evidence, mapping_evidence: null },
        ],
        '23514',
      );
      await fails(
        mutate,
        [
          created,
          'mapping',
          addr.id,
          addr.revision,
          { ...evidence, verification_method: 'official_whole_mapping' },
        ],
        '23514',
      );
      await db.query(mutate, [
        created,
        'mapping',
        addr.id,
        addr.revision,
        evidence,
      ]);
      assert.equal(
        (
          await db.query(
            'select verified_by from public.property_addresses where id=$1',
            [addr.id],
          )
        ).rows[0].verified_by,
        employees[2],
      );
      await db.query(mutate, [
        created,
        'property',
        created,
        await revision('properties', created),
        { sale_price_vnd: '12000000' },
      ]);
      assert.equal(
        (
          await db.query(
            'select mapping_status from public.property_addresses where id=$1',
            [addr.id],
          )
        ).rows[0].mapping_status,
        'verified',
      );
      const primaryId = (
        await db.query(mutate, [
          created,
          'address',
          addr.id,
          await revision('property_addresses', addr.id),
          { is_primary: true },
        ])
      ).rows[0].id;
      assert.equal(primaryId, addr.id);
      assert.equal(
        (
          await db.query(
            'select mapping_status from public.property_addresses where id=$1',
            [addr.id],
          )
        ).rows[0].mapping_status,
        'verified',
      );
      const next = (
        await db.query(mutate, [
          created,
          'address',
          addr.id,
          await revision('property_addresses', addr.id),
          { street: 'Corrected street' },
        ])
      ).rows[0].id;
      assert.equal(
        (
          await db.query(
            'select mapping_status from public.property_addresses where id=$1',
            [next],
          )
        ).rows[0].mapping_status,
        'unresolved',
      );
      assert.equal(
        (
          await db.query(
            'select mapping_status from public.property_addresses where id=$1',
            [addr.id],
          )
        ).rows[0].mapping_status,
        'unresolved',
      );
      assert.equal(
        (
          await db.query(
            'select address_text from public.property_addresses where id=$1',
            [addr.id],
          )
        ).rows[0].address_text,
        'Current corrected',
      );
    },
  );
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  await check(
    'original legacy contents and existing codes are database-immutable even outside RPC',
    async () => {
      const addr = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy' order by created_at limit 1",
          [created],
        )
      ).rows[0];
      await fails(
        "update public.property_addresses set address_text='discard evidence' where id=$1",
        [addr.id],
        '23514',
      );
      await fails(
        "update public.properties set property_code='renamed' where id=$1",
        [created],
        '23514',
      );
    },
  );
  await check(
    'history failure rolls back creation rather than leaving partial inventory',
    async () => {
      await db.exec(
        "create function private.fixture_fail_history() returns trigger language plpgsql as $$ begin raise exception 'synthetic history failure' using errcode='23514'; end $$; create trigger fixture_fail_history before insert on public.property_history for each row execute function private.fixture_fail_history();",
      );
      await asUser(0);
      const before = (
        await db.query('select id from public.properties order by id')
      ).rows;
      await fails(
        'select public.create_property($1,$2,$3)',
        [
          'rent',
          { monthly_rent_vnd: '5000000' },
          { format: 'current', address_text: 'Rollback fixture' },
        ],
        '23514',
      );
      assert.deepEqual(
        (await db.query('select id from public.properties order by id')).rows,
        before,
      );
      await db.exec('reset role');
      await db.exec(
        'drop trigger fixture_fail_history on public.property_history; drop function private.fixture_fail_history();',
      );
    },
  );
  await asUser(0);
  await check(
    'primary transitions require both entity and parent revisions, including sibling changes',
    async () => {
      const parentRev = await revision('properties', created);
      const addr = (
        await db.query(
          "select id,revision from public.property_addresses where property_id=$1 and format='current' and is_primary",
          [created],
        )
      ).rows[0];
      await db.query(mutate, [
        created,
        'property',
        created,
        parentRev,
        { notes: 'A newer unrelated fact' },
      ]);
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5,$6)',
        [
          created,
          'address',
          addr.id,
          addr.revision,
          { is_primary: true },
          parentRev,
        ],
        'PT409',
      );
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5)',
        [created, 'property', created, parentRev, { notes: 'bypass' }],
        '42883',
      );
    },
  );
  await asUser(0);
  await check(
    'multi-field Vietnamese change sets above the legacy 8 KiB cap still save',
    async () => {
      const bulk = 'ự'.repeat(2000);
      await db.query(mutate, [
        created,
        'property',
        created,
        await revision('properties', created),
        { notes: bulk, construction_text: bulk, area_raw: bulk },
      ]);
      assert.deepEqual(
        (
          await db.query(
            'select notes,construction_text,area_raw from public.properties where id=$1',
            [created],
          )
        ).rows[0],
        { notes: bulk, construction_text: bulk, area_raw: bulk },
      );
    },
  );
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub','',false)");
  const alternate = (
    await db.query(
      "insert into public.property_addresses(property_id,format,address_text,is_primary) values($1,'alternate','Địa chỉ khác chưa phân loại',false) returning id,revision",
      [created],
    )
  ).rows[0];
  await asUser(0);
  await check(
    'an existing alternate address can be corrected without changing its format',
    async () => {
      const successor = (
        await db.query(mutate, [
          created,
          'address',
          alternate.id,
          await revision('property_addresses', alternate.id),
          { address_text: 'Địa chỉ khác đã đính chính' },
        ])
      ).rows[0].id;
      assert.deepEqual(
        (
          await db.query(
            'select format,supersedes_address_id,address_text from public.property_addresses where id=$1',
            [successor],
          )
        ).rows[0],
        {
          format: 'alternate',
          supersedes_address_id: alternate.id,
          address_text: 'Địa chỉ khác đã đính chính',
        },
      );
      assert.deepEqual(
        (
          await db.query(
            'select address_text,is_primary from public.property_addresses where id=$1',
            [alternate.id],
          )
        ).rows[0],
        { address_text: 'Địa chỉ khác chưa phân loại', is_primary: false },
      );
      // An address correction is no longer recorded in the property history.
      assert.equal(
        (
          await db.query(
            "select count(*)::int as n from public.property_history where property_id=$1 and target='address' and target_id=$2",
            [created, successor],
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await check(
    'a new address cannot be created with format alternate',
    async () => {
      const before = (
        await db.query(
          'select id from public.property_addresses where property_id=$1 order by id',
          [created],
        )
      ).rows;
      await fails(
        mutate,
        [
          created,
          'address',
          null,
          await revision('properties', created),
          { format: 'alternate', address_text: 'Không được tạo mới' },
        ],
        '23514',
      );
      assert.deepEqual(
        (
          await db.query(
            'select id from public.property_addresses where property_id=$1 order by id',
            [created],
          )
        ).rows,
        before,
      );
    },
  );
  return created;
}
