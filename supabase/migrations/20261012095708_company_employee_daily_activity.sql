-- Ticket #31: company employee-by-day activity. A manager/admin reads every employee's
-- committed Page view, distinct properties viewed and Daily owner-contact access count per
-- Asia/Ho_Chi_Minh business day. The report is derived from the existing activity-event
-- model, so no stored daily total or second counting definition is introduced.
begin;

create function private.company_employee_daily_activity(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language plpgsql stable security definer set search_path = '' as $$
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
  return query
  with scope as (
    -- Every active employee appears on every requested day, including days with no events,
    -- so a missing grouped event row never omits a row. A deactivated employee keeps only
    -- the days that carry activity already committed in the range, so deactivation never
    -- erases historical attribution.
    select e.id,e.display_name from public.employees e where e.is_active
    union
    select e.id,e.display_name from public.employees e
      where exists (select 1 from public.activity_events a
        where a.employee_id = e.id and a.business_day between p_from and p_to)
  ), days as (
    select gs::date as day from generate_series(p_from,p_to,interval '1 day') as gs
  )
  select s.id,s.display_name,d.day,
    count(a.id) filter (where a.kind = 'page_view'),
    count(distinct a.property_id) filter (where a.kind = 'page_view'),
    count(distinct a.property_id) filter (where a.kind = 'owner_contact_access')
  from scope s
  cross join days d
  left join public.activity_events a
    on a.employee_id = s.id and a.business_day = d.day
  group by s.id,s.display_name,d.day
  order by d.day desc,s.display_name,s.id;
end;
$$;

create function public.company_employee_daily_activity(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.company_employee_daily_activity(p_from,p_to);
$$;

revoke all on function private.company_employee_daily_activity(date,date) from public,anon,authenticated;
grant execute on function private.company_employee_daily_activity(date,date) to authenticated;
revoke all on function public.company_employee_daily_activity(date,date) from public,anon,authenticated;
grant execute on function public.company_employee_daily_activity(date,date) to authenticated;
commit;
