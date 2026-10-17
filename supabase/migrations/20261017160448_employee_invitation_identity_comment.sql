-- Issue #68 follow-up: the recorded provider identity is not always one this invitation created.
-- A refused retry is classified by looking the recorded address up through the Auth administration
-- API, and an identity found that way may predate the invitation. The column comment states
-- exactly what is recorded and what is not: the invitation is associated with that sign-in
-- identity, and only the separate verified acceptance links it to the employee. Comment only: no
-- column, constraint, grant, policy or data change.
begin;

comment on column public.employee_invitations.provider_user_id is 'The provider sign-in identity this invitation is associated with: the identity the accepted invitation request created, or on a refused-retry recovery an identity the address lookup found that may predate this invitation, and it is linked to the employee only by the separate verified acceptance';

commit;
