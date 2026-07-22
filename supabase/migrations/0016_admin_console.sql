-- 0016_admin_console.sql
-- Adds the read access the admin console needs, and hardens the helper
-- that every admin policy already depends on.
--
-- ============================================================
-- 1. Hardening current_user_role() — a real pre-existing gap.
--
-- It was created in 0001 as SECURITY DEFINER but WITHOUT `set search_path`
-- and referencing `profiles` unqualified:
--
--     create or replace function current_user_role() returns user_role
--     language sql stable security definer
--     as $$ select role from profiles where id = auth.uid() $$;
--
-- Migration 0004 fixed exactly this class of bug for the trigger
-- functions ("a security definer function must not resolve unqualified
-- table names via a caller-controlled search_path") but did not revisit
-- this one. It is the authorisation source for every admin policy in the
-- database — audit_logs_admin, profiles_admin_all, app_config_admin_only,
-- roster_entries_admin_manage — and for the new policies below, so it is
-- fixed here before more is built on it.
--
-- Not known to be exploitable today: Supabase sets a safe search_path for
-- the authenticated/anon roles, so `profiles` resolves to public.profiles
-- in practice. This closes it as a matter of the standing rule rather
-- than in response to an incident.
-- ============================================================

create or replace function public.current_user_role()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

-- ============================================================
-- 2. is_admin() — the same check with the intent stated, so admin
-- policies read as authorisation rather than as a string comparison.
-- Same rules: security definer, pinned search_path, schema-qualified.
-- ============================================================

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'ADMIN'
  );
$$;

revoke execute on function public.is_admin() from anon;

-- ============================================================
-- 3. Admin read access for the console.
--
-- profiles and audit_logs are already covered (profiles_admin_all,
-- audit_logs_admin from 0001). The console additionally lists which
-- classes a user belongs to, which needs class_members and classes.
--
-- SELECT only — deliberately narrower than profiles_admin_all. An admin
-- has no reason to rewrite enrolment from this screen; that is the
-- professor's roster import. Both policies go through the security
-- definer helper rather than a raw subquery into profiles, per the rule
-- established in 0008.
-- ============================================================

drop policy if exists class_members_admin_select on public.class_members;
create policy class_members_admin_select on public.class_members
  for select using (is_admin());

drop policy if exists classes_admin_select on public.classes;
create policy classes_admin_select on public.classes
  for select using (is_admin());

-- ============================================================
-- 4. Grants. 0007's ALTER DEFAULT PRIVILEGES already covers these
-- tables, and no new relation is created here — restated only for the
-- new function, since EXECUTE is not covered by the table defaults.
-- ============================================================

grant execute on function public.is_admin() to authenticated, service_role;
grant execute on function public.current_user_role() to authenticated, service_role;
