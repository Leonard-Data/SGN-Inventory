-- Property file storage on Cloudflare R2 with per-property class limits.
--
-- Bytes now live in a private R2 bucket under the same object keys, transferred directly
-- between the browser and R2 with short-lived presigned URLs. The existing `storage.objects`
-- policies are retained unchanged for the legacy Supabase bucket, which the application no
-- longer reads or writes; a file record is still the authority for who may read an object.
--
-- Limits are per property and follow the validated content type, never the chosen purpose,
-- category or cover choice: PDF is a document (at most 5, at most 20 MiB each) and
-- JPEG/PNG/WebP are images (at most 10, at most 5 MiB each). A ready photo that is also the
-- property cover is one of those images, so it never earns an extra slot.
--
-- A refused or abandoned registration releases its slot immediately (`cleanup_pending`) and
-- only becomes `failed` once the server has confirmed its object is gone, so `failed` always
-- means "no bytes to worry about".
begin;

alter table public.property_files drop constraint property_files_upload_status_check;
alter table public.property_files add constraint property_files_upload_status_check
  check (upload_status in ('pending','ready','failed','cleanup_pending'));

create or replace function private.register_property_file(
  p_file_id uuid,
  p_property_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_purpose text,
  p_category_id uuid default 'ffffffff-ffff-ffff-ffff-ffffffffffff'
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  f public.property_files;
  path text;
  cat_id uuid;
  file_kind text;
  used integer;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_file_id is null or p_property_id is null or p_original_filename is null
    or length(private.trim_unicode(p_original_filename)) = 0 or octet_length(p_original_filename) > 255
    or p_original_filename in ('.','..') or p_original_filename ~ '[[:cntrl:]/\\<>:"|?*]'
    or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_purpose is null or p_purpose not in ('document','photo')
    or (p_purpose = 'photo' and p_mime_type = 'application/pdf') then
    raise exception 'invalid file registration' using errcode = '23514';
  end if;
  file_kind := case when p_mime_type = 'application/pdf' then 'document' else 'image' end;
  if file_kind = 'image' and p_size_bytes > 5242880 then
    raise exception 'image exceeds 5 MiB' using errcode = 'P0022';
  end if;
  perform 1 from public.properties where id = p_property_id and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  select id into cat_id from public.document_categories where id = p_category_id;
  if cat_id is null then raise exception 'invalid category' using errcode = '23514'; end if;
  -- Only a registration still awaiting bytes may receive an upload policy: bytes uploaded under
  -- a released or finished row would be stranded outside every cleanup path. The row lock taken
  -- here is what makes that check hold for the rest of the transaction.
  select * into f from public.property_files where id = p_file_id for update;
  if found and f.upload_status <> 'pending' then
    raise exception 'registration is not awaiting upload' using errcode = '23514';
  end if;
  -- The parent row lock above serializes registrations for one property, and pending rows
  -- reserve their slot, so concurrent uploads cannot overshoot the class limit. Rows with no
  -- content type (unvalidated legacy data) belong to neither class and hold no slot. A signed
  -- upload policy lives 60 seconds, so a registration still pending after 15 minutes cannot
  -- receive bytes any more: it stays recorded but stops reserving its slot.
  select count(*) into used from public.property_files
    where property_id = p_property_id and id <> p_file_id
      and ((mime_type = 'application/pdf') = (file_kind = 'document'))
      and (upload_status = 'ready'
        or (upload_status = 'pending' and created_at > now() - interval '15 minutes'));
  if file_kind = 'document' and used >= 5 then
    raise exception 'document limit reached' using errcode = 'P0020';
  end if;
  if file_kind = 'image' and used >= 10 then
    raise exception 'image limit reached' using errcode = 'P0021';
  end if;
  path := p_property_id::text || '/' || p_file_id::text || '/content';
  insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,category_id,uploaded_by)
    values(p_file_id,p_property_id,'other',path,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose,cat_id,me)
    on conflict (id) do nothing;
  select * into f from public.property_files where id = p_file_id for update;
  -- On same-ID retry, category differences are ignored (existing retry can't recategorize).
  if row(f.property_id,f.uploaded_by,f.original_filename,f.mime_type,f.size_bytes,f.sha256,f.purpose)
    is distinct from row(p_property_id,me,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose) then
    raise exception 'registration identity conflict' using errcode = '42501';
  end if;
  return jsonb_build_object('fileId',f.id,'objectPath',f.object_path);
end;
$$;

create or replace function private.complete_property_upload(p_file_id uuid,p_object_id uuid,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_signature text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  f public.property_files;
  prop uuid;
  key_value text;
  payload text;
  expected_signature text;
  file_kind text;
  used integer;
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
  file_kind := case when p_mime_type = 'application/pdf' then 'document' else 'image' end;
  if file_kind = 'image' and p_size_bytes > 5242880 then
    raise exception 'image exceeds 5 MiB' using errcode = 'P0022';
  end if;
  select key_hex into key_value from private.file_validation_keys where id = 1;
  if key_value is null then raise exception 'validation unavailable'; end if;
  -- p_object_id is the validated object's identity in the private bucket. The server reads the
  -- object and signs this attestation; R2 is not visible to the database, so the signature is
  -- the evidence that the bytes, size and format were inspected for this exact object.
  payload := concat_ws('|','v1',f.id::text,f.property_id::text,coalesce(f.uploaded_by::text,''),f.object_path,p_object_id::text,p_mime_type,p_size_bytes::text,p_sha256);
  expected_signature := encode(extensions.hmac(convert_to(payload,'UTF8'),decode(key_value,'hex'),'sha256'),'hex');
  if p_signature is null or p_signature is distinct from expected_signature then
    raise exception 'invalid validation attestation' using errcode = '42501';
  end if;
  if f.validated_object_id is not null and f.validated_object_id <> p_object_id then
    raise exception 'immutable object changed' using errcode = '23514';
  end if;
  if f.validated_at is not null then return; end if;
  -- Defensive re-check of the class limit at the moment a pending file becomes readable,
  -- with the same 15-minute reservation window as registration.
  select count(*) into used from public.property_files
    where property_id = f.property_id and id <> f.id
      and ((mime_type = 'application/pdf') = (file_kind = 'document'))
      and (upload_status = 'ready'
        or (upload_status = 'pending' and created_at > now() - interval '15 minutes'));
  if file_kind = 'document' and used >= 5 then
    raise exception 'document limit reached' using errcode = 'P0020';
  end if;
  if file_kind = 'image' and used >= 10 then
    raise exception 'image limit reached' using errcode = 'P0021';
  end if;
  update public.property_files set upload_status = 'ready',validated_at = now(),validated_object_id = p_object_id where id = f.id;
end;
$$;

-- A refused completion releases its class slot at once, but the row is not `failed` until the
-- server confirms its object is gone; the sweeper retries every `cleanup_pending` row. The
-- release reports whether it moved the pending row, so a release that matched nothing (the row
-- became ready meanwhile) can never be followed by deleting that file's bytes.
create function private.fail_property_upload(p_file_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  released integer;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  update public.property_files set upload_status = 'cleanup_pending'
    where id = p_file_id and uploaded_by = me and upload_status = 'pending';
  get diagnostics released = row_count;
  return released = 1;
end;
$$;

create function public.fail_property_upload(p_file_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.fail_property_upload(p_file_id);
$$;

-- The only claim that an object's bytes are gone is made by the trusted server after a
-- confirmed DeleteObject, so this transition is not executable by any client session.
create function private.mark_upload_cleaned(p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.property_files set upload_status = 'failed'
    where id = p_file_id and upload_status = 'cleanup_pending';
end;
$$;

create function public.mark_upload_cleaned(p_file_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.mark_upload_cleaned(p_file_id);
$$;

revoke all on function private.fail_property_upload(uuid),public.fail_property_upload(uuid),private.mark_upload_cleaned(uuid),public.mark_upload_cleaned(uuid) from public,anon,authenticated;
grant execute on function private.fail_property_upload(uuid),public.fail_property_upload(uuid) to authenticated;
grant execute on function private.mark_upload_cleaned(uuid),public.mark_upload_cleaned(uuid) to service_role;

commit;
