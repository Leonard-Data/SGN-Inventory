// Issue #258 evidence: the inventory's first window before and after the browse order became the
// record's latest change. This script changes no migration. It loads the shipped schema, lays out
// the imported stock at its current size, then measures what the first window holds and what it
// costs under each ordering, and the plans the read gets with and without the shipped index. The
// account it prints is recorded in docs/testing.md and in the header of
// supabase/migrations/20261022084850_inventory_recent_change_order.sql.
//
// Run: node scripts/recent-change-order-evidence.mjs
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { applyEmbeddedSchema } from './embedded-schema.mjs';

const USER = '00000000-0000-4000-8000-000000000001';
const EMPLOYEE = '10000000-0000-4000-8000-000000000001';
// The size the imported inventory is stated at elsewhere in this repository (docs/testing.md).
const STOCK = 18801;
// The records somebody touched after the import, spread across it rather than at its tail.
const EDITED = 12;
const db = new PGlite({ extensions: { unaccent, pg_trgm, pgcrypto } });
const say = (line = '') => console.log(line);

await applyEmbeddedSchema({ root: process.cwd(), exec: (sql) => db.exec(sql) });
say('server: ' + (await db.query('select version()')).rows[0].version);

await db.query('insert into auth.users values ($1)', [USER]);
await db.query(
  "insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$2,'evidence@example.test','Evidence Fixture','admin',true)",
  [EMPLOYEE, USER],
);

// One import run: every row created inside the same minute, in the source sheet's own order, so
// the created order is the sheet's order and the imported stock occupies the whole list.
await db.exec('alter table public.properties disable trigger property_guard');
await db.query(
  `insert into public.properties(id,property_code,listing_mode,status,property_type,created_by,entry_on,entry_source,created_at,updated_at)
   select ('6c000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid,'SGN-EVID-'||g,'sale','available','house',$1,
     date '2025-01-01' + (g % 300),'legacy',
     timestamptz '2026-10-01 00:00:00+07' + (g || ' seconds')::interval,
     timestamptz '2026-10-01 00:00:00+07' + (g || ' seconds')::interval
   from generate_series(1,$2) g`,
  [EMPLOYEE, STOCK],
);
await db.exec('alter table public.properties enable trigger property_guard');
await db.query(
  `insert into public.property_addresses(property_id,format,address_text,house_number,street,commune_text,district_text)
   select p.id,'legacy','dia chi cu '||p.property_code,'12','Le Loi','Ben Nghe','Quan 1' from public.properties p`,
);

// Twelve records somebody opened and corrected today, each an ordinary write through the property
// guard, so the change time is the one the guard stamps.
const edited = [];
for (let index = 0; index < EDITED; index++) {
  const property = `6c000000-0000-4000-8000-${(300 + index * 1_400).toString(16).padStart(12, '0')}`;
  await db.query(
    "update public.properties set notes='edited after the import' where id=$1",
    [property],
  );
  edited.push(property);
}
await db.exec('analyze public.properties');

const counts = (
  await db.query(
    'select count(*)::int as properties, count(*) filter (where updated_at > created_at)::int as changed from public.properties',
  )
).rows[0];
const clock = (
  await db.query(
    'select min(created_at) as first_created, max(created_at) as last_created, max(updated_at) as last_changed from public.properties',
  )
).rows[0];
say(
  `rows: ${counts.properties} properties imported between ${clock.first_created.toISOString()} and ${clock.last_created.toISOString()}; ${counts.changed} changed since, the latest at ${clock.last_changed.toISOString()}`,
);

async function as(role) {
  await db.exec('reset role');
  await db.query('select set_config($1,$2,false)', [
    'request.jwt.claim.sub',
    role === 'owner' ? '' : USER,
  ]);
  if (role !== 'owner') await db.exec(`set role ${role}`);
}

// The first window of each ordering, exactly as `stream_inventory`'s own windowed read states it.
const window = (order) => `select p.id from public.properties p
  where p.archived_at is null
  order by ${order}
  limit 100 offset 0`;

const firstWindow = async (order) =>
  (await db.query(window(order))).rows.map((row) => row.id);

async function timeRead(label, sql, { repeat = 5 } = {}) {
  let best = Infinity;
  for (let index = 0; index < repeat; index++) {
    const started = performance.now();
    await db.query(sql);
    best = Math.min(best, performance.now() - started);
  }
  say(`${label}: best of ${repeat} at ${best.toFixed(1)} ms`);
  return best;
}

