-- WarrantyVault schema. Paste this whole file into Supabase -> SQL Editor -> Run.
-- Safe to re-run: it drops and recreates everything (all data is lost).

drop table if exists claim_events cascade;
drop table if exists claims cascade;
drop table if exists warranties cascade;
drop table if exists products cascade;
drop table if exists service_centers cascade;
drop table if exists customers cascade;

create table customers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text not null unique,
  phone       text,
  created_at  timestamptz not null default now()
);

create table products (
  id             uuid primary key default gen_random_uuid(),
  customer_id    uuid not null references customers(id) on delete cascade,
  name           text not null,
  brand          text not null,
  category       text not null default 'other',
  model          text,
  serial_number  text not null unique,           -- stored upper-case; one serial = one registered product
  purchase_date  date not null,
  purchase_price numeric(12,2),
  bill_url       text,                           -- Supabase Storage URL of the scanned bill
  bill_verified  boolean not null default false, -- OCR output matched what the customer registered
  created_at     timestamptz not null default now()
);
create index products_customer_idx on products(customer_id);

create table warranties (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid not null unique references products(id) on delete cascade,
  start_date       date not null,
  end_date         date not null,
  coverage_type    text not null default 'standard' check (coverage_type in ('standard','extended','comprehensive')),
  covered_services text[] not null,
  terms            text,
  created_at       timestamptz not null default now(),
  check (end_date > start_date)
);

create table service_centers (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  city               text not null,
  address            text,
  phone              text,
  supported_services text[] not null,
  technicians        int not null default 2 check (technicians > 0),  -- parallel jobs per hourly slot
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create table claims (
  id                     uuid primary key default gen_random_uuid(),
  claim_number           text not null unique,
  customer_id            uuid not null references customers(id) on delete cascade,
  product_id             uuid not null references products(id) on delete cascade,
  warranty_id            uuid references warranties(id) on delete set null,
  service_type           text not null,
  description            text not null,
  status                 text not null default 'submitted'
                         check (status in ('submitted','validated','approved','scheduled','in_repair','completed','rejected','cancelled')),
  eligibility            jsonb,
  fraud_score            int not null default 0,
  fraud_level            text,
  fraud_reasons          jsonb not null default '[]'::jsonb,
  requires_manual_review boolean not null default false,
  ai_triage              jsonb,
  ai_review              jsonb,
  evidence_url           text,
  service_center_id      uuid references service_centers(id) on delete set null,
  scheduled_at           timestamptz,
  technician             text,
  rejection_reason       text,
  resolution_notes       text,
  completed_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index claims_customer_idx on claims(customer_id);
create index claims_product_idx  on claims(product_id);
create index claims_status_idx   on claims(status);
create index claims_slot_idx     on claims(service_center_id, scheduled_at);

-- Duplicate guard enforced by the database itself (race-proof):
-- only one OPEN claim per product + issue type.
create unique index uniq_open_claim on claims(product_id, service_type)
  where status in ('submitted','validated','approved','scheduled','in_repair');

create table claim_events (
  id         uuid primary key default gen_random_uuid(),
  claim_id   uuid not null references claims(id) on delete cascade,
  status     text not null,
  title      text not null,
  note       text,
  actor      text not null default 'system',   -- customer | system | service_team
  created_at timestamptz not null default now()
);
create index claim_events_claim_idx on claim_events(claim_id, created_at);

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger claims_set_updated_at before update on claims
  for each row execute function set_updated_at();

-- Lock the tables down: the backend uses the service_role key (bypasses RLS);
-- the public anon key must not be able to read or write anything directly.
alter table customers       enable row level security;
alter table products        enable row level security;
alter table warranties      enable row level security;
alter table service_centers enable row level security;
alter table claims          enable row level security;
alter table claim_events    enable row level security;

-- Storage bucket for scanned bills (only runs on Supabase, where the storage schema exists).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public) values ('bills', 'bills', true)
    on conflict (id) do nothing;
  end if;
end $$;
