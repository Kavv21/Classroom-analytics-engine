-- ============================================================
-- STAGING ONLY — run after 0030-seed.sql. Every row should say PASS.
-- ============================================================
with
cls as (select '00000000-0000-4000-8000-0000000000c1'::uuid as id),
prof as (select id from auth.users where email = 'staging.prof@ahduni.edu.in'),
has_profile as (
  select u.email, p.id is not null as yes, p.role::text as role
  from auth.users u left join public.profiles p on p.id = u.id
  where u.email like 'staging.%@ahduni.edu.in'
),
in_class as (
  select p.email as profile_email, u.email as auth_email, cm.member_role::text as member_role
  from public.class_members cm
  join public.profiles p on p.id = cm.user_id
  join auth.users u on u.id = cm.user_id
  where cm.class_id = (select id from cls)
),
roster as (
  select re.email, re.provisioned from public.roster_entries re
  where re.email like 'staging.%@ahduni.edu.in'
),
failures as (
  select pf.email, pf.error_code from public.provisioning_failures pf
  where pf.email like 'staging.%@ahduni.edu.in'
),
last_import as (
  select i.summary from public.imports i
  where i.class_id = (select id from cls) and i.import_type = 'ROSTER'
  order by i.created_at desc limit 1
),
checks(path, check_name, ok) as (
  values
  ('A', 'profile created as STUDENT',
     exists (select 1 from has_profile where email = 'staging.a@ahduni.edu.in' and yes and role = 'STUDENT')),
  ('A', 'member of class',
     exists (select 1 from in_class where auth_email = 'staging.a@ahduni.edu.in' and member_role = 'STUDENT')),
  ('A', 'roster entry provisioned',
     exists (select 1 from roster where email = 'staging.a@ahduni.edu.in' and provisioned)),

  ('B', 'no profile',
     exists (select 1 from has_profile where email = 'staging.b@ahduni.edu.in' and not yes)),
  ('B', 'no failure row',
     not exists (select 1 from failures where email = 'staging.b@ahduni.edu.in')),

  ('C', 'profile created by roster trigger',
     exists (select 1 from has_profile where email = 'staging.c@ahduni.edu.in' and yes and role = 'STUDENT')),
  ('C', 'member of class',
     exists (select 1 from in_class where auth_email = 'staging.c@ahduni.edu.in')),
  ('C', 'roster entry provisioned',
     exists (select 1 from roster where email = 'staging.c@ahduni.edu.in' and provisioned)),

  ('D1', 'pending: on roster, not provisioned, no profile, no failure',
     exists (select 1 from roster where email = 'staging.d1@ahduni.edu.in' and not provisioned)
     and not exists (select 1 from public.profiles where email = 'staging.d1@ahduni.edu.in')
     and not exists (select 1 from failures where email = 'staging.d1@ahduni.edu.in')),
  ('D2', 'provisioned during import and member of class',
     exists (select 1 from roster where email = 'staging.d2@ahduni.edu.in' and provisioned)
     and exists (select 1 from in_class where auth_email = 'staging.d2@ahduni.edu.in')),
  ('D3', 'on roster, NOT provisioned, failure 23505 recorded',
     exists (select 1 from roster where email = 'staging.d3@ahduni.edu.in' and not provisioned)
     and exists (select 1 from failures where email = 'staging.d3@ahduni.edu.in' and error_code = '23505')),
  ('D3', 'clash owner was NOT enrolled in their place',
     not exists (select 1 from in_class where auth_email = 'staging.x@ahduni.edu.in')),
  ('D4', 'on roster, NOT provisioned, DUPLICATE_AUTH_ACCOUNTS recorded',
     exists (select 1 from roster where email = 'staging.d4@ahduni.edu.in' and not provisioned)
     and exists (select 1 from failures where email = 'staging.d4@ahduni.edu.in' and error_code = 'DUPLICATE_AUTH_ACCOUNTS')),
  ('D', 'import completed: imported 2, needsAttention 2, total 4',
     (select (summary->>'imported')::int = 2
         and (summary->>'needsAttention')::int = 2
         and (summary->>'total')::int = 4 from last_import)),

  ('F', 'TA enrolled on the spot',
     exists (select 1 from in_class where auth_email = 'staging.f@ahduni.edu.in' and member_role = 'TA')),
  ('F', 'audit says CLASS_TA_ADDED, not PREAUTHORISED',
     exists (select 1 from public.audit_logs al
             where al.action = 'CLASS_TA_ADDED' and al.metadata->>'email' = 'staging.f@ahduni.edu.in')
     and not exists (select 1 from public.audit_logs al
             where al.action = 'CLASS_TA_PREAUTHORISED' and al.metadata->>'email' = 'staging.f@ahduni.edu.in')),

  ('grants', 'authenticated cannot read provisioning_failures',
     not has_table_privilege('authenticated', 'public.provisioning_failures', 'select')),
  ('grants', 'anon cannot read provisioning_failures',
     not has_table_privilege('anon', 'public.provisioning_failures', 'select')),
  ('grants', 'authenticated cannot call provision_roster_entry',
     not has_function_privilege('authenticated', 'public.provision_roster_entry(uuid)', 'execute')),
  ('grants', 'authenticated cannot call apply_roster_entry',
     not has_function_privilege('authenticated', 'public.apply_roster_entry(uuid, uuid)', 'execute'))
)
select path, check_name, case when ok then 'PASS' else 'FAIL' end as result
from checks
order by path, check_name;

-- Detail, for eyeballing:
-- select * from public.provisioning_failures where email like 'staging.%' order by created_at;
-- select row_number, status, error_message from public.import_rows ir
--   join public.imports i on i.id = ir.import_id
--   where i.class_id = '00000000-0000-4000-8000-0000000000c1' order by row_number;

-- Retry check for D3 once fixed (should return PROVISIONED):
--   update public.profiles set email = 'staging.x@ahduni.edu.in'
--     where id = '00000000-0000-4000-8000-0000000000e1';
--   select public.provision_roster_entry(id) from public.roster_entries
--     where email = 'staging.d3@ahduni.edu.in';
