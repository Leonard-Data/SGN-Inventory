-- Ticket #22: Property file read workspace.
-- Add purpose, document_categories table, authorize_file_read RPC, updated RLS for ready-only reads.
-- No upload/recovery/categories/covers UI (tickets #23-#27).
begin;

-- 1. Add purpose column to property_files (photo vs document, independent of MIME/type)
alter table public.property_files add column purpose text not null default 'document'
  check (purpose in ('photo', 'document'));

-- 2. Document categories table (company-wide, employee-created)
create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  unique (lower(btrim(label)))
);
create index document_categories_label_idx on public.document_categories(lower(btrim(label)));

-- 3. Add category FK to property_files (nullable; default implied via application)
alter table public.property_files add column category_id uuid references public.document_categories(id);

-- 4. Authorized file read: returns file metadata only if caller has live property access
--    Actual signed URL creation happens in the route handler via the Supabase JS client.
create function private.authorize_file_read(p_file_id uuid)
returns json language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  f public.property_files;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  select * into f from public.property_files where id = p_file_id;
  if not found then raise exception 'file not found' using errcode = '42501'; end if;
  if f.upload_status <> 'ready' then raise exception 'file not ready' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.properties
    where id = f.property_id
      and (archived_at is null or private.is_reviewer())
  ) then raise exception 'access denied' using errcode = '42501'; end if;
  return json_build_object(
    'file_id', f.id,
    'property_id', f.property_id,
    'object_path', f.object_path,
    'original_filename', f.original_filename,
    'mime_type', f.mime_type,
    'purpose', f.purpose,
    'category_id', f.category_id,
    'uploaded_by', f.uploaded_by,
    'created_at', f.created_at
  );
end;
$$;
create function public.authorize_file_read(p_file_id uuid)
returns json language sql security invoker set search_path = '' as $$
  select private.authorize_file_read(p_file_id);
$$;

-- 5. Replace property_files read RLS: active employees see ready files on properties they can view
drop policy if exists member_read on public.property_files;
create policy files_read on public.property_files for select to authenticated using (
  private.employee_id() is not null
  and upload_status = 'ready'
  and exists (
    select 1 from public.properties
    where id = property_id
      and (archived_at is null or private.is_reviewer())
  )
);

-- 6. Update insert policy: any active employee can register files to unarchived properties
--    (removes old can_edit_property requirement)
drop policy if exists files_insert on public.property_files;
create policy files_insert on public.property_files for insert to authenticated with check (
  uploaded_by = private.employee_id()
  and review_status = 'unreviewed'
  and reviewed_by is null
  and exists (
    select 1 from public.properties
    where id = property_id
      and archived_at is null
  )
);

-- 7. Enable RLS on document_categories (read-all for active employees, insert for all)
alter table public.document_categories enable row level security;
revoke all on public.document_categories from anon, authenticated;
grant select on public.document_categories to authenticated;
grant all on public.document_categories to service_role;
create policy categories_read on public.document_categories for select to authenticated using (
  private.employee_id() is not null
);
create policy categories_insert on public.document_categories for insert to authenticated with check (
  private.employee_id() is not null
);
create trigger audit_document_categories after insert or update or delete on public.document_categories
  for each row execute function private.audit_change();

-- 8. Grant execute on authorize_file_read
grant execute on function private.authorize_file_read(uuid) to authenticated;
grant execute on function public.authorize_file_read(uuid) to authenticated;
revoke all on function private.authorize_file_read(uuid) from public, anon;
revoke all on function public.authorize_file_read(uuid) from public, anon;

commit;
