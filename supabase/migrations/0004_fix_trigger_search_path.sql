-- 0004_fix_trigger_search_path.sql
-- Fixes "relation app_config does not exist" during Google sign-up.
--
-- Root cause: the on_auth_user_created trigger fires as supabase_auth_admin,
-- whose search_path does not include `public`. All table references inside
-- handle_new_user() must be schema-qualified, and we pin search_path on the
-- function itself as defense in depth (also a security best practice for
-- SECURITY DEFINER functions).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  allowed_domain text;
  email_domain text;
  roster record;
begin
  select value into allowed_domain
    from public.app_config
    where key = 'allowed_email_domain';

  email_domain := split_part(new.email, '@', 2);

  if allowed_domain is not null and email_domain <> allowed_domain then
    return new;
  end if;

  select * into roster
    from public.roster_entries
    where email = new.email and provisioned = false
    limit 1;

  if roster is null then
    return new;
  end if;

  insert into public.profiles (
    id, email, full_name, role, roll_number, programme, year_of_study, section, is_active
  ) values (
    new.id, new.email, roster.full_name, roster.intended_role, roster.roll_number,
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

-- The trigger from 0002 already points at this function name; CREATE OR
-- REPLACE updates the body in place, so no trigger recreation needed.
