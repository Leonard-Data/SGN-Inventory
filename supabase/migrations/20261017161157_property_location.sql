-- Property location capture. The columns already exist with range checks and a
-- both-or-neither constraint (20261010013004_inventory_core.sql), but nothing wrote or
-- read them. This migration admits `latitude`/`longitude` through the revision-checked
-- property maintenance path so staff can set or clear the recorded point. Range and
-- both-or-neither stay enforced by the column CHECK constraints on the merged row; a
-- half-set or out-of-range save is rejected with the same 23514 the application maps to
-- `invalid-input`. The coordinates are also business values, so a change flags the record
-- for review exactly like any other property-fact edit (and, like the other facts, does not
-- itself append a history row).
begin;

create or replace function private.validate_maintenance(p_target text,p_changes jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare k text; v jsonb; allowed text[];
begin
  allowed:=case p_target
    when 'property' then array['listing_mode','property_type','access_type','status','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes','latitude','longitude','legal_status','record_review_status','archived_at']
    when 'address' then array['format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','is_primary']
    when 'mapping' then array['mapping_status','verification_method','source_url','effective_on','province_unit_id','commune_unit_id','mapping_evidence']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary','remove'] else null end;
  if allowed is null or jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>262144 then raise exception 'invalid changes' using errcode='23514'; end if;
  for k,v in select key,value from jsonb_each(p_changes) loop
    if not k=any(allowed) then raise exception 'invalid field' using errcode='23514'; end if;
    if v='null'::jsonb then continue; end if;
    if k in ('sale_price_vnd','monthly_rent_vnd') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'whole VND string required' using errcode='23514'; end if;
    elsif k in ('land_area_m2','floor_area_m2','frontage_m','depth_m') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
        or (k in ('frontage_m','depth_m') and (v#>>'{}')::numeric>=1000000) then raise exception 'exact decimal string required' using errcode='23514'; end if;
    elsif k in ('floors','bedrooms','bathrooms') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,4})$' then raise exception 'integer string required' using errcode='23514'; end if;
    elsif k in ('is_primary','remove') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'boolean required' using errcode='23514'; end if;
    elsif k='phones' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then raise exception 'phone strings required' using errcode='23514'; end if;
      if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100) then raise exception 'phone strings required' using errcode='23514'; end if;
    elsif k in ('latitude','longitude') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^-?[0-9]{1,3}(\.[0-9]{1,7})?$' then raise exception 'coordinate string required' using errcode='23514'; end if;
    elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'bounded text required' using errcode='23514'; end if;
  end loop;
end;
$$;

create or replace function private.business_values(p_target text,p_row jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then to_jsonb(value #>> '{}') else value end),'{}'::jsonb)
  from jsonb_each(coalesce(p_row,'{}')) where key=any(case p_target
    when 'property' then array['property_code','listing_mode','property_type','access_type','status','entry_on','entry_source','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes','latitude','longitude']
    when 'address' then array['mapping_evidence','format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','mapping_status','verification_method','verified_by','verified_at','source_url','effective_on','is_primary','supersedes_address_id']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary'] else '{}'::text[] end);
$$;

commit;
