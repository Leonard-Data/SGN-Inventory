-- Company activity report grouping: the daily matrix carries the employee's recorded email so the
-- report can label one group per employee. The email comes from the same public.employees row the
-- report already scopes to, under the same live manager/admin check, so no table, grant or read
-- scope is added.
begin;

-- The return type gains a column, which CREATE OR REPLACE cannot do; both functions are replaced
-- together and their grants are restored below.
drop function public.company_employee_daily_activity(date,date);
drop function private.company_employee_daily_activity(date,date);

create function private.company_employee_daily_activity(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,employee_email text,business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_employees integer;
  v_days integer;
begin
  -- Live role check on every call: an existing JWT does not preserve a changed role.
  if not private.is_reviewer() then
    raise exception 'manager or admin required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  if p_to - p_from > 365 then
    raise exception 'date range too large' using errcode = '22023';
  end if;
  -- The Data API returns at most supabase/config.toml max_rows (1000) rows, ordered by day
  -- descending, so a wider employee-by-day scope would silently drop its oldest days.
  select count(*) into v_employees from public.employees e where e.is_active;
  v_days := p_to - p_from + 1;
  if v_employees * v_days > 1000 then
    raise exception 'company report scope of % active employees over % days exceeds the 1000 row limit',
      v_employees, v_days using errcode = '54000';
  end if;
  return query
  with scope as (
    -- The scope is every currently active employee on every requested day, including days
    -- with no events, so a missing grouped row never omits a row. A deactivated employee's
    -- historical events are not listed in this slice. The email is the employee's recorded
    -- identity, which the report uses only as the group label.
    select e.id,e.display_name,e.email from public.employees e where e.is_active
  ), days as (
    select gs::date as day from generate_series(p_from,p_to,interval '1 day') as gs
  )
  select s.id,s.display_name,s.email,d.day,
    count(a.id) filter (where a.kind = 'page_view'),
    count(distinct a.property_id) filter (where a.kind = 'page_view'),
    count(distinct a.property_id) filter (where a.kind = 'owner_contact_access')
  from scope s
  cross join days d
  left join public.activity_events a
    on a.employee_id = s.id and a.business_day = d.day
  group by s.id,s.display_name,s.email,d.day
  order by d.day desc,s.display_name,s.id;
end;
$$;

create function public.company_employee_daily_activity(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,employee_email text,business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.company_employee_daily_activity(p_from,p_to);
$$;

revoke all on function private.company_employee_daily_activity(date,date) from public,anon,authenticated;
grant execute on function private.company_employee_daily_activity(date,date) to authenticated;
revoke all on function public.company_employee_daily_activity(date,date) from public,anon,authenticated;
grant execute on function public.company_employee_daily_activity(date,date) to authenticated;
commit;
