-- Ticket #22: Property file read workspace.
-- Replace blanket member_read with files_read policy that lets uploaders
-- see their own pending/failed metadata (needed for upload registration)
-- and lets all active employees read ready files on accessible properties.
-- No purpose/category/INSERT changes or authorize_file_read RPC (#23+).
begin;

-- Replace property_files read RLS: ready files on accessible properties,
-- plus uploader's own pending/failed records for upload registration.
drop policy if exists member_read on public.property_files;
create policy files_read on public.property_files for select to authenticated using (
  private.employee_id() is not null
  and (
    upload_status = 'ready'
    and exists (
      select 1 from public.properties
      where id = property_id
        and (archived_at is null or private.is_reviewer())
    )
    or uploaded_by = private.employee_id()
  )
);

commit;
