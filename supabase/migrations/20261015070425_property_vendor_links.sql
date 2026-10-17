-- Ticket #74: explicit Property–Vendor links and their correction. A link is a company
-- relationship on a property, never an owner link, reservation state or rental occupancy:
-- it carries no owner-primary marker and creates no owner-contact access credit. Reads
-- inherit the property-read and archived-property boundary; link/unlink are staff/manager/
-- admin maintenance writes (C5) through a guarded, revision-checked invoker operation.
begin;

create table public.property_vendors (
  property_id uuid not null references public.properties(id),
  vendor_id uuid not null references public.vendors(id),
  revision uuid not null default gen_random_uuid(),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  -- One link per property/vendor pair; also the property -> vendor lookup index.
  primary key (property_id, vendor_id)
);
comment on table public.property_vendors is 'Explicit property-to-vendor company links; corrected by unlink_property_vendor, which keeps the vendor and its earlier history';
comment on column public.property_vendors.revision is 'Link revision; a stale unlink context is refused instead of removing a changed relationship';
comment on column public.property_vendors.created_at is 'When the current relationship was linked; unchanged by later edits to the vendor identity';

-- The reverse lookup: one vendor's authorized linked-property projection.
create index property_vendors_vendor_idx on public.property_vendors(vendor_id, property_id);

alter table public.property_vendors enable row level security;
-- Explicit grants: reads only. No client INSERT/UPDATE/DELETE path exists; every write
-- goes through the guarded operations below.
revoke all on public.property_vendors from public, anon, authenticated, service_role;
grant select on public.property_vendors to authenticated;

-- Read authority is live membership plus the reader's own property access, so an archived
-- property stays reviewer-only through the existing properties policy.
create policy property_vendors_read on public.property_vendors for select to authenticated using (
  private.employee_id() is not null
  and exists (select 1 from public.properties p where p.id = property_id)
);

create function private.guard_property_vendor_write() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'use the link or unlink operation' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger property_vendor_guard before insert or update or delete on public.property_vendors
  for each row execute function private.guard_property_vendor_write();

