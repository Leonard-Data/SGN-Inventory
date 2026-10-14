-- Ticket #34: reviewer-only employee owner-contact activity ranking over a validated Vietnam
-- date range. Every value is derived from the committed activity events, so no stored daily
-- total, ranking row or second counting definition is introduced, and the ranking is never a
-- sum of the currently-active rows the company report returns.
begin;

create function private.employee_owner_contact_ranking(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,employee_active boolean,owner_contact_properties bigint,rank_position bigint)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_scope integer;
begin
  -- Live role check on every call: an existing JWT does not preserve a changed role.
  if not private.is_reviewer() then
    raise exception 'manager or admin required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  -- At most 366 days, matching the company report and the application range validation.
  if p_to - p_from > 365 then
    raise exception 'date range too large' using errcode = '22023';
  end if;
  -- The Data API returns at most supabase/config.toml max_rows (1000) rows and the ranking is
  -- ordered by rank, so a wider employee scope would silently drop its lowest ranks.
  select count(*) into v_scope from (
    select e.id from public.employees e where e.is_active
    union
    select a.employee_id from public.activity_events a
      where a.business_day between p_from and p_to
  ) employee_scope;
  if v_scope > 1000 then
    raise exception 'ranking scope of % employees exceeds the 1000 row limit', v_scope
      using errcode = '54000';
  end if;
  return query
  with scope as (
    -- Every currently active employee, plus every employee with committed activity anywhere in
    -- the requested range. A contributor deactivated after recording it stays attributed to
    -- itself instead of being dropped or reassociated with another employee.
    select e.id,e.display_name,e.is_active from public.employees e where e.is_active
    union
    select e.id,e.display_name,e.is_active from public.employees e
      where exists (
        select 1 from public.activity_events a
        where a.employee_id = e.id and a.business_day between p_from and p_to
      )
  ), daily as (
    -- The established daily unit: one employee, one recorded property, one Vietnam business day.
    -- Committed rows are read as recorded, so later archival or contact correction cannot
    -- rewrite a past day and a missing or ineligible disclosure never becomes credit. Only the
    -- owner-contact kind earns the ranked unit; Page views and physical visits stay separate.
    select a.employee_id,a.business_day,
      count(distinct a.property_id) as owner_contact_properties
    from public.activity_events a
    where a.kind = 'owner_contact_access'
      and a.business_day between p_from and p_to
    group by a.employee_id,a.business_day
  ), totals as (
    -- Every range total sums those daily units, so a repeated reveal of one property on one day
    -- adds nothing while the same property on a later Vietnam day adds again.
    select d.employee_id,
      sum(d.owner_contact_properties)::bigint as owner_contact_properties
    from daily d
    group by d.employee_id
  )
  select s.id,s.display_name,s.is_active,
    coalesce(t.owner_contact_properties,0),
    -- Equal owner-contact totals share a rank; the deterministic name/id order below is the
    -- stable tie-break, so the same request always returns the same sequence.
    rank() over (order by coalesce(t.owner_contact_properties,0) desc)
  from scope s
  left join totals t on t.employee_id = s.id
  order by coalesce(t.owner_contact_properties,0) desc,s.display_name,s.id;
end;
$$;

create function public.employee_owner_contact_ranking(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,employee_active boolean,owner_contact_properties bigint,rank_position bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.employee_owner_contact_ranking(p_from,p_to);
$$;

revoke all on function private.employee_owner_contact_ranking(date,date) from public,anon,authenticated;
grant execute on function private.employee_owner_contact_ranking(date,date) to authenticated;
revoke all on function public.employee_owner_contact_ranking(date,date) from public,anon,authenticated;
grant execute on function public.employee_owner_contact_ranking(date,date) to authenticated;
commit;
