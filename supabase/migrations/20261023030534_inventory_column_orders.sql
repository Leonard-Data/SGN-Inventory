-- The properties table's headers order by their own column. The read gains one order
-- key per sortable heading and direction - `price`, `area`, `frontage`, `depth`, `status` and
-- `changed` - beside the two entry-date orderings it already answered, and refuses every other
-- value exactly as it did. A column ordering is a reordering of the ordinary unarchived browse, so
-- it keeps that browse's status boundary, RLS boundary and employee rule; only `oldest` and
-- `newest` remain the eligible-status, employee-only chronology. Each new order sorts records that
-- state no value last in both directions and breaks ties on the property identity, so the stream
-- is one total order and a window boundary can neither drop nor repeat a row.
-- The order itself is now stated once: the window numbers the whole filtered set in that order and
-- the answered rows carry that position, instead of the same twenty expressions appearing in the
-- window and again in the outer select. Nothing else about the read changes - the same parameters,
-- the same columns, the same matching total, the archived boundary, the filters, the employee
-- guard, the grants and no record becoming eligible or ineligible.
-- This migration follows `20261022095500_inventory_recent_change_order.sql` and replaces the
-- function body rather than adding a second overload. It is a replace-function change with no
-- table, column, index or data change.
begin;

create or replace function public.stream_inventory(p_order text default null,p_query text default '',p_offset integer default 0,
  p_limit integer default 100,p_status text default null,p_mode text default null,p_type text default null,
  p_price_min numeric default null,p_price_max numeric default null,p_area_min numeric default null,
  p_area_max numeric default null,p_province_id uuid default null,p_district_id uuid default null,
  p_commune_id uuid default null,p_contact_id uuid default null,
  p_address_format text default null,p_access_type text default null,p_frontage_min numeric default null,
  p_frontage_max numeric default null,
  p_depth_min numeric default null,p_depth_max numeric default null)
returns table(total_count bigint,id uuid,property_code text,listing_mode text,status text,property_type text,
  cover_file_id uuid,frontage_m text,depth_m text,land_area_m2 text,floor_area_m2 text,floors smallint,direction text,
  access_type text,entry_on date,entry_source text,age_days integer,created_at timestamptz,updated_at timestamptz,
  sale_price_vnd text,monthly_rent_vnd text)
language plpgsql stable security invoker set search_path='' as $$
declare row_limit integer; price_lo numeric:=coalesce(p_price_min,0); price_hi numeric:=coalesce(p_price_max,999999999999999999);
  area_lo numeric:=coalesce(p_area_min,0); area_hi numeric:=coalesce(p_area_max,9999999999.99);
  frontage_lo numeric:=coalesce(p_frontage_min,0); frontage_hi numeric:=coalesce(p_frontage_max,9999999999.99);
  depth_lo numeric:=coalesce(p_depth_min,0); depth_hi numeric:=coalesce(p_depth_max,9999999999.99);
  province_name text; district_name text; commune_name text;
