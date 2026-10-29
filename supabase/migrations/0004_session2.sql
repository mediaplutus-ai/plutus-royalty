-- =====================================================================
-- Plutus Media — Royalty Dashboard
-- Migration 0004 (Session 2): invitations, work submissions,
-- one-step save for works + ownership, registration of submitted works.
--
-- Sign-up model (free, no email server needed):
--   * A Super Admin (or a Label Admin, for writers of his/her label) creates
--     an invitation. The app shows a private link /join/<token>.
--   * Plutus sends that link to the person (WhatsApp / own email).
--   * The person sets a password on that page. Only a valid, unused,
--     unexpired token for the same email turns the account on.
--   * Any account created without a valid invitation stays switched off.
-- =====================================================================

-- ---------------------------------------------------------------------
-- INVITATIONS
-- ---------------------------------------------------------------------
create table invitations (
  id             uuid primary key default gen_random_uuid(),
  email          text not null,
  full_name      text,
  role           app_role not null default 'author_composer',
  label_id       uuid references labels(id) on delete cascade,
  artist_id      uuid references artists(id) on delete set null,
  -- 64 hex characters from two random UUIDs (~244 random bits)
  token          text not null unique
                 default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  invited_by     uuid references profiles(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '14 days',
  accepted_at    timestamptz,
  accepted_user  uuid references profiles(id) on delete set null,
  revoked_at     timestamptz,
  constraint invite_label_admin_needs_label check (role <> 'label_admin' or label_id is not null),
  constraint invite_email_format check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')
);
create unique index invitations_open_email_uq on invitations (lower(email))
  where accepted_at is null and revoked_at is null;
create index on invitations (label_id);

alter table invitations enable row level security;
revoke all on invitations from anon;

create policy invitations_read on invitations for select to authenticated using (
  is_super_admin() or (my_label_id() is not null and label_id = my_label_id())
);
-- Label admins may invite only writers (author_composer) of their own label
create policy invitations_insert on invitations for insert to authenticated with check (
  is_super_admin()
  or (my_label_id() is not null
      and label_id = my_label_id()
      and role = 'author_composer'
      and (artist_id is null or artist_id in (select id from artists where label_id = my_label_id())))
);
create policy invitations_update on invitations for update to authenticated
  using      (is_super_admin() or (my_label_id() is not null and label_id = my_label_id()))
  with check (is_super_admin() or (my_label_id() is not null and label_id = my_label_id() and role = 'author_composer'));
create policy invitations_delete on invitations for delete to authenticated using (is_super_admin());

-- Shown on the public /join page before the person has an account
create or replace function public.invitation_preview(p_token text)
returns table (email text, full_name text, role app_role, label_name text, is_valid boolean)
language sql stable security definer set search_path = public as $$
  select i.email, i.full_name, i.role, l.name,
         (i.accepted_at is null and i.revoked_at is null and i.expires_at > now())
  from invitations i
  left join labels l on l.id = i.label_id
  where i.token = p_token
  limit 1
$$;
revoke execute on function invitation_preview(text) from public;
grant  execute on function invitation_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------
-- New login -> profile row (replaces the Session 1 version).
-- A valid invitation sets role / label / artist link and switches the
-- account on. Without one the account exists but stays switched off.
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invitations;
begin
  select * into inv from invitations
  where token = coalesce(new.raw_user_meta_data->>'invite_token', '')
    and lower(email) = lower(new.email)
    and accepted_at is null and revoked_at is null and expires_at > now()
  limit 1;

  insert into profiles (id, email, full_name, role, label_id, is_active)
  values (new.id, new.email,
          coalesce(nullif(inv.full_name, ''), new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
          coalesce(inv.role, 'author_composer'),
          inv.label_id,
          inv.id is not null)
  on conflict (id) do nothing;

  if inv.id is not null then
    update invitations set accepted_at = now(), accepted_user = new.id where id = inv.id;

    if inv.artist_id is not null then
      update artists set user_id = new.id where id = inv.artist_id and user_id is null;
    else
      update artists set user_id = new.id
      where user_id is null and lower(email) = lower(new.email);
    end if;

    perform notify_users(array[inv.invited_by], 'system',
      coalesce(nullif(inv.full_name, ''), new.email) || ' accepted the invitation',
      'They can now sign in to the dashboard.', '/people');
  end if;

  return new;
end $$;

-- ---------------------------------------------------------------------
-- WORKS + OWNERSHIP in one step (all-or-nothing).
-- SECURITY INVOKER: the caller's row-level security still decides
-- (Super Admin: any work; Label Admin: own label only).
--
-- p_work   : {id?, title, iswc, isrc[], language, genre, release_date,
--             territories[], status, notes, label_id}
-- p_owners : [{artist_id, role, share_pct, territory}]
-- ---------------------------------------------------------------------
create or replace function public.save_work(p_work jsonb, p_owners jsonb)
returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_id    uuid := nullif(p_work->>'id', '')::uuid;
  v_label uuid := nullif(p_work->>'label_id', '')::uuid;
  v_iswc  text := nullif(upper(trim(p_work->>'iswc')), '');
  v_isrc  text[];
begin
  if my_role() not in ('super_admin', 'label_admin') then
    raise exception 'Only Plutus or a label admin can edit the catalog';
  end if;
  if coalesce(trim(p_work->>'title'), '') = '' then
    raise exception 'Song title is required';
  end if;
  if not is_super_admin() then
    v_label := my_label_id();
  end if;

  select coalesce(array_agg(distinct upper(trim(x))) filter (where trim(x) <> ''), '{}')
    into v_isrc
  from jsonb_array_elements_text(coalesce(p_work->'isrc', '[]'::jsonb)) as x;

  if v_id is null then
    insert into works (label_id, title, iswc, isrc, language, genre, release_date, territories, status, notes)
    values (v_label, trim(p_work->>'title'), v_iswc, v_isrc,
            nullif(trim(p_work->>'language'), ''), nullif(trim(p_work->>'genre'), ''),
            nullif(p_work->>'release_date', '')::date,
            coalesce((select array_agg(upper(trim(t))) from jsonb_array_elements_text(p_work->'territories') t
                      where trim(t) <> ''), '{WORLD}'),
            coalesce(nullif(p_work->>'status', ''), 'draft')::work_status,
            nullif(trim(p_work->>'notes'), ''))
    returning id into v_id;
  else
    update works set
      label_id     = v_label,
      title        = trim(p_work->>'title'),
      iswc         = v_iswc,
      isrc         = v_isrc,
      language     = nullif(trim(p_work->>'language'), ''),
      genre        = nullif(trim(p_work->>'genre'), ''),
      release_date = nullif(p_work->>'release_date', '')::date,
      territories  = coalesce((select array_agg(upper(trim(t))) from jsonb_array_elements_text(p_work->'territories') t
                               where trim(t) <> ''), '{WORLD}'),
      status       = coalesce(nullif(p_work->>'status', ''), 'draft')::work_status,
      notes        = nullif(trim(p_work->>'notes'), '')
    where id = v_id;
    if not found then
      raise exception 'This work does not exist or you cannot edit it';
    end if;
  end if;

  delete from ownership where work_id = v_id;

  insert into ownership (work_id, artist_id, role, share_pct, territory)
  select v_id, (o->>'artist_id')::uuid, (o->>'role')::creator_role,
         (o->>'share_pct')::numeric, coalesce(nullif(upper(trim(o->>'territory')), ''), 'WORLD')
  from jsonb_array_elements(coalesce(p_owners, '[]'::jsonb)) o
  where nullif(o->>'artist_id', '') is not null;

  -- the deferred 100% check normally runs at commit; run it now for a clear error
  set constraints trg_ownership_total immediate;
  return v_id;
end $$;
revoke execute on function save_work(jsonb, jsonb) from public, anon;
grant  execute on function save_work(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- WORK SUBMISSIONS ("Submit a new work")
-- Submitted -> Under review -> Registered with IPRS (ISWC added) / Needs changes
-- ---------------------------------------------------------------------
create type submission_status as enum ('submitted', 'under_review', 'needs_changes', 'registered');

create table work_submissions (
  id             uuid primary key default gen_random_uuid(),
  submitted_by   uuid not null references profiles(id) on delete cascade default auth.uid(),
  label_id       uuid references labels(id) on delete set null,
  title          text not null check (length(trim(title)) > 0),
  language       text,
  release_date   date,
  isrc           text[] not null default '{}',
  notes          text,
  -- [{name, ipi, role: composer|author|composer_author, share_pct, artist_id?}]
  writers        jsonb not null default '[]',
  files          text[] not null default '{}',   -- paths in storage bucket "work-submissions"
  status         submission_status not null default 'submitted',
  reviewer_note  text,
  iswc           text,
  work_id        uuid references works(id) on delete set null,
  reviewed_by    uuid references profiles(id) on delete set null,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index on work_submissions (submitted_by);
create index on work_submissions (label_id);
create index on work_submissions (status);

create or replace function public.submission_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_total numeric; v_bad int;
begin
  new.updated_at := now();

  -- writer splits: every share > 0 and the total at most 100%
  select coalesce(sum((w->>'share_pct')::numeric), 0),
         count(*) filter (where coalesce((w->>'share_pct')::numeric, 0) <= 0
                             or coalesce(trim(w->>'name'), '') = '')
    into v_total, v_bad
  from jsonb_array_elements(coalesce(new.writers, '[]'::jsonb)) w;
  if jsonb_array_length(coalesce(new.writers, '[]'::jsonb)) = 0 then
    raise exception 'Add at least one writer or composer with a share';
  end if;
  if v_bad > 0 then
    raise exception 'Every writer needs a name and a share above 0 percent';
  end if;
  if v_total > 100 then
    raise exception 'Writer shares add up to % percent; the limit is 100 percent', v_total;
  end if;

  if is_super_admin() or auth.uid() is null then
    return new;
  end if;

  -- Files: new paths must be in the caller's own storage folder. Without this,
  -- someone could attach another person's file and read it through the label rule.
  if exists (select 1 from unnest(coalesce(new.files, '{}')) f
             where (tg_op = 'INSERT' or not f = any(coalesce(old.files, '{}')))
               and (f not like auth.uid()::text || '/%' or f like '%..%')) then
    raise exception 'Files can only be attached from your own uploads';
  end if;

  if tg_op = 'INSERT' then
    new.submitted_by  := auth.uid();
    new.status        := 'submitted';
    new.reviewer_note := null;
    new.iswc          := null;
    new.work_id       := null;
    new.reviewed_by   := null;
    new.reviewed_at   := null;
    new.label_id      := coalesce(my_label_id(),
                           (select label_id from artists where user_id = auth.uid() and label_id is not null limit 1));
    return new;
  end if;

  -- UPDATE by the submitter (or his/her label admin): only while it is with them
  if old.status not in ('submitted', 'needs_changes') then
    raise exception 'This work is already being reviewed by Plutus and cannot be changed';
  end if;
  new.status        := 'submitted';          -- editing re-submits it
  new.submitted_by  := old.submitted_by;
  new.label_id      := old.label_id;
  new.reviewer_note := old.reviewer_note;
  new.iswc          := old.iswc;
  new.work_id       := old.work_id;
  new.reviewed_by   := old.reviewed_by;
  new.reviewed_at   := old.reviewed_at;
  return new;
end $$;

create trigger trg_submission_guard before insert or update on work_submissions
  for each row execute function submission_guard();

create or replace function public.submission_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform notify_users(super_admin_ids(), 'system', 'New work submitted: ' || new.title,
      'A new song is waiting for review before IPRS registration.', '/submissions/' || new.id);
  elsif new.status is distinct from old.status then
    if new.status = 'submitted' then
      perform notify_users(super_admin_ids(), 'system', 'Work re-submitted: ' || new.title,
        'The changes you asked for were made.', '/submissions/' || new.id);
    elsif new.status = 'under_review' then
      perform notify_users(array[new.submitted_by], 'system', 'Plutus is reviewing ' || new.title,
        'We will register it with IPRS or tell you what to change.', '/submissions/' || new.id);
    elsif new.status = 'needs_changes' then
      perform notify_users(array[new.submitted_by], 'system', 'Changes needed: ' || new.title,
        coalesce(new.reviewer_note, 'Open the submission to see what to change.'), '/submissions/' || new.id);
    elsif new.status = 'registered' then
      perform notify_users(array[new.submitted_by], 'system', new.title || ' is registered with IPRS',
        'ISWC ' || coalesce(new.iswc, '') || '. It is now in your catalog.', '/submissions/' || new.id);
    end if;
  end if;
  return null;
end $$;

create trigger trg_submission_notify after insert or update on work_submissions
  for each row execute function submission_notify();

create trigger trg_work_submissions_audit after insert or update or delete on work_submissions
  for each row execute function audit_row();

alter table work_submissions enable row level security;
revoke all on work_submissions from anon;

create policy submissions_read on work_submissions for select to authenticated using (
  is_super_admin()
  or submitted_by = auth.uid()
  or (my_label_id() is not null and label_id = my_label_id())
);
-- any switched-on account may submit (my_role() is null for switched-off accounts)
create policy submissions_insert on work_submissions for insert to authenticated with check (
  my_role() is not null and (is_super_admin() or submitted_by = auth.uid())
);
create policy submissions_update on work_submissions for update to authenticated
  using      (is_super_admin() or submitted_by = auth.uid() or (my_label_id() is not null and label_id = my_label_id()))
  with check (is_super_admin() or submitted_by = auth.uid() or (my_label_id() is not null and label_id = my_label_id()));
-- withdraw: only while nobody has started the review
create policy submissions_delete on work_submissions for delete to authenticated using (
  is_super_admin() or (submitted_by = auth.uid() and status in ('submitted', 'needs_changes'))
);

-- ---------------------------------------------------------------------
-- Registered with IPRS: create the work, rights holders and ownership
-- from a submission in one step. Super Admin only.
-- ---------------------------------------------------------------------
create or replace function public.register_submission(p_submission uuid, p_iswc text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  s        work_submissions;
  w        jsonb;
  v_work   uuid;
  v_artist uuid;
  v_role   creator_role;
  v_iswc   text := nullif(upper(trim(p_iswc)), '');
begin
  if not is_super_admin() and auth.uid() is not null then
    raise exception 'Only a Super Admin can register a work';
  end if;
  if v_iswc is null then
    raise exception 'Enter the ISWC that IPRS gave for this work';
  end if;

  select * into s from work_submissions where id = p_submission for update;
  if not found then raise exception 'Submission not found'; end if;
  if s.status = 'registered' then raise exception 'This work is already registered'; end if;

  if exists (select 1 from works where replace(replace(iswc, '-', ''), '.', '')
                                     = replace(replace(v_iswc, '-', ''), '.', '')) then
    raise exception 'ISWC % is already used by another work in the catalog', v_iswc;
  end if;

  insert into works (label_id, title, iswc, isrc, language, release_date, status, notes)
  values (s.label_id, s.title, v_iswc, s.isrc, s.language, s.release_date, 'registered',
          'Created from work submission ' || s.id)
  returning id into v_work;

  for w in select * from jsonb_array_elements(s.writers) loop
    v_artist := nullif(w->>'artist_id', '')::uuid;
    if v_artist is null and nullif(trim(w->>'ipi'), '') is not null then
      select id into v_artist from artists where ipi_number = trim(w->>'ipi');
    end if;
    if v_artist is null then
      select id into v_artist from artists
      where lower(stage_name) = lower(trim(w->>'name'))
        and label_id is not distinct from s.label_id
      limit 1;
    end if;
    if v_artist is null then
      insert into artists (label_id, stage_name, ipi_number, society)
      values (s.label_id, trim(w->>'name'), nullif(trim(w->>'ipi'), ''), 'IPRS')
      returning id into v_artist;
    end if;

    v_role := case lower(coalesce(w->>'role', ''))
                when 'composer' then 'composer'
                when 'author'   then 'author'
                else 'composer_author' end;

    insert into ownership (work_id, artist_id, role, share_pct, territory)
    values (v_work, v_artist, v_role, (w->>'share_pct')::numeric, 'WORLD')
    on conflict (work_id, artist_id, role, territory)
      do update set share_pct = ownership.share_pct + excluded.share_pct;
  end loop;

  update work_submissions set
    status = 'registered', iswc = v_iswc, work_id = v_work,
    reviewed_by = auth.uid(), reviewed_at = now()
  where id = s.id;

  return v_work;
end $$;
revoke execute on function register_submission(uuid, text) from public, anon;
grant  execute on function register_submission(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- File storage for submissions (private bucket, 50 MB per file).
-- Runs only on Supabase (the local test database has no storage schema).
-- Path layout: <user id>/<anything>/<file name>
-- ---------------------------------------------------------------------
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('work-submissions', 'work-submissions', false, 52428800)
    on conflict (id) do nothing;

    execute $p$
      create policy "work files: upload to own folder" on storage.objects
      for insert to authenticated with check (
        bucket_id = 'work-submissions'
        and (storage.foldername(name))[1] = auth.uid()::text
        and public.my_role() is not null)
    $p$;
    execute $p$
      create policy "work files: read" on storage.objects
      for select to authenticated using (
        bucket_id = 'work-submissions'
        and ((storage.foldername(name))[1] = auth.uid()::text
             or public.is_super_admin()
             or exists (select 1 from public.work_submissions s
                        where storage.objects.name = any(s.files)
                          and public.my_label_id() is not null
                          and s.label_id = public.my_label_id())))
    $p$;
    execute $p$
      create policy "work files: delete own" on storage.objects
      for delete to authenticated using (
        bucket_id = 'work-submissions'
        and ((storage.foldername(name))[1] = auth.uid()::text or public.is_super_admin()))
    $p$;
  end if;
end $storage$;
