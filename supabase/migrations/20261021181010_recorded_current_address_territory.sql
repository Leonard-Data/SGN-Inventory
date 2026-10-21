-- Issue #226's recording guard now refuses by territory rather than by the supersedes chain.
--
-- The chain rule recognised only a current address that supersedes a member of the legacy row's
-- own chain. The format conversion (issue #234) is the first write that links a legacy row to a
-- current one, and an ordinary correction of that legacy row inserts a successor and moves the
-- chain on while the current row it came from supersedes nothing, so the walk no longer reaches it:
-- the guard passed and a second current address for the same commune was written, demoting the
-- first. The invariant both actions hold is one current address per commune, so the guard compares
-- the unit's official code inside the current generation - the same territory comparison the
-- conversion's duplicate refusal makes - whichever way the recorded current row arrived.
--
-- Only this guard changes: the target derivation, the refusals, the recorded row, the mapping
-- candidate and the grants are as they were, and a replaced function keeps its privileges.
--
-- Idempotent: re-applying replaces the same body and writes nothing else.
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
  -- One current address per commune: a property that already records this ward's current commune
  -- has recorded it, whether that row supersedes this legacy row, a successor of it, or arrived by
  -- the deliberate format conversion.
  if exists(select 1 from public.property_addresses c
      join public.admin_unit_versions recorded on recorded.id=c.commune_unit_id
      where c.property_id=p_property_id and c.format='current'
        and recorded.unit_level='commune' and recorded.official_code=target.official_code
        and (recorded.valid_from>=date '2025-07-01')=(target.valid_from>=date '2025-07-01'))
    then raise exception 'a current address is already recorded from this legacy address' using errcode='23505'; end if;
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
