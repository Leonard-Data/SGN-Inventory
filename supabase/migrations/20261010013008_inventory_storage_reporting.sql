begin;
create schema if not exists extensions;
create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
alter table public.property_addresses add column search_text text not null default '';
create function private.normalize_search(value text) returns text language sql stable security invoker set search_path = '' as $$
  select lower(extensions.unaccent(coalesce(value,'')));
$$;
create function private.address_search_trigger() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.search_text := private.normalize_search(concat_ws(' ',new.address_text,new.house_number,new.street,new.province_text,new.district_text,new.commune_text));
  return new;
end;
$$;
create trigger address_search before insert or update on public.property_addresses for each row execute function private.address_search_trigger();
create index address_search_trgm_idx on public.property_addresses using gin(search_text extensions.gin_trgm_ops);

create function public.search_properties(p_query text default '',p_status text default null,p_mode text default null,
  p_type text default null,p_area_id uuid default null,p_after uuid default null,p_limit integer default 30)
returns setof public.properties language sql stable security invoker set search_path = '' as $$
  select p.* from public.properties p
  where p.archived_at is null and length(coalesce(p_query,'')) <= 120
    and (p_status is null or p.status = p_status)
    and (p_mode is null or p.listing_mode = p_mode or p.listing_mode = 'both')
    and (p_type is null or p.property_type = p_type)
    and (p_after is null or p.id > p_after)
    and (p_area_id is null or exists (select 1 from public.property_addresses a where a.property_id = p.id
      and p_area_id in (a.province_unit_id,a.district_unit_id,a.commune_unit_id)))
    and (coalesce(btrim(p_query),'') = '' or p.property_code ilike '%' || p_query || '%'
      or exists (select 1 from public.property_addresses a where a.property_id = p.id
        and a.search_text like '%' || private.normalize_search(p_query) || '%'))
  order by p.id limit greatest(1,least(coalesce(p_limit,30),50));
$$;
-- Search is invoker: both properties and address RLS apply; no owner phones in the result.

create view public.v_effective_property_locks with (security_invoker = true) as
select l.*, e.display_name as employee_name from public.property_locks l
join public.employees e on e.id = l.requested_by
where l.status = 'approved' and l.expires_at > now();

create view public.v_employee_daily_activity with (security_invoker = true) as
select employee_id,business_day,
  count(*) filter (where kind = 'page_view') as page_view_events,
  count(distinct property_id) filter (where kind = 'page_view') as distinct_properties_viewed,
  count(*) filter (where kind = 'site_visit' and visit_status = 'pending') as pending_visits,
  count(distinct property_id) filter (where kind = 'site_visit' and visit_status = 'confirmed') as confirmed_properties_visited
from public.activity_events group by employee_id,business_day;

create view public.v_admin_inventory_by_area with (security_invoker = true) as
select case when c.mapping_status = 'verified' then pu.name_vi else coalesce(o.province_text,'Chưa xác định') end as province_label,
  case when c.mapping_status = 'verified' then c.commune_unit_id end as current_commune_id,
  case when c.mapping_status = 'verified' then cu.name_vi else 'Chưa xác minh địa chỉ mới' end as current_commune_label,
  o.district_text as legacy_district_label,
  count(*) as inventory_count,
  count(*) filter (where p.status = 'available') as available_count,
  count(*) filter (where p.status = 'available' and l.id is null) as unlocked_available_count,
  count(*) filter (where l.id is not null) as reserved_count,
  count(*) filter (where p.status = 'sold') as sold_count
from public.properties p
left join public.property_addresses o on o.property_id = p.id and o.format = 'legacy' and o.is_primary
left join public.property_addresses c on c.property_id = p.id and c.format = 'current' and c.is_primary
left join public.admin_unit_versions pu on pu.id = c.province_unit_id
left join public.admin_unit_versions cu on cu.id = c.commune_unit_id
left join public.v_effective_property_locks l on l.property_id = p.id
where private.is_reviewer() and p.archived_at is null
group by 1,2,3,4;

create view public.v_admin_locks_by_employee with (security_invoker = true) as
select e.id as employee_id,e.display_name,count(l.id) as effective_lock_count
from public.employees e left join public.v_effective_property_locks l on l.requested_by = e.id
where private.is_reviewer() group by e.id,e.display_name;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('property-files','property-files',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
-- Immutable objects: metadata is registered before upload. No client UPDATE or DELETE policy.
create policy sgn_file_read on storage.objects for select to authenticated using (
  bucket_id = 'property-files' and private.employee_id() is not null and exists (
    select 1 from public.property_files f join public.properties p on p.id = f.property_id
    where f.object_path = name and f.upload_status = 'ready' and (p.archived_at is null or private.is_reviewer())
  )
);
create policy sgn_file_upload on storage.objects for insert to authenticated with check (
  bucket_id = 'property-files' and exists (select 1 from public.property_files f
    where f.object_path = name and f.upload_status = 'pending' and f.uploaded_by = private.employee_id()
      and private.can_edit_property(f.property_id))
);

revoke update on public.property_files from authenticated;
revoke update (upload_status) on public.property_files from authenticated;
create function private.complete_upload(p_file_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := private.employee_id(); f public.property_files;
begin
  if me is null then raise exception 'active employee required' using errcode = '42501'; end if;
  select * into f from public.property_files where id = p_file_id for update;
  if not found or (f.uploaded_by <> me and not private.is_reviewer()) then raise exception 'uploader or reviewer required' using errcode = '42501'; end if;
  if not exists (select 1 from storage.objects where bucket_id = f.bucket_id and name = f.object_path) then raise exception 'uploaded object not found'; end if;
  update public.property_files set upload_status = 'ready' where id = p_file_id;
end;
$$;
create function private.review_file(p_file_id uuid,p_status text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.employee_id() is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode = '42501'; end if;
  if p_status is null or p_status not in ('accepted','issue_flagged') then raise exception 'invalid document review'; end if;
  update public.property_files set review_status = p_status, reviewed_by = private.employee_id() where id = p_file_id and upload_status = 'ready';
  if not found then raise exception 'ready document required'; end if;
end;
$$;
create function public.complete_property_upload(p_file_id uuid) returns void language sql security invoker set search_path = '' as $$ select private.complete_upload(p_file_id); $$;
create function public.review_property_file(p_file_id uuid,p_status text) returns void language sql security invoker set search_path = '' as $$ select private.review_file(p_file_id,p_status); $$;
revoke all on function private.complete_upload(uuid),private.review_file(uuid,text),public.complete_property_upload(uuid),public.review_property_file(uuid,text) from public,anon,authenticated;
grant execute on function private.complete_upload(uuid),private.review_file(uuid,text),public.complete_property_upload(uuid),public.review_property_file(uuid,text) to authenticated;

grant usage on schema extensions to authenticated;
revoke all on function private.normalize_search(text),private.address_search_trigger() from public,anon,authenticated;
grant execute on function private.normalize_search(text) to authenticated;
revoke all on function public.search_properties(text,text,text,text,uuid,uuid,integer) from public,anon;
grant execute on function public.search_properties(text,text,text,text,uuid,uuid,integer) to authenticated;
grant select on public.v_effective_property_locks,public.v_employee_daily_activity,public.v_admin_inventory_by_area,public.v_admin_locks_by_employee to authenticated;
revoke all on public.v_effective_property_locks,public.v_employee_daily_activity,public.v_admin_inventory_by_area,public.v_admin_locks_by_employee from anon;
grant select on public.v_effective_property_locks,public.v_employee_daily_activity,public.v_admin_inventory_by_area,public.v_admin_locks_by_employee to service_role;
commit;
