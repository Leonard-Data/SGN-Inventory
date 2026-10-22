-- Ticket #243: the inventory is searched through one of the two address formats a property
-- records - the legacy address, which is the default, or the current one. `p_address_format`
-- names the format the read matches through: a property matches only when it records an address in
-- that format, and the typed query is compared with that format's address text alone, so switching
-- the format answers a different, already-recorded inventory rather than inventing an address for a
-- property that has none. An absent `p_address_format` (NULL) applies no format condition, which is
-- the read every other number of this stream has always answered; the application states the format
-- on every call, so its own searches are never the unconditional form.
-- The administrative-area and contact conditions are deliberately not narrowed by the format: the
-- unit pickers list the current catalog's units, which a legacy address names through its own legacy
-- units, so narrowing the area match by format would answer a chosen province with nothing. Nothing
-- else about the stream changes: the ordering, the offset windows, the matching total, the archived
-- and eligible-status boundaries, the employee guard and the grants are as they were. The retired
-- `public.page_inventory` stays in place and unused.
begin;

-- The signature gains one trailing parameter, so the previous form is dropped rather than left
-- beside it as a second overload a named-argument call could resolve to either way.
drop function public.stream_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid);

create function public.stream_inventory(p_order text default null,p_query text default '',p_offset integer default 0,
  p_limit integer default 100,p_status text default null,p_mode text default null,p_type text default null,
  p_price_min numeric default null,p_price_max numeric default null,p_area_min numeric default null,
  p_area_max numeric default null,p_area_id uuid default null,p_contact_id uuid default null,
  p_address_format text default null)
returns table(total_count bigint,id uuid,property_code text,listing_mode text,status text,property_type text,
  cover_file_id uuid,frontage_m text,depth_m text,land_area_m2 text,floor_area_m2 text,floors smallint,direction text,
  access_type text,entry_on date,entry_source text,age_days integer,created_at timestamptz,updated_at timestamptz,
  sale_price_vnd text,monthly_rent_vnd text)
language plpgsql stable security invoker set search_path='' as $$
declare row_limit integer; price_lo numeric:=coalesce(p_price_min,0); price_hi numeric:=coalesce(p_price_max,999999999999999999);
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
      and (p_order is null or p.status in ('available','negotiating'))
      and (p_status is null or p.status = p_status)
      and (p_mode is null or p.listing_mode = p_mode or p.listing_mode = 'both')
      and (p_type is null or p.property_type = p_type)
      -- The selected format's own recorded address, which a property without one does not match.
      and (p_address_format is null or exists (select 1 from public.property_addresses a
        where a.property_id = p.id and a.format = p_address_format))
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
          and a.search_text like s.address_pattern escape E'\\'
          and (p_address_format is null or a.format = p_address_format)))
  ), counted as materialized (
    select count(*)::bigint as total from filtered
  ), windowed as materialized (
    -- One total order over the whole filtered set: the default browse is newest-created first by
    -- recorded creation time then identity, the eligible chronology orders by recorded entry date
    -- then identity in the requested direction with unknown dates placed last. A window is a slice
    -- of exactly that order, so consecutive fetches neither repeat nor skip a record.
    select r.* from filtered r
    order by (p_order is not null and r.entry_on is null),
      case when p_order = 'oldest' then r.entry_on end asc,
      case when p_order = 'newest' then r.entry_on end desc,
      case when p_order is null then r.created_at end desc,
      case when p_order is distinct from 'oldest' then r.id end desc,
      case when p_order = 'oldest' then r.id end asc
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
  order by (p_order is not null and w.entry_on is null),
    case when p_order = 'oldest' then w.entry_on end asc,
    case when p_order = 'newest' then w.entry_on end desc,
    case when p_order is null then w.created_at end desc,
    case when p_order is distinct from 'oldest' then w.id end desc,
    case when p_order = 'oldest' then w.id end asc;
end;
$$;
revoke all on function public.stream_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid,text) from public,anon;
grant execute on function public.stream_inventory(text,text,integer,integer,text,text,text,numeric,numeric,numeric,numeric,uuid,uuid,text) to authenticated;
commit;
