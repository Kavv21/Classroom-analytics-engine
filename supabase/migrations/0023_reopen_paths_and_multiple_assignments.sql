-- 0023_reopen_paths_and_multiple_assignments.sql
--
-- Two root-cause fixes reported from the running app.
--
-- ============================================================
-- BUG 1 — "the professor reopened the assignment and the student still
--          cannot answer it."
--
-- Reopening was a dead end, in two independent ways:
--
--   a) There was no CLOSED -> OPEN transition at all (0009). Closing an
--      assignment was irreversible short of archiving it. The professor's
--      only "reopen" control was the PER-ATTEMPT one, which is a different
--      thing entirely.
--
--   b) reopen_attempt happily moved an attempt to REOPENED without ever
--      looking at the assignment's status. Every student-side write path —
--      get_or_create_attempt, save_attempt_responses, submit_attempt —
--      requires the assignment to be OPEN, so reopening an attempt on a
--      CLOSED assignment produced a state no one could act on: the student
--      is told "Reopened — submit again when you're ready" next to a
--      Closed badge and no link, and the professor is told "Attempt
--      reopened. The student can submit again", which was false.
--
-- The fix keeps both reopen gestures and makes each one actually work:
--
--   * CLOSED -> OPEN is now a legal assignment transition, so a professor
--     can reopen an assignment for the whole class.
--
--   * A reopened ATTEMPT stays workable while its assignment is CLOSED.
--     That is the point of a per-student reopen — it lets one student
--     finish without republishing to everyone. The permission is carried by
--     `reopened_at is not null` together with a non-final state, not by the
--     assignment status.
--
--     REOPENED -> DRAFT is what the first autosave does (see the FSM in
--     0010), so DRAFT has to be inside the allowance or the student would
--     be locked out by their own first keystroke. RESUBMITTED and
--     SUBMITTED are excluded, so the allowance ends the moment the student
--     submits. NOTE the consequence, deliberately accepted: if a professor
--     reopens an attempt while the assignment is OPEN and closes the
--     assignment afterwards, that student can still finish. Closing stops
--     everyone who was NOT individually reopened.
--
-- ARCHIVED remains terminal and remains unreachable for students: it is
-- the irreversible state, and nothing here softens it.
--
-- ON MIGRATION 0020, WHICH CONSIDERED CLOSED -> OPEN AND REJECTED IT.
-- 0020 needed to seed synthetic demo data into assignments that had
-- already closed, listed "add CLOSED -> OPEN to the FSM" as option 1, and
-- rejected it as "a genuine reopen capability for the whole app to serve
-- one maintenance need. Not proportionate." That judgement was right for
-- that need and does not carry over to this one: here the reopen
-- capability IS the need — a professor closed an assignment and has no way
-- to let the class answer again. 0020's own mechanism is untouched below:
-- the synthetic path still writes into a CLOSED assignment without
-- reopening it, and its is_synthetic gate is carried forward verbatim. The
-- premise 0020 wrote down — "a closed assignment is a finished record" —
-- was already only half true, since per-attempt reopen existed precisely
-- to let a student submit after the close.
--
-- Note for whoever edits save_attempt_responses/submit_attempt next: their
-- bodies here are 0020's, not 0010's. The synthetic branch and the
-- is_synthetic column on the response insert are load-bearing (they are
-- what marks demo data as demo data) and are easy to drop by rebasing on
-- the wrong version — this migration did exactly that once before review.
--
-- ============================================================
-- BUG 2 — a class could not hold more than two assignments.
--
-- sequence_number 1 and 2 are load-bearing: they are the pivot of
-- energy_source_assignment_change (0017) and the source of every question
-- code's `A{n}-` prefix. 0018 made them unique per class, correctly. But
-- the UI then offered ONLY those two positions, which turned "the compared
-- pair is exactly two" into "a class has at most two assignments" — a
-- restriction nothing in the data model asks for.
--
-- The app side now allocates 3, 4, 5 … for "other" assignments
-- (lib/assignments/sequence.ts). The unique index is deliberately LEFT AS
-- IS and still covers every number: two live assignments sharing a number
-- would make `A3-001` ambiguous inside the class, exactly the failure
-- 0019 had to repair. What needed fixing here is duplicate_assignment,
-- which copied the source's sequence_number verbatim and therefore could
-- not succeed at all once 0018 existed — every duplicate of a live
-- assignment hit assignments_class_sequence_unique.

-- ============================================================
-- Assignment status transitions: add CLOSED -> OPEN.
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
    or (old.status = 'CLOSED' and new.status = 'OPEN')
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

