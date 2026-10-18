-- Issue #69 follow-up: bind acceptance to the invitation's own flow and normalize the name.
-- Two review findings on the acceptance transition:
--   P1  A password-recovery session for the intended address satisfies the recorded
--       provider-identity check, so recovery alone could reach activation. Acceptance now
--       also requires a one-time proof that the session was established through the
--       invitation's delivered link (the invite session endpoint), which the recovery and
--       ordinary sign-in paths never create.
--   P2  btrim() removes only spaces, so a tab/newline-only name passed the empty check when
--       the RPC was called directly. Name trimming is normalized to all whitespace in SQL,
--       the authority for this publicly invocable operation.
-- The recording, send path, role binding and recovery behaviour are unchanged.
begin;

-- 1. One-time proof that a session was established through an invitation's own delivered
--    flow. Created only by the invite session endpoint (service-role adapter) and consumed by
--    acceptance in the same transaction as the link. A recovery or ordinary sign-in session
--    never creates one, so it cannot satisfy acceptance.
create table private.employee_invitation_proofs (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.employee_invitations(id) on delete cascade,
  auth_user_id uuid not null,
  revision integer not null check (revision > 0),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  unique (invitation_id, auth_user_id),
  check (consumed_at is null or consumed_at >= created_at)
);
comment on table private.employee_invitation_proofs is 'One-time proof that a session was established through an invitation''s delivered flow (the invite link). Created by the invite session endpoint and consumed by acceptance; a recovery or ordinary sign-in session has none, so it cannot activate.';
-- Every application table carries RLS; the private schema is unexposed and this table is
-- reachable only by the definer functions (owner bypasses RLS), with client roles revoked.
alter table private.employee_invitation_proofs enable row level security;
revoke all on private.employee_invitation_proofs from public, anon, authenticated, service_role;

