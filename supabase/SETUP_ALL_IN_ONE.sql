-- Paste this whole file into Supabase > SQL Editor > New query > Run (one time only).

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
-- =====================================================================
-- Plutus Media — Royalty Dashboard
-- Migration 0002: business logic (helpers, triggers, workflow functions)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so they can read profiles under RLS)
-- ---------------------------------------------------------------------
create or replace function public.my_role() returns app_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and is_active
$$;

create or replace function public.is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from profiles where id = auth.uid() and is_active), false)
$$;

create or replace function public.my_label_id() returns uuid
language sql stable security definer set search_path = public as $$
  select label_id from profiles where id = auth.uid() and is_active and role = 'label_admin'
$$;

create or replace function public.my_artist_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select a.id from artists a join profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and p.is_active
$$;

-- ---------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['labels','profiles','artists','works','ownership','contracts','payments','royalty_lines']
  loop
    execute format('create trigger trg_%1$s_touch before update on %1$s for each row execute function touch_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- New login -> profile row. Auto-links an existing artist with the same email.
-- Every new account starts as author_composer; only a Super Admin can promote.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;

  update artists set user_id = new.id
  where user_id is null and lower(email) = lower(new.email);

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-super-admins may edit only their own name/phone, never role/label/flags
create or replace function public.guard_profile_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if is_super_admin() or auth.uid() is null then   -- auth.uid() null = service role / SQL editor
    return new;
  end if;
  if new.id <> auth.uid() then
    raise exception 'You can only edit your own profile';
  end if;
  if new.role is distinct from old.role
     or new.label_id is distinct from old.label_id
     or new.is_active is distinct from old.is_active
     or new.allowed_ips is distinct from old.allowed_ips
     or new.email is distinct from old.email
     or (old.require_2fa and not new.require_2fa) then
    raise exception 'Only a Super Admin can change role, label, status, email or security settings';
  end if;
  return new;
end $$;

create trigger trg_profiles_guard before update on profiles
  for each row execute function guard_profile_update();

-- ---------------------------------------------------------------------
-- Ownership: total share of a work (per territory) cannot exceed 100%
-- ---------------------------------------------------------------------
create or replace function public.check_ownership_total() returns trigger
language plpgsql as $$
declare total numeric;
begin
  select coalesce(sum(share_pct), 0) into total
  from ownership
  where work_id = new.work_id and territory = new.territory;

  if total > 100 then
    raise exception 'Ownership shares for this work in territory % add up to % percent; the limit is 100 percent',
      new.territory, total;
  end if;
  return null;
end $$;

create constraint trigger trg_ownership_total
  after insert or update on ownership
  deferrable initially deferred
  for each row execute function check_ownership_total();

-- ---------------------------------------------------------------------
-- Commission lookup: artist contract first, then label-wide contract.
-- Contract must be active, cover the date and the territory.
-- ---------------------------------------------------------------------
create or replace function public.commission_for(
  p_artist uuid, p_label uuid, p_on date, p_territory text
) returns numeric
language sql stable security definer set search_path = public as $$
  select c.commission_pct
  from contracts c
  where c.status = 'active'
    and c.effective_date <= p_on
    and (c.end_date is null or c.end_date >= p_on)
    and ('WORLD' = any(c.territories) or upper(p_territory) = any(c.territories))
    and (c.artist_id = p_artist or (c.artist_id is null and c.label_id = p_label))
  order by (c.artist_id is not null) desc,   -- artist-specific wins
           c.effective_date desc
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Royalty line calculation
--   admin_only : no commission, net = gross, status = paid_directly
--   publisher  : commission from contract (unless given), net = gross - commission
-- Also: fills label from artist, auto-matches the work by ISWC -> ISRC -> title.
-- ---------------------------------------------------------------------
create or replace function public.calc_royalty_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pct numeric;
begin
  -- paid lines are frozen (money already went out)
  if tg_op = 'UPDATE' and old.status in ('paid', 'paid_directly') and (
       new.gross_amount is distinct from old.gross_amount
    or new.commission_pct is distinct from old.commission_pct
    or new.artist_id is distinct from old.artist_id
    or new.royalty_type is distinct from old.royalty_type) then
    raise exception 'This royalty line is already paid; amounts cannot be changed. Add an adjustment line instead.';
  end if;

  if new.label_id is null and new.artist_id is not null then
    select label_id into new.label_id from artists where id = new.artist_id;
  end if;

  -- auto-match work
  if new.work_id is null then
    if new.raw_iswc is not null then
      select id into new.work_id from works
      where replace(replace(iswc, '-', ''), '.', '') = replace(replace(new.raw_iswc, '-', ''), '.', '') limit 1;
    end if;
    if new.work_id is null and new.raw_isrc is not null then
      select id into new.work_id from works where upper(new.raw_isrc) = any(isrc) limit 1;
    end if;
    if new.work_id is null and new.raw_title is not null then
      select id into new.work_id from works
      where lower(trim(title)) = lower(trim(new.raw_title))
        and (new.label_id is null or label_id = new.label_id)
      limit 1;
    end if;
  end if;

  if new.match_status <> 'manual' then
    new.match_status := case when new.work_id is not null and new.artist_id is not null
                             then 'matched' else 'unmatched' end;
  end if;

  if new.royalty_type = 'admin_only' then
    new.commission_pct    := 0;
    new.commission_amount := 0;
    new.net_payable       := new.gross_amount;
    if new.status = 'pending' then
      new.status := 'paid_directly';
    end if;
  else
    if tg_op = 'INSERT' and coalesce(new.commission_pct, 0) = 0 then
      v_pct := commission_for(new.artist_id, new.label_id, new.period_start, new.territory);
      new.commission_pct := coalesce(v_pct, 0);
    end if;
    new.commission_amount := round(new.gross_amount * new.commission_pct / 100, 4);
    new.net_payable       := new.gross_amount - new.commission_amount;
  end if;
  return new;
end $$;

create trigger trg_royalty_line_calc
  before insert or update on royalty_lines
  for each row execute function calc_royalty_line();

-- ---------------------------------------------------------------------
-- Notifications helper
-- ---------------------------------------------------------------------
create or replace function public.notify_users(
  p_user_ids uuid[], p_type notification_type, p_title text, p_body text, p_link text
) returns void
language sql security definer set search_path = public as $$
  insert into notifications (user_id, type, title, body, link)
  select distinct u, p_type, p_title, p_body, p_link
  from unnest(p_user_ids) as u
  where u is not null
$$;

create or replace function public.super_admin_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(id), '{}') from profiles where role = 'super_admin' and is_active
$$;

