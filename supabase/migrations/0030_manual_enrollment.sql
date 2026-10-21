-- ============================================================
-- 0030 — Provision a roster entry whenever it is created, not only at
-- first sign-in.
--
-- THE BUG
--
-- `handle_new_user()` (auth.users AFTER INSERT) is the only thing that
-- ever turns a `roster_entries` row into a `profiles` + `class_members`
-- row. It fires once, at a person's first Google sign-in. Anyone who
-- signed in BEFORE a professor rostered them got an auth.users row and
-- nothing else, and adding them to the roster afterwards did nothing —
-- the trigger had already fired. No profile, no membership, locked out
-- for good.
--
-- THE FIX
--
-- Provisioning now happens from both directions:
--   * auth.users INSERT     -> handle_new_user()
--   * roster_entries INSERT -> provision_roster_entry(new.id)   (new)
-- whichever happens second does the work. That covers CSV import,
-- manual enrolment and add_class_ta's pre-authorisation alike, because
-- all three insert into roster_entries.
--
-- ONE MAPPING, NOT TWO
--
-- Both paths call `apply_roster_entry` for the roster -> profile /
-- class_members mapping and `email_domain_allowed` for the domain gate,
-- so they cannot drift. handle_new_user is redefined below to do what
-- 0006 did, through those helpers, plus the advisory lock.
--
-- NO SAME-INSTANT RACE
--
-- A roster insert and that person's first sign-in, running concurrently,
-- could each miss the other's uncommitted row and leave the student
-- locked out — the exact bug above. Both paths therefore take
-- pg_advisory_xact_lock(hashtext(lower(trim(email)))) before looking
-- anything up. Whichever transaction gets the lock second waits for the
-- first to commit and, under READ COMMITTED, its next statement sees the
-- other's row.
--
-- A FAILURE NEVER ABORTS THE INSERT
--
-- Before this migration a roster insert could not fail on provisioning
-- (there was none), so a CSV import of 30 rows could not lose all 30 to
-- one bad row. That must stay true. Any provisioning failure on the
-- roster path is caught, written to `provisioning_failures`, raised as a
-- WARNING into the Postgres log, and the roster entry is left
-- `provisioned = false` for someone to look at. commit_roster_import and
-- add_class_ta read the failure back and report it to the professor.
--
-- handle_new_user is deliberately NOT given that treatment: a failure
-- there still fails the sign-in, exactly as in 0006.
--
-- WHAT IT DOES NOT DO
--
-- An existing `profiles` row is never rewritten (ON CONFLICT (id) DO
-- NOTHING) — the roster row's role/name/roll number never overwrite an
-- account, same rule as add_class_ta (0028). Only the class membership
-- is added.
--
-- Emergency revert of the login path: supabase/rollbacks/0031_rollback_handle_new_user.sql
-- (NOT a migration — kept outside supabase/migrations so db push never applies it).
-- ============================================================

