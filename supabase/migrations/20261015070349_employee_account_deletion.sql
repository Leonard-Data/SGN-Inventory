-- Issue #67: permanently delete an employee's sign-in account while retaining the employee.
-- Deletion is the second employee-administration kind on the operation ledger from #66. It
-- disables membership and unlinks the sign-in identity -- the existing employee-to-Auth
-- foreign key is `on delete restrict`, so the link must be gone before the provider can
-- delete the account -- and completes only after the provider account is confirmed absent.
-- The retained Employee row, its UUID/name, every business foreign key and every uploader
-- attribution are never rewritten, repointed or erased; the historical Auth identifier stays
-- on the operation as attribution without depending on a living Auth row. An Auth or Storage
-- failure stays a truthful, resumable partial state rather than a reason to delete evidence.
begin;

-- 1. Retained account lifecycle state. "Account deleted" is a state of a retained Employee,
--    not a missing employee row, so it is recorded here and never inferred from a null link
--    (an imported person that was never linked is also unlinked and must stay distinguishable).
alter table public.employees add column account_deleted_at timestamptz;
comment on column public.employees.account_deleted_at is 'Set once when the employee''s sign-in account is confirmed permanently deleted. The row, its UUID, name and every business reference are retained; a deleted account is never re-linked or re-activated.';
alter table public.employees add constraint employees_account_deleted_check
  check (account_deleted_at is null or (not is_active and auth_user_id is null));

-- 2. Operation attestation. `target_auth_user_id` is the exact Auth identity the action is
--    locked to, recorded before the unlink so a resume -- and the retained attribution --
--    never needs a living Auth row or a rebuilt link. The Storage counts record what the
--    preflight and ownership reassignment actually observed.
alter table public.employee_admin_operations
  add column target_auth_user_id uuid,
  add column storage_owned_count integer,
  add column storage_reassigned_count integer;
comment on column public.employee_admin_operations.target_auth_user_id is 'The exact Auth sign-in identity this operation is locked to. Deliberately not a foreign key: the retained attribution must outlive the deleted Auth row.';
comment on column public.employee_admin_operations.storage_owned_count is 'Storage objects the preflight found owned by the target Auth identity, or null when no preflight ran';
comment on column public.employee_admin_operations.storage_reassigned_count is 'Storage objects whose technical ownership was reassigned to the custodian, or null when no reassignment ran';
alter table public.employee_admin_operations add constraint employee_admin_operations_storage_counts_check
  check ((storage_owned_count is null or storage_owned_count >= 0)
    and (storage_reassigned_count is null or storage_reassigned_count >= 0)
    and (storage_reassigned_count is null or storage_owned_count is not null));

-- 3. Widen the operation vocabulary to a second kind and its confirmed outcome while keeping
--    every existing rule for deactivation exactly as it was.
alter table public.employee_admin_operations drop constraint employee_admin_operations_kind_check;
alter table public.employee_admin_operations add constraint employee_admin_operations_kind_check
  check (kind in ('deactivate','delete'));
alter table public.employee_admin_operations drop constraint employee_admin_operations_provider_outcome_check;
alter table public.employee_admin_operations add constraint employee_admin_operations_provider_outcome_check
  check (provider_outcome in ('blocked','failed','ambiguous','deleted','storage_blocked'));
alter table public.employee_admin_operations drop constraint employee_admin_operations_check1;
alter table public.employee_admin_operations add constraint employee_admin_operations_check1
  check (case state
    when 'provider_pending' then provider_outcome is null
    when 'provider_failed' then provider_outcome in ('failed','ambiguous','storage_blocked')
    else provider_outcome in ('blocked','deleted')
  end is true);
-- A finite provider ban belongs to deactivation only; a completed deletion is evidenced by
-- the absent account instead.
alter table public.employee_admin_operations drop constraint employee_admin_operations_check3;
alter table public.employee_admin_operations add constraint employee_admin_operations_check3
  check (state <> 'completed' or kind <> 'deactivate' or provider_ban_until is not null);
alter table public.employee_admin_operations add constraint employee_admin_operations_delete_completion_check
  check (state <> 'completed' or kind <> 'delete'
    or (provider_outcome = 'deleted' and provider_reference is not null and provider_user_id is not null));
