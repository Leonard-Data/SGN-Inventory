-- The property change history records recorded asking-price changes and nothing else.
-- Address, contact, link, note and status changes still commit and, for a non-property
-- target, still flag the record for review, but they no longer write a `property_history`
-- row. Rows already recorded are retained and are never rewritten or deleted.
begin;

create or replace function private.record_business_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); target text; before_v jsonb; after_v jsonb; fields text[]; props uuid[]; prop uuid; row_v jsonb;
begin
  if me is null then return coalesce(new,old); end if;
  target:=case tg_table_name when 'properties' then 'property' when 'property_addresses' then 'address' when 'contacts' then 'contact' else 'link' end;
  before_v:=private.business_values(target,case when tg_op<>'INSERT' then to_jsonb(old) end);
  after_v:=private.business_values(target,case when tg_op<>'DELETE' then to_jsonb(new) end);
  select array_agg(key order by key) into fields from (select jsonb_object_keys(before_v||after_v) as key) k
    where before_v->key is distinct from after_v->key;
  if fields is null then return coalesce(new,old); end if;
  row_v:=coalesce(to_jsonb(new),to_jsonb(old));
  if target='contact' then select array_agg(property_id order by property_id) into props from public.property_contacts where contact_id=(row_v->>'id')::uuid;
  else props:=array[case when target='property' then (row_v->>'id')::uuid else (row_v->>'property_id')::uuid end]; end if;
  if target<>'property' then update public.properties set record_review_status='pending' where id=any(coalesce(props,'{}'::uuid[])); end if;
  -- An asking-price change is the only business change this history now records, and an
  -- as-yet-unknown price carried by a new row is not a change: a missing value and a JSON
  -- null are the same unknown.
  select array_agg(key order by key) into fields from unnest(fields) key
    where key=any(array['sale_price_vnd','monthly_rent_vnd'])
      and coalesce(before_v->key,'null'::jsonb) is distinct from coalesce(after_v->key,'null'::jsonb);
  if fields is null then return coalesce(new,old); end if;
  foreach prop in array coalesce(props,'{}'::uuid[]) loop
    insert into public.property_history(property_id,actor_id,actor_name,target,target_id,changed_fields,before_values,after_values)
    select prop,me,e.display_name,target,coalesce((row_v->>'id')::uuid,(row_v->>'contact_id')::uuid),fields,
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(before_v) where key=any(fields)),
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(after_v) where key=any(fields))
    from public.employees e where e.id=me;
  end loop;
  return coalesce(new,old);
end;
$$;
revoke all on function private.record_business_change() from public,anon,authenticated;

-- Correction application no longer depends on a recorded history row to prove it changed
-- something: the applied proposal itself must differ from the live observed value it was
-- proposed against. The retained outcome reason still annotates the price revision the
-- application records, and a price application that records nothing is still refused.
create or replace function private.decide_correction(p_request_id uuid,p_request_revision uuid,p_action text,p_reason text,p_changes jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare req public.correction_requests; amendment public.correction_amendments; prop uuid; changes jsonb; rev uuid; parent_rev uuid; started timestamptz; observed jsonb; me uuid:=private.employee_id();
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
  if req.revision is distinct from p_request_revision then raise exception 'stale request; reload current state' using errcode='PT409'; end if;
  if p_action in ('apply','reject') then
    if length(coalesce(p_reason,''))>2000 or length(btrim(coalesce(p_reason,''))) not between 10 and 2000 then raise exception 'meaningful outcome reason required' using errcode='23514'; end if;
    p_reason:=btrim(p_reason);
  end if;
  if p_action<>'apply' and p_changes is not null then raise exception 'non-application must not include changes' using errcode='23514'; end if;
  if p_action='apply' then
    select * into amendment from public.correction_amendments where request_id=req.id order by ordinal desc limit 1;
    if found then changes:=amendment.proposed_values;rev:=amendment.observed_revision;parent_rev:=amendment.property_revision;
    else changes:=req.proposed_values;rev:=req.observed_revision;parent_rev:=req.property_revision;end if;
    changes:=coalesce(p_changes,changes);
    perform private.validate_correction(req.target,p_reason,changes);
    if changes='{}'::jsonb then raise exception 'actual correction required' using errcode='23514'; end if;
    -- Revalidate the original/amended target association and both observed revisions.
    observed:=private.correction_observation(prop,req.target,req.target_id,rev,parent_rev);
    -- The applied proposal must differ from the live observed value, whether or not the
    -- change is one the history records.
    if not exists(select 1 from jsonb_each(changes) c where observed->c.key is distinct from c.value) then
      raise exception 'actual business change required' using errcode='23514'; end if;
    started:=clock_timestamp();
    perform private.maintain_property(prop,req.target,req.target_id,rev,changes,parent_rev);
    -- Only this operation's inserted events, and only for a recorded price change.
    if changes ?| array['sale_price_vnd','monthly_rent_vnd'] then
      update public.property_history set explanation=p_reason where actor_id=me and occurred_at>=started and xmin=pg_current_xact_id()::xid;
      if not found then raise exception 'actual business change required' using errcode='23514'; end if;
    end if;
  end if;
  update public.correction_requests set status=case p_action when 'apply' then 'applied' when 'reject' then 'rejected' else 'withdrawn' end,
    outcome_actor_id=me,outcome_at=clock_timestamp(),outcome_reason=p_reason where id=req.id;
end;
$$;
commit;
