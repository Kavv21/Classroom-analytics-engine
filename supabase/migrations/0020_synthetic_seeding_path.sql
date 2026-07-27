-- 0020_synthetic_seeding_path.sql
-- Let synthetic demo data be seeded against assignments that are already
-- CLOSED, without loosening the assignment lifecycle for anyone else.
--
-- ============================================================
-- THE PROBLEM
-- ============================================================
-- The assignment FSM is one-way: DRAFT -> READY -> OPEN -> CLOSED ->
-- ARCHIVED. There is deliberately no path back to OPEN, and there must not
-- be — a closed assignment is a finished record of real classroom activity.
--
-- But `save_attempt_responses` and `submit_attempt` (migration 0010) both
-- refuse a non-OPEN assignment, and the demo seed submits through those
-- exact functions on purpose, so that the synthetic cohort is produced by
-- the same validated path a real student's CSV upload takes. Once the real
-- assignments closed, the seed had nowhere to write.
--
-- ============================================================
-- WHAT WAS REJECTED, AND WHY
-- ============================================================
-- 1. Adding CLOSED -> OPEN to enforce_assignment_status_transition().
--    Creates a genuine reopen capability for the whole app to serve one
--    maintenance need. Not proportionate.
--
-- 2. A separate SECURITY DEFINER "seed_responses" function that mimics
--    save_attempt_responses without the status check.
--    This was the obvious candidate and it is worse than it looks. It
--    duplicates the 0/1 enforcement, the question-belongs-to-this-
--    assignment check, the write-once draft rule, the upsert key and the
--    attempt state transition — an entire second implementation that
--    drifts silently the first time the real one changes. It also defeats
--    the reason the seed goes through the CSV path at all: proving the
--    REAL path works at volume proves nothing if the seed calls a
--    lookalike. And it adds a new response-writing SECURITY DEFINER
--    surface, which is the most sensitive kind of function in this schema.
--
-- 3. Bracketing the seed run by forcing the status to OPEN and back with
--    the FSM trigger disabled (the migration-0019 pattern).
--    No schema change and no new capability, which is attractive — but it
--    leaves the assignment genuinely OPEN for the duration, so a real
--    student could submit into that window, and it needs a direct
--    Postgres connection the seed script does not otherwise have.
--
-- ============================================================
-- WHAT THIS DOES INSTEAD
-- ============================================================
-- One condition, in the real functions: a SYNTHETIC attempt may be written
-- to an assignment that has been published, whatever its current status.
-- Nothing is duplicated, no function is added, the FSM is untouched, and
-- the assignment stays CLOSED throughout — it is never reopened, because
-- nothing is ever reopened.
--
-- ============================================================
-- WHY THIS NEEDED A SECURITY FIX FIRST
-- ============================================================
-- Migration 0017 introduced `is_synthetic` as a LABEL. This migration
-- promotes it to a SECURITY BOUNDARY, and it was not safe to be one:
--
--     policy attempts_student_own  FOR ALL  USING (student_id = auth.uid())
--
-- is a FOR ALL policy, so a real student can UPDATE their own attempt row
-- today — including setting is_synthetic = true. Gating the exception on
-- that flag alone would have let any student mark their own attempt
-- synthetic and then submit to a closed assignment. That is a privilege
-- escalation, and it is the whole reason for the trigger below.
--
-- After this migration, only a non-end-user role can raise the flag on a
-- profile, an enrolment or an attempt. `anon` and `authenticated` — the two
-- roles any browser session can ever hold — cannot, so the seed's
-- service-role step is the only way a synthetic attempt comes into
-- existence. Responses are the one exception: they may inherit
-- is_synthetic from their parent attempt, because that is precisely what
-- save_attempt_responses does while running as the student.

-- ============================================================
-- 1. Make is_synthetic unforgeable by an end user.
-- ============================================================

create or replace function public.enforce_synthetic_flag_authority()
returns trigger
language plpgsql
as $$
begin
  -- Only the transition INTO true is gated. Leaving it true, or clearing
  -- it, needs no authority: neither grants anything.
  if coalesce(new.is_synthetic, false)
     and not coalesce(
       case when tg_op = 'UPDATE' then old.is_synthetic else false end, false)
  then
    -- `anon` and `authenticated` are the only roles a browser session can
    -- hold. Everything else (service_role, the migration owner, a direct
    -- psql session) is a maintainer context by definition.
    if current_user in ('anon', 'authenticated') then
      raise exception
        'is_synthetic may not be set by % — it marks demo data and gates the synthetic seeding path',
        current_user
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

comment on function public.enforce_synthetic_flag_authority() is
  'Blocks anon/authenticated from raising is_synthetic. The flag gates the closed-assignment seeding exception in save_attempt_responses/submit_attempt, so a student able to set it could submit to a closed assignment.';

create trigger profiles_synthetic_flag_authority
  before insert or update on public.profiles
  for each row execute function public.enforce_synthetic_flag_authority();

create trigger class_members_synthetic_flag_authority
  before insert or update on public.class_members
  for each row execute function public.enforce_synthetic_flag_authority();

create trigger attempts_synthetic_flag_authority
  before insert or update on public.assignment_attempts
  for each row execute function public.enforce_synthetic_flag_authority();

-- Responses inherit provenance from their attempt. save_attempt_responses
-- runs as the student (security invoker), so it MUST be able to write
-- is_synthetic = true on a response whose attempt is already synthetic —
-- and only then.
create or replace function public.enforce_response_synthetic_inheritance()
returns trigger
language plpgsql
as $$
declare
  v_attempt_is_synthetic boolean;
begin
  if coalesce(new.is_synthetic, false)
     and not coalesce(
       case when tg_op = 'UPDATE' then old.is_synthetic else false end, false)
  then
    select a.is_synthetic into v_attempt_is_synthetic
    from public.assignment_attempts a
    where a.id = new.attempt_id;

    if not coalesce(v_attempt_is_synthetic, false)
       and current_user in ('anon', 'authenticated')
    then
      raise exception
        'is_synthetic may only be set on a response whose attempt is synthetic'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;

create trigger responses_synthetic_flag_authority
  before insert or update on public.responses
  for each row execute function public.enforce_response_synthetic_inheritance();

-- ============================================================
-- 2. The exception itself, inside the real functions.
--
-- Only the status condition changes. Every other check — ownership,
-- attempt state, 0/1 enforcement, question membership, the write-once
-- draft rule, the upsert key — is untouched and still applies to synthetic
-- data exactly as it does to a real submission.
--
-- `published_status` rather than "any status": a DRAFT or READY assignment
-- may still be having its questions imported or corrected, and seeding into
-- one would attach responses to questions that are about to change (which
-- the 0009 immutability trigger would then freeze). An assignment that has
-- been OPEN at some point is settled.
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
  -- closed. The assignment is NOT reopened; this is the only condition
  -- that differs, and migration 0020's triggers make the flag unforgeable
  -- by anon/authenticated.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif v_assignment_status is distinct from 'OPEN' then
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

    -- Provenance flows from the attempt, so a seeded response is marked
    -- without the seed script having to go back and tag rows afterwards.
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

  update assignment_attempts set
    state = 'DRAFT',
    started_at = coalesce(started_at, now()),
    last_saved_at = now(),
    updated_at = now()
  where id = p_attempt_id;

  return jsonb_build_object('saved', v_saved, 'state', 'DRAFT', 'savedAt', now());
end;
$$;

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

  -- Same narrow exception as save_attempt_responses. See migration 0020.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif v_assignment_status is distinct from 'OPEN' then
    raise exception 'the assignment is no longer open (status: %)', v_assignment_status;
  end if;

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
