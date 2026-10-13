-- Issue #66: deactivate a linked employee without losing the record.
-- Membership is disabled first, the exact Auth sign-in block is confirmed separately through
-- a server-only provider adapter, and an unconfirmed provider outcome leaves a truthful
-- reconciliation state instead of claiming completed deactivation. Attribution, locale,
-- business history and the restrictive Auth link are never rewritten.
begin;

-- 1. Durable administration operation. One row per attempted deactivation carries the
--    employee/actor attribution, the submission identity, a monotonic revision and the
--    provider reconciliation state. Deleting or rewriting it is refused by its guard.
create table public.employee_admin_operations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  actor_id uuid not null references public.employees(id),
  kind text not null check (kind = 'deactivate'),
  idempotency_key uuid not null,
  state text not null default 'provider_pending' check (state in ('provider_pending','provider_failed','completed')),
  revision integer not null default 1 check (revision > 0),
  provider_outcome text check (provider_outcome in ('blocked','failed','ambiguous')),
  provider_reference text,
  provider_user_id uuid,
  provider_detail text,
  provider_ban_until timestamptz,
  provider_attempted_at timestamptz,
  membership_disabled_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (actor_id, idempotency_key),
  check ((state = 'completed') = (completed_at is not null)),
  check (case state
    when 'provider_pending' then provider_outcome is null
    when 'provider_failed' then provider_outcome in ('failed','ambiguous')
    else provider_outcome = 'blocked'
  end is true),
  check (state <> 'completed' or provider_reference is not null),
  check (state <> 'completed' or provider_ban_until is not null),
  check (provider_detail is null or length(provider_detail) between 1 and 500),
  check (provider_reference is null or length(btrim(provider_reference)) between 1 and 200)
);
comment on table public.employee_admin_operations is 'Retained employee administration operations. Membership becomes disabled at begin; completed is written only after a confirmed provider sign-in block.';
comment on column public.employee_admin_operations.revision is 'Monotonic operation revision; a provider reconciliation must present the current revision';
comment on column public.employee_admin_operations.provider_ban_until is 'Ban expiry reported by the sign-in provider; the block is finite and renewed only by an explicit retry, never claimed as infinite';
comment on column public.employee_admin_operations.provider_user_id is 'The exact Auth sign-in identity the confirmed provider block applies to';
-- At most one open operation per employee; a completed operation stays as history and a later
-- reactivation/deactivation starts a new one.
create unique index employee_admin_operations_open_idx
  on public.employee_admin_operations(employee_id) where state <> 'completed';

-- 2. Append-only evidence for every operation step, including who resumed it.
create table public.employee_admin_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.employee_admin_operations(id),
  employee_id uuid not null references public.employees(id),
  actor_id uuid not null references public.employees(id),
  action text not null check (action in ('begun','resumed','provider_blocked','provider_failed','provider_ambiguous')),
  detail text check (detail is null or length(detail) between 1 and 500),
  created_at timestamptz not null default clock_timestamp()
);
comment on table public.employee_admin_events is 'Append-only employee administration evidence; direct client writes are refused and the rows are never deleted';

-- 3. Retention guards. The guarded definers run as their owner, so they may write; every
--    client role and every direct write path is refused, and identity fields are immutable.
create function private.guard_employee_admin_operations() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'employee administration operations are retained' using errcode = '23514';
  end if;
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'employee administration operations use the guarded RPCs' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.employee_id is distinct from old.employee_id
      or new.actor_id is distinct from old.actor_id
      or new.kind is distinct from old.kind
      or new.idempotency_key is distinct from old.idempotency_key
      or new.membership_disabled_at is distinct from old.membership_disabled_at
      or new.created_at is distinct from old.created_at
      or (old.completed_at is not null and new.completed_at is not null)
    then raise exception 'operation identity and history are immutable' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create function private.guard_employee_admin_events() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' or current_user in ('anon','authenticated','service_role') then
    raise exception 'employee administration evidence is append-only through the guarded RPCs' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger employee_admin_operations_guard before insert or update or delete on public.employee_admin_operations
  for each row execute function private.guard_employee_admin_operations();
create trigger employee_admin_events_guard before insert or update or delete on public.employee_admin_events
  for each row execute function private.guard_employee_admin_events();

-- 4. Last-active-admin protection. The trigger sees every writer, including service_role and
--    the administrative worker's own administrative connection, so a direct lifecycle, link
--    or role write cannot remove the final active admin. The advisory lock serializes the
--    check across concurrent removals of different admins.
create function private.guard_employee_admin_state() returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  was_active_admin boolean := false;
  is_active_admin boolean := false;
  target_id uuid;
