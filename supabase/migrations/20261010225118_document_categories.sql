-- Ticket #25: company Document categories, default Other, legacy classification migration.
-- Active employees create/reuse categories; no rename/delete/merge/tags.
-- Seeded categories (built-in Other, legacy document_type codes) have a non-null builtin column.
begin;

-- 1. Document categories table: company-wide, explicit RLS, case-normalized unique names.
create table public.document_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  builtin text check (builtin in ('other', 'land_certificate', 'sale_contract', 'planning', 'construction_permit', 'photo')),
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  check (length(trim(both from name)) > 0)
);
comment on table public.document_categories is 'Company-wide Document categories; built-in Other plus employee-created';
comment on column public.document_categories.name is 'Verbatim name; seeded legacy codes store VI names, Other stores Other';
comment on column public.document_categories.builtin is 'Non-null for system-seeded: other or a legacy document_type code';
comment on column public.document_categories.created_by is 'Null for system-seeded categories';

-- Case-insensitive, trimmed uniqueness via expression index (preserves Vietnamese accents).
create unique index idx_document_categories_name_unique on public.document_categories (lower(trim(both from name)));

alter table public.document_categories enable row level security;

-- Explicit grants: only RLS-authorized access.
revoke all on public.document_categories from public, anon, authenticated;
grant select on public.document_categories to authenticated;

create policy categories_read on public.document_categories for select to authenticated using (
  private.employee_id() is not null
);
create policy categories_insert on public.document_categories for insert to authenticated with check (
  private.employee_id() is not null
);

-- 2. Built-in Other category (localized in UI; stored verbatim as 'Other' in DB).
insert into public.document_categories (id, name, builtin, created_by)
  values ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Other', 'other', null)
  on conflict (id) do nothing;

-- 3. Seed legacy document_type categories with VI display names. created_by is NULL for system seed.
insert into public.document_categories (name, builtin, created_by) values
  ('Giấy chứng nhận quyền sử dụng đất', 'land_certificate', null),
  ('Hợp đồng mua bán', 'sale_contract', null),
  ('Quy hoạch', 'planning', null),
  ('Giấy phép xây dựng', 'construction_permit', null),
  ('Ảnh bất động sản', 'photo', null)
on conflict (lower(trim(both from name))) do nothing;

-- 4. Add category_id to property_files, defaulting to Other.
alter table public.property_files add column category_id uuid references public.document_categories(id);
update public.property_files set category_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff' where category_id is null;
alter table public.property_files alter column category_id set not null;
alter table public.property_files alter column category_id set default 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- 5. Map legacy document_type to the correct seeded category. Unmatched values fall back to Other.
update public.property_files f
set category_id = c.id
from public.document_categories c
where f.document_type <> 'other'
  and c.builtin = f.document_type
  and f.category_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

-- 6. category_id is mutable (ticket #26 adds controlled recategorization).
-- The original guard_file_identity trigger remains unchanged; direct metadata writes are already revoked.
-- Do NOT add category_id to guard_file_identity — that would prevent authorized recategorization.

-- 7. Create-or-get category function (invoker wrapper + private definer).
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
    on conflict (lower(trim(both from name))) do nothing
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

-- 8. List categories.
create function public.list_document_categories()
returns table(id uuid, name text, builtin text, created_by uuid, created_at timestamptz)
language sql security invoker set search_path = '' stable as $$
  select id, name, builtin, created_by, created_at from public.document_categories order by name;
$$;
revoke all on function public.list_document_categories() from public,anon,authenticated;
grant execute on function public.list_document_categories() to authenticated;

-- 9. Update register_property_file to accept optional p_category_id.
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
  select id into cat_id from public.document_categories where id = p_category_id;
  if cat_id is null then raise exception 'invalid category' using errcode = '23514'; end if;
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

commit;