alter table public.employee_admin_operations add constraint employee_admin_operations_delete_target_check
  check (kind <> 'delete' or target_auth_user_id is not null);

-- 3b. The shared projection gains the retained Auth attribution and the observed Storage
--     counts so the confirmation renders what actually happened rather than a guess.
create or replace function private.employee_admin_operation_json(op public.employee_admin_operations)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',op.id,'employeeId',op.employee_id,'actorId',op.actor_id,'kind',op.kind,
    'state',op.state,'revision',op.revision,'providerOutcome',op.provider_outcome,
    'providerReference',op.provider_reference,'providerDetail',op.provider_detail,
    'providerBanUntil',op.provider_ban_until,'providerAttemptedAt',op.provider_attempted_at,
    'targetAuthUserId',op.target_auth_user_id,
    'storageOwnedCount',op.storage_owned_count,'storageReassignedCount',op.storage_reassigned_count,
    'membershipDisabledAt',op.membership_disabled_at,'completedAt',op.completed_at,
    'createdAt',op.created_at,'updatedAt',op.updated_at);
$$;

-- 4. Evidence vocabulary for the new steps.
alter table public.employee_admin_events drop constraint employee_admin_events_action_check;
alter table public.employee_admin_events add constraint employee_admin_events_action_check
  check (action in ('begun','resumed','provider_blocked','provider_failed','provider_ambiguous','storage_blocked','account_deleted'));

-- 5. The employees guard gains the account-deleted lifecycle field. It stays a closure of the
--    existing guard: client roles cannot write lifecycle/link/role/account-deleted state, the
--    last-active-admin invariant is unchanged, and a recorded account deletion is terminal for
--    this release (restoring or re-inviting a deleted person is an unapproved returner flow).
create or replace function private.guard_employee_admin_state() returns trigger language plpgsql security invoker set search_path = '' as $$
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
        or new.role is distinct from old.role
        or new.account_deleted_at is distinct from old.account_deleted_at)
    then
      raise exception 'employee lifecycle, sign-in link and role changes use the guarded RPCs' using errcode = '42501';
    end if;
    if old.account_deleted_at is not null
      and (new.account_deleted_at is distinct from old.account_deleted_at
        or new.auth_user_id is not null
        or new.is_active)
    then
      raise exception 'a deleted sign-in account is retained as account-deleted' using errcode = '23514';
    end if;
    was_active_admin := old.role = 'admin' and old.is_active;
    is_active_admin := new.role = 'admin' and new.is_active;
    target_id := old.id;
  elsif tg_op = 'INSERT' then
    if current_user in ('anon','authenticated','service_role')
      and (new.is_active or new.auth_user_id is not null or new.role is not null
        or new.account_deleted_at is not null)
    then
      raise exception 'employee lifecycle, sign-in link and role changes use the guarded RPCs' using errcode = '42501';
    end if;
    return new;
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

-- 6. Storage ownership preflight. Supabase refuses to delete an Auth user that still owns
--    Storage objects and the project's uploads are made with the uploader's own session, so
--    each uploaded property file is owned by that employee's sign-in identity. The pinned
--    client has no ownership-transfer call, so this counts the owned objects read-only; the
--    count is only ever reported, never repaired by deleting or retargeting a document.
create function private.employee_storage_preflight(p_auth_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  has_owner_id boolean;
  owned integer := 0;
begin
  if p_auth_user_id is null then
    raise exception 'sign-in identity required' using errcode = '23514';
  end if;
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id'
  ) into has_owner_id;
  if not has_owner_id then
    -- The Storage schema is not in the shape this adapter was verified against. Report it
    -- instead of guessing, so the caller records a truthful partial state.
    return jsonb_build_object('supported',false,'ownedCount',0);
  end if;
  execute 'select count(*) from storage.objects where owner_id = $1::text'
    into owned using p_auth_user_id;
  return jsonb_build_object('supported',true,'ownedCount',owned);
end;
$$;
comment on function private.employee_storage_preflight(uuid) is 'Read-only Storage ownership preflight for one Auth identity. Never deletes, retargets or rewrites an object.';

