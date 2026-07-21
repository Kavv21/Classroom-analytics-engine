-- 0009_assignment_import.sql
-- Phase 4: assignment import pipeline + DB-level integrity boundaries.
--
-- Everything here follows the hard-won rules from 0004/0007/0008:
--  * every SECURITY DEFINER function sets search_path = public and
--    schema-qualifies every table reference;
--  * no RLS policy or policy-adjacent check does a raw correlated subquery
--    against classes/class_members — cross-table checks go through the
--    0008 helpers (is_professor_of_class) or new security-definer helpers;
--  * new relations get explicit GRANTs even though 0007's
--    ALTER DEFAULT PRIVILEGES should already cover them — belt and braces,
--    a missing grant is a full outage.

-- ============================================================
-- Helper: does this assignment have ANY response yet?
-- SECURITY DEFINER so trigger bodies can answer this without depending on
-- what the acting role is allowed to read via RLS (a professor can read
-- responses for their class, but the boundary must hold for every role).
-- ============================================================

create or replace function public.assignment_has_responses(p_assignment_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.responses where assignment_id = p_assignment_id
  );
$$;

-- ============================================================
-- Boundary 1: once an assignment has ANY response, question edits are
-- destructive-edit-blocked. A UI check is UX, not enforcement — this
-- trigger is the actual security boundary (fires for every role;
-- service_role bypasses RLS but NOT triggers).
--
-- Allowed after responses exist: display_order (reordering is
-- presentation, not meaning) and updated_at. Everything else — wording,
-- codes, labels, classification fields, is_active, deletion, insertion —
-- requires versioning the assignment instead (CLAUDE.md rule 6).
-- ============================================================

create or replace function public.enforce_question_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if public.assignment_has_responses(old.assignment_id) then
      raise exception
        'cannot delete question %: its assignment already has responses — version the assignment instead',
        old.id;
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if public.assignment_has_responses(new.assignment_id) then
      raise exception
        'cannot add questions to assignment %: it already has responses — version the assignment instead',
        new.assignment_id;
    end if;
    return new;
  end if;

  -- UPDATE: only display_order / updated_at may change once responses exist.
  if public.assignment_has_responses(old.assignment_id) then
    if new.assignment_id is distinct from old.assignment_id
      or new.external_question_code is distinct from old.external_question_code
      or new.original_worksheet is distinct from old.original_worksheet
      or new.original_row_reference is distinct from old.original_row_reference
      or new.original_column_reference is distinct from old.original_column_reference
      or new.question_text is distinct from old.question_text
      or new.energy_source is distinct from old.energy_source
      or new.criterion is distinct from old.criterion
      or new.concept is distinct from old.concept
      or new.response_zero_label is distinct from old.response_zero_label
      or new.response_one_label is distinct from old.response_one_label
      or new.is_active is distinct from old.is_active
      or new.raw_source_payload is distinct from old.raw_source_payload
    then
      raise exception
        'cannot edit question %: its assignment already has responses (only reordering is allowed) — version the assignment instead',
        old.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists questions_immutable_after_responses on public.questions;
create trigger questions_immutable_after_responses
  before insert or update or delete on public.questions
  for each row execute function public.enforce_question_immutability();

-- ============================================================
-- Boundary 2: assignment status transitions, enforced server-side.
-- DRAFT -> READY -> OPEN -> CLOSED -> ARCHIVED, plus READY -> DRAFT
-- (un-approve to keep editing; no new status invented). Entering READY
-- requires at least one active question — READY means "professor saw the
-- full question list and approved it", which is meaningless when empty.
-- ============================================================

create or replace function public.enforce_assignment_status_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if not (
    (old.status = 'DRAFT'  and new.status = 'READY')
    or (old.status = 'READY' and new.status = 'DRAFT')
    or (old.status = 'READY' and new.status = 'OPEN')
    or (old.status = 'OPEN'  and new.status = 'CLOSED')
    or (old.status = 'CLOSED' and new.status = 'ARCHIVED')
  ) then
    raise exception 'invalid assignment status transition: % -> %', old.status, new.status;
  end if;

  if new.status = 'READY' and not exists (
    select 1 from public.questions q
    where q.assignment_id = new.id and q.is_active
  ) then
    raise exception 'assignment % has no active questions — import or add questions before approval', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists assignments_status_transition on public.assignments;
