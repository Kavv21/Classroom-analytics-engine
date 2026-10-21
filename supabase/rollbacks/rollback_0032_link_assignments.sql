-- ============================================================
-- ROLLBACK OF 0032 — NOT A MIGRATION. Do not move into supabase/migrations.
--
-- Undoes migration 0032 (link-type assignments). Run it with ONE of:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/rollbacks/rollback_0032_link_assignments.sql
--   (or paste this file into the Supabase dashboard SQL editor and Run)
--
-- REFUSES TO RUN while any LINK assignment exists: dropping the columns
-- would silently turn those into broken GRID assignments with no
-- questions. Archive-and-delete them (or decide what they should become)
-- first.
--
-- Function bodies below are verbatim from 0029 (status FSM), 0009 (the
-- progress view) and 0028 (duplicate_assignment).
--
-- Afterwards, record the change in a real migration so the migration
-- history matches the live database again (CLAUDE.md rule 7).
-- ============================================================

begin;

do $$
declare
  v_links int;
begin
  select count(*) into v_links from public.assignments where kind = 'LINK';
  if v_links > 0 then
    raise exception 'rollback_0032: % LINK assignment(s) still exist — remove them first', v_links;
  end if;
end;
$$;

drop trigger if exists questions_not_on_link_assignment on public.questions;
drop trigger if exists attempts_not_on_link_assignment on public.assignment_attempts;
drop trigger if exists assignments_kind_change on public.assignments;
drop function if exists public.reject_children_of_link_assignment();
drop function if exists public.enforce_assignment_kind_change();

-- Status FSM — verbatim from 0029.
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

-- Progress view — verbatim from 0009. The 0032 version reads `kind`, so it
-- must be replaced before that column is dropped below; dropped and
-- recreated here, so its grant is restored too.
drop view if exists public.assignment_submission_progress;
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

grant select on public.assignment_submission_progress to authenticated, service_role;

-- duplicate_assignment — verbatim from 0028.
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

alter table public.assignments
  drop constraint if exists assignments_kind_valid,
  drop constraint if exists assignments_kind_link_url,
  drop constraint if exists assignments_link_url_https,
  drop constraint if exists assignments_link_not_paired;

alter table public.assignments
  drop column if exists link_url,
  drop column if exists kind;

notify pgrst, 'reload schema';

commit;