-- 2. Record (or refresh) the proof for the exact invitation, identity and revision. Server-only:
--    the invite session endpoint is the trusted caller after it establishes the delivered
--    session with the user's publishable-key client.
create function private.record_employee_invitation_proof(
  p_invitation_id uuid,
  p_auth_user_id uuid,
  p_revision integer
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  inv public.employee_invitations;
  proof private.employee_invitation_proofs;
begin
  if p_invitation_id is null or p_auth_user_id is null or p_revision is null then
    raise exception 'invitation, identity and revision required' using errcode = '23514';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id;
  if inv.id is null then
    raise exception 'invitation not found' using errcode = 'P0023';
  end if;
  if inv.state is distinct from 'recorded' then
    raise exception 'the invitation has not been accepted by the provider' using errcode = 'P0024';
  end if;
  if inv.provider_user_id is distinct from p_auth_user_id then
    raise exception 'the invitation belongs to a different sign-in identity' using errcode = 'P0025';
  end if;
  if inv.revision is distinct from p_revision then
    raise exception 'stale invitation revision; reload current state' using errcode = 'PT409';
  end if;
  insert into private.employee_invitation_proofs(invitation_id, auth_user_id, revision, expires_at)
    values (inv.id, p_auth_user_id, inv.revision, clock_timestamp() + interval '1 day')
    on conflict (invitation_id, auth_user_id) do update
      set revision = excluded.revision, expires_at = excluded.expires_at
    returning * into proof;
  return jsonb_build_object('id', proof.id, 'invitationId', proof.invitation_id, 'expiresAt', proof.expires_at);
end;
$$;
comment on function private.record_employee_invitation_proof(uuid,uuid,integer) is
  'Records a one-time invite-flow proof for the exact recorded invitation and provider identity. Server-only: the invite session endpoint is the trusted caller.';

create function public.record_employee_invitation_proof(p_invitation_id uuid,p_auth_user_id uuid,p_revision integer)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.record_employee_invitation_proof(p_invitation_id,p_auth_user_id,p_revision);
$$;

-- 3. Read-only check used by the session endpoint's revisit path so a session without the
--    invite-flow proof is refused before the setup form. Server-only.
create function private.employee_invitation_proof_valid(p_invitation_id uuid,p_auth_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.employee_invitation_proofs
    where invitation_id = p_invitation_id
      and auth_user_id = p_auth_user_id
      and consumed_at is null
      and expires_at > clock_timestamp()
  );
$$;
comment on function private.employee_invitation_proof_valid(uuid,uuid) is
  'Whether a live, unconsumed invite-flow proof exists for the invitation and provider identity. Server-only.';

create function public.employee_invitation_proof_valid(p_invitation_id uuid,p_auth_user_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.employee_invitation_proof_valid(p_invitation_id,p_auth_user_id);
$$;

-- 4. Replace the acceptance transition: normalize all whitespace in the required name (P2)
--    and require + consume a one-time invite-flow proof before linking (P1). Every earlier
--    guard (recorded state, provider identity, deletion-in-flight, deactivation, revision)
--    is preserved; the proof is consumed only after those guards pass, in the same
--    transaction that links and activates.
create or replace function private.accept_employee_invitation(
  p_invitation_id uuid,
  p_revision integer,
  p_display_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  name text := regexp_replace(coalesce(p_display_name,''), '^\s+|\s+$', '', 'g');
  inv public.employee_invitations;
  emp public.employees;
  proof private.employee_invitation_proofs;
begin
  if me is null then
    raise exception 'sign-in identity required' using errcode = '42501';
  end if;
  if p_invitation_id is null or p_revision is null then
    raise exception 'invitation and revision required' using errcode = '23514';
  end if;
  if name = '' or length(name) > 200 then
    raise exception 'a name between 1 and 200 characters is required' using errcode = '23514';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id;
  if inv.id is null then
    raise exception 'invitation not found' using errcode = 'P0023';
  end if;
  if inv.state is distinct from 'recorded' then
    raise exception 'the invitation has not been accepted by the provider' using errcode = 'P0024';
  end if;
  if inv.provider_user_id is distinct from me then
    raise exception 'the invitation belongs to a different sign-in identity' using errcode = 'P0025';
  end if;
  -- Lock the employee row before the invitation row, matching the recorded provider-result
  -- transition, so a deactivation or a concurrent acceptance serializes here and a disabled
  -- link is never restored.
  select * into emp from public.employees where id = inv.employee_id for update;
  if emp.id is null then
    raise exception 'invited employee not found' using errcode = 'P0023';
  end if;
  if emp.account_deleted_at is not null then
    raise exception 'the employee sign-in account is deleted' using errcode = 'P0023';
  end if;
  -- A begun but unconfirmed account deletion already revoked this employee: the row is
  -- unlinked and inactive exactly like a freshly invited employee, so the open operation is
  -- what distinguishes them. Acceptance never reverses that revocation.
  if exists (
    select 1 from public.employee_admin_operations
    where employee_id = emp.id and kind = 'delete' and state <> 'completed'
  ) then
    raise exception 'employee access already changed; restart the invitation' using errcode = 'P0023';
  end if;
  if emp.auth_user_id is not null then
    -- Already linked. Converge only for the exact same identity that is still active;
    -- a different identity, a disabled membership or a changed employee is never restored.
    if emp.auth_user_id = me and emp.is_active then
      return jsonb_build_object(
        'id',emp.id,'displayName',emp.display_name,'email',emp.email,
        'role',emp.role,'locale',coalesce(emp.preferred_locale,'vi'));
    end if;
    raise exception 'employee access already changed; restart the invitation' using errcode = 'P0023';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id for update;
  if inv.state is distinct from 'recorded' or inv.provider_user_id is distinct from me then
    raise exception 'the invitation changed; reload current state' using errcode = 'PT409';
  end if;
  if inv.revision is distinct from p_revision then
    raise exception 'stale invitation revision; reload current state' using errcode = 'PT409';
  end if;
  -- P1: require and consume a live invite-flow proof for this invitation and session identity.
  -- A recovery or ordinary sign-in session has no such proof, so it cannot activate.
  update private.employee_invitation_proofs
    set consumed_at = clock_timestamp()
    where invitation_id = p_invitation_id
      and auth_user_id = me
      and consumed_at is null
      and expires_at > clock_timestamp()
    returning * into proof;
  if proof.id is null then
    raise exception 'acceptance requires the invitation''s delivered session, not a recovery session' using errcode = 'P0026';
  end if;
  update public.employees
    set auth_user_id = me, display_name = name, is_active = true
    where id = emp.id;
  return jsonb_build_object(
    'id',emp.id,'displayName',name,'email',emp.email,
    'role',emp.role,'locale',coalesce(emp.preferred_locale,'vi'));
end;
$$;
comment on function private.accept_employee_invitation(uuid,integer,text) is
  'Links and activates the exact intended invitee on the recorded invitation, setting the required (whitespace-normalized) name. The caller''s session must be the recorded provider identity AND carry the invitation''s one-time invite-flow proof, so a recovery or ordinary sign-in session cannot activate; consumed, deactivated, deletion-in-flight, deleted or mismatched invitations are never restored.';

-- 5. Explicit access. The proof recording and check are server-only; acceptance stays the
--    invoker-authorized transition it was.
revoke all on function private.record_employee_invitation_proof(uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function private.record_employee_invitation_proof(uuid,uuid,integer) to service_role;
revoke all on function public.record_employee_invitation_proof(uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.record_employee_invitation_proof(uuid,uuid,integer) to service_role;
revoke all on function private.employee_invitation_proof_valid(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function private.employee_invitation_proof_valid(uuid,uuid) to service_role;
revoke all on function public.employee_invitation_proof_valid(uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.employee_invitation_proof_valid(uuid,uuid) to service_role;
revoke all on function private.accept_employee_invitation(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function private.accept_employee_invitation(uuid,integer,text) to authenticated;
revoke all on function public.accept_employee_invitation(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.accept_employee_invitation(uuid,integer,text) to authenticated;
commit;
