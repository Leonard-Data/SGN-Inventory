-- Ticket #122: filter the inventory by a recorded Property contact.
-- The properties list gains a contact parameter beside the existing status, listing mode,
-- type, price, area and administrative-area filters. It matches through the recorded
-- property↔contact link (`public.property_contacts`), in one bounded read with no per-row
-- round trip, and composes with every other filter and with the free-text query. The link
-- read is the existing `links_read`/`properties_read` RLS boundary, so a link on an archived
-- property outside the caller's authority is excluded exactly as it is from the directory's
-- own readable links; the ordinary browse additionally keeps `archived_at is null` and the
-- chronological walk keeps its unarchived `available`/`negotiating` eligible set. Adding a
-- parameter changes the signature, so each function is replaced rather than rewritten in
-- place; validation, limits, ordering and grants are otherwise unchanged.
begin;

drop function public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric);
create function public.search_properties(p_query text default '',p_status text default null,p_mode text default null,
  p_type text default null,p_area_id uuid default null,p_after uuid default null,p_limit integer default 30,
  p_price_min numeric default null,p_price_max numeric default null,p_area_min numeric default null,p_area_max numeric default null,
  p_contact_id uuid default null)
returns setof public.properties language plpgsql stable security invoker set search_path = '' as $$
declare price_lo numeric:=coalesce(p_price_min,0); price_hi numeric:=coalesce(p_price_max,999999999999999999);
  area_lo numeric:=coalesce(p_area_min,0); area_hi numeric:=coalesce(p_area_max,9999999999.99);
begin
  if p_status is not null and p_status not in ('draft','available','negotiating','sold','rented','withdrawn') then
    raise exception 'invalid inventory status' using errcode='22023';
  end if;
  if p_mode is not null and p_mode not in ('sale','rent','both') then
    raise exception 'invalid inventory listing mode' using errcode='22023';
  end if;
  if p_type is not null and p_type not in ('house','land','apartment','villa','serviced_apartment','unclassified') then
    raise exception 'invalid inventory property type' using errcode='22023';
  end if;
  if p_price_min is not null and (p_price_min < 0 or p_price_min > 999999999999999999 or p_price_min <> trunc(p_price_min)) then
    raise exception 'invalid inventory price bound' using errcode='22023';
  end if;
  if p_price_max is not null and (p_price_max < 0 or p_price_max > 999999999999999999 or p_price_max <> trunc(p_price_max)) then
    raise exception 'invalid inventory price bound' using errcode='22023';
  end if;
  if p_area_min is not null and (p_area_min <= 0 or p_area_min > 9999999999.99 or p_area_min <> round(p_area_min,2)) then
    raise exception 'invalid inventory area bound' using errcode='22023';
  end if;
  if p_area_max is not null and (p_area_max <= 0 or p_area_max > 9999999999.99 or p_area_max <> round(p_area_max,2)) then
    raise exception 'invalid inventory area bound' using errcode='22023';
  end if;
  if p_price_min is not null and p_price_max is not null and p_price_min > p_price_max then
    raise exception 'reversed inventory price range' using errcode='22023';
  end if;
  if p_area_min is not null and p_area_max is not null and p_area_min > p_area_max then
    raise exception 'reversed inventory area range' using errcode='22023';
  end if;
  return query
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
    and (p_contact_id is null or exists (select 1 from public.property_contacts pc where pc.property_id = p.id
      and pc.contact_id = p_contact_id))
    and ((p_price_min is null and p_price_max is null)
      or (coalesce(p_mode,p.listing_mode) <> 'rent' and p.sale_price_vnd between price_lo and price_hi)
      or (coalesce(p_mode,p.listing_mode) = 'rent' and p.monthly_rent_vnd between price_lo and price_hi))
    and ((p_area_min is null and p_area_max is null)
      or (p.land_area_m2 between area_lo and area_hi) or (p.floor_area_m2 between area_lo and area_hi))
    and (coalesce(btrim(p_query),'') = '' or p.property_code ilike s.code_pattern escape E'\\'
      or exists (select 1 from public.property_addresses a where a.property_id = p.id
        and a.search_text like s.address_pattern escape E'\\'))
  order by p.id limit greatest(1,least(coalesce(p_limit,30),50));
end;
$$;
revoke all on function public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric,uuid) from public,anon;
grant execute on function public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric,uuid) to authenticated;

drop function public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid);
create function public.list_inventory_by_age(p_direction text,p_query text default '',p_after_on date default null,
  p_after_id uuid default null,p_after_unknown boolean default false,p_limit integer default 30,p_status text default null,
  p_mode text default null,p_type text default null,p_price_min numeric default null,p_price_max numeric default null,
  p_area_min numeric default null,p_area_max numeric default null,p_area_id uuid default null,p_contact_id uuid default null)
returns table(id uuid,property_code text,listing_mode text,status text,cover_file_id uuid,frontage_m text,depth_m text,
  land_area_m2 text,floor_area_m2 text,floors smallint,direction text,access_type text,entry_on date,entry_source text,age_days integer)
