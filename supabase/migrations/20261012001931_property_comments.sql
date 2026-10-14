-- Ticket #44: shared flat Property discussion. Any active employee who can read an
-- unarchived Property may read/post, with no Property-edit authority and no approval.
-- Immutable originals: no client writes, no edit or removal surface in this slice.
begin;

create table public.property_comments (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  author_id uuid not null references public.employees(id),
  -- Retained original attribution; a later display-name change never rewrites history.
  author_name text not null check (length(btrim(author_name)) > 0),
  body text not null,
  created_at timestamptz not null default clock_timestamp(),
  -- Current comment identity for later guarded author operations; immutable in this slice.
  revision uuid not null default gen_random_uuid(),
  idempotency_key uuid not null,
  check (body = private.trim_unicode(body) and length(body) between 1 and 2000),
  unique (author_id, idempotency_key)
);
comment on table public.property_comments is 'Flat shared Property discussion; read and posted by any active employee who can read the property';
comment on column public.property_comments.author_name is 'Employee display name retained at posting time';
comment on column public.property_comments.idempotency_key is 'Employee-scoped submission key; one comment identity per employee and key';

-- Newest-posting-first keyset paging with a stable unique tie-breaker.
create index property_comments_page_idx on public.property_comments(property_id, created_at desc, id desc);

alter table public.property_comments enable row level security;
-- Explicit grants: reads only. No client INSERT/UPDATE/DELETE path exists.
revoke all on public.property_comments from public, anon, authenticated, service_role;
grant select on public.property_comments to authenticated;

-- The archived-Property boundary is stated explicitly so it cannot drift from the parent rule:
-- reviewers read archived discussion, ordinary employees do not.
create policy comments_read on public.property_comments for select to authenticated using (
  private.employee_id() is not null
  and exists (
    select 1 from public.properties p
    where p.id = property_id and (p.archived_at is null or private.is_reviewer())
  )
);

-- Originals are protected from ordinary clients from their first creation. The guarded
-- definer functions run as the table owner, so current_user is never a client role there.
create function private.guard_comment_original() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'use the comment RPC' using errcode = '42501';
    end if;
  else
    raise exception 'posting identity, text and time are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger comment_original before insert or update or delete on public.property_comments
  for each row execute function private.guard_comment_original();

create function private.post_property_comment(p_property_id uuid,p_body text,p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  text_body text := private.trim_unicode(p_body);
  archived timestamptz;
  author text;
  existing public.property_comments;
  created public.property_comments;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_key is null then raise exception 'submission key required' using errcode = '23514'; end if;
  if text_body is null or length(text_body) not between 1 and 2000 then
    raise exception 'comment text must be 1 to 2000 characters' using errcode = '23514';
  end if;
  if p_property_id is null then raise exception 'property required' using errcode = '23514'; end if;
  -- Lock the parent Property first so a concurrent archive serializes here, and read the
  -- archive state under that lock rather than trusting the pre-lock snapshot.
  select p.archived_at into archived from public.properties p where p.id = p_property_id for update;
  if not found then raise exception 'property not found' using errcode = '23514'; end if;
  if archived is not null then raise exception 'archived property cannot receive comments' using errcode = '42501'; end if;
  select e.display_name into author from public.employees e where e.id = me;
  insert into public.property_comments(property_id,author_id,author_name,body,idempotency_key)
    values(p_property_id,me,author,text_body,p_key)
    on conflict (author_id,idempotency_key) do nothing
    returning * into created;
  if created.id is null then
    -- Recovery converges on the original identity; conflicting reuse is rejected. The
    -- archive and access checks above already ran, so recovery is not a later route in.
    select * into existing from public.property_comments where author_id = me and idempotency_key = p_key;
    if existing.id is null or existing.property_id <> p_property_id or existing.body <> text_body then
      raise exception 'submission key reused with a different comment' using errcode = '23505';
    end if;
    created := existing;
  end if;
  return jsonb_build_object(
    'id',created.id,'property_id',created.property_id,'author_id',created.author_id,
    'author_name',created.author_name,'body',created.body,'created_at',created.created_at,
    'revision',created.revision);
end;
$$;
revoke all on function private.guard_comment_original(),private.post_property_comment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.post_property_comment(uuid,text,uuid) to authenticated;

create function public.post_property_comment(p_property_id uuid,p_body text,p_key uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.post_property_comment(p_property_id,p_body,p_key);
$$;
revoke all on function public.post_property_comment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.post_property_comment(uuid,text,uuid) to authenticated;

-- Read paging stays an invoker wrapper so the caller's RLS decides every row. One extra row
-- is returned so the caller can detect a following page; the exposed page is at most 30.
create function public.list_property_comments(
  p_property_id uuid,
  p_before_created_at timestamptz default null,
  p_before_id uuid default null,
  p_limit integer default 31
) returns table(
  id uuid,
  property_id uuid,
  author_id uuid,
  author_name text,
  body text,
  created_at timestamptz,
  revision uuid
) language sql stable security invoker set search_path = '' as $$
  select c.id, c.property_id, c.author_id, c.author_name, c.body, c.created_at, c.revision
  from public.property_comments c
  where c.property_id = p_property_id
    and (
      p_before_created_at is null
      or (p_before_id is not null and (c.created_at,c.id) < (p_before_created_at,p_before_id))
    )
  order by c.created_at desc, c.id desc
  limit least(greatest(coalesce(p_limit,31),1),31);
$$;
revoke all on function public.list_property_comments(uuid,timestamptz,uuid,integer) from public,anon,authenticated;
grant execute on function public.list_property_comments(uuid,timestamptz,uuid,integer) to authenticated;
commit;