-- ---------------------------------------------------------------------
-- finalize_report: call after all lines of a report are inserted.
-- Totals, mismatch detection, notifications.
-- ---------------------------------------------------------------------
create or replace function public.finalize_report(p_report uuid) returns royalty_reports
language plpgsql security definer set search_path = public as $$
declare
  r royalty_reports;
  v_rows int; v_unmatched int; v_gross numeric;
  v_mismatch boolean;
  v_recipients uuid[];
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can finalize reports';
  end if;

  select count(*), count(*) filter (where match_status = 'unmatched'), coalesce(sum(gross_amount), 0)
    into v_rows, v_unmatched, v_gross
  from royalty_lines where report_id = p_report;

  select * into r from royalty_reports where id = p_report;
  if not found then raise exception 'Report not found'; end if;

  v_mismatch := v_unmatched > 0
             or (r.declared_total is not null and abs(r.declared_total - v_gross) > 1);

  update royalty_reports
     set row_count = v_rows, unmatched_count = v_unmatched, total_gross = round(v_gross, 2),
         status = case when v_mismatch then 'mismatch'::report_status else 'processed'::report_status end,
         processed_at = now()
   where id = p_report
   returning * into r;

  if v_mismatch then
    perform notify_users(super_admin_ids(), 'data_mismatch',
      'Data mismatch: ' || r.source || ' ' || to_char(r.period_start, 'Mon YYYY'),
      format('%s of %s lines are unmatched%s', v_unmatched, v_rows,
             case when r.declared_total is not null and abs(r.declared_total - v_gross) > 1
                  then format('; statement total %s vs imported %s', r.declared_total, round(v_gross, 2))
                  else '' end),
      '/royalties/reports/' || r.id);
  end if;

  -- tell label admins + rights holders that new earnings are visible
  select array_agg(distinct uid) into v_recipients from (
    select p.id as uid from profiles p
     where p.role = 'label_admin' and p.is_active
       and p.label_id in (select distinct label_id from royalty_lines where report_id = p_report)
    union
    select a.user_id from artists a
     where a.user_id is not null
       and a.id in (select distinct artist_id from royalty_lines where report_id = p_report)
  ) x;

  perform notify_users(coalesce(v_recipients, '{}'), 'report_uploaded',
    'New ' || r.source || ' royalties added',
    format('Period %s to %s', r.period_start, r.period_end),
    '/royalties');

  return r;
