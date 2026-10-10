begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(11);
select ok(not has_table_privilege('anon','public.properties','SELECT'),'anonymous inventory select revoked');
select ok(not has_table_privilege('authenticated','public.property_locks','UPDATE'),'direct lock mutation revoked');
select ok(not has_table_privilege('authenticated','public.activity_events','INSERT'),'direct activity insertion revoked');
select ok(not has_table_privilege('authenticated','private.staging_rows','SELECT'),'staging is not client-readable');
select ok((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and c.relkind='r'),'all application tables use RLS');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='one_approved_lock'),'approved reservation uniqueness exists');
select ok((select public = false from storage.buckets where id='property-files'),'property bucket is private');
select ok(not has_table_privilege('authenticated','public.rental_agreements','UPDATE'),'direct rental lifecycle writes revoked');
select ok(not has_table_privilege('authenticated','public.rental_payments','INSERT'),'direct rental receipt writes revoked');
select ok(not has_table_privilege('anon','public.rental_months','SELECT'),'anonymous rental months select revoked');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='one_active_rental_per_property'),'whole-property active tenancy uniqueness exists');
select * from finish();
rollback;
