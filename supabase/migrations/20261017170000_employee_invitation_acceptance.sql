-- Issue #69: accept a recorded employee invitation and complete the chosen onboarding journey.
-- The invitee activates themselves immediately on completing setup (C1): a valid, current,
-- correctly matched invitation completed by the intended invitee links the exact recorded
-- provider identity, sets the required name and enables membership at once. No manager
-- approval follows. The invitation send path, the recorded invitation schema, role binding
-- and recovery behaviour are unchanged; this adds only the acceptance operation that #68
-- deliberately left out.
begin;

-- 1. The one acceptance transition. It is an invoker-authorized operation: the caller's own
--    session (auth.uid()) must be the exact provider identity the accepted invitation
--    recorded, so an email match alone, a wrong identity, an arbitrary redirect, password
--    recovery or edited metadata can never link, activate or promote an employee. The
--    invitation stays terminal (`recorded`) and is never rewritten; "consumed" is the
--    employee now being linked and active, so a repeated or interrupted setup converges on
--    that same person and role instead of assigning them to anyone else.
create function private.accept_employee_invitation(
  p_invitation_id uuid,
  p_revision integer,
  p_display_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  name text := btrim(coalesce(p_display_name,''));
  inv public.employee_invitations;
  emp public.employees;
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
  update public.employees
    set auth_user_id = me, display_name = name, is_active = true
    where id = emp.id;
  return jsonb_build_object(
    'id',emp.id,'displayName',name,'email',emp.email,
    'role',emp.role,'locale',coalesce(emp.preferred_locale,'vi'));
end;
$$;
comment on function private.accept_employee_invitation(uuid,integer,text) is
  'Links and activates the exact intended invitee on the recorded invitation, setting the required name. The caller''s session must be the recorded provider identity; consumed, deactivated, deleted or mismatched invitations are refused and never restore access.';

-- 2. The public invoker wrapper, exactly like the other guarded employee operations.
create function public.accept_employee_invitation(p_invitation_id uuid,p_revision integer,p_display_name text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.accept_employee_invitation(p_invitation_id,p_revision,p_display_name);
$$;

-- 3. Explicit access. The caller's own session is the authority, so the invoker boundary is
--    `authenticated`; the private schema stays unexposed and no service-role bypass is added.
revoke all on function private.accept_employee_invitation(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function private.accept_employee_invitation(uuid,integer,text) to authenticated;
revoke all on function public.accept_employee_invitation(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.accept_employee_invitation(uuid,integer,text) to authenticated;

-- 4. The acceptance participates in the existing private audit trail: the employee update is
--    already audited by the employees trigger, and the invitation row itself is unchanged, so
--    no new audit surface is introduced.
commit;