begin
  if tg_op = 'DELETE' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'employee lifecycle changes use the guarded RPCs' using errcode = '42501';
    end if;
    was_active_admin := old.role = 'admin' and old.is_active;
    target_id := old.id;
  elsif tg_op = 'UPDATE' then
    if current_user in ('anon','authenticated','service_role')
      and (new.is_active is distinct from old.is_active
        or new.auth_user_id is distinct from old.auth_user_id
        or new.role is distinct from old.role)
    then
      raise exception 'employee lifecycle, sign-in link and role changes use the guarded RPCs' using errcode = '42501';
    end if;
    was_active_admin := old.role = 'admin' and old.is_active;
    is_active_admin := new.role = 'admin' and new.is_active;
    target_id := old.id;
  else
    return new;
  end if;
  if was_active_admin and not is_active_admin then
    perform pg_advisory_xact_lock(hashtextextended('public.employees:last-active-admin',0));
    if not exists (
      select 1 from public.employees
      where id <> target_id and role = 'admin' and is_active
    ) then
      raise exception 'the last active admin cannot be deactivated, demoted or removed' using errcode = 'P0010';
    end if;
  end if;
  return coalesce(new,old);
end;
$$;
create trigger employee_admin_state_guard before insert or update or delete on public.employees
  for each row execute function private.guard_employee_admin_state();

-- 5. Projection shared by both guarded RPCs.
create function private.employee_admin_operation_json(op public.employee_admin_operations)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',op.id,'employeeId',op.employee_id,'actorId',op.actor_id,'kind',op.kind,
    'state',op.state,'revision',op.revision,'providerOutcome',op.provider_outcome,
    'providerReference',op.provider_reference,'providerDetail',op.provider_detail,
    'providerBanUntil',op.provider_ban_until,'providerAttemptedAt',op.provider_attempted_at,
    'membershipDisabledAt',op.membership_disabled_at,'completedAt',op.completed_at,
    'createdAt',op.created_at,'updatedAt',op.updated_at);
$$;

-- 6. Begin (or resume) the deactivation. Membership is disabled here, before any provider
--    call; the same actor/key converges on the original operation and a different payload
--    under the same key is a conflict. Any currently authorized admin may resume an open
--    operation, and its original attribution is never rewritten.
create function private.begin_employee_deactivation(p_employee_id uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.employees;
  existing public.employee_admin_operations;
  op public.employee_admin_operations;
begin
  if me is null or private.employee_role() is distinct from 'admin' then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_employee_id is null or p_key is null then
    raise exception 'employee and submission key required' using errcode = '23514';
  end if;
  -- Serialize open-operation identity per employee, then take the target row before the
  -- operation row so every writer follows the same order.
  perform pg_advisory_xact_lock(hashtextextended('public.employee_admin_operations:'||p_employee_id::text,0));
  select * into target from public.employees where id = p_employee_id for update;
  if target.id is null then raise exception 'employee not found' using errcode = 'P0011'; end if;
  if target.auth_user_id is null then
    raise exception 'employee has no linked sign-in identity' using errcode = 'P0011';
  end if;
  select * into existing from public.employee_admin_operations
    where actor_id = me and idempotency_key = p_key for update;
  if existing.id is not null then
    if existing.employee_id <> p_employee_id or existing.kind <> 'deactivate' then
      raise exception 'submission key reused for a different employee or action' using errcode = '23505';
    end if;
    return private.employee_admin_operation_json(existing);
  end if;
  select * into existing from public.employee_admin_operations
    where employee_id = p_employee_id and state <> 'completed' for update;
  if existing.id is not null then
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action)
      values(existing.id,p_employee_id,me,'resumed');
    return private.employee_admin_operation_json(existing);
  end if;
  if not target.is_active then
    raise exception 'employee access is already inactive' using errcode = 'P0011';
  end if;
  insert into public.employee_admin_operations(employee_id,actor_id,kind,idempotency_key)
    values(p_employee_id,me,'deactivate',p_key) returning * into op;
  insert into public.employee_admin_events(operation_id,employee_id,actor_id,action)
    values(op.id,p_employee_id,me,'begun');
  -- The last-active-admin guard runs inside this statement; a refused removal rolls the
  -- whole transaction back, so no open operation is left claiming membership was disabled.
  update public.employees set is_active = false where id = p_employee_id;
  return private.employee_admin_operation_json(op);
end;
$$;

