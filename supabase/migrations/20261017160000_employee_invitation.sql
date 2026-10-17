-- Issue #68: send a role-bound employee invitation.
-- One recorded invitation per intended person, created under the live admin's authority and
-- sent through the server-only Auth administration adapter. Sending records an invitation
-- state, never active membership: the retained employee row is created unlinked and inactive
-- and stays that way until the separate acceptance ticket verifies the exact identity. The
-- provider's accepted request is recorded as such and is never presented as proof that a
-- mailbox received the email; a failed or ambiguous attempt stays reconcilable on the same
-- invitation row and no provider identity or employee row is deleted as compensation.
begin;

-- 1. Durable invitation. One row per intended person carries the normalized email, the
--    requested company role, the acting admin, the submission identity, a monotonic revision
--    and the provider reconciliation state. The guard refuses every client write, and the
--    application exposes no deletion path.
create table public.employee_invitations (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  actor_id uuid not null references public.employees(id),
  email text not null check (email = lower(btrim(email)) and length(email) <= 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  role text not null check (role in ('sales','staff','manager','admin')),
  idempotency_key uuid not null,
  state text not null default 'provider_pending' check (state in ('provider_pending','provider_failed','recorded')),
  revision integer not null default 1 check (revision > 0),
  provider_outcome text check (provider_outcome in ('accepted','failed','ambiguous')),
  provider_user_id uuid,
  provider_detail text check (provider_detail is null or length(provider_detail) between 1 and 500),
  provider_attempted_at timestamptz,
  requested_at timestamptz not null default clock_timestamp(),
  recorded_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (actor_id, idempotency_key),
  unique (provider_user_id),
  check ((state = 'recorded') = (recorded_at is not null)),
  check (case state
    when 'provider_pending' then provider_outcome is null
    when 'provider_failed' then provider_outcome in ('failed','ambiguous')
    else provider_outcome = 'accepted'
  end is true),
  check (state <> 'recorded' or provider_user_id is not null)
);
comment on table public.employee_invitations is 'Recorded role-bound employee invitations. The requested role lives here and in the retained employee row, never in editable Auth metadata, and an accepted provider request is not evidence that the mailbox received the message.';
comment on column public.employee_invitations.role is 'The company role requested by the inviting admin; acceptance and activation are separate operations and never promote through Auth metadata';
comment on column public.employee_invitations.revision is 'Monotonic invitation revision; recording a provider result must present the current revision';
comment on column public.employee_invitations.provider_user_id is 'The exact provider sign-in identity the accepted invitation request created; it is linked to the employee only by the separate verified acceptance';
comment on column public.employee_invitations.provider_detail is 'Bounded, redacted provider failure evidence; never a token, key or unbounded remote payload';
-- At most one open invitation per intended person: a recorded invitation is history and a
-- reconciliation resumes that same row instead of creating a second one.
create unique index employee_invitations_open_idx
  on public.employee_invitations(employee_id) where state <> 'recorded';

-- 2. Retention guard. A definer may write; every client role and any direct write path is
--    refused, identity and the recorded outcome are immutable, and a recorded invitation is
--    terminal. Only the owner administrative connection can remove a row, and the private
--    audit trail behind this table keeps the evidence of that removal.
create function private.guard_employee_invitations() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'employee invitations use the guarded RPCs' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.employee_id is distinct from old.employee_id
      or new.actor_id is distinct from old.actor_id
      or new.email is distinct from old.email
      or new.role is distinct from old.role
      or new.idempotency_key is distinct from old.idempotency_key
      or new.requested_at is distinct from old.requested_at
      or new.created_at is distinct from old.created_at
      or (old.state = 'recorded' and (new.state <> 'recorded'
        or new.provider_outcome is distinct from old.provider_outcome
        or new.provider_user_id is distinct from old.provider_user_id))
    then raise exception 'invitation identity and recorded outcome are immutable' using errcode = '23514'; end if;
  end if;
  return new;
end;
$$;
create trigger employee_invitations_guard before insert or update or delete on public.employee_invitations
  for each row execute function private.guard_employee_invitations();

-- 3. Projection shared by both guarded RPCs. The provider sign-in identity is deliberately not
--    projected: an admin reconciles the recorded state, and no public response carries a raw
--    provider detail beyond the bounded failure evidence.
create function private.employee_invitation_json(inv public.employee_invitations)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',inv.id,'employeeId',inv.employee_id,'actorId',inv.actor_id,
    'email',inv.email,'role',inv.role,'state',inv.state,'revision',inv.revision,
    'providerOutcome',inv.provider_outcome,'providerDetail',inv.provider_detail,
    'providerAttemptedAt',inv.provider_attempted_at,'requestedAt',inv.requested_at,
    'recordedAt',inv.recorded_at,'updatedAt',inv.updated_at);
