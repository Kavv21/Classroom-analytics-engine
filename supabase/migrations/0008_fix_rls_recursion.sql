-- 0008_fix_rls_recursion.sql
-- Fixes 42P17 "infinite recursion detected in policy for relation
-- class_members" (and latent recursion on every table that joins through
-- classes/class_members). Reference: /docs/DATABASE_SCHEMA.md.
--
-- ROOT CAUSE
-- classes_member_select (0001_init.sql) filters `classes` with a correlated
-- subquery against `class_members`. class_members_professor_manage
-- (0001_init.sql) filters `class_members` with a correlated subquery against
-- `classes`. Both are plain table references, so each one's own RLS policies
-- apply when the other is evaluated. Postgres has to fully resolve
-- `classes`' policies to resolve `class_members`' policies, and vice versa —
-- a genuine two-table cycle that has existed since 0001_init.sql. It went
-- unnoticed until 0005_class_roster_management.sql added
-- profiles_professor_class_students_select, which joins class_members and
-- classes in a single policy and so is the first codepath (a plain "read my
-- own profile" query) that reliably forces both sides of the cycle to be
-- planned together.
--
-- FIX
-- Three `security definer` helper functions, following the existing
-- current_user_role() pattern from 0001_init.sql: a security definer
-- function runs with its owner's privileges, and table owners bypass RLS on
-- their own tables. So a lookup against classes/class_members done *inside*
-- one of these functions never re-triggers that table's RLS policies —
-- which is exactly what breaks the cycle. `set search_path = public` is
-- required per 0004_fix_trigger_search_path.sql's reasoning: security
-- definer functions must not resolve unqualified table names via a caller-
-- controlled search_path.
--
-- We use boolean, single-class helpers (is_professor_of_class,
-- is_class_member) rather than a set-returning user_class_ids(), since every
-- call site is already correlated to one class_id per row being filtered —
-- a boolean short-circuits per row instead of materialising a set to probe
-- with IN (...).
--
-- Every policy that used to reach `classes` or `class_members` via a raw
-- correlated subquery is rewritten to call these helpers instead, not just
-- the two policies that formed the cycle — a raw subquery anywhere in the
-- chain re-opens the same hole the moment it touches both tables. Policies
-- that only ever touched one side (e.g. classes_professor_manage, which
-- checks `professor_id = auth.uid()` with no subquery) are untouched.

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

create or replace function is_professor_of_class(p_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from classes where id = p_class_id and professor_id = auth.uid()
  );
$$;

create or replace function is_class_member(p_class_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from class_members where class_id = p_class_id and user_id = auth.uid()
  );
$$;

-- Used only by profiles_professor_class_students_select: a professor may
-- read a student's profile iff that student is a class_members row in one
-- of the professor's own classes. Doing the class_members/classes join
-- inside the security definer function (instead of in the policy body)
-- means neither table's RLS is re-entered while profiles' RLS is being
-- resolved.
create or replace function is_professor_of_student(p_student_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from class_members cm
    join classes c on c.id = cm.class_id
    where cm.user_id = p_student_id
      and c.professor_id = auth.uid()
  );
$$;

-- ============================================================
-- classes / class_members — the actual cycle
-- ============================================================

drop policy if exists classes_member_select on classes;
create policy classes_member_select on classes
  for select using (is_class_member(classes.id));

drop policy if exists class_members_professor_manage on class_members;
create policy class_members_professor_manage on class_members
  for all using (is_professor_of_class(class_members.class_id));

-- ============================================================
-- profiles — the policy that first surfaced the cycle
-- ============================================================

drop policy if exists profiles_professor_class_students_select on profiles;
create policy profiles_professor_class_students_select on profiles
  for select using (is_professor_of_student(profiles.id));

-- ============================================================
-- Every other table that joins through classes/class_members. None of
-- these formed a cycle on their own (they only reach one side of the
-- classes/class_members pair, never both), but they still went through raw
-- correlated subqueries against RLS-protected tables, so they're rewritten
-- for the same reason: keep the "check professor-owns-class /
-- check user-is-class-member" logic in exactly one, non-recursive place.
-- ============================================================

drop policy if exists assignments_professor_manage on assignments;
create policy assignments_professor_manage on assignments
  for all using (is_professor_of_class(assignments.class_id));

drop policy if exists assignments_student_select on assignments;
create policy assignments_student_select on assignments
  for select using (
    status in ('OPEN', 'CLOSED') and is_class_member(assignments.class_id)
  );

drop policy if exists questions_professor_manage on questions;
create policy questions_professor_manage on questions
  for all using (
    exists (
      select 1 from assignments a
      where a.id = questions.assignment_id and is_professor_of_class(a.class_id)
    )
  );

drop policy if exists questions_student_select on questions;
create policy questions_student_select on questions
  for select using (
    exists (
      select 1 from assignments a
      where a.id = questions.assignment_id
        and a.status in ('OPEN', 'CLOSED')
        and is_class_member(a.class_id)
    )
  );

drop policy if exists attempts_professor_manage on assignment_attempts;
create policy attempts_professor_manage on assignment_attempts
  for all using (
    exists (
      select 1 from assignments a
      where a.id = assignment_attempts.assignment_id and is_professor_of_class(a.class_id)
    )
  );

drop policy if exists responses_professor_select on responses;
create policy responses_professor_select on responses
  for select using (
    exists (
      select 1 from assignments a
      where a.id = responses.assignment_id and is_professor_of_class(a.class_id)
    )
  );

drop policy if exists mappings_professor_manage on question_mappings;
create policy mappings_professor_manage on question_mappings
  for all using (is_professor_of_class(question_mappings.class_id));

drop policy if exists mapping_members_professor_manage on question_mapping_members;
create policy mapping_members_professor_manage on question_mapping_members
  for all using (
    exists (
      select 1 from question_mappings qm
      where qm.id = question_mapping_members.mapping_id
        and is_professor_of_class(qm.class_id)
    )
  );

drop policy if exists transitions_professor_select on response_transitions;
create policy transitions_professor_select on response_transitions
  for select using (is_professor_of_class(response_transitions.class_id));

drop policy if exists imports_professor on imports;
create policy imports_professor on imports
  for all using (
    class_id is null or is_professor_of_class(imports.class_id)
  );

drop policy if exists import_rows_professor on import_rows;
create policy import_rows_professor on import_rows
  for all using (
    exists (
      select 1 from imports i
      where i.id = import_rows.import_id
        and (i.class_id is null or is_professor_of_class(i.class_id))
    )
  );

drop policy if exists roster_entries_professor_manage on roster_entries;
create policy roster_entries_professor_manage on roster_entries
  for all using (
    class_id is null or is_professor_of_class(roster_entries.class_id)
  );
