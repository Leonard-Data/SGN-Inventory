-- The private audit trail is the largest table in the database and the only one that grows on
-- its own: every guarded write on an audited table appends a full before/after jsonb snapshot
-- through private.audit_change(). Nothing in the running application reads it -- it is
-- unexposed, revoked from anon/authenticated and has no public endpoint -- so its growth is
-- unbounded evidence storage rather than application data.
--
-- This migration adds a deliberate retention rule for that trail. No scheduler is available to
-- this project (no pg_cron extension, no Vercel cron entry, `git.deploymentEnabled` is false),
-- so the trimming mechanism is one administrative function with an explicit, documented caller
-- rather than a job: the database owner runs it from a privileged SQL session in a maintenance
-- window, as documented in docs/database-contract.md.
begin;

-- The trim selects the oldest rows below the cutoff, so make that window index-served instead
-- of a whole-table scan and sort on the one table that is expected to be the largest.
create index audit_events_created_at_idx on private.audit_events(created_at);

-- Retention window default: 365 days. Rows newer than the window are never touched, the trail
-- is never disabled, and nothing here reads or returns audit content -- the function reports
-- only how many rows it removed. Change the window per call, or in one place by editing the
-- default below in a later migration; the bound keeps 30 days as the floor so a bad value
-- cannot become a wipe.
create function private.trim_audit_events(p_retain_days integer default 365, p_max_rows integer default 20000)
returns integer language plpgsql security invoker set search_path = '' as $$
declare
  v_cutoff timestamptz;
  v_removed integer;
begin
  if p_retain_days is null or p_retain_days < 30 or p_retain_days > 3650 then
    raise exception 'retention window must be between 30 and 3650 days' using errcode = '22023';
  end if;
  if p_max_rows is null or p_max_rows < 1 or p_max_rows > 1000000 then
    raise exception 'row cap must be between 1 and 1000000' using errcode = '22023';
  end if;
  v_cutoff := now() - make_interval(days => p_retain_days);
  -- The target table is written literally, not passed in: this function cannot be pointed at
  -- another table. Oldest first and bounded per call, so a repeated run makes incremental
  -- progress without holding one long lock on the whole trail.
  delete from private.audit_events
   where id in (
     select id from private.audit_events
      where created_at < v_cutoff
      order by created_at
      limit p_max_rows
   );
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

-- Postgres grants EXECUTE on a new function to PUBLIC, so revoke it explicitly: no anon,
-- authenticated or service_role caller gains the ability to delete audit evidence, and the
-- private schema stays unexposed to the Data API. Only the database owner runs the trim, from
-- the same privileged plane that applies migrations.
revoke all on function private.trim_audit_events(integer,integer) from public, anon, authenticated, service_role;
commit;
