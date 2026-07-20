-- 0005_case_insensitive_roster_match.sql
-- Fixes provisioning failures caused by exact-string email comparison.
-- Emails are case-insensitive per spec; roster imports may also carry
-- stray whitespace. Normalize both sides (lower + trim) when matching,
-- and normalize roster emails at rest so future inserts are consistent.

-- 1. Normalize existing roster rows in place.
update public.roster_entries
set email = lower(trim(email)), updated_at = now()
where email <> lower(trim(email));

-- 2. Replace the trigger function with normalized matching.
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
