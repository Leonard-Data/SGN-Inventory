-- Issue #7: immutable correction evidence, immediate atomic application.
begin;
create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  requester_id uuid not null references public.employees(id),
  target text not null check (target in ('property','address','contact','link')),
  target_id uuid,
  category text not null check (category in ('incorrect','missing','other')),
  explanation text not null check(length(btrim(explanation)) between 10 and 2000),
  proposed_values jsonb not null,
  observed_values jsonb not null,
  observed_revision uuid not null,
  property_revision uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  revision uuid not null default gen_random_uuid(),
  status text not null default 'open' check(status in ('open','applied','rejected','withdrawn')),
  outcome_actor_id uuid references public.employees(id),
  outcome_at timestamptz,
  outcome_reason text,
  check ((status='open')=(outcome_actor_id is null and outcome_at is null)),
  check (status not in ('applied','rejected') or length(btrim(outcome_reason))>=10)
);
create table public.correction_amendments (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.correction_requests(id),
  actor_id uuid not null references public.employees(id),
  explanation text not null check(length(btrim(explanation)) between 10 and 2000),
  proposed_values jsonb not null,
  observed_values jsonb not null,
  observed_revision uuid not null,
  property_revision uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  ordinal integer not null,
  unique(request_id,ordinal)
);
create index correction_queue_idx on public.correction_requests(status,created_at,id);
create index correction_property_idx on public.correction_requests(property_id,created_at,id);
create index correction_requester_idx on public.correction_requests(requester_id,created_at,id);
do $$ declare t text; begin
  foreach t in array array['correction_requests','correction_amendments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
    execute format('grant select on public.%I to authenticated',t);
  end loop;
end $$;
create policy corrections_read on public.correction_requests for select to authenticated using (
  private.employee_id() is not null
  and (requester_id=private.employee_id() or private.employee_role() in ('staff','manager','admin'))
  and exists(select 1 from public.properties p where p.id=property_id)
);
create policy amendments_read on public.correction_amendments for select to authenticated using (
  exists(select 1 from public.correction_requests r where r.id=request_id)
);
create function private.guard_correction_evidence() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'use correction RPC' using errcode='42501'; end if;
  if tg_op<>'INSERT' then
    if tg_table_name='correction_amendments' or tg_op='DELETE' then raise exception 'correction evidence is immutable' using errcode='23514'; end if;
    if old.status<>'open' or (to_jsonb(new)-array['revision','status','outcome_actor_id','outcome_at','outcome_reason']) is distinct from
      (to_jsonb(old)-array['revision','status','outcome_actor_id','outcome_at','outcome_reason']) then raise exception 'original and terminal evidence is immutable' using errcode='23514'; end if;
    new.revision:=gen_random_uuid();
  end if;
  return coalesce(new,old);
end;
$$;
create trigger correction_evidence before insert or update or delete on public.correction_requests for each row execute function private.guard_correction_evidence();
create trigger amendment_evidence before insert or update or delete on public.correction_amendments for each row execute function private.guard_correction_evidence();

create function private.correction_observation(p_property_id uuid,p_target text,p_target_id uuid,p_revision uuid,p_property_revision uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare prop public.properties; data jsonb; rev uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  select * into prop from public.properties where id=p_property_id and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode='42501'; end if;
  if prop.revision is distinct from p_property_revision then raise exception 'stale property observation; reload current state' using errcode='40001'; end if;
  if p_target='property' then
    if p_target_id is distinct from p_property_id then raise exception 'property target mismatch' using errcode='23514'; end if;
    data:=to_jsonb(prop); rev:=prop.revision;
  elsif p_target='address' then
    if p_target_id is null then data:='{}';rev:=prop.revision;
    else select to_jsonb(a),a.revision into data,rev from public.property_addresses a where id=p_target_id and property_id=p_property_id for update; end if;
  elsif p_target in ('contact','link') then
    if p_target_id is null and p_target='link' then data:='{}';rev:=prop.revision;
    elsif p_target='contact' then
      select to_jsonb(c),c.revision into data,rev from public.contacts c where c.id=p_target_id and exists(select 1 from public.property_contacts pc where pc.property_id=p_property_id and pc.contact_id=c.id) for update;
    else select to_jsonb(pc),pc.revision into data,rev from public.property_contacts pc where pc.property_id=p_property_id and pc.contact_id=p_target_id for update; end if;
  else raise exception 'invalid correction target' using errcode='23514'; end if;
  if data is null or p_revision is null then raise exception 'target/revision required' using errcode='23514'; end if;
  if rev<>p_revision then raise exception 'stale target observation; reload current state' using errcode='40001'; end if;
  return private.business_values(p_target,data);
end;
$$;
create function private.validate_correction(p_target text,p_explanation text,p_changes jsonb) returns void language plpgsql security invoker set search_path='' as $$
begin
  if length(btrim(coalesce(p_explanation,''))) not between 10 and 2000 then raise exception 'meaningful explanation required' using errcode='23514'; end if;
  if p_target is null or p_target not in ('property','address','contact','link') then raise exception 'invalid correction target' using errcode='23514'; end if;
  perform private.validate_maintenance(p_target,p_changes);
  if p_changes ?| array['legal_status','record_review_status','archived_at'] then raise exception 'legal/review/archive corrections excluded' using errcode='23514'; end if;
end;
$$;
create function private.submit_correction(p_property_id uuid,p_target text,p_target_id uuid,p_category text,p_explanation text,p_changes jsonb,p_revision uuid,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare observed jsonb; result uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  perform private.validate_correction(p_target,p_explanation,p_changes);
  perform private.maintenance_gate();
  observed:=private.correction_observation(p_property_id,p_target,p_target_id,p_revision,p_property_revision);
  insert into public.correction_requests(property_id,requester_id,target,target_id,category,explanation,proposed_values,observed_values,observed_revision,property_revision)
    values(p_property_id,private.employee_id(),p_target,p_target_id,p_category,p_explanation,p_changes,observed,p_revision,p_property_revision) returning id into result;
  return result;
end;
$$;
create function private.amend_correction(p_request_id uuid,p_request_revision uuid,p_explanation text,p_changes jsonb,p_revision uuid,p_property_revision uuid) returns void
language plpgsql security definer set search_path='' as $$
declare req public.correction_requests; observed jsonb; prop uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  perform private.maintenance_gate();
  select property_id into prop from public.correction_requests where id=p_request_id;
  perform 1 from public.properties where id=prop and archived_at is null for update;
  if not found then raise exception 'property unavailable' using errcode='42501'; end if;
  select * into req from public.correction_requests where id=p_request_id for update;
  if req.requester_id<>private.employee_id() and private.employee_role() not in ('staff','manager','admin') then raise exception 'request amendment denied' using errcode='42501'; end if;
  if req.status<>'open' then raise exception 'request is terminal' using errcode='23514'; end if;
  if req.revision is distinct from p_request_revision then raise exception 'stale request; reload current state' using errcode='40001'; end if;
  perform private.validate_correction(req.target,p_explanation,p_changes);
  observed:=private.correction_observation(prop,req.target,req.target_id,p_revision,p_property_revision);
  insert into public.correction_amendments(request_id,actor_id,explanation,proposed_values,observed_values,observed_revision,property_revision,ordinal)
    select req.id,private.employee_id(),p_explanation,p_changes,observed,p_revision,p_property_revision,coalesce(max(ordinal),0)+1 from public.correction_amendments where request_id=req.id;
  update public.correction_requests set revision=gen_random_uuid() where id=req.id;
end;
$$;
create function private.decide_correction(p_request_id uuid,p_request_revision uuid,p_action text,p_reason text,p_changes jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare req public.correction_requests; amendment public.correction_amendments; prop uuid; changes jsonb; rev uuid; parent_rev uuid; started timestamptz; me uuid:=private.employee_id();
begin
  if me is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('apply','reject','withdraw') then raise exception 'invalid outcome' using errcode='23514'; end if;
  if p_action in ('apply','reject') and private.employee_role() not in ('staff','manager','admin') then raise exception 'processor required' using errcode='42501'; end if;
  perform private.maintenance_gate();
  select property_id into prop from public.correction_requests where id=p_request_id;
  perform 1 from public.properties where id=prop and archived_at is null for update;
  if not found then raise exception 'property unavailable' using errcode='42501'; end if;
  select * into req from public.correction_requests where id=p_request_id for update;
  if p_action='withdraw' and req.requester_id<>me then raise exception 'requester required' using errcode='42501'; end if;
  if req.status<>'open' then raise exception 'request is terminal' using errcode='23514'; end if;
  if req.revision is distinct from p_request_revision then raise exception 'stale request; reload current state' using errcode='40001'; end if;
  if p_action in ('apply','reject') and length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'meaningful outcome reason required' using errcode='23514'; end if;
  if p_action<>'apply' and p_changes is not null then raise exception 'non-application must not include changes' using errcode='23514'; end if;
  if p_action='apply' then
    select * into amendment from public.correction_amendments where request_id=req.id order by ordinal desc limit 1;
    if found then changes:=amendment.proposed_values;rev:=amendment.observed_revision;parent_rev:=amendment.property_revision;
    else changes:=req.proposed_values;rev:=req.observed_revision;parent_rev:=req.property_revision;end if;
    changes:=coalesce(p_changes,changes);
    perform private.validate_correction(req.target,p_reason,changes);
    if changes='{}'::jsonb then raise exception 'actual correction required' using errcode='23514'; end if;
    -- Revalidate the original/amended target association and both observed revisions.
    perform private.correction_observation(prop,req.target,req.target_id,rev,parent_rev);
    started:=clock_timestamp();
    perform private.maintain_property(prop,req.target,req.target_id,rev,changes,parent_rev);
    -- Only this operation's inserted events, never concurrent same-actor history.
    update public.property_history set explanation=p_reason where actor_id=me and occurred_at>=started and xmin=pg_current_xact_id()::xid;
    if not found then raise exception 'actual business change required' using errcode='23514'; end if;
  end if;
  update public.correction_requests set status=case p_action when 'apply' then 'applied' when 'reject' then 'rejected' else 'withdrawn' end,
    outcome_actor_id=me,outcome_at=clock_timestamp(),outcome_reason=p_reason where id=req.id;
end;
$$;
create function public.submit_correction(p_property_id uuid,p_target text,p_target_id uuid,p_category text,p_explanation text,p_changes jsonb,p_revision uuid,p_property_revision uuid) returns uuid language sql security invoker set search_path='' as $$ select private.submit_correction(p_property_id,p_target,p_target_id,p_category,p_explanation,p_changes,p_revision,p_property_revision); $$;
create function public.amend_correction(p_request_id uuid,p_request_revision uuid,p_explanation text,p_changes jsonb,p_revision uuid,p_property_revision uuid) returns void language sql security invoker set search_path='' as $$ select private.amend_correction(p_request_id,p_request_revision,p_explanation,p_changes,p_revision,p_property_revision); $$;
create function public.decide_correction(p_request_id uuid,p_request_revision uuid,p_action text,p_reason text,p_changes jsonb default null) returns void language sql security invoker set search_path='' as $$ select private.decide_correction(p_request_id,p_request_revision,p_action,p_reason,p_changes); $$;
revoke all on function private.guard_correction_evidence(),private.correction_observation(uuid,text,uuid,uuid,uuid),private.validate_correction(text,text,jsonb),private.submit_correction(uuid,text,uuid,text,text,jsonb,uuid,uuid),private.amend_correction(uuid,uuid,text,jsonb,uuid,uuid),private.decide_correction(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.submit_correction(uuid,text,uuid,text,text,jsonb,uuid,uuid),public.amend_correction(uuid,uuid,text,jsonb,uuid,uuid),public.decide_correction(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.submit_correction(uuid,text,uuid,text,text,jsonb,uuid,uuid),private.amend_correction(uuid,uuid,text,jsonb,uuid,uuid),private.decide_correction(uuid,uuid,text,text,jsonb),public.submit_correction(uuid,text,uuid,text,text,jsonb,uuid,uuid),public.amend_correction(uuid,uuid,text,jsonb,uuid,uuid),public.decide_correction(uuid,uuid,text,text,jsonb) to authenticated;
commit;
