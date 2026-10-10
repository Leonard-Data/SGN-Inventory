-- Ticket #27: Property cover photo.
-- Add nullable cover_file_id to properties, guard direct UPDATE of cover,
-- provide invoker RPCs for authorized editors to set/clear the cover.
-- Cover requires a completed (validated) Property-photo on the same property.
begin;

-- 1. Add cover_file_id column to properties
alter table public.properties add column cover_file_id uuid references public.property_files(id);
comment on column public.properties.cover_file_id is 'Nullable explicit cover photo. Only a completed Property-photo on the same property is eligible. Set/clear via set_property_cover / clear_property_cover RPCs only.';

-- 2. Guard direct UPDATE of cover_file_id on properties
-- The existing property_guard trigger handles created_by/updated_by/review/legal-status/archived.
-- We add a separate before-update trigger that rejects client attempts to change cover_file_id directly.
create function private.guard_property_cover() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.cover_file_id is distinct from old.cover_file_id then
    raise exception 'cover_file_id is set/cleared only through set_property_cover RPC' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_property_cover() from public,anon,authenticated;
create trigger property_cover_guard before update on public.properties for each row execute function private.guard_property_cover();

-- 3. Private definer: set_property_cover
create function private.set_property_cover(p_property_id uuid, p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  prop_st text;
  f public.property_files;
begin
  -- Active employee
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  -- Unarchived property, lock parent row
  select status into prop_st from public.properties where id = p_property_id and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  -- Editor authority: sales own, or staff/manager/admin
  if not exists (
    select 1 from public.properties where id = p_property_id
      and (created_by = me or private.employee_role() in ('staff','manager','admin'))
  ) then
    raise exception 'property edit authority required' using errcode = '42501';
  end if;
  -- File belongs to this property, is a completed (validated) photo
  select * into f from public.property_files where id = p_file_id for update;
  if not found then raise exception 'file not found' using errcode = '42501'; end if;
  if f.property_id is distinct from p_property_id then
    raise exception 'file must belong to this property' using errcode = '42501';
  end if;
  if f.purpose is distinct from 'photo' then
    raise exception 'cover requires a Property photo purpose' using errcode = '23514';
  end if;
  if f.upload_status is distinct from 'ready' or f.validated_at is null then
    raise exception 'cover requires a completed validated file' using errcode = '23514';
  end if;
  -- Set the cover (replaces any existing cover)
  update public.properties set cover_file_id = p_file_id where id = p_property_id;
end;
$$;
revoke all on function private.set_property_cover(uuid,uuid) from public,anon,authenticated;

-- 4. Private definer: clear_property_cover
create function private.clear_property_cover(p_property_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  prop_st text;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  select status into prop_st from public.properties where id = p_property_id and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.properties where id = p_property_id
      and (created_by = me or private.employee_role() in ('staff','manager','admin'))
  ) then
    raise exception 'property edit authority required' using errcode = '42501';
  end if;
  update public.properties set cover_file_id = null where id = p_property_id;
end;
$$;
revoke all on function private.clear_property_cover(uuid) from public,anon,authenticated;

-- 5. Public invoker wrappers
create function public.set_property_cover(p_property_id uuid, p_file_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.set_property_cover(p_property_id, p_file_id);
$$;

create function public.clear_property_cover(p_property_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.clear_property_cover(p_property_id);
$$;

-- 6. Grant EXECUTE to authenticated for private definers and public wrappers
grant execute on function private.set_property_cover(uuid,uuid) to authenticated;
grant execute on function private.clear_property_cover(uuid) to authenticated;
revoke all on function public.set_property_cover(uuid,uuid),public.clear_property_cover(uuid) from public,anon;
grant execute on function public.set_property_cover(uuid,uuid),public.clear_property_cover(uuid) to authenticated;

commit;