async function plan(label, sql) {
  const explained = await db.query(
    `explain (analyze, buffers, format text) ${sql}`,
  );
  say(`--- ${label} ---`);
  for (const row of explained.rows)
    if (/Scan|Sort|Limit|Execution|Planning/.test(row['QUERY PLAN']))
      say(row['QUERY PLAN']);
}

await as('authenticated');

const createdOrder = await firstWindow('p.created_at desc, p.id desc');
const changedOrder = await firstWindow('p.updated_at desc, p.id desc');
const editedSet = new Set(edited);
say('');
say(
  `first window of 100, ordered by creation: ${createdOrder.filter((id) => editedSet.has(id)).length} of the ${EDITED} records changed after the import`,
);
say(
  `first window of 100, ordered by latest change: ${changedOrder.filter((id) => editedSet.has(id)).length} of the ${EDITED} records changed after the import`,
);
const createdPosition =
  (
    await db.query(
      `select count(*)::int as before from public.properties p
     where p.archived_at is null and (p.created_at, p.id) > (
       select p2.created_at, p2.id from public.properties p2
       where p2.id = (select id from public.properties order by updated_at desc, id desc limit 1))`,
    )
  ).rows[0].before + 1;
say(
  `the most recently changed record sits at position ${createdPosition} of ${counts.properties} in the creation order`,
);
say('');

await plan(
  'the first window, ordered by latest change, as the authenticated employee',
  window('p.updated_at desc, p.id desc'),
);
await plan(
  'the first window, ordered by creation, as the authenticated employee',
  window('p.created_at desc, p.id desc'),
);
await plan(
  'the whole first-window read, as the authenticated employee',
  'select * from public.stream_inventory(p_offset => 0, p_limit => 100)',
);
await timeRead(
  'first window ordered by latest change, as the authenticated employee',
  window('p.updated_at desc, p.id desc'),
);
await timeRead(
  'first window ordered by creation, as the authenticated employee',
  window('p.created_at desc, p.id desc'),
);

// The same read as it stood before this change: the shipped function's own body with the browse
// order put back on the creation time, built here in the scratch database and never shipped.
await as('owner');
const shipped = (
  await db.query(
    `select pg_get_function_arguments(p.oid) as args, pg_get_function_identity_arguments(p.oid) as identity,
       pg_get_function_result(p.oid) as result, p.prosrc as body
     from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='stream_inventory'`,
  )
).rows[0];
await db.query(
  `create function public.evidence_created_order(${shipped.args}) returns ${shipped.result}
   language plpgsql stable security invoker set search_path='' as $body$${shipped.body.replaceAll('updated_at end desc', 'created_at end desc')}$body$`,
);
await db.query(
  'grant execute on function public.evidence_created_order to authenticated',
);
await as('authenticated');

// The two whole reads alternate so a single run's jitter cannot favour either of them.
const now =
  'select * from public.stream_inventory(p_offset => 0, p_limit => 100)';
const before =
  'select * from public.evidence_created_order(p_offset => 0, p_limit => 100)';
let bestNow = Infinity;
let bestBefore = Infinity;
for (let index = 0; index < 9; index++) {
  let started = performance.now();
  await db.query(now);
  bestNow = Math.min(bestNow, performance.now() - started);
  started = performance.now();
  await db.query(before);
  bestBefore = Math.min(bestBefore, performance.now() - started);
}
say('');
say(
  `the whole first-window read, ordered by latest change: best of 9 at ${bestNow.toFixed(1)} ms`,
);
say(
  `the whole first-window read, ordered by creation, as it stood before this change: best of 9 at ${bestBefore.toFixed(1)} ms`,
);

await as('owner');
await db.query(
  `drop function public.evidence_created_order(${shipped.identity})`,
);

// The same read without the index the migration ships: what the order costs when nothing serves it.
await as('owner');
await db.exec('drop index public.properties_recent_change_idx');
await db.exec('analyze public.properties');
await as('authenticated');
say('');
await plan(
  'the first window, ordered by latest change, without the shipped index',
  window('p.updated_at desc, p.id desc'),
);
await timeRead(
  'first window ordered by latest change, without the shipped index',
  window('p.updated_at desc, p.id desc'),
);

await as('owner');
say('');
say(
  'conclusion: the shipped index is the node the change-ordered base-table window reads through, and it serves both orderings; the function\'s own window is sliced from the set it materialises for the count.',
);
await db.close();
