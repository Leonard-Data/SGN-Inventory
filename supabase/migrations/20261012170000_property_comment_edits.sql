-- Ticket #46: a comment author corrects their own current Property comment. The edit appends
-- retained before/after evidence instead of overwriting, the current text carries an edited
-- marker, and a stale expected revision is rejected rather than silently merged. Reader access
-- to preceding versions stays reviewer-only; application history browsing remains a later slice.
-- This migration is timestamped after the delivered removal slice and composes with it: one
-- guard accepts an author edit or a one-way removal, the reader page states both current markers
-- and posting-key replay compares against the original validated submission.
begin;

-- Latest edit time only; the original posting time and position never move. Null while the
-- original text still stands.
alter table public.property_comments add column edited_at timestamptz;
comment on column public.property_comments.edited_at is 'Server time of the latest retained edit; null while the original text stands';

-- Append-only retained evidence: one row per committed edit, holding the text that was replaced
-- and the text that replaced it, with the editing actor and time.
create table public.property_comment_revisions (
  sequence bigint generated always as identity primary key,
  comment_id uuid not null references public.property_comments(id),
  -- Denormalized so the reviewer read policy checks the parent Property without joining the
  -- discussion row, and so locking starts from the parent Property.
  property_id uuid not null references public.properties(id),
  actor_id uuid not null references public.employees(id),
  -- Editing attribution is retained at edit time; a later display-name change never rewrites it.
  actor_name text not null check (length(btrim(actor_name)) > 0),
  edited_at timestamptz not null default clock_timestamp(),
  before_revision uuid not null,
  after_revision uuid not null,
  before_body text not null check (length(before_body) between 1 and 2000),
  after_body text not null check (length(after_body) between 1 and 2000),
  check (before_revision <> after_revision),
  check (before_body <> after_body),
  unique (comment_id, after_revision)
);
comment on table public.property_comment_revisions is 'Append-only retained before/after text for author comment edits; readable only by active manager/admin with current Property access';
comment on column public.property_comment_revisions.sequence is 'Commit order within a comment; the earliest row holds the original posting text';
comment on column public.property_comment_revisions.actor_name is 'Employee display name retained at edit time';

create index property_comment_revisions_comment_idx on public.property_comment_revisions(comment_id, sequence);

alter table public.property_comment_revisions enable row level security;
-- Explicit grants: reviewer reads only. No client INSERT/UPDATE/DELETE path exists.
revoke all on public.property_comment_revisions from public, anon, authenticated, service_role;
grant select on public.property_comment_revisions to authenticated;

-- Prior versions are not an alternate disclosure route: live membership, the manager/admin role
-- and current Property access are all required, and the archived boundary matches the discussion
-- read rule. Ordinary readers and ordinary authors see only the current text.
create policy comment_revisions_read on public.property_comment_revisions for select to authenticated using (
  private.employee_id() is not null
  and private.is_reviewer()
  and exists (
    select 1 from public.properties p
    where p.id = property_id and (p.archived_at is null or private.is_reviewer())
  )
);

-- One guard for both delivered slices. Removal accepts only the one-way withdrawal that nulls
-- the text and sets the removal marker; the author edit keeps the text and leaves that marker
-- null. Both keep identity, association, posting time and a changed revision, run owner-held
-- (never as a client role), and leave a removed comment terminal.
create or replace function private.guard_comment_original() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'use the comment RPC' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' then
    if current_user in ('anon','authenticated','service_role') then
      raise exception 'comment text uses the guarded RPC' using errcode = '42501';
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
      raise exception 'comment identity, association and posting time are immutable' using errcode = '23514';
    end if;
    if new.removed_at is null then
      if new.body is null or new.body is not distinct from old.body then
        raise exception 'an edit must change its text' using errcode = '23514';
      end if;
      if new.body <> private.trim_unicode(new.body) or length(new.body) not between 1 and 2000 then
        raise exception 'edited text must be 1 to 2000 characters' using errcode = '23514';
      end if;
    elsif new.body is not null then
      raise exception 'a removal withdraws the comment text' using errcode = '23514';
    end if;
  else
    raise exception 'comments are withdrawn, never deleted' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Author edit for the comment's current version. Membership, parent-Property archive state and
