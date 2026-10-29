-- =====================================================================
-- Plutus Media — Royalty Dashboard
-- Migration 0005 (Session 3): IPRS import, client commission, Plutus fee
-- on royalties paid directly, publish-before-clients-see.
--
-- Business rules (from Plutus, 29 Oct 2026):
--   * Sub-publisher model: IPRS pays Plutus; Plutus keeps its commission and
--     pays the rest to the original publisher (the client label).
--   * Royalties IPRS pays writers / publishers directly: Plutus does not
--     touch the money but earns its commission on it and invoices for it.
--     -> admin_only lines now carry a "Plutus fee" (commission_amount);
--        net_payable stays = gross (the rights holder already has it).
--   * Every client can have its own %; without a contract the default
--     commission applies (15% to start, changeable by the Super Admin).
--   * Changing a % re-calculates every line that is not paid / invoiced yet.
--   * Imported reports stay hidden from clients until a Super Admin publishes.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Settings: default commission
-- ---------------------------------------------------------------------
create table app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references profiles(id) on delete set null default auth.uid()
);
alter table app_settings enable row level security;
revoke all on app_settings from anon;
create policy settings_read  on app_settings for select to authenticated using (true);
create policy settings_write on app_settings for all to authenticated
  using (is_super_admin()) with check (is_super_admin());
create trigger trg_app_settings_audit after insert or update or delete on app_settings
  for each row execute function audit_row();

insert into app_settings (key, value) values ('default_commission_pct', '15');

create or replace function public.default_commission() returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from app_settings where key = 'default_commission_pct'), 15)
$$;

-- Contract first (personal deal beats label-wide), otherwise the default.
create or replace function public.commission_for(
  p_artist uuid, p_label uuid, p_on date, p_territory text
) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((
    select c.commission_pct
    from contracts c
    where c.status = 'active'
      and c.effective_date <= p_on
      and (c.end_date is null or c.end_date >= p_on)
      and ('WORLD' = any(c.territories) or upper(coalesce(p_territory, 'WORLD')) = any(c.territories))
      and (c.artist_id = p_artist or (c.artist_id is null and c.label_id = p_label))
    order by (c.artist_id is not null) desc, c.effective_date desc
    limit 1
  ), default_commission())
$$;

-- ---------------------------------------------------------------------
-- New columns
-- ---------------------------------------------------------------------
alter table works add column iprs_work_no text;
create unique index works_iprs_work_no_uq on works (iprs_work_no) where iprs_work_no is not null;

alter table labels add column aliases text[] not null default '{}';

alter table royalty_lines
  add column raw_work_no    text,
  add column licensee       text,     -- platform / licensee that paid (Spotify AB, Airtel …)
  add column publisher_name text;     -- original publisher named on the statement
create index on royalty_lines (licensee);

alter table royalty_reports
  add column distribution_code text,
  add column published_at      timestamptz,
  add column published_by      uuid references profiles(id) on delete set null;

-- Same normalisation as normName() in the web app:
-- "Fatafat Digital Private Limited" = "FATAFAT DIGITAL PVT LTD" -> "FATAFAT DIGITAL"
create or replace function public.norm_name(t text) returns text
language sql immutable as $$
  select btrim(regexp_replace(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(upper(coalesce(t, '')), '&', ' AND ', 'g'),
                 '\yPRIVATE\y', 'PVT', 'g'),
               '\yLIMITED\y', 'LTD', 'g'),
             '[^A-Z0-9]+', ' ', 'g'),
           '\y(PVT LTD|LTD|LLP|PVT|INC|CO)\y', ' ', 'g'),
         '\s+', ' ', 'g'))
$$;

