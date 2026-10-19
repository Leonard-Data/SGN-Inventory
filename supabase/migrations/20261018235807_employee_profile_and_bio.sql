-- Employee profile edit: an admin edits a colleague's recorded identity from the employee
-- directory, and every active employee edits their own display name and bio from the account
-- menu. Both paths are additive: the existing `employees_read`/`employees_admin_update` policy
-- posture is untouched, the email that identifies the sign-in identity is not an editable field
-- anywhere, and the existing `employee_admin_state_guard` and `audit_employees` triggers keep
-- enforcing the last-active-admin rule and recording who made a change.
begin;

-- 1. Bio: one short line a person writes about themselves. It is stored trimmed, bounded and
--    link-free, so nothing here can become rich text, a link or an unbounded profile field.
--    NULL means "not written"; an empty submission is normalized to NULL by the guarded RPCs.
alter table public.employees add column bio text;
alter table public.employees add constraint employees_bio_check check (
  bio is null or (
    bio = btrim(bio)
    and length(bio) between 1 and 280
    and bio !~ '[<>]'
    and bio !~* '(https?://|www\.)'
  )
);
comment on column public.employees.bio is 'Optional plain-text self-description of at most 280 characters, trimmed, without markup or a link; shown on the person''s entry in the employee directory.';

-- 2. One rule for an edited free-text field, shared by the admin edit and a person's own
--    profile, so neither path can accept what the other refuses: trimmed, absent when blank,
--    bounded, and plain text only.
create function private.employee_profile_text(p_value text, p_max integer, p_label text)
returns text language plpgsql immutable security invoker set search_path = '' as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then return null; end if;
  if length(v) > p_max then
    raise exception '% exceeds % characters', p_label, p_max using errcode = '23514';
  end if;
  if v ~ '[<>]' or v ~* '(https?://|www\.)' then
    raise exception '% is plain text only', p_label using errcode = '23514';
  end if;
  return v;
end;
$$;

-- 3. The admin edit. The acting admin comes from live membership, the target row is locked
--    before anything is written, and the recorded email is deliberately not a parameter: the
--    address that identifies the account cannot be changed here. A deactivated (linked but
--    disabled) or account-deleted employee is refused instead of silently keeping the old
--    values, and an unlinked identity that was never activated stays editable so a mistyped
--    invitee name can still be corrected. The role change runs through the existing
--    `employee_admin_state_guard`, which refuses P0010 when it would leave no active admin,
--    and the existing `audit_employees` trigger records the before/after snapshot with the
--    acting Auth identity.
create function private.update_employee_profile(
  p_employee_id uuid,
  p_display_name text,
  p_phone text,
  p_role text,
  p_bio text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.employees;
  v_name text := private.employee_profile_text(p_display_name, 120, 'display name');
  v_phone text := private.employee_profile_text(p_phone, 40, 'phone');
  v_role text := lower(btrim(coalesce(p_role, '')));
  v_bio text := private.employee_profile_text(p_bio, 280, 'bio');
  v_changed text[] := array[]::text[];
begin
  if me is null or private.employee_role() is distinct from 'admin' then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_employee_id is null then
    raise exception 'employee required' using errcode = '23514';
  end if;
  if v_name is null then
    raise exception 'display name is required' using errcode = '23514';
  end if;
  if v_role not in ('sales', 'staff', 'manager', 'admin') then
    raise exception 'unsupported role' using errcode = '23514';
  end if;
  -- Property -> employee ordering is not involved here; the employee row is the only lock.
  select * into target from public.employees where id = p_employee_id for update;
  if target.id is null then
    raise exception 'employee not found' using errcode = 'P0013';
  end if;
  if target.account_deleted_at is not null
    or (target.auth_user_id is not null and not target.is_active)
  then
    raise exception 'a deactivated or deleted employee cannot be edited' using errcode = 'P0014';
  end if;
  if v_name is distinct from target.display_name then
    v_changed := v_changed || 'displayName'::text;
  end if;
  if v_phone is distinct from target.phone then
    v_changed := v_changed || 'phone'::text;
  end if;
  if v_role is distinct from target.role then
    v_changed := v_changed || 'role'::text;
  end if;
  if v_bio is distinct from target.bio then
    v_changed := v_changed || 'bio'::text;
  end if;
  if cardinality(v_changed) > 0 then
    update public.employees
      set display_name = v_name, phone = v_phone, role = v_role, bio = v_bio
      where id = target.id;
  end if;
  return jsonb_build_object('employeeId', target.id, 'changed', to_jsonb(v_changed));
end;
$$;

-- 4. A person's own profile: their display name and their bio, nothing else. There is no
--    employee parameter, so this path cannot name another person at all; the subject is the
--    live membership the session resolves to, which also refuses an inactive, unlinked or
--    deleted identity by matching no row.
create function private.update_my_profile(p_display_name text, p_bio text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.employees;
  v_name text := private.employee_profile_text(p_display_name, 120, 'display name');
  v_bio text := private.employee_profile_text(p_bio, 280, 'bio');
begin
  if me is null then
    raise exception 'active employee required' using errcode = '42501';
  end if;
  if v_name is null then
    raise exception 'display name is required' using errcode = '23514';
  end if;
  update public.employees
    set display_name = v_name, bio = v_bio
    where id = me
    returning * into target;
  return jsonb_build_object(
    'displayName', target.display_name,
    'bio', target.bio
  );
end;
$$;

-- 5. Public invoker wrappers, following the existing guarded-RPC pattern: the private definers
--    stay unexposed and only a live authenticated caller reaches them.
create function public.update_employee_profile(
  p_employee_id uuid,
  p_display_name text,
  p_phone text,
  p_role text,
  p_bio text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.update_employee_profile(p_employee_id, p_display_name, p_phone, p_role, p_bio);
$$;
create function public.update_my_profile(p_display_name text, p_bio text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.update_my_profile(p_display_name, p_bio);
$$;

revoke all on function private.employee_profile_text(text, integer, text),
  private.update_employee_profile(uuid, text, text, text, text),
  private.update_my_profile(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.update_employee_profile(uuid, text, text, text, text),
  public.update_my_profile(text, text)
  from public, anon, authenticated, service_role;
-- The public wrappers are invoker functions, so the caller needs the private definer's EXECUTE
-- as well; the private schema stays unexposed, exactly as the existing guarded RPCs arrange it.
grant execute on function private.update_employee_profile(uuid, text, text, text, text),
  private.update_my_profile(text, text)
  to authenticated;
grant execute on function public.update_employee_profile(uuid, text, text, text, text),
  public.update_my_profile(text, text)
  to authenticated;

commit;
