-- The captain's decision (23 October 2026): "2 all is duplicate warning". The warning for a
-- duplicate is decided on the composed address text alone, compared against every address a record
-- holds. Which address a record marks primary says nothing about whether two records sit at the same
-- place: a record whose address was recorded as the alternate one is the same duplicate as any
-- other, and answering nothing about it hid the record from the person creating it.
--
-- Only the warning widens. public.property_address_duplicates drops the early return that answered
-- [] for a submission that states its address as non-primary, and matches the composed key against
-- every address of an unarchived property instead of only its primary one.
--
-- public.property_address_group is deliberately left untouched and keeps exactly its former basis:
-- keys from the viewed record's primary addresses, membership through primary addresses only. The
-- group exists to serve the merge, and the merge proves its connected set over primary addresses;
-- publishing a group the merge would then refuse with `P0009` is a broken affordance. A wider
-- warning costs a person one glance; a merge button that always fails costs them trust.
--
-- Nothing else changes. `private.address_match_key` remains the one definition of "the same
-- address" - no second matcher is added - and `private.composed_address_text` remains the one
-- composition, so both reads still compare what a save stores. The answer shapes, the archived
-- exclusion, the row-level security, the repair that no address part composes no match, and the
-- grants are untouched; a function replaced in place keeps the ACL it already had.
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

commit;
