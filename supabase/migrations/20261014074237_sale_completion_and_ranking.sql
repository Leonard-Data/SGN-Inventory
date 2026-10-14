-- Issue #38: versioned logical sale completion and completed-sale ranking.
-- One explicitly confirmed completion per sold property, decided by a manager/admin other than
-- the credited employee; the property is marked sold and its open reservations close with
-- retained events in the same transaction. Rankings derive from these recorded facts only.
begin;

create table public.sale_completions (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  credited_employee_id uuid not null references public.employees(id),
  completed_on date not null,
  reference text not null check (length(btrim(reference)) between 1 and 200),
  previous_status text not null check (previous_status in ('available','negotiating')),
  version integer not null default 1 check (version > 0),
  confirmed_by uuid not null references public.employees(id),
  confirmed_at timestamptz not null default now(),
  idempotency_key uuid not null,
  reversed_at timestamptz,
  reversed_by uuid references public.employees(id),
  reversal_reason text,
  unique (confirmed_by, idempotency_key),
  check (confirmed_by <> credited_employee_id),
  check ((reversed_at is null) = (reversed_by is null)),
  check (reversed_at is null or length(btrim(coalesce(reversal_reason,''))) between 10 and 2000)
);
-- One logical completion per property for as long as it stands; a later reversal is the only
-- way to retire it, and the reversal contract itself belongs to the correction ticket.
create unique index one_effective_sale_completion on public.sale_completions(property_id) where reversed_at is null;
create index sale_completions_ranking_idx on public.sale_completions(completed_on,credited_employee_id) where reversed_at is null;
create index sale_completions_property_idx on public.sale_completions(property_id);

alter table public.property_locks drop constraint property_locks_status_check;
alter table public.property_locks add constraint property_locks_status_check
  check (status in ('pending','approved','rejected','released','expired','closed_by_sale'));
alter table public.lock_events drop constraint lock_events_action_check;
alter table public.lock_events add constraint lock_events_action_check
  check (action in ('requested','approved','rejected','released','expired','sale_completed'));

-- Completions are written only through the guarded RPC below; no client or service write path.
create function private.guard_sale_completion() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'use the sale completion RPC' using errcode = '42501';
  end if;
  return coalesce(new,old);
end;
$$;
create trigger sale_completion_guard before insert or update or delete on public.sale_completions
  for each row execute function private.guard_sale_completion();

