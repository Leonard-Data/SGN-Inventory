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
      create schema auth; create table auth.users(id uuid primary key);
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
    const properties = [randomUUID(), randomUUID()];
    for (let i = 0; i < properties.length; i++) {
      await db.query(
        "insert into public.properties(id,property_code,listing_mode,status) values ($1,$2,'sale','available')",
        [properties[i], `SGN-TEST-ACTIVITY-${i}`],
      );
    }
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
    async function report(events, propertiesViewed) {
      const rows = (
        await db.query(
          'select business_day::text as day,page_view_events,distinct_properties_viewed from public.my_today_activity()',
        )
      ).rows;
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0], {
        day,
        page_view_events: events,
        distinct_properties_viewed: propertiesViewed,
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
    await asUser(0);
    await report(0, 0);
    const key = randomUUID();
    const event = await view(properties[0], key);
    assert.equal(await view(properties[0], key), event);
    await report(1, 1);
    await assert.rejects(view(properties[1], key));
    await view(properties[0]);
    await report(2, 1);
    await view(properties[1]);
    await report(3, 2);
    await db.query(
      "select public.record_property_activity($1,'site_visit',$2)",
      [properties[0], randomUUID()],
    );
    await report(3, 2);
    await asUser(1);
    await report(0, 0);
    await asUser(2);
    assert.equal(
      (
        await db.query(
          "select id from public.activity_events where kind='page_view'",
        )
      ).rows.length,
      3,
    );
    await report(0, 0);
    await view(properties[0]);
    await report(1, 1);
    await db.exec('reset role');
    // 16:59:59Z is yesterday in Vietnam; 17:00:00Z starts today's Vietnam day.
    const midnight = new Date(`${day}T00:00:00+07:00`);
    for (const instant of [new Date(midnight.valueOf() - 1000), midnight]) {
      await db.query(
        "insert into public.activity_events(employee_id,property_id,kind,occurred_at,idempotency_key) values($1,$2,'page_view',$3,$4)",
        [employees[1], properties[1], instant.toISOString(), randomUUID()],
      );
    }
    await asUser(1);
    await report(1, 1);
    await db.exec("set timezone='Pacific/Honolulu'");
    await report(1, 1);
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
    }
    await db.exec('reset role');
    await db.query('update public.employees set is_active=true where id=$1', [
      employees[0],
    ]);
    await asUser(0);
    await report(3, 2);
  } finally {
    await db.close();
  }
});
