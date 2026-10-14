-- Ticket #30: an employee's own activity across an explicit Vietnam date range. The report
-- is derived from the existing activity-event model, so no stored daily total or second
-- counting definition is introduced, and the caller's employee identity is never a parameter.
begin;

-- One row per requested Vietnam calendar day for the caller's own events alone. Committed
-- credit is read from `activity_events` unchanged, so later archival or contact correction
-- cannot rewrite a past day, and several owners, phones or reveals on one property still
-- count one property per day.
create function public.my_daily_activity(p_from date,p_to date)
returns table(business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare
  me uuid := private.employee_id();
begin
  -- Live membership on every call: an existing JWT does not preserve a changed role.
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  -- At most 366 days, matching the application range validation and staying inside the
  -- Data API row cap because the scope is a single employee.
  if p_to - p_from > 365 then
    raise exception 'date range too large' using errcode = '22023';
  end if;
  return query
  with days as (
    select gs::date as day from generate_series(p_from,p_to,interval '1 day') as gs
  )
  select d.day,
    count(a.id) filter (where a.kind = 'page_view'),
    count(distinct a.property_id) filter (where a.kind = 'page_view'),
    count(distinct a.property_id) filter (where a.kind = 'owner_contact_access')
  from days d
  -- Every requested day appears even with no event, so a missing grouped row never omits a
  -- day and an empty range reports explicit zeros rather than a short read.
  left join public.activity_events a
    on a.employee_id = me and a.business_day = d.day
  group by d.day
  order by d.day desc;
end;
$$;
revoke all on function public.my_daily_activity(date,date) from public,anon,authenticated;
grant execute on function public.my_daily_activity(date,date) to authenticated;
commit;
