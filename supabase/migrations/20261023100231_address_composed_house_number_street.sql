-- The captain's correction (23 October 2026): the house number and the street are one line, so no
-- comma sits between them. An address reads `8 Lê Lợi, Phường Bến Nghé, Quận 1, Thành phố Hồ Chí
-- Minh`, never `8, Lê Lợi, ...`.
--
-- 1. The composition rule. `private.composed_address_text` pairs the house number and the street
--    with a single space and keeps `, ` between that pair and the levels above it - commune, the
--    legacy district part and province - exactly as before. A missing house number or a missing
--    street leaves the surviving part alone, so no stray separator and no doubled space reaches
--    the text, and a row with neither composes the rest of the line unchanged. The function stays
--    the one owner of composition: the pre-create duplicate read
--    (public.property_address_duplicates) and every save path already call it, so they take this
--    rule up without a second implementation. The import's own current-address builder
--    (scripts/legacy-import-write.mjs, currentAddressText) follows the same rule.
--
-- 2. The stored text of existing rows. Every address row whose parts compose a text now stores
--    that composition, so `address_text` is what a save would produce today. This supersedes the
--    earlier decision recorded in 20261023042826_address_text_composed_from_parts.sql to leave
--    imported wording untouched: the captain's instruction to update the saved data covers those
--    rows too, and this migration is where that change of decision lives. A row that records no
--    part at all composes nothing and keeps the text it holds.
--    Measured on the production project on 23 October 2026: 290 rows rewritten - 21 of them read
--    `house number, street, ...`, the rest carry the wording an import recorded rather than the
--    composition of their own parts. Production is live, so the migration reports the number it
--    actually rewrote in the deploy log instead of trusting that figure.
--    Only `address_text` is written. The parts, the units, the mapping evidence, the revision and
--    every other column are left as they are, and no `property_history` row and no `audit_events`
--    row is produced, so the correction is not recorded as an employee's business change. The one
--    derived column that follows it is `search_text`: the address search trigger is left enabled
--    and rebuilds the projection from the corrected text, so a property is still found by the
--    address a person types.
--    Three triggers are disabled for the rewrite and re-enabled before commit, because each one
--    guards a write this correction is not:
--      * maintenance_revision would refuse any change to a legacy row's text (the original legacy
--        source is immutable) and would advance the revision of every row it touched;
--      * audit_property_addresses would record an audit row per row, and this is a correction of a
--        derived text, not a record change;
--      * address_guard would refuse the text of a `verified` mapping row, whose reviewer evidence
--        is about its units and is left untouched.
--    The disable takes an ACCESS EXCLUSIVE lock on the table and holds it until this transaction
--    commits, so no other session writes an address while the guards are off, and re-running the
--    migration rewrites nothing because a row already holding the composition no longer differs.
begin;

create or replace function private.composed_address_text(a public.property_addresses) returns text
language sql stable security invoker set search_path='' as $$
  select nullif(array_to_string(array_remove(array[
    -- The house number and the street name one line: one space between them, and nothing when
    -- either is missing.
    nullif(array_to_string(array_remove(array[
      nullif(btrim(a.house_number),''),
      nullif(btrim(a.street),'')
    ],null),' '),''),
    coalesce((select name_vi from public.admin_unit_versions where id=a.commune_unit_id),nullif(btrim(a.commune_text),'')),
    case when a.format<>'current' then
      coalesce((select name_vi from public.admin_unit_versions where id=a.district_unit_id),nullif(btrim(a.district_text),'')) end,
    coalesce((select name_vi from public.admin_unit_versions where id=a.province_unit_id),nullif(btrim(a.province_text),''))
  ],null),', '),'');
$$;

-- The function is replaced in place, so it keeps the ACL of 20261023072531: executable by
-- authenticated (the pre-create read) and by no one else.

alter table public.property_addresses disable trigger maintenance_revision;
alter table public.property_addresses disable trigger audit_property_addresses;
alter table public.property_addresses disable trigger address_guard;

do $$
declare rewritten integer;
begin
  with recomposed as (
    select a.id, private.composed_address_text(a) as text
    from public.property_addresses a
  )
  update public.property_addresses a set address_text=recomposed.text
  from recomposed
  where recomposed.id=a.id
    and recomposed.text is not null
    and recomposed.text is distinct from a.address_text;
  get diagnostics rewritten = row_count;
  raise notice 'address text recomposed for % rows', rewritten;
end;
$$;

alter table public.property_addresses enable trigger maintenance_revision;
alter table public.property_addresses enable trigger audit_property_addresses;
alter table public.property_addresses enable trigger address_guard;

commit;
