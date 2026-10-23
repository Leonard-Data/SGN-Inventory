-- Issue #277 follow-up: the composition rule reaches every writer of an address text.
--
-- The composition added in 20261023042826 refused a stated text in public.maintain_property, but
-- private.validate_maintenance still listed `address_text` among the fields an `address` change may
-- state. That left the correction RPCs open: submit_correction, amend_correction and an application
-- carrying its own changes all validate through that shared function and then hand the proposal to
-- private.maintain_property, so a proposal could store a text beside parts that disagree with it.
--
-- The field is now refused at that one boundary ('invalid field', 23514), which every writer of an
-- address change already passes through: the app, a direct maintain_property or create_property
-- call, a correction submission, an amendment and a decision. public.maintain_property keeps its own
-- refusal of the same rule, so the boundary states it in the place a client calls.
--
-- Two internal writers built their address change from the source row's own text, and are updated
-- with the rule rather than exempted from it:
--   * private.record_address_candidate no longer states a text; the current row it records composes
--     house number, street and the crosswalk's current commune and province, like every other write.
--   * private.convert_address_format inserts its target row with the composition of the source
--     parts and the target units instead of copying the source text across formats.
-- Both still record the same `candidate` mapping with the crosswalk's own evidence, and every
-- refusal, derivation and guard of those two actions is unchanged. The legacy row each one starts
-- from stays present, unmodified and still holding the wording its source recorded, which is where
-- that evidence lives; the row written beside it now reads as the composition of its own parts.
--
-- Existing rows are untouched: nothing is rewritten or backfilled. A replaced function keeps its
-- privileges, and the grants are unchanged.
begin;

create or replace function private.validate_maintenance(p_target text,p_changes jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare k text; v jsonb; allowed text[];
begin
  allowed:=case p_target
    when 'property' then array['listing_mode','property_type','access_type','status','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes','latitude','longitude','legal_status','record_review_status','archived_at']
    when 'address' then array['format','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','is_primary']
    when 'mapping' then array['mapping_status','verification_method','source_url','effective_on','province_unit_id','commune_unit_id','mapping_evidence']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary','remove'] else null end;
  if allowed is null or jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>262144 then raise exception 'invalid changes' using errcode='23514'; end if;
  if p_target='property' and (p_changes ? 'latitude') <> (p_changes ? 'longitude') then raise exception 'coordinates must change together' using errcode='23514'; end if;
  for k,v in select key,value from jsonb_each(p_changes) loop
    if not k=any(allowed) then raise exception 'invalid field' using errcode='23514'; end if;
    if v='null'::jsonb then continue; end if;
    if k in ('sale_price_vnd','monthly_rent_vnd') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'whole VND string required' using errcode='23514'; end if;
    elsif k in ('land_area_m2','floor_area_m2','frontage_m','depth_m') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
        or (k in ('frontage_m','depth_m') and (v#>>'{}')::numeric>=1000000) then raise exception 'exact decimal string required' using errcode='23514'; end if;
    elsif k in ('floors','bedrooms','bathrooms') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,4})$' then raise exception 'integer string required' using errcode='23514'; end if;
    elsif k in ('is_primary','remove') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'boolean required' using errcode='23514'; end if;
    elsif k='phones' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then raise exception 'phone strings required' using errcode='23514'; end if;
      if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100) then raise exception 'phone strings required' using errcode='23514'; end if;
    elsif k in ('latitude','longitude') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^-?[0-9]{1,3}(\.[0-9]{1,7})?$' then raise exception 'coordinate string required' using errcode='23514'; end if;
    elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'bounded text required' using errcode='23514'; end if;
  end loop;
