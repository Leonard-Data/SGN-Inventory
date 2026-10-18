-- One-time bootstrap of the reviewed first admin: Phung Hung Binh
-- (phunghungbinh.work@gmail.com), whose Auth account was created by hand in the project's
-- Authentication users. docs/migration-plan.md phase 1 step 4 records that this migration is
-- the only SQL bootstrap of an admin and that every later employee joins through the guarded
-- invitation flow instead of SQL.
--
-- The account must already exist in Auth; this migration never creates an Auth user. Where the
-- account is absent nothing is written and nothing is raised, so development and any other
-- environment without that identity is completely unaffected. Applying it twice leaves exactly
-- the same single admin row.
begin;

-- Promote the reviewed identity to the company's first active admin. Only the employee row
-- holding that address is touched, and an existing recorded name, phone or locale is kept. A
-- sign-in account already confirmed deleted is never re-linked or re-activated.
update public.employees e
set auth_user_id = u.id,
    role = 'admin',
    is_active = true
from auth.users u
where lower(btrim(u.email)) = 'phunghungbinh.work@gmail.com'
  and e.email = lower(btrim(u.email))
  and e.account_deleted_at is null
  and (e.auth_user_id is distinct from u.id or e.role <> 'admin' or not e.is_active);

-- Create the admin row only when no employee row already claims that address or that Auth
-- identity. The display name is the profile full name when present, otherwise the address
-- local part.
insert into public.employees (auth_user_id, email, display_name, role, is_active)
select u.id,
       lower(btrim(u.email)),
       coalesce(
         nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
         split_part(lower(btrim(u.email)), '@', 1)),
       'admin',
       true
from auth.users u
where lower(btrim(u.email)) = 'phunghungbinh.work@gmail.com'
  and not exists (select 1 from public.employees e where e.email = lower(btrim(u.email)))
  and not exists (select 1 from public.employees e where e.auth_user_id = u.id);

commit;
