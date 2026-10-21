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
          await db.query(
            'select id from public.page_inventory(p_query => $1)',
            ['nguon 50%_'],
          )
        ).rows,
        [{ id: created }],
      );
    },
  );
  const coordinates = async () =>
    (
      await db.query(
        'select latitude::text as lat,longitude::text as lng from public.properties where id=$1',
        [created],
      )
    ).rows[0];
  await check(
    'location point saves, clears and enforces range and both-or-neither',
    async () => {
      let rev = await revision('properties', created);
      await db.query(mutate, [
        created,
        'property',
        created,
        rev,
        { latitude: '10.7626220', longitude: '106.6601720' },
      ]);
      assert.deepEqual(await coordinates(), {
        lat: '10.7626220',
        lng: '106.6601720',
      });
      // A change must name both axes; a lone axis cannot mix a new value with the stored one.
      rev = await revision('properties', created);
      await fails(
        mutate,
        [created, 'property', created, rev, { latitude: '10.8000000' }],
        '23514',
      );
      await fails(
        mutate,
        [created, 'property', created, rev, { longitude: '106.7000000' }],
        '23514',
      );
      assert.deepEqual(await coordinates(), {
        lat: '10.7626220',
        lng: '106.6601720',
      });
      // Out-of-range coordinates are rejected by the column checks, mapped to 23514.
      rev = await revision('properties', created);
      await fails(
        mutate,
        [
          created,
          'property',
          created,
          rev,
          { latitude: '91', longitude: '106.5' },
        ],
        '23514',
      );
      await fails(
        mutate,
        [
          created,
          'property',
          created,
          rev,
          { latitude: '10.5', longitude: '-180.0000001' },
        ],
        '23514',
      );
      // Clearing sets both back to null together.
      rev = await revision('properties', created);
      await db.query(mutate, [
        created,
        'property',
        created,
        rev,
        { latitude: null, longitude: null },
      ]);
      assert.deepEqual(await coordinates(), { lat: null, lng: null });
      // A lone coordinate cannot restore a cleared point.
      rev = await revision('properties', created);
      await fails(
        mutate,
        [created, 'property', created, rev, { latitude: '10.7626220' }],
        '23514',
      );
      // An ordinary employee cannot set a location on someone else's property.
      await fails(
        mutate,
        [
          other,
          'property',
          other,
          await revision('properties', other),
          { latitude: '10.7626220', longitude: '106.6601720' },
        ],
        '42501',
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
            "select id from public.page_inventory(p_query => 'ly thuong kiet') where id=$1",
            [created],
          )
        ).rows,
        [{ id: created }],
      );
      assert.deepEqual(
        (
          await db.query(
            "select id from public.page_inventory(p_query => 'nguyen trai') where id=$1",
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
  await check(
    'a stale link revision refuses a wrong-person replacement instead of overwriting it',
    async () => {
      const staleSubject = (
        await db.query('select public.create_contact($1) as id', [
          { display_name: 'Stale subject person' },
        ])
      ).rows[0].id;
      const staleReplacement = (
        await db.query('select public.create_contact($1) as id', [
          { display_name: 'Stale replacement person' },
        ])
      ).rows[0].id;
      await db.query(mutate, [
        created,
        'link',
        null,
        await revision('properties', created),
        { contact_id: staleSubject, relation: 'unknown' },
      ]);
      const linkRev = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, staleSubject],
        )
      ).rows[0].revision;
      // A real relation change bumps the link revision; `mutate` keeps the parent fresh.
      await db.query(mutate, [
        created,
        'link',
        staleSubject,
        linkRev,
        { relation: 'broker' },
      ]);
      await fails(
        mutate,
        [
          created,
          'link',
          staleSubject,
          linkRev,
          { contact_id: staleReplacement },
        ],
        'PT409',
      );
      assert.deepEqual(
        (
          await db.query(
            'select contact_id,relation from public.property_contacts where property_id=$1 and contact_id=$2',
            [created, staleSubject],
          )
        ).rows,
        [{ contact_id: staleSubject, relation: 'broker' }],
      );
      assert.equal(
        (
          await db.query(
            'select contact_id from public.property_contacts where property_id=$1 and contact_id=$2',
            [created, staleReplacement],
          )
        ).rows.length,
        0,
      );
    },
  );
  await check(
    'link create, wrong-person and unlink leave an attributable audit trail with before/after',
    async () => {
      const auditSubject = (
        await db.query('select public.create_contact($1) as id', [
          { display_name: 'Audit subject person' },
        ])
      ).rows[0].id;
      const auditReplacement = (
        await db.query('select public.create_contact($1) as id', [
          { display_name: 'Audit replacement person' },
        ])
      ).rows[0].id;
      const staffAuth = (
        await db.query(
          'select auth_user_id from public.employees where id=$1',
          [employees[5]],
        )
      ).rows[0].auth_user_id;
      // Create, wrong-person replace and unlink all run through the guarded link branch.
      await db.query(mutate, [
        created,
        'link',
        null,
        await revision('properties', created),
        { contact_id: auditSubject, relation: 'unknown' },
      ]);
      const linkRev = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, auditSubject],
        )
      ).rows[0].revision;
      await db.query(mutate, [
        created,
        'link',
        auditSubject,
        linkRev,
        { contact_id: auditReplacement, relation: 'broker' },
      ]);
      const relinkRev = (
        await db.query(
          'select revision from public.property_contacts where property_id=$1 and contact_id=$2',
          [created, auditReplacement],
        )
      ).rows[0].revision;
      await db.query(mutate, [
        created,
        'link',
        auditReplacement,
        relinkRev,
        { remove: true },
      ]);
      // property_history stays price-only, but the private audit trail still attributes the
      // relationship changes with actor, time and before/after (issue #72 + #109).
      await db.exec('reset role');
      const rows = (
        await db.query(
          "select actor_user_id,action,before_data,after_data,created_at from private.audit_events where table_name='property_contacts' and record_key=$1 and (before_data->>'contact_id'=$2 or after_data->>'contact_id'=$2 or before_data->>'contact_id'=$3 or after_data->>'contact_id'=$3) order by id",
          [created, auditSubject, auditReplacement],
        )
      ).rows;
      const insertRow = rows.find((r) => r.action === 'INSERT');
      assert.ok(insertRow, 'create writes an audit INSERT row');
      assert.equal(insertRow.actor_user_id, staffAuth);
      assert.equal(insertRow.before_data, null);
      assert.equal(insertRow.after_data.contact_id, auditSubject);
      assert.ok(insertRow.created_at);
      const updateRow = rows.find((r) => r.action === 'UPDATE');
      assert.ok(
        updateRow,
        'wrong-person replacement writes an audit UPDATE row',
      );
      assert.equal(updateRow.actor_user_id, staffAuth);
      assert.equal(updateRow.before_data.contact_id, auditSubject);
      assert.equal(updateRow.after_data.contact_id, auditReplacement);
      const deleteRow = rows.find((r) => r.action === 'DELETE');
      assert.ok(deleteRow, 'unlink writes an audit DELETE row');
      assert.equal(deleteRow.actor_user_id, staffAuth);
      assert.equal(deleteRow.before_data.contact_id, auditReplacement);
      assert.equal(deleteRow.after_data, null);
      await asUser(5);
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
  // Issue #226: a saved legacy ward reports what the official crosswalk says, and the one offered
  // action records the current address it names as an unverified candidate. The seeded crosswalk is
  // the fixture, so these cases run against the same rows a person would see.
  const wardChain = async (condition) => {
    const ward = (
      await db.query(
        `select w.id,w.parent_id as district,d.parent_id as province
         from public.admin_unit_versions w join public.admin_unit_versions d on d.id=w.parent_id
         where w.unit_level='commune' and w.valid_from=date '2025-01-04' and ${condition}
         order by w.official_code limit 1`,
      )
    ).rows[0];
    return {
      ...ward,
      crosswalk: (
        await db.query(
          'select relation,to_unit_id,effective_on::text as effective_on,source_url from public.admin_unit_crosswalks where from_unit_id=$1',
          [ward.id],
        )
      ).rows,
    };
  };
  const createLegacy = async (chain) =>
    (
      await db.query('select public.create_property($1,$2,$3) as id', [
        'sale',
        {},
        {
          format: 'legacy',
          address_text: 'Nhà cũ theo bảng chuyển đổi',
          province_unit_id: chain.province,
          district_unit_id: chain.district,
          commune_unit_id: chain.id,
        },
      ])
    ).rows[0].id;
  const refuseWith = async (sql, params, code, pattern) => {
    let error;
    try {
      await db.query(sql, params);
    } catch (caught) {
      error = caught;
    }
    assert.ok(error, 'expected the database to refuse the write');
    assert.equal(error.code, code);
    if (pattern) assert.match(error.message, pattern);
  };
  const addressesOf = async (propertyId) =>
    (
      await db.query(
        'select id,format,is_primary from public.property_addresses where property_id=$1 order by format desc,created_at',
        [propertyId],
      )
    ).rows.filter((row) => row.format !== 'alternate');
  // The rule the surface applies, mirrored in SQL: a current address counts as recorded only for the
  // target the ward the saved row now names maps to, so a chain that recorded another ward's target
  // answers nothing (issue #236).
  const recordedFrom = async (propertyId, legacyId, targetId) =>
    (
      await db.query(
        `with recursive family(id,parent_id) as (
           select a.id,a.supersedes_address_id from public.property_addresses a where a.id=$1
           union
           select a.id,a.supersedes_address_id from public.property_addresses a
             join family f on a.supersedes_address_id=f.id or a.id=f.parent_id
           where a.property_id=$2 and a.format='legacy')
         select count(*)::int as recorded from public.property_addresses c
           join family f on f.id=c.supersedes_address_id
         where c.property_id=$2 and c.format='current' and c.commune_unit_id=$3`,
        [legacyId, propertyId, targetId],
      )
    ).rows[0].recorded;
  const offered = await wardChain(
    "(select count(*) from public.admin_unit_crosswalks x where x.from_unit_id=w.id)=1 and exists(select 1 from public.admin_unit_crosswalks x where x.from_unit_id=w.id and x.relation in ('whole','rename'))",
  );
  const several = await wardChain(
    '(select count(*) from public.admin_unit_crosswalks x where x.from_unit_id=w.id)>1',
  );
  const uncovered = await wardChain(
    'not exists(select 1 from public.admin_unit_crosswalks x where x.from_unit_id=w.id)',
  );
  let offeredProperty, offeredLegacy, candidateAddress, candidateRevision;
  await asUser(0);
  await check(
    'an ordinary editor records the crosswalk current ward as a candidate and the legacy address is unchanged',
    async () => {
      offeredProperty = await createLegacy(offered);
      offeredLegacy = (
        await db.query(
          "select id,address_text,province_unit_id,district_unit_id,commune_unit_id from public.property_addresses where property_id=$1 and format='legacy'",
          [offeredProperty],
        )
      ).rows[0];
      const target = offered.crosswalk[0];
      candidateAddress = (
        await db.query(
          'select public.record_address_candidate($1,$2,$3) as id',
          [
            offeredProperty,
            offeredLegacy.id,
            await revision('properties', offeredProperty),
          ],
        )
      ).rows[0].id;
      const created2 = (
        await db.query(
          'select address_text,province_unit_id,commune_unit_id,district_unit_id,mapping_status,effective_on::text as effective_on,source_url,verification_method,verified_by,verified_at,mapping_evidence,is_primary,supersedes_address_id from public.property_addresses where id=$1',
          [candidateAddress],
        )
      ).rows[0];
      // The recorded source text is carried over; the target province and commune come from the
      // crosswalk row itself, its effective date and source URL travel with the candidate, and the
      // row states no district because the current generation has none.
      assert.deepEqual(created2, {
        address_text: 'Nhà cũ theo bảng chuyển đổi',
        province_unit_id: (
          await db.query(
            'select parent_id from public.admin_unit_versions where id=$1',
            [target.to_unit_id],
          )
        ).rows[0].parent_id,
        commune_unit_id: target.to_unit_id,
        district_unit_id: null,
        mapping_status: 'candidate',
        effective_on: '2025-07-01',
        source_url: target.source_url,
        verification_method: null,
        verified_by: null,
        verified_at: null,
        mapping_evidence: null,
        is_primary: true,
        supersedes_address_id: offeredLegacy.id,
      });
      // Both rows stay primary: one primary per format, and the legacy record is not touched.
      assert.deepEqual(await addressesOf(offeredProperty), [
        { id: offeredLegacy.id, format: 'legacy', is_primary: true },
        { id: candidateAddress, format: 'current', is_primary: true },
      ]);
      assert.deepEqual(
        (
          await db.query(
            'select address_text,province_unit_id,district_unit_id,commune_unit_id,mapping_status from public.property_addresses where id=$1',
            [offeredLegacy.id],
          )
        ).rows[0],
        {
          address_text: offeredLegacy.address_text,
          province_unit_id: offeredLegacy.province_unit_id,
          district_unit_id: offeredLegacy.district_unit_id,
          commune_unit_id: offeredLegacy.commune_unit_id,
          mapping_status: 'unresolved',
        },
      );
      candidateRevision = await revision(
        'property_addresses',
        candidateAddress,
      );
    },
  );
  await check(
    'the offered action is recorded once: following it again writes nothing',
    async () => {
      await refuseWith(
        'select public.record_address_candidate($1,$2,$3)',
        [
          offeredProperty,
          offeredLegacy.id,
          await revision('properties', offeredProperty),
        ],
        '23505',
        /already recorded from this legacy address/,
      );
      assert.equal((await addressesOf(offeredProperty)).length, 2);
    },
  );
  await check(
    'the same editor still cannot verify mapping, and a candidate demands its date and source',
    async () => {
      await refuseWith(
        mutate,
        [
          offeredProperty,
          'mapping',
          candidateAddress,
          candidateRevision,
          { mapping_status: 'verified' },
        ],
        '42501',
        /reviewer required for mapping/,
      );
      assert.deepEqual(
        (
          await db.query(
            'select mapping_status,verified_by,verified_at,effective_on::text as effective_on from public.property_addresses where id=$1',
            [candidateAddress],
          )
        ).rows[0],
        {
          mapping_status: 'candidate',
          verified_by: null,
          verified_at: null,
          effective_on: '2025-07-01',
        },
      );
      // A candidate still has to state when its source took effect and where it came from, so an
      // unresolved current address cannot simply be marked as one.
      const plain = (
        await db.query(mutate, [
          offeredProperty,
          'address',
          null,
          await revision('properties', offeredProperty),
          { format: 'current', address_text: 'Địa chỉ hiện tại chưa ánh xạ' },
        ])
      ).rows[0].id;
      await refuseWith(
        mutate,
        [
          offeredProperty,
          'mapping',
          plain,
          await revision('property_addresses', plain),
          { mapping_status: 'candidate' },
        ],
        '23514',
        /candidate mapping requires an effective date and a source url/,
      );
      assert.deepEqual(
        (
          await db.query(
            'select mapping_status,effective_on,source_url from public.property_addresses where id=$1',
            [plain],
          )
        ).rows[0],
        { mapping_status: 'unresolved', effective_on: null, source_url: null },
      );
      // The same state, then, is accepted from that editor once the source is stated, and it still
      // carries no verification stamp.
      await db.query(mutate, [
        offeredProperty,
        'mapping',
        plain,
        await revision('property_addresses', plain),
        {
          mapping_status: 'candidate',
          effective_on: '2025-07-01',
          source_url: 'https://example.test/official-conversion-table',
        },
      ]);
      assert.deepEqual(
        (
          await db.query(
            'select mapping_status,effective_on::text as effective_on,verified_by,verified_at from public.property_addresses where id=$1',
            [plain],
          )
        ).rows[0],
        {
          mapping_status: 'candidate',
          effective_on: '2025-07-01',
          verified_by: null,
          verified_at: null,
        },
      );
    },
  );
  await check(
    'a verified mapping is a reviewer record: an ordinary editor cannot un-verify it or repoint it',
    async () => {
      await asUser(2);
      await db.query(mutate, [
        offeredProperty,
        'mapping',
        candidateAddress,
        await revision('property_addresses', candidateAddress),
        {
          mapping_status: 'verified',
          verification_method: 'manual',
          effective_on: '2025-07-01',
          source_url: 'https://example.test/property-evidence',
          mapping_evidence:
            'The property parcel boundary establishes this commune',
        },
      ]);
      const verifiedRow =
        'select province_unit_id,commune_unit_id,mapping_status,verified_by,verified_at,effective_on,source_url from public.property_addresses where id=$1';
      const verified = (await db.query(verifiedRow, [candidateAddress]))
        .rows[0];
      assert.equal(verified.mapping_status, 'verified');
      assert.equal(verified.verified_by, employees[2]);
      // The editor who may record a candidate on an unverified row is refused the moment that row
      // is a reviewer's verification: demoting it to a candidate, or repointing the units it
      // verified, is not recording a candidate.
      await asUser(0);
      for (const changes of [
        {
          mapping_status: 'candidate',
          effective_on: '2025-07-01',
          source_url: 'https://example.test/official-conversion-table',
        },
        {
          mapping_status: 'candidate',
          commune_unit_id: '50000000-0000-4000-8000-000000000003',
          effective_on: '2025-07-01',
          source_url: 'https://example.test/official-conversion-table',
        },
        { mapping_status: 'verified' },
      ]) {
        await refuseWith(
          mutate,
          [
            offeredProperty,
            'mapping',
            candidateAddress,
            await revision('property_addresses', candidateAddress),
            changes,
          ],
          '42501',
          /reviewer required for mapping/,
        );
      }
      assert.deepEqual(
        (await db.query(verifiedRow, [candidateAddress])).rows[0],
        verified,
      );
    },
  );
  await check(
    'a ward with several crosswalk targets or none writes no current address',
    async () => {
      assert.equal(several.crosswalk.length > 1, true);
      assert.equal(uncovered.crosswalk.length, 0);
      for (const chain of [several, uncovered]) {
        const propertyId = await createLegacy(chain);
        const legacy = (
          await db.query(
            "select id from public.property_addresses where property_id=$1 and format='legacy'",
            [propertyId],
          )
        ).rows[0];
        await refuseWith(
          'select public.record_address_candidate($1,$2,$3)',
          [propertyId, legacy.id, await revision('properties', propertyId)],
          '23514',
          /one whole crosswalk target required/,
        );
        assert.deepEqual(await addressesOf(propertyId), [
          { id: legacy.id, format: 'legacy', is_primary: true },
        ]);
      }
    },
  );
  await check(
    'a stale property revision or a colleague without edit authority records nothing',
    async () => {
      await refuseWith(
        'select public.record_address_candidate($1,$2,$3)',
        [
          offeredProperty,
          offeredLegacy.id,
          '90000000-0000-4000-8000-000000000001',
        ],
        'PT409',
        /stale property context/,
      );
      await asUser(1);
      await refuseWith(
        'select public.record_address_candidate($1,$2,$3)',
        [
          offeredProperty,
          offeredLegacy.id,
          await revision('properties', offeredProperty),
        ],
        '42501',
        /property edit denied/,
      );
      await asUser(0);
      // Nothing above recorded a further address for this property.
      assert.equal((await addressesOf(offeredProperty)).length, 3);
    },
  );
  await check(
    'a correction of a legacy row whose candidate is recorded reports that state instead of a dead action',
    async () => {
      const correctedLegacy = (
        await db.query(mutate, [
          offeredProperty,
          'address',
          offeredLegacy.id,
          await revision('property_addresses', offeredLegacy.id),
          { address_text: 'Nhà cũ đã sửa theo bảng chuyển đổi' },
        ])
      ).rows[0].id;
      assert.notEqual(correctedLegacy, offeredLegacy.id);
      assert.deepEqual(
        (
          await db.query(
            'select format,supersedes_address_id from public.property_addresses where id=$1',
            [correctedLegacy],
          )
        ).rows[0],
        { format: 'legacy', supersedes_address_id: offeredLegacy.id },
      );
      // The corrected row answers recorded through its own chain, so the save reports the state
      // rather than an action that would only be refused - and it still records the same ward.
      assert.equal(
        await recordedFrom(
          offeredProperty,
          offeredLegacy.id,
          offered.crosswalk[0].to_unit_id,
        ),
        1,
      );
      assert.equal(
        await recordedFrom(
          offeredProperty,
          correctedLegacy,
          offered.crosswalk[0].to_unit_id,
        ),
        1,
      );
      await refuseWith(
        'select public.record_address_candidate($1,$2,$3)',
        [
          offeredProperty,
          correctedLegacy,
          await revision('properties', offeredProperty),
        ],
        '23505',
        /already recorded from this legacy address/,
      );
      assert.equal((await addressesOf(offeredProperty)).length, 4);
    },
  );
  await check(
    'a correction that changes the saved ward reports and records that ward mapping once',
    async () => {
      // A ward whose crosswalk names a different current ward than the one this chain already
      // recorded: the saved row's own mapping is what the surface must report, not the recorded state.
      const changed = await wardChain(
        `(select count(*) from public.admin_unit_crosswalks x where x.from_unit_id=w.id)=1 and exists(select 1 from public.admin_unit_crosswalks x where x.from_unit_id=w.id and x.relation in ('whole','rename') and x.to_unit_id<>'${offered.crosswalk[0].to_unit_id}')`,
      );
      const propertyId = await createLegacy(offered);
      const legacy = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy'",
          [propertyId],
        )
      ).rows[0].id;
      const firstCandidate = (
        await db.query(
          'select public.record_address_candidate($1,$2,$3) as id',
          [propertyId, legacy, await revision('properties', propertyId)],
        )
      ).rows[0].id;
      // The save that corrects the ward writes the legacy successor the next surface reads.
      const corrected = (
        await db.query(mutate, [
          propertyId,
          'address',
          legacy,
          await revision('property_addresses', legacy),
          {
            province_unit_id: changed.province,
            district_unit_id: changed.district,
            commune_unit_id: changed.id,
          },
        ])
      ).rows[0].id;
      assert.deepEqual(
        (
          await db.query(
            'select format,commune_unit_id,supersedes_address_id from public.property_addresses where id=$1',
            [corrected],
          )
        ).rows[0],
        {
          format: 'legacy',
          commune_unit_id: changed.id,
          supersedes_address_id: legacy,
        },
      );
      // The chain's recorded candidate answers for the ward it was recorded at, which the saved row
      // no longer names: the surface reports this ward's mapping instead of that recorded state.
      const recordedTarget = offered.crosswalk[0].to_unit_id,
        changedTarget = changed.crosswalk[0].to_unit_id;
      assert.equal(
        await recordedFrom(propertyId, corrected, recordedTarget),
        1,
      );
      assert.equal(await recordedFrom(propertyId, corrected, changedTarget), 0);
      // The guard answers the same way: the saved ward records its own target exactly once.
      const secondCandidate = (
        await db.query(
          'select public.record_address_candidate($1,$2,$3) as id',
          [propertyId, corrected, await revision('properties', propertyId)],
        )
      ).rows[0].id;
      assert.deepEqual(
        (
          await db.query(
            'select format,mapping_status,province_unit_id,commune_unit_id,supersedes_address_id,is_primary from public.property_addresses where id=$1',
            [secondCandidate],
          )
        ).rows[0],
        {
          format: 'current',
          mapping_status: 'candidate',
          province_unit_id: (
            await db.query(
              'select parent_id from public.admin_unit_versions where id=$1',
              [changedTarget],
            )
          ).rows[0].parent_id,
          commune_unit_id: changedTarget,
          supersedes_address_id: corrected,
          is_primary: true,
        },
      );
      assert.equal(await recordedFrom(propertyId, corrected, changedTarget), 1);
      // A second attempt for that ward is refused, and so is one for the ward the chain recorded first.
      for (const attempt of [corrected, legacy])
        await refuseWith(
          'select public.record_address_candidate($1,$2,$3)',
          [propertyId, attempt, await revision('properties', propertyId)],
          '23505',
          /already recorded from this legacy address/,
        );
      // The earlier ward's current address is kept, demoted by the new primary, and the legacy chain
      // still holds its own rows: one primary per format either way.
      const addresses = (
        await db.query(
          "select id,format,is_primary from public.property_addresses where property_id=$1 and format<>'alternate'",
          [propertyId],
        )
      ).rows;
      assert.deepEqual(
        addresses
          .filter((row) => row.is_primary)
          .map((row) => row.id)
          .sort(),
        [corrected, secondCandidate].sort(),
      );
      assert.deepEqual(
        addresses.filter((row) => row.id === firstCandidate),
        [{ id: firstCandidate, format: 'current', is_primary: false }],
      );
    },
  );
  await check(
    'a second legacy address at another ward records its own candidate',
    async () => {
      const secondWard = await wardChain(
        `w.id<>'${offered.id}' and (select count(*) from public.admin_unit_crosswalks x where x.from_unit_id=w.id)=1 and exists(select 1 from public.admin_unit_crosswalks x where x.from_unit_id=w.id and x.relation in ('whole','rename'))`,
      );
      const secondLegacy = (
        await db.query(mutate, [
          offeredProperty,
          'address',
          null,
          await revision('properties', offeredProperty),
          {
            format: 'legacy',
            address_text: 'Địa chỉ cũ thứ hai theo bảng chuyển đổi',
            province_unit_id: secondWard.province,
            district_unit_id: secondWard.district,
            commune_unit_id: secondWard.id,
            is_primary: false,
          },
        ])
      ).rows[0].id;
      const secondCandidate = (
        await db.query(
          'select public.record_address_candidate($1,$2,$3) as id',
          [
            offeredProperty,
            secondLegacy,
            await revision('properties', offeredProperty),
          ],
        )
      ).rows[0].id;
      assert.deepEqual(
        (
          await db.query(
            'select format,mapping_status,commune_unit_id,supersedes_address_id from public.property_addresses where id=$1',
            [secondCandidate],
          )
        ).rows[0],
        {
          format: 'current',
          mapping_status: 'candidate',
          commune_unit_id: secondWard.crosswalk[0].to_unit_id,
          supersedes_address_id: secondLegacy,
        },
      );
      // Each candidate answers for its own legacy row, so the first one is untouched.
      assert.equal(
        (
          await db.query(
            'select supersedes_address_id from public.property_addresses where id=$1',
            [candidateAddress],
          )
        ).rows[0].supersedes_address_id,
        offeredLegacy.id,
      );
    },
  );
  // Issue #234: an existing address switches format only through the deliberate conversion action.
  // The crosswalk rows are the fixture, so these cases read the same evidence a person would see,
  // and every refusal is checked to leave the property's addresses exactly as they were.
  const convert = 'select public.convert_address_format($1,$2,$3,$4) as id';
  const addressRow = async (id) =>
    (
      await db.query(
        'select address_text,format,province_unit_id,district_unit_id,commune_unit_id,mapping_status,effective_on::text as effective_on,source_url,verification_method,verified_by,verified_at,mapping_evidence,is_primary,supersedes_address_id from public.property_addresses where id=$1',
        [id],
      )
    ).rows[0];
  // A whole-row snapshot, so "unmodified in every field" is proven rather than sampled.
  const addressSnapshot = async (id) =>
    (
      await db.query(
        'select to_jsonb(a) as row from public.property_addresses a where id=$1',
        [id],
      )
    ).rows[0].row;
  const convertAs = async (propertyId, addressId, opts = {}) =>
    (
      await db.query(convert, [
        propertyId,
        addressId,
        opts.addressRevision ??
          (await revision('property_addresses', addressId)),
        opts.propertyRevision ?? (await revision('properties', propertyId)),
      ])
    ).rows[0].id;
  const createCurrent = async (units) =>
    (
      await db.query('select public.create_property($1,$2,$3) as id', [
        'sale',
        {},
        {
          format: 'current',
          address_text: 'Địa chỉ hiện tại cần chuyển',
          province_unit_id: units.province,
          commune_unit_id: units.commune,
        },
      ])
    ).rows[0].id;
  let convertedProperty, convertedLegacy, convertedCurrent;
  await asUser(0);
  await check(
    'an ordinary editor converts a legacy address to the current format by the crosswalk, and the legacy row is untouched',
    async () => {
      convertedProperty = await createLegacy(offered);
      convertedLegacy = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy'",
          [convertedProperty],
        )
      ).rows[0].id;
      const before = await addressSnapshot(convertedLegacy);
      convertedCurrent = await convertAs(convertedProperty, convertedLegacy);
      const target = offered.crosswalk[0];
      // The units, the effective date and the source come from the crosswalk row, and the new row
      // is a candidate: it cites its evidence and states no verification stamp of its own.
      assert.deepEqual(await addressRow(convertedCurrent), {
        address_text: 'Nhà cũ theo bảng chuyển đổi',
        format: 'current',
        province_unit_id: (
          await db.query(
            'select parent_id from public.admin_unit_versions where id=$1',
            [target.to_unit_id],
          )
        ).rows[0].parent_id,
        district_unit_id: null,
        commune_unit_id: target.to_unit_id,
        mapping_status: 'candidate',
        effective_on: '2025-07-01',
        source_url: target.source_url,
        verification_method: null,
        verified_by: null,
        verified_at: null,
        mapping_evidence: null,
        is_primary: true,
        supersedes_address_id: convertedLegacy,
      });
      assert.deepEqual(await addressSnapshot(convertedLegacy), before);
      // Both rows stay primary, one per format.
      assert.deepEqual(await addressesOf(convertedProperty), [
        { id: convertedLegacy, format: 'legacy', is_primary: true },
        { id: convertedCurrent, format: 'current', is_primary: true },
      ]);
    },
  );
  await check(
    'the converted property is found by either format label, because both rows are indexed',
    async () => {
      const names = (
        await db.query(
          `select (select name_vi from public.admin_unit_versions where id=$1) as legacy_ward,
             (select name_vi from public.admin_unit_versions where id=$2) as current_commune`,
          [offered.id, offered.crosswalk[0].to_unit_id],
        )
      ).rows[0];
      for (const name of [names.legacy_ward, names.current_commune]) {
        const found = (
          await db.query(
            'select id from public.page_inventory(p_query => $1)',
            [name],
          )
        ).rows.map((row) => row.id);
        assert.ok(found.includes(convertedProperty), name);
      }
    },
  );
  await check(
    'conversion is not a toggle: an ordinary save still refuses to change the format it offers',
    async () => {
      await refuseWith(
        mutate,
        [
          convertedProperty,
          'address',
          convertedCurrent,
          await revision('property_addresses', convertedCurrent),
          { format: 'legacy' },
        ],
        '23514',
        /address format immutable/,
      );
      assert.equal((await addressesOf(convertedProperty)).length, 2);
    },
  );
  await check(
    'converting the same address twice writes nothing, because the target format already holds that territory',
    async () => {
      const before = await addressesOf(convertedProperty);
      await refuseWith(
        convert,
        [
          convertedProperty,
          convertedLegacy,
          await revision('property_addresses', convertedLegacy),
          await revision('properties', convertedProperty),
        ],
        'PT423',
        /already recorded in the target format/,
      );
      assert.deepEqual(await addressesOf(convertedProperty), before);
    },
  );
  await check(
    'the conversion is refused when the recorded units are absent, in either direction',
    async () => {
      for (const format of ['legacy', 'current']) {
        const propertyId = (
          await db.query('select public.create_property($1,$2,$3) as id', [
            'sale',
            {},
            {
              format,
              address_text: 'Địa chỉ chưa ghi đơn vị chính thức',
            },
          ])
        ).rows[0].id;
        const addressId = (
          await db.query(
            'select id from public.property_addresses where property_id=$1',
            [propertyId],
          )
        ).rows[0].id;
        await refuseWith(
          convert,
          [
            propertyId,
            addressId,
            await revision('property_addresses', addressId),
            await revision('properties', propertyId),
          ],
          'PT421',
          /recorded ward required for conversion/,
        );
        assert.equal((await addressesOf(propertyId)).length, 1);
      }
    },
  );
  await check(
    'the conversion is refused in both directions when the crosswalk names no single unit',
    async () => {
      // A legacy ward with several crosswalk rows, and a current commune formed from several old
      // wards, both lack the one whole or rename unit the target row would have to state.
      const mergedCurrent = (
        await db.query(
          `select m.to_unit_id as commune,p.id as province
           from public.admin_unit_crosswalks m
           join public.admin_unit_versions c on c.id=m.to_unit_id and c.unit_level='commune'
           join public.admin_unit_versions p on p.id=c.parent_id and p.unit_level='province'
           group by m.to_unit_id,p.id having count(*)>1 order by m.to_unit_id limit 1`,
        )
      ).rows[0];
      for (const [chain, format] of [
        [several, 'legacy'],
        [mergedCurrent, 'current'],
      ]) {
        const propertyId =
          format === 'legacy'
            ? await createLegacy(chain)
            : await createCurrent(chain);
        const addressId = (
          await db.query(
            'select id from public.property_addresses where property_id=$1',
            [propertyId],
          )
        ).rows[0].id;
        await refuseWith(
          convert,
          [
            propertyId,
            addressId,
            await revision('property_addresses', addressId),
            await revision('properties', propertyId),
          ],
          'PT422',
          /one whole crosswalk (target|source) required/,
        );
        assert.equal((await addressesOf(propertyId)).length, 1);
      }
    },
  );
  await check(
    'a ward the crosswalk has no row for is refused as a missing conversion row, not as an ambiguity',
    async () => {
      // Nothing about this address is ambiguous and correcting it would change nothing: the ward
      // simply has no conversion row yet, which is its own refusal code and its own wording.
      const propertyId = await createLegacy(uncovered);
      const addressId = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy'",
          [propertyId],
        )
      ).rows[0].id;
      await refuseWith(
        convert,
        [
          propertyId,
          addressId,
          await revision('property_addresses', addressId),
          await revision('properties', propertyId),
        ],
        'PT424',
        /no crosswalk row for the recorded unit/,
      );
      assert.equal((await addressesOf(propertyId)).length, 1);
    },
  );
  await check(
    'a corrected address is history: converting the row it replaced is refused and the successor converts once',
    async () => {
      const propertyId = await createLegacy(offered);
      const original = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy'",
          [propertyId],
        )
      ).rows[0].id;
      const corrected = (
        await db.query(mutate, [
          propertyId,
          'address',
          original,
          await revision('property_addresses', original),
          { address_text: 'Nhà cũ sau khi đính chính' },
        ])
      ).rows[0].id;
      assert.notEqual(corrected, original);
      await refuseWith(
        convert,
        [
          propertyId,
          original,
          await revision('property_addresses', original),
          await revision('properties', propertyId),
        ],
        'PT425',
        /superseded address/,
      );
      const converted = await convertAs(propertyId, corrected);
      // The current row states the corrected text, not the text the property moved away from, and
      // following the action on that row again is refused as a duplicate rather than writing a
      // second current address for the same territory.
      assert.equal(
        (await addressRow(converted)).address_text,
        'Nhà cũ sau khi đính chính',
      );
      assert.deepEqual(
        (await addressesOf(propertyId)).map((row) => row.format).sort(),
        ['current', 'legacy', 'legacy'],
      );
      await refuseWith(
        convert,
        [
          propertyId,
          corrected,
          await revision('property_addresses', corrected),
          await revision('properties', propertyId),
        ],
        'PT423',
        /already recorded in the target format/,
      );
    },
  );
  // The reverse direction needs a current commune the crosswalk derives from exactly one old ward;
  // a commune merged from several old wards deliberately has none.
  const singleSource = (
    await db.query(
      `select m.from_unit_id as ward,m.to_unit_id as commune,c.parent_id as current_province
       from public.admin_unit_crosswalks m join public.admin_unit_versions w on w.id=m.from_unit_id
       join public.admin_unit_versions d on d.id=w.parent_id
       join public.admin_unit_versions p on p.id=d.parent_id and p.unit_level='province'
       join public.admin_unit_versions c on c.id=m.to_unit_id and c.unit_level='commune'
       where m.relation in ('whole','rename') and w.unit_level='commune' and d.unit_level='district'
         and (select count(*) from public.admin_unit_crosswalks x where x.to_unit_id=m.to_unit_id)=1
       order by m.from_unit_id limit 1`,
    )
  ).rows[0];
  let reverseProperty, reverseCurrent, reverseLegacy;
  await check(
    'a reviewer verifies the current address that will be converted back, and the conversion keeps that row and its provenance',
    async () => {
      reverseProperty = await createCurrent({
        province: singleSource.current_province,
        commune: singleSource.commune,
      });
      reverseCurrent = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='current'",
          [reverseProperty],
        )
      ).rows[0].id;
      await asUser(2);
      await db.query(mutate, [
        reverseProperty,
        'mapping',
        reverseCurrent,
        await revision('property_addresses', reverseCurrent),
        {
          mapping_status: 'verified',
          verification_method: 'manual',
          effective_on: '2025-07-01',
          source_url: 'https://example.test/property-evidence',
          mapping_evidence:
            'The property parcel boundary establishes this commune',
        },
      ]);
      const verified = await addressRow(reverseCurrent);
      assert.equal(verified.mapping_status, 'verified');
      assert.equal(verified.verified_by, employees[2]);
      await asUser(0);
      const before = await addressSnapshot(reverseCurrent);
      reverseLegacy = await convertAs(reverseProperty, reverseCurrent);
      // The converted row is a candidate with the crosswalk's date and source, and it names the old
      // ward, its district and that district's province rather than anything the caller stated.
      assert.deepEqual(await addressRow(reverseLegacy), {
        address_text: 'Địa chỉ hiện tại cần chuyển',
        format: 'legacy',
        province_unit_id: (
          await db.query(
            'select parent_id from public.admin_unit_versions where id=(select parent_id from public.admin_unit_versions where id=$1)',
            [singleSource.ward],
          )
        ).rows[0].parent_id,
        district_unit_id: (
          await db.query(
            'select parent_id from public.admin_unit_versions where id=$1',
            [singleSource.ward],
          )
        ).rows[0].parent_id,
        commune_unit_id: singleSource.ward,
        mapping_status: 'candidate',
        effective_on: '2025-07-01',
        source_url: (
          await db.query(
            'select source_url from public.admin_unit_crosswalks where from_unit_id=$1',
            [singleSource.ward],
          )
        ).rows[0].source_url,
        verification_method: null,
        verified_by: null,
        verified_at: null,
        mapping_evidence: null,
        is_primary: true,
        supersedes_address_id: reverseCurrent,
      });
      // Converting a verified row back never downgrades it: every field, its verification stamp
      // and its evidence included, is the row it was.
      assert.deepEqual(await addressSnapshot(reverseCurrent), before);
      assert.deepEqual(await addressesOf(reverseProperty), [
        { id: reverseLegacy, format: 'legacy', is_primary: true },
        { id: reverseCurrent, format: 'current', is_primary: true },
      ]);
    },
  );
  // A renamed province re-creates every commune of its hierarchy in a later validity window, so a
  // current address recorded there names a version row the crosswalk never points at. Both
  // directions follow the unit's official code instead.
  const renamed = (
    await db.query(
      `select m.from_unit_id as ward,c.id as current_commune,c.parent_id as current_province
       from public.admin_unit_crosswalks m
       join public.admin_unit_versions base on base.id=m.to_unit_id and base.unit_level='commune'
        and base.valid_from>=date '2025-07-01'
       join public.admin_unit_versions c on c.unit_level='commune'
        and c.official_code=base.official_code and c.valid_from>base.valid_from
       where m.relation in ('whole','rename')
         and (select count(*) from public.admin_unit_crosswalks x
              join public.admin_unit_versions v on v.id=x.to_unit_id and v.unit_level='commune'
               and v.valid_from>=date '2025-07-01'
              where v.official_code=base.official_code)=1
       order by m.from_unit_id limit 1`,
    )
  ).rows[0];
  await check(
    'a current address recorded in a later catalog window converts back, and converting it forward again writes nothing',
    async () => {
      const propertyId = await createCurrent({
        province: renamed.current_province,
        commune: renamed.current_commune,
      });
      const currentId = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='current'",
          [propertyId],
        )
      ).rows[0].id;
      const before = await addressSnapshot(currentId);
      const legacyId = await convertAs(propertyId, currentId);
      const legacy = await addressRow(legacyId);
      const chain = (
        await db.query(
          `select d.id as district,p.id as province from public.admin_unit_versions w
           join public.admin_unit_versions d on d.id=w.parent_id
           join public.admin_unit_versions p on p.id=d.parent_id
           where w.id=$1`,
          [renamed.ward],
        )
      ).rows[0];
      assert.deepEqual(
        {
          format: legacy.format,
          province_unit_id: legacy.province_unit_id,
          district_unit_id: legacy.district_unit_id,
          commune_unit_id: legacy.commune_unit_id,
          mapping_status: legacy.mapping_status,
          supersedes_address_id: legacy.supersedes_address_id,
        },
        {
          format: 'legacy',
          province_unit_id: chain.province,
          district_unit_id: chain.district,
          commune_unit_id: renamed.ward,
          mapping_status: 'candidate',
          supersedes_address_id: currentId,
        },
      );
      assert.deepEqual(await addressSnapshot(currentId), before);
      // The current row this property keeps names the same commune in its later window, so the
      // forward direction sees the duplicate rather than writing a second current row.
      await refuseWith(
        convert,
        [
          propertyId,
          legacyId,
          await revision('property_addresses', legacyId),
          await revision('properties', propertyId),
        ],
        'PT423',
        /already recorded in the target format/,
      );
      assert.deepEqual(await addressesOf(propertyId), [
        { id: legacyId, format: 'legacy', is_primary: true },
        { id: currentId, format: 'current', is_primary: true },
      ]);
    },
  );
  await check(
    'a conversion records beside the primary the target format already has instead of taking its flag',
    async () => {
      // The legacy row here sits at a ward with no crosswalk row at all, so it can never be the
      // ward the reverse conversion resolves to: the two rows are genuinely different addresses.
      const sideBySide = await createLegacy(uncovered);
      const existingLegacy = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy'",
          [sideBySide],
        )
      ).rows[0].id;
      const existingBefore = await addressSnapshot(existingLegacy);
      const addedCurrent = (
        await db.query(mutate, [
          sideBySide,
          'address',
          null,
          await revision('properties', sideBySide),
          {
            format: 'current',
            address_text: 'Địa chỉ hiện tại cạnh địa chỉ cũ',
            province_unit_id: singleSource.current_province,
            commune_unit_id: singleSource.commune,
          },
        ])
      ).rows[0].id;
      const added = await convertAs(sideBySide, addedCurrent);
      const convertedRow = await addressRow(added);
      assert.equal(convertedRow.format, 'legacy');
      assert.equal(convertedRow.mapping_status, 'candidate');
      // The legacy format already had its primary, so the new record stays beside it and the
      // other row is not touched at all.
      assert.equal(convertedRow.is_primary, false);
      assert.deepEqual(await addressSnapshot(existingLegacy), existingBefore);
      assert.deepEqual(await addressesOf(sideBySide), [
        { id: existingLegacy, format: 'legacy', is_primary: true },
        { id: added, format: 'legacy', is_primary: false },
        { id: addedCurrent, format: 'current', is_primary: true },
      ]);
    },
  );
  await check(
    'a stale revision or a colleague without edit authority converts nothing',
    async () => {
      const before = await addressesOf(reverseProperty);
      await refuseWith(
        convert,
        [
          reverseProperty,
          reverseLegacy,
          '90000000-0000-4000-8000-000000000001',
          await revision('properties', reverseProperty),
        ],
        'PT409',
        /stale address/,
      );
      await refuseWith(
        convert,
        [
          reverseProperty,
          reverseLegacy,
          await revision('property_addresses', reverseLegacy),
          '90000000-0000-4000-8000-000000000001',
        ],
        'PT409',
        /stale property context/,
      );
      await asUser(1);
      await refuseWith(
        convert,
        [
          reverseProperty,
          reverseLegacy,
          await revision('property_addresses', reverseLegacy),
          await revision('properties', reverseProperty),
        ],
        '42501',
        /property edit denied/,
      );
      await asUser(0);
      assert.deepEqual(await addressesOf(reverseProperty), before);
      // A reviewer may also convert, and the row it writes is still only a candidate.
      const reviewerProperty = await createLegacy(offered);
      const reviewerLegacy = (
        await db.query(
          "select id from public.property_addresses where property_id=$1 and format='legacy'",
          [reviewerProperty],
        )
      ).rows[0].id;
      await asUser(2);
      const reviewerConverted = await convertAs(
        reviewerProperty,
        reviewerLegacy,
      );
      assert.deepEqual(
        {
          format: (await addressRow(reviewerConverted)).format,
          mapping_status: (await addressRow(reviewerConverted)).mapping_status,
          verified_by: (await addressRow(reviewerConverted)).verified_by,
        },
        { format: 'current', mapping_status: 'candidate', verified_by: null },
      );
      await asUser(0);
    },
  );
  return created;
}
