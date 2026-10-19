-- Ticket #173: a property status change is recorded on its own trail.
--
-- Additive only: one new table, one new recorder trigger on `properties` and one new workflow
-- function. No existing table, column, policy, grant or function is changed, so sold and rented
-- stay refused to a non-reviewer exactly as before, and `property_history` stays price-only.
begin;

-- One row is one recorded status change: the actor who made it, the status it left and reached,
-- when, and the optional note the actor typed.
create table public.property_status_changes (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  from_status text not null check (from_status in ('draft','available','negotiating','sold','rented','withdrawn')),
  to_status text not null check (to_status in ('draft','available','negotiating','sold','rented','withdrawn')),
  requested_by uuid not null references public.employees(id),
  requested_by_name text not null,
  -- When the change was made; ticket #174 gives the same column the moment a request was raised.
  requested_at timestamptz not null default clock_timestamp(),
  note text check (note is null or length(btrim(note)) between 1 and 500),
  check (from_status <> to_status)
);
create index property_status_changes_page_idx on public.property_status_changes(property_id,requested_at,id);

alter table public.property_status_changes enable row level security;
revoke all on public.property_status_changes from public,anon,authenticated,service_role;
grant select on public.property_status_changes to authenticated;
-- Reads follow the property itself: an employee who can read the record can read its trail,
-- including the reviewer-only archived boundary the property read already applies.
create policy status_changes_read on public.property_status_changes for select to authenticated using (
  private.employee_id() is not null and exists (select 1 from public.properties p where p.id = property_id)
);

-- Writes never come from a browser role, and a recorded change is never rewritten or deleted.
create function private.guard_status_change() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'use the property status workflow' using errcode = '42501';
  end if;
  if tg_op <> 'INSERT' then raise exception 'status trail rows are retained' using errcode = '42501'; end if;
  return new;
end;
$$;
create trigger status_change_guard before insert or update or delete on public.property_status_changes
  for each row execute function private.guard_status_change();
revoke all on function private.guard_status_change() from public,anon,authenticated;

-- Every status transition on the record is recorded, whichever workflow made it (maintenance, an
-- applied correction, a rental activation or a confirmed sale). The workflow function below writes
-- its own row first so the note and the actor travel with it; this recorder then stays out of the
-- way because a row for this property already exists in the same transaction.
create function private.record_status_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id();
begin
  if me is null then return null; end if;
  if exists (select 1 from public.property_status_changes c
      where c.property_id = new.id and c.xmin = pg_current_xact_id()::xid) then
    return null;
  end if;
  insert into public.property_status_changes(property_id,from_status,to_status,requested_by,requested_by_name)
    select new.id,old.status,new.status,me,e.display_name from public.employees e where e.id = me;
  return null;
end;
$$;
create trigger property_status_change after update on public.properties
  for each row when (old.status is distinct from new.status) execute function private.record_status_change();
revoke all on function private.record_status_change() from public,anon,authenticated;

-- One deliberate action: any active employee sets draft/available/negotiating/withdrawn with an
-- optional note. The parent property row is locked first, the trail row is appended, and the
-- status is applied in the same transaction. Sold and rented keep their existing authority: an
-- ordinary employee is refused before anything is written.
create function private.set_property_status(p_property_id uuid,p_status text,p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  note_text text := nullif(btrim(coalesce(p_note,'')),'');
  current_status text;
  archived timestamptz;
  change public.property_status_changes;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_property_id is null or p_status is null
    or p_status not in ('draft','available','negotiating','sold','rented','withdrawn') then
    raise exception 'unknown property status' using errcode = '22023';
  end if;
  if p_note is not null and length(btrim(p_note)) > 500 then
    raise exception 'note is limited to 500 characters' using errcode = '22023';
  end if;
  if p_status in ('sold','rented') and not private.is_reviewer() then
    raise exception 'reviewer required for final status' using errcode = '42501';
  end if;
  select status,archived_at into current_status,archived from public.properties where id = p_property_id for update;
  if not found then raise exception 'property not found' using errcode = 'P0002'; end if;
  if archived is not null then raise exception 'an archived record cannot change status' using errcode = 'P0017'; end if;
  if current_status = p_status then raise exception 'status is unchanged' using errcode = 'P0030'; end if;
  insert into public.property_status_changes(property_id,from_status,to_status,requested_by,requested_by_name,note)
    select p_property_id,current_status,p_status,me,e.display_name,note_text from public.employees e where e.id = me
    returning * into change;
  update public.properties set status = p_status where id = p_property_id;
  return to_jsonb(change);
end;
$$;
create function public.set_property_status(p_property_id uuid,p_status text,p_note text default null)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.set_property_status(p_property_id,p_status,p_note);
$$;

revoke all on function private.set_property_status(uuid,text,text),public.set_property_status(uuid,text,text)
  from public,anon,authenticated;
-- The public wrapper is an invoker function, so the caller also needs the private function it
-- calls; the private one stays unexposed as an API surface of its own.
grant execute on function private.set_property_status(uuid,text,text) to authenticated;
grant execute on function public.set_property_status(uuid,text,text) to authenticated;
commit;