-- the current revision are rechecked from live state at commit, and a withdrawn comment stays
-- ineligible because its text now lives only in retained evidence.
create function private.edit_property_comment(p_comment_id uuid,p_body text,p_expected_revision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  text_body text := private.trim_unicode(p_body);
  comment public.property_comments;
  prop uuid;
  archived timestamptz;
  author text;
  next_revision uuid := gen_random_uuid();
  stamp timestamptz := clock_timestamp();
  updated public.property_comments;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  if p_comment_id is null then raise exception 'comment required' using errcode = '23514'; end if;
  if p_expected_revision is null then raise exception 'expected revision required' using errcode = '23514'; end if;
  if text_body is null or length(text_body) not between 1 and 2000 then
    raise exception 'comment text must be 1 to 2000 characters' using errcode = '23514';
  end if;
  -- Lock the parent Property first so a concurrent archive serializes here and is read under the
  -- lock, then lock the comment row before comparing the expected revision.
  select c.property_id into prop from public.property_comments c where c.id = p_comment_id;
  if prop is null then raise exception 'comment not found' using errcode = '23514'; end if;
  select p.archived_at into archived from public.properties p where p.id = prop for update;
  if not found then raise exception 'property not found' using errcode = '23514'; end if;
  if archived is not null then raise exception 'archived property blocks comment edits' using errcode = '42501'; end if;
  select * into comment from public.property_comments where id = p_comment_id for update;
  if not found then raise exception 'comment not found' using errcode = '23514'; end if;
  -- Property-edit authority is irrelevant here: only the comment's own author may rewrite it.
  if comment.author_id <> me then raise exception 'only the author may edit this comment' using errcode = '42501'; end if;
  if comment.removed_at is not null then raise exception 'removed comment; reload current state' using errcode = 'PT409'; end if;
  -- PT409 is a PostgREST custom status code, so a stale edit returns 409 immediately and is
  -- never retried as a serialization failure.
  if comment.revision <> p_expected_revision then raise exception 'stale comment edit; reload current text' using errcode = 'PT409'; end if;
  select e.display_name into author from public.employees e where e.id = me;
  -- An unchanged body violates the retained-revision check below, so it is rejected rather than
  -- reported as an edit that wrote no evidence.
  insert into public.property_comment_revisions(comment_id,property_id,actor_id,actor_name,edited_at,before_revision,after_revision,before_body,after_body)
    values(p_comment_id,prop,me,author,stamp,comment.revision,next_revision,comment.body,text_body);
  update public.property_comments set body = text_body, revision = next_revision, edited_at = stamp
    where id = p_comment_id returning * into updated;
  return jsonb_build_object(
    'id',updated.id,'property_id',updated.property_id,'author_id',updated.author_id,
    'author_name',updated.author_name,'body',updated.body,'created_at',updated.created_at,
    'revision',updated.revision,'removed_at',updated.removed_at,'edited_at',updated.edited_at);
end;
$$;
revoke all on function private.edit_property_comment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.edit_property_comment(uuid,text,uuid) to authenticated;

create function public.edit_property_comment(p_comment_id uuid,p_body text,p_expected_revision uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.edit_property_comment(p_comment_id,p_body,p_expected_revision);
$$;
revoke all on function public.edit_property_comment(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.edit_property_comment(uuid,text,uuid) to authenticated;

-- Posting key replay compares against the original validated submission rather than the latest
-- edited text: the earliest retained before-text, the surviving current text, or the text the
-- removal slice retained once the current text was withdrawn.
create or replace function private.post_property_comment(p_property_id uuid,p_body text,p_key uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  text_body text := private.trim_unicode(p_body);
  archived timestamptz;
  author text;
  original_body text;
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
    select coalesce(
      (select r.before_body from public.property_comment_revisions r where r.comment_id = existing.id order by r.sequence limit 1),
      existing.body,
      (select r.body from public.property_comment_removals r where r.comment_id = existing.id)) into original_body;
    if original_body is distinct from text_body then
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

-- The read page states the current edit and removal markers only; preceding versions never
-- appear in a reader's row. The return type changes, so the existing function must be dropped
-- and recreated.
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
commit;
