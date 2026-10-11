-- Issue #7: immediate maintenance with business history, not record approval.
begin;
alter table public.properties add column revision uuid not null default gen_random_uuid();
alter table public.property_addresses add column revision uuid not null default gen_random_uuid();
alter table public.property_addresses add column supersedes_address_id uuid references public.property_addresses(id);
alter table public.contacts add column revision uuid not null default gen_random_uuid();
alter table public.property_contacts add column revision uuid not null default gen_random_uuid();
create sequence private.property_code_sequence;

create table public.property_history (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  actor_id uuid not null references public.employees(id),
  actor_name text not null,
  occurred_at timestamptz not null default clock_timestamp(),
  target text not null check (target in ('property','address','contact','link')),
  target_id uuid not null,
  changed_fields text[] not null,
  before_values jsonb not null,
  after_values jsonb not null,
  explanation text
);
create index property_history_page_idx on public.property_history(property_id,occurred_at,id);
alter table public.property_history enable row level security;
revoke all on public.property_history from public,anon,authenticated,service_role;
grant select on public.property_history to authenticated;
create policy history_read on public.property_history for select to authenticated using (
  private.employee_id() is not null and exists (select 1 from public.properties p where p.id=property_id)
);

create function private.business_values(p_target text,p_row jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
  select coalesce(jsonb_object_agg(key,case when jsonb_typeof(value)='number' then to_jsonb(value #>> '{}') else value end),'{}'::jsonb)
  from jsonb_each(coalesce(p_row,'{}')) where key=any(case p_target
    when 'property' then array['property_code','listing_mode','property_type','access_type','status','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes']
    when 'address' then array['mapping_evidence','format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','mapping_status','verification_method','verified_by','verified_at','source_url','effective_on','is_primary','supersedes_address_id']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary'] else '{}'::text[] end);
$$;
create function private.record_business_change() returns trigger
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); target text; before_v jsonb; after_v jsonb; fields text[]; props uuid[]; prop uuid; row_v jsonb;
begin
  if me is null then return coalesce(new,old); end if;
  target:=case tg_table_name when 'properties' then 'property' when 'property_addresses' then 'address' when 'contacts' then 'contact' else 'link' end;
  before_v:=private.business_values(target,case when tg_op<>'INSERT' then to_jsonb(old) end);
  after_v:=private.business_values(target,case when tg_op<>'DELETE' then to_jsonb(new) end);
  select array_agg(key order by key) into fields from (select jsonb_object_keys(before_v||after_v) as key) k
    where before_v->key is distinct from after_v->key;
  if fields is null then return coalesce(new,old); end if;
  row_v:=coalesce(to_jsonb(new),to_jsonb(old));
  if target='contact' then select array_agg(property_id order by property_id) into props from public.property_contacts where contact_id=(row_v->>'id')::uuid;
  else props:=array[case when target='property' then (row_v->>'id')::uuid else (row_v->>'property_id')::uuid end]; end if;
  foreach prop in array coalesce(props,'{}'::uuid[]) loop
    insert into public.property_history(property_id,actor_id,actor_name,target,target_id,changed_fields,before_values,after_values)
    select prop,me,e.display_name,target,coalesce((row_v->>'id')::uuid,(row_v->>'contact_id')::uuid),fields,
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(before_v) where key=any(fields)),
      (select coalesce(jsonb_object_agg(key,value),'{}') from jsonb_each(after_v) where key=any(fields))
    from public.employees e where e.id=me;
    if target<>'property' then update public.properties set record_review_status='pending' where id=prop; end if;
  end loop;
  return coalesce(new,old);
end;
$$;
do $$ declare t text; begin
  foreach t in array array['properties','property_addresses','contacts','property_contacts'] loop
    execute format('create trigger business_history after insert or update or delete on public.%I for each row execute function private.record_business_change()',t);
  end loop;
end $$;

create function private.create_property(p_mode text,p_facts jsonb,p_address jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare me uuid:=private.employee_id(); prop uuid; code text; rev uuid;
begin
  if me is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_mode is null or p_mode not in ('sale','rent','both') then raise exception 'invalid creation' using errcode='23514'; end if;
  perform private.validate_maintenance('property',p_facts);
  perform private.validate_maintenance('address',p_address);
  if p_address->>'format' is null or p_address->>'format' not in ('legacy','current')
    or length(btrim(coalesce(p_address->>'address_text',''))) not between 1 and 2000
    or p_facts ?| array['legal_status','archived_at','record_review_status','status'] then
    raise exception 'invalid creation' using errcode='23514'; end if;
  loop
    code:='SGN-'||lpad(nextval('private.property_code_sequence')::text,8,'0');
    exit when not exists(select 1 from public.properties where property_code=code);
  end loop;
  insert into public.properties(property_code,listing_mode,status,created_by) values(code,p_mode,'available',me) returning id,revision into prop,rev;
  if p_facts<>'{}'::jsonb then perform private.maintain_property(prop,'property',prop,rev,p_facts,rev); end if;
  select revision into rev from public.properties where id=prop;
  perform private.maintain_property(prop,'address',null,rev,p_address,rev);
  return prop;
end;
$$;
create function public.create_property(p_mode text,p_facts jsonb,p_address jsonb) returns uuid
language sql security invoker set search_path='' as $$ select private.create_property(p_mode,p_facts,p_address); $$;
revoke all on function private.business_values(text,jsonb),private.record_business_change(),private.create_property(text,jsonb,jsonb),public.create_property(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.create_property(text,jsonb,jsonb),public.create_property(text,jsonb,jsonb) to authenticated;
alter table public.property_addresses add column mapping_evidence text;

-- Contact/link membership changes share this short transaction gate, before parent row locks.
-- It prevents a preview/fan-out race without taking contact rows before property rows.
create function private.maintenance_gate() returns void language sql security invoker set search_path='' as $$
  select pg_advisory_xact_lock(7317,7);
$$;
create function private.validate_maintenance(p_target text,p_changes jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare k text; v jsonb; allowed text[];
begin
  allowed:=case p_target
    when 'property' then array['listing_mode','property_type','access_type','status','land_area_m2','frontage_m','depth_m','floor_area_m2','floors','bedrooms','bathrooms','direction','sale_price_vnd','monthly_rent_vnd','ownership_type','parcel_number','map_sheet_number','construction_text','area_raw','notes','legal_status','record_review_status','archived_at']
    when 'address' then array['format','address_text','house_number','street','province_text','district_text','commune_text','province_unit_id','district_unit_id','commune_unit_id','is_primary']
    when 'mapping' then array['mapping_status','verification_method','source_url','effective_on','province_unit_id','commune_unit_id','mapping_evidence']
    when 'contact' then array['display_name','phones','raw_phone_text','contact_type','notes']
    when 'link' then array['contact_id','relation','is_primary','remove'] else null end;
  if allowed is null or jsonb_typeof(p_changes) is distinct from 'object' or octet_length(p_changes::text)>8192 then raise exception 'invalid changes' using errcode='23514'; end if;
  for k,v in select key,value from jsonb_each(p_changes) loop
    if not k=any(allowed) then raise exception 'invalid field' using errcode='23514'; end if;
    if v='null'::jsonb then continue; end if;
    if k in ('sale_price_vnd','monthly_rent_vnd') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'whole VND string required' using errcode='23514'; end if;
    elsif k in ('land_area_m2','floor_area_m2','frontage_m','depth_m') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$'
        or (k in ('frontage_m','depth_m') and (v#>>'{}')::numeric>=1000000) then raise exception 'exact decimal string required' using errcode='23514'; end if;
    elsif k in ('floors','bedrooms','bathrooms') then
      if jsonb_typeof(v)<>'string' or v#>>'{}' !~ '^(0|[1-9][0-9]{0,4})$' then raise exception 'integer string required' using errcode='23514'; end if;
    elsif k in ('is_primary','remove') then
      if jsonb_typeof(v)<>'boolean' then raise exception 'boolean required' using errcode='23514'; end if;
    elsif k='phones' then
      if jsonb_typeof(v)<>'array' or jsonb_array_length(v)>20 then raise exception 'phone strings required' using errcode='23514'; end if;
      if exists(select 1 from jsonb_array_elements(v) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100) then raise exception 'phone strings required' using errcode='23514'; end if;
    elsif jsonb_typeof(v)<>'string' or length(v#>>'{}')>2000 then raise exception 'bounded text required' using errcode='23514'; end if;
  end loop;
end;
$$;
create function private.maintenance_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if current_user in ('anon','authenticated','service_role') then raise exception 'use revision-checked maintenance RPC' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    if tg_table_name='properties' then
      if new.property_code is distinct from old.property_code then raise exception 'property code is immutable' using errcode='23514'; end if;
      if private.business_values('property',to_jsonb(new)) is distinct from private.business_values('property',to_jsonb(old)) then new.record_review_status:='pending'; end if;
    elsif tg_table_name='property_addresses' then
      if old.format='legacy' and (private.business_values('address',to_jsonb(new))-array['is_primary']) is distinct from (private.business_values('address',to_jsonb(old))-array['is_primary']) then
        raise exception 'original legacy source is immutable' using errcode='23514'; end if;
    end if;
    new.revision:=gen_random_uuid();
  end if;
  return coalesce(new,old);
end;
$$;
do $$ declare t text; begin
  foreach t in array array['properties','property_addresses','contacts','property_contacts'] loop
    execute format('create trigger maintenance_revision before insert or update or delete on public.%I for each row execute function private.maintenance_revision()',t);
    execute format('revoke insert,update,delete on public.%I from authenticated,anon,service_role',t);
  end loop;
end $$;

-- Existing guard remains responsible for legal/final-state and active rental authority.
create or replace function private.guard_property() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if auth.uid() is not null then
    if private.employee_id() is null then raise exception 'inactive employee' using errcode='42501'; end if;
    if tg_op='UPDATE' and new.created_by is distinct from old.created_by then raise exception 'creator is immutable' using errcode='42501'; end if;
    if not private.is_reviewer() and (
      (tg_op='INSERT' and (new.record_review_status<>'pending' or new.legal_status<>'unknown' or new.status in ('sold','rented') or new.archived_at is not null))
      or (tg_op='UPDATE' and ((new.record_review_status is distinct from old.record_review_status and new.record_review_status<>'pending')
        or new.legal_status is distinct from old.legal_status or new.archived_at is distinct from old.archived_at
        or (new.status is distinct from old.status and new.status in ('sold','rented'))))
    ) then raise exception 'reviewer required for review or final status' using errcode='42501'; end if;
    new.updated_by:=private.employee_id();
    if tg_op='INSERT' then new.created_by:=private.employee_id(); new.created_at:=now(); end if;
  end if;
  new.updated_at:=now(); return new;
end;
$$;

create or replace function private.guard_address() returns trigger language plpgsql security definer set search_path='' as $$
declare p public.admin_unit_versions; d public.admin_unit_versions; c public.admin_unit_versions;
begin
  if length(btrim(new.address_text)) not between 1 and 2000 then raise exception 'known address required' using errcode='23514'; end if;
  if new.province_unit_id is not null then
    select * into p from public.admin_unit_versions where id=new.province_unit_id;
    if not found or p.unit_level<>'province' then raise exception 'province mismatch' using errcode='23514'; end if;
  end if;
  if new.district_unit_id is not null then
    select * into d from public.admin_unit_versions where id=new.district_unit_id;
    if not found or d.unit_level<>'district' or d.parent_id is distinct from new.province_unit_id then raise exception 'district mismatch' using errcode='23514'; end if;
  end if;
  if new.commune_unit_id is not null then
    select * into c from public.admin_unit_versions where id=new.commune_unit_id;
    if not found or c.unit_level<>'commune' or c.parent_id is distinct from coalesce(new.district_unit_id,new.province_unit_id) then raise exception 'commune mismatch' using errcode='23514'; end if;
  end if;
  if new.mapping_status='verified' and (tg_op='INSERT' or
    (to_jsonb(new)-array['revision','is_primary']) is distinct from (to_jsonb(old)-array['revision','is_primary'])) then
    if not private.is_reviewer() then raise exception 'reviewer required for mapping' using errcode='42501'; end if;
    if new.format<>'current' or new.province_unit_id is null or new.commune_unit_id is null or new.effective_on is null
      or length(btrim(coalesce(new.mapping_evidence,''))) not between 10 and 2000
      or coalesce(new.source_url,'') !~ '^https?://[^[:space:]]+$' or new.verification_method is null
      or new.effective_on<p.valid_from or (p.valid_to is not null and new.effective_on>=p.valid_to)
      or new.effective_on<c.valid_from or (c.valid_to is not null and new.effective_on>=c.valid_to) then
      raise exception 'valid hierarchy date provenance and property evidence required' using errcode='23514'; end if;
    if new.verification_method='official_whole_mapping' and not exists(
      select 1 from public.admin_unit_crosswalks x join public.property_addresses a on a.commune_unit_id=x.from_unit_id
      where a.property_id=new.property_id and a.format='legacy' and x.to_unit_id=new.commune_unit_id
        and x.relation in ('whole','rename') and x.effective_on<=new.effective_on and x.verified_by is not null
    ) then raise exception 'whole mapping evidence required; partial transitions unresolved' using errcode='23514'; end if;
    new.verified_by:=private.employee_id(); new.verified_at:=clock_timestamp();
  end if;
  return new;
end;
$$;

create function private.maintain_property(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare prop public.properties; addr public.property_addresses; person public.contacts; link public.property_contacts; cols text; result uuid; next_contact uuid;
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  perform private.validate_maintenance(p_target,p_changes);
  perform private.maintenance_gate();
  select * into prop from public.properties where id=p_property_id for update;
  if not found or not private.can_edit_property(p_property_id) then raise exception 'property edit denied' using errcode='42501'; end if;
  if p_expected_revision is null or p_property_revision is null then raise exception 'entity and property revisions required' using errcode='23514'; end if;
  if prop.revision<>p_property_revision then raise exception 'stale property context; reload current state' using errcode='40001'; end if;
  if p_target='property' then
    if p_target_id is distinct from p_property_id then raise exception 'target mismatch' using errcode='23514'; end if;
    if prop.revision<>p_expected_revision then raise exception 'stale edit; reload current state' using errcode='40001'; end if;
    if p_changes ? 'status' and prop.status is distinct from p_changes->>'status' and (prop.status='sold' or p_changes->>'status'='sold') then
      if not private.is_reviewer() then raise exception 'reviewer required for final status' using errcode='42501'; end if;
      raise exception 'use independent sale transition; ordinary maintenance does not confirm or reverse sales' using errcode='23514';
    end if;
    select string_agg(format('%I',key),',') into cols from jsonb_object_keys(p_changes) key;
    if cols is not null then
      execute format('update public.properties set (%s)=(select %s from jsonb_populate_record(null::public.properties,$1)) where id=$2',cols,cols) using to_jsonb(prop)||p_changes,p_property_id;
    end if;
    return p_property_id;
  elsif p_target in ('address','mapping') then
    if p_target_id is null then
      if p_target<>'address' or prop.revision<>p_expected_revision then raise exception 'stale edit; reload current state' using errcode='40001'; end if;
      addr.property_id:=p_property_id; addr.is_primary:=true; addr.mapping_status:='unresolved'; addr.created_at:=now();
    else
      select * into addr from public.property_addresses where id=p_target_id and property_id=p_property_id for update;
      if not found then raise exception 'address mismatch' using errcode='23514'; end if;
      if addr.revision<>p_expected_revision then raise exception 'stale address; reload current state' using errcode='40001'; end if;
    end if;
    if p_target='mapping' then
      if not private.is_reviewer() then raise exception 'reviewer required' using errcode='42501'; end if;
      if addr.format<>'current' then raise exception 'current mapping required' using errcode='23514'; end if;
      addr:=jsonb_populate_record(addr,p_changes);
      if addr.mapping_status not in ('verified','candidate','unresolved') or addr.mapping_status is null then raise exception 'invalid mapping' using errcode='23514'; end if;
      if addr.mapping_status<>'verified' then addr.verified_by:=null; addr.verified_at:=null; addr.verification_method:=null; addr.source_url:=null; addr.effective_on:=null; addr.mapping_evidence:=null; end if;
      update public.property_addresses set province_unit_id=addr.province_unit_id,commune_unit_id=addr.commune_unit_id,
        mapping_status=addr.mapping_status,verification_method=addr.verification_method,source_url=addr.source_url,
        effective_on=addr.effective_on,mapping_evidence=addr.mapping_evidence,verified_by=addr.verified_by,verified_at=addr.verified_at where id=p_target_id;
      return p_target_id;
    end if;
    addr:=jsonb_populate_record(addr,p_changes);
    if addr.format is null or addr.format not in ('legacy','current') or addr.address_text is null then raise exception 'known address required' using errcode='23514'; end if;
    if p_target_id is not null and addr.format<>(select format from public.property_addresses where id=p_target_id) then raise exception 'address format immutable' using errcode='23514'; end if;
    if p_target_id is not null and p_changes-array['is_primary']='{}'::jsonb then
      if addr.is_primary then update public.property_addresses set is_primary=false where property_id=p_property_id and format=addr.format and is_primary and id<>p_target_id; end if;
      update public.property_addresses set is_primary=addr.is_primary where id=p_target_id and is_primary is distinct from addr.is_primary;
      return p_target_id;
    end if;
    if p_target_id is not null and addr.format='current' then
      update public.property_addresses set mapping_status='unresolved',verified_by=null,verified_at=null,verification_method=null,source_url=null,effective_on=null,mapping_evidence=null where id=p_target_id;
    end if;
    if addr.is_primary then update public.property_addresses set is_primary=false where property_id=p_property_id and format=addr.format and is_primary; end if;
    addr.id:=gen_random_uuid(); addr.supersedes_address_id:=p_target_id; addr.revision:=gen_random_uuid(); addr.created_at:=now();
    addr.mapping_status:='unresolved'; addr.verification_method:=null; addr.verified_by:=null; addr.verified_at:=null; addr.source_url:=null; addr.effective_on:=null; addr.mapping_evidence:=null;
    insert into public.property_addresses select (addr).*;
    return addr.id;
  elsif p_target='contact' then
    if private.employee_role() not in ('staff','manager','admin') then raise exception 'contact staff required' using errcode='42501'; end if;
    perform private.contact_impact(p_target_id);
    perform 1 from public.properties where id in (select property_id from public.property_contacts where contact_id=p_target_id) order by id for update;
    select * into person from public.contacts where id=p_target_id for update;
    if not found then raise exception 'contact not found' using errcode='23514'; end if;
    if person.revision<>p_expected_revision then raise exception 'stale contact or affected set; reload current state' using errcode='40001'; end if;
    person:=jsonb_populate_record(person,p_changes);
    if length(btrim(coalesce(person.display_name,''))) not between 1 and 200 then raise exception 'contact name required' using errcode='23514'; end if;
    update public.contacts set display_name=person.display_name,phones=person.phones,raw_phone_text=person.raw_phone_text,contact_type=person.contact_type,notes=person.notes where id=p_target_id;
    return p_target_id;
  elsif p_target='link' then
    if private.employee_role() not in ('staff','manager','admin') then raise exception 'contact staff required' using errcode='42501'; end if;
    if p_target_id is null then
      if prop.revision<>p_expected_revision then raise exception 'stale property; reload current state' using errcode='40001'; end if;
      link.property_id:=p_property_id; link.relation:='unknown'; link.is_primary:=false;
    else
      select * into link from public.property_contacts where property_id=p_property_id and contact_id=p_target_id for update;
      if not found then raise exception 'link not found' using errcode='23514'; end if;
      if link.revision<>p_expected_revision then raise exception 'stale link; reload current state' using errcode='40001'; end if;
    end if;
    if p_changes->>'remove'='true' then
      if p_target_id is null or p_changes-'remove'<>'{}'::jsonb then raise exception 'unlink target required' using errcode='23514'; end if;
      perform 1 from public.contacts where id=p_target_id for update;
      delete from public.property_contacts where property_id=p_property_id and contact_id=p_target_id;
      return p_target_id;
    end if;
    if p_changes ? 'remove' then raise exception 'invalid link change' using errcode='23514'; end if;
    link:=jsonb_populate_record(link,p_changes); next_contact:=link.contact_id;
    perform 1 from public.contacts where id in (p_target_id,next_contact) order by id for update;
    if next_contact is null or not exists(select 1 from public.contacts where id=next_contact) then raise exception 'contact not found' using errcode='23514'; end if;
    if link.is_primary then update public.property_contacts set is_primary=false where property_id=p_property_id and is_primary; end if;
    if p_target_id is null then
      insert into public.property_contacts(property_id,contact_id,relation,is_primary) values(p_property_id,next_contact,link.relation,link.is_primary);
    else
      update public.property_contacts set contact_id=next_contact,relation=link.relation,is_primary=link.is_primary where property_id=p_property_id and contact_id=p_target_id;
    end if;
    return next_contact;
  else raise exception 'unsupported target' using errcode='23514'; end if;
end;
$$;
create function public.maintain_property(p_property_id uuid,p_target text,p_target_id uuid,p_expected_revision uuid,p_changes jsonb,p_property_revision uuid) returns uuid
language sql security invoker set search_path='' as $$ select private.maintain_property(p_property_id,p_target,p_target_id,p_expected_revision,p_changes,p_property_revision); $$;
revoke all on function private.maintenance_gate(),private.validate_maintenance(text,jsonb),private.maintenance_revision(),private.maintain_property(uuid,text,uuid,uuid,jsonb,uuid),public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid) from public,anon,authenticated;
grant execute on function private.maintain_property(uuid,text,uuid,uuid,jsonb,uuid),public.maintain_property(uuid,text,uuid,uuid,jsonb,uuid) to authenticated;
create function private.create_contact(p_changes jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare person public.contacts; result uuid;
begin
  if private.employee_id() is null or private.employee_role() not in ('staff','manager','admin') then raise exception 'contact staff required' using errcode='42501'; end if;
  perform private.validate_maintenance('contact',p_changes);
  person.display_name:=''; person.phones:='{}'; person.contact_type:='unknown'; person:=jsonb_populate_record(person,p_changes);
  if length(btrim(coalesce(person.display_name,''))) not between 1 and 200 then raise exception 'contact name required' using errcode='23514'; end if;
  insert into public.contacts(display_name,phones,raw_phone_text,contact_type,notes) values(person.display_name,person.phones,person.raw_phone_text,person.contact_type,person.notes) returning id into result;
  return result;
end;
$$;
create function private.contact_impact(p_contact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if private.employee_id() is null or private.employee_role() not in ('staff','manager','admin') then raise exception 'contact staff required' using errcode='42501'; end if;
  if exists(select 1 from public.property_contacts pc join public.properties p on p.id=pc.property_id where pc.contact_id=p_contact_id and p.archived_at is not null and not private.is_reviewer()) then raise exception 'affected property read denied' using errcode='42501'; end if;
  select jsonb_build_object('revision',c.revision,'properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'property_code',p.property_code) order by p.id) from public.property_contacts pc join public.properties p on p.id=pc.property_id where pc.contact_id=c.id),'[]')) into result from public.contacts c where c.id=p_contact_id;
  if result is null then raise exception 'contact not found' using errcode='23514'; end if;
  return result;
end;
$$;
create function private.link_membership_revision() returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- Membership/relationship/primary changes invalidate a previously shown contact impact.
  update public.contacts set revision=gen_random_uuid() where id in (case when tg_op<>'INSERT' then old.contact_id end,case when tg_op<>'DELETE' then new.contact_id end);
  return coalesce(new,old);
end;
$$;
create trigger link_membership_revision after insert or update or delete on public.property_contacts for each row execute function private.link_membership_revision();
create function public.create_contact(p_changes jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.create_contact(p_changes); $$;
create function public.contact_impact(p_contact_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.contact_impact(p_contact_id); $$;
revoke all on function private.create_contact(jsonb),private.contact_impact(uuid),private.link_membership_revision(),public.create_contact(jsonb),public.contact_impact(uuid) from public,anon,authenticated;
grant execute on function private.create_contact(jsonb),private.contact_impact(uuid),public.create_contact(jsonb),public.contact_impact(uuid) to authenticated;
-- Child reads now inherit the archived-property boundary rather than blanket membership.
drop policy member_read on public.property_addresses;
create policy addresses_read on public.property_addresses for select to authenticated using (private.employee_id() is not null and exists(select 1 from public.properties p where p.id=property_id));
drop policy member_read on public.property_contacts;
create policy links_read on public.property_contacts for select to authenticated using (private.employee_id() is not null and exists(select 1 from public.properties p where p.id=property_id));
commit;
