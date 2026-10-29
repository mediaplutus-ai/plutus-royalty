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
