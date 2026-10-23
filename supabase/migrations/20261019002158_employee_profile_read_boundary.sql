-- The employee record carries personal fields (bio, phone, email), so an employee reads only
-- their own row. The admin directory keeps its full read, and every surface that attributes a
-- colleague's name reads the minimal projection below instead of the whole row.
begin;

drop policy employees_read on public.employees;
create policy employees_read on public.employees for select to authenticated
  using (id = private.employee_id() or private.employee_role() = 'admin');

-- id and display name for the ids a surface already references; a null id list resolves every
-- recorded employee, which the summary views need. No email, phone, role or bio is exposed, and
-- a caller without live membership resolves nothing.
create function private.employee_names(p_ids uuid[])
returns table(id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.display_name
  from public.employees e
  where private.employee_id() is not null
    and (p_ids is null or e.id = any(p_ids))
  order by e.id;
$$;

-- The reviewer-only credited-closer options: the same identity plus the recorded sign-in link
-- and activation state the completion form renders. Bio, phone, email and role stay out.
create function private.employee_credit_options()
returns table(
  id uuid,
  display_name text,
  auth_user_id uuid,
  is_active boolean,
  account_deleted_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select e.id, e.display_name, e.auth_user_id, e.is_active, e.account_deleted_at
  from public.employees e
  where private.is_reviewer()
  order by e.display_name, e.id;
$$;

create function public.list_employee_names(p_ids uuid[])
returns table(id uuid, display_name text)
language sql security invoker set search_path = '' as $$
  select * from private.employee_names(p_ids);
$$;
create function public.list_employee_credit_options()
returns table(
  id uuid,
  display_name text,
  auth_user_id uuid,
  is_active boolean,
  account_deleted_at timestamptz
)
language sql security invoker set search_path = '' as $$
  select * from private.employee_credit_options();
$$;

revoke all on function private.employee_names(uuid[]),
  private.employee_credit_options()
  from public, anon, authenticated, service_role;
revoke all on function public.list_employee_names(uuid[]),
  public.list_employee_credit_options()
  from public, anon, authenticated, service_role;
grant execute on function private.employee_names(uuid[]),
  private.employee_credit_options()
  to authenticated;
grant execute on function public.list_employee_names(uuid[]),
  public.list_employee_credit_options()
  to authenticated;

-- These two invoker views join the employee record for attribution: they resolve the name
-- through the sanctioned projection so a colleague's row never has to be readable.
create or replace view public.v_effective_property_locks with (security_invoker = true) as
select l.*, n.display_name as employee_name
from public.property_locks l
join lateral private.employee_names(array[l.requested_by]) n on true
where l.status = 'approved' and l.expires_at > now();

create or replace view public.v_admin_locks_by_employee with (security_invoker = true) as
select e.id as employee_id,e.display_name,count(l.id) as effective_lock_count
from private.employee_names(null::uuid[]) e
left join public.v_effective_property_locks l on l.requested_by = e.id
where private.is_reviewer() group by e.id,e.display_name;

commit;
