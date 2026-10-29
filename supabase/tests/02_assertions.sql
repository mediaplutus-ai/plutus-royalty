set app.payout_key = 'local-test-key-only';
-- Automated checks: business math + who-can-see-what.
-- Every check raises an error (and stops the run) if the result is wrong.
create or replace function pg_temp.check(label text, got anyelement, expected anyelement) returns void
language plpgsql as $$
begin
  if got is distinct from expected then
    raise exception 'FAIL: % — got %, expected %', label, got, expected;
  end if;
  raise notice 'PASS: %', label;
end $$;

create or replace function pg_temp.login(uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid, true);
  execute 'set local role authenticated';
end $$;

-- ===================== 1. MONEY MATH (as postgres) =====================
select pg_temp.check('Ravi uses his personal 15% contract',
  (select commission_pct from royalty_lines where gross_amount = 10000), 15.00::numeric);
select pg_temp.check('Ravi net = 8500',
  (select net_payable from royalty_lines where gross_amount = 10000), 8500.0000::numeric);
select pg_temp.check('Meera falls back to label-wide 20%',
  (select commission_pct from royalty_lines where gross_amount = 5000), 20.00::numeric);
select pg_temp.check('Admin-only line: Plutus fee 25% of 7000 to invoice (Session 3 rule)',
  (select commission_amount from royalty_lines where gross_amount = 7000), 1750.0000::numeric);
select pg_temp.check('Admin-only line: net = gross',
  (select net_payable from royalty_lines where gross_amount = 7000), 7000::numeric);
select pg_temp.check('Admin-only line marked paid directly',
  (select status::text from royalty_lines where gross_amount = 7000), 'paid_directly');
select pg_temp.check('ISWC match ignores dashes/dots',
  (select match_status::text from royalty_lines where gross_amount = 10000), 'matched');
select pg_temp.check('ISRC match works',
  (select work_id::text from royalty_lines where gross_amount = 3000), '30000000-0000-0000-0000-000000000002');
select pg_temp.check('Unknown title stays unmatched',
  (select match_status::text from royalty_lines where gross_amount = 500), 'unmatched');
select pg_temp.check('IPRS report totals match -> processed',
  (select status::text from royalty_reports where source = 'IPRS'), 'processed');
select pg_temp.check('PRS report with unmatched line -> mismatch',
  (select status::text from royalty_reports where source = 'PRS'), 'mismatch');
select pg_temp.check('Mismatch alert sent to Super Admin',
  (select count(*) from notifications where type = 'data_mismatch'
     and user_id = '00000000-0000-0000-0000-000000000001'), 1::bigint);
