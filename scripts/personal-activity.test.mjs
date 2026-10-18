import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('personal today activity enforces own scope, Vietnam day, retry identity and live access', async () => {
  const db = new PGlite({ extensions: { unaccent, pg_trgm, pgcrypto } });
  try {
    // Match the embedded runner's Supabase schema stubs; this is not hosted acceptance.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      grant usage on schema auth to authenticated,anon,service_role;
      create schema storage;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema storage to authenticated,anon;
      grant select,insert,update,delete on storage.objects to authenticated;
    `);
    const migrations = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await fs.readdir(migrations))
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      await db.exec(await fs.readFile(new URL(file, migrations), 'utf8'));
    }
    const users = Array.from({ length: 5 }, () => randomUUID());
    const employees = users.slice(0, 4).map(() => randomUUID());
    for (const id of users)
      await db.query('insert into auth.users values ($1)', [id]);
    for (let i = 0; i < employees.length; i++) {
      await db.query(
        'insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$2,$3,$4,$5,$6)',
        [
          employees[i],
          users[i],
          `activity${i}@example.test`,
          `Activity ${i}`,
          i === 2 ? 'manager' : 'sales',
          i !== 3,
        ],
      );
    }
    const properties = Array.from({ length: 4 }, () => randomUUID());
    for (let i = 0; i < properties.length; i++) {
      await db.query(
        "insert into public.properties(id,property_code,listing_mode,status) values ($1,$2,'sale','available')",
        [properties[i], `SGN-TEST-ACTIVITY-${i}`],
      );
    }
    // Owner eligibility follows the property's recorded link, not the shared contact's global
    // type: one contact is an owner on one property and only a broker on another.
    const sharedOwner = randomUUID();
    const brokerOnly = randomUUID();
    const ownerWithoutPhone = randomUUID();
    await db.query(
      "insert into public.contacts(id,display_name,phones,raw_phone_text,contact_type) values ($1,'Shared Owner','{0901234567}','090 123 4567','broker'),($2,'Broker Only','{0911111111}','091 111 1111','owner'),($3,'Owner Without Phone','{}',null,'owner')",
      [sharedOwner, brokerOnly, ownerWithoutPhone],
    );
    await db.query(
      "insert into public.property_contacts(property_id,contact_id,relation,is_primary) values ($1,$2,'owner',true),($3,$2,'broker',true),($3,$4,'broker',false),($5,$6,'owner',true),($7,$2,'owner',false)",
      [
        properties[0],
        sharedOwner,
        properties[1],
        brokerOnly,
        properties[2],
        ownerWithoutPhone,
        properties[3],
      ],
    );
    const now = (await db.query('select now() as instant')).rows[0].instant;
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(now));
    async function asUser(index) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
        index === null ? '' : users[index],
      ]);
      await db.exec(`set role ${index === null ? 'anon' : 'authenticated'}`);
    }
    async function report(events, propertiesViewed, ownerContacts) {
      const rows = (
        await db.query(
          'select business_day::text as day,page_view_events,distinct_properties_viewed,owner_contact_properties from public.my_today_activity()',
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        day,
        page_view_events: events,
        distinct_properties_viewed: propertiesViewed,
        owner_contact_properties: ownerContacts,
      });
    }
    async function view(property, key = randomUUID()) {
      return (
        await db.query(
          "select public.record_property_activity($1,'page_view',$2) as id",
          [property, key],
        )
      ).rows[0].id;
    }
    async function disclose(property, key = randomUUID()) {
      return (
        await db.query('select public.reveal_owner_contact($1,$2) as result', [
          property,
          key,
        ])
      ).rows[0].result;
    }
    await asUser(0);
    await report(0, 0, 0);
    const key = randomUUID();
    const event = await view(properties[0], key);
    assert.equal(await view(properties[0], key), event);
    await report(1, 1, 0);
    await assert.rejects(view(properties[1], key));
    await view(properties[0]);
    await report(2, 1, 0);
    await view(properties[1]);
    await report(3, 2, 0);
    // Physical-visit submission is retired; retained rows stay out of today's report.
    await assert.rejects(
      db.query("select public.record_property_activity($1,'site_visit',$2)", [
        properties[0],
        randomUUID(),
      ]),
      { code: 'P0001' },
    );
    await report(3, 2, 0);
    // Owner-contact disclosure: one deliberate reveal credits one property and returns the
    // recorded owner contact with its phone.
    const ownerKey = randomUUID();
    const first = await disclose(properties[0], ownerKey);
    assert.equal(first.credited, true);
    assert.notEqual(first.eventId, null);
    assert.deepEqual(first.contact, {
      id: sharedOwner,
      displayName: 'Shared Owner',
      relation: 'owner',
      isPrimary: true,
      phone: '0901234567',
    });
    await report(3, 2, 1);
    // A same-key retry recovers the original reference and day without a second event.
    const retried = await disclose(properties[0], ownerKey);
    assert.equal(retried.eventId, first.eventId);
    assert.equal(retried.businessDay, first.businessDay);
    await report(3, 2, 1);
    // A genuinely independent reveal keeps a distinct event identity but one property.
    const independent = await disclose(properties[0], randomUUID());
    assert.notEqual(independent.eventId, first.eventId);
    await report(3, 2, 1);
    // Reusing the retry reference for another property is rejected.
    await assert.rejects(disclose(properties[3], ownerKey), { code: 'P0005' });
    // A shared owner on another property counts as another property.
    await disclose(properties[3], randomUUID());
    await report(3, 2, 2);
    // Broker-only access and an owner without a phone are explicit and add no credit.
    await assert.rejects(disclose(properties[1], randomUUID()), {
      code: 'P0003',
    });
    await assert.rejects(disclose(properties[2], randomUUID()), {
      code: 'P0004',
    });
    await report(3, 2, 2);
    await asUser(1);
    await report(0, 0, 0);
    await asUser(2);
    assert.equal(
      (
        await db.query(
          "select id from public.activity_events where kind='page_view'",
        )
      ).rows.length,
      3,
    );
    await report(0, 0, 0);
    await view(properties[0]);
    await report(1, 1, 0);
    await db.exec('reset role');
    // 16:59:59Z is yesterday in Vietnam; 17:00:00Z starts today's Vietnam day.
    const midnight = new Date(`${day}T00:00:00+07:00`);
    const beforeMidnight = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(midnight.valueOf() - 1000));
    const preMidnightKey = randomUUID();
    for (const instant of [new Date(midnight.valueOf() - 1000), midnight]) {
      await db.query(
        "insert into public.activity_events(employee_id,property_id,kind,occurred_at,idempotency_key) values($1,$2,'page_view',$3,$4)",
        [employees[1], properties[1], instant.toISOString(), randomUUID()],
      );
    }
    // A committed pre-midnight disclosure and a genuinely new next-day disclosure.
    await db.query(
      "insert into public.activity_events(employee_id,property_id,kind,occurred_at,idempotency_key) values($1,$2,'owner_contact_access',$3,$4)",
      [
        employees[1],
        properties[0],
        new Date(midnight.valueOf() - 1000).toISOString(),
        preMidnightKey,
      ],
    );
    await db.query(
      "insert into public.activity_events(employee_id,property_id,kind,occurred_at,idempotency_key) values($1,$2,'owner_contact_access',$3,$4)",
      [employees[1], properties[1], midnight.toISOString(), randomUUID()],
    );
    await asUser(1);
    await report(1, 1, 1);
    await db.exec("set timezone='Pacific/Honolulu'");
    await report(1, 1, 1);
    // The pre-midnight reference retried after midnight keeps its original day and no today credit.
    const recovered = await disclose(properties[0], preMidnightKey);
    assert.equal(recovered.credited, true);
    assert.equal(recovered.businessDay, beforeMidnight);
    await report(1, 1, 1);
    await db.exec('reset role');
    await db.query('update public.employees set is_active=false where id=$1', [
      employees[0],
    ]);
    await asUser(0);
    await assert.rejects(db.query('select * from public.my_today_activity()'), {
      code: '42501',
    });
    assert.equal(
      (await db.query('select * from public.activity_events')).rows.length,
      0,
    );
    for (const identity of [null, 3, 4]) {
      await asUser(identity);
      await assert.rejects(
        db.query('select * from public.my_today_activity()'),
        { code: '42501' },
      );
      await assert.rejects(disclose(properties[0], randomUUID()), {
        code: '42501',
      });
    }
    await db.exec('reset role');
    await db.query('update public.employees set is_active=true where id=$1', [
      employees[0],
    ]);
    // Archived review: managers keep authorized contact access without new credit, while
    // ordinary employees stay denied; earlier credit survives the archive, and a manager's
    // retry after the archive still returns the original committed reference and day.
    await asUser(2);
    const managerKey = randomUUID();
    const managerFirst = await disclose(properties[3], managerKey);
    assert.equal(managerFirst.credited, true);
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query(
      'update public.properties set archived_at=now() where id=$1',
      [properties[3]],
    );
    await asUser(2);
    const recoveredManager = await disclose(properties[3], managerKey);
    assert.equal(recoveredManager.eventId, managerFirst.eventId);
    assert.equal(recoveredManager.businessDay, managerFirst.businessDay);
    assert.equal(recoveredManager.credited, true);
    const archived = await disclose(properties[3], randomUUID());
    assert.equal(archived.credited, false);
    assert.equal(archived.eventId, null);
    assert.equal(archived.contact.phone, '0901234567');
    // A key committed for one property is rejected on another, archived path included.
    await assert.rejects(disclose(properties[0], managerKey), {
      code: 'P0005',
    });
    await report(1, 1, 1);
    // A committed reference survives the recorded owner phone being removed.
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query("update public.contacts set phones='{}' where id=$1", [
      sharedOwner,
    ]);
    await asUser(2);
    const phoneRemoved = await disclose(properties[3], managerKey);
    assert.equal(phoneRemoved.eventId, managerFirst.eventId);
    assert.equal(phoneRemoved.contact.phone, '');
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await db.query(
      "update public.contacts set phones='{0901234567}' where id=$1",
      [sharedOwner],
    );
    await asUser(0);
    await assert.rejects(disclose(properties[3], randomUUID()), {
      code: 'P0002',
    });
    await report(3, 2, 2);
  } finally {
    await db.close();
  }
});
