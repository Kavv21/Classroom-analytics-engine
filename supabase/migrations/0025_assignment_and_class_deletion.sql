-- ============================================================
-- 0025 — Unarchive an assignment, and permanently delete an assignment
--        or an entire class.
--
-- WHY THESE ARE RPCs AND NOT PLAIN WRITES
--
-- Three separate boundaries stand between "the professor clicked delete"
-- and "the rows are gone", and every one of them exists on purpose:
--
--   1. `assignments_status_transition` (0009) allows CLOSED -> ARCHIVED
--      and nothing back. ARCHIVED is deliberately terminal in the FSM,
--      because "archived" is what the analytics and the sequence-number
--      uniqueness index (0018) read as "out of play". Unarchiving is a
--      real, occasionally necessary act — the professor archived the
--      wrong assignment — but it is not a transition the FSM should
--      start advertising, or `transitionAssignment` would offer it from
--      the generic status path and ARCHIVED would stop meaning terminal.
--      So it stays off the FSM and lives here, in one gated function
--      that names itself.
--
--   2. `questions_immutable_after_responses` (0009) refuses to delete a
--      question whose assignment has responses (CLAUDE.md rule 6). That
--      rule is about EDITING a live assignment — changing what was asked
--      underneath answers already given. Destroying the assignment
--      outright is a different act: nothing is left to misrepresent. The
--      trigger cannot tell those apart from a row DELETE, so this
--      function disables it for the duration of one transaction, in the
--      same deliberate-and-reviewable way migration 0019 did for the
--      question-code repair.
--
--   3. RLS. A professor has no DELETE policy over other students'
--      response rows, and should not be given one — a blanket policy
--      would be reachable from every code path, not just this one. These
--      functions are SECURITY DEFINER with an explicit
--      `is_professor_of_class` gate, so the authority is scoped to the
--      one gesture instead of to the role.
--
-- ON DISABLING A TRIGGER INSIDE A FUNCTION
--
-- `alter table ... disable trigger` takes an ACCESS EXCLUSIVE lock on
-- the table and is transactional. Two consequences, both wanted: no other
-- session can write to `questions` while the trigger is off (they block
-- on the lock until this transaction commits and the trigger is back on),
-- and if anything in here raises, the rollback restores the trigger along
-- with the rows. The window where the boundary is down cannot be observed
-- by another session, and cannot outlive a failure.
--
-- These functions must be owned by the owner of `public.questions` (the
-- migration role), or the ALTER TABLE will be refused.
--
-- ON THE CASCADE
--
-- Every child FK in 0001/0002 is already `on delete cascade`:
--   classes -> class_members, assignments, roster_entries, saved_queries,
--              saved_visualisations, dashboards, imports
--   assignments -> questions, assignment_attempts, responses, imports
--   questions -> question_options, responses
--   assignment_attempts -> responses
--   imports -> import_rows
--   dashboards -> dashboard_items
-- So a single DELETE on the parent row removes the whole tree. These
-- functions do NOT re-implement that cascade by hand; hand-rolling it
-- would silently miss any table added later, whereas the FKs cannot.
--
-- `profiles` rows are never touched. Deleting a class deletes the class's
-- record of a student, not the student's account — they may be enrolled
-- elsewhere, and their login is not this class's property.
--
-- audit_logs has no FK to either entity (entity_id is a bare uuid), so
-- the record of the deletion deliberately survives the thing it
-- describes. That is the whole point of writing it FIRST: the counts are
-- taken and logged while the rows still exist, so the log entry is a
-- census of what was destroyed rather than a claim made after the fact.
-- ============================================================

-- ============================================================
-- 1. Counting helpers, shared by the preview and the delete.
--
-- The preview the dialog shows and the census the audit log records come
-- from the SAME function, so the professor cannot be shown one number and
-- have a different one written down. The dialog's count is a read taken
-- earlier and may be stale by the time the delete runs; the audit log's
-- is taken inside the deleting transaction and is authoritative.
-- ============================================================

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
    and public.is_professor_of_class(a.class_id);
$$;

comment on function public.assignment_deletion_counts(uuid) is
  'Exactly what delete_assignment_permanently would destroy. Returns NULL when the assignment does not exist or the caller is not its class''s professor — callers must treat NULL as "no access", not as "nothing to delete".';

create or replace function public.class_deletion_counts(p_class_id uuid)
returns jsonb
language sql
security definer
stable
set search_path = public
as $$
  select jsonb_build_object(
    'classId', c.id,
    'name', c.name,
    'status', c.status,
    'assignments', (
      select count(*) from public.assignments a where a.class_id = c.id
    ),
    'questions', (
      select count(*) from public.questions q
      join public.assignments a on a.id = q.assignment_id
      where a.class_id = c.id
    ),
    'responses', (
      select count(*) from public.responses r
      join public.assignments a on a.id = r.assignment_id
      where a.class_id = c.id
    ),
    'attempts', (
      select count(*) from public.assignment_attempts att
      join public.assignments a on a.id = att.assignment_id
      where a.class_id = c.id
    ),
    -- Enrolled students, not "students with an attempt": deleting the
    -- class removes every roster relationship, including the students who
    -- never opened anything.
    'students', (
      select count(*) from public.class_members cm where cm.class_id = c.id
    ),
    'rosterEntries', (
      select count(*) from public.roster_entries re where re.class_id = c.id
    ),
    'savedViews', (
      select
        (select count(*) from public.saved_queries sq where sq.class_id = c.id)
        + (select count(*) from public.saved_visualisations sv where sv.class_id = c.id)
        + (select count(*) from public.dashboards d where d.class_id = c.id)
    )
  )
  from public.classes c
  where c.id = p_class_id
    and public.is_professor_of_class(c.id);
