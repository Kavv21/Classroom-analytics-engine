-- ============================================================
-- 0029 — Date-driven scheduling: open_at/close_at replace the manual
--        "Open assignment" button as the thing that lets students in.
--
-- WHAT WAS WRONG
-- `assignments.open_at` and `assignments.close_at` have existed since
-- 0001_init.sql. The create/edit form collected them, the detail page
-- printed them, and NOTHING ELSE READ THEM. Student access was decided
-- entirely by `assignments.status`: a professor pressed "Publish to
-- students" (READY -> OPEN) to let the class in and "Close assignment"
-- (OPEN -> CLOSED) to shut it again, and the two date columns were
-- decoration. A professor who set "closes 20 Aug 17:00" and went home got
-- an assignment that stayed open indefinitely.
--
-- WHAT THIS DOES
-- The window becomes the mechanism, evaluated lazily at request time. There
-- is no cron job and no scheduled function: every access and every write
-- compares now() against the row's own dates, which is exact to the second
-- and needs no infrastructure to keep running. For a tool used a handful of
-- times a semester, a background job that flips a column would be strictly
-- more machinery and strictly less correct.
--
-- THE RULE (`assignment_accepts_answers`, below):
--
--   READY  — scheduled. Answerable only when BOTH dates are set and now()
--            is inside [open_at, close_at]. A READY assignment missing
--            either date is NOT scheduled and nobody can reach it.
--            Deliberately fail-closed: READY has always meant "approved,
--            not yet released", and "no dates" must never come to mean
--            "open to the world".
--   OPEN   — the legacy manually-published status. Every assignment already
--            live in the production database is sitting in it, so a missing
--            bound stays an ABSENT bound: open_at null = already open,
--            close_at null = no end. An OPEN row with no dates behaves
--            exactly as it did yesterday; one with dates now has them
--            enforced. Nothing in the UI moves an assignment into OPEN any
--            more, but nothing breaks that is already there.
--   others — never. DRAFT is unapproved, CLOSED is retired, ARCHIVED is out
--            of play.
--
-- DRAFT -> READY IS UNTOUCHED. It is still the professor's manual,
-- checkbox-confirmed approval of the full question list, still refuses an
-- assignment with no active questions, and no date can substitute for it.
-- Scheduling is what happens AFTER approval, never instead of it.
--
-- CLOSED -> ARCHIVED, unarchive_assignment and
-- delete_assignment_permanently are untouched by this migration. The two
-- reopen RPCs are touched in exactly one place — the guard that used to
-- read "status in ('OPEN','CLOSED')" becomes "has this ever opened?", so
-- that reopening one student's attempt still works on a scheduled
-- assignment. See section 7.
-- ============================================================

-- ============================================================
-- 1. Status transitions: READY <-> CLOSED.
--
-- A scheduled assignment now LIVES at READY — it never passes through
-- OPEN — so without these edges a scheduled assignment could never be
-- retired, and ARCHIVED (reachable only from CLOSED) would become
-- unreachable for every assignment created from here on.
--
--   READY  -> CLOSED : retire it. Ends access whatever the dates say, and
--                      is the gateway to ARCHIVED.
--   CLOSED -> READY  : put it back on the calendar with a new window.
--
-- READY -> OPEN and CLOSED -> OPEN are deliberately LEFT IN PLACE. They are
-- no longer offered anywhere in the UI, but removing an edge from a live
-- FSM breaks whatever is mid-flight, and OPEN still has to be reachable for
-- the rows already in it.
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
    or (old.status = 'READY' and new.status = 'CLOSED')
    or (old.status = 'OPEN'  and new.status = 'CLOSED')
    or (old.status = 'CLOSED' and new.status = 'OPEN')
    or (old.status = 'CLOSED' and new.status = 'READY')
    or (old.status = 'CLOSED' and new.status = 'ARCHIVED')
  ) then
    raise exception 'invalid assignment status transition: % -> %', old.status, new.status;
  end if;

  -- Unchanged from 0009/0023: approval requires something to approve.
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
-- 2. The schedule predicates.
--
-- STABLE, not IMMUTABLE: they read now(). That also means they cannot be
-- used in an index, which is correct — the answer changes with the clock,
-- so there is nothing to cache.
-- ============================================================