create function private.complete_sale(p_property_id uuid,p_credited_employee_id uuid,p_completed_on date,p_reference text,p_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  reference text := btrim(coalesce(p_reference,''));
  prior public.sale_completions;
  prop_status text;
  new_id uuid;
  r record;
begin
  if me is null or not private.is_reviewer() then raise exception 'manager or admin required' using errcode = '42501'; end if;
  if p_property_id is null or p_credited_employee_id is null or p_completed_on is null or p_key is null
    or length(reference) not between 1 and 200 then
    raise exception 'property, credited employee, actual completion date, nonblank reference and retry key required' using errcode = '22023';
  end if;
  if p_credited_employee_id = me then raise exception 'the credited employee cannot confirm their own sale' using errcode = 'P0004'; end if;
  if p_completed_on > (now() at time zone 'Asia/Ho_Chi_Minh')::date then
    raise exception 'completion date cannot be in the future' using errcode = 'P0007';
  end if;
  -- Recover an interrupted response before any state work, so a retry converges even after the
  -- committed sale moved the property on. The property lock below is the authoritative order.
  select * into prior from public.sale_completions where confirmed_by = me and idempotency_key = p_key;
  if found then
    if prior.property_id is distinct from p_property_id or prior.credited_employee_id is distinct from p_credited_employee_id
      or prior.completed_on is distinct from p_completed_on or prior.reference is distinct from reference then
      raise exception 'retry key reused for a different sale completion' using errcode = 'P0006';
    end if;
    return prior.id;
  end if;
  -- Parent property row first, then reservations, matching the established lock order.
  select status into prop_status from public.properties where id = p_property_id and archived_at is null for update;
  if not found then raise exception 'property not found or archived' using errcode = 'P0005'; end if;
  -- Re-check under the parent lock so two concurrent identical retries converge on one row.
  select * into prior from public.sale_completions where confirmed_by = me and idempotency_key = p_key;
  if found then
    if prior.property_id is distinct from p_property_id or prior.credited_employee_id is distinct from p_credited_employee_id
      or prior.completed_on is distinct from p_completed_on or prior.reference is distinct from reference then
      raise exception 'retry key reused for a different sale completion' using errcode = 'P0006';
    end if;
    return prior.id;
  end if;
  if not exists (select 1 from public.employees where id = p_credited_employee_id) then
    raise exception 'credited employee not found' using errcode = '22023';
  end if;
  -- An activated rental commitment blocks the sale before the status check, because an
  -- active agreement always holds the property in 'rented'.
  if exists (select 1 from public.rental_agreements where property_id = p_property_id and status = 'active') then
    raise exception 'an active rental blocks sale completion' using errcode = 'P0002';
  end if;
  if prop_status not in ('available','negotiating') then
    raise exception 'property is not available or negotiating' using errcode = 'P0005';
  end if;
  perform private.expire_property_locks(p_property_id);
  if exists (select 1 from public.property_locks
      where property_id = p_property_id and status = 'approved' and requested_by <> p_credited_employee_id) then
    raise exception 'release the effective reservation of another employee first' using errcode = 'P0003';
  end if;
  begin
    insert into public.sale_completions(property_id,credited_employee_id,completed_on,reference,previous_status,confirmed_by,idempotency_key)
      values(p_property_id,p_credited_employee_id,p_completed_on,reference,prop_status,me,p_key)
      returning id into new_id;
  exception when unique_violation then
    select * into prior from public.sale_completions where confirmed_by = me and idempotency_key = p_key;
    if not found then raise; end if;
    if prior.property_id is distinct from p_property_id or prior.credited_employee_id is distinct from p_credited_employee_id
      or prior.completed_on is distinct from p_completed_on or prior.reference is distinct from reference then
      raise exception 'retry key reused for a different sale completion' using errcode = 'P0006';
    end if;
    return prior.id;
  end;
  -- Close every open reservation with a retained event; the original claimant, reason and
  -- earlier decision events stay untouched.
  for r in update public.property_locks set status = 'closed_by_sale'
    where property_id = p_property_id and status in ('pending','approved') returning id
  loop
    insert into public.lock_events(lock_id,actor_id,action,reason)
      values(r.id,me,'sale_completed','Sale completion recorded');
  end loop;
  update public.properties set status = 'sold' where id = p_property_id;
  return new_id;
end;
$$;
create function public.complete_property_sale(p_property_id uuid,p_credited_employee_id uuid,p_completed_on date,p_reference text,p_key uuid)
returns uuid language sql security invoker set search_path = '' as $$
  select private.complete_sale(p_property_id,p_credited_employee_id,p_completed_on,p_reference,p_key);
$$;

create function private.completed_sale_ranking(p_from date,p_to date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  rows jsonb;
  total bigint;
  unknown_count bigint;
begin
  if not private.is_reviewer() then raise exception 'manager or admin required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 365 then
    raise exception 'valid inclusive Vietnam date range required' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'employeeId',employee_id,'employeeName',employee_name,'completedSales',completed_sales,'rank',ranked.rank
    ) order by completed_sales desc,employee_name,employee_id),'[]'::jsonb)
  into rows
  from (
    select e.id as employee_id,e.display_name as employee_name,count(c.id) as completed_sales,
      rank() over (order by count(c.id) desc) as rank
    from public.sale_completions c join public.employees e on e.id = c.credited_employee_id
    where c.reversed_at is null and c.completed_on between p_from and p_to
    group by e.id,e.display_name
  ) ranked;
  select count(*) into total from public.sale_completions
    where reversed_at is null and completed_on between p_from and p_to;
  -- Sold properties with no logical completion are genuinely unknown legacy attribution:
  -- they are counted separately and never assigned to a guessed employee.
  select count(*) into unknown_count from public.properties p
    where p.status = 'sold' and p.archived_at is null
      and not exists (select 1 from public.sale_completions c where c.property_id = p.id and c.reversed_at is null);
  return jsonb_build_object('rows',rows,'totalCompletedSales',total,'unknownAttribution',unknown_count);
end;
$$;
create function public.completed_sale_ranking(p_from date,p_to date) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select private.completed_sale_ranking(p_from,p_to);
$$;

alter table public.sale_completions enable row level security;
revoke all on public.sale_completions from public,anon,authenticated,service_role;
grant select on public.sale_completions to authenticated;
create policy sale_completions_read on public.sale_completions for select to authenticated using (private.is_reviewer());
create trigger audit_sale_completions after insert or update or delete on public.sale_completions
  for each row execute function private.audit_change();

revoke all on function private.guard_sale_completion(),private.complete_sale(uuid,uuid,date,text,uuid),private.completed_sale_ranking(date,date)
  from public,anon,authenticated;
grant execute on function private.complete_sale(uuid,uuid,date,text,uuid),private.completed_sale_ranking(date,date) to authenticated;
revoke all on function public.complete_property_sale(uuid,uuid,date,text,uuid),public.completed_sale_ranking(date,date) from public,anon;
grant execute on function public.complete_property_sale(uuid,uuid,date,text,uuid),public.completed_sale_ranking(date,date) to authenticated;
commit;
