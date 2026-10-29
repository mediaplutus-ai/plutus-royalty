-- Session 2 checks: invitations, work submissions, save_work, register_submission.
-- Runs after 01_seed_demo.sql and 02_assertions.sql. Every check stops the run if wrong.
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

-- ===================== INVITATIONS =====================
-- A new Sunrise writer exists in the catalog but has no login yet
insert into artists (id, label_id, stage_name, email, ipi_number, society) values
 ('20000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'Asha Rao', 'asha@writers.test', '00111222333', 'IPRS');

-- Sunrise label admin invites Asha
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000002');
insert into invitations (id, email, full_name, role, label_id, artist_id) values
 ('50000000-0000-0000-0000-000000000001', 'Asha@Writers.test', 'Asha Rao', 'author_composer',
  '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000009');
select pg_temp.check('Label admin sees own invitation', (select count(*) from invitations), 1::bigint);
select pg_temp.expect_error('Label admin cannot invite another label admin',
  $q$insert into invitations (email, role, label_id) values ('x@y.test', 'label_admin', '10000000-0000-0000-0000-000000000001')$q$);
select pg_temp.expect_error('Label admin cannot invite for another label',
  $q$insert into invitations (email, role, label_id) values ('x@y.test', 'author_composer', '10000000-0000-0000-0000-000000000002')$q$);
select pg_temp.expect_error('Label admin cannot link an artist of another label',
  $q$insert into invitations (email, role, label_id, artist_id) values ('x@y.test', 'author_composer',
      '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003')$q$);
commit;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000003');
select pg_temp.check('Moonbeam admin cannot see Sunrise invitations', (select count(*) from invitations), 0::bigint);
rollback;

select token as asha_token from invitations where id = '50000000-0000-0000-0000-000000000001' \gset
begin;
set local role anon;
select pg_temp.check('Join page preview works for a visitor',
  (select email || '|' || role::text || '|' || label_name || '|' || is_valid::text
     from invitation_preview(:'asha_token')),
  'Asha@Writers.test|author_composer|Sunrise Records|true');
select pg_temp.check('Unknown token shows nothing', (select count(*) from invitation_preview('nope')), 0::bigint);
rollback;

-- Sign-up WITHOUT invitation stays switched off
insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000000020', 'stranger@spam.test');
select pg_temp.check('Sign-up without invitation is switched off',
  (select is_active from profiles where id = '00000000-0000-0000-0000-000000000020'), false);

-- Right email, wrong token -> still off
insert into auth.users (id, email, raw_user_meta_data) values
 ('00000000-0000-0000-0000-000000000021', 'mallory@spam.test', '{"invite_token":"guessing"}');
select pg_temp.check('Wrong token is switched off',
  (select is_active from profiles where id = '00000000-0000-0000-0000-000000000021'), false);

-- Someone else using Asha's token with another email -> off, invitation untouched
insert into auth.users (id, email, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000022', 'thief@spam.test',
       jsonb_build_object('invite_token', token) from invitations where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check('Token used with a different email does not work',
  (select is_active from profiles where id = '00000000-0000-0000-0000-000000000022'), false);
select pg_temp.check('Invitation still open after misuse',
  (select accepted_at is null from invitations where id = '50000000-0000-0000-0000-000000000001'), true);

-- Asha accepts with the right token (email case differs on purpose)
insert into auth.users (id, email, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000009', 'asha@writers.test',
       jsonb_build_object('invite_token', token) from invitations where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check('Invited writer is switched on',
  (select is_active from profiles where id = '00000000-0000-0000-0000-000000000009'), true);
select pg_temp.check('Invited writer gets the invited role',
  (select role::text from profiles where id = '00000000-0000-0000-0000-000000000009'), 'author_composer');
select pg_temp.check('Invited writer linked to her artist record',
  (select user_id::text from artists where id = '20000000-0000-0000-0000-000000000009'), '00000000-0000-0000-0000-000000000009');
select pg_temp.check('Invitation marked accepted',
  (select accepted_user::text from invitations where id = '50000000-0000-0000-0000-000000000001'), '00000000-0000-0000-0000-000000000009');
select pg_temp.check('Inviter told that the invitation was accepted',
  (select count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000002'
     and title like '%accepted the invitation'), 1::bigint);

-- A used token cannot be used again
insert into auth.users (id, email, raw_user_meta_data)
select '00000000-0000-0000-0000-000000000023', 'asha@writers.test.other',
       jsonb_build_object('invite_token', token) from invitations where id = '50000000-0000-0000-0000-000000000001';
select pg_temp.check('Used invitation cannot be reused',
  (select is_active from profiles where id = '00000000-0000-0000-0000-000000000023'), false);

-- Super Admin can invite a label admin
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
insert into invitations (email, role, label_id) values ('boss@moonbeam.test', 'label_admin', '10000000-0000-0000-0000-000000000002');
select pg_temp.check('Super admin invited a label admin', (select count(*) from invitations where role = 'label_admin'), 1::bigint);
rollback;

-- ===================== SAVE WORK (works + ownership together) =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000002');   -- Sunrise label admin
select pg_temp.check('Label admin creates a work with two owners',
  (select save_work(
     '{"title":"Barsaat Mein","isrc":["inabc2600009"," "],"status":"draft","label_id":"10000000-0000-0000-0000-000000000002"}',
     '[{"artist_id":"20000000-0000-0000-0000-000000000001","role":"composer","share_pct":60},
       {"artist_id":"20000000-0000-0000-0000-000000000002","role":"author","share_pct":40}]') is not null), true);
select pg_temp.check('Label is forced to the admin''s own label',
  (select label_id::text from works where title = 'Barsaat Mein'), '10000000-0000-0000-0000-000000000001');
select pg_temp.check('ISRC cleaned to upper case, blanks dropped',
  (select isrc from works where title = 'Barsaat Mein'), '{INABC2600009}'::text[]);
select pg_temp.check('Two ownership rows saved',
  (select count(*) from ownership o join works w on w.id = o.work_id where w.title = 'Barsaat Mein'), 2::bigint);
select pg_temp.expect_error('Shares over 100 percent rejected on save',
  format($q$select save_work('{"id":"%s","title":"Barsaat Mein"}',
     '[{"artist_id":"20000000-0000-0000-0000-000000000001","role":"composer","share_pct":70},
       {"artist_id":"20000000-0000-0000-0000-000000000002","role":"author","share_pct":40}]')$q$,
     (select id from works where title = 'Barsaat Mein')), '100 percent');
select pg_temp.check('Failed save left the old split in place',
  (select sum(share_pct) from ownership o join works w on w.id = o.work_id where w.title = 'Barsaat Mein'), 100.000::numeric);
select pg_temp.check('Edit: owner split changed to 100 for one writer',
  (select save_work(jsonb_build_object('id', (select id from works where title = 'Barsaat Mein'), 'title', 'Barsaat Mein'),
     '[{"artist_id":"20000000-0000-0000-0000-000000000001","role":"composer_author","share_pct":100}]') is not null), true);
select pg_temp.check('Edit kept only the new owner',
  (select count(*) from ownership o join works w on w.id = o.work_id where w.title = 'Barsaat Mein'), 1::bigint);
select pg_temp.expect_error('Label admin cannot edit another label''s work',
  $q$select save_work('{"id":"30000000-0000-0000-0000-000000000003","title":"Hacked"}', '[]')$q$);
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');   -- Ravi, writer
select pg_temp.expect_error('Writer cannot edit the catalog directly',
  $q$select save_work('{"title":"My own song"}', '[]')$q$, 'label admin');
rollback;

-- ===================== WORK SUBMISSIONS =====================
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');   -- Ravi submits
insert into work_submissions (id, title, language, isrc, writers, status, iswc)
values ('60000000-0000-0000-0000-000000000001', 'Dil Ki Baat', 'Hindi', '{INABC2600010}',
  '[{"name":"Ravi Sharma","ipi":"00123456789","role":"composer","share_pct":50,"artist_id":"20000000-0000-0000-0000-000000000001"},
    {"name":"New Lyricist","ipi":"00444444444","role":"author","share_pct":50}]',
  'registered', 'T-000.000.001-0');
select pg_temp.check('Writer cannot self-register: status forced to submitted',
  (select status::text from work_submissions where id = '60000000-0000-0000-0000-000000000001'), 'submitted');
select pg_temp.check('Writer cannot set an ISWC', (select iswc from work_submissions where id = '60000000-0000-0000-0000-000000000001'), null::text);
select pg_temp.check('Submission gets the writer''s label',
  (select label_id::text from work_submissions where id = '60000000-0000-0000-0000-000000000001'), '10000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('Writer shares over 100 percent rejected',
  $q$insert into work_submissions (title, writers) values ('Too Much',
     '[{"name":"A","share_pct":80},{"name":"B","share_pct":30}]')$q$, '100 percent');
select pg_temp.expect_error('Cannot attach someone else''s file',
  $q$insert into work_submissions (title, writers, files) values ('Sneaky',
     '[{"name":"A","share_pct":100}]', '{00000000-0000-0000-0000-000000000005/x/song.mp3}')$q$, 'own uploads');
select pg_temp.expect_error('Cannot sneak a path with ..',
  $q$insert into work_submissions (title, writers, files) values ('Sneaky2',
     '[{"name":"A","share_pct":100}]', '{00000000-0000-0000-0000-000000000004/../00000000-0000-0000-0000-000000000005/a.mp3}')$q$, 'own uploads');
insert into work_submissions (id, title, writers, files) values ('60000000-0000-0000-0000-000000000003', 'With File',
  '[{"name":"Ravi Sharma","share_pct":100}]', '{00000000-0000-0000-0000-000000000004/a/lyrics.pdf}');
select pg_temp.check('Own uploaded file accepted',
  (select array_length(files, 1) from work_submissions where id = '60000000-0000-0000-0000-000000000003'), 1);
select pg_temp.expect_error('Cannot add someone else''s file on edit',
  $q$update work_submissions set files = files || '{00000000-0000-0000-0000-000000000005/x/song.mp3}'::text[]
     where id = '60000000-0000-0000-0000-000000000003'$q$, 'own uploads');
delete from work_submissions where id = '60000000-0000-0000-0000-000000000003';
select pg_temp.expect_error('A submission needs at least one writer',
  $q$insert into work_submissions (title, writers) values ('Nobody', '[]')$q$, 'at least one');
commit;

select pg_temp.check('Super admin notified of new submission',
  (select count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000001'
     and title = 'New work submitted: Dil Ki Baat'), 1::bigint);

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000005');   -- Meera
select pg_temp.check('Another writer cannot see it', (select count(*) from work_submissions), 0::bigint);
rollback;
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000002');   -- Sunrise admin
select pg_temp.check('Writer''s label admin can see it', (select count(*) from work_submissions), 1::bigint);
rollback;
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000003');   -- Moonbeam admin
select pg_temp.check('Other label admin cannot see it', (select count(*) from work_submissions), 0::bigint);
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000020');   -- switched-off stranger
select pg_temp.expect_error('Switched-off account cannot submit',
  $q$insert into work_submissions (title, writers) values ('Spam', '[{"name":"Spam","share_pct":100}]')$q$);
rollback;

-- Plutus starts the review
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
update work_submissions set status = 'under_review' where id = '60000000-0000-0000-0000-000000000001';
commit;
select pg_temp.check('Writer told the review started',
  (select count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000004'
     and title = 'Plutus is reviewing Dil Ki Baat'), 1::bigint);

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('Writer cannot edit while under review',
  $q$update work_submissions set title = 'Changed' where id = '60000000-0000-0000-0000-000000000001'$q$, 'being reviewed');
delete from work_submissions where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.check('Writer cannot withdraw while under review (row still there)',
  (select count(*) from work_submissions where id = '60000000-0000-0000-0000-000000000001'), 1::bigint);
rollback;

-- Needs changes -> writer edits -> back to submitted
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
update work_submissions set status = 'needs_changes', reviewer_note = 'Please add the lyricist IPI'
where id = '60000000-0000-0000-0000-000000000001';
commit;
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
update work_submissions set notes = 'IPI added', status = 'registered' where id = '60000000-0000-0000-0000-000000000001';
select pg_temp.check('Writer edit re-submits it',
  (select status::text from work_submissions where id = '60000000-0000-0000-0000-000000000001'), 'submitted');
select pg_temp.check('Reviewer note kept for the writer',
  (select reviewer_note from work_submissions where id = '60000000-0000-0000-0000-000000000001'), 'Please add the lyricist IPI');
commit;

-- Register with IPRS
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select pg_temp.expect_error('Writer cannot register a work',
  $q$select register_submission('60000000-0000-0000-0000-000000000001', 'T-111.222.333-4')$q$, 'super admin');
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('Duplicate ISWC refused',
  $q$select register_submission('60000000-0000-0000-0000-000000000001', 'T1234567890')$q$, 'already used');
select pg_temp.check('Super admin registers the work',
  (select register_submission('60000000-0000-0000-0000-000000000001', 't-111.222.333-4') is not null), true);
commit;

select pg_temp.check('Submission is registered with its ISWC',
  (select status::text || ' ' || iswc from work_submissions where id = '60000000-0000-0000-0000-000000000001'),
  'registered T-111.222.333-4');
select pg_temp.check('Catalog work created as registered',
  (select status::text from works where title = 'Dil Ki Baat'), 'registered');
select pg_temp.check('Existing writer reused (Ravi has 50 percent)',
  (select share_pct from ownership o join works w on w.id = o.work_id
    where w.title = 'Dil Ki Baat' and o.artist_id = '20000000-0000-0000-0000-000000000001'), 50.000::numeric);
select pg_temp.check('Unknown lyricist added as a new rights holder',
  (select count(*) from artists where stage_name = 'New Lyricist' and ipi_number = '00444444444'
     and label_id = '10000000-0000-0000-0000-000000000001'), 1::bigint);
select pg_temp.check('Writer told it is registered',
  (select count(*) from notifications where user_id = '00000000-0000-0000-0000-000000000004'
     and title = 'Dil Ki Baat is registered with IPRS'), 1::bigint);

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select pg_temp.check('Writer now sees the registered work in his catalog',
  (select count(*) from works where title = 'Dil Ki Baat'), 1::bigint);
rollback;

begin;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('Cannot register twice',
  $q$select register_submission('60000000-0000-0000-0000-000000000001', 'T-555.555.555-5')$q$, 'already registered');
rollback;

-- Withdraw while still submitted
begin;
select pg_temp.login('00000000-0000-0000-0000-000000000005');   -- Meera
insert into work_submissions (id, title, writers) values ('60000000-0000-0000-0000-000000000002', 'Draft Song',
  '[{"name":"Meera Joshi","share_pct":100}]');
delete from work_submissions where id = '60000000-0000-0000-0000-000000000002';
select pg_temp.check('Writer can withdraw before review', (select count(*) from work_submissions where id = '60000000-0000-0000-0000-000000000002'), 0::bigint);
rollback;

begin;
set local role anon;
do $$ begin
  begin
    perform 1 from work_submissions;
    raise exception 'FAIL: anon read submissions';
  exception when insufficient_privilege then
    raise notice 'PASS: anonymous visitors cannot read submissions or invitations';
  end;
end $$;
rollback;

select 'SESSION 2 CHECKS PASSED' as result;
