-- Issue #36: read recorded Asking-price history from the property-scoped
-- business-history seam, with an optional retained correction explanation on
-- the authorized immediate price-correction path. No second audit store.
begin;

-- The optional explanation travels with one revision-checked maintenance call and is
-- attached to exactly the history rows that call recorded. Only the property target is
-- accepted, so a shared-contact fan-out can never leave an explanation on one property.
create function private.maintain_property_explained(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid,p_explanation text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid; me uuid:=private.employee_id();
begin
  if p_explanation is not null then
    if length(btrim(p_explanation)) not between 10 and 2000 then
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
drop function public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid);
create function public.maintain_property(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid,p_explanation text default null) returns uuid
language sql security invoker set search_path='' as $$ select private.maintain_property_explained(p_property_id,p_target,p_target_id,p_expected_revision,p_changes,p_property_revision,p_explanation); $$;
revoke all on function private.maintain_property_explained(uuid,text,uuid,uuid,jsonb,uuid,text),public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function private.maintain_property_explained(uuid,text,uuid,uuid,jsonb,uuid,text),public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid,text) to authenticated;

-- Keyset paging for the price series stays on the established (property_id,occurred_at,id)
-- order; the partial predicate keeps non-price maintenance events out of the scan.
create index property_history_price_page_idx on public.property_history(property_id,occurred_at,id)
  where changed_fields && array['sale_price_vnd','monthly_rent_vnd'];

create view public.property_price_history with (security_invoker = true) as
select id,property_id,actor_id,actor_name,occurred_at,explanation,'sale'::text as series,
  before_values->>'sale_price_vnd' as before_value,after_values->>'sale_price_vnd' as after_value
from public.property_history where changed_fields && array['sale_price_vnd']
  and (before_values->>'sale_price_vnd' is not null or after_values->>'sale_price_vnd' is not null)
union all
select id,property_id,actor_id,actor_name,occurred_at,explanation,'rent'::text,
  before_values->>'monthly_rent_vnd',after_values->>'monthly_rent_vnd'
from public.property_history where changed_fields && array['monthly_rent_vnd']
  and (before_values->>'monthly_rent_vnd' is not null or after_values->>'monthly_rent_vnd' is not null);

revoke all on public.property_price_history from public,anon,authenticated,service_role;
grant select on public.property_price_history to authenticated;
commit;