create or replace function public.assignment_accepts_answers(
  p_status public.assignment_status,
  p_open_at timestamptz,
  p_close_at timestamptz
) returns boolean
language sql
stable
set search_path = public
as $$
  select case
    -- Scheduled: both bounds required, both inclusive. A student clicking
    -- at exactly the closing second is inside the window, not outside.
    when p_status = 'READY' then
      p_open_at is not null
      and p_close_at is not null
      and now() >= p_open_at
      and now() <= p_close_at
    -- Legacy manual publication: a null bound is an absent bound.
    when p_status = 'OPEN' then
      (p_open_at is null or now() >= p_open_at)
      and (p_close_at is null or now() <= p_close_at)
    else false
  end;
$$;

comment on function public.assignment_accepts_answers(public.assignment_status, timestamptz, timestamptz) is
  'May the CLASS answer this assignment right now? READY needs both dates and now() inside [open_at, close_at]; OPEN is the legacy manual status where a null bound is no bound. Evaluated at request time — there is no cron flipping statuses. Mirrored in TypeScript by assignmentAcceptsAnswers() in lib/assignments/schedule.ts.';

create or replace function public.assignment_has_opened(
  p_status public.assignment_status,
  p_open_at timestamptz
) returns boolean
language sql
stable
set search_path = public
as $$
  select case
    -- Anything manually published, or closed after being published, has
    -- been in front of students by definition.
    when p_status in ('OPEN', 'CLOSED') then true
    when p_status = 'READY' then p_open_at is not null and now() >= p_open_at
    else false
  end;
$$;

comment on function public.assignment_has_opened(public.assignment_status, timestamptz) is
  'Has this assignment ever been in front of students? Gates the per-attempt reopen (you cannot be readmitted to something that never opened) and student read access to questions, which must survive the end of the window for receipts.';

-- ============================================================
-- 3. attempt_is_workable — now takes the window.
--
-- The 3-argument form from 0023 is dropped: its whole answer was
-- "status = OPEN", which is no longer the question. Its only callers are
-- the three RPCs replaced below.
--
-- The reopen branch is widened from "CLOSED" to "has opened", so a
-- professor can still readmit ONE student after a scheduled window shuts —
-- which is the entire point of the per-attempt reopen, and would otherwise
-- have silently stopped working for every scheduled assignment. It is not
-- a widening of authority: reopened_at is only ever set by
-- reopen_attempt / reopen_assignment_attempts, both professor/TA-only.
-- ============================================================

drop function if exists public.attempt_is_workable(
  public.assignment_status, public.attempt_state, timestamptz
);

create or replace function public.attempt_is_workable(
  p_assignment_status public.assignment_status,
  p_open_at timestamptz,
  p_close_at timestamptz,
  p_attempt_state public.attempt_state,
  p_reopened_at timestamptz
) returns boolean
language sql
stable
set search_path = public
as $$
  select
    public.assignment_accepts_answers(p_assignment_status, p_open_at, p_close_at)
    or (
      public.assignment_has_opened(p_assignment_status, p_open_at)
      and p_reopened_at is not null
      and p_attempt_state in ('REOPENED', 'DRAFT')
    );
$$;

comment on function public.attempt_is_workable(public.assignment_status, timestamptz, timestamptz, public.attempt_state, timestamptz) is
  'May this student still edit/submit this attempt? True while the assignment''s schedule window admits now(), and for an individually reopened attempt on an assignment that has opened but is no longer accepting answers — until they submit again.';

