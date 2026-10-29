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
