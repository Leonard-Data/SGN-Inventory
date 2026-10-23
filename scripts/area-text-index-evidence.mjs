// Ticket #247 evidence: the area filter's text path is paid per candidate address because an
// expression index cannot serve it under this table's row security. This script does not change
// the schema - it creates the candidate indexes in this in-memory database only, measures the
// plans, and never writes a migration. The account it prints is recorded in docs/testing.md and in
// the header of supabase/migrations/20261022060000_inventory_area_text_match.sql.
//
// Run: node scripts/area-text-index-evidence.mjs
import { PGlite } from '@electric-sql/pglite';
import { unaccent } from '@electric-sql/pglite/contrib/unaccent';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { applyEmbeddedSchema } from './embedded-schema.mjs';

const USER = '00000000-0000-4000-8000-000000000001';
const EMPLOYEE = '10000000-0000-4000-8000-000000000001';
const db = new PGlite({ extensions: { unaccent, pg_trgm, pgcrypto } });
const say = (line = '') => console.log(line);

await applyEmbeddedSchema({ root: process.cwd(), exec: (sql) => db.exec(sql) });
say('server: ' + (await db.query('select version()')).rows[0].version);

await db.query('insert into auth.users values ($1)', [USER]);
await db.query(
  "insert into public.employees(id,auth_user_id,email,display_name,role,is_active) values ($1,$2,'evidence@example.test','Evidence Fixture','admin',true)",
  [EMPLOYEE, USER],
);

// The imported stock's shape: every legacy address is free text with no unit ids, spread over the
// legacy provinces the panel offers.
await db.exec(`
create temp table evidence_province as
  select id, name_vi, row_number() over (order by official_code) rn
  from public.admin_unit_versions where unit_level='province' and valid_to='2025-07-01';
create temp table evidence_district as
  select id, name_vi, parent_id, row_number() over (partition by parent_id order by official_code) rn
  from public.admin_unit_versions where unit_level='district' and valid_to='2025-07-01';
create temp table evidence_commune as
  select id, name_vi, parent_id, row_number() over (partition by parent_id order by official_code) rn
  from public.admin_unit_versions where unit_level='commune' and valid_to='2025-07-01';
create temp table evidence_row as select g from generate_series(1,18801) g;
`);
await db.query(
  `insert into public.properties(id,property_code,listing_mode,status,property_type,created_by)
   select ('5b000000-0000-4000-8000-'||lpad(to_hex(g),12,'0'))::uuid,'SGN-EVID-'||g,'sale','available','house',$1
   from evidence_row`,
  [EMPLOYEE],
);
await db.query(
  `insert into public.property_addresses(property_id,format,address_text,province_text,district_text,commune_text)
   select p.id,'legacy','dia chi cu '||p.property_code,pr.name_vi,d.name_vi,c.name_vi
   from public.properties p
   join evidence_row s on p.property_code = 'SGN-EVID-'||s.g
   join evidence_province pr on pr.rn = (s.g % 63) + 1
   join evidence_district d on d.parent_id = pr.id and d.rn = 1
   join evidence_commune c on c.parent_id = d.id and c.rn = 1`,
);

// The candidate state the decision asked for: the same normalisation declared immutable so the
// three expression indexes can exist. The shipped migration keeps the function stable and ships no
// index; the clone lives in this scratch database only.
await db.exec(`
create function private.evidence_normalize_unit_text(value text) returns text
language sql immutable security invoker set search_path='' as $$
  select private.normalize_unit_text(value);
$$;
create index evidence_province_text_idx
  on public.property_addresses (private.evidence_normalize_unit_text(province_text));
create index evidence_district_text_idx
  on public.property_addresses (private.evidence_normalize_unit_text(district_text));
create index evidence_commune_text_idx
  on public.property_addresses (private.evidence_normalize_unit_text(commune_text));
analyze public.properties;
analyze public.property_addresses;
`);

