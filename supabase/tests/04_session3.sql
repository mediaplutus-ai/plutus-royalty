-- Session 3 checks: default commission, client commission, Plutus fee on direct
-- royalties, IPRS import, publish-before-clients-see.
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

create or replace function pg_temp.expect_error(label text, stmt text, fragment text default null) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if fragment is not null and position(lower(fragment) in lower(sqlerrm)) = 0 then
      raise exception 'FAIL: % — wrong error: %', label, sqlerrm;
    end if;
    raise notice 'PASS: % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL: % — no error was raised', label;
end $$;

-- ===================== names =====================
select pg_temp.check('Name match: Private Limited = PVT LTD',
  norm_name('Fatafat Digital Private Limited') = norm_name('FATAFAT DIGITAL PVT LTD,'), true);
select pg_temp.check('Name match: LLP and punctuation ignored',
  norm_name('ISHQPURA07 FILMS LLP'), 'ISHQPURA07 FILMS');

-- ===================== default commission =====================
select pg_temp.check('Default commission starts at 15', default_commission(), 15::numeric);

-- A new client label with no contract
insert into labels (id, name) values ('10000000-0000-0000-0000-000000000003', 'Bang Music Pvt Ltd');
select pg_temp.check('Label found by statement name variant',
  label_for_name('BANG MUSIC PRIVATE LIMITED')::text, '10000000-0000-0000-0000-000000000003');

-- ===================== IPRS import =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');   -- writer
select pg_temp.expect_error('Writer cannot import statements',
  $q$select import_iprs_report('{"period_start":"2026-01-01","period_end":"2026-03-31"}',
     '[{"workNo":"1","title":"X","amount":1}]')$q$, 'super admin');
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');   -- Plutus
select import_iprs_report(
  '{"file_name":"P2632~4228747~PLUTUS MEDIA.xlsx","file_sha256":"abc123","period_start":"2026-01-01",
    "period_end":"2026-03-31","royalty_type":"publisher","declared_total":1700,"distribution_code":"P2632",
    "create_missing_works":true,
    "clients":[{"name":"SUNRISE MUSIC LTD","label_id":"10000000-0000-0000-0000-000000000001"}]}',
  '[{"workNo":"20822711","title":"BAS KAR","language":"PUNJABI","publisher":"BANG MUSIC PVT LTD","licensee":"SPOTIFY AB","pool":"INTERNET WEBSITE","amount":1000},
    {"workNo":"20822711","title":"BAS KAR","language":"PUNJABI","publisher":"BANG MUSIC PVT LTD","licensee":"AIRTEL","pool":"INTERNET WEBSITE","amount":500},
    {"workNo":"28469312","title":"SAAWAN KI RAAT","language":"HINDI","publisher":"SUNRISE MUSIC LTD","licensee":"PLUTUS MEDIA-OCT","pool":"INTERNET WEBSITE","amount":200},
    {"workNo":"99","title":"ZERO","publisher":"BANG MUSIC PVT LTD","amount":0}]') as rid \gset
commit;

select pg_temp.check('Import: zero lines skipped, 3 lines stored',
  (select row_count from royalty_reports where id = :'rid'), 3);
select pg_temp.check('Import: total matches statement -> processed',
  (select status::text from royalty_reports where id = :'rid'), 'processed');
select pg_temp.check('Import: new work added with IPRS work number',
  (select label_id::text from works where iprs_work_no = '20822711'), '10000000-0000-0000-0000-000000000003');
select pg_temp.check('Import: existing work (same title + label) got the IPRS number, no duplicate',
  (select count(*) from works where lower(title) = 'saawan ki raat'), 1::bigint);
select pg_temp.check('Import: existing work linked by IPRS number',
  (select iprs_work_no from works where id = '30000000-0000-0000-0000-000000000001'), '28469312');
select pg_temp.check('Import: alias saved for the label',
  (select 'SUNRISE MUSIC LTD' = any(aliases) from labels where id = '10000000-0000-0000-0000-000000000001'), true);
select pg_temp.check('Import: label without contract uses default 15%',
  (select commission_pct from royalty_lines where report_id = :'rid' and licensee = 'SPOTIFY AB'), 15.00::numeric);
select pg_temp.check('Import: 15% of 1000 = 150 commission, 850 net',
  (select commission_amount::text || '/' || net_payable::text from royalty_lines where report_id = :'rid' and licensee = 'SPOTIFY AB'),
  '150.0000/850.0000');
select pg_temp.check('Import: Sunrise label-wide contract 20% applies',
  (select commission_pct from royalty_lines where report_id = :'rid' and licensee = 'PLUTUS MEDIA-OCT'), 20.00::numeric);
select pg_temp.check('Import: all lines matched to work and client',
  (select count(*) from royalty_lines where report_id = :'rid' and match_status = 'matched'), 3::bigint);

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('Same file twice is refused',
  $q$select import_iprs_report('{"file_sha256":"abc123","period_start":"2026-01-01","period_end":"2026-03-31"}',
     '[{"workNo":"1","title":"X","amount":1}]')$q$, 'already imported');
rollback;

-- ===================== publish before clients see =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000002');   -- Sunrise admin
select pg_temp.check('Unpublished import hidden from the label',
  (select count(*) from royalty_lines where report_id = :'rid'), 0::bigint);
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('Writer cannot publish', format($q$select publish_report('%s')$q$, :'rid'), 'super admin');
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select publish_report(:'rid');
commit;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.check('After publishing the label sees its own line only',
  (select count(*) from royalty_lines where report_id = :'rid'), 1::bigint);
rollback;
select pg_temp.check('Label admin told about new royalties on publish',
  (select count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000002'
     and type = 'report_uploaded'), 2::bigint);

