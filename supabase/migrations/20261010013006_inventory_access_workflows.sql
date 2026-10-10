begin;
-- Private definers are narrowly scoped. Public RPCs are invoker wrappers.
create function private.employee_id() returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.employees where auth_user_id = auth.uid() and is_active;
$$;
create function private.employee_role() returns text language sql stable security definer set search_path = '' as $$
  select role from public.employees where auth_user_id = auth.uid() and is_active;
$$;
create function private.is_reviewer() returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(private.employee_role() in ('manager','admin'), false);
$$;
create function private.can_edit_property(p_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.employee_id() is not null and exists (
    select 1 from public.properties where id = p_id and archived_at is null
      and (created_by = private.employee_id() or private.employee_role() in ('staff','manager','admin'))
  );
$$;

create function private.audit_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into private.audit_events(actor_user_id, table_name, record_key, action, before_data, after_data)
  values (auth.uid(), tg_table_name, coalesce(to_jsonb(new)->>'id', to_jsonb(old)->>'id', to_jsonb(new)->>'property_id', to_jsonb(old)->>'property_id'),
    tg_op, case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
create function private.guard_property() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if auth.uid() is not null then
    if private.employee_id() is null then raise exception 'inactive employee' using errcode = '42501'; end if;
    if tg_op = 'UPDATE' and new.created_by is distinct from old.created_by then
      raise exception 'creator is immutable' using errcode = '42501';
    end if;
    if not private.is_reviewer() and (
      (tg_op = 'INSERT' and (new.record_review_status <> 'pending' or new.legal_status <> 'unknown' or new.status in ('sold','rented') or new.archived_at is not null))
      or (tg_op = 'UPDATE' and (new.record_review_status is distinct from old.record_review_status
        or new.legal_status is distinct from old.legal_status or new.archived_at is distinct from old.archived_at
        or (new.status is distinct from old.status and new.status in ('sold','rented'))))
    ) then raise exception 'reviewer required for review or final status' using errcode = '42501'; end if;
    new.updated_by := private.employee_id();
    if tg_op = 'INSERT' then new.created_by := private.employee_id(); new.created_at := now(); end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger property_guard before insert or update on public.properties for each row execute function private.guard_property();

create function private.guard_address() returns trigger language plpgsql security definer set search_path = '' as $$
declare p public.admin_unit_versions; d public.admin_unit_versions; c public.admin_unit_versions;
begin
  if auth.uid() is not null and not private.is_reviewer() then
    if new.mapping_status = 'verified' or new.verified_by is not null or new.verified_at is not null then
      raise exception 'reviewer required for address verification' using errcode = '42501';
    end if;
  end if;
  if new.mapping_status = 'verified' and auth.uid() is not null then
    new.verified_by := private.employee_id(); new.verified_at := now();
  end if;
  if new.province_unit_id is not null then
    select * into p from public.admin_unit_versions where id = new.province_unit_id;
    if p.unit_level <> 'province' then raise exception 'province level mismatch'; end if;
  end if;
  if new.district_unit_id is not null then
    select * into d from public.admin_unit_versions where id = new.district_unit_id;
    if d.unit_level <> 'district' or d.parent_id is distinct from new.province_unit_id then raise exception 'district hierarchy mismatch'; end if;
  end if;
  if new.commune_unit_id is not null then
    select * into c from public.admin_unit_versions where id = new.commune_unit_id;
    if c.unit_level <> 'commune' or c.parent_id is distinct from coalesce(new.district_unit_id,new.province_unit_id) then
      raise exception 'commune hierarchy mismatch';
    end if;
  end if;
  if new.mapping_status = 'verified' and (new.effective_on is null or new.effective_on < p.valid_from
      or (p.valid_to is not null and new.effective_on >= p.valid_to)
      or new.effective_on < c.valid_from or (c.valid_to is not null and new.effective_on >= c.valid_to)
      or (new.district_unit_id is not null and (new.effective_on < d.valid_from or (d.valid_to is not null and new.effective_on >= d.valid_to)))) then
    raise exception 'address date outside unit validity';
  end if;
  return new;
end;
$$;
create trigger address_guard before insert or update on public.property_addresses for each row execute function private.guard_address();

create function private.expire_property_locks(p_property_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Called under the parent property row lock by each workflow; never granted to clients.
  for r in update public.property_locks set status = 'expired'
    where property_id = p_property_id and status in ('pending','approved') and expires_at <= now() returning id
  loop
    insert into public.lock_events(lock_id, actor_id, action, reason)
      values (r.id,private.employee_id(),'expired','Expiry time reached');
  end loop;
end;
$$;
create function private.request_lock(p_property_id uuid, p_reason text, p_evidence_file_id uuid, p_reference text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); new_id uuid; st text;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  select status into st from public.properties where id = p_property_id and archived_at is null for update;
  if not found or st not in ('available','negotiating') then raise exception 'property is not available for reservation'; end if;
  perform private.expire_property_locks(p_property_id);
  if exists (select 1 from public.property_locks where property_id = p_property_id and status = 'approved') then
    raise exception 'property already reserved' using errcode = '23505';
  end if;
  if p_evidence_file_id is not null and not exists (select 1 from public.property_files
      where id = p_evidence_file_id and property_id = p_property_id and upload_status = 'ready') then
    raise exception 'evidence must be a ready file on this property';
  end if;
  insert into public.property_locks(property_id,requested_by,reason,evidence_file_id,attribution_reference)
    values(p_property_id,me,p_reason,p_evidence_file_id,p_reference) returning id into new_id;
  insert into public.lock_events(lock_id,actor_id,action,reason) values(new_id,me,'requested',p_reason);
  return new_id;
end;
$$;
create function private.decide_lock(p_lock_id uuid, p_approve boolean, p_reason text, p_days integer) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); l public.property_locks; prop uuid; st text;
begin
  if me is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode = '42501'; end if;
  if p_approve is null or p_days is null or p_days not between 1 and 30 or length(btrim(coalesce(p_reason,''))) < 10 then
    raise exception 'decision, 1-30 days and meaningful reason required';
  end if;
  select property_id into prop from public.property_locks where id = p_lock_id;
  if not found then raise exception 'lock not found'; end if;
  select status into st from public.properties where id = prop and archived_at is null for update;
  if not found then raise exception 'property not available'; end if;
  perform private.expire_property_locks(prop);
  select * into l from public.property_locks where id = p_lock_id for update;
  if l.status <> 'pending' then raise exception 'request is no longer pending'; end if;
  if l.requested_by = me then raise exception 'self approval forbidden' using errcode = '42501'; end if;
  if not exists (select 1 from public.employees where id = l.requested_by and is_active) then raise exception 'requester is inactive'; end if;
  if p_approve and st not in ('available','negotiating') then raise exception 'property is not available for reservation'; end if;
  if p_approve and exists (select 1 from public.property_locks where property_id = prop and status = 'approved') then
    raise exception 'another approved reservation exists' using errcode = '23505';
  end if;
  update public.property_locks set status = case when p_approve then 'approved' else 'rejected' end,
    decided_by = me, decided_at = now(), decision_reason = p_reason,
    expires_at = case when p_approve then now() + make_interval(days => p_days) else expires_at end
    where id = p_lock_id;
  insert into public.lock_events(lock_id,actor_id,action,reason)
    values(p_lock_id,me,case when p_approve then 'approved' else 'rejected' end,p_reason);
end;
$$;
create function private.release_lock(p_lock_id uuid, p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); l public.property_locks; prop uuid;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_reason,''))) < 10 then raise exception 'meaningful release reason required'; end if;
  select property_id into prop from public.property_locks where id = p_lock_id;
  if not found then raise exception 'lock not found'; end if;
  perform 1 from public.properties where id = prop for update;
  perform private.expire_property_locks(prop);
  select * into l from public.property_locks where id = p_lock_id for update;
  if l.requested_by <> me and not private.is_reviewer() then raise exception 'owner or reviewer required' using errcode = '42501'; end if;
  if l.status not in ('pending','approved') then raise exception 'lock already closed'; end if;
  update public.property_locks set status = 'released', released_at = now() where id = p_lock_id;
  insert into public.lock_events(lock_id,actor_id,action,reason) values(p_lock_id,me,'released',p_reason);
