-- Issue #37: explicit original inventory entry date and chronological ordering.
-- The date is a recorded business fact, never an inference from created_at, updated_at,
-- import time or UUID order. Unknown is an explicit provenance value, not a plausible day.
begin;

alter table public.properties add column entry_on date;
alter table public.properties add column entry_source text not null default 'unknown'
  check (entry_source in ('unknown','recorded','legacy'));
alter table public.properties add constraint inventory_entry_provenance
  check ((entry_on is null) = (entry_source = 'unknown'));

-- Serves the eligible oldest-first keyset walk; newest-first reads the same rows by identity.
create index properties_inventory_entry_idx on public.properties(entry_on,id)
  where archived_at is null and status in ('available','negotiating');

-- The recorded original entry date is immutable once the property identity exists: relisting,
-- price edits, address corrections and ordinary updates can never reset inventory age. A new
-- identity may be inserted with a reliable legacy date by the controlled import path.
create function private.guard_inventory_entry_date() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.entry_on is not null and new.entry_on > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
      raise exception 'original inventory entry date cannot be in the future' using errcode='23514';
    end if;
  elsif new.entry_on is distinct from old.entry_on or new.entry_source is distinct from old.entry_source then
    raise exception 'original inventory entry date is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger property_inventory_entry_guard before insert or update on public.properties
  for each row execute function private.guard_inventory_entry_date();
revoke all on function private.guard_inventory_entry_date() from public,anon,authenticated;

-- Entry provenance is a business fact on the property, so creation records it in history.
create or replace function private.business_values(p_target text,p_row jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then to_jsonb(value #>> '{}') else value end),'{}'::jsonb)
  from jsonb_each(coalesce(p_row,'{}')) where key=any(case p_target
    when 'property' then array['property_code','listing_mode','property_type','access_type','status','entry_on','entry_source','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes']
    when 'address' then array['mapping_evidence','format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','mapping_status','verification_method','verified_by','verified_at','source_url','effective_on','is_primary','supersedes_address_id']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary'] else '{}'::text[] end);
$$;

-- A genuinely new property identity enters inventory today, so its recorded entry date is the
-- database's Vietnam business day. Legacy dates are set by the controlled import insert, never
-- derived here from timestamps or source order.
create or replace function private.create_property(p_mode text,p_facts jsonb,p_address jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); prop uuid; code text; rev uuid;
begin
  if me is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('sale','rent','both') then raise exception 'invalid creation' using errcode='23514'; end if;
  perform private.validate_maintenance('property',p_facts);
  perform private.validate_maintenance('address',p_address);
  if p_address->>'format' is null or p_address->>'format' not in ('legacy','current')
    or length(btrim(coalesce(p_address->>'address_text',''))) not between 1 and 2000
    or p_facts ?| array['legal_status','archived_at','record_review_status','status','entry_on','entry_source'] then
    raise exception 'invalid creation' using errcode='23514'; end if;
  loop
    code:='SGN-'||lpad(nextval('private.property_code_sequence')::text,8,'0');
    exit when not exists(select 1 from public.properties where property_code=code);
  end loop;
  insert into public.properties(property_code,listing_mode,status,created_by,entry_on,entry_source)
    values(code,p_mode,'available',me,(now() at time zone 'Asia/Ho_Chi_Minh')::date,'recorded')
    returning id,revision into prop,rev;
  if p_facts<>'{}'::jsonb then perform private.maintain_property(prop,'property',prop,rev,p_facts,rev); end if;
  select revision into rev from public.properties where id=prop;
  perform private.maintain_property(prop,'address',null,rev,p_address,rev);
  return prop;
end;
$$;
revoke all on function private.create_property(text,jsonb,jsonb),public.create_property(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.create_property(text,jsonb,jsonb),public.create_property(text,jsonb,jsonb) to authenticated;

-- Eligible oldest-first/newest-first inventory with a stable date+identity cursor. Both
-- directions are one bounded read: at most 30 exposed rows plus the cursor. Unknown entry dates
-- are a real, placement-explicit part of the list rather than missing properties, and they are
-- ordered after the dated rows by identity alone. Effective reservations stay separate facts;
-- eligibility is unarchived available/negotiating inventory under the caller's live RLS.
create function public.list_inventory_by_age(p_direction text,p_query text default '',p_after_on date default null,
  p_after_id uuid default null,p_after_unknown boolean default false,p_limit integer default 30)
returns table(id uuid,property_code text,listing_mode text,status text,cover_file_id uuid,frontage_m text,depth_m text,
  land_area_m2 text,floor_area_m2 text,floors smallint,direction text,access_type text,entry_on date,entry_source text,age_days integer)
language plpgsql stable security invoker set search_path='' as $$
declare page_size integer;
begin
  if p_direction is null or p_direction not in ('oldest','newest') then
    raise exception 'invalid inventory ordering' using errcode='22023';
  end if;
  if p_after_unknown is null then raise exception 'invalid inventory cursor' using errcode='22023'; end if;
  if p_after_unknown then
    if p_after_id is null or p_after_on is not null then raise exception 'invalid inventory cursor' using errcode='22023'; end if;
  elsif (p_after_id is null) <> (p_after_on is null) then
    raise exception 'invalid inventory cursor' using errcode='22023';
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
      and length(coalesce(p_query,'')) <= 120
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
revoke all on function public.list_inventory_by_age(text,text,date,uuid,boolean,integer) from public,anon;
grant execute on function public.list_inventory_by_age(text,text,date,uuid,boolean,integer) to authenticated;
commit;