const counts = (
  await db.query(`select
    (select count(*) from public.properties) as properties,
    (select count(*) from public.property_addresses) as addresses`)
).rows[0];
const province = (
  await db.query(
    "select id,name_vi from public.admin_unit_versions where unit_level='province' and valid_to='2025-07-01' and official_code='79'",
  )
).rows[0];
const matching = (
  await db.query(
    'select count(*)::int as n from public.property_addresses where private.evidence_normalize_unit_text(province_text) = private.evidence_normalize_unit_text($1)',
    [province.name_vi],
  )
).rows[0].n;
say(
  `rows: ${counts.properties} properties, ${counts.addresses} text-only legacy addresses; ${matching} state ${province.name_vi}`,
);

async function measure(label, role, sql, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
    role === 'owner' ? '' : USER,
  ]);
  if (role !== 'owner') await db.exec(`set role ${role}`);
  const plan = await db.query(
    `explain (analyze, buffers, format text) ${sql}`,
    params,
  );
  await db.exec('reset role');
  say(`--- ${label} (as ${role}) ---`);
  for (const row of plan.rows) say(row['QUERY PLAN']);
}

const levelSql = `select count(*) from public.property_addresses a
  where private.evidence_normalize_unit_text(a.province_text) = private.evidence_normalize_unit_text($1)`;
const windowSql = `select count(*) from public.properties p
  where p.archived_at is null
    and exists (select 1 from public.property_addresses a
      where a.property_id = p.id and a.format = $1
        and (a.province_unit_id = $2
          or (private.evidence_normalize_unit_text($3) <> ''
            and private.evidence_normalize_unit_text(a.province_text) = private.evidence_normalize_unit_text($3))))`;

await measure('the area level equality', 'owner', levelSql, [province.name_vi]);
await measure('the area level equality', 'authenticated', levelSql, [
  province.name_vi,
]);
await measure(
  'the area predicate of one inventory window',
  'owner',
  windowSql,
  ['legacy', province.id, province.name_vi],
);
await measure(
  'the area predicate of one inventory window',
  'authenticated',
  windowSql,
  ['legacy', province.id, province.name_vi],
);

// The mechanism, on a probe table of its own: the same expression index is used while the policy
// states no condition and ignored as soon as it states one, so the barrier rather than the
// function's volatility is what keeps the index out of the plan.
await db.exec(`
create table public.evidence_probe(id int, label text);
`);
await db.query(
  "insert into public.evidence_probe select g, case when g=1 then $1 else 'x' end from generate_series(1,20000) g",
  [province.name_vi],
);
await db.exec(`
create index evidence_probe_lower_idx on public.evidence_probe (lower(label));
analyze public.evidence_probe;
alter table public.evidence_probe enable row level security;
grant select on public.evidence_probe to authenticated;
create policy evidence_probe_open on public.evidence_probe for select to authenticated using (true);
`);
const probeSql =
  'select count(*) from public.evidence_probe p where lower(p.label) = lower($1)';
await measure(
  'a lower() expression index under a policy with no condition',
  'authenticated',
  probeSql,
  [province.name_vi],
);
await db.exec(`
drop policy evidence_probe_open on public.evidence_probe;
create policy evidence_probe_condition on public.evidence_probe for select to authenticated using (id > 0);
`);
await measure(
  'the same expression index under a policy stating id > 0',
  'authenticated',
  probeSql,
  [province.name_vi],
);
await db.exec(`
drop policy evidence_probe_condition on public.evidence_probe;
create policy evidence_probe_session on public.evidence_probe for select to authenticated
  using (private.employee_id() is not null);
`);
await measure(
  'the same expression index under the session-function policy this database uses',
  'authenticated',
  probeSql,
  [province.name_vi],
);

say();
say(
  'Conclusion: with a policy that states a condition, PostgreSQL 18.3 keeps the expression ' +
    'restriction above the security barrier, so the text level is normalised per candidate address ' +
    'and the expression index cannot serve the read. The candidate indexes were therefore not ' +
    'shipped; making the text path fast needs persisted normalised text with its own index.',
);
await db.exec('reset role');
await db.close();
