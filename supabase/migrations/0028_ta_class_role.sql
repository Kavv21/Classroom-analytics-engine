-- ============================================================
-- 0028 — Teaching assistants, scoped to one class.
--
-- THE MODEL
--
-- A TA is a `class_members` row with `member_role = 'TA'` — the same kind
-- of object as a student's enrolment, and nothing else. It says "this
-- person assists THIS class". It is not a property of the person: someone
-- can be a PROFESSOR of their own classes and a TA of somebody else's at
-- the same time, and adding or removing a TA never rewrites their
-- `profiles.role`.
--
-- `profiles.role = 'TA'` exists (0027) for exactly one reason — a person
-- invited as a TA who has never signed in has no `profiles` row for a
-- `class_members` row to reference, so their pre-authorisation is a
-- `roster_entries` row with `intended_role = 'TA'`, and `handle_new_user`
-- copies that value into BOTH `profiles.role` and
-- `class_members.member_role` at first sign-in. The `profiles.role` copy
-- is an identity label with no authority attached: nothing in this schema
-- reads it to decide anything. Every TA permission below is decided by
-- `is_ta_of_class(class_id)`, which reads `class_members` and only
-- `class_members`.
--
-- THE TWO HELPERS
--
-- `is_ta_of_class` follows the 0008 pattern exactly (security definer,
-- pinned search_path, schema-qualified, boolean and single-class so it
-- short-circuits per row instead of materialising a set).
--
-- `can_manage_class_content` is `is_professor_of_class OR is_ta_of_class`,
-- and it is the ONLY thing every professor-equivalent call site is allowed
-- to ask. Auditing "who may manage this class's content" then means
-- grepping for one name, and the two authorisation paths cannot drift
-- apart, because there is only one place where the OR is written down.
--
-- THE TWO THINGS A TA CANNOT DO, AND WHERE EACH IS ENFORCED
--
--   1. Touch the CLASS itself — archive it, restore it, delete it, or hand
--      it to another professor. `delete_class_permanently` and
--      `class_deletion_counts` (0025) keep their `is_professor_of_class`
--      gate, unchanged. Archive/restore is not an RPC — it is a plain
--      UPDATE of `classes.status` — so it is enforced by the
--      `classes_status_authority` trigger in §2, at the row level, for
--      every writer. Hiding the button is UX; the trigger is the boundary.
--      Assignment-level archive/unarchive/delete is NOT restricted: a TA
--      keeps `unarchive_assignment` and `delete_assignment_permanently`.
--
--   2. Manage other TAs. `class_members` and `roster_entries` both get TA
--      policies that are predicated on the ROW's role being 'STUDENT', so
--      a TA can import, enrol, edit and remove students all day and cannot
--      insert, promote, demote or delete a TA row — the USING clause hides
--      the TA rows from the write and the WITH CHECK clause refuses the TA
--      rows on the way in. Adding and removing TAs goes through
--      `add_class_ta` / `remove_class_ta` (§8), which are gated on
--      professor-or-admin.
--
-- POLICY RENAMES
--
-- Policies whose authority genuinely widened are renamed
-- `*_professor_*` -> `*_staff_*`, because a policy called
-- `assignments_professor_manage` that also admits TAs is a policy that
-- lies to the next person reading `pg_policies`. Policies that stayed
-- professor-only keep their names.
-- ============================================================

-- ============================================================
-- 1. HELPERS
-- ============================================================

create or replace function public.is_ta_of_class(p_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.class_members
    where class_id = p_class_id
      and user_id = auth.uid()
      and member_role = 'TA'
      and status = 'ACTIVE'
  );
$$;

comment on function public.is_ta_of_class(uuid) is
  'True when the caller has an ACTIVE class_members row with member_role = ''TA'' for this class. Reads class_members only — profiles.role is never consulted, because TA authority is per-class and a TA''s global role may be anything.';