create or replace function public.label_for_name(p_name text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from labels l
  where norm_name(l.name) = norm_name(p_name)
     or norm_name(p_name) in (select norm_name(a) from unnest(l.aliases) a)
  order by l.is_active desc, l.created_at
  limit 1
$$;

-- ---------------------------------------------------------------------
-- Royalty line calculation (replaces the Session 1 version)
--   publisher  : commission per contract/default, net = gross - commission
--   admin_only : paid directly; commission_amount = Plutus fee to invoice,
--                net = gross (the rights holder already received it)
-- Frozen once money moved: publisher lines when paid, admin_only lines
-- once their fee is on an invoice.
-- ---------------------------------------------------------------------
create or replace function public.calc_royalty_line() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE'
     and (old.status = 'paid' or (old.royalty_type = 'admin_only' and old.payment_id is not null))
     and (new.gross_amount is distinct from old.gross_amount
       or new.commission_pct is distinct from old.commission_pct
       or new.artist_id is distinct from old.artist_id
       or new.label_id is distinct from old.label_id
       or new.royalty_type is distinct from old.royalty_type) then
    raise exception 'This royalty line is already paid or invoiced; amounts cannot be changed. Add an adjustment line instead.';
  end if;

  if new.label_id is null and new.artist_id is not null then
    select label_id into new.label_id from artists where id = new.artist_id;
  end if;

  -- auto-match work: IPRS work number -> ISWC -> ISRC -> title
  if new.work_id is null then
    if new.raw_work_no is not null then
      select id into new.work_id from works where iprs_work_no = new.raw_work_no limit 1;
    end if;
    if new.work_id is null and new.raw_iswc is not null then
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

  if new.label_id is null and new.artist_id is null and new.work_id is not null then
    select label_id into new.label_id from works where id = new.work_id;
  end if;

  if new.match_status <> 'manual' then
    new.match_status := case when new.work_id is not null and (new.artist_id is not null or new.label_id is not null)
                             then 'matched' else 'unmatched' end;
  end if;

  if tg_op = 'INSERT' and new.commission_pct is null then
    new.commission_pct := 0;
  end if;
  if tg_op = 'INSERT' and new.commission_pct = 0 then
    new.commission_pct := commission_for(new.artist_id, new.label_id, new.period_start, new.territory);
  end if;
  new.commission_amount := round(new.gross_amount * new.commission_pct / 100, 4);

  if new.royalty_type = 'admin_only' then
    new.net_payable := new.gross_amount;           -- already with the rights holder
    if new.status = 'pending' then
      new.status := 'paid_directly';
    end if;
  else
    new.net_payable := new.gross_amount - new.commission_amount;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Re-calculate commission on everything not yet paid / invoiced
-- ---------------------------------------------------------------------
create or replace function public.recalc_open_commissions(p_label uuid default null, p_artist uuid default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can change commission';
  end if;
  with u as (
    update royalty_lines l
       set commission_pct = commission_for(l.artist_id, l.label_id, l.period_start, l.territory)
     where (l.status in ('pending', 'approved', 'on_hold', 'disputed')
            or (l.royalty_type = 'admin_only' and l.payment_id is null))
       and (p_label  is null or l.label_id  = p_label)
       and (p_artist is null or l.artist_id = p_artist)
       and l.commission_pct is distinct from commission_for(l.artist_id, l.label_id, l.period_start, l.territory)
    returning 1
  )
  select count(*) into n from u;
  return n;
end $$;

-- Quick edit from the dashboard: one % per client (label or rights holder).
-- Updates the client's active contract, or creates one if there is none.
create or replace function public.set_client_commission(p_label uuid, p_artist uuid, p_pct numeric)
returns integer
language plpgsql security definer set search_path = public as $$
declare v_found int; v_label uuid;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can change commission';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    raise exception 'Commission must be between 0 and 100 percent';
  end if;
  if (p_label is null) = (p_artist is null) then
    raise exception 'Choose either a label or a rights holder';
  end if;

  if p_artist is not null then
    update contracts set commission_pct = p_pct
     where artist_id = p_artist and status = 'active'
       and effective_date <= current_date and (end_date is null or end_date >= current_date);
    get diagnostics v_found = row_count;
    if v_found = 0 then
      select label_id into v_label from artists where id = p_artist;
      if not found then raise exception 'Rights holder not found'; end if;
      insert into contracts (label_id, artist_id, contract_type, commission_pct, effective_date, territories, status, notes)
      values (v_label, p_artist, 'administration', p_pct, date '2000-01-01', '{WORLD}', 'active', 'Set from the dashboard');
    end if;
  else
    update contracts set commission_pct = p_pct
     where label_id = p_label and artist_id is null and status = 'active'
       and effective_date <= current_date and (end_date is null or end_date >= current_date);
    get diagnostics v_found = row_count;
    if v_found = 0 then
      if not exists (select 1 from labels where id = p_label) then raise exception 'Label not found'; end if;
      insert into contracts (label_id, contract_type, commission_pct, effective_date, territories, status, notes)
      values (p_label, 'sub_publishing', p_pct, date '2000-01-01', '{WORLD}', 'active', 'Set from the dashboard');
    end if;
  end if;

  return recalc_open_commissions(p_label, p_artist);
end $$;

create or replace function public.set_default_commission(p_pct numeric)
returns integer
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can change commission';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then
    raise exception 'Commission must be between 0 and 100 percent';
  end if;
  insert into app_settings (key, value) values ('default_commission_pct', to_jsonb(p_pct))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  return recalc_open_commissions();
end $$;

-- Clients and their current % for the dashboard panel (Super Admin reads everything).
create or replace function public.client_commission_list()
returns table (kind text, id uuid, name text, label_name text, commission_pct numeric,
               is_default boolean, open_gross numeric, open_commission numeric)
language sql stable security invoker set search_path = public as $$
  select 'label', l.id, l.name, null::text,
         commission_for(null, l.id, current_date, 'WORLD'),
         not exists (select 1 from contracts c where c.label_id = l.id and c.artist_id is null and c.status = 'active'
                       and c.effective_date <= current_date and (c.end_date is null or c.end_date >= current_date)),
         coalesce((select round(sum(r.gross_amount), 2) from royalty_lines r
                    where r.label_id = l.id and r.artist_id is null
                      and (r.status in ('pending','approved','on_hold','disputed') or (r.royalty_type = 'admin_only' and r.payment_id is null))), 0),
         coalesce((select round(sum(r.commission_amount), 2) from royalty_lines r
                    where r.label_id = l.id and r.artist_id is null
                      and (r.status in ('pending','approved','on_hold','disputed') or (r.royalty_type = 'admin_only' and r.payment_id is null))), 0)
  from labels l
  where l.is_active
  union all
  select 'artist', a.id, a.stage_name, lb.name,
         commission_for(a.id, a.label_id, current_date, 'WORLD'),
         not exists (select 1 from contracts c where (c.artist_id = a.id or (c.artist_id is null and c.label_id = a.label_id))
                       and c.status = 'active' and c.effective_date <= current_date and (c.end_date is null or c.end_date >= current_date)),
         coalesce((select round(sum(r.gross_amount), 2) from royalty_lines r
                    where r.artist_id = a.id
                      and (r.status in ('pending','approved','on_hold','disputed') or (r.royalty_type = 'admin_only' and r.payment_id is null))), 0),
         coalesce((select round(sum(r.commission_amount), 2) from royalty_lines r
                    where r.artist_id = a.id
                      and (r.status in ('pending','approved','on_hold','disputed') or (r.royalty_type = 'admin_only' and r.payment_id is null))), 0)
  from artists a
  left join labels lb on lb.id = a.label_id
  where a.is_active
    and (a.user_id is not null
         or exists (select 1 from contracts c where c.artist_id = a.id)
         or exists (select 1 from royalty_lines r where r.artist_id = a.id))
  order by 1 desc, 3
$$;

revoke execute on function recalc_open_commissions(uuid, uuid), set_client_commission(uuid, uuid, numeric),
                          set_default_commission(numeric), client_commission_list(), label_for_name(text)
  from public, anon;
grant execute on function recalc_open_commissions(uuid, uuid), set_client_commission(uuid, uuid, numeric),
                          set_default_commission(numeric), client_commission_list(), label_for_name(text)
  to authenticated;

-- ---------------------------------------------------------------------
-- Publish before clients see anything
-- ---------------------------------------------------------------------
create or replace function public.report_is_published(p_report uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select published_at is not null from royalty_reports where id = p_report), false)
$$;

drop policy lines_read on royalty_lines;
create policy lines_read on royalty_lines for select to authenticated using (
  is_super_admin()
  or (report_is_published(report_id) and (
        (label_id is not null and label_id = my_label_id())
        or artist_id in (select my_artist_ids())))
);

drop policy reports_read on royalty_reports;
create policy reports_read on royalty_reports for select to authenticated using (
  is_super_admin() or (published_at is not null and label_id is not null and label_id = my_label_id())
);

-- finalize: totals + mismatch alert to Plutus only (clients are told on publish)
create or replace function public.finalize_report(p_report uuid) returns royalty_reports
language plpgsql security definer set search_path = public as $$
declare
  r royalty_reports;
  v_rows int; v_unmatched int; v_gross numeric;
  v_mismatch boolean;
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
      'Check before publishing: ' || r.source || ' ' || coalesce(r.distribution_code, to_char(r.period_start, 'Mon YYYY')),
      format('%s of %s lines are not matched to a work and client%s', v_unmatched, v_rows,
             case when r.declared_total is not null and abs(r.declared_total - v_gross) > 1
                  then format('; statement total %s vs imported %s', r.declared_total, round(v_gross, 2))
                  else '' end),
      '/uploads/' || r.id);
  end if;
  return r;
