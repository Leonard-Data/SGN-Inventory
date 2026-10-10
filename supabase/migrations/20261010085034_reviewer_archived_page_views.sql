-- Reviewers can read archived detail; that read may record a page view, never a site visit.
-- Preserve the existing public invoker wrapper, employee-derived actor and retry contract.
create or replace function private.record_activity(p_property_id uuid,p_kind text,p_key uuid,p_notes text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); result uuid;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_kind not in ('page_view','site_visit') or p_key is null then raise exception 'invalid activity'; end if;
  if not exists (
    select 1 from public.properties where id = p_property_id
      and (archived_at is null or (p_kind = 'page_view' and private.is_reviewer()))
  ) then raise exception 'property not found'; end if;
  insert into public.activity_events(employee_id,property_id,kind,idempotency_key,visit_status,notes)
    values(me,p_property_id,p_kind,p_key,case when p_kind = 'site_visit' then 'pending' end,p_notes)
    on conflict (employee_id,idempotency_key) do nothing returning id into result;
  if result is null then
    select id into result from public.activity_events where employee_id = me and idempotency_key = p_key and property_id = p_property_id and kind = p_kind;
    if result is null then raise exception 'idempotency key reused with different payload'; end if;
  end if;
  return result;
end;
$$;
revoke all on function private.record_activity(uuid,text,uuid,text) from public,anon;
grant execute on function private.record_activity(uuid,text,uuid,text) to authenticated;
