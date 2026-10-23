-- Issue #277: the person stops typing the known address.
--
-- The address form asked for an `address_text` beside the parts that text is supposed to describe,
-- and the two could disagree. The server now composes the text from the parts an address records -
-- house number, street, commune, district and province, joined by ", " - and the form asks only for
-- the parts. The order is the address's own escalation, so a legacy address reads *house number,
-- street, commune, district, province* and a current address the same line without the district it
-- never records (the table already refuses district parts on a current row).
--
-- What changes, and what deliberately does not:
--   1. private.composed_address_text composes one row's text. A recorded source label wins over the
--      official name of the unit it names, because the label is that address's own evidence; the
--      official name only fills a level the source left unnamed, which is the app's own case - its
--      pickers record a unit and no label. A missing part is skipped, never an empty segment, a
--      doubled separator or a placeholder word, and a row with no part at all composes null.
--   2. private.maintain_property composes it for a save, in the one place an address write already
--      happens, so both creation and editing reach it. A change set that states its own text is the
--      recorded-evidence case below and keeps it, and a row that records no part at all keeps the
--      text it already holds, because that text is its only evidence; a new address with no part to
--      compose is refused as a known address is required.
--   3. public.maintain_property and private.create_property refuse a change set that states a
--      known address at all ('23514'), so the browser, a direct RPC call and any other client
--      cannot store a text beside parts that disagree with it.
--
-- Existing rows are untouched: nothing is rewritten, backfilled or re-imported. The 18,548 imported
-- addresses that already read as this composition produces keep that text, and the 276 that differ
-- keep their recorded wording. Recorded text stays evidence: the crosswalk candidate
-- (private.record_address_candidate) and the format conversion record the source text they carry,
-- exactly as before, and an applied correction keeps the proposal it was submitted with.
--
-- The search projection is unchanged: it is recomputed by the existing trigger from the row it is
-- given, so a composed text feeds the same `search_text` a recorded one feeds.
begin;

-- One row's text, composed from its parts, or null when it records none.
create function private.composed_address_text(a public.property_addresses) returns text
language sql stable security invoker set search_path='' as $$
  select nullif(array_to_string(array_remove(array[
    nullif(btrim(a.house_number),''),
    nullif(btrim(a.street),''),
    coalesce(nullif(btrim(a.commune_text),''),(select name_vi from public.admin_unit_versions where id=a.commune_unit_id)),
    case when a.format<>'current' then
      coalesce(nullif(btrim(a.district_text),''),(select name_vi from public.admin_unit_versions where id=a.district_unit_id)) end,
    coalesce(nullif(btrim(a.province_text),''),(select name_vi from public.admin_unit_versions where id=a.province_unit_id))
  ],null),', '),'');
$$;
revoke all on function private.composed_address_text(public.property_addresses) from public,anon,authenticated;

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
      -- A verified mapping is a reviewer's record: moving it to another state, or repointing its
      -- units, is refused for every other role instead of silently un-verifying it.
      if addr.mapping_status='verified' and not private.is_reviewer() then raise exception 'reviewer required for mapping' using errcode='42501'; end if;
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
    -- The server is the only author of a recorded address text: an ordinary save states the parts
    -- and this composes the text from them, so no save can store a text that disagrees with its own
    -- parts. The two flows that record source text as evidence - the crosswalk candidate and the
    -- format conversion - carry a text they preserve, and the public API refuses a supplied one, so
    -- only those internal rows reach here holding a text of their own.
    if not p_changes ? 'address_text' then addr.address_text:=coalesce(private.composed_address_text(addr),addr.address_text); end if;
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

create or replace function private.create_property(p_mode text,p_facts jsonb,p_address jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); prop uuid; code text; rev uuid;
begin
  if me is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('sale','rent','both') then raise exception 'invalid creation' using errcode='23514'; end if;
  perform private.validate_maintenance('property',p_facts);
  perform private.validate_maintenance('address',p_address);
  -- The known address is composed from the parts the creation states, so a creation that states
  -- one itself is refused rather than stored beside parts that say something else.
  if p_address->>'format' is null or p_address->>'format' not in ('legacy','current')
    or p_address ? 'address_text'
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

-- The one save the app and any other client reaches: a change set that states a known address is
-- refused here rather than composed over, so the two can never drift again. An address change with
-- no text is composed by the writer below, and the recorded-evidence flows that call the private
-- writer directly (the crosswalk candidate, an applied correction's own proposal) are untouched.
create or replace function public.maintain_property(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid,p_explanation text default null) returns uuid
language plpgsql security invoker set search_path='' as $$
begin
  if p_target='address' and coalesce(p_changes,'{}'::jsonb) ? 'address_text' then
    raise exception 'known address is composed from its parts' using errcode='23514'; end if;
  return private.maintain_property_explained(p_property_id,p_target,p_target_id,p_expected_revision,p_changes,p_property_revision,p_explanation);
end;
$$;
revoke all on function public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid,text) to authenticated;

commit;
