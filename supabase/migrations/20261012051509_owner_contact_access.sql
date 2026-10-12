-- Ticket #29: deliberate owner-contact disclosure with a Vietnam-day access record.
-- Reuses the existing activity-event model, employee-scoped retry uniqueness and the
-- generated Vietnam business day; owner-contact events carry no visit-review state.
begin;

-- 1. Owner-contact access is a third activity kind. Existing page_view and site_visit rows
--    keep their kind, attribution, day and status; nothing is converted or backfilled.
alter table public.activity_events drop constraint if exists activity_events_kind_check;
alter table public.activity_events add constraint activity_events_kind_check
  check (kind in ('page_view','site_visit','owner_contact_access'));

-- 2. Physical-visit submission and confirmation are superseded. No public visit-mutation
--    entrypoint remains and no visit KPI is derived; retained site_visit rows stay readable.
create or replace function private.record_activity(p_property_id uuid,p_kind text,p_key uuid,p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); result uuid;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  -- site_visit submission is retired; page_view remains the only recordable kind.
  if p_kind <> 'page_view' or p_key is null then raise exception 'invalid activity'; end if;
  if not exists (
    select 1 from public.properties where id = p_property_id
      and (archived_at is null or private.is_reviewer())
  ) then raise exception 'property not found'; end if;
  insert into public.activity_events(employee_id,property_id,kind,idempotency_key,notes)
    values(me,p_property_id,p_kind,p_key,p_notes)
    on conflict (employee_id,idempotency_key) do nothing returning id into result;
  if result is null then
    select id into result from public.activity_events where employee_id = me and idempotency_key = p_key and property_id = p_property_id and kind = p_kind;
    if result is null then raise exception 'idempotency key reused with different payload'; end if;
  end if;
  return result;
end;
$$;
drop function public.review_property_visit(uuid,boolean);
drop function private.review_visit(uuid,boolean);

-- 3. Retire the pending/confirmed visit metrics; expose the daily owner-contact count.
drop view public.v_employee_daily_activity;
create view public.v_employee_daily_activity with (security_invoker = true) as
select employee_id,business_day,
  count(*) filter (where kind = 'page_view') as page_view_events,
  count(distinct property_id) filter (where kind = 'page_view') as distinct_properties_viewed,
  count(distinct property_id) filter (where kind = 'owner_contact_access') as owner_contact_properties
from public.activity_events group by employee_id,business_day;
revoke all on public.v_employee_daily_activity from public,anon,authenticated;
grant select on public.v_employee_daily_activity to authenticated,service_role;

-- 4. One transactional disclosure: live membership and property eligibility are checked, the
--    owner comes from the property's recorded relationship (never the contact's global type or
--    an inferred sheet relation), and an available owner phone is resolved before credit.
create function private.reveal_owner_contact(p_property_id uuid,p_key uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  target public.properties;
  chosen record;
  phone text;
  existing public.activity_events;
  created public.activity_events;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_key is null then raise exception 'invalid activity' using errcode = 'P0001'; end if;
  select * into target from public.properties where id = p_property_id;
  -- Archived contact review stays available to managers/admins; ordinary employees stay denied.
  if not found or (target.archived_at is not null and not private.is_reviewer()) then
    raise exception 'property not found' using errcode = 'P0002';
  end if;
  -- Resolution always reflects current recorded data; a missing owner or phone is explicit.
  select c.id,c.display_name,c.phones,pc.is_primary into chosen
  from public.property_contacts pc
  join public.contacts c on c.id = pc.contact_id
  where pc.property_id = p_property_id and pc.relation = 'owner'
    and exists (select 1 from unnest(c.phones) as p where btrim(p) <> '')
  order by pc.is_primary desc, pc.contact_id limit 1;
  if not found then
    if exists (select 1 from public.property_contacts where property_id = p_property_id and relation = 'owner')
      then raise exception 'owner phone missing' using errcode = 'P0004';
      else raise exception 'owner contact missing' using errcode = 'P0003';
    end if;
  end if;
  select btrim(p) into phone from unnest(chosen.phones) as p where btrim(p) <> '' limit 1;

  -- Authorized archived review is not eligible for new owner-contact credit.
  if target.archived_at is not null then
    return jsonb_build_object('eventId',null,
      'businessDay',(now() at time zone 'Asia/Ho_Chi_Minh')::date::text,'credited',false,
      'contact',jsonb_build_object('id',chosen.id,'displayName',chosen.display_name,
        'relation','owner','isPrimary',chosen.is_primary,'phone',phone));
  end if;

  insert into public.activity_events(employee_id,property_id,kind,idempotency_key)
    values(me,p_property_id,'owner_contact_access',p_key)
    on conflict (employee_id,idempotency_key) do nothing returning * into created;
  if created.id is null then
    select * into existing from public.activity_events where employee_id = me and idempotency_key = p_key;
    -- A recovered retry returns the original reference and day; another property is rejected.
    if not found or existing.property_id <> p_property_id or existing.kind <> 'owner_contact_access' then
      raise exception 'idempotency key reused with different payload' using errcode = 'P0005';
    end if;
  end if;
  return jsonb_build_object('eventId',coalesce(created.id,existing.id),
    'businessDay',coalesce(created.business_day,existing.business_day)::text,'credited',true,
    'contact',jsonb_build_object('id',chosen.id,'displayName',chosen.display_name,
      'relation','owner','isPrimary',chosen.is_primary,'phone',phone));
end;
$$;
create function public.reveal_owner_contact(p_property_id uuid,p_key uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.reveal_owner_contact(p_property_id,p_key);
$$;
revoke all on function private.reveal_owner_contact(uuid,uuid) from public,anon,authenticated;
grant execute on function private.reveal_owner_contact(uuid,uuid) to authenticated;
revoke all on function public.reveal_owner_contact(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reveal_owner_contact(uuid,uuid) to authenticated;

-- 5. Today's own report keeps page views and distinct properties, and adds the owner-contact
--    distinct-property count with explicit zeros. No stored total or second property flag.
drop function public.my_today_activity();
create function public.my_today_activity()
returns table(business_day date,page_view_events bigint,distinct_properties_viewed bigint,owner_contact_properties bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare
  me uuid := private.employee_id();
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  return query select today,
    (select count(*) from public.activity_events a
      where a.employee_id = me and a.kind = 'page_view' and a.business_day = today),
    (select count(distinct a.property_id) from public.activity_events a
      where a.employee_id = me and a.kind = 'page_view' and a.business_day = today),
    (select count(distinct a.property_id) from public.activity_events a
      where a.employee_id = me and a.kind = 'owner_contact_access' and a.business_day = today);
end;
$$;
revoke all on function public.my_today_activity() from public,anon,authenticated;
grant execute on function public.my_today_activity() to authenticated;
commit;