-- 7. Technical Storage ownership reassignment. Only the ownership columns change: the object
--    id, bucket, path, metadata and bytes are untouched, so registered file UUIDs, uploader
--    Employee attribution and prior review history are unaffected. The custodian must be a
--    live active admin sign-in link, so the new owner is an authorized retained identity.
create function private.reassign_employee_storage_ownership(p_from_auth_user_id uuid,p_to_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  has_owner_id boolean;
  has_owner boolean;
  columns text;
  predicate text;
  reassigned integer := 0;
begin
  if p_from_auth_user_id is null or p_to_auth_user_id is null then
    raise exception 'both sign-in identities required' using errcode = '23514';
  end if;
  if p_from_auth_user_id = p_to_auth_user_id then
    raise exception 'the custodian must differ from the deleted sign-in identity' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.employees
    where auth_user_id = p_to_auth_user_id and is_active and role = 'admin'
      and account_deleted_at is null
  ) then
    raise exception 'storage ownership custodian must be a live active admin' using errcode = '42501';
  end if;
  select exists (select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id'),
    exists (select 1 from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner')
    into has_owner_id, has_owner;
  if not has_owner_id and not has_owner then
    return jsonb_build_object('supported',false,'reassignedCount',0);
  end if;
  -- Only the ownership columns are named; the deprecated `owner` mirror is updated with
  -- `owner_id` when the project still carries it.
  columns := concat_ws(', ',
    case when has_owner_id then 'owner_id = $2::text' end,
    case when has_owner then 'owner = $2::text' end);
  predicate := case
    when has_owner_id and has_owner then '(owner_id = $1::text or owner = $1::text)'
    when has_owner_id then 'owner_id = $1::text'
    else 'owner = $1::text' end;
  execute format('update storage.objects set %s where %s', columns, predicate)
    using p_from_auth_user_id, p_to_auth_user_id;
  get diagnostics reassigned = row_count;
  return jsonb_build_object('supported',true,'reassignedCount',reassigned);
end;
$$;
comment on function private.reassign_employee_storage_ownership(uuid,uuid) is 'Reassigns only the Storage ownership columns of one Auth identity''s objects to a live active admin custodian, preserving object id, path, metadata and bytes.';

-- 8. Begin (or resume) permanent account deletion. Membership is disabled and the sign-in
--    link removed in the same transaction that opens the operation, so the restrictive Auth
--    foreign key can never block the provider call and a lost response resumes the identical
--    action. The exact Auth identity is recorded on the operation before the unlink.
create function private.begin_employee_account_deletion(p_employee_id uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.employees;
  existing public.employee_admin_operations;
  resumed public.employee_admin_events;
  op public.employee_admin_operations;
begin
  if me is null or private.employee_role() is distinct from 'admin' then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_employee_id is null or p_key is null then
    raise exception 'employee and submission key required' using errcode = '23514';
  end if;
  -- Same lock order as deactivation: the open-operation identity per employee, then the
  -- target employee row, then the operation row.
  perform pg_advisory_xact_lock(hashtextextended('public.employee_admin_operations:'||p_employee_id::text,0));
  select * into target from public.employees where id = p_employee_id for update;
  if target.id is null then raise exception 'employee not found' using errcode = 'P0011'; end if;
  select * into existing from public.employee_admin_operations
    where actor_id = me and idempotency_key = p_key for update;
  if existing.id is not null then
    if existing.employee_id <> p_employee_id or existing.kind <> 'delete' then
      raise exception 'submission key reused for a different employee or action' using errcode = '23505';
    end if;
    return private.employee_admin_operation_json(existing);
  end if;
  select * into resumed from public.employee_admin_events
    where actor_id = me and idempotency_key = p_key for update;
  if resumed.id is not null then
    select * into op from public.employee_admin_operations where id = resumed.operation_id;
    if op.id is null or op.employee_id <> p_employee_id or op.kind <> 'delete' then
      raise exception 'submission key reused for a different employee or action' using errcode = '23505';
    end if;
    return private.employee_admin_operation_json(op);
  end if;
  select * into existing from public.employee_admin_operations
    where employee_id = p_employee_id and state <> 'completed' for update;
  if existing.id is not null then
    -- One open operation per employee: a competing deactivation and deletion cannot both
    -- proceed, so repeated or interleaved attempts produce one coherent retained state.
    if existing.kind <> 'delete' then
      raise exception 'a different employee lifecycle operation is already open' using errcode = 'P0013';
    end if;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,idempotency_key)
      values(existing.id,p_employee_id,me,'resumed',p_key);
    return private.employee_admin_operation_json(existing);
  end if;
  if target.account_deleted_at is not null then
    raise exception 'employee sign-in account is already deleted' using errcode = 'P0011';
  end if;
  if target.auth_user_id is null then
    raise exception 'employee has no linked sign-in identity' using errcode = 'P0011';
  end if;
  insert into public.employee_admin_operations(employee_id,actor_id,kind,idempotency_key,target_auth_user_id)
    values(p_employee_id,me,'delete',p_key,target.auth_user_id) returning * into op;
  insert into public.employee_admin_events(operation_id,employee_id,actor_id,action)
    values(op.id,p_employee_id,me,'begun');
  -- Membership is disabled and the sign-in link cleared here, before any provider call, so
  -- the retained employee is already denied by live-membership checks while the provider
  -- step is only pending. The last-active-admin guard runs inside this statement and rolls
  -- the whole transaction back, leaving no operation claiming a disabled membership.
  update public.employees set is_active = false, auth_user_id = null where id = p_employee_id;
  return private.employee_admin_operation_json(op);
end;
$$;

-- 9. Record the provider outcome for account deletion. Server-only, like the deactivation
--    reconciliation. `deleted` is terminal and additionally writes the retained
--    account-deleted state on the employee row; `storage_blocked` records owned Storage
--    objects that could not be safely reassigned, which is a truthful partial operation and
--    never a reason to delete, retarget or anonymize a document.
create function private.record_employee_account_deletion_result(
  p_operation_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_auth_user_id uuid,
  p_outcome text,
  p_provider_reference text default null,
  p_storage_owned integer default null,
  p_storage_reassigned integer default null,
  p_detail text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  op public.employee_admin_operations;
  outcome text := lower(btrim(coalesce(p_outcome,'')));
  detail text := nullif(btrim(coalesce(p_detail,'')),'');
  reference text := nullif(btrim(coalesce(p_provider_reference,'')),'');
  current_link uuid;
  current_deleted_at timestamptz;
begin
  if p_operation_id is null or p_revision is null or p_actor_id is null or p_auth_user_id is null then
    raise exception 'operation, revision, actor and sign-in identity required' using errcode = '23514';
  end if;
  if outcome not in ('deleted','failed','ambiguous','storage_blocked') then
    raise exception 'invalid provider outcome' using errcode = '23514';
  end if;
  if detail is not null and length(detail) > 500 then
    raise exception 'provider detail is too long' using errcode = '23514';
  end if;
  if p_storage_owned is not null and p_storage_owned < 0 then
    raise exception 'storage object count cannot be negative' using errcode = '23514';
  end if;
  if p_storage_reassigned is not null and (p_storage_reassigned < 0 or p_storage_owned is null) then
    raise exception 'reassigned count requires a preflight count' using errcode = '23514';
  end if;
  if not exists (select 1 from public.employees where id = p_actor_id) then
    raise exception 'recording actor not found' using errcode = '23514';
  end if;
  select * into op from public.employee_admin_operations where id = p_operation_id;
  if op.id is null then raise exception 'operation not found' using errcode = 'P0012'; end if;
  if op.kind <> 'delete' then
    raise exception 'not an account deletion operation' using errcode = 'P0012';
  end if;
  -- Lock the employee row before the operation row, matching begin's order.
  select e.auth_user_id, e.account_deleted_at into current_link, current_deleted_at
    from public.employees e where e.id = op.employee_id for update;
  if not found then raise exception 'employee not found' using errcode = 'P0012'; end if;
  select * into op from public.employee_admin_operations where id = p_operation_id for update;
  if op.state = 'completed' then
    if outcome = 'deleted' and reference is not null and reference = op.provider_reference
      and p_auth_user_id = op.target_auth_user_id then
      return private.employee_admin_operation_json(op);
    end if;
    raise exception 'operation already completed' using errcode = 'P0012';
  end if;
  if op.revision is distinct from p_revision then
    raise exception 'stale operation revision; reload current state' using errcode = 'PT409';
  end if;
  -- The retained link is gone by design; the operation's own recorded identity is the
  -- authority, so a resume is never dependent on a living Auth row.
  if current_link is not null or op.target_auth_user_id is distinct from p_auth_user_id then
    raise exception 'employee sign-in link changed; restart account deletion' using errcode = 'P0012';
  end if;
  if current_deleted_at is not null then
    raise exception 'retained employee is already recorded as account-deleted' using errcode = 'P0012';
  end if;
  if outcome = 'deleted' then
    if reference is null or reference <> p_auth_user_id::text then
      raise exception 'confirmed account deletion requires the absent provider reference' using errcode = '23514';
    end if;
    -- A confirmed deletion must be able to show that Storage ownership was preflighted.
    if p_storage_owned is null then
      raise exception 'confirmed account deletion requires the storage preflight result' using errcode = '23514';
    end if;
    update public.employees set account_deleted_at = clock_timestamp()
      where id = op.employee_id and account_deleted_at is null;
    update public.employee_admin_operations set
      state = 'completed', revision = revision + 1, completed_at = clock_timestamp(),
      provider_outcome = 'deleted', provider_reference = reference,
      provider_user_id = p_auth_user_id, provider_detail = detail,
      storage_owned_count = p_storage_owned,
      storage_reassigned_count = p_storage_reassigned,
      provider_attempted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'account_deleted',detail);
  elsif outcome = 'storage_blocked' then
    update public.employee_admin_operations set
      state = 'provider_failed', revision = revision + 1, provider_outcome = 'storage_blocked',
      provider_reference = reference, provider_detail = detail,
      storage_owned_count = p_storage_owned,
      storage_reassigned_count = p_storage_reassigned,
      provider_attempted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'storage_blocked',detail);
  elsif outcome = 'failed' then
    update public.employee_admin_operations set
      state = 'provider_failed', revision = revision + 1, provider_outcome = 'failed',
      provider_reference = reference, provider_detail = detail,
      storage_owned_count = p_storage_owned,
      storage_reassigned_count = p_storage_reassigned,
      provider_attempted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'provider_failed',detail);
  else
    update public.employee_admin_operations set
      state = 'provider_failed', revision = revision + 1, provider_outcome = 'ambiguous',
      provider_reference = reference, provider_detail = detail,
      storage_owned_count = p_storage_owned,
      storage_reassigned_count = p_storage_reassigned,
      provider_attempted_at = clock_timestamp(), updated_at = clock_timestamp()
      where id = op.id returning * into op;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,detail)
      values(op.id,op.employee_id,p_actor_id,'provider_ambiguous',detail);
  end if;
  return private.employee_admin_operation_json(op);
