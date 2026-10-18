-- The vendor live-membership guard re-created the shared business-values allowlist from a stale
-- copy and silently dropped the two entry-provenance values main had added to the property facts.
-- Entry provenance is a property business fact — a correction observation snapshots it and record
-- review compares it — so this restores exactly those two values and changes nothing else.
begin;

create or replace function private.business_values(p_target text,p_row jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then to_jsonb(value #>> '{}') else value end),'{}'::jsonb)
  from jsonb_each(coalesce(p_row,'{}')) where key=any(case p_target
    when 'property' then array['property_code','listing_mode','property_type','access_type','status','entry_on','entry_source','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes']
    when 'address' then array['mapping_evidence','format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','mapping_status','verification_method','verified_by','verified_at','source_url','effective_on','is_primary','supersedes_address_id']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary'] else '{}'::text[] end);
$$;

commit;
