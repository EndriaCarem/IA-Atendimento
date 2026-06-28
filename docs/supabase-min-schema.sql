-- Minimal multi-tenant schema for IaClin WhatsApp Secretary
-- Adjust column types and constraints according to your ERP standard.

-- The 'clinics' table is owned by the main ERP (iaclin).
-- We only READ id and name from it. Never alter its schema.
-- create table if not exists clinics (
--   id uuid primary key,
--   name text,
--   created_at timestamptz default now()
-- );

-- AI Secretary config — owned by this module, independent of ERP tables.
create table if not exists ai_secretary_config (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null unique,
  custom_prompt text default '',
  enabled boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  instance_name text not null unique,
  qr_code_url text,
  created_at timestamptz default now()
);

alter table if exists whatsapp_instances
  add column if not exists qr_code_url text;

create table if not exists patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  name text,
  full_name text,
  phone text not null,
  created_at timestamptz default now()
);

create index if not exists idx_patients_clinic_phone on patients (clinic_id, phone);

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null,
  patient_id uuid not null references patients(id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null,
  notes text,
  source text default 'whatsapp_ai',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_appointments_clinic_patient on appointments (clinic_id, patient_id);
