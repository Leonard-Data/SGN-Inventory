-- Ticket #29 follow-up: recover the employee-scoped retry before any archive short-circuit
-- or owner resolution, so a reused key is rejected on every path and a lost response always
-- returns the original committed reference and day.
begin;

create or replace function private.reveal_owner_contact(p_property_id uuid,p_key uuid)
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

  -- A matching retry is recovered first: live membership and property eligibility were just
  -- rechecked, a mismatched property is rejected, and the original reference/day is returned
  -- even if the owner phone or the archive state changed after the commit.
  select * into existing from public.activity_events where employee_id = me and idempotency_key = p_key;
  if found then
    if existing.property_id <> p_property_id or existing.kind <> 'owner_contact_access' then
      raise exception 'idempotency key reused with different payload' using errcode = 'P0005';
    end if;
    select c.id,c.display_name,c.phones,pc.is_primary into chosen
    from public.property_contacts pc
    join public.contacts c on c.id = pc.contact_id
    where pc.property_id = p_property_id and pc.relation = 'owner'
    order by pc.is_primary desc, pc.contact_id limit 1;
    if found then
      select btrim(p) into phone from unnest(chosen.phones) as p where btrim(p) <> '' limit 1;
      return jsonb_build_object('eventId',existing.id,'businessDay',existing.business_day::text,
        'credited',true,'contact',jsonb_build_object('id',chosen.id,'displayName',chosen.display_name,
          'relation','owner','isPrimary',chosen.is_primary,'phone',coalesce(phone,'')));
    end if;
    return jsonb_build_object('eventId',existing.id,'businessDay',existing.business_day::text,
      'credited',true,'contact',null);
  end if;

  -- A new disclosure requires the recorded owner relation and an actually available phone.
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
    if not found or existing.property_id <> p_property_id or existing.kind <> 'owner_contact_access' then
      raise exception 'idempotency key reused with different payload' using errcode = 'P0005';
    end if;
    return jsonb_build_object('eventId',existing.id,'businessDay',existing.business_day::text,
      'credited',true,'contact',jsonb_build_object('id',chosen.id,'displayName',chosen.display_name,
        'relation','owner','isPrimary',chosen.is_primary,'phone',phone));
  end if;
  return jsonb_build_object('eventId',created.id,'businessDay',created.business_day::text,
    'credited',true,'contact',jsonb_build_object('id',chosen.id,'displayName',chosen.display_name,
      'relation','owner','isPrimary',chosen.is_primary,'phone',phone));
end;
$$;
commit;
