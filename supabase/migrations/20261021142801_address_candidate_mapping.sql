-- Issue #226 (address plan T5): report the crosswalk outcome of a saved legacy ward and let the
-- person record the mapped current address as a candidate.
--
-- D2: a crosswalk row is evidence that a ward changed, never that this property is inside the
-- surviving part, so nothing is written automatically - the caller confirms one address.
-- D5: any property editor may record a crosswalk-derived candidate; verification stays
-- reviewer-only with its property-level evidence and its verified_by/verified_at stamp.
--
-- Two changes, both here because they are one contract:
--   1. private.maintain_property's `mapping` branch: the reviewer gate now covers every state
--      except `candidate`, and a candidate keeps the effective date and source URL it was
--      recorded with (the previous body nulled both for anything but `verified`, which is why the
--      18,510 imported candidates have no date). verified_by, verified_at, verification_method
--      and mapping_evidence stay null on a candidate, and `verified` still demands all of them.
--   2. public.record_address_candidate: the one action that writes the second address. It derives
--      the target province, commune, effective date and source URL from the official crosswalk
--      itself, so the browser cannot name a mapping; a ward with anything other than exactly one
--      whole or rename row writes nothing.
begin;

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
    if not exists(select 1 from public.property_contacts where property_id=p_property_id and contact_id=p_target_id)
      and private.employee_role() not in ('staff','manager','admin') then raise exception 'contact is not linked to opened property' using errcode='23514'; end if;
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
      if addr.format<>'current' then raise exception 'current mapping required' using errcode='23514'; end if;
      addr:=jsonb_populate_record(addr,p_changes);
      if addr.mapping_status not in ('verified','candidate','unresolved') or addr.mapping_status is null then raise exception 'invalid mapping' using errcode='23514'; end if;
      -- Recording a candidate from the official crosswalk is an ordinary property edit (D5).
      -- Verification, and any other mapping state, still needs a reviewer.
      if addr.mapping_status<>'candidate' and not private.is_reviewer() then raise exception 'reviewer required for mapping' using errcode='42501'; end if;
      if addr.mapping_status='candidate' then
        -- A candidate is evidence from a source, so it must state when that source took effect and
        -- where it came from; it never carries a verification stamp or property-level evidence.
        if addr.effective_on is null or coalesce(addr.source_url,'') !~ '^https?://[^[:space:]]+$' then raise exception 'candidate mapping requires an effective date and a source url' using errcode='23514'; end if;
        addr.verified_by:=null; addr.verified_at:=null; addr.verification_method:=null; addr.mapping_evidence:=null;
      elsif addr.mapping_status<>'verified' then
        addr.verified_by:=null; addr.verified_at:=null; addr.verification_method:=null; addr.source_url:=null; addr.effective_on:=null; addr.mapping_evidence:=null;
      end if;
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

-- The one action behind a legacy save: record the current address the official crosswalk names,
-- as a candidate. It composes the two already-authorized maintenance operations in one transaction
-- so a refusal leaves neither half behind, and it reads the mapping from public.admin_unit_crosswalks
-- rather than from the request: the caller names the legacy address, never the target.
create function private.record_address_candidate(p_property_id uuid,p_legacy_address_id uuid,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare legacy public.property_addresses; mapping public.admin_unit_crosswalks; target public.admin_unit_versions; rows integer; created uuid; created_revision uuid; current_property_revision uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_legacy_address_id is null or p_property_revision is null then raise exception 'legacy address and property revision required' using errcode='23514'; end if;
  if not private.can_edit_property(p_property_id) then raise exception 'property edit denied' using errcode='42501'; end if;
  select * into legacy from public.property_addresses where id=p_legacy_address_id and property_id=p_property_id;
  if not found or legacy.format<>'legacy' then raise exception 'legacy address required' using errcode='23514'; end if;
  if legacy.commune_unit_id is null then raise exception 'legacy ward required' using errcode='23514'; end if;
  -- Only a single whole or rename transfer names the current ward. A partial transition, or more
  -- than one row, needs property-level verification and is refused here rather than guessed.
  select count(*) into rows from public.admin_unit_crosswalks where from_unit_id=legacy.commune_unit_id;
  if rows<>1 then raise exception 'one whole crosswalk target required' using errcode='23514'; end if;
  select * into mapping from public.admin_unit_crosswalks where from_unit_id=legacy.commune_unit_id;
  if mapping.relation not in ('whole','rename') then raise exception 'one whole crosswalk target required' using errcode='23514'; end if;
  select * into target from public.admin_unit_versions where id=mapping.to_unit_id;
  if not found or target.unit_level<>'commune' then raise exception 'current ward required' using errcode='23514'; end if;
  -- The recorded source text is carried over unchanged: this row states the same property in the
  -- current geography, and no address text is rewritten or invented.
  created:=private.maintain_property(p_property_id,'address',null,p_property_revision,
    jsonb_build_object('format','current','address_text',legacy.address_text,'house_number',legacy.house_number,
      'street',legacy.street,'province_unit_id',target.parent_id,'commune_unit_id',target.id,'is_primary',true),
    p_property_revision);
  select revision into created_revision from public.property_addresses where id=created;
  -- The address insert flags the record for review, which advances the property revision, so the
  -- second operation is checked against the revision this transaction now holds.
  select revision into current_property_revision from public.properties where id=p_property_id;
  perform private.maintain_property(p_property_id,'mapping',created,created_revision,
    jsonb_build_object('mapping_status','candidate','province_unit_id',target.parent_id,'commune_unit_id',target.id,
      'effective_on',mapping.effective_on,'source_url',mapping.source_url),
    current_property_revision);
  return created;
end;
$$;

create function public.record_address_candidate(p_property_id uuid,p_legacy_address_id uuid,p_property_revision uuid)
returns uuid language sql security invoker set search_path='' as $$
  select private.record_address_candidate(p_property_id,p_legacy_address_id,p_property_revision);
$$;

revoke all on function private.record_address_candidate(uuid,uuid,uuid),public.record_address_candidate(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.record_address_candidate(uuid,uuid,uuid),public.record_address_candidate(uuid,uuid,uuid) to authenticated;

commit;