-- ============================================================
-- The one predicate that decides whether a student may still write to an
-- attempt. Defined once so get_or_create_attempt, save_attempt_responses
-- and submit_attempt cannot drift apart — three copies of this rule is how
-- a student ends up able to save but not submit.
-- ============================================================

create or replace function public.attempt_is_workable(
  p_assignment_status assignment_status,
  p_attempt_state attempt_state,
  p_reopened_at timestamptz
) returns boolean
language sql
immutable
set search_path = public
as $$
  select
    p_assignment_status = 'OPEN'
    or (
      p_assignment_status = 'CLOSED'
      and p_reopened_at is not null
      and p_attempt_state in ('REOPENED', 'DRAFT')
    );
$$;

comment on function public.attempt_is_workable(assignment_status, attempt_state, timestamptz) is
  'May this student still edit/submit this attempt? True while the assignment is OPEN, and for an individually reopened attempt whose assignment has since been (or was already) CLOSED — until they submit again.';

-- ============================================================
-- get_or_create_attempt: unchanged for the OPEN case. A CLOSED assignment
-- is now reachable ONLY through an attempt that already exists and was
-- reopened — no row is ever created on a closed assignment.
-- ============================================================

create or replace function public.get_or_create_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_attempt assignment_attempts%rowtype;
  v_status assignment_status;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select a.status into v_status
  from assignments a
  where a.id = p_assignment_id
    and is_class_member(a.class_id);

  if v_status is null then
    raise exception 'assignment not found, or you are not a member of its class';
  end if;

  select * into v_attempt
  from assignment_attempts
  where assignment_id = p_assignment_id and student_id = auth.uid();

  if v_status = 'OPEN' then
    insert into assignment_attempts (assignment_id, student_id, state, started_at)
    values (p_assignment_id, auth.uid(), 'NOT_STARTED', now())
    on conflict (assignment_id, student_id) do nothing;

    select * into v_attempt
    from assignment_attempts
    where assignment_id = p_assignment_id and student_id = auth.uid();
  elsif not (
    v_attempt.id is not null
    and attempt_is_workable(v_status, v_attempt.state, v_attempt.reopened_at)
  ) then
    raise exception 'assignment is not open (status: %)', v_status;
  end if;

  return jsonb_build_object(
    'id', v_attempt.id,
    'state', v_attempt.state,
    'startedAt', v_attempt.started_at,
    'lastSavedAt', v_attempt.last_saved_at,
    'submittedAt', v_attempt.submitted_at,
    'submissionVersion', v_attempt.submission_version
  );
end;
$$;

-- ============================================================
-- save_attempt_responses: the migration-0020 body, with only the
-- REAL-student status gate changed to go through attempt_is_workable. The
-- synthetic-seeding branch and the is_synthetic provenance on the response
-- insert are 0020's and are carried forward verbatim — the seed writes
-- through this function on purpose, and dropping either would silently stop
-- demo responses being marked as demo data.
-- ============================================================

