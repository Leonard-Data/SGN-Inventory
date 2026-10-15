-- Ticket #35: reviewer-only province owner-contact activity. A manager/admin reads the
-- committed owner-contact daily units of the same scope as the company employee-by-day
-- report, grouped by each property's latest verified primary current province/city, with an
-- always-reported Unverified group for properties whose province cannot be resolved. The
-- table is derived at read time from public.activity_events and public.property_addresses,
-- so it stores no event-time geography snapshot, area total or second counting definition,
-- and a later address correction regroups earlier units without changing the company total.
begin;

create function private.company_province_owner_contact_activity(p_from date,p_to date)
returns table(province_unit_id uuid,official_code text,province_name text,owner_contact_properties bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  -- Live role check on every call: an existing JWT does not preserve a changed role.
  if not private.is_reviewer() then
    raise exception 'manager or admin required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'invalid date range' using errcode = '22023';
  end if;
  -- At most 366 days, matching the application range validation and the sibling reports.
  if p_to - p_from > 365 then
    raise exception 'date range too large' using errcode = '22023';
  end if;
  return query
  with units as (
    -- One counting unit per employee, property and generated Asia/Ho_Chi_Minh business day.
    -- The employee scope is currently active employees, exactly like
    -- company_employee_daily_activity, so province plus Unverified totals equal that report's
    -- same-period owner-contact sum. Several owners, phones or reveals on one property stay
    -- one unit; two employees, another property or a later day count independently; and the
    -- parent property's archive state never removes committed history.
    select a.employee_id,a.property_id,a.business_day
    from public.activity_events a
    join public.employees e on e.id = a.employee_id and e.is_active
    where a.kind = 'owner_contact_access' and a.business_day between p_from and p_to
    group by a.employee_id,a.property_id,a.business_day
  ), located as (
    -- The primary current address is unique per property (addresses_primary_unique), so its
    -- verified designation is unambiguous. An absent, candidate, unresolved or non-primary
    -- current address keeps the property's units in the Unverified group: raw legacy province
    -- text is never treated as a verified unit, a partial transition is never guessed and no
    -- unit is discarded.
    select u.employee_id,u.property_id,u.business_day,canon.province_unit_id,canon.official_code,canon.province_name
    from units u
    left join public.property_addresses pa
      on pa.property_id = u.property_id and pa.format = 'current' and pa.is_primary and pa.mapping_status = 'verified'
    left join lateral (
      -- The grouping identity is the official catalog identity, not editable label text: the
      -- newest version of the same official province code is the canonical current
      -- province/city, so one province is never split across catalog revisions. A version
      -- whose code cannot be resolved yields no identity and therefore the Unverified group.
      select v.id as province_unit_id,v.official_code,v.name_vi as province_name
      from public.admin_unit_versions v
      where v.unit_level = 'province'
        and v.official_code = (select pv.official_code from public.admin_unit_versions pv where pv.id = pa.province_unit_id)
      order by v.valid_from desc,v.id desc
      limit 1
    ) canon on pa.id is not null
  ), groups as (
    select l.province_unit_id,l.official_code,l.province_name,count(*) as owner_contact_properties
    from located l
    group by l.province_unit_id,l.official_code,l.province_name
  )
  select g.province_unit_id,g.official_code,g.province_name,g.owner_contact_properties
  from (
    select * from groups
    union all
    -- The Unverified group is always reported, so its zero is explicit rather than a silently
    -- absent row. Provinces with no eligible unit in the period are omitted: the table lists
    -- activity, not the whole catalog.
    select null::uuid,null::text,null::text,0::bigint
    where not exists (select 1 from groups where groups.province_unit_id is null)
  ) g
  -- Highest count first, then a deterministic name and identity order; the Unverified group
  -- has no name and no identity, so it sorts last inside its count band.
  order by g.owner_contact_properties desc,nullif(g.province_name,'') nulls last,g.province_unit_id nulls last;
end;
$$;

create function public.company_province_owner_contact_activity(p_from date,p_to date)
returns table(province_unit_id uuid,official_code text,province_name text,owner_contact_properties bigint)
language sql stable security invoker set search_path = '' as $$
  select * from private.company_province_owner_contact_activity(p_from,p_to);
$$;

revoke all on function private.company_province_owner_contact_activity(date,date) from public,anon,authenticated;
grant execute on function private.company_province_owner_contact_activity(date,date) to authenticated;
revoke all on function public.company_province_owner_contact_activity(date,date) from public,anon,authenticated;
grant execute on function public.company_province_owner_contact_activity(date,date) to authenticated;
commit;
