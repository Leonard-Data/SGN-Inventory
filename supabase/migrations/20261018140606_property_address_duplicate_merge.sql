-- Issue #147: a property whose address already exists says how many other properties share it,
-- lets staff compare the records side by side, and lets a manager or admin fold the rest of the
-- group into the most complete record. Nothing merges on its own, creating a second property at
-- an existing address is never blocked, and the address model is unchanged.
--
-- Address equality is the recorded address text normalised exactly as inventory search already
-- normalises it (`private.normalize_search`: lowercased, accent-folded). No second matcher, fuzzy
-- or otherwise, is introduced. Only unarchived records form a group, so a merged-away record stops
-- reporting as a duplicate.
begin;

-- One definition of "the same address", used by the group read and the merge guard alike.
create function private.address_match_key(value text) returns text
language sql stable security invoker set search_path = '' as $$
  select private.normalize_search(coalesce(value,''));
$$;

-- Which record is the most complete one: the number of recorded facts, owner links, readable
-- files and recorded asking-price changes. A merged-away record's content lands on it.
create function private.property_completeness(p_property_id uuid) returns integer
language sql stable security invoker set search_path = '' as $$
  select (case when p.sale_price_vnd is not null then 1 else 0 end)
    + (case when p.monthly_rent_vnd is not null then 1 else 0 end)
    + (case when p.land_area_m2 is not null then 1 else 0 end)
    + (case when p.floor_area_m2 is not null then 1 else 0 end)
    + (case when p.frontage_m is not null then 1 else 0 end)
    + (case when p.depth_m is not null then 1 else 0 end)
    + (case when p.floors is not null then 1 else 0 end)
    + (case when p.bedrooms is not null then 1 else 0 end)
    + (case when p.bathrooms is not null then 1 else 0 end)
    + (case when p.direction is not null then 1 else 0 end)
    + (case when p.ownership_type is not null then 1 else 0 end)
    + (case when p.parcel_number is not null then 1 else 0 end)
    + (case when p.map_sheet_number is not null then 1 else 0 end)
    + (case when p.construction_text is not null then 1 else 0 end)
    + (case when p.area_raw is not null then 1 else 0 end)
    + (case when p.notes is not null then 1 else 0 end)
    + (case when p.legal_status <> 'unknown' then 1 else 0 end)
    + (case when p.latitude is not null then 1 else 0 end)
    + (case when exists (select 1 from public.property_contacts l where l.property_id = p.id) then 1 else 0 end)
    + (case when exists (select 1 from public.property_files f where f.property_id = p.id and f.upload_status = 'ready') then 1 else 0 end)
    + (case when exists (select 1 from public.property_history h where h.property_id = p.id) then 1 else 0 end)
  from public.properties p where p.id = p_property_id;
$$;

