-- Ticket #140: the properties list states how many properties match and pages the result set by
-- number instead of walking a cursor trail. One filtered read returns the matching total beside
-- one page of rows, so the count, the rows and the page links always describe the same result
-- set. Both orderings - the ordinary browse and the eligible oldest-first/newest-first
-- chronology - are that same read, selected by a validated `p_order`, so there is one predicate
-- for the count and the rows rather than two that can drift apart.
-- The pagination is offset based because a page number is what the pager offers and a cursor
-- cannot express one; the page size ceiling stays 50 until the page-size ticket raises it.
-- Filters, search, the archived boundary, the eligible-status boundary, the employee guard and
-- the grants are unchanged, and both replaced functions had no other caller.
begin;

drop function public.search_properties(text,text,text,text,uuid,uuid,integer,numeric,numeric,numeric,numeric,uuid);
drop function public.list_inventory_by_age(text,text,date,uuid,boolean,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid);

create function public.page_inventory(p_order text default null,p_query text default '',p_page integer default 1,
  p_page_size integer default 30,p_status text default null,p_mode text default null,p_type text default null,
  p_price_min numeric default null,p_price_max numeric default null,p_area_min numeric default null,
  p_area_max numeric default null,p_area_id uuid default null,p_contact_id uuid default null)
returns table(total_count bigint,page_number integer,id uuid,property_code text,listing_mode text,status text,
  cover_file_id uuid,frontage_m text,depth_m text,land_area_m2 text,floor_area_m2 text,floors smallint,direction text,
  access_type text,entry_on date,entry_source text,age_days integer)
language plpgsql stable security invoker set search_path='' as $$
declare page_size integer; price_lo numeric:=coalesce(p_price_min,0); price_hi numeric:=coalesce(p_price_max,999999999999999999);
  area_lo numeric:=coalesce(p_area_min,0); area_hi numeric:=coalesce(p_area_max,9999999999.99);
begin
  -- The chronological order is the eligible-status, employee-only view; an absent `p_order` is
  -- the ordinary unarchived browse, which keeps its own unchanged RLS boundary.
  if p_order is not null then
    if p_order not in ('oldest','newest') then raise exception 'invalid inventory ordering' using errcode='22023'; end if;
    if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  end if;
  -- An overlong search is refused rather than returned as an empty inventory, so a caller never
  -- mistakes a rejected query for a result set with no matches.
  if length(coalesce(p_query,'')) > 120 then raise exception 'invalid inventory query' using errcode='22023'; end if;
  if p_page is null or p_page < 1 then raise exception 'invalid inventory page' using errcode='22023'; end if;
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
  page_size:=greatest(1,least(coalesce(p_page_size,30),50));
  return query
  with patterns as materialized (
    select '%' || replace(replace(replace(coalesce(p_query,''),chr(92),chr(92)||chr(92)),
      '%',chr(92)||'%'),'_',chr(92)||'_') || '%' as code_pattern
  ), search as materialized (
    select code_pattern, private.normalize_search(code_pattern) as address_pattern from patterns
  ), filtered as materialized (
    select p.*, (now() at time zone 'Asia/Ho_Chi_Minh')::date as vn_today
    from public.properties p cross join search s
    where p.archived_at is null
      and (p_order is null or p.status in ('available','negotiating'))
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
  ), counted as materialized (
    select count(*)::bigint as total from filtered
  ), bounded as materialized (
    -- A page past the end is corrected to the last page inside this same read, so the count and
    -- the rows it belongs to are never read from two statements that can disagree. `page_size`
    -- never exceeds 50, so the integer division below can only move the page back onto the
    -- filtered set.
    select c.total,
      (1 + least((p_page - 1)::bigint, case when c.total > 0 then (c.total - 1) / page_size else 0 end))::integer as page_number,
      least((p_page - 1)::bigint, case when c.total > 0 then (c.total - 1) / page_size else 0 end) * page_size as page_offset
    from counted c
  ), paged as materialized (
    -- One total order over the whole filtered set: the eligible chronology orders by recorded
    -- entry date then identity with unknown dates placed last, the ordinary browse by identity.
    -- Either way the page is a slice of exactly that order, so pages neither repeat nor skip.
    select f.*, row_number() over (
      order by (p_order is not null and f.entry_on is null),
        case when p_order = 'oldest' then f.entry_on end asc,
        case when p_order = 'newest' then f.entry_on end desc,
        case when p_order = 'newest' then f.id end desc,
        case when p_order is distinct from 'newest' then f.id end asc) as ordinal
    from filtered f
  )
  -- An empty filtered set returns no rows at all: the caller reads that as a total of zero.
  -- Any non-empty set answers every page, because the offset above is clamped onto it.
  select b.total, b.page_number, r.id, r.property_code, r.listing_mode, r.status, r.cover_file_id,
    r.frontage_m::text, r.depth_m::text, r.land_area_m2::text, r.floor_area_m2::text, r.floors, r.direction,
    r.access_type, r.entry_on, r.entry_source,
    case when r.entry_on is not null then r.vn_today - r.entry_on end
  from bounded b join paged r on r.ordinal > b.page_offset and r.ordinal <= b.page_offset + page_size
  order by r.ordinal;
end;
$$;
revoke all on function public.page_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid) from public,anon;
grant execute on function public.page_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid) to authenticated;
commit;