end;
$$;

-- 10. Close the deactivation/`delete` cross-over that #66 could not know about: each begin
--     only ever resumes its own kind, so a competing deletion cannot be recorded as a
--     completed sign-in block (and vice versa) on one shared operation row.
create or replace function private.begin_employee_deactivation(p_employee_id uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.employees;
  existing public.employee_admin_operations;
  resumed public.employee_admin_events;
  op public.employee_admin_operations;
begin
  if me is null or private.employee_role() is distinct from 'admin' then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_employee_id is null or p_key is null then
    raise exception 'employee and submission key required' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('public.employee_admin_operations:'||p_employee_id::text,0));
  select * into target from public.employees where id = p_employee_id for update;
  if target.id is null then raise exception 'employee not found' using errcode = 'P0011'; end if;
  select * into existing from public.employee_admin_operations
    where actor_id = me and idempotency_key = p_key for update;
  if existing.id is not null then
    if existing.employee_id <> p_employee_id or existing.kind <> 'deactivate' then
      raise exception 'submission key reused for a different employee or action' using errcode = '23505';
    end if;
    return private.employee_admin_operation_json(existing);
  end if;
  select * into resumed from public.employee_admin_events
    where actor_id = me and idempotency_key = p_key for update;
  if resumed.id is not null then
    select * into op from public.employee_admin_operations where id = resumed.operation_id;
    if op.id is null or op.employee_id <> p_employee_id or op.kind <> 'deactivate' then
      raise exception 'submission key reused for a different employee or action' using errcode = '23505';
    end if;
    return private.employee_admin_operation_json(op);
  end if;
  select * into existing from public.employee_admin_operations
    where employee_id = p_employee_id and state <> 'completed' for update;
  if existing.id is not null then
    if existing.kind <> 'deactivate' then
      raise exception 'a different employee lifecycle operation is already open' using errcode = 'P0013';
    end if;
    insert into public.employee_admin_events(operation_id,employee_id,actor_id,action,idempotency_key)
      values(existing.id,p_employee_id,me,'resumed',p_key);
    return private.employee_admin_operation_json(existing);
  end if;
  if target.account_deleted_at is not null then
    raise exception 'employee sign-in account is already deleted' using errcode = 'P0011';
  end if;
  -- Checked after the open-operation lookup so a competing deletion is reported as a
  -- lifecycle conflict rather than as an unlinked employee.
  if target.auth_user_id is null then
    raise exception 'employee has no linked sign-in identity' using errcode = 'P0011';
  end if;
  if not target.is_active then
    raise exception 'employee access is already inactive' using errcode = 'P0011';
  end if;
  insert into public.employee_admin_operations(employee_id,actor_id,kind,idempotency_key)
    values(p_employee_id,me,'deactivate',p_key) returning * into op;
  insert into public.employee_admin_events(operation_id,employee_id,actor_id,action)
    values(op.id,p_employee_id,me,'begun');
  update public.employees set is_active = false where id = p_employee_id;
  return private.employee_admin_operation_json(op);
