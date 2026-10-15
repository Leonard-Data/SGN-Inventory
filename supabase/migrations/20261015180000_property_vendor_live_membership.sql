-- Ticket #74 forward guard: an operation that waits on the maintenance gate must re-read and
-- lock its acting employee before changing a property, link or vendor row. A session that was
-- active when it started but was deactivated while waiting is refused with 42501.
begin;

-- The asking-price-only migration runs after the original link migration, so restore the
-- vendor-link history projection while retaining its narrower property-history rule.
create or replace function private.business_values(p_target text, p_row jsonb) returns jsonb
language sql immutable security invoker set search_path = '' as $$
  select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then to_jsonb(value #>> '{}') else value end),'{}'::jsonb)
  from jsonb_each(coalesce(p_row,'{}'::jsonb)) where key=any(case p_target
    when 'property' then array['property_code','listing_mode','property_type','access_type','status','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes']
    when 'address' then array['mapping_evidence','format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','mapping_status','verification_method','verified_by','verified_at','source_url','effective_on','is_primary','supersedes_address_id']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'vendor_link' then array['vendor_id','vendor_name']
    when 'link' then array['contact_id','relation','is_primary'] else '{}'::text[] end);
$$;

create or replace function private.record_business_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  me uuid:=private.employee_id();
  target text;
  before_v jsonb;
  after_v jsonb;
  fields text[];
  props uuid[];
  prop uuid;
  row_v jsonb;
  before_row jsonb;
  after_row jsonb;
begin
  if me is null then return coalesce(new,old); end if;
  target:=case tg_table_name when 'properties' then 'property' when 'property_addresses' then 'address' when 'contacts' then 'contact' when 'property_vendors' then 'vendor_link' else 'link' end;
  before_row:=case when tg_op<>'INSERT' then to_jsonb(old) end;
  after_row:=case when tg_op<>'DELETE' then to_jsonb(new) end;
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
  if target='contact' then
    select array_agg(property_id order by property_id) into props from public.property_contacts where contact_id=(row_v->>'id')::uuid;
  else
    props:=array[case when target='property' then (row_v->>'id')::uuid else (row_v->>'property_id')::uuid end];
  end if;
  if target not in ('property','vendor_link') then
    update public.properties set record_review_status='pending' where id=any(coalesce(props,'{}'::uuid[]));
    return coalesce(new,old);
  end if;
  if target='property' then
    select array_agg(key order by key) into fields from unnest(fields) key
      where key=any(array['sale_price_vnd','monthly_rent_vnd'])
        and coalesce(before_v->key,'null'::jsonb) is distinct from coalesce(after_v->key,'null'::jsonb);
    if fields is null then return coalesce(new,old); end if;
  end if;
  foreach prop in array coalesce(props,'{}'::uuid[]) loop
    insert into public.property_history(property_id,actor_id,actor_name,target,target_id,changed_fields,before_values,after_values)
    select prop,me,e.display_name,target,coalesce((row_v->>'id')::uuid,(row_v->>'contact_id')::uuid,(row_v->>'vendor_id')::uuid),fields,
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(before_v) where key=any(fields)),
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(after_v) where key=any(fields))
    from public.employees e where e.id=me;
  end loop;
  return coalesce(new,old);
end;
$$;

create or replace function private.require_live_vendor_actor(p_employee_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  actor public.employees;
begin
  select * into actor from public.employees where id = p_employee_id for update;
  if not found
    or not actor.is_active
    or actor.auth_user_id is distinct from auth.uid()
    or actor.role not in ('staff','manager','admin') then
    raise exception 'active staff, manager or admin required' using errcode = '42501';
  end if;
  return actor.id;
end;
$$;

create or replace function private.link_property_vendor(
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
  me := private.require_live_vendor_actor(me);
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

create or replace function private.unlink_property_vendor(
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
  me := private.require_live_vendor_actor(me);
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

create or replace function private.create_vendor(
  p_key uuid,
  p_display_name text,
  p_contact_name text default null,
  p_phones text[] default null,
  p_email text default null,
  p_source_address text default null,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  company text := private.trim_unicode(p_display_name);
  contact text := nullif(private.trim_unicode(p_contact_name), '');
  mail text := nullif(private.trim_unicode(p_email), '');
  address text := nullif(private.trim_unicode(p_source_address), '');
  note text := nullif(private.trim_unicode(p_notes), '');
  phone_list text[];
  existing public.vendors;
  created public.vendors;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if private.employee_role() not in ('staff','manager','admin') then
    raise exception 'vendor creation requires staff, manager or admin' using errcode = '42501';
  end if;
  if p_key is null then raise exception 'submission key required' using errcode = '23514'; end if;
  if company is null or length(company) not between 1 and 200 then
    raise exception 'vendor company name must be 1 to 200 characters' using errcode = '23514';
  end if;
  if contact is not null and length(contact) > 200 then
    raise exception 'vendor contact name is too long' using errcode = '23514';
  end if;
  if p_phones is not null then
    select array_agg(private.trim_unicode(phone) order by ordinality) into phone_list
      from unnest(p_phones) with ordinality as entry(phone, ordinality);
    if phone_list is null or array_length(phone_list, 1) not between 1 and 5
      or array_position(phone_list, null) is not null
      or exists (
        select 1 from unnest(phone_list) as phone
        where phone = '' or length(phone) > 40
      ) then
      raise exception 'vendor phone strings must be 1 to 40 characters' using errcode = '23514';
    end if;
  end if;
  if mail is not null and (length(mail) > 254
    or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'vendor email is not valid' using errcode = '23514';
  end if;
  if address is not null and length(address) > 500 then
    raise exception 'vendor source address is too long' using errcode = '23514';
  end if;
  if note is not null and length(note) > 2000 then
    raise exception 'vendor notes are too long' using errcode = '23514';
  end if;
  perform private.maintenance_gate();
  me := private.require_live_vendor_actor(me);
  insert into public.vendors(
    display_name, contact_name, phones, email, source_address, notes, created_by, submission_key
  ) values (
    company, contact, phone_list, mail, address, note, me, p_key
  ) on conflict (created_by, submission_key) do nothing
    returning * into created;
  if created.id is null then
    select * into existing from public.vendors
      where created_by = me and submission_key = p_key;
    if existing.id is null
      or existing.display_name is distinct from company
      or existing.contact_name is distinct from contact
      or existing.phones is distinct from phone_list
      or existing.email is distinct from mail
      or existing.source_address is distinct from address
      or existing.notes is distinct from note then
      raise exception 'submission key reused with different vendor details' using errcode = '23505';
    end if;
    created := existing;
  end if;
  return jsonb_build_object(
    'id', created.id,
    'display_name', created.display_name,
    'contact_name', created.contact_name,
    'phones', created.phones,
    'email', created.email,
    'source_address', created.source_address,
    'notes', created.notes,
    'created_at', created.created_at);
end;
$$;

revoke all on function private.require_live_vendor_actor(uuid) from public, anon, authenticated, service_role;
commit;