-- ------------------------------------------------------------
-- 1. provisioning_failures — one row per failed attempt. Operators only.
-- ------------------------------------------------------------
create table if not exists public.provisioning_failures (
  id uuid primary key default gen_random_uuid(),
  roster_entry_id uuid references public.roster_entries(id) on delete cascade,
  email text not null,
  error_code text not null,
  error_message text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_provisioning_failures_roster_entry
  on public.provisioning_failures(roster_entry_id);

-- RLS on, no policies: nobody but the table owner (security-definer
-- functions below) and service_role (which bypasses RLS) can touch it.
alter table public.provisioning_failures enable row level security;

revoke all on table public.provisioning_failures from public, anon, authenticated;
grant all on table public.provisioning_failures to service_role;

comment on table public.provisioning_failures is
  'One row per roster_entries provisioning attempt that failed (e.g. a profile email clash, or more than one auth account for the email). The roster entry stays provisioned = false. Retry with select public.provision_roster_entry(roster_entry_id) once the cause is fixed.';

-- ------------------------------------------------------------
-- 2. Shared helpers
-- ------------------------------------------------------------

-- Same semantics as 0006: no configured domain means every domain is allowed.
create or replace function public.email_domain_allowed(p_email text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_allowed text;
begin
  select ac.value into v_allowed
  from public.app_config ac
  where ac.key = 'allowed_email_domain';

  if v_allowed is null then
    return true;
  end if;

  return split_part(lower(trim(p_email)), '@', 2) = lower(trim(v_allowed));
end;
$$;

create or replace function public.record_provisioning_failure(
  p_roster_entry_id uuid,
  p_email text,
  p_error_code text,
  p_error_message text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.provisioning_failures (roster_entry_id, email, error_code, error_message)
  values (p_roster_entry_id, lower(trim(p_email)), p_error_code, p_error_message);

  raise warning 'provisioning failed for roster entry % (%): [%] %',
    p_roster_entry_id, lower(trim(p_email)), p_error_code, p_error_message;
end;
$$;

-- The one roster -> profile/class_members mapping. Field-for-field what
-- handle_new_user wrote in 0006.
create or replace function public.apply_roster_entry(p_roster_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_roster public.roster_entries%rowtype;
begin
  select * into v_roster from public.roster_entries re where re.id = p_roster_id;

  if v_roster.id is null then
    raise exception 'apply_roster_entry: roster entry % does not exist', p_roster_id;
  end if;

  insert into public.profiles (
    id, email, full_name, role, roll_number, programme, year_of_study, section, is_active
  ) values (
    p_user_id, lower(trim(v_roster.email)), v_roster.full_name, v_roster.intended_role,
    v_roster.roll_number, v_roster.programme, v_roster.year_of_study, v_roster.section, true
  )
  on conflict (id) do nothing;

  if v_roster.class_id is not null then
    insert into public.class_members (class_id, user_id, member_role, status)
    values (v_roster.class_id, p_user_id, v_roster.intended_role, 'ACTIVE')
    on conflict (class_id, user_id) do nothing;
  end if;

  update public.roster_entries
    set provisioned = true, updated_at = now()
    where id = v_roster.id;
end;
$$;

-- ------------------------------------------------------------
-- 3. Provision one roster entry now, if its person already has an account.
--
-- Returns:
--   'ALREADY_PROVISIONED' — nothing to do
--   'DOMAIN_NOT_ALLOWED'  — handle_new_user would never provision this
--                           email either; left untouched
--   'PENDING_SIGNUP'      — no auth.users row yet; handle_new_user will
--                           provision it at first sign-in
--   'PROVISIONED'         — profile (if missing) + class membership written
--   'FAILED'              — recorded in provisioning_failures, entry left
--                           provisioned = false
-- Raises only if the roster entry id does not exist (a caller bug).
-- ------------------------------------------------------------
create or replace function public.provision_roster_entry(p_roster_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_roster public.roster_entries%rowtype;
  v_user_id uuid;
  v_matches int;
  v_state text;
  v_message text;
begin
  -- The email is the lock key, so it has to be read first; everything
  -- that decides anything is re-read after the lock.
  select lower(trim(re.email)) into v_email
  from public.roster_entries re
  where re.id = p_roster_id;

  if v_email is null then
    raise exception 'provision_roster_entry: roster entry % does not exist', p_roster_id;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_email));

  select * into v_roster
  from public.roster_entries re
  where re.id = p_roster_id
  for update;

  if v_roster.provisioned then
    return 'ALREADY_PROVISIONED';
  end if;

  if not public.email_domain_allowed(v_email) then
    return 'DOMAIN_NOT_ALLOWED';
  end if;

  select count(*), min(u.id::text)::uuid into v_matches, v_user_id
  from auth.users u
  where lower(trim(u.email)) = v_email;

  if v_matches = 0 then
    return 'PENDING_SIGNUP';
  end if;

  -- Picking one would attach the class to an arbitrary account.
  if v_matches > 1 then
    perform public.record_provisioning_failure(
      v_roster.id, v_email, 'DUPLICATE_AUTH_ACCOUNTS',
      format('%s auth accounts match %s; refusing to guess which one to provision', v_matches, v_email)
    );
    return 'FAILED';
  end if;

  begin
    perform public.apply_roster_entry(v_roster.id, v_user_id);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    perform public.record_provisioning_failure(v_roster.id, v_email, v_state, v_message);
    return 'FAILED';
  end;

  return 'PROVISIONED';
end;
$$;

-- ------------------------------------------------------------
-- 4. handle_new_user — 0006's behaviour, through the shared helpers, with
--    the advisory lock taken before any lookup.
-- ------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(new.email));
  v_roster_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(v_email));

  if not public.email_domain_allowed(v_email) then
    return new;
  end if;

  select re.id into v_roster_id
  from public.roster_entries re
  where lower(trim(re.email)) = v_email and re.provisioned = false
  limit 1;

  if v_roster_id is null then
    return new;
  end if;

  perform public.apply_roster_entry(v_roster_id, new.id);
  return new;
end;
$$;

-- ------------------------------------------------------------
-- 5. Trigger: every new roster entry is provisioned immediately if its
--    person already has an account. provision_roster_entry already
--    records its own failures; the handler here is the backstop for
--    anything that escapes it, so the INSERT itself can never fail on
--    provisioning.
-- ------------------------------------------------------------
create or replace function public.provision_roster_entry_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_message text;
begin
  begin
    perform public.provision_roster_entry(new.id);
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_message = message_text;
    perform public.record_provisioning_failure(new.id, new.email, v_state, v_message);
  end;
  return null;
end;
$$;

drop trigger if exists on_roster_entry_created on public.roster_entries;

create trigger on_roster_entry_created
  after insert on public.roster_entries
  for each row execute function public.provision_roster_entry_on_insert();

-- ------------------------------------------------------------
-- 6. Narrow read-back of a failure, for the staff who just created the
--    roster entry. Returns at most the latest failure for ONE roster entry
--    of a class the caller manages — never the table.
-- ------------------------------------------------------------
create or replace function public.roster_entry_provisioning_failure(p_roster_entry_id uuid)
returns table (error_code text, error_message text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
begin
  select re.class_id into v_class_id
  from public.roster_entries re
  where re.id = p_roster_entry_id;

  if v_class_id is null
     or not (public.can_manage_class_content(v_class_id) or public.is_admin()) then
    raise exception 'not authorized for this roster entry';
  end if;

  return query
  select pf.error_code, pf.error_message
  from public.provisioning_failures pf
  where pf.roster_entry_id = p_roster_entry_id
  order by pf.created_at desc
  limit 1;
end;
$$;

-- ------------------------------------------------------------
-- 7. commit_roster_import — 0028's version, now reporting rows whose
--    roster entry was written but could not be provisioned. Those rows
--    are still on the roster (pending) and are counted in
--    `needsAttention`, not in `imported`.
-- ------------------------------------------------------------
create or replace function public.commit_roster_import(
  p_class_id uuid,
  p_source_filename text,
  p_source_checksum text,
  p_new_roster_rows jsonb,
  p_existing_member_rows jsonb,
  p_rejected_rows jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_import_id uuid;
  v_imported int := 0;
  v_rejected int := 0;
  v_needs_attention jsonb := '[]'::jsonb;
  v_roster_id uuid;
  v_failure record;
  row_data jsonb;
begin
  if not public.can_manage_class_content(p_class_id) then
    raise exception 'not authorized to import a roster for this class';
  end if;

  insert into public.imports (
    class_id, import_type, source_filename, source_checksum, status, imported_by
  ) values (
    p_class_id, 'ROSTER', p_source_filename, p_source_checksum, 'PROCESSING', auth.uid()
  ) returning id into v_import_id;

  for row_data in select * from jsonb_array_elements(coalesce(p_new_roster_rows, '[]'::jsonb))
  loop
    insert into public.roster_entries (
      email, intended_role, class_id, roll_number, full_name, programme,
      year_of_study, section, created_by
    ) values (
      row_data->>'email',
      'STUDENT',
      p_class_id,
      row_data->>'rollNumber',
      row_data->>'fullName',
      row_data->>'programme',
      row_data->>'yearOfStudy',
      row_data->>'section',
      auth.uid()
    ) returning id into v_roster_id;

    select f.error_code, f.error_message into v_failure
    from public.roster_entry_provisioning_failure(v_roster_id) f;

    if v_failure.error_code is not null then
      insert into public.import_rows (import_id, row_number, raw_data, status, error_message)
      values (
        v_import_id, (row_data->>'rowNumber')::int, row_data, 'IMPORTED',
        format('Added to roster but not provisioned: [%s] %s', v_failure.error_code, v_failure.error_message)
      );

      v_needs_attention := v_needs_attention || jsonb_build_object(
        'rowNumber', (row_data->>'rowNumber')::int,
        'email', row_data->>'email',
        'errorCode', v_failure.error_code,
        'errorMessage', v_failure.error_message
      );
    else
      insert into public.import_rows (import_id, row_number, raw_data, status)
      values (v_import_id, (row_data->>'rowNumber')::int, row_data, 'IMPORTED');

      v_imported := v_imported + 1;
    end if;
  end loop;

  for row_data in select * from jsonb_array_elements(coalesce(p_existing_member_rows, '[]'::jsonb))
  loop
    insert into public.class_members (class_id, user_id, member_role, status)
    values (p_class_id, (row_data->>'profileId')::uuid, 'STUDENT', 'ACTIVE')
    on conflict (class_id, user_id) do nothing;

    insert into public.import_rows (import_id, row_number, raw_data, status)
    values (v_import_id, (row_data->>'rowNumber')::int, row_data, 'IMPORTED');

    v_imported := v_imported + 1;
  end loop;

  for row_data in select * from jsonb_array_elements(coalesce(p_rejected_rows, '[]'::jsonb))
  loop
    insert into public.import_rows (import_id, row_number, raw_data, status, error_message)
    values (
      v_import_id,
      (row_data->>'rowNumber')::int,
      row_data->'raw',
      'REJECTED',
      row_data->>'errorMessage'
    );

    v_rejected := v_rejected + 1;
  end loop;

  update public.imports set
    status = 'COMPLETED',
    summary = jsonb_build_object(
      'imported', v_imported,
      'needsAttention', jsonb_array_length(v_needs_attention),
      'rejected', v_rejected,
      'total', v_imported + jsonb_array_length(v_needs_attention) + v_rejected
    )
  where id = v_import_id;

  return jsonb_build_object(
    'importId', v_import_id,
    'imported', v_imported,
    'needsAttention', v_needs_attention,
    'rejected', v_rejected,
    'total', v_imported + jsonb_array_length(v_needs_attention) + v_rejected
  );
end;
$$;

-- ------------------------------------------------------------
-- 8. add_class_ta — 0028's version, now reporting what actually happened.
--    A pre-authorisation for someone who already has an auth account (but
--    no profile) is provisioned on the spot by the trigger, so the mode is
--    decided by reading the roster entry back rather than assumed:
--      ENROLLED        — they are a TA of this class now
--      PREAUTHORISED   — they become one at first sign-in
--      NEEDS_ATTENTION — they have an account but provisioning failed
--    The UPDATE branch (re-pointing an existing pending entry) fires no
--    INSERT trigger, so it calls provision_roster_entry itself.
-- ------------------------------------------------------------
create or replace function public.add_class_ta(
  p_class_id uuid,
  p_email text,
  p_full_name text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := nullif(trim(coalesce(p_full_name, '')), '');
  v_profile_id uuid;
  v_existing_role user_role;
  v_roster public.roster_entries%rowtype;
  v_roster_id uuid;
  v_provisioned boolean;
  v_failure record;
begin
  if not (public.is_professor_of_class(p_class_id) or public.is_admin()) then
    raise exception 'only this class''s professor can manage its teaching assistants';
  end if;

  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception '"%" is not an email address', p_email;
  end if;

  select p.id into v_profile_id from public.profiles p where p.email = v_email;

  if v_profile_id is not null then
    select cm.member_role into v_existing_role
    from public.class_members cm
    where cm.class_id = p_class_id and cm.user_id = v_profile_id;

    if v_existing_role = 'TA' then
      raise exception '% is already a teaching assistant for this class', v_email;
    end if;

    -- Nothing about their global profiles.role is touched: a professor
    -- assisting a colleague's class stays a PROFESSOR everywhere else.
    insert into public.class_members (class_id, user_id, member_role, status)
    values (p_class_id, v_profile_id, 'TA', 'ACTIVE')
    on conflict (class_id, user_id) do update
      set member_role = 'TA', status = 'ACTIVE';

    perform public.log_audit_event(
      'CLASS_TA_ADDED', 'class', p_class_id,
      jsonb_build_object(
        'email', v_email,
        'userId', v_profile_id,
        'previousMemberRole', v_existing_role
      )
    );

    return jsonb_build_object(
      'mode', 'ENROLLED', 'email', v_email, 'userId', v_profile_id
    );
  end if;

  -- No profile yet. Pre-authorise, exactly as a student roster row does.
  select * into v_roster from public.roster_entries re where re.email = v_email;

  if v_roster.id is not null then
    if v_roster.provisioned then
      raise exception
        '% has already been provisioned but has no profile — an administrator needs to look at that account', v_email;
    end if;
    if v_roster.class_id is not null and v_roster.class_id <> p_class_id then
      raise exception
        '% is already awaiting first sign-in on another class''s roster — remove them there first', v_email;
    end if;

    update public.roster_entries set
      intended_role = 'TA',
      class_id = p_class_id,
      full_name = coalesce(v_name, full_name),
      updated_at = now()
    where id = v_roster.id;

    v_roster_id := v_roster.id;
    perform public.provision_roster_entry(v_roster_id);
  else
    insert into public.roster_entries (
      email, intended_role, class_id, full_name, created_by
    ) values (
      v_email, 'TA', p_class_id, v_name, auth.uid()
    ) returning id into v_roster_id;
  end if;

  select re.provisioned into v_provisioned
  from public.roster_entries re
  where re.id = v_roster_id;

  if v_provisioned then
    select p.id into v_profile_id from public.profiles p where p.email = v_email;

    perform public.log_audit_event(
      'CLASS_TA_ADDED', 'class', p_class_id,
      jsonb_build_object('email', v_email, 'userId', v_profile_id, 'previousMemberRole', null)
    );

    return jsonb_build_object('mode', 'ENROLLED', 'email', v_email, 'userId', v_profile_id);
  end if;

  select pf.error_code, pf.error_message into v_failure
  from public.provisioning_failures pf
  where pf.roster_entry_id = v_roster_id
  order by pf.created_at desc
  limit 1;

  perform public.log_audit_event(
    'CLASS_TA_PREAUTHORISED', 'class', p_class_id,
    jsonb_build_object('email', v_email, 'provisioningError', v_failure.error_code)
  );

  if v_failure.error_code is not null then
    return jsonb_build_object('mode', 'NEEDS_ATTENTION', 'email', v_email, 'userId', null);
  end if;

  return jsonb_build_object('mode', 'PREAUTHORISED', 'email', v_email, 'userId', null);
end;
$$;

-- ------------------------------------------------------------
-- 9. Grants. Internal helpers are not API surface: they run from
--    triggers / security-definer callers (as their owner) or from an
--    operator with the service role. Supabase's default privileges hand
--    EXECUTE on new public functions to anon and authenticated, so take
--    it back explicitly.
-- ------------------------------------------------------------
revoke execute on function public.email_domain_allowed(text) from public, anon, authenticated;
revoke execute on function public.record_provisioning_failure(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.apply_roster_entry(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.provision_roster_entry(uuid) from public, anon, authenticated;
revoke execute on function public.provision_roster_entry_on_insert() from public, anon, authenticated;

grant execute on function public.provision_roster_entry(uuid) to service_role;

-- commit_roster_import is security invoker, so the importing professor/TA
-- needs to call this directly. It authorises per roster entry itself.
revoke execute on function public.roster_entry_provisioning_failure(uuid) from public, anon;
grant execute on function public.roster_entry_provisioning_failure(uuid) to authenticated;

-- Redefined above; restate so the grants live next to the definitions.
revoke execute on function public.commit_roster_import(uuid, text, text, jsonb, jsonb, jsonb) from anon;
grant execute on function public.commit_roster_import(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;
revoke execute on function public.add_class_ta(uuid, text, text) from anon;
grant execute on function public.add_class_ta(uuid, text, text) to authenticated;

comment on function public.provision_roster_entry(uuid) is
  'Provisions one pending roster_entries row immediately when its email already has an auth.users account (the person signed in before being rostered). Returns PROVISIONED, PENDING_SIGNUP, DOMAIN_NOT_ALLOWED, ALREADY_PROVISIONED or FAILED (recorded in provisioning_failures). Runs automatically on roster_entries INSERT; callable by service_role for repair.';
comment on function public.apply_roster_entry(uuid, uuid) is
  'The single roster_entries -> profiles/class_members mapping, shared by handle_new_user and provision_roster_entry so the two cannot drift. Never overwrites an existing profile.';
comment on function public.add_class_ta(uuid, text, text) is
  'Professor-only (or admin): makes an email a TA of ONE class. Writes class_members.member_role = ''TA'' when the person already has a profile; otherwise a roster_entries row with intended_role = ''TA'', which is provisioned on the spot if they already have an auth account. Returns mode ENROLLED, PREAUTHORISED or NEEDS_ATTENTION. Never modifies profiles.role of an existing account.';

-- ------------------------------------------------------------
-- 10. Backfill: rescue everyone already stuck (signed in before being
--     rostered). Rows whose person has never signed in stay pending;
--     failures land in provisioning_failures.
-- ------------------------------------------------------------
do $$
declare
  r record;
  v_result text;
  v_provisioned int := 0;
  v_pending int := 0;
  v_domain int := 0;
  v_failed int := 0;
begin
  for r in
    select re.id from public.roster_entries re where re.provisioned = false
  loop
    v_result := public.provision_roster_entry(r.id);
    case v_result
      when 'PROVISIONED' then v_provisioned := v_provisioned + 1;
      when 'PENDING_SIGNUP' then v_pending := v_pending + 1;
      when 'DOMAIN_NOT_ALLOWED' then v_domain := v_domain + 1;
      when 'FAILED' then v_failed := v_failed + 1;
      else null;
    end case;
  end loop;

  raise notice '0030 backfill: % provisioned, % still awaiting first sign-in, % outside the allowed domain, % failed (see provisioning_failures)',
    v_provisioned, v_pending, v_domain, v_failed;
end;
$$;

notify pgrst, 'reload schema';
