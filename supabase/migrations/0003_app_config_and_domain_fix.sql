-- 0003_app_config_and_domain_fix.sql
-- Fixes handle_new_user() from 0002: Supabase's managed Postgres does not
-- allow `alter database ... set app.settings.x` for custom GUC namespaces
-- (permission denied even for the project owner role). Replaces that
-- mechanism with a real config table instead.

create table app_config (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table app_config enable row level security;

-- Admin-only visibility/edit. The trigger function itself reads this via
-- security definer, so RLS here doesn't block provisioning.
create policy app_config_admin_only on app_config
  for all using (current_user_role() = 'ADMIN');

insert into app_config (key, value)
values ('allowed_email_domain', 'ahduni.edu.in')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Replace handle_new_user() to read from app_config instead of
-- current_setting(). Same logic otherwise.
create or replace function handle_new_user()
returns trigger
language plpgsql security definer
as $$
declare
  allowed_domain text;
  email_domain text;
  roster record;
begin
  select value into allowed_domain from app_config where key = 'allowed_email_domain';
  email_domain := split_part(new.email, '@', 2);

  if allowed_domain is not null and email_domain <> allowed_domain then
    return new;
  end if;

  select * into roster from roster_entries
    where email = new.email and provisioned = false
    limit 1;

  if roster is null then
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

-- Trigger already exists from 0002 and points at this function by name,
-- so no need to recreate it — CREATE OR REPLACE FUNCTION updates the body
-- the existing trigger calls.

-- To change the domain later (e.g. moving from staging to a different
-- allowed domain), update the row rather than re-running a migration:
--   update app_config set value = 'new-domain.example', updated_at = now()
--   where key = 'allowed_email_domain';
