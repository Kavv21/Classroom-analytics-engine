-- 0005_class_roster_management.sql
-- Phase 3: class CRUD constraints + a transactional roster-import commit
-- path. Reference: /docs/DATABASE_SCHEMA.md, /plan/phase-3-class-roster.md.

-- ============================================================
-- CLASSES: restrict status to the two values the app actually uses.
-- (0001_init.sql left `status text default 'ACTIVE'` unconstrained.)
-- ============================================================

alter table classes
  add constraint classes_status_check check (status in ('ACTIVE', 'ARCHIVED'));

create index if not exists idx_imports_class on imports(class_id);

-- ============================================================
-- PROFILES: let a professor read (not write) the profile rows of students
-- already enrolled in one of their own classes. 0001_init.sql only had
-- profiles_select_own + profiles_admin_all — professors had no way to see
-- their own roster's names/emails, which Phase 3's class detail view and
-- student activation toggle both need. Scoped strictly to their own
-- classes' members, so this does not open up cross-class profile access.
-- ============================================================

create policy profiles_professor_class_students_select on profiles
  for select using (
    exists (
      select 1 from class_members cm
      join classes c on c.id = cm.class_id
      where cm.user_id = profiles.id and c.professor_id = auth.uid()
    )
  );

-- ============================================================
-- ROSTER IMPORT COMMIT
--
-- Roster import is "preview then commit": the app parses/validates the
-- uploaded file and classifies every row *before* calling this function
-- (see lib/roster/validate.ts). This function's only job is to make the
-- actual writes atomic — a single top-level function call is one Postgres
-- transaction, so any exception (e.g. a unique_violation racing against a
-- concurrent import of the same email) rolls back every insert, including
-- the `imports` row itself. Never partially import silently.
--
-- Three row buckets, matching RosterRowClassification in lib/types/domain.ts:
--   p_new_roster_rows      -> NEW: insert into roster_entries (pre-provisioning)
--   p_existing_member_rows -> EXISTING_PROFILE: the email already has a
--                              profiles row (provisioned earlier, for
--                              another class) -> enrol directly via
--                              class_members instead of touching
--                              roster_entries (whose email column is
--                              globally unique and would reject a second row).
--   p_rejected_rows        -> everything else (invalid / duplicate-in-file /
--                              duplicate-already-in-class /
--                              duplicate-pending-other-class) -> recorded in
--                              import_rows for the rejection report, no DB
--                              side effect otherwise.
--
-- security invoker (the default — stated explicitly): this function relies
-- on the caller's own RLS-checked access, it does not bypass it. The
-- explicit authorization check below is defense in depth, not a substitute
-- for RLS ("No RLS shortcuts" — CLAUDE.md).
-- ============================================================

