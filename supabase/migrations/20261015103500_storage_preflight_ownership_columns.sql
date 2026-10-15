-- Issue #67 follow-up: the Storage ownership preflight and the reassignment must agree on what
-- the deleted identity owns. 20261015090137 left the preflight counting only `owner_id`, while
-- the reassignment treats an object as the target's when either `owner_id` or the deprecated
-- `owner` matches, so an object owned only through the legacy column was counted as zero and
-- its reassignment was skipped before the provider call.
--
-- This is a forward fix only: 20261015090137 is applied on the development project and is never
-- rewritten. Only the preflight is replaced; it counts through every ownership column the
-- reassignment already handles, with the same type whitelist and the same fail-closed answer
-- when no supported ownership column exists. The reassignment still updates both columns and
-- every other deletion rule is unchanged.
begin;

create or replace function private.employee_storage_preflight(p_auth_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  owned integer := 0;
  ownership_column record;
  predicate text;
  column_type text;
begin
  if p_auth_user_id is null then
    raise exception 'sign-in identity required' using errcode = '23514';
  end if;
  for ownership_column in
    select column_name, data_type from information_schema.columns
      where table_schema = 'storage' and table_name = 'objects'
        and column_name in ('owner','owner_id')
      order by column_name
  loop
    column_type := case ownership_column.data_type
      when 'uuid' then 'uuid'
      when 'text' then 'text'
      when 'character varying' then 'text'
      else null end;
    if column_type is null then
      -- An unrecognised ownership column type is not something to guess about; the
      -- reassignment refuses the same shape.
      return jsonb_build_object('supported',false,'ownedCount',0);
    end if;
    predicate := concat_ws(' or ', predicate,
      format('%I::text = $1::text', ownership_column.column_name));
  end loop;
  if predicate is null then
    -- Neither ownership column exists: not the Storage shape this adapter was verified against.
    return jsonb_build_object('supported',false,'ownedCount',0);
  end if;
  execute format('select count(*) from storage.objects where %s', predicate)
    into owned using p_auth_user_id;
  return jsonb_build_object('supported',true,'ownedCount',owned);
end;
$$;
commit;