end;
$$;

create or replace function private.record_employee_deactivation_result(
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
  if op.kind <> 'deactivate' then
    raise exception 'not a deactivation operation' using errcode = 'P0012';
  end if;
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

-- 11. Public wrappers. Begin is an invoker wrapper for live admins; the provider result and
--     both Storage steps are invoker wrappers executable only by the trusted server.
create function public.begin_employee_account_deletion(p_employee_id uuid,p_key uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.begin_employee_account_deletion(p_employee_id,p_key);
$$;
create function public.record_employee_account_deletion_result(
  p_operation_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_auth_user_id uuid,
  p_outcome text,
  p_provider_reference text default null,
  p_storage_owned integer default null,
  p_storage_reassigned integer default null,
  p_detail text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_employee_account_deletion_result(p_operation_id,p_revision,p_actor_id,p_auth_user_id,p_outcome,p_provider_reference,p_storage_owned,p_storage_reassigned,p_detail);
$$;
create function public.employee_storage_preflight(p_auth_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.employee_storage_preflight(p_auth_user_id);
$$;
create function public.reassign_employee_storage_ownership(p_from_auth_user_id uuid,p_to_auth_user_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reassign_employee_storage_ownership(p_from_auth_user_id,p_to_auth_user_id);
$$;

-- 12. Explicit access. The employee table already grants the administration row reads under
--     the existing live-admin policies; the new columns add no new grant.
revoke all on function private.employee_admin_operation_json(public.employee_admin_operations),
  private.begin_employee_account_deletion(uuid,uuid),
  private.record_employee_account_deletion_result(uuid,integer,uuid,uuid,text,text,integer,integer,text),
  private.employee_storage_preflight(uuid),
  private.reassign_employee_storage_ownership(uuid,uuid),
  public.begin_employee_account_deletion(uuid,uuid),
  public.record_employee_account_deletion_result(uuid,integer,uuid,uuid,text,text,integer,integer,text),
  public.employee_storage_preflight(uuid),
  public.reassign_employee_storage_ownership(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.begin_employee_account_deletion(uuid,uuid) to authenticated;
grant execute on function public.begin_employee_account_deletion(uuid,uuid) to authenticated;
-- The provider and Storage boundaries are server-only: no authenticated client can claim a
-- deleted account or move Storage ownership. service_role is the trusted server adapter.
grant usage on schema private to service_role;
grant execute on function private.record_employee_account_deletion_result(uuid,integer,uuid,uuid,text,text,integer,integer,text) to service_role;
grant execute on function private.employee_storage_preflight(uuid) to service_role;
grant execute on function private.reassign_employee_storage_ownership(uuid,uuid) to service_role;
grant execute on function public.record_employee_account_deletion_result(uuid,integer,uuid,uuid,text,text,integer,integer,text) to service_role;
grant execute on function public.employee_storage_preflight(uuid) to service_role;
grant execute on function public.reassign_employee_storage_ownership(uuid,uuid) to service_role;
commit;
