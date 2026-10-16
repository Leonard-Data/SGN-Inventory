begin;

alter table public.employees
  add column access_revision bigint not null default 0
  check (access_revision >= 0);

create function private.bump_employee_access_revision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
    or new.is_active is distinct from old.is_active
    or new.auth_user_id is distinct from old.auth_user_id
  then
    new.access_revision := old.access_revision + 1;
  else
    new.access_revision := old.access_revision;
  end if;
  return new;
end;
$$;

revoke all on function private.bump_employee_access_revision() from public, anon, authenticated, service_role;

create trigger employee_access_revision
before update on public.employees
for each row execute function private.bump_employee_access_revision();

commit;
