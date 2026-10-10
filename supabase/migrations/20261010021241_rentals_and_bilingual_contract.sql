begin;
alter table public.employees add column preferred_locale text not null default 'vi' check (preferred_locale in ('vi','en'));
alter table public.contacts drop constraint contacts_contact_type_check;
alter table public.contacts add constraint contacts_contact_type_check check (contact_type in ('owner','broker','representative','buyer','tenant','unknown'));
alter table public.property_contacts drop constraint property_contacts_relation_check;
alter table public.property_contacts add constraint property_contacts_relation_check check (relation in ('owner','broker','representative','tenant','unknown'));

create table public.rental_agreements (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  tenant_contact_id uuid not null references public.contacts(id),
  contract_code text not null unique check (length(btrim(contract_code)) between 1 and 80),
  contract_language text not null default 'vi' check (contract_language in ('vi','en')),
  status text not null default 'draft' check (status in ('draft','active','ended','canceled')),
  starts_on date not null,
  ends_on date not null,
  monthly_rent_vnd numeric(18,0) not null check (monthly_rent_vnd > 0),
  due_day smallint not null default 5 check (due_day between 1 and 28),
  proration_method text not null default 'calendar_days' check (proration_method in ('calendar_days','full_month')),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  approved_by uuid references public.employees(id),
  approved_at timestamptz,
  actual_ends_on date,
  closed_by uuid references public.employees(id),
  closed_at timestamptz,
  close_reason text,
  check (ends_on >= starts_on),
  check ((extract(year from ends_on)-extract(year from starts_on))*12 + extract(month from ends_on)-extract(month from starts_on) < 120),
  check (approved_by is null or approved_by <> created_by),
  check (status not in ('active','ended') or (approved_by is not null and approved_at is not null)),
  check (status not in ('ended','canceled') or (closed_by is not null and closed_at is not null and close_reason is not null)),
  check (status <> 'ended' or actual_ends_on is not null),
  check (actual_ends_on is null or actual_ends_on between starts_on and ends_on)
);
-- MVP rents the whole property, not independent rooms or concurrent tenants.
create unique index one_active_rental_per_property on public.rental_agreements(property_id) where status = 'active';
create index rental_agreements_property_idx on public.rental_agreements(property_id);
create index rental_agreements_tenant_idx on public.rental_agreements(tenant_contact_id);

create table public.rental_months (
  id uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.rental_agreements(id),
  month_start date not null check (extract(day from month_start) = 1),
  occupied_from date not null,
  occupied_to date not null,
  due_on date not null,
  amount_due_vnd numeric(18,0) not null check (amount_due_vnd >= 0),
  status text not null default 'open' check (status in ('open','voided')),
  unique (agreement_id,month_start),
  check (occupied_to >= occupied_from),
  check (occupied_from >= month_start and occupied_to < (month_start + interval '1 month')::date),
  check (status <> 'voided' or amount_due_vnd = 0)
);
create index rental_months_due_idx on public.rental_months(due_on) where status = 'open';

create table public.rental_payments (
  id uuid primary key default gen_random_uuid(),
  rental_month_id uuid not null references public.rental_months(id),
  kind text not null check (kind in ('receipt','refund')),
  amount_vnd numeric(18,0) not null check (amount_vnd > 0),
  paid_on date not null,
  method text not null check (method in ('bank_transfer','cash','other')),
  external_reference text,
  evidence_file_id uuid references public.property_files(id),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected','voided')),
  recorded_by uuid not null references public.employees(id),
  recorded_at timestamptz not null default now(),
  idempotency_key uuid not null,
  reviewed_by uuid references public.employees(id),
  reviewed_at timestamptz,
  decision_reason text,
  unique (recorded_by,idempotency_key),
  check (reviewed_by is null or reviewed_by <> recorded_by),
  check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null and decision_reason is not null))
);
create index rental_payments_month_idx on public.rental_payments(rental_month_id,status);
create index rental_payments_evidence_idx on public.rental_payments(evidence_file_id);

