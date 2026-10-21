import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Ticket: recording a contact number on any property. The widening is deliberate and narrow:
// any live active employee may create a contact and link it to an unarchived property, while
// correcting a recorded contact, changing a link and removing a link stay staff/manager/admin.
// The earlier contacts of a property are kept, and the existing audit triggers record both new
// rows with the acting employee.
export async function contactNumberContract({
  db,
  asUser,
  check,
  fails,
  employees,
  property,
}) {
  const add = 'select public.add_property_contact($1,$2::jsonb) as contact_id';
  const changes = (name, phone) =>
    JSON.stringify({
      display_name: name,
      phones: [phone],
      raw_phone_text: phone,
      contact_type: 'unknown',
    });
  const asIdentity = async (id) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  const asAdmin = async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
  };
  const count = async (sql, params = []) =>
    Number((await db.query(sql, params)).rows[0].n);
  const links = (id) =>
    db.query(
      `select pc.contact_id,pc.relation,pc.is_primary,c.display_name,c.raw_phone_text
         from public.property_contacts pc
         join public.contacts c on c.id = pc.contact_id
        where pc.property_id = $1
        order by c.created_at, c.id`,
      [id],
    );
  // A property another sales colleague created: the acting session may read it but cannot
  // edit its facts, which is exactly the case this widening covers.
  const target = '20000000-0000-4000-8000-0000000003c1';
  const archivedProperty = '20000000-0000-4000-8000-0000000000b1';
  await asAdmin();
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by) values($1,'SGN-CONTACT-1','sale','available',$2)",
    [target, employees[1]],
  );
  await db.query(
    "insert into public.properties(id,property_code,listing_mode,status,created_by,archived_at) values($1,'SGN-ARCH-2','sale','available',$2,now())",
    [archivedProperty, employees[5]],
  );

  await check(
    'both insert policies admit any active employee and keep the archived boundary',
    async () => {
      const policies = (
        await db.query(
          `select polname,pg_get_expr(polqual,polrelid) as using_expr,pg_get_expr(polwithcheck,polrelid) as check_expr
             from pg_policy where polname in ('contacts_insert','property_contacts_insert')`,
        )
      ).rows;
      assert.equal(policies.length, 2);
      for (const policy of policies) {
        const expr = `${policy.check_expr ?? ''}`;
        assert.ok(
          expr.includes('employee_id'),
          `${policy.polname} lost its employee check`,
        );
        assert.ok(
          !expr.includes("'staff'::text") && !expr.includes("'manager'::text"),
          `${policy.polname} still names a role`,
        );
      }
      const link = policies.find(
        (p) => p.polname === 'property_contacts_insert',
      );
      assert.ok(link.check_expr.includes('properties'));
      assert.ok(link.check_expr.includes('archived_at'));
    },
  );

  await check(
    'a sales employee records a contact number on a property they cannot edit',
    async () => {
      await asUser(0);
      // Another sales colleague owns the property, so ordinary property-fact authority is
      // refused for this session while contact capture is not.
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5::jsonb,$4)',
        [
          target,
          'property',
          target,
          '20000000-0000-4000-8000-0000000000ff',
          JSON.stringify({ notes: 'refused' }),
        ],
        '42501',
      );
      const first = (
        await db.query(add, [target, changes('Chị Hoa', '0901234567')])
      ).rows[0].contact_id;
      assert.ok(first);
      await asAdmin();
      const recorded = await links(target);
      assert.equal(recorded.rows.length, 1);
      assert.equal(recorded.rows[0].contact_id, first);
      assert.equal(recorded.rows[0].relation, 'unknown');
      assert.equal(recorded.rows[0].is_primary, false);
      assert.equal(recorded.rows[0].raw_phone_text, '0901234567');
    },
  );

  await check(
    'the newest contact is added beside the earlier ones instead of replacing them',
    async () => {
      await asUser(0);
      const second = (
        await db.query(add, [target, changes('Anh Bình', '0912345678')])
      ).rows[0].contact_id;
      await asAdmin();
      const recorded = await links(target);
      assert.equal(recorded.rows.length, 2);
      assert.equal(recorded.rows[1].contact_id, second);
      // The earlier contact and its link are still recorded, and still the only stored copy.
      assert.equal(recorded.rows[0].display_name, 'Chị Hoa');
      assert.equal(
        await count(
          'select count(*)::int as n from public.contacts where id in ($1,$2)',
          [recorded.rows[0].contact_id, second],
        ),
        2,
      );
    },
  );

  await check(
    'both new rows are recorded in the audit trail with the acting employee',
    async () => {
      await asAdmin();
      const rows = (
        await db.query(
          `select table_name,action,before_data,after_data,actor_user_id
             from private.audit_events
            where table_name in ('contacts','property_contacts')
              and (after_data->>'id'=$1 or after_data->>'contact_id'=$1
                   or after_data->>'id'=$2 or after_data->>'contact_id'=$2)
            order by table_name,action`,
          [
            (await links(target)).rows[0].contact_id,
            (await links(target)).rows[1].contact_id,
          ],
        )
      ).rows;
      const contactRows = rows.filter(
        (row) => row.table_name === 'contacts' && row.action === 'INSERT',
      );
      const linkRows = rows.filter(
        (row) =>
          row.table_name === 'property_contacts' && row.action === 'INSERT',
      );
      assert.equal(contactRows.length, 2);
      assert.equal(linkRows.length, 2);
      for (const row of [...contactRows, ...linkRows]) {
        assert.equal(row.before_data, null);
        assert.ok(row.after_data);
        assert.equal(row.actor_user_id, '00000000-0000-4000-8000-000000000001');
      }
      assert.equal(linkRows[0].after_data.property_id, target);
    },
  );

  await check(
    'an archived property, an inactive employee and no employee are refused',
    async () => {
      await asUser(0);
      await fails(
        add,
        [archivedProperty, changes('Chị Lan', '0900000000')],
        '42501',
      );
      await asUser(4);
      await fails(add, [property, changes('Chị Lan', '0900000000')], '42501');
      await asUser(null);
      await fails(add, [property, changes('Chị Lan', '0900000000')], '42501');
      await asIdentity('00000000-0000-4000-8000-00000000dead');
      await fails(add, [property, changes('Chị Lan', '0900000000')], '42501');
      await asAdmin();
      assert.equal(
        await count(
          "select count(*)::int as n from public.contacts where display_name='Chị Lan'",
        ),
        0,
      );
      assert.equal(
        await count(
          'select count(*)::int as n from public.property_contacts where property_id=$1',
          [archivedProperty],
        ),
        0,
      );
    },
  );

  await check(
    'a refused submission records nothing, and the recorded validation still applies',
    async () => {
      // Counted without a session role: RLS narrows what the acting employee may read, and this
      // check is about what the refusals wrote, not what they could see.
      await asAdmin();
      const contactsBefore = await count(
        'select count(*)::int as n from public.contacts',
      );
      const linksBefore = await count(
        'select count(*)::int as n from public.property_contacts',
      );
      await asUser(0);
      await fails(
        add,
        [property, JSON.stringify({ display_name: '  ' })],
        '23514',
      );
      await fails(
        add,
        [property, JSON.stringify({ display_name: 'Cô Tư', status: 'sold' })],
        '23514',
      );
      await fails(add, [randomUUID(), changes('Cô Tư', '0900000000')], '42501');
      await asAdmin();
      assert.equal(
        await count('select count(*)::int as n from public.contacts'),
        contactsBefore,
      );
      assert.equal(
        await count('select count(*)::int as n from public.property_contacts'),
        linksBefore,
      );
    },
  );

  await check(
    'changing a link, removing a link and stand-alone creation stay staff-only',
    async () => {
      await asUser(0);
      const recorded = (await links(target)).rows[0];
      const revision = (
        await db.query('select revision from public.properties where id=$1', [
          target,
        ])
      ).rows[0].revision;
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5::jsonb,$6)',
        [
          target,
          'link',
          recorded.contact_id,
          randomUUID(),
          JSON.stringify({ relation: 'owner' }),
          revision,
        ],
        '42501',
      );
      await fails(
        'select public.maintain_property($1,$2,$3,$4,$5::jsonb,$6)',
        [
          target,
          'link',
          recorded.contact_id,
          randomUUID(),
          JSON.stringify({ remove: true }),
          revision,
        ],
        '42501',
      );
      await fails(
        'select public.create_contact($1::jsonb)',
        [changes('Chị Hoa hai', '0909999999')],
        '42501',
      );
      await asAdmin();
      // Both contacts are still linked and nothing about the first one changed.
      assert.equal((await links(target)).rows.length, 2);
      const recordedLink = (await links(target)).rows[0];
      assert.equal(recordedLink.relation, 'unknown');
      assert.equal(recordedLink.is_primary, false);
    },
  );

  await check(
    'the contact tables still refuse every direct client write',
    async () => {
      for (const role of ['authenticated', 'anon', 'service_role'])
        for (const privilege of ['INSERT', 'UPDATE', 'DELETE'])
          for (const table of ['public.contacts', 'public.property_contacts'])
            assert.equal(
              (
                await db.query(
                  'select has_table_privilege($1,$2,$3) as allowed',
                  [role, table, privilege],
                )
              ).rows[0].allowed,
              false,
              `${role} must not be able to ${privilege} ${table}`,
            );
    },
  );
}
