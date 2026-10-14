-- Ticket #45: accountable removal for the shared Property discussion.
-- Removal is recorded, not erased: the current comment loses its text and gains a
-- removal marker, while the original text, authorship, actor, time and moderation
-- reason are retained in a reviewer-only table. Direct clients keep no write path.
begin;

-- The current row keeps the comment identity, author attribution and posting time; only the
-- text is withdrawn, so `body` is null exactly when the comment has been removed.
alter table public.property_comments alter column body drop not null;
alter table public.property_comments add column removed_at timestamptz;
alter table public.property_comments add constraint property_comments_removal_shape
  check ((body is null) = (removed_at is not null));
comment on column public.property_comments.removed_at is 'Set once when the comment text is withdrawn; removed comments are terminal';

-- Retained evidence for a removal. Ordinary readers cannot select it; active manager/admin can.
create table public.property_comment_removals (
  comment_id uuid primary key references public.property_comments(id),
  property_id uuid not null references public.properties(id),
  author_id uuid not null references public.employees(id),
  author_name text not null check (length(btrim(author_name)) > 0),
  body text not null,
  original_created_at timestamptz not null,
  original_revision uuid not null,
  removed_by uuid not null references public.employees(id),
  removed_actor_name text not null check (length(btrim(removed_actor_name)) > 0),
  removed_at timestamptz not null default clock_timestamp(),
  removal_kind text not null check (removal_kind in ('author','moderation')),
  removal_reason text,
  check (body = private.trim_unicode(body) and length(body) between 1 and 2000),
  check (removal_kind = 'author' and removal_reason is null
      or removal_kind = 'moderation'
         and removal_reason is not null
         and removal_reason = private.trim_unicode(removal_reason)
         and length(removal_reason) between 1 and 2000)
);
comment on table public.property_comment_removals is 'Retained evidence of a Property comment removal; reviewer-only, no automatic expiry';
comment on column public.property_comment_removals.original_revision is 'Comment revision that was current when the removal was accepted';
comment on column public.property_comment_removals.removal_kind is 'author: the author withdrew their own current comment; moderation: a manager/admin removed it with a reason';

alter table public.property_comment_removals enable row level security;
-- Explicit grants: reviewer-scoped reads only. No client INSERT/UPDATE/DELETE path exists.
revoke all on public.property_comment_removals from public, anon, authenticated, service_role;
grant select on public.property_comment_removals to authenticated;

-- Active manager/admin with current Property access, including archived Properties. The author
-- of a removed comment gets no exception; restricted history is not an ordinary read route.
create policy comment_removals_read on public.property_comment_removals for select to authenticated using (
  private.employee_id() is not null
  and private.is_reviewer()
  and exists (select 1 from public.properties p where p.id = property_id)
);

create function private.guard_comment_removal() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'retained comment removal evidence is immutable' using errcode = '23514';
  end if;
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'use the comment removal RPC' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger comment_removal_guard before insert or update or delete on public.property_comment_removals
  for each row execute function private.guard_comment_removal();

