begin;

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
  if p_property_id is null or p_vendor_id is null then
    raise exception 'property and vendor required' using errcode = '23514';
  end if;
  perform private.maintenance_gate();
  select * into prop from public.properties where id = p_property_id for update;
  if not found or prop.archived_at is not null then
    raise exception 'property edit denied' using errcode = '42501';
  end if;
  if p_expected_property_revision is null then
    raise exception 'expected property revision required' using errcode = '23514';
  end if;
  if prop.revision <> p_expected_property_revision then
    raise exception 'stale property context; reload current state' using errcode = 'PT409';
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
  if p_property_id is null or p_vendor_id is null then
    raise exception 'property and vendor required' using errcode = '23514';
  end if;
  perform private.maintenance_gate();
  select * into prop from public.properties where id = p_property_id for update;
  if not found or prop.archived_at is not null then
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
    raise exception 'stale link; reload current state' using errcode = 'PT409';
  end if;
  delete from public.property_vendors where property_id = p_property_id and vendor_id = p_vendor_id;
  return jsonb_build_object(
    'property_id', p_property_id,
    'vendor_id', p_vendor_id,
    'revision', link.revision,
    'removed', true);
end;
$$;

revoke all on function private.link_property_vendor(uuid,uuid,uuid),
  private.unlink_property_vendor(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.link_property_vendor(uuid,uuid,uuid),
  private.unlink_property_vendor(uuid,uuid,uuid) to authenticated;

commit;
