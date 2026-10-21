-- ============================================================
-- 0032 — Link-type assignments.
--
-- An assignment is now one of two kinds:
--   GRID — what every assignment has been until now: imported questions,
--          an attempt per student, responses, analytics.
--   LINK — a Google Form (or other https) URL. Students open it in a new
--          tab; answers, identity and timing live in the Form. The app
--          records NO responses and NO per-student status for it.
--
-- Every existing row becomes GRID (the column default), and nothing below
-- changes behaviour for a GRID assignment: each new rule is either a
-- no-op for GRID or re-states the existing GRID rule verbatim.
--
-- WHAT IS REUSED UNCHANGED
--   * Row visibility: assignments_staff_manage (0028) and
--     assignments_student_select (0029) already decide who sees which
--     assignment row, for either kind. No new policy.
--   * Status FSM, schedule (open_at/close_at), assignment_accepts_answers:
--     unchanged, and used as-is to decide when a student may have the link.
--   * Sequence numbering: next_assignment_sequence_number (3+).
--
-- WHAT IS NEW
--   1. kind + link_url columns and their constraints.
--   2. (deliberately nothing) link_url is an ordinary column, readable by
--      anyone who can read the row. assignments_student_select shows a
--      student a scheduled assignment before it opens, so a student who
--      queries the API can see the URL outside the window. That is
--      accepted: the professor distributes the URL to the whole class
--      anyway, and real access control is the Form's own (domain
--      restriction, closing the Form in Google). The app only decides
--      when the link is PRESENTED, and the professor UI says so.
--   3. A LINK assignment can be approved without questions; a GRID one
--      still cannot (the 0029 trigger, otherwise verbatim).
--   4. A LINK assignment can never get questions or an attempt row, and an
--      assignment that has either can't be turned into a LINK.
--   5. A LINK assignment can't take sequence position 1 or 2 — those are
--      the A1/A2 pair energy_source_assignment_change pivots on.
--   6. assignment_submission_progress leaves LINK assignments out, so no
--      "0 of 40 submitted" is ever shown for something that records nothing.
--   7. duplicate_assignment copies kind and link_url.
--
-- Rollback: supabase/rollbacks/rollback_0032_link_assignments.sql
-- (NOT a migration).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columns and shape constraints
-- ------------------------------------------------------------
alter table public.assignments
  add column if not exists kind text not null default 'GRID',
  add column if not exists link_url text;

alter table public.assignments
  drop constraint if exists assignments_kind_valid,
  drop constraint if exists assignments_kind_link_url,
  drop constraint if exists assignments_link_url_https,
  drop constraint if exists assignments_link_not_paired;

alter table public.assignments
  add constraint assignments_kind_valid check (kind in ('GRID', 'LINK'));

-- LINK requires a URL; GRID must not have one.
alter table public.assignments
  add constraint assignments_kind_link_url check (
    (kind = 'LINK' and link_url is not null)
    or (kind = 'GRID' and link_url is null)
  );

-- https only, no whitespace, bounded. Which hosts are "expected"
-- (docs.google.com, forms.gle, drive.google.com) is a warning in the app,
-- not a rule here.
alter table public.assignments
  add constraint assignments_link_url_https check (
    link_url is null
    or (link_url ~ '^https://[^[:space:]/]+[^[:space:]]*$' and length(link_url) <= 2048)
  );

-- Positions 1 and 2 are the before/after pair the A1/A2 comparison is
-- built on (0017/0018). A link records nothing to compare.
alter table public.assignments
  add constraint assignments_link_not_paired check (kind = 'GRID' or sequence_number >= 3);

comment on column public.assignments.kind is
  'GRID: imported questions, attempts, responses, analytics. LINK: an external URL (Google Form) students open in a new tab; the app records no responses and no per-student status.';
comment on column public.assignments.link_url is
  'LINK assignments only (null for GRID). Not a secret: readable with the row. The schedule window decides when the app presents it, not who can reach it.';

-- ------------------------------------------------------------
-- 2. Status FSM — 0029's function verbatim, except that the
--    "approval needs questions" rule now applies to GRID only.
-- ------------------------------------------------------------
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

  -- Approval requires something to approve: questions for a GRID
  -- assignment. A LINK assignment's link is guaranteed by
  -- assignments_kind_link_url.
  if new.status = 'READY' and new.kind = 'GRID' and not exists (
    select 1 from public.questions q
    where q.assignment_id = new.id and q.is_active
  ) then
    raise exception 'assignment % has no active questions — import or add questions before approval', new.id;
  end if;

  return new;
end;
$$;

-- ------------------------------------------------------------
-- 3. A LINK assignment never has questions or attempts.
-- ------------------------------------------------------------
create or replace function public.reject_children_of_link_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.assignments a
    where a.id = new.assignment_id and a.kind = 'LINK'
  ) then
    raise exception 'assignment % is a link assignment — it has no % ', new.assignment_id,
      case tg_table_name when 'questions' then 'questions' else 'attempts' end;
  end if;
  return new;
end;
$$;

drop trigger if exists questions_not_on_link_assignment on public.questions;
create trigger questions_not_on_link_assignment
  before insert or update of assignment_id on public.questions
  for each row execute function public.reject_children_of_link_assignment();

drop trigger if exists attempts_not_on_link_assignment on public.assignment_attempts;
create trigger attempts_not_on_link_assignment
  before insert or update of assignment_id on public.assignment_attempts
  for each row execute function public.reject_children_of_link_assignment();

-- Changing kind: only to LINK from an assignment with nothing that a LINK
-- can't have. LINK -> GRID is always safe (there is nothing to lose); the
-- check constraint makes the caller clear link_url in the same update.
create or replace function public.enforce_assignment_kind_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = old.kind then
    return new;
  end if;

  if new.kind = 'LINK' and (
    exists (select 1 from public.questions q where q.assignment_id = new.id)
    or exists (select 1 from public.assignment_attempts t where t.assignment_id = new.id)
  ) then
    raise exception 'assignment % has questions or attempts, so it can''t become a link assignment — create a new one instead', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists assignments_kind_change on public.assignments;
create trigger assignments_kind_change
  before update of kind on public.assignments
  for each row execute function public.enforce_assignment_kind_change();

revoke execute on function public.reject_children_of_link_assignment() from public, anon, authenticated;
revoke execute on function public.enforce_assignment_kind_change() from public, anon, authenticated;

-- ------------------------------------------------------------
-- 4. assignment_submission_progress — 0009's view plus `kind = 'GRID'`.
--    Same columns, same order, so create or replace is legal.
-- ------------------------------------------------------------
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
where a.kind = 'GRID'
group by a.id, a.class_id;

-- ------------------------------------------------------------
-- 5. duplicate_assignment — 0028's function, now copying kind and
--    link_url.
-- ------------------------------------------------------------
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
    allow_resubmission, response_zero_label, response_one_label, created_by,
    kind, link_url
  )
  select
    a.class_id, a.title || ' (copy)', a.description, a.instructions,
    a.assignment_stage, v_sequence_number, null, null, 'DRAFT',
    a.allow_draft_editing, a.allow_resubmission, a.response_zero_label,
    a.response_one_label, auth.uid(),
    a.kind, a.link_url
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

notify pgrst, 'reload schema';
