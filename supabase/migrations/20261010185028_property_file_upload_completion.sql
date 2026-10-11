begin;
create extension if not exists pgcrypto with schema extensions;

alter table public.property_files add column purpose text not null default 'document' check (purpose in ('document','photo'));
update public.property_files set purpose = 'photo' where document_type = 'photo';
alter table public.property_files add column validated_at timestamptz;
alter table public.property_files add column validated_object_id uuid;
alter table public.property_files add constraint file_validation_identity check ((validated_at is null) = (validated_object_id is null));

create table private.file_validation_keys (
  id integer primary key check (id = 1),
  key_hex text not null check (key_hex ~ '^[0-9a-f]{64}$')
);
alter table private.file_validation_keys enable row level security;
revoke all on private.file_validation_keys from public,anon,authenticated,service_role;

-- Existing review attribution remains historical data, not a current mutation workflow.
drop function public.complete_property_upload(uuid);
drop function private.complete_upload(uuid);
drop function public.review_property_file(uuid,text);
drop function private.review_file(uuid,text);
revoke insert,update,delete on public.property_files from authenticated;
revoke update (upload_status) on public.property_files from authenticated;
drop policy files_insert on public.property_files;
drop policy files_update on public.property_files;

create function private.guard_file_identity() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null and row(new.id,new.property_id,new.document_type,new.bucket_id,new.object_path,new.original_filename,new.mime_type,new.size_bytes,new.sha256,new.purpose,new.uploaded_by,new.created_at,new.review_status,new.reviewed_by)
    is distinct from row(old.id,old.property_id,old.document_type,old.bucket_id,old.object_path,old.original_filename,old.mime_type,old.size_bytes,old.sha256,old.purpose,old.uploaded_by,old.created_at,old.review_status,old.reviewed_by) then
    raise exception 'file identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_file_identity() from public,anon,authenticated;
create trigger file_identity before update on public.property_files for each row execute function private.guard_file_identity();

create function private.register_property_file(p_file_id uuid,p_property_id uuid,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_purpose text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); f public.property_files; path text;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_file_id is null or p_property_id is null or p_original_filename is null
    or length(btrim(p_original_filename)) = 0 or octet_length(p_original_filename) > 255
    or p_original_filename in ('.','..') or p_original_filename ~ '[[:cntrl:]/\\<>:"|?*]'
    or p_mime_type is null or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp')
    or p_size_bytes is null or p_size_bytes not between 1 and 20971520
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_purpose is null or p_purpose not in ('document','photo')
    or (p_purpose = 'photo' and p_mime_type = 'application/pdf') then
    raise exception 'invalid file registration' using errcode = '23514';
  end if;
  perform 1 from public.properties where id = p_property_id and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  path := p_property_id::text || '/' || p_file_id::text || '/' || p_original_filename;
  insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,uploaded_by)
    values(p_file_id,p_property_id,'other',path,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose,me)
    on conflict (id) do nothing;
  select * into f from public.property_files where id = p_file_id for update;
  if row(f.property_id,f.uploaded_by,f.original_filename,f.mime_type,f.size_bytes,f.sha256,f.purpose)
    is distinct from row(p_property_id,me,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose) then
    raise exception 'registration identity conflict' using errcode = '42501';
  end if;
  return jsonb_build_object('fileId',f.id,'objectPath',f.object_path);
end;
$$;
create function public.register_property_file(p_file_id uuid,p_property_id uuid,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_purpose text default 'document')
returns jsonb language sql security invoker set search_path = '' as $$
  select private.register_property_file(p_file_id,p_property_id,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose);
$$;

create function private.complete_property_upload(p_file_id uuid,p_object_id uuid,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_signature text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); f public.property_files; prop uuid; key_value text; payload text; expected_signature text;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  select property_id into prop from public.property_files where id = p_file_id;
  perform 1 from public.properties where id = prop and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  select * into f from public.property_files where id = p_file_id for update;
  if not found or f.uploaded_by is distinct from me then raise exception 'uploader required' using errcode = '42501'; end if;
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
  payload := concat_ws('|','v1',f.id::text,f.property_id::text,f.uploaded_by::text,f.object_path,p_object_id::text,p_mime_type,p_size_bytes::text,p_sha256);
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
create function public.complete_property_upload(p_file_id uuid,p_object_id uuid,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_signature text)
returns void language sql security invoker set search_path = '' as $$
  select private.complete_property_upload(p_file_id,p_object_id,p_mime_type,p_size_bytes,p_sha256,p_signature);
$$;

revoke all on function private.register_property_file(uuid,uuid,text,text,bigint,text,text),public.register_property_file(uuid,uuid,text,text,bigint,text,text),private.complete_property_upload(uuid,uuid,text,bigint,text,text),public.complete_property_upload(uuid,uuid,text,bigint,text,text) from public,anon,authenticated;
grant execute on function private.register_property_file(uuid,uuid,text,text,bigint,text,text),public.register_property_file(uuid,uuid,text,text,bigint,text,text),private.complete_property_upload(uuid,uuid,text,bigint,text,text),public.complete_property_upload(uuid,uuid,text,bigint,text,text) to authenticated;

drop policy files_read on public.property_files;
create policy files_read on public.property_files for select to authenticated using (
  private.employee_id() is not null and exists (select 1 from public.properties p where p.id = property_id
    and ((upload_status = 'ready' and (p.archived_at is null or private.is_reviewer()))
      or (uploaded_by = private.employee_id() and p.archived_at is null)))
);
drop policy sgn_file_upload on storage.objects;
create policy sgn_file_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'property-files' and private.employee_id() is not null and exists (
    select 1 from public.property_files f join public.properties p on p.id = f.property_id
    where f.object_path = name and f.upload_status = 'pending' and f.uploaded_by = private.employee_id() and p.archived_at is null)
);
drop policy sgn_file_read on storage.objects;
create policy sgn_file_read on storage.objects for select to authenticated using (
  bucket_id = 'property-files' and private.employee_id() is not null and exists (
    select 1 from public.property_files f join public.properties p on p.id = f.property_id where f.object_path = name
    and ((f.upload_status = 'ready' and (p.archived_at is null or private.is_reviewer()) and (f.validated_object_id is null or f.validated_object_id = storage.objects.id))
      or (f.upload_status = 'pending' and f.uploaded_by = private.employee_id() and p.archived_at is null)))
);
commit;
