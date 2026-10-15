-- Issue #67 follow-up: the Storage ownership adapter assumed both ownership columns were text.
-- The authorized hosted acceptance proved otherwise on the development project: its Storage
-- schema has `storage.objects.owner uuid` (the deprecated column) and `owner_id text`, so the
-- reassignment's `owner = $1::text` comparison raised 42883 (uuid = text) and the mechanism
-- could not move ownership at all.
--
-- This is a forward fix only: 20261015070349 is applied on the development project and is never
-- rewritten. Both ownership functions are replaced so each column is read and written with its
-- own actual type, discovered from the catalog and restricted to a known whitelist, and an
-- unexpected type fails closed as an unsupported step instead of guessing. Nothing else about
-- the deletion contract changes: only the two ownership columns ever move, so object id,
-- bucket, path, metadata, bytes and uploader attribution stay untouched.
begin;

-- 1. Preflight: compare through the column's text representation so a uuid or text `owner_id`
--    both work. The count and the read-only guarantee are unchanged.
create or replace function private.employee_storage_preflight(p_auth_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owned integer := 0;
  owner_column text;
begin
  if p_auth_user_id is null then
    raise exception 'sign-in identity required' using errcode = '23514';
  end if;
  select column_name into owner_column
    from information_schema.columns
    where table_schema = 'storage' and table_name = 'objects' and column_name = 'owner_id';
  if owner_column is null then
    -- The Storage schema is not in the shape this adapter was verified against. Report it
    -- instead of guessing, so the caller records a truthful partial state.
    return jsonb_build_object('supported',false,'ownedCount',0);
  end if;
  execute format('select count(*) from storage.objects where %I::text = $1::text', owner_column)
    into owned using p_auth_user_id;
  return jsonb_build_object('supported',true,'ownedCount',owned);
end;
$$;
comment on function private.employee_storage_preflight(uuid) is 'Read-only Storage ownership preflight for one Auth identity. Never deletes, retargets or rewrites an object.';

-- 2. Reassignment: build the SET and WHERE from the real column types, so a legacy uuid
--    `owner` and a text `owner_id` are both handled. Only whitelisted types are accepted.
create or replace function private.reassign_employee_storage_ownership(p_from_auth_user_id uuid,p_to_auth_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_column record;
  assignments text;
  predicate text;
  column_type text;
  reassigned integer := 0;
begin
  if p_from_auth_user_id is null or p_to_auth_user_id is null then
    raise exception 'both sign-in identities required' using errcode = '23514';
  end if;
  if p_from_auth_user_id = p_to_auth_user_id then
    raise exception 'the custodian must differ from the deleted sign-in identity' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.employees
    where auth_user_id = p_to_auth_user_id and is_active and role = 'admin'
      and account_deleted_at is null
  ) then
    raise exception 'storage ownership custodian must be a live active admin' using errcode = '42501';
  end if;
  for target_column in
    select column_name, data_type from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects'
        and column_name in ('owner','owner_id')
      order by column_name
  loop
    column_type := case target_column.data_type
      when 'uuid' then 'uuid'
      when 'text' then 'text'
      when 'character varying' then 'text'
      else null end;
    if column_type is null then
      -- An unrecognised ownership column type is not something to guess about.
      return jsonb_build_object('supported',false,'reassignedCount',0);
    end if;
    assignments := concat_ws(', ', assignments,
      format('%I = $2::%s', target_column.column_name, column_type));
    predicate := concat_ws(' or ', predicate,
      format('%I::text = $1::text', target_column.column_name));
  end loop;
  if assignments is null then
    return jsonb_build_object('supported',false,'reassignedCount',0);
  end if;
  execute format('update storage.objects set %s where %s', assignments, predicate)
    using p_from_auth_user_id, p_to_auth_user_id;
  get diagnostics reassigned = row_count;
  return jsonb_build_object('supported',true,'reassignedCount',reassigned);
end;
$$;
comment on function private.reassign_employee_storage_ownership(uuid,uuid) is 'Reassigns only the Storage ownership columns of one Auth identity''s objects to a live active admin custodian, preserving object id, path, metadata and bytes; each ownership column is written with its own actual type.';

-- 3. Access is unchanged: the private definers and their public invoker wrappers stay
--    server-only, exactly as 20261015070349 granted them.
revoke all on function private.employee_storage_preflight(uuid),
  private.reassign_employee_storage_ownership(uuid,uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.employee_storage_preflight(uuid) to service_role;
grant execute on function private.reassign_employee_storage_ownership(uuid,uuid) to service_role;
commit;