end $$;

create or replace function public.publish_report(p_report uuid) returns royalty_reports
language plpgsql security definer set search_path = public as $$
declare r royalty_reports; v_recipients uuid[];
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can publish royalties';
  end if;
  update royalty_reports set published_at = now(), published_by = auth.uid()
   where id = p_report and published_at is null
   returning * into r;
  if not found then
    select * into r from royalty_reports where id = p_report;
    if not found then raise exception 'Report not found'; end if;
    return r;   -- already published
  end if;

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

create or replace function public.unpublish_report(p_report uuid) returns royalty_reports
language plpgsql security definer set search_path = public as $$
declare r royalty_reports;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can do this';
  end if;
  if exists (select 1 from royalty_lines where report_id = p_report
             and (status = 'paid' or payment_id is not null or statement_id is not null)) then
    raise exception 'Some of these royalties are already on a statement or invoice; they cannot be hidden again';
  end if;
  update royalty_reports set published_at = null, published_by = null where id = p_report returning * into r;
  return r;
end $$;

-- delete a report (and its lines) only while nothing was paid, invoiced or published
create or replace function public.delete_report(p_report uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can delete a report';
  end if;
  if exists (select 1 from royalty_reports where id = p_report and published_at is not null) then
    raise exception 'Hide (unpublish) the report before deleting it';
  end if;
  if exists (select 1 from royalty_lines where report_id = p_report
             and (status = 'paid' or payment_id is not null or statement_id is not null)) then
    raise exception 'Some of these royalties are already on a statement or invoice';
  end if;
  delete from royalty_reports where id = p_report;
  perform log_event('REPORT_DELETED', 'royalty_reports', p_report::text);
end $$;

-- ---------------------------------------------------------------------
-- IPRS import: one call, all-or-nothing.
-- p_meta : {file_name, file_path, file_sha256, period_start, period_end,
--           royalty_type, declared_total, distribution_code, source, territory,
--           create_missing_works, clients: [{name, label_id}]}
-- p_lines: [{workNo, title, language, publisher, licensee, pool, amount, collPct, breakdown}]
-- ---------------------------------------------------------------------
create or replace function public.import_iprs_report(p_meta jsonb, p_lines jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_report  uuid;
  v_type    royalty_type := coalesce(nullif(p_meta->>'royalty_type', ''), 'publisher')::royalty_type;
  v_start   date := (p_meta->>'period_start')::date;
  v_end     date := (p_meta->>'period_end')::date;
  v_sha     text := nullif(p_meta->>'file_sha256', '');
  v_terr    text := coalesce(nullif(upper(p_meta->>'territory'), ''), 'IN');
  v_source  text := coalesce(nullif(p_meta->>'source', ''), 'IPRS');
  v_when    timestamptz;
  c         jsonb;
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can import royalty statements';
  end if;
  if v_start is null or v_end is null or v_end < v_start then
    raise exception 'Choose the period this statement covers';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'The statement has no royalty lines';
  end if;
  if v_sha is not null then
    select created_at into v_when from royalty_reports where file_sha256 = v_sha;
    if found then
      raise exception 'This exact file was already imported on %', to_char(v_when, 'DD Mon YYYY');
    end if;
  end if;

  -- remember how statement publisher names map to labels (aliases)
  for c in select * from jsonb_array_elements(coalesce(p_meta->'clients', '[]'::jsonb)) loop
    if nullif(c->>'label_id', '') is not null and nullif(trim(c->>'name'), '') is not null then
      update labels l set aliases = (select array_agg(distinct a) from unnest(l.aliases || array[trim(c->>'name')]) a)
       where l.id = (c->>'label_id')::uuid
         and norm_name(l.name) <> norm_name(c->>'name')
         and not norm_name(c->>'name') in (select norm_name(a) from unnest(l.aliases) a);
    end if;
  end loop;

  insert into royalty_reports (source, royalty_type, period_start, period_end, file_name, file_path,
                               file_sha256, uploaded_by, declared_total, distribution_code, notes)
  values (v_source, v_type, v_start, v_end, p_meta->>'file_name', p_meta->>'file_path', v_sha, auth.uid(),
          nullif(p_meta->>'declared_total', '')::numeric, nullif(p_meta->>'distribution_code', ''),
          nullif(p_meta->>'notes', ''))
  returning id into v_report;

  -- catalog: attach IPRS work numbers to works that already exist by title, add the rest
  if coalesce((p_meta->>'create_missing_works')::boolean, false) then
    with w as (
      select distinct on (x->>'workNo') x->>'workNo' as no, trim(x->>'title') as title,
             nullif(trim(x->>'language'), '') as lang, label_for_name(x->>'publisher') as label_id
      from jsonb_array_elements(p_lines) x
      where nullif(x->>'workNo', '') is not null
    )
    update works t set iprs_work_no = w.no
      from w
     where t.iprs_work_no is null
       and lower(trim(t.title)) = lower(w.title)
       and t.label_id is not distinct from w.label_id
       and not exists (select 1 from works z where z.iprs_work_no = w.no);

    insert into works (iprs_work_no, title, language, label_id, status, notes)
    select distinct on (x->>'workNo') x->>'workNo', trim(x->>'title'), nullif(trim(x->>'language'), ''),
           label_for_name(x->>'publisher'), 'registered', 'Added from IPRS statement'
    from jsonb_array_elements(p_lines) x
    where nullif(x->>'workNo', '') is not null
      and not exists (select 1 from works z where z.iprs_work_no = x->>'workNo');
  end if;

  insert into royalty_lines (report_id, royalty_type, label_id, source, territory, period_start, period_end,
                             usage_type, gross_amount, raw_title, raw_work_no, licensee, publisher_name, raw)
  select v_report, v_type, label_for_name(x->>'publisher'), v_source, v_terr, v_start, v_end,
         nullif(x->>'pool', ''), round((x->>'amount')::numeric, 4), x->>'title', x->>'workNo',
         nullif(x->>'licensee', ''), nullif(x->>'publisher', ''), x
  from jsonb_array_elements(p_lines) x
  where coalesce((x->>'amount')::numeric, 0) <> 0;

  perform finalize_report(v_report);
  perform log_event('REPORT_IMPORTED', 'royalty_reports', v_report::text, null, null,
                    jsonb_build_object('file', p_meta->>'file_name', 'lines', jsonb_array_length(p_lines)));
  return v_report;
end $$;

revoke execute on function import_iprs_report(jsonb, jsonb), publish_report(uuid), unpublish_report(uuid),
                          delete_report(uuid) from public, anon;
grant execute on function import_iprs_report(jsonb, jsonb), publish_report(uuid), unpublish_report(uuid),
                          delete_report(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Dashboard numbers (adds the Plutus fee on directly-paid royalties)
-- ---------------------------------------------------------------------
drop function dashboard_kpis(uuid, uuid);
create function public.dashboard_kpis(p_artist uuid default null, p_label uuid default null)
returns table (
  lifetime_gross numeric, lifetime_commission numeric, lifetime_net numeric,
  admin_only_lifetime numeric,
  current_period_start date, current_period_end date,
  current_period_net numeric, current_period_admin_only numeric,
  pending_net numeric, paid_net numeric,
  admin_only_fee numeric, admin_only_fee_open numeric
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
    coalesce(round(sum(net_payable)  filter (where royalty_type = 'publisher' and status = 'paid'), 2), 0),
    coalesce(round(sum(commission_amount) filter (where royalty_type = 'admin_only'), 2), 0),
    coalesce(round(sum(commission_amount) filter (where royalty_type = 'admin_only' and payment_id is null), 2), 0)
  from v
$$;
grant execute on function dashboard_kpis(uuid, uuid) to authenticated;
revoke execute on function dashboard_kpis(uuid, uuid) from anon, public;

-- breakdown gains 'licensee' (platform) and 'client'
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
      when 'licensee'  then coalesce(l.licensee, l.source)
      when 'client'    then coalesce(lb.name, a.stage_name, l.publisher_name, 'Not assigned')
      else 'all'
    end as bucket,
    coalesce(round(sum(l.gross_amount)      filter (where l.royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(l.commission_amount) filter (where l.royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(l.net_payable)       filter (where l.royalty_type = 'publisher'), 2), 0),
    coalesce(round(sum(l.gross_amount)      filter (where l.royalty_type = 'admin_only'), 2), 0)
  from royalty_lines l
  left join works   w  on w.id  = l.work_id
  left join labels  lb on lb.id = l.label_id
  left join artists a  on a.id  = l.artist_id
  where (p_from   is null or l.period_start >= p_from)
    and (p_to     is null or l.period_end   <= p_to)
    and (p_artist is null or l.artist_id = p_artist)
    and (p_label  is null or l.label_id  = p_label)
  group by 1
  order by 4 desc, 5 desc
$$;

-- royalty lines view: new columns appended at the end
create or replace view v_royalty_lines with (security_invoker = true) as
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
  w.iswc, l.statement_id, l.payment_id, l.created_at,
  l.licensee, l.publisher_name, l.raw_work_no, r.distribution_code
from royalty_lines l
left join artists a  on a.id  = l.artist_id
left join labels  lb on lb.id = l.label_id
left join works   w  on w.id  = l.work_id
left join royalty_reports r on r.id = l.report_id;

-- ---------------------------------------------------------------------
-- Private storage for the original statement files (Plutus team only)
-- ---------------------------------------------------------------------
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('royalty-reports', 'royalty-reports', false, 52428800)
    on conflict (id) do nothing;

    execute $p$
      create policy "report files: plutus team" on storage.objects
      for all to authenticated
      using (bucket_id = 'royalty-reports' and public.is_super_admin())
      with check (bucket_id = 'royalty-reports' and public.is_super_admin())
    $p$;
  end if;
end $storage$;