end;
$$;
create function public.request_property_lock(p_property_id uuid, p_reason text, p_evidence_file_id uuid default null, p_reference text default null)
returns uuid language sql security invoker set search_path = '' as $$ select private.request_lock(p_property_id,p_reason,p_evidence_file_id,p_reference); $$;
create function public.decide_property_lock(p_lock_id uuid, p_approve boolean, p_reason text, p_days integer default 7)
returns void language sql security invoker set search_path = '' as $$ select private.decide_lock(p_lock_id,p_approve,p_reason,p_days); $$;
create function public.release_property_lock(p_lock_id uuid, p_reason text)
returns void language sql security invoker set search_path = '' as $$ select private.release_lock(p_lock_id,p_reason); $$;

create function private.record_activity(p_property_id uuid,p_kind text,p_key uuid,p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); result uuid;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_kind not in ('page_view','site_visit') or p_key is null then raise exception 'invalid activity'; end if;
  if not exists (select 1 from public.properties where id = p_property_id and archived_at is null) then raise exception 'property not found'; end if;
  insert into public.activity_events(employee_id,property_id,kind,idempotency_key,visit_status,notes)
    values(me,p_property_id,p_kind,p_key,case when p_kind = 'site_visit' then 'pending' end,p_notes)
    on conflict (employee_id,idempotency_key) do nothing returning id into result;
  if result is null then
    select id into result from public.activity_events where employee_id = me and idempotency_key = p_key and property_id = p_property_id and kind = p_kind;
    if result is null then raise exception 'idempotency key reused with different payload'; end if;
  end if;
  return result;
