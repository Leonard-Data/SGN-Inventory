-- Ticket #46: author editing for the shared Property discussion.
-- An author replaces only their own live comment text on an unarchived Property through one
-- revision-checked operation. Every prior version, including the original, is retained as
-- reviewer-only evidence; the current discussion shows the updated text and an edited marker.
-- Removal, moderation and posting retry keep their delivered behavior.
begin;

-- Current-row edit marker. `body` still carries the live text and becomes null exactly on
-- removal, so an edit never rewrites author, property, posting time or posting position.
alter table public.property_comments add column edited_at timestamptz;
comment on column public.property_comments.edited_at is 'Time of the most recent accepted author edit; null when the comment still carries its original validated text';

-- Retained per-edit evidence. One immutable row per accepted edit, in edit order, holding the
-- text before and after that edit together with both revisions, the author and the accepting
-- actor. Ordinary readers and the author cannot select it; active manager/admin can.
create table public.property_comment_edits (
  id uuid primary key default gen_random_uuid(),
  edit_key uuid not null,
  comment_id uuid not null references public.property_comments(id),
  property_id uuid not null references public.properties(id),
  author_id uuid not null references public.employees(id),
  author_name text not null check (length(btrim(author_name)) > 0),
  edited_by uuid not null references public.employees(id),
  edited_actor_name text not null check (length(btrim(edited_actor_name)) > 0),
  -- 1 is the first accepted edit of the comment; ordering is deterministic and gap-free.
  version integer not null check (version >= 1),
  previous_body text not null,
  body text not null,
  previous_revision uuid not null,
  revision uuid not null,
  edited_at timestamptz not null default clock_timestamp(),
  check (previous_body = private.trim_unicode(previous_body) and length(previous_body) between 1 and 2000),
  check (body = private.trim_unicode(body) and length(body) between 1 and 2000),
  check (body is distinct from previous_body),
  check (previous_revision is distinct from revision),
  unique (comment_id, version),
  unique (edited_by, edit_key)
);
comment on table public.property_comment_edits is 'Retained before/after text of every accepted Property comment edit; reviewer-only, no automatic expiry';
comment on column public.property_comment_edits.edit_key is 'Employee-scoped identity of an accepted edit operation, used to recover an ambiguous response';
comment on column public.property_comment_edits.version is 'Accepted-edit ordinal for the comment; version 1 is the first edit of the original text';
comment on column public.property_comment_edits.previous_body is 'Text the comment carried immediately before this edit; the earliest version retains the original validated text';
comment on column public.property_comment_edits.previous_revision is 'Comment revision that was current when this edit was accepted';
comment on column public.property_comment_edits.revision is 'Comment revision created by this edit';

alter table public.property_comment_edits enable row level security;
-- Explicit grants: reviewer-scoped reads only. No client INSERT/UPDATE/DELETE path exists.
revoke all on public.property_comment_edits from public, anon, authenticated, service_role;
grant select on public.property_comment_edits to authenticated;

-- Active manager/admin with current Property access, including archived Properties. The
-- ordinary author of the comment gets no exception; prior versions are not an ordinary read.
create policy comment_edits_read on public.property_comment_edits for select to authenticated using (
  private.employee_id() is not null
  and private.is_reviewer()
  and exists (select 1 from public.properties p where p.id = property_id)
);

create function private.guard_comment_edit() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'retained comment edit evidence is immutable' using errcode = '23514';
  end if;
  if current_user in ('anon','authenticated','service_role') then
    raise exception 'use the comment edit RPC' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger comment_edit_guard before insert or update or delete on public.property_comment_edits
  for each row execute function private.guard_comment_edit();

