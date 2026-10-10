begin;
-- Escape the user's literal fragment inside SQL, after validating its original length.
-- Keep LIKE so the existing trigram index can support address substring searches.
create or replace function public.search_properties(p_query text default '',p_status text default null,p_mode text default null,
  p_type text default null,p_area_id uuid default null,p_after uuid default null,p_limit integer default 30)
returns setof public.properties language sql stable security invoker set search_path = '' as $$
  with patterns as materialized (
    select '%' || replace(replace(replace(coalesce(p_query,''),chr(92),chr(92)||chr(92)),
      '%',chr(92)||'%'),'_',chr(92)||'_') || '%' as code_pattern
  ), search as materialized (
    select code_pattern, private.normalize_search(code_pattern) as address_pattern from patterns
  )
  select p.* from public.properties p cross join search s
  where p.archived_at is null and length(coalesce(p_query,'')) <= 120
    and (p_status is null or p.status = p_status)
    and (p_mode is null or p.listing_mode = p_mode or p.listing_mode = 'both')
    and (p_type is null or p.property_type = p_type)
    and (p_after is null or p.id > p_after)
    and (p_area_id is null or exists (select 1 from public.property_addresses a where a.property_id = p.id
      and p_area_id in (a.province_unit_id,a.district_unit_id,a.commune_unit_id)))
    and (coalesce(btrim(p_query),'') = '' or p.property_code ilike s.code_pattern escape E'\\'
      or exists (select 1 from public.property_addresses a where a.property_id = p.id
        and a.search_text like s.address_pattern escape E'\\'))
  order by p.id limit greatest(1,least(coalesce(p_limit,30),50));
$$;
revoke all on function public.search_properties(text,text,text,text,uuid,uuid,integer) from public,anon;
grant execute on function public.search_properties(text,text,text,text,uuid,uuid,integer) to authenticated;
commit;