-- A client still has no comment write path. The guarded definer runs as its owner, and even
-- there the only accepted mutation is the one-way removal transition; every other change,
-- and any second removal, is rejected.
create or replace function private.guard_comment_original() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'use the comment RPC' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'comment removal uses the guarded RPC' using errcode = '42501';
    end if;
    if old.removed_at is not null then
      raise exception 'removed comments are terminal' using errcode = '23514';
    end if;
    if new.id is distinct from old.id
      or new.property_id is distinct from old.property_id
      or new.author_id is distinct from old.author_id
      or new.author_name is distinct from old.author_name
      or new.created_at is distinct from old.created_at
      or new.idempotency_key is distinct from old.idempotency_key
      or new.body is not null
      or new.removed_at is null
      or new.revision is not distinct from old.revision then
      raise exception 'posting identity, text and time are immutable' using errcode = '23514';
    end if;
  else
    raise exception 'posting identity, text and time are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.remove_property_comment(
  p_property_id uuid,
  p_comment_id uuid,
  p_revision uuid,
  p_kind text,
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  kind text := private.trim_unicode(p_kind);
  reason text := nullif(private.trim_unicode(p_reason),'');
  prop_id uuid;
  archived timestamptz;
  actor text;
  comment public.property_comments;
  removed public.property_comments;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_property_id is null or p_comment_id is null or p_revision is null then
    raise exception 'property, comment and revision required' using errcode = '23514';
  end if;
  if kind is null or kind not in ('author','moderation') then
    raise exception 'invalid removal kind' using errcode = '23514';
  end if;
  -- The comment's own parent is authoritative; the caller's Property is only a routing check.
  select c.property_id into prop_id from public.property_comments c where c.id = p_comment_id;
  if prop_id is null or prop_id <> p_property_id then
    raise exception 'comment not found' using errcode = '23514';
  end if;
  -- Lock the parent Property first so a concurrent archive serializes here, and read the
  -- archive state under that lock rather than trusting the pre-lock snapshot.
  select p.archived_at into archived from public.properties p where p.id = prop_id for update;
  if not found then raise exception 'property not found' using errcode = '23514'; end if;
  select * into comment from public.property_comments where id = p_comment_id for update;
  if comment.id is null then raise exception 'comment not found' using errcode = '23514'; end if;
  -- Live authority is checked before the removal state, so an unauthorized caller learns
  -- nothing about a comment it could not already read.
  if kind = 'author' then
    if comment.author_id <> me then raise exception 'only the author may remove this comment' using errcode = '42501'; end if;
    if archived is not null then raise exception 'archived property blocks author removal' using errcode = '42501'; end if;
    if reason is not null then raise exception 'author removal takes no moderation reason' using errcode = '23514'; end if;
  else
    if not private.is_reviewer() then raise exception 'reviewer required' using errcode = '42501'; end if;
    if reason is null or length(reason) > 2000 then
      raise exception 'nonblank moderation reason required' using errcode = '23514';
    end if;
  end if;
  if comment.removed_at is not null then
    raise exception 'comment already removed; reload current state' using errcode = 'PT409';
  end if;
  -- Stale removal is rejected rather than applied to newer text.
  if comment.revision is distinct from p_revision then
    raise exception 'stale removal; reload current state' using errcode = 'PT409';
  end if;
  select e.display_name into actor from public.employees e where e.id = me;
  update public.property_comments
    set body = null, removed_at = clock_timestamp(), revision = gen_random_uuid()
    where id = p_comment_id
    returning * into removed;
  insert into public.property_comment_removals(
    comment_id,property_id,author_id,author_name,body,original_created_at,original_revision,
    removed_by,removed_actor_name,removal_kind,removal_reason)
    values (
      comment.id,comment.property_id,comment.author_id,comment.author_name,comment.body,
      comment.created_at,comment.revision,me,actor,kind,reason);
  -- The current-discussion projection carries no removed text and no moderation reason.
  return jsonb_build_object(
    'id',removed.id,'property_id',removed.property_id,'author_id',removed.author_id,
    'author_name',removed.author_name,'body',null,'created_at',removed.created_at,
    'revision',removed.revision,'removed_at',removed.removed_at);
end;
$$;
revoke all on function private.guard_comment_removal(),private.remove_property_comment(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.remove_property_comment(uuid,uuid,uuid,text,text) to authenticated;

create function public.remove_property_comment(
  p_property_id uuid,
  p_comment_id uuid,
  p_revision uuid,
  p_kind text,
  p_reason text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.remove_property_comment(p_property_id,p_comment_id,p_revision,p_kind,p_reason);
$$;
revoke all on function public.remove_property_comment(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.remove_property_comment(uuid,uuid,uuid,text,text) to authenticated;

-- Posting recovery must report a later removal as a marker, never return withdrawn text.
create or replace function private.post_property_comment(p_property_id uuid,p_body text,p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  text_body text := private.trim_unicode(p_body);
  archived timestamptz;
  author text;
  retained_body text;
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
    if existing.id is null or existing.property_id <> p_property_id then
      raise exception 'submission key reused with a different comment' using errcode = '23505';
    end if;
    -- A removed comment no longer carries its text here, so compare against the retained
    -- original rather than letting a withdrawn body satisfy the reuse check.
    retained_body := existing.body;
    if retained_body is null then
      select r.body into retained_body from public.property_comment_removals r where r.comment_id = existing.id;
    end if;
    if retained_body is distinct from text_body then
      raise exception 'submission key reused with a different comment' using errcode = '23505';
    end if;
    created := existing;
  end if;
  return jsonb_build_object(
    'id',created.id,'property_id',created.property_id,'author_id',created.author_id,
    'author_name',created.author_name,'body',created.body,'created_at',created.created_at,
    'revision',created.revision,'removed_at',created.removed_at);
end;
$$;
revoke all on function private.post_property_comment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.post_property_comment(uuid,text,uuid) to authenticated;

-- Read paging stays an invoker wrapper so the caller's RLS decides every row. One extra row
-- is returned so the caller can detect a following page; the exposed page is at most 30.
-- The current-discussion projection states the removal marker; the text is already withdrawn.
drop function public.list_property_comments(uuid,timestamptz,uuid,integer);
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
  revision uuid,
  removed_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select c.id, c.property_id, c.author_id, c.author_name, c.body, c.created_at, c.revision, c.removed_at
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