create or replace function public.can_manage_class_content(p_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.is_professor_of_class(p_class_id)
      or public.is_ta_of_class(p_class_id);
$$;

comment on function public.can_manage_class_content(uuid) is
  'The professor-equivalent gate: this class''s professor, or one of its TAs. Every policy and RPC where a TA has the same authority as the professor calls THIS, never the OR spelled out inline, so the two paths cannot drift apart. Deleting/archiving the class itself and managing other TAs deliberately do NOT use it.';

-- The profiles counterpart of is_professor_of_student (0008): a TA may
-- read the profile of anyone enrolled in a class they assist. The
-- class_members join happens inside the security definer body so neither
-- table's RLS is re-entered while profiles' RLS is being resolved — the
-- 42P17 lesson from 0008, which applies to any new profiles policy.
create or replace function public.is_ta_of_person(p_person_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.class_members member
    join public.class_members ta on ta.class_id = member.class_id
    where member.user_id = p_person_id
      and ta.user_id = auth.uid()
      and ta.member_role = 'TA'
      and ta.status = 'ACTIVE'
  );
$$;

comment on function public.is_ta_of_person(uuid) is
  'True when the caller is an ACTIVE TA of some class this person is also a member of. Backs profiles_ta_class_members_select, the TA equivalent of profiles_professor_class_students_select.';

revoke execute on function public.is_ta_of_class(uuid) from anon;
revoke execute on function public.can_manage_class_content(uuid) from anon;
revoke execute on function public.is_ta_of_person(uuid) from anon;

grant execute on function public.is_ta_of_class(uuid) to authenticated, service_role;
grant execute on function public.can_manage_class_content(uuid) to authenticated, service_role;
grant execute on function public.is_ta_of_person(uuid) to authenticated, service_role;

-- ============================================================
-- 2. EXCLUSION 1 — the class itself.
--
-- A TA needs to edit class details (name, course, term, dates) the same
-- way a professor does, which means an UPDATE policy on `classes`. But
-- `status` lives on the same row, and archiving IS a write to that column
-- — there is no RPC in front of it to gate. RLS cannot say "these columns
-- but not that one", and WITH CHECK cannot see the old row, so "the status
-- did not change" is not expressible as a policy at all.
--
-- A BEFORE UPDATE trigger can see both rows, so that is where it goes.
-- `professor_id` is guarded by the same trigger for the same reason:
-- handing the class to somebody else is a bigger act than archiving it.
--
-- The trigger enforces only for `authenticated`, the role PostgREST
-- switches to for a signed-in end user. `service_role` (the seed scripts
-- and the integration harness) and the migration role are server-side
-- paths that already bypass RLS entirely; making them fail here would be a
-- new restriction on trusted code, not a boundary. `anon` cannot reach
-- this table at all — the revoke below is restated for the same
-- belt-and-braces reason 0024 gives.
-- ============================================================

create or replace function public.enforce_class_status_authority()
returns trigger
language plpgsql
as $$
begin
  if current_user <> 'authenticated' then
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (public.is_professor_of_class(old.id) or public.is_admin()) then
      raise exception
        'only this class''s professor can archive or restore it (attempted % -> %)',
        old.status, new.status;
    end if;
  end if;

  if new.professor_id is distinct from old.professor_id then
    if not (public.is_professor_of_class(old.id) or public.is_admin()) then
      raise exception 'only this class''s professor can reassign it';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.enforce_class_status_authority() is
  'Archiving/restoring a class, and reassigning it to another professor, are professor-only. Both are plain column writes with no RPC in front of them, and RLS cannot compare the old row to the new one — so the rule lives in a BEFORE UPDATE trigger, where it applies to every writer including a TA with a legitimate UPDATE policy on the same row.';

drop trigger if exists classes_status_authority on public.classes;
create trigger classes_status_authority
  before update on public.classes
  for each row execute function public.enforce_class_status_authority();

revoke insert, update, delete on public.classes from anon;

-- A TA reads `classes` through classes_member_select (0008) already —
-- they are a class_members row. This adds the UPDATE half, for the class
-- details form. No DELETE: `for update` only, and delete_class_permanently
-- keeps its own professor gate.
drop policy if exists classes_ta_update on public.classes;
create policy classes_ta_update on public.classes
  for update
  using (is_ta_of_class(classes.id))
  with check (is_ta_of_class(classes.id));

-- ============================================================
-- 3. EXCLUSION 2 — who may be a TA.
--
-- The professor's own policy is untouched: `is_professor_of_class`, FOR
-- ALL, every row. The TA's policy is restricted to rows whose member_role
-- is 'STUDENT', on BOTH sides:
--
--   INSERT  — WITH CHECK refuses a new TA row.
--   UPDATE  — USING refuses to select a TA row to update (no demotion),
--             WITH CHECK refuses a row that would become one (no
--             promotion of a student to TA).
--   DELETE  — USING refuses a TA row.
--   SELECT  — a TA sees the class's student rows plus, via
--             class_members_self_select (0001), their own.
-- ============================================================

drop policy if exists class_members_ta_manage_students on public.class_members;
create policy class_members_ta_manage_students on public.class_members
  for all
  using (
    class_members.member_role = 'STUDENT'
    and is_ta_of_class(class_members.class_id)
  )
  with check (
    class_members.member_role = 'STUDENT'
    and is_ta_of_class(class_members.class_id)
  );

-- Same rule one step earlier in the funnel: a pending roster entry is a
-- class_members row that has not happened yet, so a TA may create, edit
-- and withdraw pending STUDENTS and no pending TA. The professor's
-- roster_entries_professor_manage (0008) also covers `class_id is null`
-- (the admin's class-less staff pre-authorisation); a TA's authority is
-- always scoped to one class, so that branch is deliberately absent here.
drop policy if exists roster_entries_ta_manage_students on public.roster_entries;
create policy roster_entries_ta_manage_students on public.roster_entries
  for all
  using (
    roster_entries.class_id is not null
    and roster_entries.intended_role = 'STUDENT'
    and is_ta_of_class(roster_entries.class_id)
  )
  with check (
    roster_entries.class_id is not null
    and roster_entries.intended_role = 'STUDENT'
    and is_ta_of_class(roster_entries.class_id)
  );

-- ============================================================
-- 4. profiles — a TA reads their class's people, exactly as the professor
--    does. SELECT only; profiles is never TA-writable, and the one column
--    a TA may flip (is_active) still goes through set_student_active (§7).
-- ============================================================

drop policy if exists profiles_ta_class_members_select on public.profiles;
create policy profiles_ta_class_members_select on public.profiles
  for select using (is_ta_of_person(profiles.id));

-- ============================================================
-- 5. The class-content tables. Each of these was
--    `is_professor_of_class(...)` and is now
--    `can_manage_class_content(...)`, with nothing else changed — same
--    shape, same subquery, same FOR ALL / FOR SELECT split. The student
--    policies (assignments_student_select, questions_student_select,
--    attempts_student_select, responses_student_select) are NOT touched
--    anywhere in this migration.
-- ============================================================

drop policy if exists assignments_professor_manage on public.assignments;
drop policy if exists assignments_staff_manage on public.assignments;
create policy assignments_staff_manage on public.assignments
  for all using (can_manage_class_content(assignments.class_id));

drop policy if exists questions_professor_manage on public.questions;
drop policy if exists questions_staff_manage on public.questions;
create policy questions_staff_manage on public.questions
  for all using (
    exists (
      select 1 from public.assignments a
      where a.id = questions.assignment_id
        and can_manage_class_content(a.class_id)
    )
  );

drop policy if exists attempts_professor_select on public.assignment_attempts;
drop policy if exists attempts_staff_select on public.assignment_attempts;
create policy attempts_staff_select on public.assignment_attempts
  for select using (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_attempts.assignment_id
        and can_manage_class_content(a.class_id)
    )
  );

drop policy if exists responses_professor_select on public.responses;
drop policy if exists responses_staff_select on public.responses;
create policy responses_staff_select on public.responses
  for select using (
    exists (
      select 1 from public.assignments a
      where a.id = responses.assignment_id
        and can_manage_class_content(a.class_id)
    )
  );

-- imports / import_rows keep their professor policy (it carries the
-- `class_id is null` branch, which is not a TA's to have) and gain a
-- class-scoped TA policy beside it. Roster and assignment imports both
-- write here, so a TA without this cannot import anything.
drop policy if exists imports_ta on public.imports;
create policy imports_ta on public.imports
  for all
  using (imports.class_id is not null and is_ta_of_class(imports.class_id))
  with check (imports.class_id is not null and is_ta_of_class(imports.class_id));

drop policy if exists import_rows_ta on public.import_rows;
create policy import_rows_ta on public.import_rows
  for all
  using (
    exists (
      select 1 from public.imports i
      where i.id = import_rows.import_id
        and i.class_id is not null
        and is_ta_of_class(i.class_id)
    )
  )
  with check (
    exists (
      select 1 from public.imports i
      where i.id = import_rows.import_id
        and i.class_id is not null
        and is_ta_of_class(i.class_id)
    )
  );

-- ============================================================
-- 6. Saved queries / visualisations / dashboards (0014).
--
-- 0014's rule was "the creator, AND the class is mine or the row is
-- class-less". Only the second half moves: a TA may save a view against a
-- class they assist. Ownership is unchanged — a TA does not inherit the
-- professor's saved views, and the professor does not inherit theirs.
-- dashboard_items_owner is untouched: it authorises through
-- owns_dashboard, which is already creator-scoped.
-- ============================================================

drop policy if exists saved_queries_owner on public.saved_queries;
create policy saved_queries_owner on public.saved_queries
  for all
  using (
    created_by = auth.uid()
    and (class_id is null or can_manage_class_content(class_id))
  )
  with check (
    created_by = auth.uid()
    and (class_id is null or can_manage_class_content(class_id))
  );

drop policy if exists saved_visualisations_owner on public.saved_visualisations;
create policy saved_visualisations_owner on public.saved_visualisations
  for all
  using (
    created_by = auth.uid()
    and (class_id is null or can_manage_class_content(class_id))
  )
  with check (
    created_by = auth.uid()
    and (class_id is null or can_manage_class_content(class_id))
  );

drop policy if exists dashboards_owner on public.dashboards;
create policy dashboards_owner on public.dashboards
  for all
  using (
    created_by = auth.uid()
    and (class_id is null or can_manage_class_content(class_id))
  )
  with check (
    created_by = auth.uid()
    and (class_id is null or can_manage_class_content(class_id))
  );

-- ============================================================
-- 7. RPCs. Every body below is its previous version verbatim with the
--    authorisation line swapped; nothing else in any of them changes.
--    The two class-level ones (class_deletion_counts,
--    delete_class_permanently, 0025) are NOT here — that is exclusion 1.
-- ============================================================

-- --- 0005: roster ---

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
    );

    insert into public.import_rows (import_id, row_number, raw_data, status)
    values (v_import_id, (row_data->>'rowNumber')::int, row_data, 'IMPORTED');

    v_imported := v_imported + 1;
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

create or replace function public.check_roster_emails(p_class_id uuid, p_emails text[])
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
  if not public.can_manage_class_content(p_class_id) then
    raise exception 'not authorized for this class';
  end if;

  return query
  select
    e.email,
    pr.id is not null,
    pr.id,
    exists (
      select 1 from public.class_members cm
      where cm.class_id = p_class_id and cm.user_id = pr.id
    ),
    exists (
      select 1 from public.roster_entries re
      where re.email = e.email and re.provisioned = false and re.class_id = p_class_id
    ),
    exists (
      select 1 from public.roster_entries re
      where re.email = e.email and re.provisioned = false
        and re.class_id is distinct from p_class_id
    )
  from unnest(p_emails) as e(email)
  left join public.profiles pr on pr.email = e.email;
end;
$$;

-- set_student_active writes profiles.is_active — a GLOBAL column, on a row
-- that may also be a TA of this very class. So the TA path is narrowed
-- beyond can_manage_class_content: a TA may deactivate students, and only
-- students. Otherwise two TAs of one class could switch each other off,
-- which is managing another TA by a different door.
create or replace function public.set_student_active(
  p_class_id uuid,
  p_profile_id uuid,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_role user_role;
begin
  if not public.can_manage_class_content(p_class_id) then
    raise exception 'not authorized for this class';
  end if;

  select cm.member_role into v_member_role
  from public.class_members cm
  where cm.class_id = p_class_id and cm.user_id = p_profile_id;

  if v_member_role is null then
    raise exception 'student is not a member of this class';
  end if;

  if v_member_role <> 'STUDENT' and not public.is_professor_of_class(p_class_id) then
    raise exception 'only this class''s professor can deactivate a teaching assistant';
  end if;

  update public.profiles set is_active = p_is_active, updated_at = now()
  where id = p_profile_id;
end;
$$;

-- --- 0009: assignment import ---

create or replace function public.commit_assignment_import(
  p_assignment_id uuid,
  p_source_filename text,
  p_source_checksum text,
  p_source_worksheet text,
  p_questions jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_class_id uuid;
  v_status assignment_status;
  v_import_id uuid;
  v_count int := 0;
  q jsonb;
begin
  select a.class_id, a.status into v_class_id, v_status
  from public.assignments a
  where a.id = p_assignment_id and public.can_manage_class_content(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  if v_status <> 'DRAFT' then
    raise exception 'questions can only be imported while the assignment is in DRAFT (current status: %)', v_status;
  end if;

  if public.assignment_has_responses(p_assignment_id) then
    raise exception 'assignment already has responses — version the assignment instead of re-importing';
  end if;

  if p_questions is null or jsonb_array_length(p_questions) = 0 then
    raise exception 'import contains no questions';
  end if;

  insert into public.imports (
    class_id, assignment_id, import_type, source_filename, source_checksum,
    status, imported_by
  ) values (
    v_class_id, p_assignment_id, 'ASSIGNMENT', p_source_filename,
    p_source_checksum, 'PROCESSING', auth.uid()
  ) returning id into v_import_id;

  delete from public.questions where assignment_id = p_assignment_id;

  for q in select * from jsonb_array_elements(p_questions)
  loop
    if coalesce(trim(q->>'externalQuestionCode'), '') = '' then
      raise exception 'import row %: missing external question code', q->>'rowNumber';
    end if;
    if coalesce(q->>'questionText', '') = '' then
      raise exception 'import row %: blank question text for %', q->>'rowNumber', q->>'externalQuestionCode';
    end if;
    if (q->>'displayOrder') is null then
      raise exception 'import row %: missing display order for %', q->>'rowNumber', q->>'externalQuestionCode';
    end if;

    insert into public.questions (
      assignment_id, external_question_code, original_worksheet,
      original_row_reference, original_column_reference, question_text,
      energy_source, criterion, concept, response_zero_label,
      response_one_label, display_order, raw_source_payload
    ) values (
      p_assignment_id,
      q->>'externalQuestionCode',
      p_source_worksheet,
      q->>'originalRowReference',
      q->>'originalColumnReference',
      q->>'questionText',
      nullif(q->>'energySource', ''),
      nullif(q->>'criterion', ''),
      nullif(q->>'concept', ''),
      coalesce(nullif(q->>'responseZeroLabel', ''), 'No (0)'),
      coalesce(nullif(q->>'responseOneLabel', ''), 'Yes (1)'),
      (q->>'displayOrder')::int,
      q->'raw'
    );

    insert into public.import_rows (import_id, row_number, raw_data, status)
    values (v_import_id, coalesce((q->>'rowNumber')::int, v_count + 1), q, 'IMPORTED');

    v_count := v_count + 1;
  end loop;

  update public.imports set
    status = 'COMPLETED',
    summary = jsonb_build_object('imported', v_count, 'worksheet', p_source_worksheet)
  where id = v_import_id;

  perform public.log_audit_event(
    'ASSIGNMENT_IMPORTED', 'assignment', p_assignment_id,
    jsonb_build_object('importId', v_import_id, 'questionCount', v_count, 'filename', p_source_filename)
  );

  return jsonb_build_object('importId', v_import_id, 'imported', v_count);
end;
$$;

create or replace function public.record_failed_assignment_import(
  p_assignment_id uuid,
  p_source_filename text,
  p_source_checksum text,
  p_error_rows jsonb
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_class_id uuid;
  v_import_id uuid;
  r jsonb;
begin
  select a.class_id into v_class_id
  from public.assignments a
  where a.id = p_assignment_id and public.can_manage_class_content(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  insert into public.imports (
    class_id, assignment_id, import_type, source_filename, source_checksum,
    status, imported_by, summary
  ) values (
    v_class_id, p_assignment_id, 'ASSIGNMENT', p_source_filename,
    p_source_checksum, 'FAILED', auth.uid(),
    jsonb_build_object('rejected', jsonb_array_length(coalesce(p_error_rows, '[]'::jsonb)))
  ) returning id into v_import_id;

  for r in select * from jsonb_array_elements(coalesce(p_error_rows, '[]'::jsonb))
  loop
    insert into public.import_rows (import_id, row_number, raw_data, status, error_message)
    values (
      v_import_id,
      coalesce((r->>'rowNumber')::int, 0),
      coalesce(r->'raw', r),
      'REJECTED',
      r->>'errorMessage'
    );
  end loop;

  return v_import_id;
end;
$$;

-- --- 0023: duplicate an assignment ---

create or replace function public.duplicate_assignment(p_assignment_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_new_id uuid;
  v_class_id uuid;
  v_sequence_number int;
begin
  select a.class_id into v_class_id
  from public.assignments a
  where a.id = p_assignment_id and public.can_manage_class_content(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  v_sequence_number := public.next_assignment_sequence_number(v_class_id);

  insert into public.assignments (
    class_id, title, description, instructions, assignment_stage,
    sequence_number, open_at, close_at, status, allow_draft_editing,
    allow_resubmission, response_zero_label, response_one_label, created_by
  )
  select
    a.class_id, a.title || ' (copy)', a.description, a.instructions,
    a.assignment_stage, v_sequence_number, null, null, 'DRAFT',
    a.allow_draft_editing, a.allow_resubmission, a.response_zero_label,
    a.response_one_label, auth.uid()
  from public.assignments a
  where a.id = p_assignment_id
  returning id into v_new_id;

  insert into public.questions (
    assignment_id, external_question_code, original_worksheet,
    original_row_reference, original_column_reference, question_text,
    energy_source, criterion, concept, response_zero_label,
    response_one_label, display_order, is_active, raw_source_payload
  )
  select
    v_new_id,
    case
      when q.external_question_code ~ '^A\d+-'
        then 'A' || v_sequence_number::text || substring(q.external_question_code from position('-' in q.external_question_code))
      else q.external_question_code
    end,
    q.original_worksheet,
    q.original_row_reference, q.original_column_reference, q.question_text,
    q.energy_source, q.criterion, q.concept, q.response_zero_label,
    q.response_one_label, q.display_order, q.is_active, q.raw_source_payload
  from public.questions q
  where q.assignment_id = p_assignment_id;

  perform public.log_audit_event(
    'ASSIGNMENT_DUPLICATED', 'assignment', v_new_id,
    jsonb_build_object('sourceAssignmentId', p_assignment_id)
  );

  return v_new_id;
end;
$$;

-- --- 0024: reopening ---

create or replace function public.reopen_attempt(
  p_attempt_id uuid,
  p_assignment_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.assignment_attempts%rowtype;
  v_status public.assignment_status;
begin
  if p_assignment_id is null then
    raise exception 'reopening needs the assignment it belongs to';
  end if;

  select att.* into v_attempt
  from public.assignment_attempts att
  join public.assignments a on a.id = att.assignment_id
  where att.id = p_attempt_id
    and att.assignment_id = p_assignment_id
    and public.can_manage_class_content(a.class_id)
  for update of att;

  if v_attempt.id is null then
    raise exception 'attempt not found on that assignment, or you do not manage its class';
  end if;

  select a.status into v_status
  from public.assignments a
  where a.id = v_attempt.assignment_id;

  if v_attempt.state <> 'SUBMITTED' then
    raise exception 'only a SUBMITTED attempt can be reopened (current state: %)', v_attempt.state;
  end if;

  if v_status not in ('OPEN', 'CLOSED') then
    raise exception 'an attempt on a % assignment cannot be reopened — the student would have nowhere to answer', v_status;
  end if;

  update public.assignment_attempts set
    state = 'REOPENED',
    reopened_at = now(),
    reopened_by = auth.uid(),
    updated_at = now()
  where id = p_attempt_id;

  update public.responses set
    is_final = false,
    updated_at = now()
  where attempt_id = p_attempt_id;

  perform public.log_audit_event(
    'ATTEMPT_REOPENED', 'assignment_attempt', p_attempt_id,
    jsonb_build_object(
      'assignmentId', v_attempt.assignment_id,
      'studentId', v_attempt.student_id,
      'submissionVersion', v_attempt.submission_version,
      'assignmentStatus', v_status
    )
  );

  return jsonb_build_object('attemptId', p_attempt_id, 'state', 'REOPENED');
end;
$$;

create or replace function public.reopen_assignment_attempts(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.assignment_status;
  v_class_id uuid;
  v_attempt record;
  v_reopened int := 0;
begin
  select a.status, a.class_id into v_status, v_class_id
  from public.assignments a
  where a.id = p_assignment_id
    and public.can_manage_class_content(a.class_id);

  if v_status is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  if v_status not in ('OPEN', 'CLOSED') then
    raise exception 'attempts on a % assignment cannot be reopened — the students would have nowhere to answer', v_status;
  end if;

  for v_attempt in
    select att.id, att.student_id, att.submission_version
    from public.assignment_attempts att
    where att.assignment_id = p_assignment_id
      and att.state = 'SUBMITTED'
    order by att.id
    for update
  loop
    update public.assignment_attempts set
      state = 'REOPENED',
      reopened_at = now(),
      reopened_by = auth.uid(),
      updated_at = now()
    where id = v_attempt.id;

    update public.responses set
      is_final = false,
      updated_at = now()
    where attempt_id = v_attempt.id;

    perform public.log_audit_event(
      'ATTEMPT_REOPENED', 'assignment_attempt', v_attempt.id,
      jsonb_build_object(
        'assignmentId', p_assignment_id,
        'studentId', v_attempt.student_id,
        'submissionVersion', v_attempt.submission_version,
        'assignmentStatus', v_status,
        'bulk', true
      )
    );

    v_reopened := v_reopened + 1;
  end loop;

  perform public.log_audit_event(
    'ASSIGNMENT_ATTEMPTS_REOPENED', 'assignment', p_assignment_id,
    jsonb_build_object(
      'classId', v_class_id,
      'reopenedCount', v_reopened,
      'assignmentStatus', v_status
    )
  );

  return jsonb_build_object('assignmentId', p_assignment_id, 'reopened', v_reopened);
end;
$$;

-- --- 0025: assignment-level archive/delete (class-level stays professor-only) ---

create or replace function public.assignment_deletion_counts(p_assignment_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'assignmentId', a.id,
    'classId', a.class_id,
    'title', a.title,
    'status', a.status,
    'sequenceNumber', a.sequence_number,
    'questions', (
      select count(*) from public.questions q where q.assignment_id = a.id
    ),
    'responses', (
      select count(*) from public.responses r where r.assignment_id = a.id
    ),
    'attempts', (
      select count(*) from public.assignment_attempts att
      where att.assignment_id = a.id
    ),
    'students', (
      select count(distinct att.student_id) from public.assignment_attempts att
      where att.assignment_id = a.id
    ),
    'imports', (
      select count(*) from public.imports i where i.assignment_id = a.id
    )
  )
  from public.assignments a
  where a.id = p_assignment_id
    and public.can_manage_class_content(a.class_id);
$$;

comment on function public.assignment_deletion_counts(uuid) is
  'Exactly what delete_assignment_permanently would destroy. Returns NULL when the assignment does not exist or the caller does not manage its class (its professor, or one of its TAs) — callers must treat NULL as "no access", not as "nothing to delete".';

create or replace function public.unarchive_assignment(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment public.assignments%rowtype;
begin
  select a.* into v_assignment
  from public.assignments a
  where a.id = p_assignment_id
    and public.can_manage_class_content(a.class_id)
  for update;

  if v_assignment.id is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  if v_assignment.status <> 'ARCHIVED' then
    raise exception 'only an ARCHIVED assignment can be unarchived (current status: %)',
      v_assignment.status;
  end if;

  if exists (
    select 1 from public.assignments other
    where other.class_id = v_assignment.class_id
      and other.sequence_number = v_assignment.sequence_number
      and other.id <> v_assignment.id
      and other.status <> 'ARCHIVED'
  ) then
    raise exception
      'another assignment in this class now occupies position % — move or archive it before restoring this one',
      v_assignment.sequence_number;
  end if;

  alter table public.assignments disable trigger assignments_status_transition;

  update public.assignments set
    status = 'CLOSED',
    updated_at = now()
  where id = p_assignment_id;

  alter table public.assignments enable trigger assignments_status_transition;

  perform public.log_audit_event(
    'ASSIGNMENT_UNARCHIVED', 'assignment', p_assignment_id,
    jsonb_build_object(
      'classId', v_assignment.class_id,
      'title', v_assignment.title,
      'from', 'ARCHIVED',
      'to', 'CLOSED'
    )
  );

  return jsonb_build_object('assignmentId', p_assignment_id, 'status', 'CLOSED');
end;
$$;

comment on function public.unarchive_assignment(uuid) is
  'ARCHIVED -> CLOSED for this class''s professor or one of its TAs — the one transition the assignments_status_transition FSM deliberately does not carry. Restores to CLOSED, never to OPEN: letting students back in is a separate decision. Archiving the CLASS is a different act and stays professor-only.';

create or replace function public.delete_assignment_permanently(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_counts jsonb;
begin
  select a.class_id into v_class_id
  from public.assignments a
  where a.id = p_assignment_id
    and public.can_manage_class_content(a.class_id)
  for update;

  if v_class_id is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  v_counts := public.assignment_deletion_counts(p_assignment_id);

  perform public.log_audit_event(
    'ASSIGNMENT_DELETED_PERMANENTLY', 'assignment', p_assignment_id, v_counts
  );

  alter table public.questions disable trigger questions_immutable_after_responses;

  delete from public.assignments where id = p_assignment_id;

  alter table public.questions enable trigger questions_immutable_after_responses;

  return v_counts;
end;
$$;

comment on function public.delete_assignment_permanently(uuid) is
  'Irreversible, for this class''s professor or one of its TAs: removes an assignment and — through the FK cascade — its questions, attempts, responses and import history, whatever its status or response count. Writes the full census to audit_logs BEFORE deleting. Deleting the CLASS is a strictly larger act and stays professor-only (delete_class_permanently).';

-- ============================================================
-- 8. Managing TAs — professor (or admin) only.
--
-- Both functions are SECURITY DEFINER for one specific reason: adding a TA
-- by email needs a `profiles` lookup by email across the whole table, and
-- a professor's RLS on profiles is scoped to their own classes' members —
-- which a person who is not yet in the class is, by definition, not. The
-- functions return no profile field other than the id they act on, so
-- neither can be used to browse accounts.
--
-- Two paths, mirroring the roster import's NEW / EXISTING_PROFILE split:
--   * they already have an account anywhere -> class_members row directly;
--   * they have never signed in -> a roster_entries row with
--     intended_role = 'TA', consumed by handle_new_user at first sign-in.
-- ============================================================

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

  -- No account yet. Pre-authorise, exactly as a student roster row does.
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
  else
    insert into public.roster_entries (
      email, intended_role, class_id, full_name, created_by
    ) values (
      v_email, 'TA', p_class_id, v_name, auth.uid()
    );
  end if;

  perform public.log_audit_event(
    'CLASS_TA_PREAUTHORISED', 'class', p_class_id,
    jsonb_build_object('email', v_email)
  );

  return jsonb_build_object('mode', 'PREAUTHORISED', 'email', v_email, 'userId', null);
end;
$$;

comment on function public.add_class_ta(uuid, text, text) is
  'Professor-only (or admin): makes an email a TA of ONE class. Writes class_members.member_role = ''TA'' when the person already has an account, or a pending roster_entries row with intended_role = ''TA'' when they have never signed in. Never modifies profiles.role of an existing account — TA-ness belongs to the class, not to the person.';

create or replace function public.remove_class_ta(
  p_class_id uuid,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_removed_membership int := 0;
  v_removed_pending int := 0;
begin
  if not (public.is_professor_of_class(p_class_id) or public.is_admin()) then
    raise exception 'only this class''s professor can manage its teaching assistants';
  end if;

  -- The membership goes entirely rather than being demoted to STUDENT:
  -- a TA was never enrolled as a student of this class, and silently
  -- turning them into one would put them in the roster and the analytics
  -- denominators. If they should also be a student here, import them.
  with removed as (
    delete from public.class_members cm
    using public.profiles p
    where cm.class_id = p_class_id
      and cm.user_id = p.id
      and p.email = v_email
      and cm.member_role = 'TA'
    returning cm.id
  )
  select count(*) into v_removed_membership from removed;

  with removed as (
    delete from public.roster_entries re
    where re.class_id = p_class_id
      and re.email = v_email
      and re.intended_role = 'TA'
      and re.provisioned = false
    returning re.id
  )
  select count(*) into v_removed_pending from removed;

  if v_removed_membership = 0 and v_removed_pending = 0 then
    raise exception '% is not a teaching assistant for this class', v_email;
  end if;

  perform public.log_audit_event(
    'CLASS_TA_REMOVED', 'class', p_class_id,
    jsonb_build_object(
      'email', v_email,
      'removedMembership', v_removed_membership > 0,
      'removedPending', v_removed_pending > 0
    )
  );

  return jsonb_build_object(
    'email', v_email,
    'removedMembership', v_removed_membership > 0,
    'removedPending', v_removed_pending > 0
  );
end;
$$;

comment on function public.remove_class_ta(uuid, text) is
  'Professor-only (or admin): removes a TA from ONE class, whether they are an enrolled class_members row or still a pending roster_entries row. Their account, and their memberships of every other class, are untouched.';

-- ============================================================
-- 9. Grants. anon has no business calling any of these.
-- ============================================================

revoke execute on function public.add_class_ta(uuid, text, text) from anon;
revoke execute on function public.remove_class_ta(uuid, text) from anon;

grant execute on function public.add_class_ta(uuid, text, text) to authenticated;
grant execute on function public.remove_class_ta(uuid, text) to authenticated;

notify pgrst, 'reload schema';
