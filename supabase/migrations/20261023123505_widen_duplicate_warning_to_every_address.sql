-- The captain's decision (23 October 2026): "2 all is duplicate warning". A duplicate is decided on
-- the composed address text alone, compared against every address a record holds. Which address a
-- record marks primary says nothing about whether two records sit at the same place: a record whose
-- address was recorded as the alternate one is the same duplicate as any other, and answering
-- nothing about it hid the record from the person creating it.
--
-- Both reads widen to that one basis, so the warning before a creation and the group after it stay
-- the same relation:
--
--   1. public.property_address_duplicates drops the early return that answered [] for a submission
--      that states its address as non-primary, and matches the composed key against every address of
--      an unarchived property instead of only its primary one.
--   2. public.property_address_group takes every address of the viewed record as its keys, and
--      matches every address of every other unarchived record, instead of only primary addresses.
--
-- Nothing else changes. `private.address_match_key` remains the one definition of "the same
-- address" - no second matcher is added - and `private.composed_address_text` remains the one
-- composition, so both sides still compare what a save stores. The answer shapes, the archived
-- exclusion, the row-level security, the repair that no address part composes no match, and the
-- grants are untouched; a function replaced in place keeps the ACL it already had.
--
-- Known limit, left as it is on purpose: the merge guard (private.merge_address_properties) still
-- proves a connected set over primary addresses only, so a group now published through a
-- non-primary address is refused there with `P0009` rather than merged. Merging duplicate records
-- is out of this change's scope, and the refusal is the safe side: nothing is archived or folded.
-- Upgrade that guard when merging is widened to this same basis.
begin;

create or replace function public.property_address_duplicates(p_address jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  key text;
  members jsonb;
begin
  if private.employee_id() is null then
    raise exception 'active employee required' using errcode = '42501';
  end if;
  key := private.address_match_key(private.composed_address_text(
    jsonb_populate_record(null::public.property_addresses, coalesce(p_address, '{}'::jsonb))));
  -- An address with no part composes no text; the save refuses it and nothing can match it.
  if coalesce(key, '') = '' then
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'propertyCode', p.property_code)
    order by p.created_at, p.id), '[]'::jsonb) into members
  from public.properties p
  where p.archived_at is null
    and exists (select 1 from public.property_addresses a
                where a.property_id = p.id
                  and private.address_match_key(a.address_text) = key);
  return members;
end;
$$;

create or replace function public.property_address_group(p_property_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  keys text[];
  members jsonb;
begin
  if private.employee_id() is null then
    raise exception 'active employee required' using errcode = '42501';
  end if;
  if p_property_id is null or not exists (
    select 1 from public.properties where id = p_property_id and archived_at is null
  ) then
    return jsonb_build_object('keepId', null, 'members', '[]'::jsonb);
  end if;
  select array_agg(distinct private.address_match_key(a.address_text)) into keys
    from public.property_addresses a
    where a.property_id = p_property_id;
  if keys is null then
    return jsonb_build_object('keepId', null, 'members', '[]'::jsonb);
  end if;
  with shared as (
    select p.id from public.properties p
    where p.archived_at is null
      and exists (select 1 from public.property_addresses a
                  where a.property_id = p.id
                    and private.address_match_key(a.address_text) = any(keys))
  ), scored as (
    select p.id, p.property_code, p.listing_mode, p.status, p.created_at,
      p.sale_price_vnd::text as sale_price_vnd,
      p.land_area_m2::text as land_area_m2,
      p.floor_area_m2::text as floor_area_m2,
      p.frontage_m::text as frontage_m,
      p.depth_m::text as depth_m,
      private.property_completeness(p.id) as completeness,
      coalesce((select jsonb_agg(c.display_name order by c.display_name)
                from public.property_contacts l
                join public.contacts c on c.id = l.contact_id
                where l.property_id = p.id and l.relation = 'owner'), '[]'::jsonb) as owners
    from public.properties p join shared s on s.id = p.id
  ), ordered as (
    select *, row_number() over (order by completeness desc, created_at, id) as place from scored
  )
  select jsonb_agg(jsonb_build_object(
      'id', id, 'propertyCode', property_code, 'listingMode', listing_mode, 'status', status,
      'salePriceVnd', sale_price_vnd, 'landAreaM2', land_area_m2, 'floorAreaM2', floor_area_m2,
      'frontageM', frontage_m, 'depthM', depth_m, 'completeness', completeness, 'owners', owners)
    order by place) into members
  from ordered;
  return jsonb_build_object('keepId', (members->0->>'id')::uuid, 'members', coalesce(members, '[]'::jsonb));
end;
$$;

commit;
