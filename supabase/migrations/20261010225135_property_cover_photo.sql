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
-- This invoker trigger allows the definer RPC by checking a session variable
-- set by the RPC before the UPDATE/INSERT.
create function private.guard_property_cover() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null
     and new.cover_file_id is distinct from old.cover_file_id
     and current_setting('app.cover_authorized', true) != coalesce(new.cover_file_id::text, 'null')
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
create function private.set_property_cover(p_property_id uuid, p_file_id uuid)
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
    perform set_config('app.cover_authorized', 'null', true);
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
    if f.validated_at is null then
      raise exception 'cover requires a validated file' using errcode = '23514';
    end if;
    perform set_config('app.cover_authorized', p_file_id::text, true);
    update public.properties set cover_file_id = p_file_id where id = p_property_id;
  end if;
end;
$$;
revoke all on function private.set_property_cover(uuid,uuid) from public,anon,authenticated;

-- 4. Public invoker wrapper
create function public.set_property_cover(p_property_id uuid, p_file_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.set_property_cover(p_property_id, p_file_id);
$$;

-- 5. Grants
grant execute on function private.set_property_cover(uuid,uuid) to authenticated;
revoke all on function public.set_property_cover(uuid,uuid) from public,anon;
grant execute on function public.set_property_cover(uuid,uuid) to authenticated;

commit;