-- ===================== client commission quick edit =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('Writer cannot change commission',
  $q$select set_client_commission('10000000-0000-0000-0000-000000000003', null, 5)$q$, 'super admin');
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.check('Set Bang Music to 12% re-calculates its 2 open lines',
  (select set_client_commission('10000000-0000-0000-0000-000000000003', null, 12)), 2);
commit;
select pg_temp.check('Bang Music line now 12%: 120 commission, 880 net',
  (select commission_amount::text || '/' || net_payable::text from royalty_lines where report_id = :'rid' and licensee = 'SPOTIFY AB'),
  '120.0000/880.0000');
select pg_temp.check('A contract was created for Bang Music',
  (select contract_type::text || ' ' || commission_pct::text from contracts where label_id = '10000000-0000-0000-0000-000000000003'),
  'sub_publishing 12.00');

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select set_client_commission('10000000-0000-0000-0000-000000000003', null, 10);
commit;
select pg_temp.check('Second change updates the same contract (no duplicates)',
  (select count(*)::text || ' ' || max(commission_pct)::text from contracts where label_id = '10000000-0000-0000-0000-000000000003'), '1 10.00');

-- paid lines never change: Ravi's 10000 line was paid in the seed? mark it paid now and try
update royalty_lines set status = 'paid' where gross_amount = 10000;
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select set_client_commission(null, '20000000-0000-0000-0000-000000000001', 30);
commit;
select pg_temp.check('Paid line keeps its old 15%',
  (select commission_pct from royalty_lines where gross_amount = 10000), 15.00::numeric);
select pg_temp.check('Ravi personal contract updated to 30',
  (select commission_pct from contracts where artist_id = '20000000-0000-0000-0000-000000000001'), 30.00::numeric);

-- ===================== Plutus fee on royalties paid directly =====================
select pg_temp.check('Directly-paid royalty: holder keeps everything (net = gross)',
  (select net_payable from royalty_lines where gross_amount = 7000), 7000.0000::numeric);
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select set_client_commission(null, '20000000-0000-0000-0000-000000000003', 18);   -- Kabir personal deal
commit;
select pg_temp.check('Directly-paid royalty: fee follows Kabir''s new 18% (1260)',
  (select commission_amount from royalty_lines where gross_amount = 7000), 1260.0000::numeric);
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000006');   -- Kabir sees his fee
select pg_temp.check('Kabir sees fee to be invoiced 1260 + 90',
  (select admin_only_fee_open from dashboard_kpis()), 1350.00::numeric);
rollback;

-- once the fee is on an invoice, it is frozen
update royalty_lines set payment_id = (select id from payments where invoice_no = 'PLT-2026-0002') where gross_amount = 7000;
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select set_client_commission(null, '20000000-0000-0000-0000-000000000003', 5);
commit;
select pg_temp.check('Invoiced fee does not change any more',
  (select commission_amount from royalty_lines where gross_amount = 7000), 1260.0000::numeric);
select pg_temp.check('Not-yet-invoiced fee follows the new 5% (25)',
  (select commission_amount from royalty_lines where gross_amount = 500 and royalty_type = 'admin_only'), 25.0000::numeric);

-- ===================== default commission change =====================
insert into labels (id, name) values ('10000000-0000-0000-0000-000000000004', 'Best Records');
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select import_iprs_report(
  '{"file_name":"P2633.xlsx","file_sha256":"def456","period_start":"2026-04-01","period_end":"2026-06-30","create_missing_works":true}',
  '[{"workNo":"777","title":"BEST SONG","publisher":"BEST RECORDS","licensee":"AIRTEL","amount":1000}]') as rid2 \gset
select pg_temp.check('Default set to 20 re-calculates the line of a client without contract',
  (select set_default_commission(20) >= 1), true);
commit;
select pg_temp.check('Best Records line now uses default 20%',
  (select commission_pct from royalty_lines where report_id = :'rid2'), 20.00::numeric);
select pg_temp.check('Bang Music keeps its own 10% contract',
  (select commission_pct from royalty_lines where report_id = :'rid' and licensee = 'SPOTIFY AB'), 10.00::numeric);

-- ===================== commission panel list =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.check('Panel lists Best Records on default 20',
  (select commission_pct::text || ' ' || is_default::text from client_commission_list() where name = 'Best Records'), '20 true');
select pg_temp.check('Panel lists Bang Music on its own 10',
  (select commission_pct::text || ' ' || is_default::text from client_commission_list() where name = 'Bang Music Pvt Ltd'), '10.00 false');
rollback;

-- ===================== unpublish / delete =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('Published report cannot be deleted', format($q$select delete_report('%s')$q$, :'rid'), 'unpublish');
select delete_report(:'rid2');
select pg_temp.check('Unpublished report deleted with its lines',
  (select count(*) from royalty_lines where report_id = :'rid2'), 0::bigint);
rollback;

-- unmatched client -> mismatch, Plutus alerted
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select import_iprs_report(
  '{"file_name":"P2634.xlsx","file_sha256":"ghi789","period_start":"2026-07-01","period_end":"2026-09-30","create_missing_works":false}',
  '[{"workNo":"555","title":"NEW UNKNOWN","publisher":"SOMEONE NEW MUSIC","amount":300}]') as rid3 \gset
commit;
select pg_temp.check('Unknown client and work -> needs checking',
  (select status::text || ' ' || unmatched_count from royalty_reports where id = :'rid3'), 'mismatch 1');
select pg_temp.check('Plutus told to check before publishing',
  (select count(*) from notifications where title like 'Check before publishing: IPRS%'), 1::bigint);

select 'SESSION 3 CHECKS PASSED' as result;