create or replace function commit_roster_import(
  p_class_id uuid,
  p_source_filename text,
  p_source_checksum text,
  p_new_roster_rows jsonb,
  p_existing_member_rows jsonb,
  p_rejected_rows jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_import_id uuid;
  v_imported int := 0;
  v_rejected int := 0;
  row_data jsonb;
begin
  if not exists (
    select 1 from classes where id = p_class_id and professor_id = auth.uid()
  ) then
    raise exception 'not authorized to import a roster for this class';
  end if;

  insert into imports (
    class_id, import_type, source_filename, source_checksum, status, imported_by
  ) values (
    p_class_id, 'ROSTER', p_source_filename, p_source_checksum, 'PROCESSING', auth.uid()
  ) returning id into v_import_id;

  for row_data in select * from jsonb_array_elements(coalesce(p_new_roster_rows, '[]'::jsonb))
  loop
    insert into roster_entries (
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
    );

    insert into import_rows (import_id, row_number, raw_data, status)
    values (v_import_id, (row_data->>'rowNumber')::int, row_data, 'IMPORTED');

    v_imported := v_imported + 1;
  end loop;

  for row_data in select * from jsonb_array_elements(coalesce(p_existing_member_rows, '[]'::jsonb))
  loop
    insert into class_members (class_id, user_id, member_role, status)
    values (p_class_id, (row_data->>'profileId')::uuid, 'STUDENT', 'ACTIVE')
    on conflict (class_id, user_id) do nothing;

    insert into import_rows (import_id, row_number, raw_data, status)
    values (v_import_id, (row_data->>'rowNumber')::int, row_data, 'IMPORTED');

    v_imported := v_imported + 1;
  end loop;

  for row_data in select * from jsonb_array_elements(coalesce(p_rejected_rows, '[]'::jsonb))
  loop
    insert into import_rows (import_id, row_number, raw_data, status, error_message)
    values (
      v_import_id,
      (row_data->>'rowNumber')::int,
      row_data->'raw',
      'REJECTED',
      row_data->>'errorMessage'
    );

    v_rejected := v_rejected + 1;
  end loop;

  update imports set
    status = 'COMPLETED',
    summary = jsonb_build_object(
      'imported', v_imported,
      'rejected', v_rejected,
      'total', v_imported + v_rejected
    )
  where id = v_import_id;

  return jsonb_build_object(
    'importId', v_import_id,
    'imported', v_imported,
    'rejected', v_rejected,
    'total', v_imported + v_rejected
  );
end;
$$;

grant execute on function commit_roster_import(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;

-- ============================================================
-- CHECK_ROSTER_EMAILS
--
-- Roster-import duplicate detection needs a yes/no answer to "does this
-- email already have a profile, or a pending roster_entries row, anywhere
-- in the system" — not just within the importing professor's own classes
-- (roster_entries.email is globally unique, so a collision anywhere blocks
-- the insert). profiles_professor_class_students_select above is
-- intentionally scoped to the professor's own classes and cannot answer
-- that. This function is security definer for that reason, but it only
-- ever returns booleans — never another class's identity, another
-- student's name, or any other profile field — so it cannot be used to
-- browse students outside the caller's own class.
-- ============================================================

create or replace function check_roster_emails(p_class_id uuid, p_emails text[])
returns table (
  email text,
  has_profile boolean,
  profile_id uuid,
  already_class_member boolean,
  pending_this_class boolean,
  pending_other_class boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from classes where id = p_class_id and professor_id = auth.uid()
  ) then
    raise exception 'not authorized for this class';
  end if;

  return query
  select
    e.email,
    pr.id is not null,
    pr.id,
    exists (
      select 1 from class_members cm
      where cm.class_id = p_class_id and cm.user_id = pr.id
    ),
    exists (
      select 1 from roster_entries re
      where re.email = e.email and re.provisioned = false and re.class_id = p_class_id
    ),
    exists (
      select 1 from roster_entries re
      where re.email = e.email and re.provisioned = false
        and re.class_id is distinct from p_class_id
    )
  from unnest(p_emails) as e(email)
  left join profiles pr on pr.email = e.email;
end;
$$;

grant execute on function check_roster_emails(uuid, text[]) to authenticated;

-- ============================================================
-- SET_STUDENT_ACTIVE
--
-- Student activation/deactivation (Phase 3 backend task). Writes only
-- profiles.is_active — never role, email, or any other column — so this
-- narrowly-scoped security definer function is the sanctioned path instead
-- of a blanket professor UPDATE policy on `profiles` (which RLS cannot
-- restrict to a single column on its own).
-- ============================================================

create or replace function set_student_active(
  p_class_id uuid,
  p_profile_id uuid,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from classes where id = p_class_id and professor_id = auth.uid()
  ) then
    raise exception 'not authorized for this class';
  end if;

  if not exists (
    select 1 from class_members where class_id = p_class_id and user_id = p_profile_id
  ) then
    raise exception 'student is not a member of this class';
  end if;

  update profiles set is_active = p_is_active, updated_at = now() where id = p_profile_id;
end;
$$;

grant execute on function set_student_active(uuid, uuid, boolean) to authenticated;
