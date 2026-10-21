-- Issue #234 (address plan T9): switch an existing property address between the legacy and the
-- current format as a deliberate, labelled action.
--
-- T4 keeps an address's format fixed on an ordinary save (`address format immutable` in
-- private.maintain_property), and that stays exactly as it is: this file adds the one explicit
-- action that writes a second row in the other format, never a free change of the format field.
--
-- What the action does, in both directions:
--   * it writes a new row in the target format and leaves the source row present and unmodified in
--     every field - its recorded source text, its three unit ids and, for a verified current row,
--     its verification provenance;
--   * the target units come from public.admin_unit_crosswalks, never from the caller: a legacy ward
--     converts through its single whole or rename row, and a current commune converts back only
--     when exactly one whole or rename row names that unit, so a merge of several old wards stays
--     ambiguous and writes nothing. A renamed province re-creates its communes in a later validity
--     window, so both directions are resolved by the unit's official code, never by the one
--     version row the crosswalk was seeded with;
--   * the new row is mapping_status='candidate' carrying the crosswalk's effective_on and
--     source_url. It is never 'verified': D5 keeps verification reviewer-only, and no promotion is
--     performed here;
--   * it refuses, with its own code, when the source row records no ward, when the crosswalk is
--     ambiguous, or when the target format already records that same territory.
-- Three codes are distinct rather than the usual 23514 so the surface can state which of those
-- three refused it: PT421 source units absent, PT422 ambiguous crosswalk, PT423 duplicate row.
begin;