-- Linking keeps the same short maintenance gate and parent-before-target lock order as the
-- other property writes: the parent property row first, then the vendor row, then the link
-- row. An interrupted duplicate submission converges on the recorded relationship instead
-- of recording the same company twice.
create function private.link_property_vendor(
  p_property_id uuid,
  p_vendor_id uuid,
  p_expected_property_revision uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  prop public.properties;
  link public.property_vendors;
  company public.vendors;
  created_here boolean := false;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if private.employee_role() not in ('staff','manager','admin') then
    raise exception 'vendor link requires staff, manager or admin' using errcode = '42501';
  end if;
  if p_property_id is null or p_vendor_id is null then
    raise exception 'property and vendor required' using errcode = '23514';
  end if;
  perform private.maintenance_gate();
  select * into prop from public.properties where id = p_property_id for update;
  if not found or not private.can_edit_property(p_property_id) then
    raise exception 'property edit denied' using errcode = '42501';
  end if;
  if p_expected_property_revision is null then
    raise exception 'expected property revision required' using errcode = '23514';
  end if;
  if prop.revision <> p_expected_property_revision then
    raise exception 'stale property context; reload current state' using errcode = '40001';
  end if;
  select * into company from public.vendors where id = p_vendor_id for update;
  if not found then raise exception 'vendor not found' using errcode = '23503'; end if;
  insert into public.property_vendors(property_id, vendor_id, created_by)
    values (p_property_id, p_vendor_id, me)
  on conflict (property_id, vendor_id) do nothing
    returning * into link;
  if link.vendor_id is null then
    -- Already linked: converge on the relationship that is recorded, whether it came from
    -- a concurrent submission or from an earlier confirmed link.
    select * into link from public.property_vendors
      where property_id = p_property_id and vendor_id = p_vendor_id;
  else
    created_here := true;
  end if;
  return jsonb_build_object(
    'property_id', link.property_id,
    'vendor_id', link.vendor_id,
    'display_name', company.display_name,
    'contact_name', company.contact_name,
    'phones', company.phones,
    'email', company.email,
    'revision', link.revision,
    'created_at', link.created_at,
    'created', created_here);
end;
$$;

-- Unlinking removes only the current relationship. The vendor identity and details, every
-- unrelated link and the earlier property history stay, and no hard delete is introduced.
create function private.unlink_property_vendor(
  p_property_id uuid,
  p_vendor_id uuid,
  p_expected_link_revision uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  prop public.properties;
  link public.property_vendors;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if private.employee_role() not in ('staff','manager','admin') then
    raise exception 'vendor link requires staff, manager or admin' using errcode = '42501';
  end if;
  if p_property_id is null or p_vendor_id is null then
    raise exception 'property and vendor required' using errcode = '23514';
  end if;
  perform private.maintenance_gate();
  select * into prop from public.properties where id = p_property_id for update;
  if not found or not private.can_edit_property(p_property_id) then
    raise exception 'property edit denied' using errcode = '42501';
  end if;
  perform 1 from public.vendors where id = p_vendor_id for update;
  select * into link from public.property_vendors
    where property_id = p_property_id and vendor_id = p_vendor_id for update;
  if not found then raise exception 'vendor link not found' using errcode = 'P0002'; end if;
  if p_expected_link_revision is null then
    raise exception 'expected link revision required' using errcode = '23514';
  end if;
  if link.revision <> p_expected_link_revision then
    raise exception 'stale link; reload current state' using errcode = '40001';
  end if;
  delete from public.property_vendors where property_id = p_property_id and vendor_id = p_vendor_id;
  return jsonb_build_object(
    'property_id', p_property_id,
    'vendor_id', p_vendor_id,
    'revision', link.revision,
    'removed', true);
end;
$$;

create function public.link_property_vendor(
  p_property_id uuid,
  p_vendor_id uuid,
  p_expected_property_revision uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.link_property_vendor(p_property_id, p_vendor_id, p_expected_property_revision);
$$;
create function public.unlink_property_vendor(
  p_property_id uuid,
  p_vendor_id uuid,
  p_expected_link_revision uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.unlink_property_vendor(p_property_id, p_vendor_id, p_expected_link_revision);
$$;
revoke all on function private.guard_property_vendor_write(),
  private.link_property_vendor(uuid,uuid,uuid), private.unlink_property_vendor(uuid,uuid,uuid),
  public.link_property_vendor(uuid,uuid,uuid), public.unlink_property_vendor(uuid,uuid,uuid)
  from public,anon,authenticated;
grant execute on function private.link_property_vendor(uuid,uuid,uuid),
  private.unlink_property_vendor(uuid,uuid,uuid),
  public.link_property_vendor(uuid,uuid,uuid), public.unlink_property_vendor(uuid,uuid,uuid)
  to authenticated;

-- A property's Vendor section: the recorded company block plus the link revision the
-- unlink operation checks. RLS decides every row, so a property the caller cannot read
-- returns nothing rather than a denial-shaped list.
create function public.list_property_vendors(p_property_id uuid)
returns table(
  vendor_id uuid,
  revision uuid,
  display_name text,
  contact_name text,
  phones text[],
  email text,
  created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select l.vendor_id, l.revision, v.display_name, v.contact_name, v.phones, v.email, l.created_at
  from public.property_vendors l
  join public.vendors v on v.id = l.vendor_id
  where l.property_id = p_property_id
  order by l.created_at desc, l.vendor_id desc;
$$;

-- One vendor's authorized linked-property projection. The join keeps the same property-read
-- and archived-property boundary, so a reviewer-only property is not disclosed here. The
-- wrapper returns one extra row as the follow-page probe; at most 50 are exposed.
create function public.list_vendor_properties(p_vendor_id uuid, p_limit integer default 51)
returns table(
  property_id uuid,
  property_code text,
  status text,
  listing_mode text,
  archived_at timestamptz,
  linked_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select p.id, p.property_code, p.status, p.listing_mode, p.archived_at, l.created_at
  from public.property_vendors l
  join public.properties p on p.id = l.property_id
  where l.vendor_id = p_vendor_id
  order by p.property_code, p.id
  limit least(greatest(coalesce(p_limit, 51), 1), 51);
$$;
revoke all on function public.list_property_vendors(uuid), public.list_vendor_properties(uuid,integer)
  from public,anon,authenticated;
grant execute on function public.list_property_vendors(uuid), public.list_vendor_properties(uuid,integer)
  to authenticated;

-- Business history: a link/unlink is a property change with actor, time and allowlisted
-- before/after values. `vendor_name` is a historical label snapshot for readability; the
-- company details themselves are never duplicated into the link row.
create or replace function private.business_values(p_target text, p_row jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then to_jsonb(value #>> '{}') else value end),'{}'::jsonb)
  from jsonb_each(coalesce(p_row,'{}')) where key=any(case p_target
    when 'property' then array['property_code','listing_mode','property_type','access_type','status','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes']
    when 'address' then array['mapping_evidence','format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','mapping_status','verification_method','verified_by','verified_at','source_url','effective_on','is_primary','supersedes_address_id']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'vendor_link' then array['vendor_id','vendor_name']
    when 'link' then array['contact_id','relation','is_primary'] else '{}'::text[] end);
$$;

create or replace function private.record_business_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); target text; before_v jsonb; after_v jsonb; fields text[]; props uuid[]; prop uuid; row_v jsonb; before_row jsonb; after_row jsonb;
begin
  if me is null then return coalesce(new,old); end if;
  target:=case tg_table_name when 'properties' then 'property' when 'property_addresses' then 'address' when 'contacts' then 'contact' when 'property_vendors' then 'vendor_link' else 'link' end;
  before_row:=case when tg_op<>'INSERT' then to_jsonb(old) end;
  after_row:=case when tg_op<>'DELETE' then to_jsonb(new) end;
  -- A vendor link snapshots the company name as its readable historical label; the vendor
  -- identity stays in the link row and target_id rather than being duplicated as a column.
  if target='vendor_link' then
    before_row:=before_row||jsonb_build_object('vendor_name',(select v.display_name from public.vendors v where v.id=(before_row->>'vendor_id')::uuid));
    after_row:=after_row||jsonb_build_object('vendor_name',(select v.display_name from public.vendors v where v.id=(after_row->>'vendor_id')::uuid));
  end if;
  before_v:=private.business_values(target,before_row);
  after_v:=private.business_values(target,after_row);
  select array_agg(key order by key) into fields from (select jsonb_object_keys(before_v||after_v) as key) k
    where before_v->key is distinct from after_v->key;
  if fields is null then return coalesce(new,old); end if;
  row_v:=coalesce(to_jsonb(new),to_jsonb(old));
  if target='contact' then select array_agg(property_id order by property_id) into props from public.property_contacts where contact_id=(row_v->>'id')::uuid;
  else props:=array[case when target='property' then (row_v->>'id')::uuid else (row_v->>'property_id')::uuid end]; end if;
  foreach prop in array coalesce(props,'{}'::uuid[]) loop
    insert into public.property_history(property_id,actor_id,actor_name,target,target_id,changed_fields,before_values,after_values)
    select prop,me,e.display_name,target,coalesce((row_v->>'id')::uuid,(row_v->>'contact_id')::uuid,(row_v->>'vendor_id')::uuid),fields,
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(before_v) where key=any(fields)),
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(after_v) where key=any(fields))
    from public.employees e where e.id=me;
    -- A vendor company relationship is not a property fact, so it does not reopen record
    -- review; the property, address and contact targets keep their existing behaviour.
    if target not in ('property','vendor_link') then update public.properties set record_review_status='pending' where id=prop; end if;
  end loop;
  return coalesce(new,old);
end;
$$;
revoke all on function private.business_values(text,jsonb), private.record_business_change() from public,anon,authenticated;

create trigger property_vendor_history after insert or delete on public.property_vendors
  for each row execute function private.record_business_change();

alter table public.property_history drop constraint property_history_target_check;
alter table public.property_history add constraint property_history_target_check
  check (target in ('property','address','contact','link','vendor_link'));
commit;