-- The comparison read. Ordinary RLS applies because the function is an invoker, and archived
-- records are excluded for every role, so a folded-in record never reappears as a duplicate.
-- Owner names are listed the way the record's own contact panel lists them; no phone is exposed.
create function public.property_address_group(p_property_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  keys text[];
  members jsonb;
begin
  if private.employee_id() is null then
    raise exception 'active employee required' using errcode = '42501';
  end if;
  if p_property_id is null or not exists (
    select 1 from public.properties where id = p_property_id and archived_at is null
  ) then
    return jsonb_build_object('keepId', null, 'members', '[]'::jsonb);
  end if;
  select array_agg(distinct private.address_match_key(a.address_text)) into keys
    from public.property_addresses a
    where a.property_id = p_property_id and a.is_primary;
  if keys is null then
    return jsonb_build_object('keepId', null, 'members', '[]'::jsonb);
  end if;
  with shared as (
    select p.id from public.properties p
    where p.archived_at is null
      and exists (select 1 from public.property_addresses a
                  where a.property_id = p.id and a.is_primary
                    and private.address_match_key(a.address_text) = any(keys))
  ), scored as (
    select p.id, p.property_code, p.listing_mode, p.status, p.created_at,
      p.sale_price_vnd::text as sale_price_vnd,
      p.land_area_m2::text as land_area_m2,
      p.floor_area_m2::text as floor_area_m2,
      p.frontage_m::text as frontage_m,
      p.depth_m::text as depth_m,
      private.property_completeness(p.id) as completeness,
      coalesce((select jsonb_agg(c.display_name order by c.display_name)
                from public.property_contacts l
                join public.contacts c on c.id = l.contact_id
                where l.property_id = p.id and l.relation = 'owner'), '[]'::jsonb) as owners
    from public.properties p join shared s on s.id = p.id
  ), ordered as (
    select *, row_number() over (order by completeness desc, created_at, id) as place from scored
  )
  select jsonb_agg(jsonb_build_object(
      'id', id, 'propertyCode', property_code, 'listingMode', listing_mode, 'status', status,
      'salePriceVnd', sale_price_vnd, 'landAreaM2', land_area_m2, 'floorAreaM2', floor_area_m2,
      'frontageM', frontage_m, 'depthM', depth_m, 'completeness', completeness, 'owners', owners)
    order by place) into members
  from ordered;
  return jsonb_build_object('keepId', (members->0->>'id')::uuid, 'members', coalesce(members, '[]'::jsonb));
end;
$$;

-- A merged ready file moves to the survivor's own object key, so the file identity guard must
-- allow exactly that change and nothing else. The merge sets the marker itself, inside its own
-- transaction, after checking the acting employee's role; every ordinary write stays refused.
create or replace function private.guard_file_identity() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null and row(new.id,new.property_id,new.document_type,new.bucket_id,new.object_path,new.original_filename,new.mime_type,new.size_bytes,new.sha256,new.purpose,new.uploaded_by,new.created_at,new.review_status,new.reviewed_by)
    is distinct from row(old.id,old.property_id,old.document_type,old.bucket_id,old.object_path,old.original_filename,old.mime_type,old.size_bytes,old.sha256,old.purpose,old.uploaded_by,old.created_at,old.review_status,old.reviewed_by)
    and current_setting('sgn.property_merge_keep',true) is distinct from new.property_id::text then
    raise exception 'file identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Deliberate merge: manager/admin only, both records named by the caller, same normalised
-- address, the most complete record surviving, and only file rows whose bytes the server has
-- already copied to their new key. Everything happens in one transaction.
create function private.merge_address_properties(p_keep_property_id uuid, p_merge_property_ids uuid[], p_moved_file_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.properties;
  keys text[];
  survivor uuid;
  adopted_cover uuid;
  merged jsonb;
  files_moved integer := 0;
  links_moved integer := 0;
  links_shared integer := 0;
  history_moved integer := 0;
begin
  if me is null then
    raise exception 'active employee required' using errcode = '42501';
  end if;
  if private.employee_role() not in ('manager','admin') then
    raise exception 'manager or admin required' using errcode = '42501';
  end if;
  if p_keep_property_id is null or p_merge_property_ids is null
    or array_length(p_merge_property_ids,1) is null
    or array_length(p_merge_property_ids,1) > 20
    or array_position(p_merge_property_ids,null) is not null
    or p_keep_property_id = any(p_merge_property_ids)
    or (select count(distinct x) from unnest(p_merge_property_ids) x) <> array_length(p_merge_property_ids,1) then
    raise exception 'invalid merge request' using errcode = '23514';
  end if;

  -- Parent property rows are taken in id order, the same order every merge uses.
  perform 1 from public.properties
    where id = any(array[p_keep_property_id] || p_merge_property_ids) order by id for update;

  select * into target from public.properties where id = p_keep_property_id;
  if not found or (select count(*) from public.properties where id = any(p_merge_property_ids))
      <> array_length(p_merge_property_ids,1) then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
  if target.archived_at is not null
    or exists (select 1 from public.properties where id = any(p_merge_property_ids) and archived_at is not null) then
    raise exception 'archived property cannot be merged' using errcode = '42501';
  end if;

  -- The most complete record survives; a different target is refused, never silently relabelled.
  select p.id into survivor from public.properties p
    where p.id = any(array[p_keep_property_id] || p_merge_property_ids)
    order by private.property_completeness(p.id) desc, p.created_at, p.id limit 1;
  if survivor <> p_keep_property_id then
    raise exception 'merge keeps the most complete record' using errcode = 'P0008';
  end if;

  select array_agg(distinct private.address_match_key(a.address_text)) into keys
    from public.property_addresses a where a.property_id = p_keep_property_id and a.is_primary;
  if keys is null then
    raise exception 'merge needs a primary address' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(p_merge_property_ids) x
             where not exists (select 1 from public.property_addresses a
                               where a.property_id = x and a.is_primary
                                 and private.address_match_key(a.address_text) = any(keys))) then
    raise exception 'properties do not share an address' using errcode = 'P0009';
  end if;

  -- A committed reservation or a live rental is somebody's agreement, not a duplicate record.
  if exists (select 1 from public.property_locks
             where property_id = any(p_merge_property_ids) and status = 'approved' and expires_at > now()) then
    raise exception 'reserved property cannot be merged away' using errcode = 'P0014';
  end if;
  if exists (select 1 from public.rental_agreements
             where property_id = any(p_merge_property_ids) and status = 'active') then
    raise exception 'rented property cannot be merged away' using errcode = 'P0015';
  end if;

  -- Only rows whose bytes the server already copied to the survivor's key may move.
  if exists (select 1 from public.property_files f
             where f.property_id = any(p_merge_property_ids) and f.upload_status = 'ready'
               and not (f.id = any(coalesce(p_moved_file_ids,'{}'::uuid[])))) then
    raise exception 'file move incomplete' using errcode = 'P0016';
  end if;

  select jsonb_agg(jsonb_build_object('id', p.id, 'propertyCode', p.property_code) order by p.property_code)
    into merged from public.properties p where p.id = any(p_merge_property_ids);

  -- The survivor takes a moved cover only when it has no cover of its own.
  select f.id into adopted_cover
    from public.properties p join public.property_files f on f.id = p.cover_file_id
    where p.id = any(p_merge_property_ids) and f.upload_status = 'ready'
      and f.id = any(coalesce(p_moved_file_ids,'{}'::uuid[]))
    order by p.created_at, f.id limit 1;

  -- Owner links move; a pair the survivor already records converges on that single link, and at
  -- most one moved link becomes the survivor's primary contact.
  with moving as (
    select l.property_id, l.contact_id, l.is_primary,
      row_number() over (partition by l.is_primary order by l.property_id, l.contact_id) as primary_place
    from public.property_contacts l
    where l.property_id = any(p_merge_property_ids)
      and not exists (select 1 from public.property_contacts k
                      where k.property_id = p_keep_property_id and k.contact_id = l.contact_id)
  )
  update public.property_contacts l
    set property_id = p_keep_property_id,
      is_primary = m.is_primary and m.primary_place = 1
        and not exists (select 1 from public.property_contacts k
                        where k.property_id = p_keep_property_id and k.is_primary)
    from moving m
    where l.property_id = m.property_id and l.contact_id = m.contact_id;
  get diagnostics links_moved = row_count;

  select count(*) into links_shared from public.property_contacts l
    where l.property_id = any(p_merge_property_ids)
      and exists (select 1 from public.property_contacts k
                  where k.property_id = p_keep_property_id and k.contact_id = l.contact_id);

  update public.property_history set property_id = p_keep_property_id
    where property_id = any(p_merge_property_ids);
  get diagnostics history_moved = row_count;

  perform set_config('sgn.property_merge_keep',p_keep_property_id::text,true);
  update public.property_files f
    set property_id = p_keep_property_id,
      object_path = p_keep_property_id::text || '/' || f.id::text || '/' ||
        substring(f.object_path from length(f.property_id::text || '/' || f.id::text || '/') + 1)
    where f.property_id = any(p_merge_property_ids) and f.upload_status = 'ready'
      and f.id = any(coalesce(p_moved_file_ids,'{}'::uuid[]));
  get diagnostics files_moved = row_count;
  perform set_config('sgn.property_merge_keep','',true);

  update public.properties set cover_file_id = null
    where id = any(p_merge_property_ids) and cover_file_id is not null;
  if adopted_cover is not null and target.cover_file_id is null then
    update public.properties set cover_file_id = adopted_cover where id = p_keep_property_id;
  end if;

  update public.properties set archived_at = now() where id = any(p_merge_property_ids);

  return jsonb_build_object(
    'keep', jsonb_build_object('id', target.id, 'propertyCode', target.property_code),
    'merged', merged,
    'moved', jsonb_build_object(
      'files', files_moved, 'ownerLinks', links_moved,
      'alreadyLinked', links_shared, 'history', history_moved));
end;
$$;

create function public.merge_address_properties(p_keep_property_id uuid, p_merge_property_ids uuid[], p_moved_file_ids uuid[] default '{}')
returns jsonb language sql security invoker set search_path = '' as $$
  select private.merge_address_properties(p_keep_property_id,p_merge_property_ids,p_moved_file_ids);
$$;

revoke all on function private.address_match_key(text),private.property_completeness(uuid),
  private.merge_address_properties(uuid,uuid[],uuid[]),
  public.property_address_group(uuid),public.merge_address_properties(uuid,uuid[],uuid[])
  from public,anon,authenticated;
grant execute on function private.address_match_key(text),private.property_completeness(uuid),
  private.merge_address_properties(uuid,uuid[],uuid[]),
  public.property_address_group(uuid),public.merge_address_properties(uuid,uuid[],uuid[])
  to authenticated;
commit;