begin
  -- The official name each stated level is also matched by, normalised once here rather than per
  -- address row.
  province_name:=private.normalize_unit_text((select u.name_vi from public.admin_unit_versions u where u.id = p_province_id));
  district_name:=private.normalize_unit_text((select u.name_vi from public.admin_unit_versions u where u.id = p_district_id));
  commune_name:=private.normalize_unit_text((select u.name_vi from public.admin_unit_versions u where u.id = p_commune_id));
  -- Every ordering this read answers, and no other: an unknown or re-spelled value is refused
  -- rather than served as a different order. The entry chronology is the eligible-status,
  -- employee-only view; a column ordering and an absent `p_order` are the ordinary unarchived
  -- browse, which keeps its own unchanged RLS and status boundary.
  if p_order is not null then
    if p_order not in ('oldest','newest','price-asc','price-desc','area-asc','area-desc',
      'frontage-asc','frontage-desc','depth-asc','depth-desc','status-asc','status-desc',
      'changed-asc','changed-desc') then
      raise exception 'invalid inventory ordering' using errcode='22023';
    end if;
    if p_order in ('oldest','newest') and private.employee_id() is null then
      raise exception 'active employee required' using errcode='42501';
    end if;
  end if;
  -- An overlong search is refused rather than returned as an empty inventory, so a caller never
  -- mistakes a rejected query for a result set with no matches.
  if length(coalesce(p_query,'')) > 120 then raise exception 'invalid inventory query' using errcode='22023'; end if;
  -- A negative or absent offset is refused rather than read as the first window; the stream's
  -- first window is stated as zero. The window length is bounded so one fetch stays roughly a
  -- hundred rows whatever the caller asks for.
  if p_offset is null or p_offset < 0 then raise exception 'invalid inventory offset' using errcode='22023'; end if;
  if p_status is not null and p_status not in ('draft','available','negotiating','sold','rented','withdrawn') then
    raise exception 'invalid inventory status' using errcode='22023';
  end if;
  if p_mode is not null and p_mode not in ('sale','rent','both') then
    raise exception 'invalid inventory listing mode' using errcode='22023';
  end if;
  if p_type is not null and p_type not in ('house','land','apartment','villa','serviced_apartment','unclassified') then
    raise exception 'invalid inventory property type' using errcode='22023';
  end if;
  -- An `alternate` address is a recorded other address rather than one of the two formats a
  -- property is searched by, so it is not a value this read accepts.
  if p_address_format is not null and p_address_format not in ('legacy','current') then
    raise exception 'invalid inventory address format' using errcode='22023';
  end if;
  -- The five recorded access states, and nothing else: an unknown or re-spelled value is refused
  -- rather than read as a filter that matches nothing.
  if p_access_type is not null and p_access_type not in ('unknown','street_front','car_alley','motorbike_alley','three_wheeler_alley') then
    raise exception 'invalid inventory access type' using errcode='22023';
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
  -- A dimension bound is validated by the area bound's own rule, so one metric range is stated the
  -- same way whichever measure it names.
  if p_frontage_min is not null and (p_frontage_min <= 0 or p_frontage_min > 9999999999.99 or p_frontage_min <> round(p_frontage_min,2)) then
    raise exception 'invalid inventory frontage bound' using errcode='22023';
  end if;
  if p_frontage_max is not null and (p_frontage_max <= 0 or p_frontage_max > 9999999999.99 or p_frontage_max <> round(p_frontage_max,2)) then
    raise exception 'invalid inventory frontage bound' using errcode='22023';
  end if;
  if p_depth_min is not null and (p_depth_min <= 0 or p_depth_min > 9999999999.99 or p_depth_min <> round(p_depth_min,2)) then
    raise exception 'invalid inventory depth bound' using errcode='22023';
  end if;
  if p_depth_max is not null and (p_depth_max <= 0 or p_depth_max > 9999999999.99 or p_depth_max <> round(p_depth_max,2)) then
    raise exception 'invalid inventory depth bound' using errcode='22023';
  end if;
  if p_price_min is not null and p_price_max is not null and p_price_min > p_price_max then
    raise exception 'reversed inventory price range' using errcode='22023';
  end if;
  if p_area_min is not null and p_area_max is not null and p_area_min > p_area_max then
    raise exception 'reversed inventory area range' using errcode='22023';
  end if;
  if p_frontage_min is not null and p_frontage_max is not null and p_frontage_min > p_frontage_max then
    raise exception 'reversed inventory frontage range' using errcode='22023';
  end if;
  if p_depth_min is not null and p_depth_max is not null and p_depth_min > p_depth_max then
    raise exception 'reversed inventory depth range' using errcode='22023';
  end if;
  row_limit:=greatest(1,least(coalesce(p_limit,100),200));
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
      and (p_order is null or p_order not in ('oldest','newest') or p.status in ('available','negotiating'))
      and (p_status is null or p.status = p_status)
      and (p_mode is null or p.listing_mode = p_mode or p.listing_mode = 'both')
      and (p_type is null or p.property_type = p_type)
      and (p_access_type is null or p.access_type = p_access_type)
      -- The selected format's own recorded address, which a property without one does not match.
      and (p_address_format is null or exists (select 1 from public.property_addresses a
        where a.property_id = p.id and a.format = p_address_format))
      -- The stated administrative levels, composed on one address of the searched format: a
      -- province, a district and a ward each narrow the level stated above them, so a set naming
      -- all three matches only the address recording all three rather than one address for each.
      -- A level matches its recorded unit or, for an address recorded as text with no unit, that
      -- level's own text when it states the selected unit's official name.
      and (coalesce(p_province_id,p_district_id,p_commune_id) is null or exists (
        select 1 from public.property_addresses a where a.property_id = p.id
          and (p_address_format is null or a.format = p_address_format)
          and (p_province_id is null or a.province_unit_id = p_province_id
            or (province_name <> '' and private.normalize_unit_text(a.province_text) = province_name))
          and (p_district_id is null or a.district_unit_id = p_district_id
            or (district_name <> '' and private.normalize_unit_text(a.district_text) = district_name))
          and (p_commune_id is null or a.commune_unit_id = p_commune_id
            or (commune_name <> '' and private.normalize_unit_text(a.commune_text) = commune_name))))
      and (p_contact_id is null or exists (select 1 from public.property_contacts pc where pc.property_id = p.id
        and pc.contact_id = p_contact_id))
      and ((p_price_min is null and p_price_max is null)
        or (coalesce(p_mode,p.listing_mode) <> 'rent' and p.sale_price_vnd between price_lo and price_hi)
        or (coalesce(p_mode,p.listing_mode) = 'rent' and p.monthly_rent_vnd between price_lo and price_hi))
      and ((p_area_min is null and p_area_max is null)
        or (p.land_area_m2 between area_lo and area_hi) or (p.floor_area_m2 between area_lo and area_hi))
      -- Each dimension is its own range; a property recording none is not inside a stated one.
      and ((p_frontage_min is null and p_frontage_max is null)
        or (p.frontage_m between frontage_lo and frontage_hi))
      and ((p_depth_min is null and p_depth_max is null)
        or (p.depth_m between depth_lo and depth_hi))
      and (coalesce(btrim(p_query),'') = '' or p.property_code ilike s.code_pattern escape E'\\'
        or exists (select 1 from public.property_addresses a where a.property_id = p.id
          and a.search_text like s.address_pattern escape E'\\'
          and (p_address_format is null or a.format = p_address_format)))
  ), counted as materialized (
    select count(*)::bigint as total from filtered
  ), windowed as materialized (
    -- One total order over the whole filtered set: the default browse is most-recently-changed
    -- first by the record's own modification time then identity, the eligible chronology orders by
    -- recorded entry date
    -- then identity in the requested direction with unknown dates placed last. A window is a slice
    -- of exactly that order, so consecutive fetches neither repeat nor skip a record.
    select r.*, row_number() over (
      order by
        -- The entry chronology places its unknown dates last whichever way it runs.
        case when p_order in ('oldest','newest') and r.entry_on is null then 1 else 0 end,
        case when p_order = 'oldest' then r.entry_on end asc,
        case when p_order = 'newest' then r.entry_on end desc,
        -- The default browse.
        case when p_order is null then r.updated_at end desc,
        -- One column ordering: price is the value the row states (a rent listing its monthly rent,
        -- otherwise its sale price), the area is the floor area where it is recorded and the land
        -- area otherwise, and the modification time is the record's own. A record that states no
        -- value sorts last in both directions rather than first in one of them.
        case when p_order = 'price-asc' then (case when r.listing_mode = 'rent'
          then coalesce(r.monthly_rent_vnd,r.sale_price_vnd)
          else coalesce(r.sale_price_vnd,r.monthly_rent_vnd) end) end asc,
        case when p_order = 'price-desc' then (case when r.listing_mode = 'rent'
          then coalesce(r.monthly_rent_vnd,r.sale_price_vnd)
          else coalesce(r.sale_price_vnd,r.monthly_rent_vnd) end) end desc nulls last,
        case when p_order = 'area-asc' then coalesce(r.floor_area_m2,r.land_area_m2) end asc,
        case when p_order = 'area-desc' then coalesce(r.floor_area_m2,r.land_area_m2) end desc nulls last,
        case when p_order = 'frontage-asc' then r.frontage_m end asc,
        case when p_order = 'frontage-desc' then r.frontage_m end desc nulls last,
        case when p_order = 'depth-asc' then r.depth_m end asc,
        case when p_order = 'depth-desc' then r.depth_m end desc nulls last,
        -- Status is ordered by the workflow the statuses progress through, never alphabetically.
        case when p_order = 'status-asc' then array_position(
          array['draft','available','negotiating','sold','rented','withdrawn'], r.status) end asc,
        case when p_order = 'status-desc' then array_position(
          array['draft','available','negotiating','sold','rented','withdrawn'], r.status) end desc nulls last,
        case when p_order = 'changed-asc' then r.updated_at end asc,
        case when p_order = 'changed-desc' then r.updated_at end desc nulls last,
        -- The identity breaks every tie the same way the direction runs, so one total order covers
        -- the whole filtered set and a window boundary neither drops nor repeats a row.
        case when p_order = 'oldest' then r.id end asc,
        case when p_order = 'newest' then r.id end desc,
        case when p_order is null then r.id end desc,
        case when p_order like '%-asc' then r.id end asc,
        case when p_order like '%-desc' then r.id end desc
    ) as position
    from filtered r
    limit row_limit offset p_offset
  )
  -- The window's rows ride beside the single counting row, so every read states the matching
  -- total - a window past the end, or a filter that matches nothing, answers one row whose
  -- window columns are null. The outer order repeats the window's order so the stated row order
  -- is the same total order the window sliced.
  select c.total, w.id, w.property_code, w.listing_mode, w.status, w.property_type, w.cover_file_id,
    w.frontage_m::text, w.depth_m::text, w.land_area_m2::text, w.floor_area_m2::text, w.floors, w.direction,
    w.access_type, w.entry_on, w.entry_source,
    case when w.entry_on is not null then w.vn_today - w.entry_on end,
    w.created_at, w.updated_at, w.sale_price_vnd::text, w.monthly_rent_vnd::text
  from counted c left join windowed w on true
  order by w.position;
end;
$$;
revoke all on function public.stream_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric) from public,anon;
grant execute on function public.stream_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid,uuid,uuid,text,text,numeric,numeric,numeric,numeric) to authenticated;

commit;
