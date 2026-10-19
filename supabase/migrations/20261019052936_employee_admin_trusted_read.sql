begin;

-- The invitation acceptance session path reads the recorded invitation and the retained
-- employee's administrative operations through the server-only admin client (`service_role`),
-- because the ordinary read policy is live-admin-only and the invitee is nobody's admin yet.
-- Both tables revoked their default access from every role, so that trusted read was denied
-- (42501) and a real invitee with a valid link was refused at the acceptance endpoint even
-- though the session had been established correctly.
--
-- This grants SELECT, and only SELECT, to the trusted server adapter, matching what
-- `public.employees` already allows it. Browser-facing roles keep exactly what they had:
-- `authenticated` reads both tables under the live-admin policy, `anon` and `public` read
-- neither. No write privilege, no policy and no row-visibility rule changes here.
grant select on public.employee_invitations, public.employee_admin_operations to service_role;

commit;
