-- Ticket #27: Property cover photo.
-- Add nullable cover_file_id to properties, guard direct UPDATE of cover,
-- provide a single definer RPC (with NULL=clear) for authorized editors.
-- Cover requires a completed (validated) Property-photo on the same property.
-- Legacy ready (validated_at=null) photos are rejected; editors must validate first.
begin;

-- 1. Add cover_file_id column to properties
alter table public.properties add column cover_file_id uuid references public.property_files(id);
comment on column public.properties.cover_file_id is 'Nullable explicit cover photo. Only a completed validated Property-photo on the same property is eligible. Set/clear via set_property_cover RPC only.';

-- 2. Guard direct cover_file_id changes on properties (UPDATE and INSERT)
-- The existing invoker guard_property already handles common fields.
-- An invoker trigger sees authenticated clients, but the guarded definer's owner during its UPDATE.
create function private.guard_property_cover() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role')
     and (case when tg_op = 'INSERT' then new.cover_file_id is not null
       else new.cover_file_id is distinct from old.cover_file_id end)
  then
    raise exception 'cover_file_id is set/cleared only through set_property_cover RPC' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_property_cover() from public,anon,authenticated;
create trigger property_cover_guard before insert or update on public.properties
  for each row execute function private.guard_property_cover();

-- 3. Single definer RPC: set_property_cover (p_file_id NULL → clear)
create function private.set_property_cover(p_property_id uuid, p_file_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  f public.property_files;
begin
  -- Active employee
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  -- Unarchived property, lock parent row
  if not exists (select 1 from public.properties where id = p_property_id and archived_at is null for update) then
    raise exception 'unarchived property required' using errcode = '42501';
  end if;
  -- Editor authority (reuses existing private.can_edit_property)
  if not private.can_edit_property(p_property_id) then
    raise exception 'property edit authority required' using errcode = '42501';
  end if;

  if p_file_id is null then
    -- Clear
    update public.properties set cover_file_id = null where id = p_property_id;
  else
    -- Set: validate file eligibility
    select * into f from public.property_files where id = p_file_id for update;
    if not found then raise exception 'file not found' using errcode = '42501'; end if;
    if f.property_id is distinct from p_property_id then
      raise exception 'file must belong to this property' using errcode = '42501';
    end if;
    if f.purpose is distinct from 'photo' then
      raise exception 'cover requires a Property photo' using errcode = '23514';
    end if;
    if f.upload_status is distinct from 'ready' then
      raise exception 'cover requires a completed upload' using errcode = '23514';
    end if;
    -- Explicit validated_at check: legacy ready photos without validation are rejected
    if f.validated_at is null or f.validated_object_id is null then
      raise exception 'cover requires a validated file' using errcode = '23514';
    end if;
    update public.properties set cover_file_id = p_file_id where id = p_property_id;
  end if;
end;
$$;
revoke all on function private.set_property_cover(uuid,uuid) from public,anon,authenticated;

-- 4. Public invoker wrapper
create function public.set_property_cover(p_property_id uuid, p_file_id uuid default null)
returns void language sql security invoker set search_path = '' as $$
  select private.set_property_cover(p_property_id, p_file_id);
$$;

-- 5. Grants
grant execute on function private.set_property_cover(uuid,uuid) to authenticated;
revoke all on function public.set_property_cover(uuid,uuid) from public,anon;
grant execute on function public.set_property_cover(uuid,uuid) to authenticated;

create or replace function private.complete_property_upload(p_file_id uuid,p_object_id uuid,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_signature text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); f public.property_files; prop uuid; key_value text; payload text; expected_signature text;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  select property_id into prop from public.property_files where id = p_file_id;
  perform 1 from public.properties where id = prop and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  select * into f from public.property_files where id = p_file_id for update;
  if not found or (f.uploaded_by is distinct from me and not (
    f.upload_status = 'ready' and f.purpose = 'photo' and private.can_edit_property(prop)
  )) then raise exception 'uploader or ready-photo editor required' using errcode = '42501'; end if;
  if p_object_id is null or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid validation' using errcode = '23514';
  end if;
  if (f.mime_type is not null and f.mime_type <> p_mime_type)
    or (f.size_bytes is not null and f.size_bytes <> p_size_bytes)
    or (f.sha256 is not null and f.sha256 <> p_sha256)
    or f.upload_status not in ('pending','ready')
    or (f.purpose = 'photo' and p_mime_type = 'application/pdf')
    or (f.upload_status = 'pending' and (f.mime_type is null or f.size_bytes is null or f.sha256 is null)) then
    raise exception 'registered content mismatch' using errcode = '23514';
  end if;
  select key_hex into key_value from private.file_validation_keys where id = 1;
  if key_value is null then raise exception 'validation unavailable'; end if;
  payload := concat_ws('|','v1',f.id::text,f.property_id::text,coalesce(f.uploaded_by::text,''),f.object_path,p_object_id::text,p_mime_type,p_size_bytes::text,p_sha256);
  expected_signature := encode(extensions.hmac(convert_to(payload,'UTF8'),decode(key_value,'hex'),'sha256'),'hex');
  if p_signature is null or p_signature is distinct from expected_signature then
    raise exception 'invalid validation attestation' using errcode = '42501';
  end if;
  perform 1 from storage.objects where id = p_object_id and bucket_id = f.bucket_id and name = f.object_path for share;
  if not found then raise exception 'stored identity mismatch' using errcode = '23514'; end if;
  if f.validated_object_id is not null and f.validated_object_id <> p_object_id then
    raise exception 'immutable object changed' using errcode = '23514';
  end if;
  if f.validated_at is not null then return; end if;
  update public.property_files set upload_status = 'ready',validated_at = now(),validated_object_id = p_object_id where id = f.id;
end;
$$;
revoke all on function private.complete_property_upload(uuid,uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function private.complete_property_upload(uuid,uuid,text,bigint,text,text) to authenticated;

commit;
