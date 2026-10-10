-- SGN MVP: single company, inventory and commission attribution only.
begin;
create schema if not exists private;
revoke all on schema private from public, anon;

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete restrict,
  email text not null check (email = lower(btrim(email))),
  display_name text not null,
  phone text,
  role text not null default 'sales' check (role in ('sales','staff','manager','admin')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (email),
  check (not is_active or auth_user_id is not null)
);

create table public.admin_unit_versions (
  id uuid primary key default gen_random_uuid(),
  official_code text not null,
  name_vi text not null,
  unit_level text not null check (unit_level in ('province','district','commune')),
  parent_id uuid references public.admin_unit_versions(id),
  valid_from date not null,
  valid_to date,
  source_url text not null,
  unique (unit_level, official_code, valid_from),
  check (valid_to is null or valid_to > valid_from),
  check ((unit_level = 'province') = (parent_id is null))
);
create index admin_units_parent_idx on public.admin_unit_versions(parent_id);

create table public.admin_unit_crosswalks (
  id uuid primary key default gen_random_uuid(),
  from_unit_id uuid not null references public.admin_unit_versions(id),
  to_unit_id uuid not null references public.admin_unit_versions(id),
  relation text not null check (relation in ('whole','partial','rename')),
  effective_on date not null,
  source_url text not null,
  resolution_notes text,
  verified_by uuid references public.employees(id),
  unique (from_unit_id, to_unit_id, effective_on),
  check (from_unit_id <> to_unit_id)
);
create index crosswalk_to_idx on public.admin_unit_crosswalks(to_unit_id);

create table public.properties (
  id uuid primary key default gen_random_uuid(),
  property_code text not null unique,
  listing_mode text not null check (listing_mode in ('sale','rent','both')),
  property_type text not null default 'unclassified' check (property_type in
    ('house','land','apartment','villa','serviced_apartment','unclassified')),
  access_type text not null default 'unknown' check (access_type in
    ('street_front','car_alley','motorbike_alley','three_wheeler_alley','unknown')),
  status text not null default 'draft' check (status in ('draft','available','negotiating','sold','rented','withdrawn')),
  record_review_status text not null default 'pending' check (record_review_status in ('pending','approved','rejected')),
  land_area_m2 numeric(12,2) check (land_area_m2 > 0),
  frontage_m numeric(8,2) check (frontage_m > 0),
  depth_m numeric(8,2) check (depth_m > 0),
  floor_area_m2 numeric(12,2) check (floor_area_m2 > 0),
  floors smallint check (floors >= 0),
  bedrooms smallint check (bedrooms >= 0),
  bathrooms smallint check (bathrooms >= 0),
  direction text check (direction in ('N','NE','E','SE','S','SW','W','NW')),
  sale_price_vnd numeric(18,0) check (sale_price_vnd >= 0),
  monthly_rent_vnd numeric(18,0) check (monthly_rent_vnd >= 0),
  legal_status text not null default 'unknown' check (legal_status in
    ('unknown','owner_reported','documents_received','reviewed','issue_flagged')),
  ownership_type text check (ownership_type in ('individual','joint','organization','unknown')),
  parcel_number text,
  map_sheet_number text,
  construction_text text,
  area_raw text,
  notes text,
  latitude numeric(10,7) check (latitude between -90 and 90),
  longitude numeric(10,7) check (longitude between -180 and 180),
  created_by uuid references public.employees(id),
  updated_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  check ((latitude is null) = (longitude is null))
);
create index properties_filter_idx on public.properties(status, listing_mode, property_type, id) where archived_at is null;
create index properties_sale_price_idx on public.properties(sale_price_vnd, id) where archived_at is null;
create index properties_created_by_idx on public.properties(created_by);
create index properties_updated_by_idx on public.properties(updated_by);

create table public.property_addresses (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  format text not null check (format in ('legacy','current','alternate')),
  address_text text not null,
  house_number text,
  street text,
  province_text text,
  district_text text,
  commune_text text,
  province_unit_id uuid references public.admin_unit_versions(id),
  district_unit_id uuid references public.admin_unit_versions(id),
  commune_unit_id uuid references public.admin_unit_versions(id),
  mapping_status text not null default 'unresolved' check (mapping_status in ('unresolved','candidate','verified')),
  verification_method text check (verification_method in ('official_whole_mapping','boundary','document','manual')),
  verified_by uuid references public.employees(id),
  verified_at timestamptz,
  source_url text,
  effective_on date,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  check (format <> 'current' or (district_text is null and district_unit_id is null)),
  check (mapping_status <> 'verified' or (province_unit_id is not null and commune_unit_id is not null
    and verified_by is not null and verified_at is not null and verification_method is not null and source_url is not null))
);
create unique index addresses_primary_unique on public.property_addresses(property_id, format) where is_primary;
create index addresses_property_idx on public.property_addresses(property_id);
create index addresses_area_idx on public.property_addresses(province_unit_id, commune_unit_id, property_id);
create index addresses_district_idx on public.property_addresses(district_unit_id);

