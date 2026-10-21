-- ============================================================
-- EMERGENCY ROLLBACK — NOT A MIGRATION. Do not move into supabase/migrations.
--
-- Restores handle_new_user() exactly as migration 0006 defined it (the
-- definition in force before 0030), for when the login path breaks
-- mid-class. Run it with ONE of:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollbacks/rollback_0030_handle_new_user.sql
--   (or paste this file into the Supabase dashboard SQL editor and Run)
--
-- What it does NOT undo: everything else in 0030 stays — the
-- roster_entries trigger, provision_roster_entry, provisioning_failures,
-- and the 0030 versions of commit_roster_import / add_class_ta. Those do
-- not run at sign-in. After running this, the same-instant race lock is
-- gone from the sign-in path again.
--
-- Afterwards, record the change in a real migration so the migration
-- history matches the live database again (CLAUDE.md rule 7).
--
-- The function body below is verbatim from
-- supabase/migrations/0006_case_insensitive_roster_match.sql.
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_domain text;
  email_norm text;
  email_domain text;
  roster record;
begin
  email_norm := lower(trim(new.email));

  select value into allowed_domain
    from public.app_config
    where key = 'allowed_email_domain';

  email_domain := split_part(email_norm, '@', 2);

  if allowed_domain is not null and email_domain <> lower(trim(allowed_domain)) then
    return new;
  end if;

  select * into roster
    from public.roster_entries
    where lower(trim(email)) = email_norm and provisioned = false
    limit 1;

  if roster is null then
    return new;
  end if;

  insert into public.profiles (
    id, email, full_name, role, roll_number, programme, year_of_study, section, is_active
  ) values (
    new.id, email_norm, roster.full_name, roster.intended_role, roster.roll_number,
    roster.programme, roster.year_of_study, roster.section, true
  );

  if roster.class_id is not null then
    insert into public.class_members (class_id, user_id, member_role, status)
    values (roster.class_id, new.id, roster.intended_role, 'ACTIVE')
    on conflict (class_id, user_id) do nothing;
  end if;

  update public.roster_entries
    set provisioned = true, updated_at = now()
    where id = roster.id;

  return new;
end;
$$;

notify pgrst, 'reload schema';
