-- Ticket #174: sold and rented become a manager decision, recorded on the same trail.
--
-- Additive only: the trail table from #173 gains the request/decision columns, one row carries
-- both the pending request and its outcome, and two new workflow functions replace nothing that
-- an existing caller uses. A decided case therefore stays in the same trail that a direct change
-- lands in, naming who asked and who decided, instead of a second store that would have to be
-- read beside it.
begin;

alter table public.property_status_changes
  -- 'direct' is a change the actor made; 'request' is a sold/rented request awaiting a decision.
  add column origin text not null default 'direct',
  add column state text not null default 'applied',
  add column decided_by uuid references public.employees(id),
  add column decided_by_name text,
  add column decided_at timestamptz,
  add column decision_reason text;
alter table public.property_status_changes
  add constraint property_status_changes_origin_check check (origin in ('direct','request')),
  add constraint property_status_changes_state_check check (state in ('pending','applied','rejected')),
  add constraint property_status_changes_decision_reason_check
    check (decision_reason is null or length(btrim(decision_reason)) between 10 and 2000),
  -- A pending row is a request nobody has decided yet; a decided request always names its decider
  -- and the time, and a rejection always states why. A direct change needs no separate decider:
  -- the actor who made it is the only party.
  add constraint property_status_changes_pending_check
    check (state <> 'pending' or (origin = 'request' and decided_by is null and decided_at is null and decision_reason is null)),
  add constraint property_status_changes_decided_check
    check (origin <> 'request' or state = 'pending' or (decided_by is not null and decided_at is not null)),
  add constraint property_status_changes_rejected_check
    check (state <> 'rejected' or decision_reason is not null);
-- At most one request waits on a property at a time; a second one is refused rather than queued
-- behind a decision nobody has made yet.
create unique index one_pending_status_request on public.property_status_changes(property_id) where state = 'pending';

-- A decided row stays as recorded. Only a pending request may receive its decision, and the
-- change it asked for cannot be rewritten while it waits.
create or replace function private.guard_status_change() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'use the property status workflow' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then raise exception 'status trail rows are retained' using errcode = '42501'; end if;
  if tg_op = 'UPDATE' then
    if old.state <> 'pending' then raise exception 'a decided status change is immutable' using errcode = '42501'; end if;
    if new.state not in ('applied','rejected') then raise exception 'a decision must apply or reject the request' using errcode = '42501'; end if;
    if new.property_id is distinct from old.property_id or new.origin is distinct from old.origin
      or new.from_status is distinct from old.from_status or new.to_status is distinct from old.to_status
      or new.requested_by is distinct from old.requested_by or new.requested_at is distinct from old.requested_at
      or new.note is distinct from old.note then
      raise exception 'a status request keeps the change it asked for' using errcode = '42501';
    end if;
  end if;
  return coalesce(new,old);
end;
$$;

-- One deliberate action, now with a reviewer boundary in the middle: any active employee still
-- sets draft/available/negotiating/withdrawn, a manager or admin sets sold/rented directly, and
-- anyone else asking for sold/rented raises a request instead of changing anything. Either way
-- exactly one row reaches the trail, and the status changes only when the change is applied.
create or replace function private.set_property_status(p_property_id uuid,p_status text,p_note text) returns jsonb
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
  select status,archived_at into current_status,archived from public.properties where id = p_property_id for update;
  if not found then raise exception 'property not found' using errcode = 'P0002'; end if;
  if archived is not null then raise exception 'an archived record cannot change status' using errcode = 'P0017'; end if;
  if current_status = p_status then raise exception 'status is unchanged' using errcode = 'P0030'; end if;
  if p_status in ('sold','rented') and not private.is_reviewer() then
    begin
      insert into public.property_status_changes(property_id,origin,state,from_status,to_status,requested_by,requested_by_name,note)
        select p_property_id,'request','pending',current_status,p_status,me,e.display_name,note_text
        from public.employees e where e.id = me
        returning * into change;
    exception when unique_violation then
      raise exception 'a status change is already awaiting review' using errcode = 'P0027';
    end;
    return to_jsonb(change);
  end if;
  insert into public.property_status_changes(property_id,origin,state,from_status,to_status,requested_by,requested_by_name,note)
    select p_property_id,'direct','applied',current_status,p_status,me,e.display_name,note_text
    from public.employees e where e.id = me
    returning * into change;
  update public.properties set status = p_status where id = p_property_id;
  return to_jsonb(change);
end;
$$;

-- The reviewer's decision on a pending request: the parent property row is locked first, then the
-- request, the decision is written on the same row, and an approval applies the status in the same
-- transaction. An approval refuses when the record has moved on since the request was raised,
-- instead of applying a status nobody is looking at any more.
create function private.decide_status_request(p_change_id uuid,p_approve boolean,p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  decider_name text;
  reason text := btrim(coalesce(p_reason,''));
  property uuid;
  change public.property_status_changes;
  current_status text;
  archived timestamptz;
begin
  if me is null or not private.is_reviewer() then
    raise exception 'manager or admin required' using errcode = '42501';
  end if;
  if p_change_id is null or p_approve is null then raise exception 'request and decision required' using errcode = '22023'; end if;
  if length(reason) not between 10 and 2000 then
    raise exception 'a decision reason between 10 and 2,000 characters is required' using errcode = '22023';
  end if;
  select property_id into property from public.property_status_changes where id = p_change_id;
  if not found then raise exception 'status request not found' using errcode = 'P0002'; end if;
  select status,archived_at into current_status,archived from public.properties where id = property for update;
  if not found then raise exception 'property not found' using errcode = 'P0002'; end if;
  select * into change from public.property_status_changes where id = p_change_id for update;
  if not found then raise exception 'status request not found' using errcode = 'P0002'; end if;
  if change.state <> 'pending' then raise exception 'this status request is already decided' using errcode = 'P0028'; end if;
  if change.requested_by = me then raise exception 'a status request cannot be decided by its requester' using errcode = '42501'; end if;
  select display_name into decider_name from public.employees where id = me;
  if p_approve then
    if archived is not null then raise exception 'an archived record cannot change status' using errcode = 'P0017'; end if;
    if current_status is distinct from change.from_status then
      raise exception 'the property status changed after this request was raised' using errcode = 'P0029';
    end if;
    update public.property_status_changes
      set state = 'applied',decided_by = me,decided_by_name = decider_name,
        decided_at = clock_timestamp(),decision_reason = reason
      where id = p_change_id returning * into change;
    update public.properties set status = change.to_status where id = property;
  else
    update public.property_status_changes
      set state = 'rejected',decided_by = me,decided_by_name = decider_name,
        decided_at = clock_timestamp(),decision_reason = reason
      where id = p_change_id returning * into change;
  end if;
  return to_jsonb(change);
end;
$$;
create function public.decide_status_request(p_change_id uuid,p_approve boolean,p_reason text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.decide_status_request(p_change_id,p_approve,p_reason);
$$;

revoke all on function private.decide_status_request(uuid,boolean,text),public.decide_status_request(uuid,boolean,text)
  from public,anon,authenticated;
grant execute on function private.decide_status_request(uuid,boolean,text) to authenticated;
grant execute on function public.decide_status_request(uuid,boolean,text) to authenticated;
commit;
