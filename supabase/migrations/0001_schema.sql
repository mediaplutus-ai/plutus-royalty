-- =====================================================================
-- Plutus Media — Royalty Dashboard
-- Migration 0001: core schema (tables, enums, indexes)
-- Target: Supabase Postgres (15+)
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------
create type app_role as enum ('super_admin', 'label_admin', 'author_composer');

-- publisher  = Plutus collects the money, deducts commission, pays the rights holder
-- admin_only = society/DSP pays the rights holder directly; Plutus only tracks it (no commission)
create type royalty_type as enum ('publisher', 'admin_only');

create type creator_role as enum (
  'composer', 'author', 'composer_author', 'arranger',
  'original_publisher', 'sub_publisher', 'performer'
);

create type work_status        as enum ('draft', 'submitted', 'registered', 'disputed', 'inactive');
create type contract_type      as enum ('publishing', 'co_publishing', 'administration', 'sub_publishing', 'distribution');
create type contract_status    as enum ('draft', 'active', 'expired', 'terminated');
create type report_status      as enum ('uploaded', 'processing', 'processed', 'mismatch', 'failed');
create type royalty_status     as enum ('pending', 'approved', 'on_hold', 'disputed', 'paid', 'paid_directly');
create type match_status       as enum ('matched', 'unmatched', 'manual');
create type statement_period   as enum ('monthly', 'quarterly', 'annual', 'society');
create type statement_status   as enum ('draft', 'published');
create type payment_status     as enum ('draft', 'pending_approval', 'approved', 'paid', 'rejected', 'cancelled');
create type payment_mode       as enum ('neft', 'rtgs', 'imps', 'upi', 'cheque', 'wire', 'paypal', 'other');
create type notification_type  as enum ('report_uploaded', 'statement_available', 'payment_update', 'data_mismatch', 'system');

-- ---------------------------------------------------------------------
-- LABELS  (record labels / publishers that are Plutus clients)
-- ---------------------------------------------------------------------
create table labels (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  legal_name    text,
  gstin         text,
  pan           text,
  contact_email text,
  contact_phone text,
  address       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- PROFILES  (= "Users" table; 1:1 with Supabase auth.users)
-- ---------------------------------------------------------------------
create table profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  email             text not null,
  full_name         text,
  phone             text,
  role              app_role not null default 'author_composer',
  label_id          uuid references labels(id) on delete set null,
  is_active         boolean not null default true,
  require_2fa       boolean not null default false,
  allowed_ips       cidr[],                 -- null/empty = no IP restriction
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint label_admin_needs_label check (role <> 'label_admin' or label_id is not null)
);
create index on profiles (label_id);