-- 7. Record the provider outcome. Server-only: the reconciliation caller is the trusted
--    server adapter, so default EXECUTE is granted to service_role alone. A confirmed block
--    needs the provider reference and ban expiry; an identical confirmed retry converges and
--    a completed operation stays terminal.
create function private.record_employee_deactivation_result(
  p_operation_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_auth_user_id uuid,
  p_outcome text,
  p_provider_reference text default null,
  p_detail text default null,
  p_ban_until timestamptz default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  op public.employee_admin_operations;
  outcome text := lower(btrim(coalesce(p_outcome,'')));
  detail text := nullif(btrim(coalesce(p_detail,'')),'');
  reference text := nullif(btrim(coalesce(p_provider_reference,'')),'');
  current_link uuid;
begin
  if p_operation_id is null or p_revision is null or p_actor_id is null or p_auth_user_id is null then
    raise exception 'operation, revision, actor and sign-in identity required' using errcode = '23514';
  end if;
  if outcome not in ('blocked','failed','ambiguous') then
    raise exception 'invalid provider outcome' using errcode = '23514';
  end if;
  if detail is not null and length(detail) > 500 then
    raise exception 'provider detail is too long' using errcode = '23514';
  end if;
  if not exists (select 1 from public.employees where id = p_actor_id) then
    raise exception 'recording actor not found' using errcode = '23514';
  end if;
  select * into op from public.employee_admin_operations where id = p_operation_id;
  if op.id is null then raise exception 'operation not found' using errcode = 'P0012'; end if;
  -- Lock the employee row before the operation row, matching begin's order.
  select e.auth_user_id into current_link from public.employees e where e.id = op.employee_id for update;
  if not found then raise exception 'employee not found' using errcode = 'P0012'; end if;
  select * into op from public.employee_admin_operations where id = p_operation_id for update;
  if op.state = 'completed' then
    if outcome = 'blocked' and reference is not null and reference = op.provider_reference
      and p_auth_user_id = op.provider_user_id then
      return private.employee_admin_operation_json(op);
    end if;
    raise exception 'operation already completed' using errcode = 'P0012';
  end if;
  if op.revision is distinct from p_revision then
    raise exception 'stale operation revision; reload current state' using errcode = 'PT409';
  end if;
  if current_link is null or current_link is distinct from p_auth_user_id then
    raise exception 'employee sign-in link changed; restart deactivation' using errcode = 'P0012';
  end if;
  if outcome = 'blocked' then
    if reference is null or p_ban_until is null then
      raise exception 'confirmed block requires the provider reference and ban expiry' using errcode = '23514';
    end if;
    update public.employee_admin_operations set
      state = 'completed', revision = revision + 1, completed_at = clock_timestamp(),
      provider_outcome = 'blocked', provider_reference = reference,
      provider_user_id = p_auth_user_id, provider_detail = detail,
      provider_ban_until = p_ban_until, provider_attempted_at = clock_timestamp(),
      updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'provider_blocked',detail);
  elsif outcome = 'failed' then
    update public.employee_admin_operations set
      state = 'provider_failed', revision = revision + 1, provider_outcome = 'failed',
      provider_reference = reference, provider_detail = detail,
      provider_attempted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'provider_failed',detail);
  else
    update public.employee_admin_operations set
      state = 'provider_failed', revision = revision + 1, provider_outcome = 'ambiguous',
      provider_reference = reference, provider_detail = detail,
      provider_attempted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'provider_ambiguous',detail);
  end if;
  return private.employee_admin_operation_json(op);
end;
$$;

-- 8. Public wrappers. Begin is an invoker wrapper for live admins; the provider result is
--    invoker as well but executable only by the trusted server (service_role).
create function public.begin_employee_deactivation(p_employee_id uuid,p_key uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.begin_employee_deactivation(p_employee_id,p_key);
$$;
create function public.record_employee_deactivation_result(
  p_operation_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_auth_user_id uuid,
  p_outcome text,
  p_provider_reference text default null,
  p_detail text default null,
  p_ban_until timestamptz default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_employee_deactivation_result(p_operation_id,p_revision,p_actor_id,p_auth_user_id,p_outcome,p_provider_reference,p_detail,p_ban_until);
$$;

-- 9. Explicit access. Neither table accepts a client write, and reads are live-admin only.
alter table public.employee_admin_operations enable row level security;
alter table public.employee_admin_events enable row level security;
revoke all on public.employee_admin_operations from public, anon, authenticated, service_role;
revoke all on public.employee_admin_events from public, anon, authenticated, service_role;
grant select on public.employee_admin_operations to authenticated;
grant select on public.employee_admin_events to authenticated;
create policy employee_admin_operations_read on public.employee_admin_operations for select to authenticated
  using (private.employee_role() = 'admin');
create policy employee_admin_events_read on public.employee_admin_events for select to authenticated
  using (private.employee_role() = 'admin');

revoke all on function private.guard_employee_admin_operations(),private.guard_employee_admin_events(),
  private.guard_employee_admin_state(),private.employee_admin_operation_json(public.employee_admin_operations),
  private.begin_employee_deactivation(uuid,uuid),
  private.record_employee_deactivation_result(uuid,integer,uuid,uuid,text,text,text,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.begin_employee_deactivation(uuid,uuid) to authenticated;
revoke all on function public.begin_employee_deactivation(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_employee_deactivation(uuid,uuid) to authenticated;
-- The reconciliation boundary is server-only: no authenticated client can claim provider
-- acceptance. The private schema stays unexposed; service_role is the trusted server adapter.
grant usage on schema private to service_role;
grant execute on function private.record_employee_deactivation_result(uuid,integer,uuid,uuid,text,text,text,timestamptz) to service_role;
revoke all on function public.record_employee_deactivation_result(uuid,integer,uuid,uuid,text,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_employee_deactivation_result(uuid,integer,uuid,uuid,text,text,text,timestamptz) to service_role;

-- 10. Retained evidence participates in the existing private audit trail.
create trigger audit_employee_admin_operations after insert or update or delete on public.employee_admin_operations
  for each row execute function private.audit_change();
create trigger audit_employee_admin_events after insert or update or delete on public.employee_admin_events
  for each row execute function private.audit_change();
commit;