select pg_temp.check('Ravi got "new royalties" + "statement ready" notifications',
  (select count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000004'), 2::bigint);
select pg_temp.check('Ravi statement net = 8500',
  (select total_net from statements where artist_id = '20000000-0000-0000-0000-000000000001'), 8500.00::numeric);
select pg_temp.check('Invoice payable = 8500 + 18% GST - 10% TDS = 9180',
  (select payable_amount from payments where invoice_no = 'PLT-2026-0001'), 9180.00::numeric);
select pg_temp.check('Bank account encrypted, last4 visible',
  (select bank_account_last4 from artists where stage_name = 'Ravi Sharma'), '9012');
select pg_temp.check('Bank account decrypts correctly (service role)',
  (select get_artist_bank_account('20000000-0000-0000-0000-000000000001')), '123456789012');
select pg_temp.check('Audit log recorded edits',
  (select count(*) > 10 from audit_logs), true);

-- Ownership over 100% must be rejected
do $$ begin
  begin
    insert into ownership (work_id, artist_id, role, share_pct)
    values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'arranger', 10);
    set constraints all immediate;
    raise exception 'FAIL: ownership above 100%% was accepted';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: ownership above 100%% rejected (%)', sqlerrm;
  end;
end $$;

-- ===================== 2. PAYMENT WORKFLOW =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');  -- super admin
do $$ begin
  begin
    update payments set status = 'paid' where invoice_no = 'PLT-2026-0001';
    raise exception 'FAIL: paid without approval';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: cannot pay before approval';
  end;
end $$;
update payments set status = 'approved' where invoice_no = 'PLT-2026-0001';
do $$ begin
  begin
    update payments set status = 'paid' where invoice_no = 'PLT-2026-0001';
    raise exception 'FAIL: paid without transaction id';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: transaction ID required';
  end;
end $$;
update payments set status = 'paid', payment_mode = 'neft', transaction_id = 'UTR123456'
 where invoice_no = 'PLT-2026-0001';
select pg_temp.check('Paying invoice settles Ravi''s royalty line',
  (select status::text from royalty_lines where gross_amount = 10000), 'paid');
select pg_temp.check('Approver recorded',
  (select approved_by::text from payments where invoice_no = 'PLT-2026-0001'), '00000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    update royalty_lines set gross_amount = 1 where gross_amount = 10000;
    raise exception 'FAIL: edited a paid line';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: paid lines are frozen';
  end;
end $$;
commit;

-- ===================== 3. WHO SEES WHAT =====================
-- Ravi (author/composer, Sunrise)
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select pg_temp.check('Ravi sees only his 1 royalty line', (select count(*) from royalty_lines), 1::bigint);
select pg_temp.check('Ravi sees only his own work', (select count(*) from works), 1::bigint);
select pg_temp.check('Ravi sees both splits on his work (transparency)', (select count(*) from ownership), 2::bigint);
select pg_temp.check('Ravi sees his personal contract only', (select count(*) from contracts), 1::bigint);
select pg_temp.check('Ravi sees no upload batches', (select count(*) from royalty_reports), 0::bigint);
select pg_temp.check('Ravi sees no audit logs', (select count(*) from audit_logs), 0::bigint);
select pg_temp.check('Ravi sees his paid invoice', (select count(*) from payments), 1::bigint);
select pg_temp.check('Ravi KPI lifetime net', (select lifetime_net from dashboard_kpis()), 8500.00::numeric);
select pg_temp.check('Ravi KPI paid', (select paid_net from dashboard_kpis()), 8500.00::numeric);
select pg_temp.check('Ravi KPI pending', (select pending_net from dashboard_kpis()), 0::numeric);
do $$ begin
  begin
    update contracts set commission_pct = 0;
    if exists (select 1 from contracts where commission_pct = 0) then
      raise exception 'FAIL: author edited contract';
    end if;
    raise notice 'PASS: author cannot edit contracts (0 rows changed)';
  end;
end $$;
do $$ begin
  begin
    update profiles set role = 'super_admin' where id = auth.uid();
    raise exception 'FAIL: author promoted himself';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: author cannot change own role';
  end;
end $$;
do $$ begin
  begin
    perform bank_account_enc from artists limit 1;
    raise exception 'FAIL: encrypted column readable';
  exception when insufficient_privilege then
    raise notice 'PASS: encrypted bank column hidden from API';
  end;
end $$;
rollback;

-- Meera (author/composer, Sunrise) — her invoice is still draft
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000005');
select pg_temp.check('Meera sees her 2 lines', (select count(*) from royalty_lines), 2::bigint);
select pg_temp.check('Meera does not see draft invoice', (select count(*) from payments), 0::bigint);
select pg_temp.check('Meera pending net 4000+2400', (select pending_net from dashboard_kpis()), 6400.00::numeric);
rollback;

-- Kabir (author/composer, Moonbeam) — admin-only royalties
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000006');
select pg_temp.check('Kabir sees his 2 admin-only lines', (select count(*) from royalty_lines), 2::bigint);
select pg_temp.check('Kabir admin-only total 7500', (select admin_only_lifetime from dashboard_kpis()), 7500.00::numeric);
select pg_temp.check('Kabir publisher net 0 (nothing collected by Plutus)', (select lifetime_net from dashboard_kpis()), 0::numeric);
rollback;

-- Sunrise label admin
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.check('Sunrise admin sees 3 Sunrise lines', (select count(*) from royalty_lines), 3::bigint);
select pg_temp.check('Sunrise admin sees 2 Sunrise artists', (select count(*) from artists), 2::bigint);
select pg_temp.check('Sunrise admin sees IPRS report only', (select count(*) from royalty_reports), 1::bigint);
select pg_temp.check('Sunrise admin cannot see Moonbeam works',
  (select count(*) from works where label_id = '10000000-0000-0000-0000-000000000002'), 0::bigint);
select pg_temp.check('Sunrise admin by source: IPRS only',
  (select string_agg(bucket, ',') from earnings_breakdown('source')), 'IPRS');
insert into works (label_id, title) values ('10000000-0000-0000-0000-000000000001', 'New Sunrise Song');
select pg_temp.check('Label admin can add a work to own label',
  (select count(*) from works where title = 'New Sunrise Song'), 1::bigint);
do $$ begin
  begin
    insert into works (label_id, title) values ('10000000-0000-0000-0000-000000000002', 'Sneaky');
    raise exception 'FAIL: label admin added work to other label';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: label admin blocked from other label';
  end;
end $$;
do $$ begin
  begin
    insert into royalty_lines (report_id, royalty_type, source, period_start, period_end, gross_amount)
    values ('40000000-0000-0000-0000-000000000001', 'publisher', 'IPRS', '2026-01-01', '2026-03-31', 99999);
    raise exception 'FAIL: label admin inserted royalties';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
    raise notice 'PASS: label admin cannot add royalty money';
  end;
end $$;
rollback;

-- Super admin sees all
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.check('Super admin sees all 5 lines', (select count(*) from royalty_lines), 5::bigint);
select pg_temp.check('Super admin sees audit log', (select count(*) > 0 from audit_logs), true);
select pg_temp.check('Super admin sees both invoices', (select count(*) from payments), 2::bigint);
rollback;

-- Anonymous visitor
begin;
set local role anon;
do $$ begin
  begin
    perform 1 from royalty_lines;
    raise exception 'FAIL: anon read royalties';
  exception when insufficient_privilege then
    raise notice 'PASS: anonymous visitors blocked';
  end;
end $$;
rollback;

select 'ALL CHECKS PASSED' as result;
