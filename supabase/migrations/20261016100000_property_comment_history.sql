-- Ticket #47: bounded reviewer-only read of retained comment evidence.
begin;
create function private.list_property_comment_history(p_property_id uuid, p_comment_id uuid)
returns table(event_kind text, version integer, body text, actor_id uuid, actor_name text, occurred_at timestamptz, reason text)
language plpgsql security invoker set search_path = '' as $$
declare me uuid := private.employee_id();
begin
  if me is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties p where p.id=p_property_id) then raise exception 'property not found' using errcode = '42501'; end if;
  if not exists (select 1 from public.property_comments c where c.id=p_comment_id and c.property_id=p_property_id) then raise exception 'comment not found' using errcode = '42501'; end if;
  return query
    select 'posting'::text, 0, coalesce((select e.previous_body from public.property_comment_edits e where e.comment_id=p_comment_id order by e.version limit 1), coalesce(c.body,r.body)), c.author_id,c.author_name,c.created_at,null::text
    from public.property_comments c left join public.property_comment_removals r on r.comment_id=c.id
    where c.id=p_comment_id and c.property_id=p_property_id
  union all
    select 'edit', e.version, e.body, e.edited_by, e.edited_actor_name, e.edited_at, null::text
    from public.property_comment_edits e where e.comment_id=p_comment_id
  union all
    select 'removal', null, r.body, r.removed_by, r.removed_actor_name, r.removed_at, r.removal_reason
    from public.property_comment_removals r where r.comment_id=p_comment_id
    order by occurred_at, version;
end;
$$;
revoke all on function private.list_property_comment_history(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function private.list_property_comment_history(uuid,uuid) to authenticated;
create function public.list_property_comment_history(p_property_id uuid,p_comment_id uuid)
returns table(event_kind text,version integer,body text,actor_id uuid,actor_name text,occurred_at timestamptz,reason text)
language sql security invoker set search_path = '' as $$ select * from private.list_property_comment_history(p_property_id,p_comment_id); $$;
revoke all on function public.list_property_comment_history(uuid,uuid) from public,anon,authenticated;
grant execute on function public.list_property_comment_history(uuid,uuid) to authenticated;
commit;