$$;

comment on function public.class_deletion_counts(uuid) is
  'Exactly what delete_class_permanently would destroy, across every assignment in the class. Returns NULL when the class does not exist or the caller is not its professor.';

-- ============================================================
-- 2. unarchive_assignment — ARCHIVED -> CLOSED.
--
-- CLOSED and not OPEN: unarchiving restores the assignment to the state
-- it had to be in to be archived at all. Putting students back in front
-- of it is a second, separate decision (Reopen), and folding it into this
-- one would mean an accidental archive-then-restore silently republished
-- an assignment the class had already finished with.
-- ============================================================

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
    and public.is_professor_of_class(a.class_id)
  for update;

  if v_assignment.id is null then
    raise exception 'assignment not found, or you are not the professor of its class';
  end if;

  if v_assignment.status <> 'ARCHIVED' then
    raise exception 'only an ARCHIVED assignment can be unarchived (current status: %)',
      v_assignment.status;
  end if;

  -- The sequence-number index (0018) is partial on `status <> 'ARCHIVED'`,
  -- so an archived first/second assignment does not hold its slot — and
  -- another assignment may have taken it in the meantime. Say so plainly
  -- rather than letting the professor read a raw unique violation.
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
  'Professor-only ARCHIVED -> CLOSED, the one transition the assignments_status_transition FSM deliberately does not carry. Restores to CLOSED, never to OPEN: letting students back in is a separate decision.';

-- ============================================================
-- 3. delete_assignment_permanently.
--
-- Deliberately NOT gated on status or response count. An assignment with
-- 151 responses is exactly the case this exists for — a professor who
-- imported the wrong spreadsheet against a live class has no other way
-- out, and "archive it and live with it forever" is not an answer when
-- the rows are wrong. The protection is the audit record and the
-- type-to-confirm in the UI, not a refusal.
-- ============================================================

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
  -- Lock the assignment first, so the census below cannot be taken while
  -- another session is still writing responses into it.
  select a.class_id into v_class_id
  from public.assignments a
  where a.id = p_assignment_id
    and public.is_professor_of_class(a.class_id)
  for update;

  if v_class_id is null then
    raise exception 'assignment not found, or you are not the professor of its class';
  end if;

  -- Count, then log, then delete. In that order, always: after the
  -- DELETE there is nothing left to count, and an audit entry that says
  -- "deleted an assignment" without saying how much went with it is not
  -- a record of anything.
  v_counts := public.assignment_deletion_counts(p_assignment_id);

  perform public.log_audit_event(
    'ASSIGNMENT_DELETED_PERMANENTLY', 'assignment', p_assignment_id, v_counts
  );

  alter table public.questions disable trigger questions_immutable_after_responses;

  -- One statement. Every child follows through the FK cascade documented
  -- at the top of this file.
  delete from public.assignments where id = p_assignment_id;

  alter table public.questions enable trigger questions_immutable_after_responses;

  return v_counts;
end;
$$;

comment on function public.delete_assignment_permanently(uuid) is
  'Professor-only, irreversible: removes an assignment and — through the FK cascade — its questions, attempts, responses and import history, whatever its status or response count. Writes the full census to audit_logs BEFORE deleting.';

-- ============================================================
-- 4. delete_class_permanently.
--
-- Strictly larger than the above: every assignment in the class and
-- everything under each of them, plus the roster, the pending roster
-- entries, and the saved queries / visualisations / dashboards scoped to
-- the class.
-- ============================================================

create or replace function public.delete_class_permanently(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_class_id uuid;
  v_counts jsonb;
begin
  select c.id into v_class_id
  from public.classes c
  where c.id = p_class_id
    and public.is_professor_of_class(c.id)
  for update;

  if v_class_id is null then
    raise exception 'class not found, or you are not its professor';
  end if;

  v_counts := public.class_deletion_counts(p_class_id);

  perform public.log_audit_event(
    'CLASS_DELETED_PERMANENTLY', 'class', p_class_id, v_counts
  );

  alter table public.questions disable trigger questions_immutable_after_responses;

  delete from public.classes where id = p_class_id;

  alter table public.questions enable trigger questions_immutable_after_responses;

  return v_counts;
end;
$$;

comment on function public.delete_class_permanently(uuid) is
  'Professor-only, irreversible: removes a class and — through the FK cascade — every assignment, question, attempt, response, roster entry, class membership and saved view under it. Student profiles are NOT deleted. Writes the full census to audit_logs BEFORE deleting.';

-- ============================================================
-- 5. Grants. Every one of these is a professor action reached from a
-- signed-in session; none is reachable anonymously.
-- ============================================================

revoke execute on function public.assignment_deletion_counts(uuid) from anon;
revoke execute on function public.class_deletion_counts(uuid) from anon;
revoke execute on function public.unarchive_assignment(uuid) from anon;
revoke execute on function public.delete_assignment_permanently(uuid) from anon;
revoke execute on function public.delete_class_permanently(uuid) from anon;

grant execute on function public.assignment_deletion_counts(uuid) to authenticated;
grant execute on function public.class_deletion_counts(uuid) to authenticated;
grant execute on function public.unarchive_assignment(uuid) to authenticated;
grant execute on function public.delete_assignment_permanently(uuid) to authenticated;
grant execute on function public.delete_class_permanently(uuid) to authenticated;
