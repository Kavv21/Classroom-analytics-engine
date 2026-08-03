-- 0024_reopen_is_per_attempt.sql
--
-- "Reopening one student's Assignment 2 also let them re-attempt Assignment
--  1", and "a submitted attempt isn't really locked".
--
-- ============================================================
-- DIAGNOSIS
-- ============================================================
--
-- Every gate that was *looked at* is scoped correctly, and that is what
-- made this hard to see:
--
--   * assignment_attempts has `unique (assignment_id, student_id)` (0001),
--     so one row IS one (assignment, student) pair;
--   * reopen_attempt (0023) takes ONE attempt id and updates ONE row;
--   * attempt_is_workable (0023) reads that row's own state/reopened_at;
--   * get_or_create_attempt filters on assignment_id AND student_id;
--   * save_attempt_responses / submit_attempt resolve the attempt by
--     `id = p_attempt_id and student_id = auth.uid()`, and everything else
--     they check hangs off that one row;
--   * the student's list, answering route and receipt route, and the
--     professor's attempts table, all filter by both ids.
--
-- The check that was at the wrong granularity is the one nothing in the
-- application calls — the RLS policies, which are the actual boundary:
--
--     attempts_student_own  on assignment_attempts
--       for ALL using (student_id = auth.uid()) with check (student_id = auth.uid())
--     responses_student_own on responses
--       for ALL using (student_id = auth.uid()) with check (student_id = auth.uid())
--
-- Those ask "is this row YOURS?" — a STUDENT-level question — and never
-- "is THIS attempt open for writing?". Combined with 0007's blanket
-- `grant select, insert, update, delete ... to authenticated`, and with the
-- three student RPCs being SECURITY INVOKER (i.e. holding no privilege the
-- caller doesn't already have themselves), the consequences were:
--
--   1. A submitted attempt was not read-only. `update responses set
--      response_value = ... where attempt_id = <a SUBMITTED attempt>` is
--      permitted for the owning student, is_final and all. Verified against
--      this schema: UPDATE 1.
--
--   2. A student could reopen THEMSELVES. SUBMITTED -> REOPENED is a legal
--      edge in the 0010 FSM trigger, and the trigger validates the EDGE, not
--      the ACTOR; `reopened_at` and `reopened_by` are ordinary columns the
--      student-level policy lets them write. So `update assignment_attempts
--      set state='REOPENED', reopened_at=now() where id = <their own
--      submitted attempt>` succeeds — and after it, attempt_is_workable is
--      satisfied and save_attempt_responses/submit_attempt accept the
--      attempt and bump submission_version. Verified: UPDATE 1, then a
--      successful save and a version-2 resubmission on an assignment nobody
--      reopened.
--
--   3. A student could DELETE their own submitted attempt (and, by cascade,
--      their responses). Verified: DELETE 1.
--
-- That is precisely the reported behaviour, and it is not per-assignment at
-- all: the permission to write was never carried by "this pair was
-- reopened", it was carried by "you own this row", which is true of every
-- assignment the student has ever touched. Reopening Assignment 2 didn't
-- unlock Assignment 1 — Assignment 1 was never locked. Cross-STUDENT
-- scoping was, and remains, correct (student A writing to student B's rows
-- is refused: UPDATE 0), which is why only the cross-assignment half of it
-- was visible from the app.
--
-- ============================================================
-- FIX
-- ============================================================
--
-- Make the boundary answer the per-attempt question, by removing the
-- student's ability to write these two tables directly at all:
--
--   * students keep SELECT on their own rows, professors keep SELECT on
--     their classes' rows — no read behaviour changes anywhere;
--   * INSERT/UPDATE/DELETE on assignment_attempts and responses are revoked
--     from `authenticated` (and there is no write policy left to back them),
--     so PostgREST cannot write them under a user's JWT by any route;
--   * the three student write paths become SECURITY DEFINER, so they are
--     the ONLY writers. They already carry the per-attempt rule
--     (attempt_is_workable) and the ownership check (student_id =
--     auth.uid()); those checks are now load-bearing rather than decorative,
--     and each one is restated below with search_path pinned and every table
--     schema-qualified (the 0010 house rule for definer functions).
--
-- Nothing about WHO may reopen changes, and nothing about the FSM changes.
-- What changes is that "reopened" is now a state only a professor can
-- create, on exactly one row, which is what made it a per-pair permission
-- in the first place.
--
-- reopen_attempt additionally takes the assignment id and refuses if it
-- doesn't match the attempt's own — the caller (the professor's attempts
-- table, which is rendered per assignment) always knows it, so a reopen
-- issued from one assignment's page can no longer land on another
-- assignment's attempt even by way of a stale id.
--
-- reopen_assignment_attempts is the bulk gesture the UI had no server side
-- for: reopen every SUBMITTED attempt on ONE assignment. It is a loop over
-- exactly the same per-attempt rule, filtered by assignment_id, so "for all
-- students" means all students *of that assignment* and cannot widen to a
-- sibling assignment.
--
-- Service-role paths (scripts/seed.ts, scripts/seed-demo-responses.ts,
-- load-tests/) are unaffected: service_role keeps its own grants. The demo
-- seed writes responses by signing in as the synthetic student and calling
-- save_attempt_responses — still the real path, and 0020's is_synthetic
-- branch and provenance copy are carried forward verbatim below.

-- ============================================================
-- 1. Privileges: no direct student/professor writes to student data.
-- ============================================================

revoke insert, update, delete on public.assignment_attempts from authenticated;
revoke insert, update, delete on public.responses from authenticated;
revoke insert, update, delete on public.assignment_attempts from anon;
revoke insert, update, delete on public.responses from anon;

-- ============================================================
-- 2. Policies: read-only for both roles. Writes have no policy AND no
--    privilege — either alone would be enough; both is deliberate, because
--    a future `grant` that re-widens 0007 must not silently re-open this.
-- ============================================================

drop policy if exists attempts_student_own on public.assignment_attempts;
drop policy if exists attempts_student_select on public.assignment_attempts;
create policy attempts_student_select on public.assignment_attempts
  for select using (student_id = auth.uid());

drop policy if exists attempts_professor_manage on public.assignment_attempts;
drop policy if exists attempts_professor_select on public.assignment_attempts;
create policy attempts_professor_select on public.assignment_attempts
  for select using (
    exists (
      select 1 from public.assignments a
      where a.id = assignment_attempts.assignment_id
        and public.is_professor_of_class(a.class_id)
    )
  );

drop policy if exists responses_student_own on public.responses;
drop policy if exists responses_student_select on public.responses;
create policy responses_student_select on public.responses
  for select using (student_id = auth.uid());

-- responses_professor_select (0008) is already SELECT-only; left alone.

-- ============================================================
-- 3. get_or_create_attempt — 0023's body, now SECURITY DEFINER.
--    The class-membership check and the student_id = auth.uid() filter are
--    what authorise it; both were already here.
-- ============================================================

create or replace function public.get_or_create_attempt(p_assignment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.assignment_attempts%rowtype;
  v_status public.assignment_status;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select a.status into v_status
  from public.assignments a
  where a.id = p_assignment_id
    and public.is_class_member(a.class_id);

  if v_status is null then
    raise exception 'assignment not found, or you are not a member of its class';
  end if;

  select * into v_attempt
  from public.assignment_attempts
  where assignment_id = p_assignment_id and student_id = auth.uid();

  if v_status = 'OPEN' then
    insert into public.assignment_attempts (assignment_id, student_id, state, started_at)
    values (p_assignment_id, auth.uid(), 'NOT_STARTED', now())
    on conflict (assignment_id, student_id) do nothing;

    select * into v_attempt
    from public.assignment_attempts
    where assignment_id = p_assignment_id and student_id = auth.uid();
  elsif not (
    v_attempt.id is not null
    and public.attempt_is_workable(v_status, v_attempt.state, v_attempt.reopened_at)
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
-- 4. save_attempt_responses — 0023's body (which is 0020's), now SECURITY
--    DEFINER. The synthetic branch and the is_synthetic provenance on the
--    response insert are carried forward verbatim; see 0023's note.
-- ============================================================

create or replace function public.save_attempt_responses(
  p_attempt_id uuid,
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.assignment_attempts%rowtype;
  v_allow_draft_editing boolean;
  v_assignment_status public.assignment_status;
  answer jsonb;
  v_question_id uuid;
  v_value smallint;
  v_existing smallint;
  v_has_existing boolean;
  v_saved int := 0;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  -- The attempt is resolved by BOTH ids that identify it: this row, and
  -- this student. Everything below hangs off this one row, so no later
  -- check can widen to another assignment.
  select * into v_attempt
  from public.assignment_attempts
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
  from public.assignments a
  where a.id = v_attempt.assignment_id;

  -- A synthetic attempt may be seeded into an assignment that has already
  -- closed (migration 0020). The assignment is NOT reopened by that path,
  -- and 0020's triggers make the flag unforgeable by anon/authenticated.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif not public.attempt_is_workable(v_assignment_status, v_attempt.state, v_attempt.reopened_at) then
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
      select 1 from public.questions q
      where q.id = v_question_id
        and q.assignment_id = v_attempt.assignment_id
        and q.is_active
    ) then
      raise exception 'question % does not belong to this assignment (or is inactive)', v_question_id;
    end if;

    select r.response_value, true into v_existing, v_has_existing
    from public.responses r
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
    insert into public.responses (
      attempt_id, assignment_id, student_id, question_id, response_value, is_synthetic
    ) values (
      p_attempt_id, v_attempt.assignment_id, v_attempt.student_id, v_question_id, v_value,
      v_attempt.is_synthetic
    )
    on conflict (attempt_id, question_id) do update set
      response_value = excluded.response_value,
      last_saved_at = now(),
      updated_at = now();

    v_saved := v_saved + 1;
  end loop;

  -- NOT_STARTED -> DRAFT / REOPENED -> DRAFT / DRAFT -> DRAFT, all legal.
  update public.assignment_attempts set
    state = 'DRAFT',
    started_at = coalesce(started_at, now()),
    last_saved_at = now(),
    updated_at = now()
  where id = p_attempt_id;

  return jsonb_build_object('saved', v_saved, 'state', 'DRAFT', 'savedAt', now());
end;
$$;

-- ============================================================
-- 5. submit_attempt — 0023's body, now SECURITY DEFINER. Still no automatic
--    caller anywhere (EXCLUDED_FEATURES.md).
--
--    It also clears reopened_at on the way out: the reopen grant is spent
--    the moment the student resubmits, so a later DRAFT state (which can
--    only be reached through a fresh REOPENED) cannot inherit an old one.
--    reopened_by is kept — who let this student back in is a record, not a
--    permission.
-- ============================================================

create or replace function public.submit_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt public.assignment_attempts%rowtype;
  v_assignment_status public.assignment_status;
  v_new_state public.attempt_state;
  v_new_version int;
  v_answered int;
  v_total int;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_attempt
  from public.assignment_attempts
  where id = p_attempt_id and student_id = auth.uid()
  for update;

  if v_attempt.id is null then
    raise exception 'attempt not found, or it is not yours';
  end if;

  if v_attempt.state in ('SUBMITTED', 'RESUBMITTED') then
    raise exception 'already submitted — this attempt was submitted at %', v_attempt.submitted_at;
  end if;

  select a.status into v_assignment_status
  from public.assignments a where a.id = v_attempt.assignment_id;

  -- Same narrow synthetic exception as save_attempt_responses. See 0020.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif not public.attempt_is_workable(v_assignment_status, v_attempt.state, v_attempt.reopened_at) then
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

  update public.responses set
    is_final = true,
    submitted_at = now(),
    version = v_new_version,
    updated_at = now()
  where attempt_id = p_attempt_id;

  update public.assignment_attempts set
    state = v_new_state,
    submitted_at = now(),
    submission_version = v_new_version,
    reopened_at = null,
    updated_at = now()
  where id = p_attempt_id;

  select
    count(*) filter (where r.response_value is not null),
    (select count(*) from public.questions q
      where q.assignment_id = v_attempt.assignment_id and q.is_active)
  into v_answered, v_total
  from public.responses r
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
-- 6. reopen_attempt — one attempt, named by BOTH ids.
--
-- The single-argument form is dropped: an attempt id alone is enough to
-- find the row, but it is not enough for the CALLER to state which
-- assignment it believed it was acting on, and that mismatch is exactly
-- what "reopening A2 also reopened A1" would look like if it ever came from
-- the application side. The professor's attempts table is rendered per
-- assignment and always has both.
-- ============================================================

drop function if exists public.reopen_attempt(uuid);

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
    and public.is_professor_of_class(a.class_id)
  for update of att;

  if v_attempt.id is null then
    raise exception 'attempt not found on that assignment, or you are not the professor of its class';
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

comment on function public.reopen_attempt(uuid, uuid) is
  'Professor-only SUBMITTED -> REOPENED for exactly one (assignment, student) pair. The assignment id is required and must match the attempt''s own, so a reopen cannot be issued against an attempt on a different assignment.';

-- ============================================================
-- 7. reopen_assignment_attempts — "reopen for the whole class", scoped to
--    ONE assignment.
--
-- Same per-attempt rule as reopen_attempt, applied to every SUBMITTED
-- attempt whose assignment_id is this one. Attempts that are NOT_STARTED,
-- DRAFT, REOPENED or RESUBMITTED are left exactly as they are — this
-- reopens submissions, it does not reset anybody's work — and no other
-- assignment is touched, because assignment_id is the only selector.
--
-- This is NOT the same gesture as CLOSED -> OPEN on the assignment (0023).
-- That one lets everyone who has not yet submitted carry on; this one lets
-- the students who HAVE submitted submit again, and leaves the assignment's
-- own status alone.
-- ============================================================

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
    and public.is_professor_of_class(a.class_id);

  if v_status is null then
    raise exception 'assignment not found, or you are not the professor of its class';
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

comment on function public.reopen_assignment_attempts(uuid) is
  'Professor-only bulk reopen: every SUBMITTED attempt on THIS assignment, and no attempt on any other assignment. Leaves the assignment''s own status unchanged.';

-- ============================================================
-- 8. Execute privileges. anon has no business calling any of these.
-- ============================================================

revoke execute on function public.get_or_create_attempt(uuid) from anon;
revoke execute on function public.save_attempt_responses(uuid, jsonb) from anon;
revoke execute on function public.submit_attempt(uuid) from anon;
revoke execute on function public.reopen_attempt(uuid, uuid) from anon;
revoke execute on function public.reopen_assignment_attempts(uuid) from anon;

grant execute on function public.reopen_attempt(uuid, uuid) to authenticated;
grant execute on function public.reopen_assignment_attempts(uuid) to authenticated;

notify pgrst, 'reload schema';