end;
$$;
create function private.review_visit(p_event_id uuid,p_confirm boolean) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); e public.activity_events;
begin
  if me is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode = '42501'; end if;
  if p_confirm is null then raise exception 'decision required'; end if;
  select * into e from public.activity_events where id = p_event_id for update;
  if not found or e.kind <> 'site_visit' or e.visit_status <> 'pending' then raise exception 'pending site visit required'; end if;
  if e.employee_id = me then raise exception 'self confirmation forbidden' using errcode = '42501'; end if;
  update public.activity_events set visit_status = case when p_confirm then 'confirmed' else 'rejected' end,
    reviewed_by = me, reviewed_at = now() where id = p_event_id;
end;
$$;
create function public.record_property_activity(p_property_id uuid,p_kind text,p_key uuid,p_notes text default null)
returns uuid language sql security invoker set search_path = '' as $$ select private.record_activity(p_property_id,p_kind,p_key,p_notes); $$;
create function public.review_property_visit(p_event_id uuid,p_confirm boolean)
returns void language sql security invoker set search_path = '' as $$ select private.review_visit(p_event_id,p_confirm); $$;

do $$ declare t text; begin
  foreach t in array array['employees','admin_unit_versions','admin_unit_crosswalks','properties','property_addresses','contacts','property_contacts','property_files','activity_events','property_locks','lock_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['audit_events','import_batches','staging_rows','property_source_map','import_entity_map'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from anon, authenticated',t);
  end loop;
  foreach t in array array['employees','properties','property_addresses','contacts','property_contacts','property_files','activity_events','property_locks','lock_events'] loop
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function private.audit_change()',t,t);
  end loop;
end $$;

create policy employees_read on public.employees for select to authenticated using (private.employee_id() is not null);
create policy employees_admin_insert on public.employees for insert to authenticated with check (private.employee_role() = 'admin');
create policy employees_admin_update on public.employees for update to authenticated using (private.employee_role() = 'admin') with check (private.employee_role() = 'admin');
grant insert,update on public.employees to authenticated;