-- ---------------------------------------------------------------------
-- ARTISTS  (rights holders: authors, composers, artists)
-- user_id links a rights holder to his/her login (optional)
-- ---------------------------------------------------------------------
create table artists (
  id                uuid primary key default gen_random_uuid(),
  label_id          uuid references labels(id) on delete set null,
  user_id           uuid references profiles(id) on delete set null,
  stage_name        text not null,
  legal_name        text,
  email             text,
  phone             text,
  ipi_number        text,             -- CAE/IPI number
  society           text,             -- IPRS / PRS / ASCAP / ...
  pan               text,
  gstin             text,
  -- payout account: only last 4 digits in clear; full number encrypted (see 0002)
  bank_name         text,
  bank_ifsc         text,
  bank_account_last4 text,
  bank_account_enc  bytea,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index on artists (label_id);
create index on artists (user_id);
create unique index artists_ipi_uq on artists (ipi_number) where ipi_number is not null;

-- ---------------------------------------------------------------------
-- WORKS  (catalog)
-- ---------------------------------------------------------------------
create table works (
  id            uuid primary key default gen_random_uuid(),
  label_id      uuid references labels(id) on delete set null,
  title         text not null,
  alt_titles    text[] not null default '{}',
  iswc          text,
  isrc          text[] not null default '{}',   -- a work can have many recordings
  language      text,
  genre         text,
  release_date  date,
  territories   text[] not null default '{WORLD}',  -- ISO codes or WORLD
  status        work_status not null default 'draft',
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint iswc_format check (iswc is null or iswc ~ '^T-?[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]$')
);
create index on works (label_id);
create unique index works_iswc_uq on works (iswc) where iswc is not null;
create index works_isrc_gin on works using gin (isrc);
create index works_title_idx on works (lower(title));

-- ---------------------------------------------------------------------
-- OWNERSHIP  (who owns what % of a work, in which territory)
-- ---------------------------------------------------------------------
create table ownership (
  id            uuid primary key default gen_random_uuid(),
  work_id       uuid not null references works(id) on delete cascade,
  artist_id     uuid not null references artists(id) on delete cascade,
  role          creator_role not null,
  share_pct     numeric(6,3) not null check (share_pct > 0 and share_pct <= 100),
  territory     text not null default 'WORLD',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (work_id, artist_id, role, territory)
);
create index on ownership (artist_id);

-- ---------------------------------------------------------------------
-- CONTRACTS  (commission terms; read-only for clients)
-- artist_id null = label-wide contract
-- ---------------------------------------------------------------------
create table contracts (
  id              uuid primary key default gen_random_uuid(),
  label_id        uuid references labels(id) on delete cascade,
  artist_id       uuid references artists(id) on delete cascade,
  contract_type   contract_type not null,
  commission_pct  numeric(5,2) not null check (commission_pct >= 0 and commission_pct <= 100),
  effective_date  date not null,
  end_date        date,
  territories     text[] not null default '{WORLD}',
  status          contract_status not null default 'active',
  document_path   text,               -- storage path of signed PDF
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint contract_party check (label_id is not null or artist_id is not null),
  constraint contract_dates check (end_date is null or end_date >= effective_date)
);
create index on contracts (label_id);
create index on contracts (artist_id);

-- ---------------------------------------------------------------------
-- ROYALTY REPORTS  (one row per uploaded statement file)
-- ---------------------------------------------------------------------
create table royalty_reports (
  id              uuid primary key default gen_random_uuid(),
  label_id        uuid references labels(id) on delete set null,
  source          text not null,          -- IPRS, PRS, MCPS, Spotify, YouTube ...
  royalty_type    royalty_type not null,
  period_start    date not null,
  period_end      date not null,
  currency        char(3) not null default 'INR',
  file_name       text,
  file_path       text,                   -- storage path
  file_sha256     text,                   -- duplicate-upload protection
  uploaded_by     uuid references profiles(id) on delete set null,
  row_count       integer not null default 0,
  unmatched_count integer not null default 0,
  total_gross     numeric(14,2) not null default 0,
  declared_total  numeric(14,2),          -- total printed on the society statement
  status          report_status not null default 'uploaded',
  notes           text,
  created_at      timestamptz not null default now(),
  processed_at    timestamptz,
  constraint report_period check (period_end >= period_start)
);
create unique index royalty_reports_sha_uq on royalty_reports (file_sha256) where file_sha256 is not null;

-- ---------------------------------------------------------------------
-- STATEMENTS  (periodic statement per rights holder)
-- ---------------------------------------------------------------------
create table statements (
  id                uuid primary key default gen_random_uuid(),
  artist_id         uuid not null references artists(id) on delete cascade,
  label_id          uuid references labels(id) on delete set null,
  period_type       statement_period not null,
  period_start      date not null,
  period_end        date not null,
  society           text,                 -- only for period_type = 'society'
  total_gross       numeric(14,2) not null default 0,
  total_commission  numeric(14,2) not null default 0,
  total_net         numeric(14,2) not null default 0,
  admin_only_total  numeric(14,2) not null default 0,  -- paid directly, shown for transparency
  pdf_path          text,
  xlsx_path         text,
  status            statement_status not null default 'draft',
  published_at      timestamptz,
  created_at        timestamptz not null default now()
);
create index on statements (artist_id);
create unique index statements_uq on statements (artist_id, period_type, period_start, period_end, coalesce(society, ''));

-- ---------------------------------------------------------------------
-- PAYMENTS  (= Payments & Invoices)
-- ---------------------------------------------------------------------
create table payments (
  id              uuid primary key default gen_random_uuid(),
  invoice_no      text not null unique,
  artist_id       uuid not null references artists(id) on delete restrict,
  label_id        uuid references labels(id) on delete set null,
  statement_id    uuid references statements(id) on delete set null,
  period_start    date not null,
  period_end      date not null,
  amount          numeric(14,2) not null check (amount >= 0),   -- net royalty being paid
  gst_pct         numeric(5,2) not null default 0,
  gst_amount      numeric(14,2) not null default 0,
  tds_pct         numeric(5,2) not null default 0,
  tds_amount      numeric(14,2) not null default 0,
  payable_amount  numeric(14,2) not null default 0,             -- amount + gst - tds
  currency        char(3) not null default 'INR',
  status          payment_status not null default 'draft',
  payment_mode    payment_mode,
  transaction_id  text,
  requested_by    uuid references profiles(id) on delete set null,
  approved_by     uuid references profiles(id) on delete set null,
  approved_at     timestamptz,
  paid_at         timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on payments (artist_id);
create index on payments (label_id);

-- ---------------------------------------------------------------------
-- ROYALTY LINES  (every earning line from every report)
-- ---------------------------------------------------------------------
create table royalty_lines (
  id                 uuid primary key default gen_random_uuid(),
  report_id          uuid not null references royalty_reports(id) on delete cascade,
  royalty_type       royalty_type not null,
  label_id           uuid references labels(id) on delete set null,
  artist_id          uuid references artists(id) on delete set null,
  work_id            uuid references works(id) on delete set null,
  source             text not null,
  territory          text not null default 'IN',
  period_start       date not null,
  period_end         date not null,
  usage_type         text,          -- performance / mechanical / streaming / sync ...
  units              bigint,
  gross_amount       numeric(14,4) not null default 0,
  commission_pct     numeric(5,2)  not null default 0,
  commission_amount  numeric(14,4) not null default 0,
  net_payable        numeric(14,4) not null default 0,
  currency           char(3) not null default 'INR',
  status             royalty_status not null default 'pending',
  match_status       match_status not null default 'unmatched',
  raw_title          text,          -- title as printed in the society file
  raw_iswc           text,
  raw_isrc           text,
  raw                jsonb,         -- full original row, kept for audits
  statement_id       uuid references statements(id) on delete set null,
  payment_id         uuid references payments(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on royalty_lines (report_id);
create index on royalty_lines (artist_id, period_start);
create index on royalty_lines (label_id, period_start);
create index on royalty_lines (work_id);
create index on royalty_lines (status);

-- ---------------------------------------------------------------------
-- NOTIFICATIONS
-- ---------------------------------------------------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  type        notification_type not null,
  title       text not null,
  body        text,
  link        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index on notifications (user_id, read_at);

-- ---------------------------------------------------------------------
-- AUDIT LOGS  (insert-only: uploads, edits, access, approvals)
-- ---------------------------------------------------------------------
create table audit_logs (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_email text,
  action      text not null,           -- INSERT / UPDATE / DELETE / LOGIN / DOWNLOAD / APPROVE ...
  table_name  text,
  record_id   text,
  old_data    jsonb,
  new_data    jsonb,
  ip          inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index on audit_logs (table_name, record_id);
create index on audit_logs (actor_id, created_at desc);
create index on audit_logs (created_at desc);
