-- Drift repair: public.employee_admin_events exists on the development project without the
-- resumer submission key that 20261013161609_employee_admin_deactivation.sql records for it,
-- so every guarded employee administration call fails with 42703 on a table whose migration
-- version is already recorded as applied. This restores the recorded definition and nothing
-- else: the same nullable uuid column, its recorded comment and the same partial unique index.
-- Both statements are idempotent, so applying it to a project that already matches the
-- contract changes nothing.
begin;
alter table public.employee_admin_events
  add column if not exists idempotency_key uuid;
comment on column public.employee_admin_events.idempotency_key is 'Resumer submission key bound to the operation it resumed; the initiating actor''s key stays on the operation row';
create unique index if not exists employee_admin_events_submission_idx
  on public.employee_admin_events(actor_id, idempotency_key) where idempotency_key is not null;
commit;