do $$ declare t text; begin
  foreach t in array array['admin_unit_versions','admin_unit_crosswalks','contacts','property_contacts','property_files','property_addresses','property_locks','lock_events'] loop
    execute format('create policy member_read on public.%I for select to authenticated using (private.employee_id() is not null)',t);
  end loop;
  foreach t in array array['admin_unit_versions','admin_unit_crosswalks'] loop
    execute format('create policy admin_insert on public.%I for insert to authenticated with check (private.employee_role() = ''admin'')',t);
    execute format('create policy admin_update on public.%I for update to authenticated using (private.employee_role() = ''admin'') with check (private.employee_role() = ''admin'')',t);
    execute format('grant insert,update on public.%I to authenticated',t);
  end loop;
end $$;
create policy properties_read on public.properties for select to authenticated using (private.employee_id() is not null and (archived_at is null or private.is_reviewer()));
create policy properties_insert on public.properties for insert to authenticated with check (private.employee_id() is not null and created_by = private.employee_id());
create policy properties_update on public.properties for update to authenticated using (private.can_edit_property(id)) with check (private.can_edit_property(id));
grant insert,update on public.properties to authenticated;
create policy addresses_insert on public.property_addresses for insert to authenticated with check (private.can_edit_property(property_id));
create policy addresses_update on public.property_addresses for update to authenticated using (private.can_edit_property(property_id)) with check (private.can_edit_property(property_id));
grant insert,update on public.property_addresses to authenticated;
-- MVP contacts are shared internally. Only staff/managers/admin maintain them.
create policy contacts_insert on public.contacts for insert to authenticated with check (private.employee_role() in ('staff','manager','admin'));
create policy contacts_update on public.contacts for update to authenticated using (private.employee_role() in ('staff','manager','admin')) with check (private.employee_role() in ('staff','manager','admin'));
grant insert,update on public.contacts to authenticated;
create policy property_contacts_insert on public.property_contacts for insert to authenticated with check (private.employee_role() in ('staff','manager','admin') and private.can_edit_property(property_id));
create policy property_contacts_update on public.property_contacts for update to authenticated using (private.employee_role() in ('staff','manager','admin') and private.can_edit_property(property_id)) with check (private.employee_role() in ('staff','manager','admin') and private.can_edit_property(property_id));
grant insert,update on public.property_contacts to authenticated;
create policy files_insert on public.property_files for insert to authenticated with check (private.can_edit_property(property_id) and uploaded_by = private.employee_id() and review_status = 'unreviewed' and reviewed_by is null);
create policy files_update on public.property_files for update to authenticated using (private.is_reviewer() or uploaded_by = private.employee_id()) with check (private.is_reviewer() or uploaded_by = private.employee_id());
grant insert on public.property_files to authenticated;
grant update (upload_status) on public.property_files to authenticated;
-- Review metadata requires an additional guarded RPC in the implementation phase.
create policy activity_read on public.activity_events for select to authenticated using (employee_id = private.employee_id() or private.is_reviewer());

grant usage on schema public, private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.employee_id(),private.employee_role(),private.is_reviewer(),private.can_edit_property(uuid) to authenticated;
grant execute on function private.request_lock(uuid,text,uuid,text),private.decide_lock(uuid,boolean,text,integer),private.release_lock(uuid,text),private.record_activity(uuid,text,uuid,text),private.review_visit(uuid,boolean) to authenticated;
revoke all on function public.request_property_lock(uuid,text,uuid,text),public.decide_property_lock(uuid,boolean,text,integer),public.release_property_lock(uuid,text),public.record_property_activity(uuid,text,uuid,text),public.review_property_visit(uuid,boolean) from public,anon;
grant execute on function public.request_property_lock(uuid,text,uuid,text),public.decide_property_lock(uuid,boolean,text,integer),public.release_property_lock(uuid,text),public.record_property_activity(uuid,text,uuid,text),public.review_property_visit(uuid,boolean) to authenticated;
-- Trusted migration worker uses an administrative database connection, never a browser.
commit;