language plpgsql stable security invoker set search_path='' as $$
declare page_size integer; price_lo numeric:=coalesce(p_price_min,0); price_hi numeric:=coalesce(p_price_max,999999999999999999);
  area_lo numeric:=coalesce(p_area_min,0); area_hi numeric:=coalesce(p_area_max,9999999999.99);
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if length(coalesce(p_query,'')) > 120 then raise exception 'invalid inventory query' using errcode='22023'; end if;
  if p_direction is null or p_direction not in ('oldest','newest') then
    raise exception 'invalid inventory ordering' using errcode='22023';
  end if;
  if p_after_unknown is null then raise exception 'invalid inventory cursor' using errcode='22023'; end if;
  if p_after_unknown then
    if p_after_id is null or p_after_on is not null then raise exception 'invalid inventory cursor' using errcode='22023'; end if;
  elsif (p_after_id is null) <> (p_after_on is null) then
    raise exception 'invalid inventory cursor' using errcode='22023';
  end if;
  if p_status is not null and p_status not in ('draft','available','negotiating','sold','rented','withdrawn') then
    raise exception 'invalid inventory status' using errcode='22023';
  end if;
  if p_mode is not null and p_mode not in ('sale','rent','both') then
    raise exception 'invalid inventory listing mode' using errcode='22023';
  end if;
  if p_type is not null and p_type not in ('house','land','apartment','villa','serviced_apartment','unclassified') then
    raise exception 'invalid inventory property type' using errcode='22023';
  end if;
  if p_price_min is not null and (p_price_min < 0 or p_price_min > 999999999999999999 or p_price_min <> trunc(p_price_min)) then
    raise exception 'invalid inventory price bound' using errcode='22023';
  end if;
  if p_price_max is not null and (p_price_max < 0 or p_price_max > 999999999999999999 or p_price_max <> trunc(p_price_max)) then
    raise exception 'invalid inventory price bound' using errcode='22023';
  end if;
  if p_area_min is not null and (p_area_min <= 0 or p_area_min > 9999999999.99 or p_area_min <> round(p_area_min,2)) then
    raise exception 'invalid inventory area bound' using errcode='22023';
  end if;
  if p_area_max is not null and (p_area_max <= 0 or p_area_max > 9999999999.99 or p_area_max <> round(p_area_max,2)) then
    raise exception 'invalid inventory area bound' using errcode='22023';
  end if;
  if p_price_min is not null and p_price_max is not null and p_price_min > p_price_max then
    raise exception 'reversed inventory price range' using errcode='22023';
  end if;
  if p_area_min is not null and p_area_max is not null and p_area_min > p_area_max then
    raise exception 'reversed inventory area range' using errcode='22023';
  end if;
  page_size:=greatest(1,least(coalesce(p_limit,30),50));
  return query
  with patterns as materialized (
    select '%' || replace(replace(replace(coalesce(p_query,''),chr(92),chr(92)||chr(92)),
      '%',chr(92)||'%'),'_',chr(92)||'_') || '%' as code_pattern
  ), search as materialized (
    select code_pattern, private.normalize_search(code_pattern) as address_pattern from patterns
  ), eligible as (
    select p.id,p.property_code,p.listing_mode,p.status,p.cover_file_id,p.frontage_m,p.depth_m,p.land_area_m2,
      p.floor_area_m2,p.floors,p.direction,p.access_type,p.entry_on,p.entry_source,
      (now() at time zone 'Asia/Ho_Chi_Minh')::date as vn_today
    from public.properties p cross join search s
    where p.archived_at is null and p.status in ('available','negotiating')
      and (p_status is null or p.status = p_status)
      and (p_mode is null or p.listing_mode = p_mode or p.listing_mode = 'both')
      and (p_type is null or p.property_type = p_type)
      and (p_area_id is null or exists (select 1 from public.property_addresses a where a.property_id = p.id
        and p_area_id in (a.province_unit_id,a.district_unit_id,a.commune_unit_id)))
      and (p_contact_id is null or exists (select 1 from public.property_contacts pc where pc.property_id = p.id
        and pc.contact_id = p_contact_id))
      and ((p_price_min is null and p_price_max is null)
        or (coalesce(p_mode,p.listing_mode) <> 'rent' and p.sale_price_vnd between price_lo and price_hi)
        or (coalesce(p_mode,p.listing_mode) = 'rent' and p.monthly_rent_vnd between price_lo and price_hi))
      and ((p_area_min is null and p_area_max is null)
        or (p.land_area_m2 between area_lo and area_hi) or (p.floor_area_m2 between area_lo and area_hi))
      and (coalesce(btrim(p_query),'') = '' or p.property_code ilike s.code_pattern escape E'\\'
        or exists (select 1 from public.property_addresses a where a.property_id = p.id
          and a.search_text like s.address_pattern escape E'\\'))
  )
  select e.id,e.property_code,e.listing_mode,e.status,e.cover_file_id,e.frontage_m::text,e.depth_m::text,
    e.land_area_m2::text,e.floor_area_m2::text,e.floors,e.direction,e.access_type,e.entry_on,e.entry_source,
    case when e.entry_on is not null then e.vn_today - e.entry_on end
  from eligible e
  where (p_after_id is null and not p_after_unknown)
    or (e.entry_on is not null and not p_after_unknown
      and case when p_direction='oldest' then (e.entry_on,e.id) > (p_after_on,p_after_id)
        else (e.entry_on,e.id) < (p_after_on,p_after_id) end)
    or (e.entry_on is null and (not p_after_unknown
      or case when p_direction='oldest' then e.id > p_after_id else e.id < p_after_id end))
  order by (e.entry_on is null),
    case when p_direction='oldest' then e.entry_on end asc,
    case when p_direction='newest' then e.entry_on end desc,
    case when p_direction='oldest' then e.id end asc,
    case when p_direction='newest' then e.id end desc
  limit page_size;
end;
$$;
revoke all on function public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid) from public,anon;
grant execute on function public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid) to authenticated;
commit;
