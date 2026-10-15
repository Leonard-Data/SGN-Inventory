-- Issue #37 follow-up: a request-context insert cannot choose its own original entry date or
-- forge legacy provenance. The authoritative create path records the Vietnam business day as
-- `recorded`; the controlled import keeps setting reliable legacy dates outside a user request.
-- Who may create a property and the existing immutability rule are unchanged.
begin;
create or replace function private.guard_inventory_entry_date() returns trigger
language plpgsql security invoker set search_path='' as $$
declare vn_today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if tg_op='INSERT' then
    if new.entry_on is not null and new.entry_on > vn_today then
      raise exception 'original inventory entry date cannot be in the future' using errcode='23514';
    end if;
    if auth.uid() is not null and (new.entry_on is distinct from vn_today or new.entry_source is distinct from 'recorded') then
      raise exception 'a client insert may only record today as recorded entry provenance' using errcode='23514';
    end if;
  elsif new.entry_on is distinct from old.entry_on or new.entry_source is distinct from old.entry_source then
    raise exception 'original inventory entry date is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_inventory_entry_date() from public,anon,authenticated;
commit;