$$;

-- 4. Begin (or resume) one invitation. The live admin is derived from membership, the
--    normalized email and requested role are validated here as well as by the table's own
--    checks, and the retained employee row is created inactive and unlinked: sending is not
--    activation. A same-actor/key retry converges on the original invitation and a different
--    payload under that key conflicts; another live admin resumes an open invitation instead
--    of creating a second one for the same person. An existing retained employee is never
--    silently reactivated, relinked or reused, and a different requested role conflicts.
create function private.begin_employee_invitation(p_email text,p_role text,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  normalized text := lower(btrim(coalesce(p_email,'')));
  requested_role text := lower(btrim(coalesce(p_role,'')));
  existing public.employee_invitations;
  target public.employees;
  inv public.employee_invitations;
begin
  if me is null or private.employee_role() is distinct from 'admin' then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_key is null then
    raise exception 'submission key required' using errcode = '23514';
  end if;
  if normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or length(normalized) > 254 then
    raise exception 'a valid email address is required' using errcode = '23514';
  end if;
  if requested_role not in ('sales','staff','manager','admin') then
    raise exception 'one of the existing company roles is required' using errcode = '23514';
  end if;
  -- Serialize concurrent invitations for one address, then take the employee row before the
  -- invitation row so every writer follows the same order.
  perform pg_advisory_xact_lock(hashtextextended('public.employee_invitations:'||normalized,0));
  select * into existing from public.employee_invitations
    where actor_id = me and idempotency_key = p_key;
  if existing.id is not null then
    select * into target from public.employees where employees.id = existing.employee_id for update;
    select * into existing from public.employee_invitations
      where employee_id = target.id and actor_id = me and idempotency_key = p_key for update;
    if existing.id is null then
      raise exception 'invitation not found' using errcode = 'P0023';
    end if;
    if existing.email <> normalized or existing.role <> requested_role then
      raise exception 'submission key reused for a different invitation' using errcode = '23505';
    end if;
    return private.employee_invitation_json(existing);
  end if;
  select * into target from public.employees where employees.email = normalized for update;
  if target.id is not null then
    select * into existing from public.employee_invitations
      where employee_id = target.id and state <> 'recorded' for update;
    if existing.id is not null then
      -- Resuming keeps the original attribution and revision; only the recorded role has to
      -- agree, so a concurrent or repeated invitation cannot introduce a conflicting role.
      if existing.role <> requested_role then
        raise exception 'a different role is already recorded for this open invitation' using errcode = 'P0022';
      end if;
      return private.employee_invitation_json(existing);
    end if;
    if exists (select 1 from public.employee_invitations where employee_id = target.id) then
      raise exception 'an invitation is already recorded for this person' using errcode = 'P0021';
    end if;
    raise exception 'this email already belongs to a recorded employee; a new invitation is not a new person' using errcode = 'P0020';
  end if;
  -- The recorded identity until the invitee supplies the required name during the separate
  -- acceptance journey: no name is invented here.
  insert into public.employees(email,display_name,role,is_active,auth_user_id)
    values(normalized,normalized,requested_role,false,null) returning * into target;
  insert into public.employee_invitations(employee_id,actor_id,email,role,idempotency_key)
    values(target.id,me,normalized,requested_role,p_key) returning * into inv;
  return private.employee_invitation_json(inv);
end;
$$;

-- 5. Record the provider outcome. Server-only: the trusted server adapter is the only caller,
--    so default EXECUTE is granted to service_role alone. An accepted request needs the exact
--    provider identity it created and never activates or links the employee; a failed or
--    ambiguous attempt stays reconcilable on the same row. An identical accepted retry
--    converges and a recorded invitation stays terminal.
create function private.record_employee_invitation_result(
  p_invitation_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_email text,
  p_outcome text,
  p_provider_user_id uuid default null,
  p_detail text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.employee_invitations;
  outcome text := lower(btrim(coalesce(p_outcome,'')));
  detail text := nullif(btrim(coalesce(p_detail,'')),'');
  normalized text := lower(btrim(coalesce(p_email,'')));
  employee_email text;
  employee_active boolean;
  employee_link uuid;
begin
  if p_invitation_id is null or p_revision is null or p_actor_id is null then
    raise exception 'invitation, revision and actor required' using errcode = '23514';
  end if;
  if outcome not in ('accepted','failed','ambiguous') then
    raise exception 'invalid provider outcome' using errcode = '23514';
  end if;
  if detail is not null and length(detail) > 500 then
    raise exception 'provider detail is too long' using errcode = '23514';
  end if;
  if not exists (select 1 from public.employees where id = p_actor_id) then
    raise exception 'recording actor not found' using errcode = '23514';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id;
  if inv.id is null then raise exception 'invitation not found' using errcode = 'P0023'; end if;
  -- Lock the employee row before the invitation row, matching begin's order.
  select e.email, e.is_active, e.auth_user_id into employee_email, employee_active, employee_link
    from public.employees e where e.id = inv.employee_id for update;
  if not found then raise exception 'invited employee not found' using errcode = 'P0023'; end if;
  if employee_email <> inv.email or employee_email <> normalized then
    raise exception 'the invitation does not match the intended address' using errcode = '23514';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id for update;
  if inv.state = 'recorded' then
    if outcome = 'accepted' and p_provider_user_id is not null and p_provider_user_id = inv.provider_user_id then
      return private.employee_invitation_json(inv);
    end if;
    raise exception 'invitation already recorded' using errcode = 'P0023';
  end if;
  if inv.revision is distinct from p_revision then
    raise exception 'stale invitation revision; reload current state' using errcode = 'PT409';
  end if;
  if employee_link is not null or employee_active then
    raise exception 'employee access changed; restart the invitation' using errcode = 'P0023';
  end if;
  if outcome = 'accepted' then
    if p_provider_user_id is null then
      raise exception 'an accepted invitation requires the provider identity it created' using errcode = '23514';
    end if;
    update public.employee_invitations set
      state = 'recorded', revision = revision + 1, recorded_at = clock_timestamp(),
      provider_outcome = 'accepted', provider_user_id = p_provider_user_id,
      provider_detail = null, provider_attempted_at = clock_timestamp(),
      updated_at = clock_timestamp()
      where id = inv.id returning * into inv;
  else
    update public.employee_invitations set
      state = 'provider_failed', revision = revision + 1,
      provider_outcome = outcome, provider_user_id = null,
      provider_detail = detail, provider_attempted_at = clock_timestamp(),
      updated_at = clock_timestamp()
      where id = inv.id returning * into inv;
  end if;
  return private.employee_invitation_json(inv);
end;
$$;

-- 6. Public wrappers. Begin is an invoker wrapper for live admins; the provider result is an
--    invoker wrapper executable only by the trusted server.
create function public.begin_employee_invitation(p_email text,p_role text,p_key uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.begin_employee_invitation(p_email,p_role,p_key);
$$;
create function public.record_employee_invitation_result(
  p_invitation_id uuid,
  p_revision integer,
  p_actor_id uuid,
  p_email text,
  p_outcome text,
  p_provider_user_id uuid default null,
  p_detail text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_employee_invitation_result(p_invitation_id,p_revision,p_actor_id,p_email,p_outcome,p_provider_user_id,p_detail);
$$;

-- 7. Explicit access. No client role may write, and reads are live-admin only.
alter table public.employee_invitations enable row level security;
revoke all on public.employee_invitations from public, anon, authenticated, service_role;
grant select on public.employee_invitations to authenticated;
create policy employee_invitations_read on public.employee_invitations for select to authenticated
  using (private.employee_role() = 'admin');

revoke all on function private.guard_employee_invitations(),
  private.employee_invitation_json(public.employee_invitations),
  private.begin_employee_invitation(text,text,uuid),
  private.record_employee_invitation_result(uuid,integer,uuid,text,text,uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function private.begin_employee_invitation(text,text,uuid) to authenticated;
revoke all on function public.begin_employee_invitation(text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.begin_employee_invitation(text,text,uuid) to authenticated;
-- The provider boundary is server-only: no authenticated client can claim that the provider
-- accepted an invitation request. The private schema stays unexposed; service_role is the
-- trusted server adapter.
grant usage on schema private to service_role;
grant execute on function private.record_employee_invitation_result(uuid,integer,uuid,text,text,uuid,text) to service_role;
revoke all on function public.record_employee_invitation_result(uuid,integer,uuid,text,text,uuid,text) from public, anon, authenticated;
grant execute on function public.record_employee_invitation_result(uuid,integer,uuid,text,text,uuid,text) to service_role;

-- 8. The recorded invitation participates in the existing private audit trail, which keeps the
--    insert/update/removal itself with its row snapshots. The provider-result step and any
--    owner-level removal carry no end-user JWT, so those audit rows record no acting Auth
--    identity; the invitation row's own actor_id remains the recorded attribution.
create trigger audit_employee_invitations after insert or update or delete on public.employee_invitations
  for each row execute function private.audit_change();
commit;