-- ============================================================
-- 4. get_or_create_attempt — 0024's body, with the window read alongside
--    the status and the OPEN test replaced by the schedule predicate.
--
--    The error message names the actual reason. "assignment is not open
--    (status: READY)" would be useless to a student looking at a page that
--    says "opens Thursday".
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
  v_open_at timestamptz;
  v_close_at timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select a.status, a.open_at, a.close_at
    into v_status, v_open_at, v_close_at
  from public.assignments a
  where a.id = p_assignment_id
    and public.is_class_member(a.class_id);

  if v_status is null then
    raise exception 'assignment not found, or you are not a member of its class';
  end if;

  select * into v_attempt
  from public.assignment_attempts
  where assignment_id = p_assignment_id and student_id = auth.uid();

  if public.assignment_accepts_answers(v_status, v_open_at, v_close_at) then
    insert into public.assignment_attempts (assignment_id, student_id, state, started_at)
    values (p_assignment_id, auth.uid(), 'NOT_STARTED', now())
    on conflict (assignment_id, student_id) do nothing;

    select * into v_attempt
    from public.assignment_attempts
    where assignment_id = p_assignment_id and student_id = auth.uid();
  elsif not (
    v_attempt.id is not null
    and public.attempt_is_workable(
      v_status, v_open_at, v_close_at, v_attempt.state, v_attempt.reopened_at
    )
  ) then
    if v_open_at is not null and now() < v_open_at then
      raise exception 'this assignment is not open yet — it opens at %', v_open_at;
    elsif v_close_at is not null and now() > v_close_at then
      raise exception 'this assignment closed at %', v_close_at;
    else
      raise exception 'assignment is not open (status: %)', v_status;
    end if;
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
-- 5. save_attempt_responses — 0024's body verbatim except for the window.
--    The synthetic-seeding branch (0020) is carried forward and gains
--    'READY': a demo assignment scheduled rather than hand-published is
--    still a published assignment as far as seeding is concerned.
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
  v_open_at timestamptz;
  v_close_at timestamptz;
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

  select a.status, a.allow_draft_editing, a.open_at, a.close_at
    into v_assignment_status, v_allow_draft_editing, v_open_at, v_close_at
  from public.assignments a
  where a.id = v_attempt.assignment_id;

  -- A synthetic attempt may be seeded into an assignment that has already
  -- closed (migration 0020). The assignment is NOT reopened by that path,
  -- and 0020's triggers make the flag unforgeable by anon/authenticated.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('READY', 'OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif not public.attempt_is_workable(
    v_assignment_status, v_open_at, v_close_at, v_attempt.state, v_attempt.reopened_at
  ) then
    if v_open_at is not null and now() < v_open_at then
      raise exception 'this assignment is not open yet — it opens at %', v_open_at;
    elsif v_close_at is not null and now() > v_close_at then
      raise exception 'this assignment closed at % — nothing more can be saved', v_close_at;
    else
      raise exception 'the assignment is no longer open (status: %)', v_assignment_status;
    end if;
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
-- 6. submit_attempt — 0024's body, same one-line change. Still no automatic
--    caller anywhere (EXCLUDED_FEATURES.md): the window closing does NOT
--    submit anyone's draft for them. It stops accepting writes, which is a
--    different thing, and the draft stays a draft.
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
  v_open_at timestamptz;
  v_close_at timestamptz;
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

  select a.status, a.open_at, a.close_at
    into v_assignment_status, v_open_at, v_close_at
  from public.assignments a where a.id = v_attempt.assignment_id;

  -- Same narrow synthetic exception as save_attempt_responses. See 0020.
  if v_attempt.is_synthetic then
    if v_assignment_status not in ('READY', 'OPEN', 'CLOSED', 'ARCHIVED') then
      raise exception
        'synthetic seeding needs an assignment that has been published (status: %)', v_assignment_status;
    end if;
  elsif not public.attempt_is_workable(
    v_assignment_status, v_open_at, v_close_at, v_attempt.state, v_attempt.reopened_at
  ) then
    if v_open_at is not null and now() < v_open_at then
      raise exception 'this assignment is not open yet — it opens at %', v_open_at;
    elsif v_close_at is not null and now() > v_close_at then
      raise exception 'this assignment closed at % — it can no longer be submitted', v_close_at;
    else
      raise exception 'the assignment is no longer open (status: %)', v_assignment_status;
    end if;
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
-- 7. Reopening, after a scheduled window shuts.
--
-- Both reopen RPCs refused any assignment that was not OPEN or CLOSED, with
-- the right reasoning ("the student would have nowhere to answer") and a
-- test that is no longer the right test: a scheduled assignment sits at
-- READY, so the professor's one tool for letting a single student finish
-- late would have failed on every assignment created from here on.
--
-- The guard becomes `assignment_has_opened`, which is the same question
-- asked correctly: has this ever been in front of students? A DRAFT or an
-- unopened schedule still refuses. Everything else about these two —
-- SUBMITTED-only, can_manage_class_content, the audit events, the
-- one-assignment scope from 0024 — is carried forward from 0028 verbatim.
-- ============================================================

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
  v_open_at timestamptz;
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

  select a.status, a.open_at into v_status, v_open_at
  from public.assignments a
  where a.id = v_attempt.assignment_id;

  if v_attempt.state <> 'SUBMITTED' then
    raise exception 'only a SUBMITTED attempt can be reopened (current state: %)', v_attempt.state;
  end if;

  if not public.assignment_has_opened(v_status, v_open_at) then
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
  v_open_at timestamptz;
  v_class_id uuid;
  v_attempt record;
  v_reopened int := 0;
