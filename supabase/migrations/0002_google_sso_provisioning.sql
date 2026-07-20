-- 0002_google_sso_provisioning.sql
-- Adds roster-based role provisioning for Google Workspace SSO.
-- Reference: /docs/AUTH_SSO.md. Apply after 0001_init.sql.

-- ============================================================
-- ROSTER ENTRIES — pre-provisioning, populated by roster import (Phase 3)
-- and, for the first admin/professor, by manual insert.
-- ============================================================

create table roster_entries (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  intended_role user_role not null default 'STUDENT',
  class_id uuid references classes(id) on delete cascade,
  roll_number text,
  full_name text,
  programme text,
  year_of_study text,
  section text,
  provisioned boolean not null default false, -- set true once handle_new_user() consumes it
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_roster_entries_email on roster_entries(email);
create index idx_roster_entries_class on roster_entries(class_id);

alter table roster_entries enable row level security;

create policy roster_entries_professor_manage on roster_entries
  for all using (
    class_id is null or exists (
      select 1 from classes c where c.id = roster_entries.class_id and c.professor_id = auth.uid()
    )
  );

create policy roster_entries_admin_manage on roster_entries
  for all using (current_user_role() = 'ADMIN');

-- ============================================================
-- PROVISIONING TRIGGER
-- Runs when Supabase Auth creates a new auth.users row (i.e. first
-- successful Google sign-in). Domain check and roster lookup happen here,
-- server-side — never trust the OAuth `hd` param as the security boundary.
-- ============================================================

create or replace function handle_new_user()
returns trigger
language plpgsql security definer
as $$
declare
  allowed_domain text := current_setting('app.settings.allowed_email_domain', true);
  email_domain text;
  roster record;
begin
  email_domain := split_part(new.email, '@', 2);

  -- Reject silently if outside the university's Workspace domain: no
  -- profile is created, so the app-level check in middleware denies access.
  if allowed_domain is not null and email_domain <> allowed_domain then
    return new;
  end if;

  select * into roster from roster_entries
    where email = new.email and provisioned = false
    limit 1;

  if roster is null then
    -- Not on any roster yet. No profile created; app treats this as
    -- unprovisioned. A professor/admin adding a matching roster_entries
    -- row later does NOT retroactively provision past logins — document
    -- this for the professor: import rosters before students first log in.
    return new;
  end if;

  insert into profiles (
    id, email, full_name, role, roll_number, programme, year_of_study, section, is_active
  ) values (
    new.id, new.email, roster.full_name, roster.intended_role, roster.roll_number,
    roster.programme, roster.year_of_study, roster.section, true
  );

  if roster.class_id is not null then
    insert into class_members (class_id, user_id, member_role, status)
    values (roster.class_id, new.id, roster.intended_role, 'ACTIVE')
    on conflict (class_id, user_id) do nothing;
  end if;

  update roster_entries set provisioned = true, updated_at = now() where id = roster.id;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ============================================================
-- CONFIG
-- Set the allowed domain at the database level (in addition to the app's
-- own env var) so the trigger enforces it even if app-level env
-- configuration drifts. Run this once per environment with the real
-- confirmed domain:
--
--   alter database postgres set app.settings.allowed_email_domain = 'ahduni.edu.in';
--
-- Confirm the exact Workspace email domain with the professor before
-- setting this in production — do not assume it matches the public
-- website domain without checking.
-- ============================================================
