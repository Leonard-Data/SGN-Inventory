-- Issue #279: before a record is created, the person is told which unarchived properties already
-- record the address the creation is about to save, so they can look at them and then decide. The
-- warning informs and never blocks: a second property at one address is an ordinary case, and the
-- post-create duplicate group (issue #147) stays the place a decision is recorded.
--
-- One address rule, not two. The read composes the text from the parts a creation states, with the
-- same composition a save stores (`private.composed_address_text`, issue #277), and compares it with
-- `private.address_match_key` - the one definition of "the same address" the post-create group and
-- the merge already use. Nothing here restates either rule, so the warning and the group can never
-- disagree about what counts as a duplicate.
--
-- It is also the same primary-address basis: the group is made of each record's primary address, so
-- a creation that states its address as non-primary joins no group and is answered nothing.
--
-- The read is a `public` invoker function, like the group read: ordinary row-level security decides
-- which properties are visible, so a warning never names a record the person may not open. It
-- answers only what naming and opening one needs - the identity and the recorded code - and never
-- an owner name or a phone number.
begin;

-- The composition is the save's own, so it is reachable from the invoker read below; it is a pure
-- function of the parts and the catalog names those parts already resolve to, and it reads nothing
-- the caller cannot already read.
grant execute on function private.composed_address_text(public.property_addresses) to authenticated;

-- The pre-create read. The argument is the address change set a creation submits, never a text of
-- its own: the composed text is what a save stores, so a match is decided on what will be saved.
create function public.property_address_duplicates(p_address jsonb) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  key text;
  members jsonb;
begin
  if private.employee_id() is null then
    raise exception 'active employee required' using errcode = '42501';
  end if;
  -- The group compares primary addresses only, so this read names nothing for a creation that
  -- states no primary address: it would join no group, and a warning it cannot act on is a step.
  if p_address->>'is_primary' is distinct from 'true' then
    return '[]'::jsonb;
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
                where a.property_id = p.id and a.is_primary
                  and private.address_match_key(a.address_text) = key);
  return members;
end;
$$;
revoke all on function public.property_address_duplicates(jsonb) from public,anon,authenticated;
grant execute on function public.property_address_duplicates(jsonb) to authenticated;

commit;
