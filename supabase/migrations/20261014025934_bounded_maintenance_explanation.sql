-- Issue #36 follow-up: 20261013161027 is already applied on the approved development
-- target, so the raw-length and trim bound it now carries must also arrive forward for
-- private.maintain_property_explained, exactly as 20261014003834 did for
-- private.decide_correction.
begin;
create or replace function private.maintain_property_explained(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid,p_explanation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; me uuid:=private.employee_id(); raw_explanation_length integer;
begin
  if p_explanation is not null then
    raw_explanation_length:=length(p_explanation);
    p_explanation:=btrim(p_explanation);
    if length(p_explanation) not between 10 and 2000 or raw_explanation_length>2000 then
      raise exception 'correction explanation must be 10 to 2000 characters' using errcode='23514'; end if;
    if p_target is distinct from 'property'
      or not (coalesce(p_changes,'{}'::jsonb) ?| array['sale_price_vnd','monthly_rent_vnd']) then
      raise exception 'correction explanation applies to a recorded price change' using errcode='23514'; end if;
  end if;
  result:=private.maintain_property(p_property_id,p_target,p_target_id,p_expected_revision,p_changes,p_property_revision);
  if p_explanation is not null then
    -- Only this operation's just-inserted rows, and only the price entries of this
    -- revision. An explanation is never attached to an unrelated or pre-existing event.
    update public.property_history set explanation=p_explanation
      where property_id=p_property_id and actor_id=me and explanation is null
        and xmin=pg_current_xact_id()::xid and changed_fields && array['sale_price_vnd','monthly_rent_vnd'];
    if not found then raise exception 'correction explanation requires a recorded price change' using errcode='23514'; end if;
  end if;
  return result;
end;
$$;
commit;
