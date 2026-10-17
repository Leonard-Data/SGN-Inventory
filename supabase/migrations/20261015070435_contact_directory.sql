-- Ticket #71: the shared Contact directory and its expanded detail surface.
-- The directory reads existing Contact identities and Property contact links; it adds no
-- second owner store, no owner column and no copied contact data on properties. Owner
-- membership comes from recorded `relation = owner` links, never from the Contact's global
-- `contact_type`. The correction surface reaches the same shared-identity operation as the
-- property maintenance branch (`private.maintain_contact`), so a directory-origin save keeps
-- the same revision check, affected-set preview, parent-before-target lock order and the
-- same `record_review_status` flag on every linked property. A recorded shared-contact
-- correction appends no property history row (issue #109 narrowed `property_history` to
-- asking-price changes). A standalone
-- directory edit supplies no parent property, so nothing is invented to satisfy the
-- property-scoped interface. Local link/create/unlink authority, unlinked-identity
-- correction and the archived affected-property read boundary are unchanged (C2 belongs to
-- ticket #72).
begin;

-- Contact-scoped entry point into the shared-identity operation. The property-scoped
-- `maintain_property(...,'contact',...)` branch keeps delegating to the same private
-- function, so both callers share one authority, one revision rule and one review flag.
create function public.maintain_contact(p_contact_id uuid,p_expected_revision uuid,p_changes jsonb) returns uuid
language sql security invoker set search_path='' as $$
  select private.maintain_contact(p_contact_id,p_expected_revision,p_changes);
$$;
revoke all on function public.maintain_contact(uuid,uuid,jsonb) from public,anon,authenticated;
-- The invoker wrapper executes the guarded definer as the caller, so the caller needs EXECUTE
-- on it — the same shape public.contact_impact and public.create_contact already use. The
-- `private` schema is not exposed to PostgREST and the guarded function re-checks live
-- membership and role itself, so this grant adds no authority beyond the wrapper.
grant execute on function private.maintain_contact(uuid,uuid,jsonb) to authenticated;
grant execute on function public.maintain_contact(uuid,uuid,jsonb) to authenticated;

-- Bounded directory read. An invoker wrapper, so the caller's RLS decides every row: the
-- Contact read policy admits every live employee, and the link projection inherits the
-- existing property-read and archived-property boundary rather than widening it. One extra
-- row is returned so the caller can detect a following page; the exposed page is at most 30.
-- The name query is the existing contact name match: a literal contiguous fragment of
-- `display_name` where `%`, `_` and `\` are ordinary characters, accent-sensitive and
-- name-only. A raw query over 120 characters returns no rows (the route rejects it clearly
-- first). Paging is an ascending id keyset, matching the existing contact list cursor.
-- `p_owners_only` keeps only identities with at least one readable `relation = owner` link.
create function public.list_contacts(
  p_query text default null,
  p_after_id uuid default null,
  p_owners_only boolean default false,
  p_limit integer default 31
) returns table(
  id uuid,
  display_name text,
  contact_type text,
  phones text[],
  raw_phone_text text,
  revision uuid,
  links jsonb
) language sql stable security invoker set search_path='' as $$
  with input as materialized (
    select nullif(btrim(coalesce(p_query, ''), ' '), '') as query_text,
      coalesce(p_owners_only, false) as owners_only
  ), pattern as materialized (
    select '%' || replace(replace(replace(i.query_text, chr(92), chr(92) || chr(92)),
      '%', chr(92) || '%'), '_', chr(92) || '_') || '%' as like_pattern
    from input i
  )
  select c.id, c.display_name, c.contact_type, c.phones, c.raw_phone_text, c.revision,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'property_id', p.id,
        'property_code', p.property_code,
        'relation', pc.relation,
        'is_primary', pc.is_primary) order by p.property_code, p.id)
      from public.property_contacts pc join public.properties p on p.id = pc.property_id
      where pc.contact_id = c.id
    ), '[]'::jsonb) as links
  from public.contacts c cross join input i cross join pattern p
  where (
      i.query_text is null
      or (length(i.query_text) <= 120 and c.display_name ilike p.like_pattern escape E'\\')
    )
    and (p_after_id is null or c.id > p_after_id)
    and (not i.owners_only or exists(
      select 1 from public.property_contacts pc
      where pc.contact_id = c.id and pc.relation = 'owner'))
  order by c.id
  limit least(greatest(coalesce(p_limit, 31), 1), 31);
$$;
revoke all on function public.list_contacts(text,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.list_contacts(text,uuid,boolean,integer) to authenticated;
commit;
