-- ============================================================
-- STAGING ONLY — exercises migration 0030. Never run against production.
--
-- Run in the STAGING project's SQL editor (runs as postgres), after
-- `supabase db push` has applied 0001–0030. Then run 0030-verify.sql.
-- Re-runnable: run 0030-cleanup.sql first.
--
-- Fixed ids 00000000-0000-4000-8000-0000000000NN; every email is
-- staging.*@ahduni.edu.in so the 0003 domain gate lets them through.
--
--   A  new signup WITH a roster entry       -> handle_new_user provisions
--   B  new signup WITHOUT a roster entry    -> nothing (no profile)
--   C  existing auth user, rostered after   -> roster trigger provisions
--   D  CSV import (commit_roster_import, run as the professor):
--        d1  never signed in                -> pending, no profile
--        d2  signed in before, no profile   -> provisioned during import
--        d3  BROKEN: another profile already owns this email
--                                           -> 23505, needs attention
--        d4  BROKEN: two auth accounts share this email
--                                           -> DUPLICATE_AUTH_ACCOUNTS
--      d1 + d2 must still import even though d3 and d4 fail.
--   F  add_class_ta for someone signed in before, no profile
--                                           -> mode ENROLLED, not PREAUTHORISED
-- ============================================================

-- Simulates a Google sign-in: an auth.users INSERT fires handle_new_user.
-- is_sso_user = true lets d4's second account share an email — the
-- auth.users email unique index only covers is_sso_user = false.
create or replace function pg_temp.sign_in(p_id uuid, p_email text, p_sso boolean default false)
returns void language sql as $$
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, is_sso_user, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', p_id, 'authenticated', 'authenticated',
    p_email, '', now(),
    '{"provider":"google","providers":["google"]}', '{}', p_sso, now(), now()
  );
$$;

-- ---- Professor + class -------------------------------------------------
insert into public.roster_entries (email, intended_role, full_name)
values ('staging.prof@ahduni.edu.in', 'PROFESSOR', 'Staging Professor');
select pg_temp.sign_in('00000000-0000-4000-8000-000000000001', 'staging.prof@ahduni.edu.in');

insert into public.classes (id, professor_id, name)
values ('00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-000000000001', 'Staging 0030 class');

-- ---- A: roster first, then first sign-in -------------------------------
insert into public.roster_entries (email, intended_role, class_id, full_name, roll_number)
values ('staging.a@ahduni.edu.in', 'STUDENT', '00000000-0000-4000-8000-0000000000c1', 'Path A', 'A-001');
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000a1', 'staging.a@ahduni.edu.in');

-- ---- B: first sign-in, no roster entry anywhere ------------------------
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000b1', 'staging.b@ahduni.edu.in');

-- ---- C: first sign-in, THEN rostered (the real-student bug) ------------
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000c2', 'staging.c@ahduni.edu.in');
insert into public.roster_entries (email, intended_role, class_id, full_name, roll_number)
values ('staging.c@ahduni.edu.in', 'STUDENT', '00000000-0000-4000-8000-0000000000c1', 'Path C', 'C-001');

-- ---- D setup -----------------------------------------------------------
-- d2: signed in earlier, never rostered.
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000d2', 'staging.d2@ahduni.edu.in');

-- d3: signed in earlier, never rostered — but a different account's
-- profile already carries d3's email, so creating d3's profile clashes on
-- profiles.email.
insert into public.roster_entries (email, intended_role, full_name)
values ('staging.x@ahduni.edu.in', 'STUDENT', 'Clash Owner');
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000e1', 'staging.x@ahduni.edu.in');
update public.profiles set email = 'staging.d3@ahduni.edu.in'
where id = '00000000-0000-4000-8000-0000000000e1';
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000d3', 'staging.d3@ahduni.edu.in');

-- d4: two auth accounts for one email.
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000d4', 'staging.d4@ahduni.edu.in', false);
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000d5', 'staging.d4@ahduni.edu.in', true);

-- F setup: signed in earlier, never rostered, about to be made a TA.
select pg_temp.sign_in('00000000-0000-4000-8000-0000000000f1', 'staging.f@ahduni.edu.in');

-- ---- D + F: run as the professor, through the real RPCs -----------------
-- If the SQL editor rejects BEGIN/COMMIT, run this block on its own.
begin;
create temp table if not exists staging_0030_results (label text, result jsonb);
grant all on staging_0030_results to authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',
  true
);
set local role authenticated;

insert into staging_0030_results
select 'D_import', public.commit_roster_import(
  '00000000-0000-4000-8000-0000000000c1',
  'staging-0030.csv',
  'staging-0030-checksum',
  '[
    {"rowNumber": 2, "email": "staging.d1@ahduni.edu.in", "fullName": "Path D1", "rollNumber": "D-001"},
    {"rowNumber": 3, "email": "staging.d2@ahduni.edu.in", "fullName": "Path D2", "rollNumber": "D-002"},
    {"rowNumber": 4, "email": "staging.d3@ahduni.edu.in", "fullName": "Path D3 (broken)", "rollNumber": "D-003"},
    {"rowNumber": 5, "email": "staging.d4@ahduni.edu.in", "fullName": "Path D4 (broken)", "rollNumber": "D-004"}
  ]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
);

insert into staging_0030_results
select 'F_add_ta', public.add_class_ta(
  '00000000-0000-4000-8000-0000000000c1', 'staging.f@ahduni.edu.in', 'Path F'
);

commit;

-- Expect D_import: imported 2, needsAttention = rows 4 (23505) and 5
-- (DUPLICATE_AUTH_ACCOUNTS). Expect F_add_ta: mode ENROLLED.
select label, jsonb_pretty(result) from staging_0030_results;
