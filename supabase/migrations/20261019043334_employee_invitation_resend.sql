-- Resend a recorded employee invitation that has never been accepted.
-- Production invitations expired after one hour, so most imported staff hold a recorded
-- invitation whose link no longer works. A live admin may send that invitation again: the
-- recorded row keeps its identity, recorded role and provider identity, and each further send
-- is recorded as one more attempt with its own outcome, time and acting admin. The recorded
-- provider acceptance is never rewritten, an accepted or otherwise changed access state is
-- never re-invited, and no second invitation row is created for the same person.
begin;

-- 1. Further sends of one recorded invitation. `resend_count` is the attempt counter the
--    recording call must present, `resend_attempted_at`/`resend_outcome`/`resend_detail` are that
--    attempt's own recorded provider outcome, and `resend_actor_id` names the admin who sent it.
--    The original attribution, role, revision and provider identity stay untouched.
alter table public.employee_invitations
  add column resend_count integer not null default 0 check (resend_count >= 0),
  add column resend_attempted_at timestamptz,
  add column resend_outcome text check (resend_outcome in ('accepted','failed','ambiguous')),
  add column resend_detail text check (resend_detail is null or length(resend_detail) between 1 and 500),
  add column resend_actor_id uuid references public.employees(id),
  add constraint employee_invitations_resend_attempt check (
    (resend_count = 0) = (resend_attempted_at is null)
    and (resend_attempted_at is null) = (resend_outcome is null)
    and (resend_attempted_at is null) = (resend_actor_id is null)
    and (resend_attempted_at is null or state = 'recorded')
  );
comment on column public.employee_invitations.resend_count is 'How many further sends of this recorded invitation have been recorded; the recording call must present the current value';
comment on column public.employee_invitations.resend_outcome is 'The last further send''s provider outcome; the recorded acceptance of the original send is never rewritten';
comment on column public.employee_invitations.resend_actor_id is 'The live admin who recorded the last further send; the original actor_id stays the inviting admin';

-- 2. Projection shared by the guarded RPCs now carries the last further send, so the admin sees
--    what was sent and when without a second read of the table.
create or replace function private.employee_invitation_json(inv public.employee_invitations)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id',inv.id,'employeeId',inv.employee_id,'actorId',inv.actor_id,
    'email',inv.email,'role',inv.role,'state',inv.state,'revision',inv.revision,
    'providerOutcome',inv.provider_outcome,'providerDetail',inv.provider_detail,
    'providerAttemptedAt',inv.provider_attempted_at,'requestedAt',inv.requested_at,
    'recordedAt',inv.recorded_at,'updatedAt',inv.updated_at,
    'resendCount',inv.resend_count,'resendAttemptedAt',inv.resend_attempted_at,
    'resendOutcome',inv.resend_outcome,'resendDetail',inv.resend_detail,
    'resendActorId',inv.resend_actor_id);
$$;

-- 3. Record one further send of a recorded invitation. The live admin is derived from
--    membership, the employee row is locked before the invitation row like every other writer,
--    and a recorded invitation that was already accepted — linked identity, active or deleted
--    account, an account deletion in flight or a changed recorded address — is refused instead
--    of re-invited. An `accepted` resend must name the identity this invitation already
--    recorded, so a further send never rewrites or adopts a different provider identity, and
--    the recorded role is not a parameter of this operation at all.
create function private.resend_employee_invitation(
  p_invitation_id uuid,
  p_resend_count integer,
  p_outcome text,
  p_detail text default null,
  p_provider_user_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  inv public.employee_invitations;
  emp public.employees;
  outcome text := lower(btrim(coalesce(p_outcome,'')));
  detail text := nullif(btrim(coalesce(p_detail,'')),'');
begin
  if me is null or private.employee_role() is distinct from 'admin' then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_invitation_id is null or p_resend_count is null then
    raise exception 'invitation and resend count required' using errcode = '23514';
  end if;
  if outcome not in ('accepted','failed','ambiguous') then
    raise exception 'invalid provider outcome' using errcode = '23514';
  end if;
  if detail is not null and length(detail) > 500 then
    raise exception 'provider detail is too long' using errcode = '23514';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id;
  if inv.id is null then
    raise exception 'invitation not found' using errcode = 'P0023';
  end if;
  select * into emp from public.employees where id = inv.employee_id for update;
  if emp.id is null then
    raise exception 'invited employee not found' using errcode = 'P0023';
  end if;
  select * into inv from public.employee_invitations where id = p_invitation_id for update;
  if inv.state is distinct from 'recorded' then
    raise exception 'only a recorded invitation can be sent again' using errcode = 'P0024';
  end if;
  if inv.resend_count is distinct from p_resend_count then
    raise exception 'stale invitation resend; reload current state' using errcode = 'PT409';
  end if;
  if emp.email <> inv.email then
    raise exception 'the invitation does not match the intended address' using errcode = '23514';
  end if;
  if emp.auth_user_id is not null or emp.is_active or emp.account_deleted_at is not null then
    raise exception 'the invitation was already accepted; it cannot be sent again' using errcode = 'P0023';
  end if;
  if exists (
    select 1 from public.employee_admin_operations
    where employee_id = emp.id and kind = 'delete' and state <> 'completed'
  ) then
    raise exception 'employee access changed; restart the invitation' using errcode = 'P0023';
  end if;
  if outcome = 'accepted' and p_provider_user_id is distinct from inv.provider_user_id then
    raise exception 'an accepted resend requires the recorded provider identity' using errcode = '23514';
  end if;
  update public.employee_invitations set
    resend_count = resend_count + 1,
    resend_attempted_at = clock_timestamp(),
    resend_outcome = outcome,
    resend_detail = case when outcome = 'accepted' then null else detail end,
    resend_actor_id = me,
    updated_at = clock_timestamp()
    where id = inv.id returning * into inv;
  return private.employee_invitation_json(inv);
end;
$$;
comment on function private.resend_employee_invitation(uuid,integer,text,text,uuid) is
  'Records one further send of a recorded, still unaccepted invitation under the live admin''s authority. Refuses an accepted, active, deleted or deletion-in-flight employee, a changed address and a stale resend count, keeps the recorded role and provider identity, and never creates a second invitation row.';

-- 4. Public wrapper. Invoker, like the other invitation wrappers, so the acting admin is the
--    caller's own session and the private definer re-checks the live role.
create function public.resend_employee_invitation(
  p_invitation_id uuid,
  p_resend_count integer,
  p_outcome text,
  p_detail text default null,
  p_provider_user_id uuid default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.resend_employee_invitation(p_invitation_id,p_resend_count,p_outcome,p_detail,p_provider_user_id);
$$;

revoke all on function
  private.resend_employee_invitation(uuid,integer,text,text,uuid),
  public.resend_employee_invitation(uuid,integer,text,text,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.resend_employee_invitation(uuid,integer,text,text,uuid) to authenticated;
grant execute on function public.resend_employee_invitation(uuid,integer,text,text,uuid) to authenticated;
commit;
