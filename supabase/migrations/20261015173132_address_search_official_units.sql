-- The address form records the official province/commune selection and no longer asks for the
-- written source label beside it, so an address saved with a dropdown choice alone must still be
-- found by that province and ward name. Search matches on the stored `search_text`, and the
-- existing text is built from the recorded address text, house number, street and the optional
-- source labels only, so the chosen official unit names are added to it here. The stored unit id
-- and its dated validity window are untouched: verification, reporting and the catalog are
-- unchanged, and no column meaning or source label is rewritten.
begin;

create or replace function private.address_search_trigger() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.search_text := private.normalize_search(concat_ws(' ',new.address_text,new.house_number,new.street,new.province_text,new.district_text,new.commune_text,
    (select name_vi from public.admin_unit_versions where id=new.province_unit_id),
    (select name_vi from public.admin_unit_versions where id=new.district_unit_id),
    (select name_vi from public.admin_unit_versions where id=new.commune_unit_id)));
  return new;
end;
$$;

-- Only rows the added text actually covers are rewritten, so an address that is already
-- searchable keeps its revision and a concurrent editor stays valid. The trigger recomputes the
-- text above; this statement only decides which rows need it. No business field changes, so no
-- history entry and no record-review reset is produced.
update public.property_addresses a set search_text = a.search_text
where exists (select 1 from public.admin_unit_versions v
  where v.id in (a.province_unit_id,a.district_unit_id,a.commune_unit_id)
    and position(private.normalize_search(v.name_vi) in a.search_text) = 0);
commit;
