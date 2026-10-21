-- Close the browser write path to the old -> new crosswalk.
--
-- 20261010013006_inventory_access_workflows.sql granted insert and update on
-- public.admin_unit_crosswalks to authenticated behind an admin-only policy. That
-- was inert while the table was empty; now that the table is the evidence behind
-- official_whole_mapping, an admin who could insert or edit a row - including
-- source_attested, relation or effective_on - would be building the evidence for
-- their own verification. The table becomes migration-only: rows are written by
-- migration or service_role, and the review path for a missing row is a new
-- migration with its own source.
--
-- select stays with member_read for every active employee; anon keeps nothing;
-- service_role keeps all. No audit trigger is attached here, and none is added,
-- so nothing else about the table changes.

begin;

drop policy admin_insert on public.admin_unit_crosswalks;
drop policy admin_update on public.admin_unit_crosswalks;
revoke insert, update on public.admin_unit_crosswalks from authenticated;

commit;
