-- Issue #236 (address plan T10): a legacy address records one candidate per ward it records.
--
-- A correction can change the ward a legacy address names, and the successor it writes is what the
-- next save reports. The one-shot rule was scoped to the whole supersedes chain, so a chain that had
-- already recorded its first ward's target refused the ward the row now names - the same rule the
-- read side used to answer "already recorded". Both sides now compare against the target the saved
-- ward's crosswalk row names, so they agree: a ward this chain has not recorded yet is recordable
-- once, and a ward it has is refused as before.
--
-- Only private.record_address_candidate changes; the public invoker wrapper, its grants, the
-- crosswalk derivation and every other refusal are exactly as 20261021142801 left them.
begin;

create or replace function private.record_address_candidate(p_property_id uuid,p_legacy_address_id uuid,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare legacy public.property_addresses; mapping public.admin_unit_crosswalks; target public.admin_unit_versions; rows integer; created uuid; created_revision uuid; current_property_revision uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_legacy_address_id is null or p_property_revision is null then raise exception 'legacy address and property revision required' using errcode='23514'; end if;
  if not private.can_edit_property(p_property_id) then raise exception 'property edit denied' using errcode='42501'; end if;
  -- The revision this action was offered with is checked before anything else about the record, so
  -- a stale context is its own refusal even once a candidate has been recorded from it.
  if not exists(select 1 from public.properties where id=p_property_id and revision=p_property_revision)
    then raise exception 'stale property context; reload current state' using errcode='PT409'; end if;
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
  -- Recording is one-shot per legacy ward: the current address this action writes is linked to the
  -- legacy row it came from, so a repeat for the ward that row records - or for the ward a successor
  -- a correction of it created records - is refused rather than leaving a second primary current
  -- address for the same target. A target this chain has not recorded is its own candidate, so a
  -- correction that changes the saved ward records that ward's target exactly once (issue #236). A
  -- second legacy address at another ward is its own chain and records its own candidate.
  if exists(
    with recursive family(id,parent_id) as (
      select a.id,a.supersedes_address_id from public.property_addresses a
        where a.id=p_legacy_address_id and a.property_id=p_property_id and a.format='legacy'
      union
      select a.id,a.supersedes_address_id from public.property_addresses a join family f on a.supersedes_address_id=f.id or a.id=f.parent_id
        where a.property_id=p_property_id and a.format='legacy'
    )
    select 1 from public.property_addresses c join family f on f.id=c.supersedes_address_id
      where c.property_id=p_property_id and c.format='current' and c.commune_unit_id=target.id
  ) then raise exception 'a current address is already recorded from this legacy address' using errcode='23505'; end if;
  -- The recorded source text is carried over unchanged: this row states the same property in the
  -- current geography, and no address text is rewritten or invented.
  created:=private.maintain_property(p_property_id,'address',null,p_property_revision,
    jsonb_build_object('format','current','address_text',legacy.address_text,'house_number',legacy.house_number,
      'street',legacy.street,'province_unit_id',target.parent_id,'commune_unit_id',target.id,'is_primary',true),
    p_property_revision);
  update public.property_addresses set supersedes_address_id=legacy.id where id=created;
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

commit;