create or replace function public.save_attempt_responses(
  p_attempt_id uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_attempt assignment_attempts%rowtype;
  v_allow_draft_editing boolean;
  v_assignment_status assignment_status;
  answer jsonb;
  v_question_id uuid;
  v_value smallint;
  v_existing smallint;
  v_has_existing boolean;
  v_saved int := 0;
begin
  select * into v_attempt
  from assignment_attempts
  where id = p_attempt_id and student_id = auth.uid()
  for update;

  if v_attempt.id is null then
    raise exception 'attempt not found, or it is not yours';
  end if;

  if v_attempt.state not in ('NOT_STARTED', 'DRAFT', 'REOPENED') then
    raise exception 'answers cannot be saved while the attempt is % — it has already been submitted', v_attempt.state;
  end if;

  select a.status, a.allow_draft_editing
    into v_assignment_status, v_allow_draft_editing
  from assignments a
  where a.id = v_attempt.assignment_id;

  -- A synthetic attempt may be seeded into an assignment that has already
  -- closed (migration 0020). The assignment is NOT reopened by that path,
  -- and 0020's triggers make the flag unforgeable by anon/authenticated.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif not attempt_is_workable(v_assignment_status, v_attempt.state, v_attempt.reopened_at) then
    raise exception 'the assignment is no longer open (status: %)', v_assignment_status;
  end if;

  if p_answers is null or jsonb_array_length(p_answers) = 0 then
    raise exception 'no answers to save';
  end if;

  for answer in select * from jsonb_array_elements(p_answers)
  loop
    v_question_id := (answer->>'questionId')::uuid;

    if answer->'value' = 'null'::jsonb or answer->>'value' is null then
      v_value := null;
    elsif answer->>'value' in ('0', '1') then
      v_value := (answer->>'value')::smallint;
    else
      raise exception 'invalid response value % for question % — only 0, 1, or null are allowed',
        answer->>'value', v_question_id;
    end if;

    if not exists (
      select 1 from questions q
      where q.id = v_question_id
        and q.assignment_id = v_attempt.assignment_id
        and q.is_active
    ) then
      raise exception 'question % does not belong to this assignment (or is inactive)', v_question_id;
    end if;

    select r.response_value, true into v_existing, v_has_existing
    from responses r
    where r.attempt_id = p_attempt_id and r.question_id = v_question_id;
    if not found then
      v_has_existing := false;
      v_existing := null;
    end if;

    if not v_allow_draft_editing
      and v_has_existing
      and v_existing is not null
      and v_value is distinct from v_existing
    then
      raise exception 'draft editing is disabled for this assignment — the answer for question % is already saved',
        v_question_id;
    end if;

    -- Provenance flows from the attempt (0020), so a seeded response is
    -- marked without the seed script having to tag rows afterwards.
    insert into responses (
      attempt_id, assignment_id, student_id, question_id, response_value, is_synthetic
    ) values (
      p_attempt_id, v_attempt.assignment_id, auth.uid(), v_question_id, v_value,
      v_attempt.is_synthetic
    )
    on conflict (attempt_id, question_id) do update set
      response_value = excluded.response_value,
      last_saved_at = now(),
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  -- NOT_STARTED -> DRAFT / REOPENED -> DRAFT / DRAFT -> DRAFT, all legal.
  update assignment_attempts set
    state = 'DRAFT',
    started_at = coalesce(started_at, now()),
    last_saved_at = now(),
    updated_at = now()
  where id = p_attempt_id;

  return jsonb_build_object('saved', v_saved, 'state', 'DRAFT', 'savedAt', now());
end;
$$;

-- ============================================================
-- submit_attempt: the migration-0020 body, with the same one change to the
-- real-student status gate. There is still deliberately NO automatic path
-- to this function — it only runs when the student explicitly invokes it
-- (EXCLUDED_FEATURES.md).
-- ============================================================

create or replace function public.submit_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_attempt assignment_attempts%rowtype;
  v_assignment_status assignment_status;
  v_new_state attempt_state;
  v_new_version int;
  v_answered int;
  v_total int;
begin
  select * into v_attempt
  from assignment_attempts
  where id = p_attempt_id and student_id = auth.uid()
  for update;

  if v_attempt.id is null then
    raise exception 'attempt not found, or it is not yours';
  end if;

  if v_attempt.state in ('SUBMITTED', 'RESUBMITTED') then
    raise exception 'already submitted — this attempt was submitted at %', v_attempt.submitted_at;
  end if;

  select a.status into v_assignment_status
  from assignments a where a.id = v_attempt.assignment_id;

  -- Same narrow synthetic exception as save_attempt_responses. See 0020.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif not attempt_is_workable(v_assignment_status, v_attempt.state, v_attempt.reopened_at) then
    raise exception 'the assignment is no longer open (status: %)', v_assignment_status;
  end if;

  -- State follows the FSM exactly: REOPENED -> RESUBMITTED; NOT_STARTED /
  -- DRAFT -> SUBMITTED (a reopened attempt that was edited goes REOPENED ->
  -- DRAFT -> SUBMITTED, since DRAFT -> RESUBMITTED is not a legal edge).
  -- The version bumps on ANY submission after a previous one — that is what
  -- "versioning for reopened submissions" tracks, independent of which
  -- submit edge the FSM routed through.
  v_new_state := case when v_attempt.state = 'REOPENED' then 'RESUBMITTED' else 'SUBMITTED' end;
  v_new_version := case
    when v_attempt.submitted_at is not null then v_attempt.submission_version + 1
    else v_attempt.submission_version
  end;

  update responses set
    is_final = true,
    submitted_at = now(),
    version = v_new_version,
    updated_at = now()
  where attempt_id = p_attempt_id;

  update assignment_attempts set
    state = v_new_state,
    submitted_at = now(),
    submission_version = v_new_version,
    updated_at = now()
  where id = p_attempt_id;

  select
    count(*) filter (where r.response_value is not null),
    (select count(*) from questions q
      where q.assignment_id = v_attempt.assignment_id and q.is_active)
  into v_answered, v_total
  from responses r
  where r.attempt_id = p_attempt_id;

  return jsonb_build_object(
    'attemptId', p_attempt_id,
    'state', v_new_state,
    'submittedAt', now(),
    'submissionVersion', v_new_version,
    'answered', v_answered,
    'totalQuestions', v_total
  );
end;
$$;

-- ============================================================
-- reopen_attempt: same professor-only boundary as 0010, plus the check
-- that stops it from minting an unusable state. An ARCHIVED (or not yet
-- published) assignment cannot be worked on by anyone, so reopening an
-- attempt on one is refused rather than silently accepted.
-- ============================================================

create or replace function public.reopen_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.assignment_attempts%rowtype;
  v_status public.assignment_status;
begin
  select att.* into v_attempt
  from public.assignment_attempts att
  join public.assignments a on a.id = att.assignment_id
  where att.id = p_attempt_id
    and public.is_professor_of_class(a.class_id)
  for update of att;

  if v_attempt.id is null then
    raise exception 'attempt not found, or you are not the professor of its class';
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

-- ============================================================
-- duplicate_assignment: give the copy its own sequence number.
--
-- Copying the source's number has been a guaranteed failure since 0018
-- (assignments_class_sequence_unique), so this is a fix, not a behaviour
-- change: duplicating a live assignment could not succeed at all.
--
-- The copy's question codes are re-prefixed to match its new number in the
-- same statement. Leaving them on the source's prefix is precisely the
-- ambiguity 0019 had to repair by hand, and unlike an edit of a live
-- assignment there is nothing to protect here — the copy is a fresh DRAFT
-- with no responses.
-- ============================================================

create or replace function public.next_assignment_sequence_number(p_class_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select greatest(
    3,
    coalesce(max(a.sequence_number), 0) + 1
  )
  from public.assignments a
  where a.class_id = p_class_id;
$$;

comment on function public.next_assignment_sequence_number(uuid) is
  'A free sequence number for a non-paired ("other") assignment: never 1 or 2, and never a number an existing sibling holds — ARCHIVED included, because its question codes A{n}-NNN still exist. Same guarantee as nextOtherSequenceNumber in lib/assignments/sequence.ts, which additionally fills gaps left by deletions; this one only ever counts up.';

create or replace function public.duplicate_assignment(p_assignment_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_new_id uuid;
  v_class_id uuid;
  v_sequence_number int;
begin
  select a.class_id into v_class_id
  from assignments a
  where a.id = p_assignment_id and is_professor_of_class(a.class_id);

  if v_class_id is null then
    raise exception 'assignment not found, or you are not the professor of its class';
  end if;

  v_sequence_number := next_assignment_sequence_number(v_class_id);

  insert into assignments (
    class_id, title, description, instructions, assignment_stage,
    sequence_number, open_at, close_at, status, allow_draft_editing,
    allow_resubmission, response_zero_label, response_one_label, created_by
  )
  select
    a.class_id, a.title || ' (copy)', a.description, a.instructions,
    a.assignment_stage, v_sequence_number, null, null, 'DRAFT',
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
    v_new_id,
    -- `A1-001` -> `A7-001`; anything not matching the generated shape is
    -- copied untouched rather than guessed at.
    case
      when q.external_question_code ~ '^A\d+-'
        then 'A' || v_sequence_number::text || substring(q.external_question_code from position('-' in q.external_question_code))
      else q.external_question_code
    end,
    q.original_worksheet,
    q.original_row_reference, q.original_column_reference, q.question_text,
    q.energy_source, q.criterion, q.concept, q.response_zero_label,
    q.response_one_label, q.display_order, q.is_active, q.raw_source_payload
  from questions q
  where q.assignment_id = p_assignment_id;

  perform log_audit_event(
    'ASSIGNMENT_DUPLICATED', 'assignment', v_new_id,
    jsonb_build_object(
      'sourceAssignmentId', p_assignment_id,
      'sequenceNumber', v_sequence_number
    )
  );

  return v_new_id;
end;
$$;

revoke execute on function public.attempt_is_workable(assignment_status, attempt_state, timestamptz) from anon;
revoke execute on function public.next_assignment_sequence_number(uuid) from anon;
revoke execute on function public.get_or_create_attempt(uuid) from anon;
revoke execute on function public.save_attempt_responses(uuid, jsonb) from anon;
revoke execute on function public.submit_attempt(uuid) from anon;
revoke execute on function public.reopen_attempt(uuid) from anon;
revoke execute on function public.duplicate_assignment(uuid) from anon;