end $$;

-- ---------------------------------------------------------------------
-- Statements
-- ---------------------------------------------------------------------
create or replace function public.generate_statement(
  p_artist uuid, p_period statement_period, p_start date, p_end date, p_society text default null
) returns statements
language plpgsql security definer set search_path = public as $$
declare s statements;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can generate statements';
  end if;
  if p_period = 'society' and p_society is null then
    raise exception 'Society statements need a society name';
  end if;

  insert into statements (artist_id, label_id, period_type, period_start, period_end, society)
  select p_artist, a.label_id, p_period, p_start, p_end, p_society from artists a where a.id = p_artist
  on conflict (artist_id, period_type, period_start, period_end, coalesce(society, ''))
  do update set created_at = statements.created_at
  returning * into s;

  if s.status = 'published' then
    raise exception 'Statement already published; it cannot be regenerated';
  end if;

  update statements st set
    total_gross      = x.gross,
    total_commission = x.comm,
    total_net        = x.net,
    admin_only_total = x.admin_only
  from (
    select
      coalesce(round(sum(gross_amount)      filter (where royalty_type = 'publisher'), 2), 0) gross,
      coalesce(round(sum(commission_amount) filter (where royalty_type = 'publisher'), 2), 0) comm,
      coalesce(round(sum(net_payable)       filter (where royalty_type = 'publisher'), 2), 0) net,
      coalesce(round(sum(gross_amount)      filter (where royalty_type = 'admin_only'), 2), 0) admin_only
    from royalty_lines
    where artist_id = p_artist
      and period_start >= p_start and period_end <= p_end
      and (p_society is null or upper(source) = upper(p_society))
  ) x
  where st.id = s.id
  returning st.* into s;

  return s;
end $$;

create or replace function public.publish_statement(p_statement uuid) returns statements
language plpgsql security definer set search_path = public as $$
declare s statements; v_user uuid;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can publish statements';
  end if;
  update statements set status = 'published', published_at = now()
   where id = p_statement returning * into s;
  if not found then raise exception 'Statement not found'; end if;

  select user_id into v_user from artists where id = s.artist_id;
  perform notify_users(array[v_user], 'statement_available',
    'Your ' || s.period_type || ' statement is ready',
    format('%s to %s — net payable %s', s.period_start, s.period_end, s.total_net),
    '/statements/' || s.id);
  return s;
end $$;

-- ---------------------------------------------------------------------
-- Payments: GST/TDS math + approval workflow
--   draft -> pending_approval -> approved -> paid
-- ---------------------------------------------------------------------
create or replace function public.payment_workflow() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  new.gst_amount     := round(new.amount * new.gst_pct / 100, 2);
  new.tds_amount     := round(new.amount * new.tds_pct / 100, 2);
  new.payable_amount := new.amount + new.gst_amount - new.tds_amount;

  if tg_op = 'UPDATE' then
    if old.status = 'paid' and (new.amount is distinct from old.amount or new.status <> 'paid') then
      raise exception 'Paid invoices are locked';
    end if;

    if new.status = 'approved' and old.status <> 'approved' then
      if old.status <> 'pending_approval' then
        raise exception 'Only invoices pending approval can be approved';
      end if;
      new.approved_by := coalesce(auth.uid(), new.approved_by);
      new.approved_at := now();
    end if;

    if new.status = 'paid' and old.status <> 'paid' then
      if old.status <> 'approved' then
        raise exception 'Invoice must be approved before it is marked paid';
      end if;
      if new.payment_mode is null or coalesce(new.transaction_id, '') = '' then
        raise exception 'Payment mode and transaction ID are required to mark as paid';
      end if;
      new.paid_at := coalesce(new.paid_at, now());
    end if;
  end if;
  return new;
