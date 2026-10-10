begin;
alter table public.property_files drop constraint property_files_check;
alter table public.property_files add constraint file_object_path_bound_to_identity check (
  object_path = property_id::text || '/' || id::text || '/content'
  or object_path = property_id::text || '/' || id::text || '/' || original_filename
);
-- Storage rejects Unicode keys; original filenames remain verbatim metadata and download names.
create or replace function private.register_property_file(p_file_id uuid,p_property_id uuid,p_original_filename text,p_mime_type text,p_size_bytes bigint,p_sha256 text,p_purpose text)
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
  path := p_property_id::text || '/' || p_file_id::text || '/content';
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
revoke all on function private.register_property_file(uuid,uuid,text,text,bigint,text,text) from public,anon,authenticated;
grant execute on function private.register_property_file(uuid,uuid,text,text,bigint,text,text) to authenticated;
commit;