-- A client still has no comment write path. The guarded definer runs as its owner, and even
-- there the accepted mutations are exactly two transitions: the one-way removal already
-- delivered, and the author edit that replaces live text while recording its time. Every
-- other change, a second removal and every delete stay rejected.
create or replace function private.guard_comment_original() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'use the comment RPC' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'comment changes use the guarded RPC' using errcode = '42501';
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
      or new.revision is not distinct from old.revision then
      raise exception 'comment identity, author and posting time are immutable' using errcode = '23514';
    end if;
    if new.removed_at is not null then
      -- The one-way removal transition withdraws the current text and leaves the edit time.
      if new.body is not null or new.edited_at is distinct from old.edited_at then
        raise exception 'removal withdraws the current text without rewriting history' using errcode = '23514';
      end if;
    else
      -- The author edit transition replaces live text and records a non-decreasing edit time.
      if new.body is null
        or new.body = old.body
        or new.edited_at is null
        or (old.edited_at is not null and new.edited_at < old.edited_at) then
        raise exception 'an edit replaces live text and records its time' using errcode = '23514';
      end if;
    end if;
  else
    raise exception 'comment history is never deleted' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.edit_property_comment(
  p_property_id uuid,
  p_comment_id uuid,
  p_revision uuid,
  p_body text,
  p_key uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  text_body text := private.trim_unicode(p_body);
  archived timestamptz;
  actor text;
  comment public.property_comments;
  edited public.property_comments;
  prior_edit public.property_comment_edits;
  next_version integer;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_property_id is null or p_comment_id is null or p_revision is null or p_key is null then
    raise exception 'property, comment, revision and edit key required' using errcode = '23514';
  end if;
  if text_body is null or length(text_body) not between 1 and 2000 then
    raise exception 'comment text must be 1 to 2000 characters' using errcode = '23514';
  end if;
  -- Lock the parent Property first so a concurrent archive serializes here, and read the
  -- archive state under that lock rather than trusting the pre-lock snapshot.
  select p.archived_at into archived from public.properties p where p.id = p_property_id for update;
  if not found then raise exception 'property not found' using errcode = '23514'; end if;
  if archived is not null then
    raise exception 'archived property blocks author edits' using errcode = 'PT403';
  end if;
  -- The comment's own parent is authoritative; the caller's Property is only a routing check.
  select * into comment from public.property_comments where id = p_comment_id and property_id = p_property_id for update;
  if comment.id is null then raise exception 'comment not found' using errcode = '23514'; end if;
  -- Live authority is checked before state, so an unauthorized caller learns nothing about a
  -- comment it could not already read. Only the author may edit; property-edit authority and
  -- manager/admin role grant nothing here.
  if comment.author_id <> me then
    raise exception 'only the author may edit this comment' using errcode = '42501';
  end if;
  select * into prior_edit
    from public.property_comment_edits e
    where e.edited_by = me and e.edit_key = p_key;
  if prior_edit.id is not null then
    if prior_edit.property_id is distinct from p_property_id
      or prior_edit.comment_id is distinct from p_comment_id
      or prior_edit.previous_revision is distinct from p_revision
      or prior_edit.body is distinct from text_body then
      raise exception 'edit key reused with a different operation' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'id',comment.id,'property_id',comment.property_id,'author_id',comment.author_id,
      'author_name',comment.author_name,'body',comment.body,'created_at',comment.created_at,
      'revision',comment.revision,'removed_at',comment.removed_at,'edited_at',comment.edited_at);
  end if;
  if comment.removed_at is not null then
    raise exception 'removed comments cannot be edited' using errcode = 'PT409';
  end if;
  -- A stale save is rejected rather than applied to newer text.
  if comment.revision is distinct from p_revision then
    raise exception 'stale edit; reload current state' using errcode = 'PT409';
  end if;
  if comment.body = text_body then
    raise exception 'comment text is unchanged' using errcode = 'PT400';
  end if;
  select coalesce(max(e.version),0) + 1 into next_version
    from public.property_comment_edits e where e.comment_id = p_comment_id;
  select e.display_name into actor from public.employees e where e.id = me;
  update public.property_comments
    set body = text_body, revision = gen_random_uuid(), edited_at = clock_timestamp()
    where id = p_comment_id
    returning * into edited;
  insert into public.property_comment_edits(
    edit_key,comment_id,property_id,author_id,author_name,edited_by,edited_actor_name,version,
    previous_body,body,previous_revision,revision)
    values (
      p_key,comment.id,comment.property_id,comment.author_id,comment.author_name,me,actor,
      next_version,comment.body,text_body,comment.revision,edited.revision);
  -- The current-discussion projection carries the live text and the edited marker only.
  return jsonb_build_object(
    'id',edited.id,'property_id',edited.property_id,'author_id',edited.author_id,
    'author_name',edited.author_name,'body',edited.body,'created_at',edited.created_at,
    'revision',edited.revision,'removed_at',edited.removed_at,'edited_at',edited.edited_at);
end;
$$;
revoke all on function private.guard_comment_edit(),private.edit_property_comment(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.edit_property_comment(uuid,uuid,uuid,text,uuid) to authenticated;

create function public.edit_property_comment(
  p_property_id uuid,
  p_comment_id uuid,
  p_revision uuid,
  p_body text,
  p_key uuid
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.edit_property_comment(p_property_id,p_comment_id,p_revision,p_body,p_key);
$$;
revoke all on function public.edit_property_comment(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.edit_property_comment(uuid,uuid,uuid,text,uuid) to authenticated;

-- Posting recovery compares against the original validated submission, never the latest
-- edited text: the earliest retained edit carries the original, then a live current body, then
-- the retained text of a removed comment. Everything else about the delivered recovery,
-- including the live membership and archive recheck, is unchanged.
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
    select e.previous_body into retained_body
      from public.property_comment_edits e
      where e.comment_id = existing.id
      order by e.version asc
      limit 1;
    if retained_body is null then
      retained_body := existing.body;
      if retained_body is null then
        select r.body into retained_body from public.property_comment_removals r where r.comment_id = existing.id;
      end if;
    end if;
    if retained_body is distinct from text_body then
      raise exception 'submission key reused with a different comment' using errcode = '23505';
    end if;
    created := existing;
  end if;
  return jsonb_build_object(
    'id',created.id,'property_id',created.property_id,'author_id',created.author_id,
    'author_name',created.author_name,'body',created.body,'created_at',created.created_at,
    'revision',created.revision,'removed_at',created.removed_at,'edited_at',created.edited_at);
end;
$$;
revoke all on function private.post_property_comment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.post_property_comment(uuid,text,uuid) to authenticated;

-- Read paging stays an invoker wrapper so the caller's RLS decides every row. One extra row
-- is returned so the caller can detect a following page; the exposed page is at most 30. The
-- current-discussion projection states the live text, the removal marker and the edited
-- marker; it never carries a preceding version.
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
  removed_at timestamptz,
  edited_at timestamptz
) language sql stable security invoker set search_path = '' as $$
  select c.id, c.property_id, c.author_id, c.author_name, c.body, c.created_at, c.revision, c.removed_at, c.edited_at
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

-- The removal projection must state the edited marker too: an entry may have been edited before
-- it was withdrawn, and every response the application reads carries the same shape. The
-- delivered transition itself is unchanged.
create or replace function private.remove_property_comment(
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
  -- Stale removal is rejected rather than applied to newer (possibly edited) text.
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
    'revision',removed.revision,'removed_at',removed.removed_at,'edited_at',removed.edited_at);
end;
$$;
revoke all on function private.remove_property_comment(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.remove_property_comment(uuid,uuid,uuid,text,text) to authenticated;
commit;