create function private.convert_address_format(p_property_id uuid,p_address_id uuid,p_address_revision uuid,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare source public.property_addresses; prop public.properties; mapping public.admin_unit_crosswalks; ward public.admin_unit_versions;
  district public.admin_unit_versions; province public.admin_unit_versions; target_format text; source_code text; rows integer; created uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_address_id is null or p_address_revision is null or p_property_revision is null then raise exception 'address and revisions required' using errcode='23514'; end if;
  perform private.maintenance_gate();
  if not private.can_edit_property(p_property_id) then raise exception 'property edit denied' using errcode='42501'; end if;
  -- The parent property row is locked before the address row, the order every lock transition keeps.
  select * into prop from public.properties where id=p_property_id for update;
  if not found or prop.revision<>p_property_revision then raise exception 'stale property context; reload current state' using errcode='PT409'; end if;
  select * into source from public.property_addresses where id=p_address_id and property_id=p_property_id for update;
  if not found then raise exception 'address mismatch' using errcode='23514'; end if;
  if source.revision<>p_address_revision then raise exception 'stale address; reload current state' using errcode='PT409'; end if;
  if source.format not in ('legacy','current') then raise exception 'legacy or current address required' using errcode='23514'; end if;
  -- Nothing is inferred from address text: without the recorded ward there is nothing to convert.
  if source.commune_unit_id is null then raise exception 'recorded ward required for conversion' using errcode='PT421'; end if;
  target_format:=case source.format when 'legacy' then 'current' else 'legacy' end;
  if source.format='legacy' then
    -- One whole or rename row names the current ward. A partial transfer, or several rows, needs
    -- property-level evidence this action cannot produce, so it is reported rather than guessed.
    select count(*) into rows from public.admin_unit_crosswalks where from_unit_id=source.commune_unit_id;
    if rows<>1 then raise exception 'one whole crosswalk target required' using errcode='PT422'; end if;
    select * into mapping from public.admin_unit_crosswalks where from_unit_id=source.commune_unit_id;
    if mapping.relation not in ('whole','rename') then raise exception 'one whole crosswalk target required' using errcode='PT422'; end if;
    select * into ward from public.admin_unit_versions where id=mapping.to_unit_id;
    if not found or ward.unit_level<>'commune' or ward.parent_id is null then raise exception 'current ward required' using errcode='PT422'; end if;
    select * into province from public.admin_unit_versions where id=ward.parent_id and unit_level='province';
    if not found then raise exception 'current ward required' using errcode='PT422'; end if;
  else
    -- The reverse direction is only unambiguous when this current commune came from exactly one old
    -- ward in full; a commune formed from several old wards names no single legacy ward. A renamed
    -- unit carries its official code into the later window, so the crosswalk is matched by that
    -- code rather than by the version row the address happens to record.
    select c.official_code into source_code from public.admin_unit_versions c where c.id=source.commune_unit_id;
    select count(*) into rows from public.admin_unit_crosswalks x
      join public.admin_unit_versions c on c.id=x.to_unit_id and c.unit_level='commune' and c.valid_from>=date '2025-07-01'
      where c.official_code=source_code;
    if rows<>1 then raise exception 'one whole crosswalk source required' using errcode='PT422'; end if;
    select x.* into mapping from public.admin_unit_crosswalks x
      join public.admin_unit_versions c on c.id=x.to_unit_id and c.unit_level='commune' and c.valid_from>=date '2025-07-01'
      where c.official_code=source_code;
    if mapping.relation not in ('whole','rename') then raise exception 'one whole crosswalk source required' using errcode='PT422'; end if;
    select * into ward from public.admin_unit_versions where id=mapping.from_unit_id;
    if not found or ward.unit_level<>'commune' or ward.parent_id is null then raise exception 'legacy ward required' using errcode='PT422'; end if;
    select * into district from public.admin_unit_versions where id=ward.parent_id and unit_level='district';
    if not found or district.parent_id is null then raise exception 'legacy district required' using errcode='PT422'; end if;
    select * into province from public.admin_unit_versions where id=district.parent_id and unit_level='province';
    if not found then raise exception 'legacy province required' using errcode='PT422'; end if;
  end if;
  -- The row this action would write must not repeat territory the property already records in the
  -- target format, so following the action twice writes nothing the second time. The territory is
  -- the unit's official code in that generation, because a renamed unit has one row per window.
  if exists(select 1 from public.property_addresses a
      join public.admin_unit_versions recorded on recorded.id=a.commune_unit_id
      where a.property_id=p_property_id and a.format=target_format
        and recorded.unit_level='commune' and recorded.official_code=ward.official_code
        and (recorded.valid_from>=date '2025-07-01')=(ward.valid_from>=date '2025-07-01'))
    then raise exception 'address already recorded in the target format' using errcode='PT423'; end if;
  -- The recorded source text is carried over unchanged: the new row states the same property in the
  -- other geography, and no address text is rewritten or invented. It is inserted with its final
  -- values rather than inserted and edited, because a legacy row's own field set is immutable after
  -- insert (private.maintenance_revision). One primary per format still holds, and it is the target
  -- format's own existing primary that keeps it: a conversion records evidence beside what the
  -- property already said, so it never takes that flag from the row it did not convert. The insert
  -- also flags the record for review, exactly like any other address edit.
  insert into public.property_addresses(property_id,format,address_text,house_number,street,province_unit_id,
      district_unit_id,commune_unit_id,mapping_status,effective_on,source_url,is_primary,supersedes_address_id)
    values(p_property_id,target_format,source.address_text,source.house_number,source.street,province.id,
      district.id,ward.id,'candidate',mapping.effective_on,mapping.source_url,
      not exists(select 1 from public.property_addresses a
        where a.property_id=p_property_id and a.format=target_format and a.is_primary),
      source.id)
    returning id into created;
  return created;
end;
$$;

create function public.convert_address_format(p_property_id uuid,p_address_id uuid,p_address_revision uuid,p_property_revision uuid)
returns uuid language sql security invoker set search_path='' as $$
  select private.convert_address_format(p_property_id,p_address_id,p_address_revision,p_property_revision);
$$;

revoke all on function private.convert_address_format(uuid,uuid,uuid,uuid),public.convert_address_format(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.convert_address_format(uuid,uuid,uuid,uuid),public.convert_address_format(uuid,uuid,uuid,uuid) to authenticated;

commit;