end $$;

create trigger trg_payment_workflow before insert or update on payments
  for each row execute function payment_workflow();

create or replace function public.payment_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_user uuid;
begin
  if new.status = 'paid' and (tg_op = 'INSERT' or old.status <> 'paid') then
    -- settle the publisher lines that belong to this invoice
    update royalty_lines
       set status = 'paid', payment_id = new.id
     where royalty_type = 'publisher'
       and status in ('pending', 'approved')
       and (payment_id = new.id
            or (artist_id = new.artist_id
                and period_start >= new.period_start and period_end <= new.period_end));
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status <> 'draft' then
    select user_id into v_user from artists where id = new.artist_id;
    perform notify_users(array[v_user], 'payment_update',
      'Invoice ' || new.invoice_no || ': ' || replace(new.status::text, '_', ' '),
      case when new.status = 'paid'
           then format('%s %s paid via %s (Txn %s)', new.currency, new.payable_amount, new.payment_mode, new.transaction_id)
           else null end,
      '/payments/' || new.id);
  end if;
  return null;
end $$;

create trigger trg_payment_after after insert or update on payments
  for each row execute function payment_after();

-- ---------------------------------------------------------------------
-- Audit trail (edit history). Access events are logged with log_event().
-- ---------------------------------------------------------------------
create or replace function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_email text; v_id text;
begin
  select email into v_email from profiles where id = auth.uid();
  v_id := coalesce(
    case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end, '');
  insert into audit_logs (actor_id, actor_email, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), v_email, tg_op, tg_table_name, v_id,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['labels','profiles','artists','works','ownership','contracts',
                           'royalty_reports','statements','payments']
  loop
    execute format('create trigger trg_%1$s_audit after insert or update or delete on %1$s
                    for each row execute function audit_row()', t);
  end loop;
end $$;

-- royalty_lines: bulk inserts are covered by the report upload log; audit edits & deletes only
create trigger trg_royalty_lines_audit after update or delete on royalty_lines
  for each row execute function audit_row();

-- App calls this for LOGIN / LOGOUT / DOWNLOAD / EXPORT events
create or replace function public.log_event(
  p_action text, p_table text default null, p_record text default null,
  p_ip inet default null, p_user_agent text default null, p_details jsonb default null
) returns void
language sql security definer set search_path = public as $$
  insert into audit_logs (actor_id, actor_email, action, table_name, record_id, new_data, ip, user_agent)
  select auth.uid(), (select email from profiles where id = auth.uid()),
         upper(p_action), p_table, p_record, p_details, p_ip, p_user_agent
$$;

-- ---------------------------------------------------------------------
-- Encrypted bank account (pgcrypto). Key lives in Supabase Vault as 'payout_key'.
-- ---------------------------------------------------------------------
create or replace function public.payout_key() returns text
language plpgsql stable security definer set search_path = public as $$
declare k text;
begin
  begin
    execute 'select decrypted_secret from vault.decrypted_secrets where name = ''payout_key'' limit 1' into k;
  exception when others then
    k := null;
  end;
  k := coalesce(k, current_setting('app.payout_key', true));
  if k is null or k = '' then
    raise exception 'Encryption key "payout_key" is not configured in Vault';
  end if;
  return k;
end $$;

create or replace function public.set_artist_bank_account(
  p_artist uuid, p_account text, p_ifsc text, p_bank text
) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can change bank details';
  end if;
  update artists set
    bank_account_enc   = pgp_sym_encrypt(p_account, payout_key()),
    bank_account_last4 = right(regexp_replace(p_account, '\D', '', 'g'), 4),
    bank_ifsc          = upper(p_ifsc),
    bank_name          = p_bank
  where id = p_artist;
  perform log_event('BANK_DETAILS_CHANGED', 'artists', p_artist::text);
end $$;

create or replace function public.get_artist_bank_account(p_artist uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v text;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can view full bank details';
  end if;
  select pgp_sym_decrypt(bank_account_enc, payout_key()) into v from artists where id = p_artist;
  perform log_event('BANK_DETAILS_VIEWED', 'artists', p_artist::text);
  return v;
end $$;
-- =====================================================================
-- Plutus Media — Royalty Dashboard
-- Migration 0003: Row Level Security (who sees what) + dashboard views
--
--   super_admin     : everything
--   label_admin     : everything that belongs to his/her label
--                     (can manage artists / works / ownership of that label,
--                      read-only for royalties, statements, payments, contracts)
--   author_composer : only his/her own earnings, works, statements, payments,
--                     contracts (read-only)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------
alter table labels          enable row level security;
alter table profiles        enable row level security;
alter table artists         enable row level security;
alter table works           enable row level security;
alter table ownership       enable row level security;
alter table contracts       enable row level security;
alter table royalty_reports enable row level security;
alter table royalty_lines   enable row level security;
alter table statements      enable row level security;
alter table payments        enable row level security;
alter table notifications   enable row level security;
alter table audit_logs      enable row level security;

-- Anonymous visitors get nothing
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;

-- Artists: hide the encrypted bank column from the API completely
revoke select on artists from authenticated;
grant select (id, label_id, user_id, stage_name, legal_name, email, phone, ipi_number, society,
              pan, gstin, bank_name, bank_ifsc, bank_account_last4, is_active, created_at, updated_at)
  on artists to authenticated;

-- Audit log: append-only, nobody edits history through the API
revoke insert, update, delete on audit_logs from authenticated;

-- Workflow functions must go through their own role checks
revoke execute on function finalize_report(uuid)                   from public;
revoke execute on function publish_statement(uuid)                 from public;
revoke execute on function set_artist_bank_account(uuid,text,text,text) from public;
revoke execute on function get_artist_bank_account(uuid)           from public;
revoke execute on function notify_users(uuid[],notification_type,text,text,text) from public, authenticated;
revoke execute on function payout_key()                            from public, authenticated;
grant  execute on function finalize_report(uuid)                   to authenticated;
grant  execute on function publish_statement(uuid)                 to authenticated;
grant  execute on function set_artist_bank_account(uuid,text,text,text) to authenticated;
grant  execute on function get_artist_bank_account(uuid)           to authenticated;

-- ---------------------------------------------------------------------
-- LABELS
-- ---------------------------------------------------------------------
create policy labels_read on labels for select to authenticated using (
  is_super_admin()
  or id = my_label_id()
  or id in (select label_id from artists where id in (select my_artist_ids()))
);
create policy labels_write on labels for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
create policy profiles_read on profiles for select to authenticated using (
  id = auth.uid()
  or is_super_admin()
  or (my_label_id() is not null and label_id = my_label_id())
);
create policy profiles_update on profiles for update to authenticated
  using (id = auth.uid() or is_super_admin())
  with check (id = auth.uid() or is_super_admin());
create policy profiles_admin_write on profiles for insert to authenticated
  with check (is_super_admin());
create policy profiles_admin_delete on profiles for delete to authenticated
  using (is_super_admin());

-- ---------------------------------------------------------------------
-- ARTISTS
-- ---------------------------------------------------------------------
create policy artists_read on artists for select to authenticated using (
  is_super_admin()
  or (label_id is not null and label_id = my_label_id())
  or user_id = auth.uid()
);
create policy artists_insert on artists for insert to authenticated with check (
  is_super_admin() or (label_id is not null and label_id = my_label_id())
);
create policy artists_update on artists for update to authenticated
  using      (is_super_admin() or (label_id is not null and label_id = my_label_id()))
  with check (is_super_admin() or (label_id is not null and label_id = my_label_id()));
create policy artists_delete on artists for delete to authenticated using (is_super_admin());

-- ---------------------------------------------------------------------
-- WORKS
-- ---------------------------------------------------------------------
create policy works_read on works for select to authenticated using (
  is_super_admin()
  or (label_id is not null and label_id = my_label_id())
  or id in (select work_id from ownership where artist_id in (select my_artist_ids()))
);
create policy works_insert on works for insert to authenticated with check (
  is_super_admin() or (label_id is not null and label_id = my_label_id())
);
create policy works_update on works for update to authenticated
  using      (is_super_admin() or (label_id is not null and label_id = my_label_id()))
  with check (is_super_admin() or (label_id is not null and label_id = my_label_id()));
create policy works_delete on works for delete to authenticated using (is_super_admin());

-- ---------------------------------------------------------------------
-- OWNERSHIP  (rights holders see every split on their own works = transparency)
-- ---------------------------------------------------------------------
create or replace function public.work_label(p_work uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select label_id from works where id = p_work
$$;

create or replace function public.my_work_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select distinct work_id from ownership where artist_id in (select my_artist_ids())
$$;

create policy ownership_read on ownership for select to authenticated using (
  is_super_admin()
  or (my_label_id() is not null and work_label(work_id) = my_label_id())
  or work_id in (select my_work_ids())
);
create policy ownership_write on ownership for all to authenticated
  using      (is_super_admin() or (my_label_id() is not null and work_label(work_id) = my_label_id()))
  with check (is_super_admin() or (my_label_id() is not null and work_label(work_id) = my_label_id()));

-- ---------------------------------------------------------------------
-- CONTRACTS  (read-only for clients)
-- ---------------------------------------------------------------------
create policy contracts_read on contracts for select to authenticated using (
  is_super_admin()
  or (my_label_id() is not null and (label_id = my_label_id()
        or artist_id in (select id from artists where label_id = my_label_id())))
  or artist_id in (select my_artist_ids())
);
create policy contracts_write on contracts for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- ROYALTY REPORTS  (upload batches — internal + label)
-- ---------------------------------------------------------------------
create policy reports_read on royalty_reports for select to authenticated using (
  is_super_admin() or (label_id is not null and label_id = my_label_id())
);
create policy reports_write on royalty_reports for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- ROYALTY LINES
-- ---------------------------------------------------------------------
create policy lines_read on royalty_lines for select to authenticated using (
  is_super_admin()
  or (label_id is not null and label_id = my_label_id())
  or artist_id in (select my_artist_ids())
);
create policy lines_write on royalty_lines for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- STATEMENTS  (clients see published ones only)
-- ---------------------------------------------------------------------
create policy statements_read on statements for select to authenticated using (
  is_super_admin()
  or (status = 'published' and (
        (label_id is not null and label_id = my_label_id())
        or artist_id in (select my_artist_ids())))
);
create policy statements_write on statements for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- PAYMENTS  (clients don't see drafts)
-- ---------------------------------------------------------------------
create policy payments_read on payments for select to authenticated using (
  is_super_admin()
  or (status <> 'draft' and (
        (label_id is not null and label_id = my_label_id())
        or artist_id in (select my_artist_ids())))
);
create policy payments_write on payments for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- NOTIFICATIONS  (own only; can mark as read)
-- ---------------------------------------------------------------------
create policy notifications_read on notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notifications_admin on notifications for all to authenticated
  using (is_super_admin()) with check (is_super_admin());

-- ---------------------------------------------------------------------
-- AUDIT LOGS  (Super Admin read-only)
-- ---------------------------------------------------------------------
create policy audit_read on audit_logs for select to authenticated using (is_super_admin());

-- =====================================================================
-- DASHBOARD VIEWS / FUNCTIONS
-- security_invoker = the caller's RLS applies, so every role
-- automatically sees only its own numbers.
-- =====================================================================

create view v_royalty_lines with (security_invoker = true) as
select
  l.id, l.report_id, l.royalty_type, l.source, l.territory, l.usage_type,
  l.period_start, l.period_end, l.units,
  round(l.gross_amount, 2)      as gross_amount,
  l.commission_pct,
  round(l.commission_amount, 2) as commission_amount,
  round(l.net_payable, 2)       as net_payable,
  l.currency, l.status, l.match_status,
  l.artist_id, a.stage_name     as artist_name,
  l.label_id,  lb.name          as label_name,
  l.work_id,   coalesce(w.title, l.raw_title) as work_title,
  w.iswc, l.statement_id, l.payment_id, l.created_at
from royalty_lines l
left join artists a  on a.id  = l.artist_id
left join labels  lb on lb.id = l.label_id
left join works   w  on w.id  = l.work_id;

create view v_catalog with (security_invoker = true) as
select
  w.id as work_id, w.title, w.iswc, w.isrc, w.status, w.territories, w.label_id,
  o.artist_id, a.stage_name as artist_name, o.role, o.share_pct, o.territory as ownership_territory
from works w
left join ownership o on o.work_id = w.id
left join artists  a  on a.id = o.artist_id;

-- KPI cards: Lifetime / Current period / Pending / Paid
create or replace function public.dashboard_kpis(p_artist uuid default null, p_label uuid default null)
returns table (
  lifetime_gross numeric, lifetime_commission numeric, lifetime_net numeric,
  admin_only_lifetime numeric,
  current_period_start date, current_period_end date,
  current_period_net numeric, current_period_admin_only numeric,
  pending_net numeric, paid_net numeric
)
language sql stable security invoker set search_path = public as $$
  with v as (
    select * from royalty_lines
    where (p_artist is null or artist_id = p_artist)
      and (p_label  is null or label_id  = p_label)
  ), cur as (
    select max(period_start) as ps from v
  )
  select
    coalesce(round(sum(gross_amount)      filter (where royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(commission_amount) filter (where royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(net_payable)       filter (where royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(gross_amount)      filter (where royalty_type = 'admin_only'), 2), 0),
    (select ps from cur),
    (select max(period_end) from v where period_start = (select ps from cur)),
    coalesce(round(sum(net_payable)  filter (where royalty_type = 'publisher'
                                       and period_start = (select ps from cur)), 2), 0),
    coalesce(round(sum(gross_amount) filter (where royalty_type = 'admin_only'
                                       and period_start = (select ps from cur)), 2), 0),
    coalesce(round(sum(net_payable)  filter (where royalty_type = 'publisher'
                                       and status in ('pending', 'approved', 'on_hold')), 2), 0),
    coalesce(round(sum(net_payable)  filter (where royalty_type = 'publisher' and status = 'paid'), 2), 0)
  from v
$$;

-- Earnings split by any dimension: 'source' | 'territory' | 'month' | 'work'
create or replace function public.earnings_breakdown(
  p_dimension text, p_from date default null, p_to date default null,
  p_artist uuid default null, p_label uuid default null
) returns table (bucket text, publisher_gross numeric, commission numeric, publisher_net numeric, admin_only numeric)
language sql stable security invoker set search_path = public as $$
  select
    case p_dimension
      when 'source'    then l.source
      when 'territory' then l.territory
      when 'month'     then to_char(l.period_start, 'YYYY-MM')
      when 'work'      then coalesce(w.title, l.raw_title, 'Unmatched')
      else 'all'
    end as bucket,
    coalesce(round(sum(l.gross_amount)      filter (where l.royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(l.commission_amount) filter (where l.royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(l.net_payable)       filter (where l.royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(l.gross_amount)      filter (where l.royalty_type = 'admin_only'), 2), 0)
  from royalty_lines l
  left join works w on w.id = l.work_id
  where (p_from   is null or l.period_start >= p_from)
    and (p_to     is null or l.period_end   <= p_to)
    and (p_artist is null or l.artist_id = p_artist)
    and (p_label  is null or l.label_id  = p_label)
  group by 1
  order by 4 desc, 5 desc
$$;

grant select on v_royalty_lines, v_catalog to authenticated;
grant execute on function dashboard_kpis(uuid, uuid) to authenticated;
grant execute on function earnings_breakdown(text, date, date, uuid, uuid) to authenticated;
revoke all on v_royalty_lines, v_catalog from anon;
revoke execute on function dashboard_kpis(uuid, uuid) from anon;
revoke execute on function earnings_breakdown(text, date, date, uuid, uuid) from anon;
