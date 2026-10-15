-- Ticket #74 keeps the vendor link/unlink in the property business history after the rebase
-- onto the asking-price-only rule (20261015152812_property_price_only_history.sql replaced
-- private.record_business_change and dropped the vendor_link branch ticket #74 requires).
-- The link projection gets its own trigger function so it stays recorded, keeps the explicit
-- vendor_link target/label, and never widens the price-only rule to another target.
begin;

create function private.record_vendor_link_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); target text:='vendor_link'; before_v jsonb; after_v jsonb; fields text[]; prop uuid; row_v jsonb; before_row jsonb; after_row jsonb;
begin
  if me is null then return coalesce(new,old); end if;
  before_row:=case when tg_op<>'INSERT' then to_jsonb(old) end;
  after_row:=case when tg_op<>'DELETE' then to_jsonb(new) end;
  -- The company name is a historical label snapshot for readability; the vendor identity
  -- stays in the link row and target_id rather than being duplicated as a link column.
  before_row:=before_row||jsonb_build_object('vendor_name',(select v.display_name from public.vendors v where v.id=(before_row->>'vendor_id')::uuid));
  after_row:=after_row||jsonb_build_object('vendor_name',(select v.display_name from public.vendors v where v.id=(after_row->>'vendor_id')::uuid));
  before_v:=private.business_values(target,before_row);
  after_v:=private.business_values(target,after_row);
  select array_agg(key order by key) into fields from (select jsonb_object_keys(before_v||after_v) as key) k
    where before_v->key is distinct from after_v->key;
  if fields is null then return coalesce(new,old); end if;
  row_v:=coalesce(to_jsonb(new),to_jsonb(old));
  prop:=(row_v->>'property_id')::uuid;
  insert into public.property_history(property_id,actor_id,actor_name,target,target_id,changed_fields,before_values,after_values)
  select prop,me,e.display_name,target,(row_v->>'vendor_id')::uuid,fields,
    (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(before_v) where key=any(fields)),
    (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(after_v) where key=any(fields))
  from public.employees e where e.id=me;
  -- A vendor company relationship is not a property fact, so it does not reopen record review.
  return coalesce(new,old);
end;
$$;
revoke all on function private.record_vendor_link_change() from public,anon,authenticated;

drop trigger if exists property_vendor_history on public.property_vendors;
create trigger property_vendor_history after insert or delete on public.property_vendors
  for each row execute function private.record_vendor_link_change();
commit;
