-- Ticket #73: the company vendor directory. A Vendor is a distinct company record with one
-- optional contact block; it is never an employee, an owner, a broker or a `contacts` row
-- reclassified through `contact_type`, and this slice adds no property links, no editing and
-- no procurement/payment fields. Every active employee may read the directory; only
-- staff/manager/admin may create or maintain it (C5). Reads use the ordinary publishable-key
-- RLS path; creation goes through the guarded invoker wrapper below. Unknown optional values
-- stay null rather than being filled with invented defaults, and phone strings are kept as
-- typed (surrounding Unicode whitespace removed, nothing else rewritten).
begin;

-- One vendor's optional contact block holds at most five phone strings, each 1-40 characters
-- after the same Unicode trim the application applies. Null means the detail is unknown.
create function private.vendor_phones_ok(p_phones text[]) returns boolean
language sql immutable set search_path = '' as $$
  select p_phones is null or (
    coalesce(array_length(p_phones,1),0) between 1 and 5
    and not exists (
      select 1 from unnest(p_phones) as phone
      where phone is null
        or phone <> private.trim_unicode(phone)
        or length(phone) not between 1 and 40
    )
  );
$$;

create table public.vendors (
  id uuid primary key default gen_random_uuid(),
  -- Company / display name as recorded; never translated or normalized.
  display_name text not null,
  -- The one optional contact block. Each column is independent: an unknown value is null.
  contact_name text,
  phones text[],
  email text,
  source_address text,
  notes text,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default clock_timestamp(),
  -- Employee-scoped submission key: an interrupted create retries the original vendor
  -- identity instead of recording a duplicate company.
  submission_key uuid not null,
  -- Stored accent-insensitive projection of the company and contact name, populated only by
  -- the trigger below; it serves the directory search and is never a source value.
  search_text text not null default '',
  unique (created_by, submission_key),
  check (display_name = private.trim_unicode(display_name) and length(display_name) between 1 and 200),
  check (contact_name is null or (contact_name = private.trim_unicode(contact_name)
    and length(contact_name) between 1 and 200)),
  check (private.vendor_phones_ok(phones)),
  check (email is null or (email = private.trim_unicode(email)
    and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  check (source_address is null or (source_address = private.trim_unicode(source_address)
    and length(source_address) between 1 and 500)),
  check (notes is null or (notes = private.trim_unicode(notes) and length(notes) between 1 and 2000))
);
comment on table public.vendors is 'Company vendor directory; readable by every active employee, created by staff/manager/admin through create_vendor';
comment on column public.vendors.display_name is 'Company/display name exactly as recorded in either interface language';
comment on column public.vendors.phones is 'Phone strings preserved as typed; null means no recorded phone, never an invented default';
comment on column public.vendors.source_address is 'Raw address/source text as recorded; never rewritten into current administrative units';
comment on column public.vendors.submission_key is 'Employee-scoped create submission key; one vendor identity per employee and key';

-- Newest-recorded-first keyset paging: a just-created vendor is the first row of the directory.
create index vendors_page_idx on public.vendors(created_at desc, id desc);

-- Directory search follows the address-search convention: normalize once at write time and
-- keep the include-match indexed with the existing trigram extension instead of scanning
-- every company on each query.
create function private.vendor_search_text() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.search_text := private.normalize_search(concat_ws(' ', new.display_name, new.contact_name));
  return new;
end;
$$;
create trigger vendor_search before insert or update on public.vendors
  for each row execute function private.vendor_search_text();
create index vendors_search_trgm_idx on public.vendors using gin(search_text extensions.gin_trgm_ops);

alter table public.vendors enable row level security;
-- Explicit grants: reads only. No client INSERT/UPDATE/DELETE path exists in this slice.
revoke all on public.vendors from public, anon, authenticated, service_role;
grant select on public.vendors to authenticated;

-- Read authority is the live active employee check; no role filter, because every active
-- employee may read the directory (C5).
create policy vendors_read on public.vendors for select to authenticated using (
  private.employee_id() is not null
);

-- Vendor identities are created only through the guarded operation and are immutable here:
-- this slice has no edit surface, so a direct write is refused from the first creation.
create function private.guard_vendor_original() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'use the create_vendor operation' using errcode = '42501';
    end if;
    return new;
  end if;
  raise exception 'vendor records are immutable in this slice' using errcode = '23514';
end;
$$;
create trigger vendor_original before insert or update or delete on public.vendors
  for each row execute function private.guard_vendor_original();

create function private.create_vendor(
  p_key uuid,
  p_display_name text,
  p_contact_name text default null,
  p_phones text[] default null,
  p_email text default null,
  p_source_address text default null,
  p_notes text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  company text := private.trim_unicode(p_display_name);
  contact text := nullif(private.trim_unicode(p_contact_name), '');
  mail text := nullif(private.trim_unicode(p_email), '');
  address text := nullif(private.trim_unicode(p_source_address), '');
  note text := nullif(private.trim_unicode(p_notes), '');
  phone_list text[];
  existing public.vendors;
  created public.vendors;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if private.employee_role() not in ('staff','manager','admin') then
    raise exception 'vendor creation requires staff, manager or admin' using errcode = '42501';
  end if;
  if p_key is null then raise exception 'submission key required' using errcode = '23514'; end if;
  if company is null or length(company) not between 1 and 200 then
    raise exception 'vendor company name must be 1 to 200 characters' using errcode = '23514';
  end if;
  if contact is not null and length(contact) > 200 then
    raise exception 'vendor contact name is too long' using errcode = '23514';
  end if;
  if p_phones is not null then
    select array_agg(private.trim_unicode(phone) order by ordinality) into phone_list
      from unnest(p_phones) with ordinality as entry(phone, ordinality);
    if phone_list is null or array_length(phone_list, 1) not between 1 and 5
      or array_position(phone_list, null) is not null
      or exists (
        select 1 from unnest(phone_list) as phone
        where phone = '' or length(phone) > 40
      ) then
      raise exception 'vendor phone strings must be 1 to 40 characters' using errcode = '23514';
    end if;
  end if;
  if mail is not null and (length(mail) > 254
    or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
    raise exception 'vendor email is not valid' using errcode = '23514';
  end if;
  if address is not null and length(address) > 500 then
    raise exception 'vendor source address is too long' using errcode = '23514';
  end if;
  if note is not null and length(note) > 2000 then
    raise exception 'vendor notes are too long' using errcode = '23514';
  end if;
  -- The whole create is one statement: a rejected company, contact block or key leaves no
  -- partial vendor row.
  insert into public.vendors(
    display_name, contact_name, phones, email, source_address, notes, created_by, submission_key
  ) values (
    company, contact, phone_list, mail, address, note, me, p_key
  ) on conflict (created_by, submission_key) do nothing
    returning * into created;
  if created.id is null then
    -- A same-key retry converges on the original identity; reusing the key for different
    -- vendor details is a conflict, never a silent second company.
    select * into existing from public.vendors
      where created_by = me and submission_key = p_key;
    if existing.id is null
      or existing.display_name is distinct from company
      or existing.contact_name is distinct from contact
      or existing.phones is distinct from phone_list
      or existing.email is distinct from mail
      or existing.source_address is distinct from address
      or existing.notes is distinct from note then
      raise exception 'submission key reused with different vendor details' using errcode = '23505';
    end if;
    created := existing;
  end if;
  return jsonb_build_object(
    'id', created.id,
    'display_name', created.display_name,
    'contact_name', created.contact_name,
    'phones', created.phones,
    'email', created.email,
    'source_address', created.source_address,
    'notes', created.notes,
    'created_at', created.created_at);
end;
$$;
revoke all on function private.vendor_phones_ok(text[]), private.guard_vendor_original(),
  private.vendor_search_text(), private.create_vendor(uuid,text,text,text[],text,text,text)
  from public,anon,authenticated;
grant execute on function private.create_vendor(uuid,text,text,text[],text,text,text) to authenticated;

create function public.create_vendor(
  p_key uuid,
  p_display_name text,
  p_contact_name text default null,
  p_phones text[] default null,
  p_email text default null,
  p_source_address text default null,
  p_notes text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.create_vendor(
    p_key, p_display_name, p_contact_name, p_phones, p_email, p_source_address, p_notes);
$$;
revoke all on function public.create_vendor(uuid,text,text,text[],text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_vendor(uuid,text,text,text[],text,text,text) to authenticated;

-- Read paging stays an invoker wrapper so the caller's RLS decides every row. One extra row
-- is returned so the caller can detect a following page; the exposed page is at most 30.
-- `p_query` is a literal, accent-insensitive contiguous fragment over the company or contact
-- name, matching the address-search convention: `%`, `_` and `\` are ordinary characters and
-- a raw query over 120 characters returns no rows (the route rejects it clearly first).
create function public.list_vendors(
  p_query text default null,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 31
) returns table(
  id uuid,
  display_name text,
  contact_name text,
  phones text[],
  email text,
  source_address text,
  notes text,
  created_by uuid,
  created_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  with input as materialized (
    -- The application boundary applies the full Unicode trim used by the create validation;
    -- this SQL wrapper only needs to treat a blank search as "browse everything".
    select nullif(btrim(coalesce(p_query, ''), ' '), '') as query_text
  ), pattern as materialized (
    select '%' || replace(replace(replace(private.normalize_search(i.query_text), chr(92), chr(92) || chr(92)),
      '%', chr(92) || '%'), '_', chr(92) || '_') || '%' as like_pattern
    from input i
  )
  select v.id, v.display_name, v.contact_name, v.phones, v.email, v.source_address, v.notes,
    v.created_by, v.created_at
  from public.vendors v cross join input i cross join pattern p
  where (
      i.query_text is null
      or (length(i.query_text) <= 120 and (
        v.search_text like p.like_pattern escape E'\\'
      ))
    )
    and (
      p_before_created_at is null
      or (p_before_id is not null and (v.created_at, v.id) < (p_before_created_at, p_before_id))
    )
  order by v.created_at desc, v.id desc
  limit least(greatest(coalesce(p_limit, 31), 1), 31);
$$;
revoke all on function public.list_vendors(text,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_vendors(text,timestamptz,uuid,integer) to authenticated;
commit;