-- Original uploader or current editor; category correction never changes file identity.
begin;

create function private.set_file_category(p_property_id uuid,p_file_id uuid,p_category_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me uuid := private.employee_id();
  f public.property_files;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  perform 1 from public.properties where id=p_property_id and archived_at is null for update;
  if not found then raise exception 'unarchived property required' using errcode = '42501'; end if;
  select * into f from public.property_files where id=p_file_id and property_id=p_property_id for update;
  if not found then raise exception 'file not found' using errcode = '23514'; end if;
  if f.uploaded_by is distinct from me and not private.can_edit_property(p_property_id) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists(select 1 from public.document_categories where id=p_category_id) then
    raise exception 'invalid category' using errcode = '23514';
  end if;
  update public.property_files set category_id=p_category_id where id=p_file_id;
end;
$$;
revoke all on function private.set_file_category(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.set_file_category(uuid,uuid,uuid) to authenticated;

create function public.set_file_category(p_property_id uuid,p_file_id uuid,p_category_id uuid)
returns void language sql security invoker set search_path = '' as $$
  select private.set_file_category(p_property_id,p_file_id,p_category_id);
$$;
revoke all on function public.set_file_category(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_file_category(uuid,uuid,uuid) to authenticated;
commit;
