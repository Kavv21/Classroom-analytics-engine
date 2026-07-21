-- 0010_student_attempts.sql
-- Phase 5: student response workflow — attempt state machine enforced in
-- the database, batched idempotent autosave, transactional duplicate-proof
-- submission, professor-only reopen.
--
-- House rules applied throughout (see 0004/0007/0008/0009 postmortems):
--  * SECURITY DEFINER functions pin search_path = public and
--    schema-qualify every table reference;
--  * cross-table authorization goes through the 0008 helpers
--    (is_class_member / is_professor_of_class), never a raw correlated
--    subquery in a policy;
--  * no new tables → 0007's grants/default privileges are untouched; the
--    new functions get EXECUTE revoked from anon (auth.uid() would be null
--    anyway, but there is no reason to let anon call them at all).

-- ============================================================
-- Attempt state machine. The ONLY legal transitions
-- (docs/DATABASE_SCHEMA.md — reject everything else):
--   NOT_STARTED -> DRAFT        NOT_STARTED -> SUBMITTED
--   DRAFT -> DRAFT              DRAFT -> SUBMITTED
--   SUBMITTED -> REOPENED
--   REOPENED -> DRAFT           REOPENED -> RESUBMITTED
-- DRAFT -> DRAFT is the repeated-autosave case and is a state-unchanged
-- update; updates that do not change `state` are not transitions and are
-- allowed (bookkeeping like last_saved_at). A trigger, not app code, so it
-- binds every role — service_role bypasses RLS but not triggers.
-- ============================================================

create or replace function public.enforce_attempt_state_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- A new row IS the NOT_STARTED -> x transition; only the two states
    -- reachable from NOT_STARTED (or NOT_STARTED itself) may be created
    -- directly, and SUBMITTED creation is reserved for submit_attempt.
    if new.state not in ('NOT_STARTED', 'DRAFT') then
      raise exception 'an attempt cannot be created in state % — start at NOT_STARTED', new.state;
    end if;
    return new;
  end if;

  if new.state = old.state then
    return new;
  end if;

  if not (
    (old.state = 'NOT_STARTED' and new.state = 'DRAFT')
    or (old.state = 'NOT_STARTED' and new.state = 'SUBMITTED')
    or (old.state = 'DRAFT'       and new.state = 'SUBMITTED')
    or (old.state = 'SUBMITTED'   and new.state = 'REOPENED')
    or (old.state = 'REOPENED'    and new.state = 'DRAFT')
    or (old.state = 'REOPENED'    and new.state = 'RESUBMITTED')
  ) then
    raise exception 'invalid attempt state transition: % -> %', old.state, new.state;
  end if;

  return new;
end;
$$;

drop trigger if exists attempts_state_transition on public.assignment_attempts;
create trigger attempts_state_transition
  before insert or update on public.assignment_attempts
  for each row execute function public.enforce_attempt_state_transition();

-- ============================================================
-- get_or_create_attempt: idempotent "open the assignment" entry point.
-- SECURITY INVOKER — attempts_student_own RLS applies to the write; the
-- explicit checks exist for clear errors. The unique (assignment_id,
-- student_id) constraint makes concurrent first-opens collapse to one row.
-- ============================================================

create or replace function public.get_or_create_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql
security invoker
as $$
declare
  v_attempt assignment_attempts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  if not exists (
    select 1 from assignments a
    where a.id = p_assignment_id
      and a.status = 'OPEN'
      and is_class_member(a.class_id)
  ) then
    raise exception 'assignment is not open, or you are not a member of its class';
  end if;

  insert into assignment_attempts (assignment_id, student_id, state, started_at)
  values (p_assignment_id, auth.uid(), 'NOT_STARTED', now())
  on conflict (assignment_id, student_id) do nothing;

  select * into v_attempt
  from assignment_attempts
  where assignment_id = p_assignment_id and student_id = auth.uid();

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
-- save_attempt_responses: batched, debounced autosave target. Idempotent —
-- upserts on (attempt_id, question_id), so replaying the same batch (retry
-- after a dropped connection) converges to the same rows. One transaction;
-- any bad answer aborts the whole batch loudly.
--
-- allow_draft_editing = false means a saved answer is write-once: blank
-- answers can be filled in, but changing an already-saved 0/1 is rejected.
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

  if v_assignment_status is distinct from 'OPEN' then
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

    insert into responses (
      attempt_id, assignment_id, student_id, question_id, response_value
    ) values (
      p_attempt_id, v_attempt.assignment_id, auth.uid(), v_question_id, v_value
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
-- submit_attempt: the transactional final submission. `for update` locks
-- the attempt row, so a double-click / double-request serializes: the
-- second caller sees SUBMITTED and gets a clear "already submitted" error —
-- never two submissions and never a bumped version. There is deliberately
-- NO automatic path to this function: it only runs when the student
-- explicitly invokes it (EXCLUDED_FEATURES.md — no auto-submission).
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

  if v_assignment_status is distinct from 'OPEN' then
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
-- reopen_attempt: professor-triggered only. SECURITY DEFINER because the
-- professor must also clear responses.is_final, and professors have
-- (deliberately) no UPDATE policy on responses — this function is the one
-- narrow write path, gated by an explicit is_professor_of_class check,
-- following the set_student_active precedent (0005). Only SUBMITTED can be
-- reopened: RESUBMITTED is terminal in the FSM.
-- ============================================================

create or replace function public.reopen_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.assignment_attempts%rowtype;
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

  if v_attempt.state <> 'SUBMITTED' then
    raise exception 'only a SUBMITTED attempt can be reopened (current state: %)', v_attempt.state;
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
      'submissionVersion', v_attempt.submission_version
    )
  );

  return jsonb_build_object('attemptId', p_attempt_id, 'state', 'REOPENED');
end;
$$;

revoke execute on function public.get_or_create_attempt(uuid) from anon;
revoke execute on function public.save_attempt_responses(uuid, jsonb) from anon;
revoke execute on function public.submit_attempt(uuid) from anon;
revoke execute on function public.reopen_attempt(uuid) from anon;
