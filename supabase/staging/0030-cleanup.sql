-- ============================================================
-- STAGING ONLY — removes everything 0030-seed.sql created.
-- Order matters: classes.professor_id, roster_entries.created_by,
-- imports.imported_by and audit_logs.actor_id reference profiles without
-- cascade, so those go before the auth users (which cascade to profiles
-- and class_members).
-- ============================================================
delete from public.classes where id = '00000000-0000-4000-8000-0000000000c1';
delete from public.roster_entries where email like 'staging.%@ahduni.edu.in';
delete from public.provisioning_failures where email like 'staging.%@ahduni.edu.in';
delete from public.audit_logs
  where actor_id in (select id from auth.users where email like 'staging.%@ahduni.edu.in')
     or entity_id = '00000000-0000-4000-8000-0000000000c1';
delete from auth.users where email like 'staging.%@ahduni.edu.in';