create function private.guard_property_rental() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists(select 1 from public.rental_agreements where property_id=new.id and status='active')
    and (new.listing_mode not in ('rent','both') or new.status<>'rented' or new.archived_at is not null) then
    raise exception 'close active rental before changing property availability' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger property_rental_guard before update on public.properties for each row execute function private.guard_property_rental();
revoke all on function private.guard_property_rental() from public,anon,authenticated;

create function private.set_locale(p_locale text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.employee_id() is null then raise exception 'active employee required' using errcode='42501'; end if;
  if p_locale is null or p_locale not in ('vi','en') then raise exception 'unsupported locale'; end if;
  update public.employees set preferred_locale=p_locale where id=private.employee_id();
end;
$$;
create function public.set_my_locale(p_locale text) returns void language sql security invoker set search_path = '' as $$ select private.set_locale(p_locale); $$;

create function private.create_rental(p_property_id uuid,p_tenant_id uuid,p_code text,p_start date,p_end date,p_rent numeric,p_due_day integer,p_proration text,p_language text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.employee_id(); result uuid;
begin
  if me is null or private.employee_role() not in ('staff','manager','admin') then raise exception 'rental administration role required' using errcode='42501'; end if;
  if p_rent is null or p_rent <> trunc(p_rent) then raise exception 'whole VND amount required'; end if;
  if not exists(select 1 from public.properties where id=p_property_id and listing_mode in ('rent','both') and archived_at is null and status not in ('sold','withdrawn')) then raise exception 'rent-enabled property required'; end if;
  insert into public.rental_agreements(property_id,tenant_contact_id,contract_code,starts_on,ends_on,monthly_rent_vnd,due_day,proration_method,contract_language,created_by)
    values(p_property_id,p_tenant_id,btrim(p_code),p_start,p_end,p_rent,p_due_day,p_proration,p_language,me) returning id into result;
  return result;
end;
$$;

create function private.activate_rental(p_agreement_id uuid) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.employee_id(); a public.rental_agreements; prop uuid; mode text; state text; m date; first_day date; last_day date; days_in_month integer; amount numeric;
begin
  if me is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode='42501'; end if;
  select property_id into prop from public.rental_agreements where id=p_agreement_id;
  if not found then raise exception 'agreement not found'; end if;
  select listing_mode,status into mode,state from public.properties where id=prop and archived_at is null for update;
  if not found or mode not in ('rent','both') or state not in ('available','negotiating','rented') then raise exception 'rent-enabled available property required'; end if;
  select * into a from public.rental_agreements where id=p_agreement_id for update;
  if a.status <> 'draft' then raise exception 'draft agreement required'; end if;
  if a.created_by=me then raise exception 'self activation forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.employees where id=a.created_by and is_active) then raise exception 'creator is inactive'; end if;
  if a.ends_on < (now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'agreement already expired'; end if;
  perform private.expire_property_locks(prop);
  if exists(select 1 from public.property_locks where property_id=prop and status='approved') then raise exception 'release approved reservation before rental activation' using errcode='23505'; end if;
  update public.rental_agreements set status='active',approved_by=me,approved_at=now() where id=a.id;
  for m in select generate_series(date_trunc('month',a.starts_on::timestamp),date_trunc('month',a.ends_on::timestamp),interval '1 month')::date loop
    first_day:=greatest(m,a.starts_on);last_day:=least((m+interval '1 month')::date-1,a.ends_on);
    days_in_month:=((m+interval '1 month')::date-m);
    amount:=case when a.proration_method='calendar_days' then round(a.monthly_rent_vnd*(last_day-first_day+1)/days_in_month) else a.monthly_rent_vnd end;
    insert into public.rental_months(agreement_id,month_start,occupied_from,occupied_to,due_on,amount_due_vnd)
      values(a.id,m,first_day,last_day,greatest(first_day,m+(a.due_day-1)),amount);
  end loop;
  update public.properties set status='rented' where id=prop;
end;
$$;

create function private.close_rental(p_agreement_id uuid,p_status text,p_end_on date,p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.employee_id(); a public.rental_agreements; prop uuid; m public.rental_months; today date:=(now() at time zone 'Asia/Ho_Chi_Minh')::date; amount numeric;
begin
  if me is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode='42501'; end if;
  if p_status is null or p_status not in ('ended','canceled') or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'valid close status and reason required'; end if;
  select property_id into prop from public.rental_agreements where id=p_agreement_id;
  if not found then raise exception 'agreement not found'; end if;
  perform 1 from public.properties where id=prop for update;
  select * into a from public.rental_agreements where id=p_agreement_id for update;
  if a.status not in ('draft','active') then raise exception 'agreement already closed'; end if;
  if p_status='ended' and (a.status<>'active' or p_end_on is null or p_end_on not between a.starts_on and a.ends_on or p_end_on>today) then raise exception 'valid actual end date required'; end if;
  if p_status='canceled' and a.status='active' and a.starts_on<=today then raise exception 'occupied rental must be ended rather than canceled'; end if;
  for m in select * from public.rental_months where agreement_id=a.id order by month_start for update loop
    if p_status='canceled' or m.occupied_from>p_end_on then
      update public.rental_months set status='voided',amount_due_vnd=0 where id=m.id;
    elsif m.occupied_to>p_end_on then
      amount:=case when a.proration_method='calendar_days' then round(a.monthly_rent_vnd*(p_end_on-m.occupied_from+1)/((m.month_start+interval '1 month')::date-m.month_start)) else a.monthly_rent_vnd end;
      update public.rental_months set occupied_to=p_end_on,amount_due_vnd=amount where id=m.id;
    end if;
  end loop;
  update public.rental_agreements set status=p_status,actual_ends_on=case when p_status='ended' then p_end_on end,
    closed_by=me,closed_at=now(),close_reason=p_reason where id=a.id;
  if a.status='active' then update public.properties set status='available' where id=prop and status='rented'; end if;
  -- Confirmed receipts remain evidence. Reduced dues produce refund_due, never automatic money movement.
end;
$$;

create function private.record_rental_payment(p_month_id uuid,p_kind text,p_amount numeric,p_paid_on date,p_method text,p_key uuid,p_reference text,p_evidence uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.employee_id(); prop uuid; result uuid; prior public.rental_payments;
begin
  if me is null or private.employee_role() not in ('staff','manager','admin') then raise exception 'rental administration role required' using errcode='42501'; end if;
  if p_amount is null or p_amount<=0 or p_amount<>trunc(p_amount) or p_key is null or p_paid_on is null or p_paid_on>(now() at time zone 'Asia/Ho_Chi_Minh')::date then raise exception 'positive whole VND, retry key and nonfuture paid date required'; end if;
  select a.property_id into prop from public.rental_months m join public.rental_agreements a on a.id=m.agreement_id where m.id=p_month_id;
  if not found then raise exception 'rental month not found'; end if;
  if p_evidence is not null and not exists(select 1 from public.property_files where id=p_evidence and property_id=prop and upload_status='ready') then raise exception 'ready evidence on rental property required'; end if;
  insert into public.rental_payments(rental_month_id,kind,amount_vnd,paid_on,method,idempotency_key,external_reference,evidence_file_id,recorded_by)
    values(p_month_id,p_kind,p_amount,p_paid_on,p_method,p_key,p_reference,p_evidence,me)
    on conflict(recorded_by,idempotency_key) do nothing returning id into result;
  if result is null then
    select * into prior from public.rental_payments where recorded_by=me and idempotency_key=p_key;
    if prior.rental_month_id is distinct from p_month_id or prior.kind is distinct from p_kind or prior.amount_vnd is distinct from p_amount
      or prior.paid_on is distinct from p_paid_on or prior.method is distinct from p_method or prior.external_reference is distinct from p_reference or prior.evidence_file_id is distinct from p_evidence then raise exception 'retry key reused with different payment'; end if;
    result:=prior.id;
  end if;
  return result;
end;
$$;

create function private.decide_rental_payment(p_payment_id uuid,p_action text,p_reason text) returns void language plpgsql security definer set search_path = '' as $$
declare me uuid:=private.employee_id(); pay public.rental_payments; m public.rental_months; prop uuid; agreement uuid; net_paid numeric; next_paid numeric;
begin
  if me is null or not private.is_reviewer() then raise exception 'reviewer required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('confirm','reject','void') or length(btrim(coalesce(p_reason,'')))<10 then raise exception 'valid action and reason required'; end if;
  select a.property_id,a.id into prop,agreement from public.rental_payments p join public.rental_months r on r.id=p.rental_month_id join public.rental_agreements a on a.id=r.agreement_id where p.id=p_payment_id;
  if not found then raise exception 'payment not found'; end if;
  perform 1 from public.properties where id=prop for update;
  perform 1 from public.rental_agreements where id=agreement for update;
  select r.* into m from public.rental_months r join public.rental_payments p on p.rental_month_id=r.id where p.id=p_payment_id for update of r;
  select * into pay from public.rental_payments where id=p_payment_id for update;
  if pay.recorded_by=me then raise exception 'self payment review forbidden' using errcode='42501'; end if;
  if (p_action in ('confirm','reject') and pay.status<>'pending') or (p_action='void' and pay.status<>'confirmed') then raise exception 'invalid payment transition'; end if;
  select coalesce(sum(case when kind='receipt' then amount_vnd else -amount_vnd end),0) into net_paid from public.rental_payments where rental_month_id=m.id and status='confirmed';
  if p_action='confirm' then
    next_paid:=net_paid+case when pay.kind='receipt' then pay.amount_vnd else -pay.amount_vnd end;
    if next_paid<0 or (pay.kind='receipt' and (m.status='voided' or next_paid>m.amount_due_vnd)) then raise exception 'receipt exceeds due or refund exceeds confirmed balance'; end if;
  elsif p_action='void' then
    next_paid:=net_paid-case when pay.kind='receipt' then pay.amount_vnd else -pay.amount_vnd end;
    if next_paid<0 then raise exception 'cannot void receipt already offset by refunds'; end if;
  end if;
  update public.rental_payments set status=case p_action when 'confirm' then 'confirmed' when 'reject' then 'rejected' else 'voided' end,
    reviewed_by=me,reviewed_at=now(),decision_reason=p_reason where id=pay.id;
end;
$$;

create function public.create_rental_agreement(p_property_id uuid,p_tenant_id uuid,p_code text,p_start date,p_end date,p_rent numeric,p_due_day integer default 5,p_proration text default 'calendar_days',p_language text default 'vi') returns uuid language sql security invoker set search_path = '' as $$ select private.create_rental(p_property_id,p_tenant_id,p_code,p_start,p_end,p_rent,p_due_day,p_proration,p_language); $$;
create function public.activate_rental_agreement(p_agreement_id uuid) returns void language sql security invoker set search_path = '' as $$ select private.activate_rental(p_agreement_id); $$;
create function public.close_rental_agreement(p_agreement_id uuid,p_status text,p_end_on date,p_reason text) returns void language sql security invoker set search_path = '' as $$ select private.close_rental(p_agreement_id,p_status,p_end_on,p_reason); $$;
create function public.record_rental_payment(p_month_id uuid,p_kind text,p_amount numeric,p_paid_on date,p_method text,p_key uuid,p_reference text default null,p_evidence uuid default null) returns uuid language sql security invoker set search_path = '' as $$ select private.record_rental_payment(p_month_id,p_kind,p_amount,p_paid_on,p_method,p_key,p_reference,p_evidence); $$;
create function public.decide_rental_payment(p_payment_id uuid,p_action text,p_reason text) returns void language sql security invoker set search_path = '' as $$ select private.decide_rental_payment(p_payment_id,p_action,p_reason); $$;

do $$ declare t text; begin
  foreach t in array array['rental_agreements','rental_months','rental_payments'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    execute format('create trigger audit_%I after insert or update or delete on public.%I for each row execute function private.audit_change()',t,t);
  end loop;
end $$;
create policy rental_agreements_read on public.rental_agreements for select to authenticated using(private.employee_id() is not null);
create policy rental_months_read on public.rental_months for select to authenticated using(private.employee_role() in ('staff','manager','admin'));
create policy rental_payments_read on public.rental_payments for select to authenticated using(private.employee_role() in ('staff','manager','admin'));

create view public.v_rental_month_status with(security_invoker=true) as
select m.*,a.property_id,a.tenant_contact_id,a.contract_code,
  case when m.status='voided' then 0 else m.occupied_to-m.occupied_from+1 end as occupied_days,
  (m.status='open' and a.status='active' and (now() at time zone 'Asia/Ho_Chi_Minh')::date between m.occupied_from and m.occupied_to) as is_active_month,
  case when m.status='voided' then 'voided' when a.status='ended' then 'completed' when (now() at time zone 'Asia/Ho_Chi_Minh')::date<m.occupied_from then 'scheduled'
    when (now() at time zone 'Asia/Ho_Chi_Minh')::date>m.occupied_to then 'completed' else 'active' end as month_phase,
  pay.net_paid_vnd,
  greatest(m.amount_due_vnd-pay.net_paid_vnd,0) as balance_due_vnd,
  greatest(pay.net_paid_vnd-m.amount_due_vnd,0) as refund_due_vnd,
  case when pay.net_paid_vnd>m.amount_due_vnd then 'refund_due' when m.status='voided' then 'voided'
    when pay.net_paid_vnd=m.amount_due_vnd then 'paid' when pay.net_paid_vnd>0 then 'partial' else 'unpaid' end as payment_status,
  (m.status='open' and m.due_on<(now() at time zone 'Asia/Ho_Chi_Minh')::date and pay.net_paid_vnd<m.amount_due_vnd) as is_overdue
from public.rental_months m join public.rental_agreements a on a.id=m.agreement_id
cross join lateral(select coalesce(sum(case when kind='receipt' then amount_vnd else -amount_vnd end),0) as net_paid_vnd from public.rental_payments p where p.rental_month_id=m.id and p.status='confirmed') pay;

create view public.v_rental_property_status with(security_invoker=true) as
select a.*,case when a.status<>'active' then a.status when (now() at time zone 'Asia/Ho_Chi_Minh')::date<a.starts_on then 'scheduled'
  when (now() at time zone 'Asia/Ho_Chi_Minh')::date>a.ends_on then 'expired' else 'occupied' end as occupancy_status
from public.rental_agreements a;

revoke all on function private.set_locale(text),private.create_rental(uuid,uuid,text,date,date,numeric,integer,text,text),private.activate_rental(uuid),private.close_rental(uuid,text,date,text),private.record_rental_payment(uuid,text,numeric,date,text,uuid,text,uuid),private.decide_rental_payment(uuid,text,text) from public,anon,authenticated;
revoke all on function public.set_my_locale(text),public.create_rental_agreement(uuid,uuid,text,date,date,numeric,integer,text,text),public.activate_rental_agreement(uuid),public.close_rental_agreement(uuid,text,date,text),public.record_rental_payment(uuid,text,numeric,date,text,uuid,text,uuid),public.decide_rental_payment(uuid,text,text) from public,anon,authenticated;
grant execute on function private.set_locale(text),private.create_rental(uuid,uuid,text,date,date,numeric,integer,text,text),private.activate_rental(uuid),private.close_rental(uuid,text,date,text),private.record_rental_payment(uuid,text,numeric,date,text,uuid,text,uuid),private.decide_rental_payment(uuid,text,text) to authenticated;
grant execute on function public.set_my_locale(text),public.create_rental_agreement(uuid,uuid,text,date,date,numeric,integer,text,text),public.activate_rental_agreement(uuid),public.close_rental_agreement(uuid,text,date,text),public.record_rental_payment(uuid,text,numeric,date,text,uuid,text,uuid),public.decide_rental_payment(uuid,text,text) to authenticated;
revoke all on public.v_rental_month_status,public.v_rental_property_status from public,anon;
grant select on public.v_rental_month_status,public.v_rental_property_status to authenticated,service_role;
commit;