end;
$$;

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
  -- The current row states the same property in the current geography: it carries the source parts
  -- and the target units, and the server composes its text from them. The legacy row keeps the
  -- wording its own source recorded.
  created:=private.maintain_property(p_property_id,'address',null,p_property_revision,
    jsonb_build_object('format','current','house_number',legacy.house_number,
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

create or replace function private.convert_address_format(p_property_id uuid,p_address_id uuid,p_address_revision uuid,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare source public.property_addresses; prop public.properties; mapping public.admin_unit_crosswalks; ward public.admin_unit_versions;
  district public.admin_unit_versions; province public.admin_unit_versions; target_format text; source_code text; rows integer; created uuid; composed text;
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
  -- A corrected address is history: its successor states the text and units the property moved to,
  -- so converting the row it replaced would record what the property was corrected away from. Only
  -- a successor of the same format replaces: the other format's row leaves this one in place.
  if exists(select 1 from public.property_addresses s
      where s.property_id=p_property_id and s.supersedes_address_id=source.id and s.format=source.format)
    then raise exception 'superseded address; convert the current row' using errcode='PT425'; end if;
  -- Nothing is inferred from address text: without the recorded ward there is nothing to convert.
  if source.commune_unit_id is null then raise exception 'recorded ward required for conversion' using errcode='PT421'; end if;
  target_format:=case source.format when 'legacy' then 'current' else 'legacy' end;
  if source.format='legacy' then
    -- One whole or rename row names the current ward. A partial transfer, or several rows, needs
    -- property-level evidence this action cannot produce, so it is reported rather than guessed.
    select count(*) into rows from public.admin_unit_crosswalks where from_unit_id=source.commune_unit_id;
    if rows=0 then raise exception 'no crosswalk row for the recorded unit' using errcode='PT424'; end if;
    if rows<>1 then raise exception 'one whole crosswalk target required' using errcode='PT422'; end if;
    select * into mapping from public.admin_unit_crosswalks where from_unit_id=source.commune_unit_id;
    if mapping.relation not in ('whole','rename') then raise exception 'one whole crosswalk target required' using errcode='PT422'; end if;
    select * into ward from public.admin_unit_versions where id=mapping.to_unit_id;
    if not found or ward.parent_id is null then raise exception 'current ward required' using errcode='PT422'; end if;
    if ward.unit_level<>'commune' then raise exception 'crosswalk unit at another administrative level' using errcode='PT426'; end if;
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
    if rows=0 then raise exception 'no crosswalk row for the recorded unit' using errcode='PT424'; end if;
    if rows<>1 then raise exception 'one whole crosswalk source required' using errcode='PT422'; end if;
    select x.* into mapping from public.admin_unit_crosswalks x
      join public.admin_unit_versions c on c.id=x.to_unit_id and c.unit_level='commune' and c.valid_from>=date '2025-07-01'
      where c.official_code=source_code;
    if mapping.relation not in ('whole','rename') then raise exception 'one whole crosswalk source required' using errcode='PT422'; end if;
    select * into ward from public.admin_unit_versions where id=mapping.from_unit_id;
    if not found or ward.parent_id is null then raise exception 'legacy ward required' using errcode='PT422'; end if;
    if ward.unit_level<>'commune' then raise exception 'crosswalk unit at another administrative level' using errcode='PT426'; end if;
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
  -- The target row states the same property in the other geography: the source parts with the
  -- target units, from which the server composes its text, while the source row keeps the wording
  -- it recorded. It is inserted with its final values rather than inserted and edited, because a
  -- legacy row's own field set is immutable after insert (private.maintenance_revision). One primary
  -- per format still holds, and it is the target format's own existing primary that keeps it: a
  -- conversion records evidence beside what the property already said, so it never takes that flag
  -- from the row it did not convert. The insert also flags the record for review, exactly like any
  -- other address edit.
  composed:=private.composed_address_text(jsonb_populate_record(null::public.property_addresses,
    jsonb_build_object('format',target_format,'house_number',source.house_number,'street',source.street,
      'province_unit_id',province.id,'district_unit_id',district.id,'commune_unit_id',ward.id)));
  insert into public.property_addresses(property_id,format,address_text,house_number,street,province_unit_id,
      district_unit_id,commune_unit_id,mapping_status,effective_on,source_url,is_primary,supersedes_address_id)
    values(p_property_id,target_format,composed,source.house_number,source.street,province.id,
      district.id,ward.id,'candidate',mapping.effective_on,mapping.source_url,
      not exists(select 1 from public.property_addresses a
        where a.property_id=p_property_id and a.format=target_format and a.is_primary),
      source.id)
    returning id into created;
  return created;
end;
$$;

commit;