-- No global deduplication by name, masked PhoneID or partial phone number.
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  phones text[] not null default '{}',
  raw_phone_text text,
  contact_type text not null default 'unknown' check (contact_type in ('owner','broker','representative','buyer','unknown')),
  notes text,
  created_at timestamptz not null default now()
);
create table public.property_contacts (
  property_id uuid not null references public.properties(id),
  contact_id uuid not null references public.contacts(id),
  relation text not null default 'unknown' check (relation in ('owner','broker','representative','unknown')),
  is_primary boolean not null default false,
  primary key (property_id, contact_id)
);
create index property_contacts_contact_idx on public.property_contacts(contact_id);
create unique index property_primary_contact_unique on public.property_contacts(property_id) where is_primary;

create table public.property_files (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  document_type text not null check (document_type in ('photo','land_certificate','sale_contract','planning','construction_permit','other')),
  bucket_id text not null default 'property-files' check (bucket_id = 'property-files'),
  object_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint check (size_bytes > 0 and size_bytes <= 20971520),
  sha256 text,
  upload_status text not null default 'pending' check (upload_status in ('pending','ready','failed')),
  review_status text not null default 'unreviewed' check (review_status in ('unreviewed','accepted','issue_flagged')),
  uploaded_by uuid references public.employees(id),
  reviewed_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  check (object_path = property_id::text || '/' || id::text || '/' || original_filename),
  check (original_filename !~ '[/\\]' and original_filename not in ('.','..') and length(original_filename) > 0)
);
create index property_files_property_idx on public.property_files(property_id);

create table public.activity_events (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id),
  property_id uuid not null references public.properties(id),
  kind text not null check (kind in ('page_view','site_visit')),
  occurred_at timestamptz not null default now(),
  recorded_at timestamptz not null default now(),
  business_day date generated always as ((occurred_at at time zone 'Asia/Ho_Chi_Minh')::date) stored,
  source text not null default 'app' check (source in ('app','legacy_click')),
  idempotency_key uuid not null,
  visit_status text check (visit_status in ('pending','confirmed','rejected')),
  reviewed_by uuid references public.employees(id),
  reviewed_at timestamptz,
  notes text,
  unique (employee_id, idempotency_key),
  check ((kind = 'site_visit') = (visit_status is not null)),
  check (source <> 'legacy_click' or kind = 'page_view'),
  check (visit_status is null or visit_status = 'pending' or (reviewed_by is not null and reviewed_at is not null)),
  check (reviewed_by is null or reviewed_by <> employee_id)
);
create index activity_daily_idx on public.activity_events(employee_id, business_day, kind);
create index activity_property_idx on public.activity_events(property_id);

create table public.property_locks (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id),
  requested_by uuid not null references public.employees(id),
  reason text not null check (length(btrim(reason)) between 10 and 2000),
  evidence_file_id uuid references public.property_files(id),
  attribution_reference text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','released','expired')),
  requested_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '48 hours'),
  decided_by uuid references public.employees(id),
  decided_at timestamptz,
  decision_reason text,
  released_at timestamptz,
  check (expires_at > requested_at),
  check (decided_by is null or decided_by <> requested_by),
  check (status not in ('approved','rejected') or (decided_by is not null and decided_at is not null))
);
create unique index one_approved_lock on public.property_locks(property_id) where status = 'approved';
create unique index one_pending_request_per_employee on public.property_locks(property_id, requested_by) where status = 'pending';
create index locks_employee_idx on public.property_locks(requested_by, status);
create index locks_expiry_idx on public.property_locks(expires_at) where status in ('pending','approved');

create table public.lock_events (
  id bigint generated always as identity primary key,
  lock_id uuid not null references public.property_locks(id),
  actor_id uuid references public.employees(id),
  action text not null check (action in ('requested','approved','rejected','released','expired')),
  reason text,
  created_at timestamptz not null default now()
);
create index lock_events_lock_idx on public.lock_events(lock_id, created_at);

create table private.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  table_name text not null,
  record_key text not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create table private.import_batches (
  id uuid primary key default gen_random_uuid(),
  source_sha256 text not null unique,
  filename text not null,
  created_at timestamptz not null default now(),
  status text not null default 'staged' check (status in ('staged','reviewed','promoted','failed'))
);
create table private.staging_rows (
  batch_id uuid not null references private.import_batches(id),
  sheet text not null,
  source_row integer not null check (source_row >= 2),
  source_id text,
  payload jsonb not null,
  issues text[] not null default '{}',
  disposition text not null default 'pending' check (disposition in ('pending','promoted','quarantined','ignored')),
  primary key (batch_id, sheet, source_row)
);
create table private.property_source_map (
  source_system text not null,
  source_key text not null,
  property_id uuid not null references public.properties(id),
  evidence text not null,
  reviewed_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  primary key (source_system, source_key)
);
create index source_map_property_idx on private.property_source_map(property_id);
-- A repeated key cannot map to several properties: split invalid keys into reviewed row keys.
create table private.import_entity_map (
  batch_id uuid not null,
  sheet text not null,
  source_row integer not null,
  entity_table text not null,
  entity_id uuid not null,
  primary key (batch_id, sheet, source_row, entity_table),
  foreign key (batch_id, sheet, source_row) references private.staging_rows(batch_id, sheet, source_row)
);

commit;
