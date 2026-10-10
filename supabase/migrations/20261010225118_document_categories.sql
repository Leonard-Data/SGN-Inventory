-- Ticket #25: company Document categories, default Other, legacy classification migration.
-- Active employees create/reuse categories; no rename/delete/merge/tags.
begin;

-- 1. Document categories table: company-wide, explicit RLS, case-normalized unique names.
create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  unique (lower(trim(name))),
  check (length(btrim(name)) > 0)
);
comment on table public.document_categories is 'Company-wide Document categories; built-in Other plus employee-created';
comment on column public.document_categories.name is 'Verbatim employee-created name; not translated';

alter table public.document_categories enable row level security;

-- Employees read all categories; active employees create them.
create policy categories_read on public.document_categories for select to authenticated using (
  private.employee_id() is not null
);
create policy categories_insert on public.document_categories for insert to authenticated with check (
  private.employee_id() is not null
);
revoke insert,update,delete on public.document_categories from authenticated;

-- 2. Built-in Other category (localized in UI; stored verbatim as 'Other' in DB).
-- The created_by references the first known admin/employee; we use a subquery.
do $$
declare
  first_employee_id uuid;
begin
  select id into first_employee_id from public.employees order by created_at limit 1;
  if first_employee_id is null then
    first_employee_id := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;
  insert into public.document_categories (id, name, created_by)
    values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Other', first_employee_id)
    on conflict (lower(trim(name))) do nothing;
end;
$$;

-- 3. Add category_id to property_files, defaulting to Other.
alter table public.property_files add column category_id uuid references public.document_categories(id);
update public.property_files set category_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' where category_id is null;
alter table public.property_files alter column category_id set not null;
alter table public.property_files alter column category_id set default 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- 4. Migrate legacy document_type classifications to categories losslessly.
-- Map each distinct non-other document_type to a category with the same name.
insert into public.document_categories (id, name, created_by)
select
  gen_random_uuid(),
  dt,
  (select id from public.employees order by created_at limit 1)
from (
  select distinct document_type from public.property_files
  where document_type <> 'other'
) dt
on conflict (lower(trim(name))) do nothing;

-- Assign the matching category to each legacy non-other file.
update public.property_files f
set category_id = c.id
from public.document_categories c
where f.document_type <> 'other'
  and lower(trim(c.name)) = lower(trim(f.document_type))
  and f.category_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- 5. Guard: category_id is immutable through the file_identity trigger.
-- Extend the existing trigger's row comparison to include category_id.
create or replace function private.guard_file_identity() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null and row(new.id,new.property_id,new.document_type,new.bucket_id,new.object_path,new.original_filename,new.mime_type,new.size_bytes,new.sha256,new.purpose,new.category_id,new.uploaded_by,new.created_at,new.review_status,new.reviewed_by)
    is distinct from row(old.id,old.property_id,old.document_type,old.bucket_id,old.object_path,old.original_filename,old.mime_type,old.size_bytes,old.sha256,old.purpose,old.category_id,old.uploaded_by,old.created_at,old.review_status,old.reviewed_by) then
    raise exception 'file identity is immutable' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_file_identity() from public,anon,authenticated;

-- 6. Create-or-get category function (invoker wrapper + private definer).
create function private.create_or_get_category(p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  trimmed_name text := btrim(p_name);
  existing_id uuid;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if trimmed_name is null or length(trimmed_name) = 0 then
    raise exception 'category name required' using errcode = '23514';
  end if;
  -- Check existing by normalized name (case-insensitive, trimmed).
  select id into existing_id from public.document_categories
    where lower(name) = lower(trimmed_name);
  if existing_id is not null then
    return existing_id;
  end if;
  -- Create new.
  insert into public.document_categories (name, created_by)
    values (trimmed_name, me)
    on conflict (lower(trim(name))) do nothing
    returning id into existing_id;
  if existing_id is null then
    select id into existing_id from public.document_categories
      where lower(name) = lower(trimmed_name);
  end if;
  return existing_id;
end;
$$;
revoke all on function private.create_or_get_category(text) from public,anon,authenticated;
grant execute on function private.create_or_get_category(text) to authenticated;

create function public.create_or_get_category(p_name text)
returns uuid language sql security invoker set search_path = '' as $$
  select private.create_or_get_category(p_name);
$$;
revoke all on function public.create_or_get_category(text) from public,anon,authenticated;
grant execute on function public.create_or_get_category(text) to authenticated;

-- 7. List categories: returns all categories ordered by name.
create function public.list_document_categories()
returns table(id uuid, name text, created_by uuid, created_at timestamptz)
language sql security invoker set search_path = '' stable as $$
  select id, name, created_by, created_at from public.document_categories order by name;
$$;
revoke all on function public.list_document_categories() from public,anon,authenticated;
grant execute on function public.list_document_categories() to authenticated;

-- 8. Update register_property_file to accept optional p_category_id.
-- Drop the old functions to replace.
drop function public.register_property_file(uuid,uuid,text,text,bigint,text,text);
drop function private.register_property_file(uuid,uuid,text,text,bigint,text,text);

create function private.register_property_file(
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
  -- Validate category exists.
  select id into cat_id from public.document_categories where id = p_category_id;
  if cat_id is null then raise exception 'invalid category' using errcode = '23514'; end if;
  path := p_property_id::text || '/' || p_file_id::text || '/content';
  insert into public.property_files(id,property_id,document_type,object_path,original_filename,mime_type,size_bytes,sha256,purpose,category_id,uploaded_by)
    values(p_file_id,p_property_id,'other',path,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose,cat_id,me)
    on conflict (id) do nothing;
  select * into f from public.property_files where id = p_file_id for update;
  -- On same-ID retry, only ignore valid category differences (existing retry can't recategorize).
  if row(f.property_id,f.uploaded_by,f.original_filename,f.mime_type,f.size_bytes,f.sha256,f.purpose)
    is distinct from row(p_property_id,me,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose) then
    raise exception 'registration identity conflict' using errcode = '42501';
  end if;
  return jsonb_build_object('fileId',f.id,'objectPath',f.object_path);
end;
$$;
revoke all on function private.register_property_file(uuid,uuid,text,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function private.register_property_file(uuid,uuid,text,text,bigint,text,text,uuid) to authenticated;

create function public.register_property_file(
  p_file_id uuid,
  p_property_id uuid,
  p_original_filename text,
  p_mime_type text,
  p_size_bytes bigint,
  p_sha256 text,
  p_purpose text default 'document',
  p_category_id uuid default 'ffffffff-ffff-ffff-ffff-ffffffffffff'
)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.register_property_file(p_file_id,p_property_id,p_original_filename,p_mime_type,p_size_bytes,p_sha256,p_purpose,p_category_id);
$$;
revoke all on function public.register_property_file(uuid,uuid,text,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_property_file(uuid,uuid,text,text,bigint,text,text,uuid) to authenticated;

-- 9. Update existing RLS policy for files_read to include category_id in selectable fields.
-- (The policy already selects property_files rows; category_id is just another column.)

commit;
