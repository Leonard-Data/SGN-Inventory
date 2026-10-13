-- Forward-apply issue #70 guard fixes for environments that already ran the
-- original shared-contact migration before these checks were added.
begin;

create or replace function private.contact_impact(p_contact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if not exists(select 1 from public.property_contacts where contact_id=p_contact_id)
    and private.employee_role() not in ('staff','manager','admin') then raise exception 'linked contact required' using errcode='42501'; end if;
  if exists(select 1 from public.property_contacts pc join public.properties p on p.id=pc.property_id where pc.contact_id=p_contact_id and p.archived_at is not null and not private.is_reviewer()) then raise exception 'affected property read denied' using errcode='PT403'; end if;
  select jsonb_build_object('revision',c.revision,'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'property_code',p.property_code) order by p.id) from public.property_contacts pc join public.properties p on p.id=pc.property_id where pc.contact_id=c.id),'[]')) into result from public.contacts c where c.id=p_contact_id;
  if result is null then raise exception 'contact not found' using errcode='23514'; end if;
  return result;
end;
$$;

create or replace function private.maintain_contact(p_contact_id uuid,p_expected_revision uuid,p_changes jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare person public.contacts;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  perform private.validate_maintenance('contact',p_changes);
  perform private.maintenance_gate();
  if not exists(select 1 from public.property_contacts where contact_id=p_contact_id)
    and private.employee_role() not in ('staff','manager','admin') then raise exception 'linked contact required' using errcode='42501'; end if;
  perform private.contact_impact(p_contact_id);
  perform 1 from public.properties where id in (select property_id from public.property_contacts where contact_id=p_contact_id) order by id for update;
  select * into person from public.contacts where id=p_contact_id for update;
  if not found then raise exception 'contact not found' using errcode='23514'; end if;
  if p_expected_revision is null then raise exception 'entity revision required' using errcode='23514'; end if;
  if person.revision<>p_expected_revision then raise exception 'stale contact or affected set; reload current state' using errcode='PT409'; end if;
  person:=jsonb_populate_record(person,p_changes);
  if length(btrim(coalesce(person.display_name,''))) not between 1 and 200 then raise exception 'contact name required' using errcode='23514'; end if;
  update public.contacts set display_name=person.display_name,phones=person.phones,raw_phone_text=person.raw_phone_text,contact_type=person.contact_type,notes=person.notes where id=p_contact_id;
  return p_contact_id;
end;
$$;
revoke all on function private.maintain_contact(uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function private.maintain_property(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare prop public.properties; addr public.property_addresses; person public.contacts; link public.property_contacts; cols text; result uuid; next_contact uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_target='contact' then
    perform private.validate_maintenance(p_target,p_changes);
    perform private.maintenance_gate();
    select * into prop from public.properties where id=p_property_id for update;
    if not found or (prop.archived_at is not null and not private.is_reviewer()) then raise exception 'property edit denied' using errcode='42501'; end if;
    if p_expected_revision is null or p_property_revision is null then raise exception 'entity and property revisions required' using errcode='23514'; end if;
    if prop.revision<>p_property_revision then raise exception 'stale property context; reload current state' using errcode='PT409'; end if;
    if not exists(select 1 from public.property_contacts where property_id=p_property_id and contact_id=p_target_id) then raise exception 'contact is not linked to opened property' using errcode='23514'; end if;
    return private.maintain_contact(p_target_id,p_expected_revision,p_changes);
  end if;
  perform private.validate_maintenance(p_target,p_changes);
  perform private.maintenance_gate();
  select * into prop from public.properties where id=p_property_id for update;
  if not found or not private.can_edit_property(p_property_id) then raise exception 'property edit denied' using errcode='42501'; end if;
  if p_expected_revision is null or p_property_revision is null then raise exception 'entity and property revisions required' using errcode='23514'; end if;
  if prop.revision<>p_property_revision then raise exception 'stale property context; reload current state' using errcode='PT409'; end if;
  if p_target='property' then
    if p_target_id is distinct from p_property_id then raise exception 'target mismatch' using errcode='23514'; end if;
    if prop.revision<>p_expected_revision then raise exception 'stale edit; reload current state' using errcode='PT409'; end if;
    if p_changes ? 'status' and prop.status is distinct from p_changes->>'status' and (prop.status='sold' or p_changes->>'status'='sold') then
      if not private.is_reviewer() then raise exception 'reviewer required for final status' using errcode='42501'; end if;
      raise exception 'sold/rented transitions arrive with the independent sale transition (issue #32); ordinary maintenance does not confirm or reverse sales' using errcode='23514';
    end if;
    select string_agg(format('%I',key),',') into cols from jsonb_object_keys(p_changes) key;
    if cols is not null then
      execute format('update public.properties set (%s)=(select %s from jsonb_populate_record(null::public.properties,$1)) where id=$2',cols,cols) using to_jsonb(prop)||p_changes,p_property_id;
    end if;
    return p_property_id;
  elsif p_target in ('address','mapping') then
    if p_target_id is null then
      if p_target<>'address' or prop.revision<>p_expected_revision then raise exception 'stale edit; reload current state' using errcode='PT409'; end if;
      addr.property_id:=p_property_id; addr.is_primary:=true; addr.mapping_status:='unresolved'; addr.created_at:=now();
    else
      select * into addr from public.property_addresses where id=p_target_id and property_id=p_property_id for update;
      if not found then raise exception 'address mismatch' using errcode='23514'; end if;
      if addr.revision<>p_expected_revision then raise exception 'stale address; reload current state' using errcode='PT409'; end if;
    end if;
    if p_target='mapping' then
      if not private.is_reviewer() then raise exception 'reviewer required' using errcode='42501'; end if;
      if addr.format<>'current' then raise exception 'current mapping required' using errcode='23514'; end if;
      addr:=jsonb_populate_record(addr,p_changes);
      if addr.mapping_status not in ('verified','candidate','unresolved') or addr.mapping_status is null then raise exception 'invalid mapping' using errcode='23514'; end if;
      if addr.mapping_status<>'verified' then addr.verified_by:=null; addr.verified_at:=null; addr.verification_method:=null; addr.source_url:=null; addr.effective_on:=null; addr.mapping_evidence:=null; end if;
      update public.property_addresses set province_unit_id=addr.province_unit_id,commune_unit_id=addr.commune_unit_id,
        mapping_status=addr.mapping_status,verification_method=addr.verification_method,source_url=addr.source_url,
        effective_on=addr.effective_on,mapping_evidence=addr.mapping_evidence,verified_by=addr.verified_by,verified_at=addr.verified_at where id=p_target_id;
      return p_target_id;
    end if;
    addr:=jsonb_populate_record(addr,p_changes);
    if addr.format is null or addr.format not in ('legacy','current','alternate') or (p_target_id is null and addr.format='alternate') or addr.address_text is null then raise exception 'known address required' using errcode='23514'; end if;
    if p_target_id is not null and addr.format<>(select format from public.property_addresses where id=p_target_id) then raise exception 'address format immutable' using errcode='23514'; end if;
    if p_target_id is not null and p_changes-array['is_primary']='{}'::jsonb then
      if addr.is_primary then update public.property_addresses set is_primary=false where property_id=p_property_id and format=addr.format and is_primary and id<>p_target_id; end if;
      update public.property_addresses set is_primary=addr.is_primary where id=p_target_id and is_primary is distinct from addr.is_primary;
      return p_target_id;
    end if;
    if p_target_id is not null and addr.format='current' then
      update public.property_addresses set mapping_status='unresolved',verified_by=null,verified_at=null,verification_method=null,source_url=null,effective_on=null,mapping_evidence=null where id=p_target_id;
    end if;
    if addr.is_primary then update public.property_addresses set is_primary=false where property_id=p_property_id and format=addr.format and is_primary; end if;
    addr.id:=gen_random_uuid(); addr.supersedes_address_id:=p_target_id; addr.revision:=gen_random_uuid(); addr.created_at:=now();
    addr.mapping_status:='unresolved'; addr.verification_method:=null; addr.verified_by:=null; addr.verified_at:=null; addr.source_url:=null; addr.effective_on:=null; addr.mapping_evidence:=null;
    insert into public.property_addresses select (addr).*;
    return addr.id;
  elsif p_target='link' then
    if private.employee_role() not in ('staff','manager','admin') then raise exception 'contact staff required' using errcode='42501'; end if;
    if p_target_id is null then
      if prop.revision<>p_expected_revision then raise exception 'stale property; reload current state' using errcode='PT409'; end if;
      link.property_id:=p_property_id; link.relation:='unknown'; link.is_primary:=false;
    else
      select * into link from public.property_contacts where property_id=p_property_id and contact_id=p_target_id for update;
      if not found then raise exception 'link not found' using errcode='23514'; end if;
      if link.revision<>p_expected_revision then raise exception 'stale link; reload current state' using errcode='PT409'; end if;
    end if;
    if p_changes->>'remove'='true' then
      if p_target_id is null or p_changes-'remove'<>'{}'::jsonb then raise exception 'unlink target required' using errcode='23514'; end if;
      perform 1 from public.contacts where id=p_target_id for update;
      delete from public.property_contacts where property_id=p_property_id and contact_id=p_target_id;
      return p_target_id;
    end if;
    if p_changes ? 'remove' then raise exception 'invalid link change' using errcode='23514'; end if;
    link:=jsonb_populate_record(link,p_changes); next_contact:=link.contact_id;
    perform 1 from public.contacts where id in (p_target_id,next_contact) order by id for update;
    if next_contact is null or not exists(select 1 from public.contacts where id=next_contact) then raise exception 'contact not found' using errcode='23514'; end if;
    if link.is_primary then update public.property_contacts set is_primary=false where property_id=p_property_id and is_primary; end if;
    if p_target_id is null then
      insert into public.property_contacts(property_id,contact_id,relation,is_primary) values(p_property_id,next_contact,link.relation,link.is_primary);
    else
      update public.property_contacts set contact_id=next_contact,relation=link.relation,is_primary=link.is_primary where property_id=p_property_id and contact_id=p_target_id;
    end if;
    return next_contact;
  else raise exception 'unsupported target' using errcode='23514'; end if;
end;
$$;

commit;
