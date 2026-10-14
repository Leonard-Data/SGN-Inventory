-- Issue #36 follow-up: the price-history read path exposes the correction outcome reason
-- the correction-decision writer stamps onto property_history.explanation, so that writer
-- must reject an oversized raw reason and store the trimmed, bounded value, exactly like the
-- new maintain_property_explained writer. 20261013161027 is already applied on the approved
-- development target, so the bound arrives forward.
begin;
create or replace function private.decide_correction(p_request_id uuid,p_request_revision uuid,p_action text,p_reason text,p_changes jsonb) returns void
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
commit;
