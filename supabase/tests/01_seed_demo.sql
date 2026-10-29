-- Demo data for local testing (fictional names). Runs as postgres (bypasses RLS).
set app.payout_key = 'local-test-key-only';

insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000001', 'admin@plutus.test',   '{"full_name":"Plutus Super Admin"}'),
 ('00000000-0000-0000-0000-000000000002', 'label@sunrise.test',  '{"full_name":"Sunrise Label Admin"}'),
 ('00000000-0000-0000-0000-000000000003', 'label@moonbeam.test', '{"full_name":"Moonbeam Label Admin"}'),
 ('00000000-0000-0000-0000-000000000004', 'ravi@writers.test',   '{"full_name":"Ravi Sharma"}'),
 ('00000000-0000-0000-0000-000000000005', 'meera@writers.test',  '{"full_name":"Meera Joshi"}'),
 ('00000000-0000-0000-0000-000000000006', 'kabir@writers.test',  '{"full_name":"Kabir Khan"}');

insert into labels (id, name, gstin) values
 ('10000000-0000-0000-0000-000000000001', 'Sunrise Records',  '09ABCDE1234F1Z5'),
 ('10000000-0000-0000-0000-000000000002', 'Moonbeam Music',   null);

-- Session 2: accounts without an invitation start switched off; the demo users are pre-approved
update profiles set is_active = true;

update profiles set role = 'super_admin' where id = '00000000-0000-0000-0000-000000000001';
update profiles set role = 'label_admin', label_id = '10000000-0000-0000-0000-000000000001' where id = '00000000-0000-0000-0000-000000000002';
update profiles set role = 'label_admin', label_id = '10000000-0000-0000-0000-000000000002' where id = '00000000-0000-0000-0000-000000000003';

-- Ravi & Meera: Sunrise. Kabir: Moonbeam. Ravi's login links by email automatically below.
insert into artists (id, label_id, stage_name, legal_name, email, ipi_number, society) values
 ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Ravi Sharma', 'Ravi Kumar Sharma', 'ravi@writers.test',  '00123456789', 'IPRS'),
 ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Meera Joshi', 'Meera Joshi',       'meera@writers.test', '00987654321', 'IPRS'),
 ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Kabir Khan',  'Kabir Khan',        'kabir@writers.test', '00555555555', 'PRS');
update artists a set user_id = u.id from auth.users u where lower(u.email) = lower(a.email);

select set_artist_bank_account('20000000-0000-0000-0000-000000000001', '123456789012', 'sbin0001234', 'State Bank of India');

insert into works (id, label_id, title, iswc, isrc, status) values
 ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Saawan Ki Raat', 'T-123.456.789-0', '{INABC2600001}', 'registered'),
 ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Pehli Baarish',  null,              '{INABC2600002}', 'registered'),
 ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'Neon Nights',    'T-987.654.321-0', '{GBXYZ2600001}', 'submitted');

insert into ownership (work_id, artist_id, role, share_pct) values
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'composer', 50),
 ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'author',   50),
 ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'composer_author', 100),
 ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'composer_author', 100);

-- Sunrise label-wide 20%, but Ravi has a personal 15% deal; Moonbeam 25%
insert into contracts (label_id, artist_id, contract_type, commission_pct, effective_date, territories) values
 ('10000000-0000-0000-0000-000000000001', null,                                   'publishing',     20, '2025-01-01', '{WORLD}'),
 ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'publishing',     15, '2025-06-01', '{WORLD}'),
 ('10000000-0000-0000-0000-000000000002', null,                                   'administration', 25, '2025-01-01', '{WORLD}');

-- Report 1: IPRS Q1 2026, publisher-collected
insert into royalty_reports (id, label_id, source, royalty_type, period_start, period_end, file_name, uploaded_by, declared_total)
values ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'IPRS', 'publisher',
        '2026-01-01', '2026-03-31', 'IPRS_Q1_2026.xlsx', '00000000-0000-0000-0000-000000000001', 18000);

insert into royalty_lines (report_id, royalty_type, artist_id, source, territory, period_start, period_end, usage_type, gross_amount, raw_title, raw_iswc, raw_isrc) values
 ('40000000-0000-0000-0000-000000000001', 'publisher', '20000000-0000-0000-0000-000000000001', 'IPRS', 'IN', '2026-01-01', '2026-03-31', 'performance', 10000, 'SAAWAN KI RAAT', 'T1234567890', null),
 ('40000000-0000-0000-0000-000000000001', 'publisher', '20000000-0000-0000-0000-000000000002', 'IPRS', 'IN', '2026-01-01', '2026-03-31', 'performance',  5000, 'Saawan Ki Raat', null, null),
 ('40000000-0000-0000-0000-000000000001', 'publisher', '20000000-0000-0000-0000-000000000002', 'IPRS', 'IN', '2026-01-01', '2026-03-31', 'mechanical',   3000, 'Pehli Baarish', null, 'INABC2600002');

select finalize_report('40000000-0000-0000-0000-000000000001');

-- Report 2: PRS Q1 2026, paid directly to Kabir (admin-only) + one unmatched title
insert into royalty_reports (id, label_id, source, royalty_type, period_start, period_end, file_name, uploaded_by)
values ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'PRS', 'admin_only',
        '2026-01-01', '2026-03-31', 'PRS_Q1_2026.csv', '00000000-0000-0000-0000-000000000001');

insert into royalty_lines (report_id, royalty_type, artist_id, source, territory, period_start, period_end, usage_type, gross_amount, raw_title) values
 ('40000000-0000-0000-0000-000000000002', 'admin_only', '20000000-0000-0000-0000-000000000003', 'PRS', 'GB', '2026-01-01', '2026-03-31', 'performance', 7000, 'Neon Nights'),
 ('40000000-0000-0000-0000-000000000002', 'admin_only', '20000000-0000-0000-0000-000000000003', 'PRS', 'GB', '2026-01-01', '2026-03-31', 'performance',  500, 'Unknown Song XYZ');

select finalize_report('40000000-0000-0000-0000-000000000002');

-- Statement + invoice for Ravi
select generate_statement('20000000-0000-0000-0000-000000000001', 'quarterly', '2026-01-01', '2026-03-31');
select publish_statement(id) from statements where artist_id = '20000000-0000-0000-0000-000000000001';

insert into payments (invoice_no, artist_id, label_id, statement_id, period_start, period_end, amount, gst_pct, tds_pct, status, requested_by)
select 'PLT-2026-0001', artist_id, label_id, id, period_start, period_end, total_net, 18, 10, 'pending_approval', '00000000-0000-0000-0000-000000000001'
from statements where artist_id = '20000000-0000-0000-0000-000000000001';

-- Meera's invoice stays draft (should be invisible to her)
insert into payments (invoice_no, artist_id, label_id, period_start, period_end, amount, status)
values ('PLT-2026-0002', '20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '2026-01-01', '2026-03-31', 6400, 'draft');
