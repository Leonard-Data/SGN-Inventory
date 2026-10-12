-- Ticket #28: today's own Page-view activity. Business day is computed in Asia/Ho_Chi_Minh,
-- so the report never depends on the browser or server timezone.
begin;

create function public.my_today_activity()
returns table(business_day date,page_view_events bigint,distinct_properties_viewed bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare
  me uuid := private.employee_id();
  today date := (now() at time zone 'Asia/Ho_Chi_Minh')::date;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  return query select today,
    (select count(*) from public.activity_events a
      where a.employee_id = me and a.kind = 'page_view' and a.business_day = today),
    (select count(distinct a.property_id) from public.activity_events a
      where a.employee_id = me and a.kind = 'page_view' and a.business_day = today);
end;
$$;
-- Own rows only for every role, including reviewers whose RLS covers colleagues.
revoke all on function public.my_today_activity() from public,anon,authenticated;
grant execute on function public.my_today_activity() to authenticated;
commit;
