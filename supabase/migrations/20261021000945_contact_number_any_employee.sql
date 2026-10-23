-- Recording a contact number on a property is a capture action, not a property-fact edit:
-- any live active employee may create a contact and link it to any unarchived property, while
-- correcting a recorded contact or removing a link stays staff/manager/admin. Both insert
-- policies are widened here; the update policies are deliberately untouched. The tables still
-- grant no insert to a browser role, so add_property_contact below stays the one write path
-- and the policies state the authority it enforces.
begin;

drop policy contacts_insert on public.contacts;
-- A contact row still has to be created by a live active employee, whatever their role.
create policy contacts_insert on public.contacts for insert to authenticated with check (
  private.employee_id() is not null
);

drop policy property_contacts_insert on public.property_contacts;
-- The link keeps its own requirement: the property exists and is not archived. It is
-- independent of who may edit the property's facts.
create policy property_contacts_insert on public.property_contacts for insert to authenticated with check (
  private.employee_id() is not null
  and exists (
    select 1 from public.properties p
    where p.id = property_id and p.archived_at is null
  )
);

-- The application's contact capture path: one call records the contact and its link, so a
-- refusal leaves neither half behind. Validation is the maintenance contact validation the
-- detail page already submits, so both surfaces accept and refuse the same input.
create function private.add_property_contact(p_property_id uuid, p_changes jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  prop public.properties;
  person public.contacts;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_property_id is null then raise exception 'property required' using errcode = '23514'; end if;
  perform private.validate_maintenance('contact', p_changes);
  perform private.maintenance_gate();
  -- Parent property row first, then the new contact and its link, as every other contact
  -- write does.
  select * into prop from public.properties where id = p_property_id for update;
  if not found or prop.archived_at is not null then
    raise exception 'unarchived property required' using errcode = '42501';
  end if;
  person.display_name := ''; person.phones := '{}'; person.contact_type := 'unknown';
  person := jsonb_populate_record(person, p_changes);
  if length(btrim(coalesce(person.display_name, ''))) not between 1 and 200 then
    raise exception 'contact name required' using errcode = '23514';
  end if;
  insert into public.contacts(display_name, phones, raw_phone_text, contact_type, notes)
    values (person.display_name, person.phones, person.raw_phone_text, person.contact_type, person.notes)
    returning * into person;
  -- A new link is never primary and supersedes nothing: every earlier contact of the property
  -- stays stored, linked and audited, and the newest recorded contact is the one a reader sees
  -- first.
  insert into public.property_contacts(property_id, contact_id, relation, is_primary)
    values (p_property_id, person.id, 'unknown', false);
  return person.id;
end;
$$;
create function public.add_property_contact(p_property_id uuid, p_changes jsonb)
returns uuid language sql security invoker set search_path = '' as $$
  select private.add_property_contact(p_property_id, p_changes);
$$;
revoke all on function private.add_property_contact(uuid,jsonb), public.add_property_contact(uuid,jsonb) from public, anon, authenticated;
grant execute on function private.add_property_contact(uuid,jsonb), public.add_property_contact(uuid,jsonb) to authenticated;

commit;
