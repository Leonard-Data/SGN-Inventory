-- Thirteen extra legacy communes the captain asked for on 2026-10-23, added to
-- the pre-2025 three-tier catalog seeded by
-- 20261021060602_legacy_admin_units_reference.sql on the closed
-- [2025-01-04, 2025-07-01) window and parented to the district row of that same
-- window.
--
-- These are deliberate local additions, not snapshot data. The official legacy
-- catalogue carries all four districts but not most of these ward names under
-- them, so the captain asked for them to exist here regardless of the snapshot.
--
-- Code scheme: official ward codes are five-digit numbers, so these rows use a
-- local, unmistakably non-official form - `Q<legacy district number>-<two-digit
-- ward number>`, e.g. Q10-03, Q3-06, Q5-15. It can never collide with a numeric
-- official code, so no existing row is renamed or re-keyed by this migration.
--
-- Provenance: every row's source_url is a marker, not a citation - it records
-- that the entry was captain-requested on 2026-10-23 and is not an official
-- National Statistics Office unit. It is distinct from both seeded vendor
-- sources (sunshine-tech/VietnamProvinces for the legacy window, thanglequoc/
-- vietnamese-provinces-database for the current one), so an inspection of the
-- catalog separates these rows from official data on source_url alone.
--
-- Rows added (13): Quận 10 Phường 3, 5, 7, 11; Quận 3 Phường 6, 7, 8, 10;
-- Quận 5 Phường 3, 6, 8, 10, 15. Five further communes the captain named -
-- Quận 1 Phường Tân Định, Quận 10 Phường 9, Quận 3 Phường 9, Quận 5 Phường 7
-- and Phường 9 - already exist as official rows and are deliberately not
-- duplicated.
--
-- Idempotent: every row converges on the (unit_level, official_code,
-- valid_from) unique key, the same shape the catalog seeds use, so re-applying
-- this migration neither duplicates rows nor changes generated ids that
-- property_addresses rows reference. The conflict clause touches only the
-- columns these rows own; official rows keep their codes, names and parents.
--
-- Self-contained: no network fetch, no secret, no external file. It seeds only
-- public.admin_unit_versions; no constraint, column, index, policy or grant
-- changes, and no validity window or current-generation row changes.

begin;

with u as (select 'https://github.com/Leonard-Data/SGN-Inventory/issues/274#captain-requested-2026-10-23-not-an-official-nso-unit'::text as source_url),
v(code,name,district_code) as (values
  ('Q10-03','Phường 3','771'),
  ('Q10-05','Phường 5','771'),
  ('Q10-07','Phường 7','771'),
  ('Q10-11','Phường 11','771'),
  ('Q3-06','Phường 6','770'),
  ('Q3-07','Phường 7','770'),
  ('Q3-08','Phường 8','770'),
  ('Q3-10','Phường 10','770'),
  ('Q5-03','Phường 3','774'),
  ('Q5-06','Phường 6','774'),
  ('Q5-08','Phường 8','774'),
  ('Q5-10','Phường 10','774'),
  ('Q5-15','Phường 15','774')
)
insert into public.admin_unit_versions (official_code,name_vi,unit_level,parent_id,valid_from,valid_to,source_url)
select v.code, v.name, 'commune', d.id, date '2025-01-04', date '2025-07-01', u.source_url
from v cross join u
join public.admin_unit_versions d
  on d.unit_level = 'district' and d.official_code = v.district_code
 and d.valid_from = date '2025-01-04'
on conflict (unit_level,official_code,valid_from) do update
  set name_vi = excluded.name_vi,
      parent_id = excluded.parent_id,
      valid_to = excluded.valid_to,
      source_url = excluded.source_url;

commit;