begin
  select a.status, a.open_at, a.class_id into v_status, v_open_at, v_class_id
  from public.assignments a
  where a.id = p_assignment_id
    and public.can_manage_class_content(a.class_id);

  if v_status is null then
    raise exception 'assignment not found, or you do not manage its class';
  end if;

  if not public.assignment_has_opened(v_status, v_open_at) then
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

-- ============================================================
-- 8. RLS: a hidden button is not a boundary, and neither is a redirect.
--
-- assignments_student_select (0008) showed statuses OPEN and CLOSED. A
-- scheduled assignment sits at READY, so without this it would be invisible
-- to the very students it is scheduled for — and the answering route would
-- 404 rather than say "opens Thursday".
--
-- READY is admitted only once it is actually SCHEDULED (both dates set). An
-- approved-but-unscheduled assignment stays invisible, exactly as it is
-- today: a professor mid-setup has not decided to show anyone anything.
--
-- questions_student_select is deliberately STRICTER than the assignment
-- row: a student may see that an assignment exists and when it opens, but
-- must not be able to read the question text before it opens. It stays
-- readable after the window shuts — the receipt page and any reopened
-- attempt both need the questions after the fact.
-- ============================================================

drop policy if exists assignments_student_select on public.assignments;
create policy assignments_student_select on public.assignments
  for select using (
    (
      status in ('OPEN', 'CLOSED')
      or (status = 'READY' and open_at is not null and close_at is not null)
    )
    and public.is_class_member(assignments.class_id)
  );

drop policy if exists questions_student_select on public.questions;
create policy questions_student_select on public.questions
  for select using (
    exists (
      select 1 from public.assignments a
      where a.id = questions.assignment_id
        and public.assignment_has_opened(a.status, a.open_at)
        and public.is_class_member(a.class_id)
    )
  );

-- ============================================================
-- 9. A window that ends before it starts is not a window.
--
-- NOT VALID on purpose: this runs against a live database whose existing
-- rows were written when nothing checked the pair, and a migration that
-- refuses to apply because of one historical row is worse than one that
-- guarantees every row written from now on is sane. To adopt the existing
-- rows once they have been eyeballed:
--
--   alter table public.assignments validate constraint assignments_window_ordered;
-- ============================================================

alter table public.assignments
  drop constraint if exists assignments_window_ordered;

alter table public.assignments
  add constraint assignments_window_ordered
  check (open_at is null or close_at is null or close_at >= open_at)
  not valid;

-- ============================================================
-- 10. Grants — unchanged in substance, restated because the signature of
--    attempt_is_workable changed and the two new predicates are new
--    objects. The RPCs stay SECURITY DEFINER and anon-free, as in 0024.
-- ============================================================

revoke execute on function public.assignment_accepts_answers(public.assignment_status, timestamptz, timestamptz) from anon;
revoke execute on function public.assignment_has_opened(public.assignment_status, timestamptz) from anon;
revoke execute on function public.attempt_is_workable(public.assignment_status, timestamptz, timestamptz, public.attempt_state, timestamptz) from anon;
revoke execute on function public.get_or_create_attempt(uuid) from anon;
revoke execute on function public.save_attempt_responses(uuid, jsonb) from anon;
revoke execute on function public.submit_attempt(uuid) from anon;

grant execute on function public.assignment_accepts_answers(public.assignment_status, timestamptz, timestamptz) to authenticated;
grant execute on function public.assignment_has_opened(public.assignment_status, timestamptz) to authenticated;
grant execute on function public.attempt_is_workable(public.assignment_status, timestamptz, timestamptz, public.attempt_state, timestamptz) to authenticated;
grant execute on function public.get_or_create_attempt(uuid) to authenticated;
grant execute on function public.save_attempt_responses(uuid, jsonb) to authenticated;
grant execute on function public.submit_attempt(uuid) to authenticated;
