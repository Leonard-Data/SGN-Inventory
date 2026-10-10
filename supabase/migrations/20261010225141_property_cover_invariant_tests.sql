-- Ticket #27: Property cover invariant tests (embedded pgTAP).
-- Run separately from the main migration; uses pgtap.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

-- Plan: 11 tests
select plan(11);

-- 1. cover_file_id column exists on properties
select has_column('properties','cover_file_id');

-- 2. cover_file_id is nullable
select col_is_null('properties','cover_file_id');

-- 3. FK exists to property_files
select col_is_fk('properties','cover_file_id');

-- 4. Direct UPDATE of cover_file_id is denied via trigger
select throws_ok(
  $$update public.properties set cover_file_id = '00000000-0000-0000-0000-000000000000' where id = (select id from public.properties limit 1)$$,
  '42501',
  'cover_file_id is set/cleared only through set_property_cover RPC',
  'direct cover update denied'
);

-- 5. set_property_cover exists as public invoker RPC
select has_function('public.set_property_cover');

-- 6. clear_property_cover exists as public invoker RPC
select has_function('public.clear_property_cover');

-- 7. set_property_cover available to authenticated
select has_function_privilege('authenticated','public.set_property_cover(uuid,uuid)','EXECUTE');

-- 8. clear_property_cover available to authenticated
select has_function_privilege('authenticated','public.clear_property_cover(uuid)','EXECUTE');

-- 9. Direct cover UPDATE blocked for anonymous
select is_empty(
  $$select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='set_property_cover' and has_function_privilege('anon',p.oid,'EXECUTE')$$
);

-- 10. Guard trigger exists
select ok(
  exists(select 1 from pg_trigger where tgname = 'property_cover_guard'),
  'property_cover_guard trigger exists'
);

-- 11. cover_file_id is guarded by the trigger (trigger is before update)
select ok(
  exists(select 1 from pg_trigger where tgname = 'property_cover_guard' and tgtype & 2::smallint > 0),
  'property_cover_guard is before update trigger'
);

select * from finish();
rollback;