create trigger assignments_status_transition
  before update of status on public.assignments
  for each row execute function public.enforce_assignment_status_transition();

-- ============================================================
-- Audit events. audit_logs deliberately has no INSERT policy (only an
-- ADMIN SELECT policy), so writes go through this narrow SECURITY DEFINER
-- function: actor is always auth.uid(), never caller-supplied.
-- ============================================================

create or replace function public.log_audit_event(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_metadata jsonb default null
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_metadata);
$$;

revoke execute on function public.log_audit_event(text, text, uuid, jsonb) from anon;

-- ============================================================
-- Transactional assignment import, mirroring commit_roster_import (0005):
-- SECURITY INVOKER — RLS applies to every row it touches; the explicit
-- ownership check exists to fail with a clear message rather than an
-- opaque RLS error. All-or-nothing: any bad row raises, rolling back the
-- imports row, import_rows, and every inserted question. "Never partially
-- import silently" (spec section 23).
--
-- Re-import into the same DRAFT assignment replaces its question set —
-- that is what makes "re-importing a corrected spreadsheet after a
-- rejected import" clean. Allowed only while the assignment is DRAFT and
-- has no responses (the questions trigger would block the delete anyway;
-- the status check gives a clearer error first).
-- ============================================================

create or replace function public.commit_assignment_import(
  p_assignment_id uuid,
  p_source_filename text,
  p_source_checksum text,
  p_source_worksheet text,
  p_questions jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_class_id uuid;
  v_status assignment_status;
  v_import_id uuid;
  v_count int := 0;
  q jsonb;
begin
  select a.class_id, a.status into v_class_id, v_status
  from assignments a
  where a.id = p_assignment_id and is_professor_of_class(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you are not the professor of its class';
  end if;

  if v_status <> 'DRAFT' then
    raise exception 'questions can only be imported while the assignment is in DRAFT (current status: %)', v_status;
  end if;

  if assignment_has_responses(p_assignment_id) then
    raise exception 'assignment already has responses — version the assignment instead of re-importing';
  end if;

  if p_questions is null or jsonb_array_length(p_questions) = 0 then
    raise exception 'import contains no questions';
  end if;

  insert into imports (
    class_id, assignment_id, import_type, source_filename, source_checksum,
    status, imported_by
  ) values (
    v_class_id, p_assignment_id, 'ASSIGNMENT', p_source_filename,
    p_source_checksum, 'PROCESSING', auth.uid()
  ) returning id into v_import_id;

  -- Replace the existing question set (clean re-import).
  delete from questions where assignment_id = p_assignment_id;

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

    insert into questions (
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

    insert into import_rows (import_id, row_number, raw_data, status)
    values (v_import_id, coalesce((q->>'rowNumber')::int, v_count + 1), q, 'IMPORTED');

    v_count := v_count + 1;
  end loop;

  update imports set
    status = 'COMPLETED',
    summary = jsonb_build_object('imported', v_count, 'worksheet', p_source_worksheet)
  where id = v_import_id;

  perform log_audit_event(
    'ASSIGNMENT_IMPORTED', 'assignment', p_assignment_id,
    jsonb_build_object('importId', v_import_id, 'questionCount', v_count, 'filename', p_source_filename)
  );

  return jsonb_build_object('importId', v_import_id, 'imported', v_count);
end;
$$;

-- Failed parses still become import history (status FAILED + REJECTED rows)
-- without touching questions. Separate from commit_assignment_import so a
-- raised exception there can roll back cleanly while rejected uploads are
-- still recorded here by the server action.
create or replace function public.record_failed_assignment_import(
  p_assignment_id uuid,
  p_source_filename text,
  p_source_checksum text,
  p_error_rows jsonb
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_class_id uuid;
  v_import_id uuid;
  r jsonb;
begin
  select a.class_id into v_class_id
  from assignments a
  where a.id = p_assignment_id and is_professor_of_class(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you are not the professor of its class';
  end if;

  insert into imports (
    class_id, assignment_id, import_type, source_filename, source_checksum,
    status, imported_by, summary
  ) values (
    v_class_id, p_assignment_id, 'ASSIGNMENT', p_source_filename,
    p_source_checksum, 'FAILED', auth.uid(),
    jsonb_build_object('rejected', jsonb_array_length(coalesce(p_error_rows, '[]'::jsonb)))
  ) returning id into v_import_id;

  for r in select * from jsonb_array_elements(coalesce(p_error_rows, '[]'::jsonb))
  loop
    insert into import_rows (import_id, row_number, raw_data, status, error_message)
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

-- ============================================================
-- Duplicate assignment: copy metadata + questions into a fresh DRAFT in
-- one transaction. SECURITY INVOKER — RLS governs both the read of the
-- source and the writes of the copy.
-- ============================================================

create or replace function public.duplicate_assignment(p_assignment_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
  v_class_id uuid;
begin
  select a.class_id into v_class_id
  from assignments a
  where a.id = p_assignment_id and is_professor_of_class(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you are not the professor of its class';
  end if;

  insert into assignments (
    class_id, title, description, instructions, assignment_stage,
    sequence_number, open_at, close_at, status, allow_draft_editing,
    allow_resubmission, response_zero_label, response_one_label, created_by
  )
  select
    a.class_id, a.title || ' (copy)', a.description, a.instructions,
    a.assignment_stage, a.sequence_number, null, null, 'DRAFT',
    a.allow_draft_editing, a.allow_resubmission, a.response_zero_label,
    a.response_one_label, auth.uid()
  from assignments a
  where a.id = p_assignment_id
  returning id into v_new_id;

  insert into questions (
    assignment_id, external_question_code, original_worksheet,
    original_row_reference, original_column_reference, question_text,
    energy_source, criterion, concept, response_zero_label,
    response_one_label, display_order, is_active, raw_source_payload
  )
  select
    v_new_id, q.external_question_code, q.original_worksheet,
    q.original_row_reference, q.original_column_reference, q.question_text,
    q.energy_source, q.criterion, q.concept, q.response_zero_label,
    q.response_one_label, q.display_order, q.is_active, q.raw_source_payload
  from questions q
  where q.assignment_id = p_assignment_id;

  perform log_audit_event(
    'ASSIGNMENT_DUPLICATED', 'assignment', v_new_id,
    jsonb_build_object('sourceAssignmentId', p_assignment_id)
  );

  return v_new_id;
end;
$$;

-- ============================================================
-- Submission progress, aggregated in the database (analytics rule: hit
-- views, don't pull response tables into app memory). security_invoker on:
-- the querying professor's own RLS decides what they can see — the view
-- adds no privilege.
-- ============================================================

create or replace view public.assignment_submission_progress
with (security_invoker = on) as
select
  a.id as assignment_id,
  a.class_id,
  count(cm.user_id) as enrolled_students,
  count(att.id) filter (where att.state = 'DRAFT') as draft_count,
  count(att.id) filter (where att.state = 'SUBMITTED') as submitted_count,
  count(att.id) filter (where att.state = 'REOPENED') as reopened_count,
  count(att.id) filter (where att.state = 'RESUBMITTED') as resubmitted_count,
  count(cm.user_id) - count(att.id)
    + count(att.id) filter (where att.state = 'NOT_STARTED') as not_started_count
from assignments a
join class_members cm
  on cm.class_id = a.class_id
  and cm.member_role = 'STUDENT'
  and cm.status = 'ACTIVE'
left join assignment_attempts att
  on att.assignment_id = a.id and att.student_id = cm.user_id
group by a.id, a.class_id;

-- 0007's ALTER DEFAULT PRIVILEGES should cover these, but explicit grants
-- cost nothing and a missing grant is a hard outage (lesson from 0007).
grant select on public.assignment_submission_progress to authenticated, service_role;
