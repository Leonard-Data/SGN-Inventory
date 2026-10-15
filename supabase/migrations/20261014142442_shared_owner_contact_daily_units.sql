-- Reconstructed migration file, 15 October 2026.
-- Version 20261014142442 is recorded as applied on the development project
-- (tneucwzcrzteeixvttpu) but its file exists on no git ref. The statement text and
-- comments below are the statements recorded for this version in
-- supabase_migrations.schema_migrations; only the statement terminators were restored
-- so the file parses as ordinary SQL. The file is named as recorded:
-- shared_owner_contact_daily_units.
-- Consolidate the owner-contact counting unit shared by the two company-wide activity reads.
-- One private view defines the active-employee, owner_contact_access, (employee, property,
-- generated Asia/Ho_Chi_Minh business day) unit; private.company_employee_daily_activity and
-- private.company_province_owner_contact_activity read it instead of restating the filter, so
-- the company daily figures and the province table cannot drift apart. Report shapes, ordering,
-- role checks, range guards and grants are unchanged.
begin;

create view private.owner_contact_daily_units with (security_invoker = true) as
select a.employee_id,a.property_id,a.business_day
from public.activity_events a
join public.employees e on e.id = a.employee_id and e.is_active
where a.kind = 'owner_contact_access'
group by a.employee_id,a.property_id,a.business_day;

revoke all on private.owner_contact_daily_units from public,anon,authenticated;

-- Live role, range and row-cap checks keep their existing refusals; the SQL-bodied reads
-- below run the guard before producing any report row, and the guard stays private.
create function private.company_activity_guard(p_from date,p_to date) returns void
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
end;
$$;

revoke all on function private.company_activity_guard(date,date) from public,anon,authenticated;

create function private.province_activity_guard(p_from date,p_to date) returns void
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
end;
$$;

revoke all on function private.province_activity_guard(date,date) from public,anon,authenticated;

create or replace function private.company_employee_daily_activity(p_from date,p_to date)
returns table(employee_id uuid,employee_name text,business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language sql stable security definer set search_path = ''
begin atomic
  select private.company_activity_guard(p_from,p_to);
  with scope as (
    -- The scope is every currently active employee on every requested day, including days
    -- with no events, so a missing grouped row never omits a row. A deactivated employee's
    -- historical events are not listed in this slice.
    select e.id,e.display_name from public.employees e where e.is_active
  ), days as (
    select gs::date as day from generate_series(p_from,p_to,interval '1 day') as gs
  )
  select s.id,s.display_name,d.day,
    coalesce(pv.page_view_events,0),
    coalesce(pv.distinct_properties_viewed,0),
    coalesce(oc.owner_contact_properties,0)
  from scope s
  cross join days d
  left join lateral (
    select count(*) filter (where a.kind = 'page_view') as page_view_events,
      count(distinct a.property_id) filter (where a.kind = 'page_view') as distinct_properties_viewed
    from public.activity_events a
    where a.employee_id = s.id and a.business_day = d.day
  ) pv on true
  left join lateral (
    -- The owner-contact count is the shared daily unit, never a restated distinct count.
    select count(*) as owner_contact_properties
    from private.owner_contact_daily_units u
    where u.employee_id = s.id and u.business_day = d.day
  ) oc on true
  order by d.day desc,s.display_name,s.id;
end;

create or replace function private.company_province_owner_contact_activity(p_from date,p_to date)
returns table(province_unit_id uuid,official_code text,province_name text,owner_contact_properties bigint)
language sql stable security definer set search_path = ''
begin atomic
  select private.province_activity_guard(p_from,p_to);
  with units as (
    -- The one shared owner-contact unit: one active employee, one property and one generated
    -- Asia/Ho_Chi_Minh business day. Several owners, phones or reveals on one property stay
    -- one unit; two employees, another property or a later day count independently; and the
    -- parent property's archive state never removes committed history.
    select u.employee_id,u.property_id,u.business_day
    from private.owner_contact_daily_units u
    where u.business_day between p_from and p_to
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

commit;
