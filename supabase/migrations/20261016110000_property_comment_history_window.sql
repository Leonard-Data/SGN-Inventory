begin;
drop function if exists public.list_property_comment_history(uuid, uuid);
drop function if exists private.list_property_comment_history(uuid, uuid);

create function private.list_property_comment_history(p_property_id uuid, p_comment_id uuid)
returns table(
  event_kind text,
  version integer,
  body text,
  actor_id uuid,
  actor_name text,
  occurred_at timestamptz,
  removal_kind text,
  reason text,
  has_more boolean
)
language plpgsql security invoker set search_path = '' as $$
declare me uuid := private.employee_id();
begin
  if me is null or not private.is_reviewer() then
    raise exception 'reviewer required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.properties p where p.id = p_property_id
  ) then
    raise exception 'property not found' using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.property_comments c
    where c.id = p_comment_id and c.property_id = p_property_id
  ) then
    raise exception 'comment not found' using errcode = '42501';
  end if;

  return query
    with events(event_kind, version, body, actor_id, actor_name, occurred_at, removal_kind, reason, event_rank) as (
      select
        'posting'::text,
        0,
        coalesce(
          (
            select e.previous_body
            from public.property_comment_edits e
            where e.comment_id = p_comment_id
            order by e.version
            limit 1
          ),
          coalesce(c.body, r.body)
        ),
        c.author_id,
        c.author_name,
        c.created_at,
        null::text,
        null::text,
        0
      from public.property_comments c
      left join public.property_comment_removals r on r.comment_id = c.id
      where c.id = p_comment_id and c.property_id = p_property_id
      union all
      select
        'edit'::text,
        e.version,
        e.body,
        e.edited_by,
        e.edited_actor_name,
        e.edited_at,
        null::text,
        null::text,
        1
      from public.property_comment_edits e
      where e.comment_id = p_comment_id
      union all
      select
        'removal'::text,
        null::integer,
        r.body,
        r.removed_by,
        r.removed_actor_name,
        r.removed_at,
        r.removal_kind,
        r.removal_reason,
        2
      from public.property_comment_removals r
      where r.comment_id = p_comment_id
    ),
    limited as (
      select
        e.*,
        count(*) over () > 64 as has_more,
        row_number() over (
          order by e.occurred_at, e.event_rank, coalesce(e.version, 2147483647)
        ) as event_number
      from (
        select *
        from events
        order by occurred_at, event_rank, coalesce(version, 2147483647)
        limit 65
      ) e
    )
    select event_kind, version, body, actor_id, actor_name, occurred_at,
      removal_kind, reason, has_more
    from limited
    where event_number <= 64
    order by event_number;
end;
$$;
revoke all on function private.list_property_comment_history(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function private.list_property_comment_history(uuid, uuid) to authenticated;

create function public.list_property_comment_history(p_property_id uuid, p_comment_id uuid)
returns table(
  event_kind text,
  version integer,
  body text,
  actor_id uuid,
  actor_name text,
  occurred_at timestamptz,
  removal_kind text,
  reason text,
  has_more boolean
)
language sql security invoker set search_path = '' as $$
  select * from private.list_property_comment_history(p_property_id, p_comment_id);
$$;
revoke all on function public.list_property_comment_history(uuid, uuid) from public, anon, authenticated;
grant execute on function public.list_property_comment_history(uuid, uuid) to authenticated;
commit;
