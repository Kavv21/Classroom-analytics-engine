-- 0021_question_text_in_analytics_view.sql
-- Carry `question_text` through question_response_summary so analytics can
-- name a question instead of printing its code.
--
-- ============================================================
-- WHY
-- ============================================================
-- `external_question_code` ("A1-017") is a machine key: generated at import
-- time, used as the CSV answer-sheet column header, and carried by every
-- export as the stable identifier. It is not a name a person can read.
--
-- The analytics surfaces (Phase 7/8 charts, the Phase 9 query builder, the
-- Excel "Question Analytics" sheet) all read this view and had nothing else
-- to label a question with, so every question axis, table row and export
-- cell showed a bare code. Adding the wording to the view — rather than
-- joining `questions` in the app — keeps aggregate reads on the view as
-- .claude/rules/analytics.md requires, and means the chart label and the
-- export cell come from one definition.
--
-- ============================================================
-- WHAT THIS DOES NOT CHANGE
-- ============================================================
-- No numbers change. `question_text` joins nothing new: `questions` is
-- already the driving table of the inner aggregate, so this is one more
-- column on an existing GROUP BY of the primary key's own attributes. Row
-- count, grouping and every metric are byte-identical.
--
-- Downstream views are unaffected: assignment_response_summary selects from
-- this view but projects a fixed column list, so an added column cannot leak
-- into its output or its GROUP BY.
--
-- Wording is copied, never composed (CLAUDE.md rule 1) — the view returns
-- questions.question_text verbatim.
--
-- ============================================================
-- WHY THE OUTER SELECT NO LONGER USES `i.*`
-- ============================================================
-- CREATE OR REPLACE VIEW may only APPEND columns; it cannot insert one or
-- reorder them (42P16: "cannot change name of view column"). The previous
-- definition expanded `i.*`, so adding question_text to the inner aggregate
-- pushed every later column along by one and Postgres rejected the replace.
--
-- Dropping the view was the alternative and is worse: assignment_response_
-- summary reads it, so the drop needs CASCADE and a rebuild of dependents
-- that this migration has no reason to touch.
--
-- So the inner columns are now listed explicitly, in their original order,
-- with question_text appended LAST — position 1..15 are byte-identical to
-- migration 0012's output and question_text is new column 16.

create or replace view public.question_response_summary
with (security_invoker = on) as
select
  i.class_id,
  i.assignment_id,
  i.question_id,
  i.external_question_code,
  i.energy_source,
  i.criterion,
  i.concept,
  i.answered,
  i.zeros,
  i.ones,
  case when i.answered > 0 then i.zeros::float8 / i.answered end as pct_zero,
  case when i.answered > 0 then i.ones::float8 / i.answered end as pct_one,
  case when i.answered > 0
       then greatest(i.zeros::float8 / i.answered, i.ones::float8 / i.answered)
  end as consensus,
  case when i.answered > 0
       then 1 - greatest(i.zeros::float8 / i.answered, i.ones::float8 / i.answered)
  end as disagreement,
  case
    when i.answered = 0 then null
    when i.zeros = 0 or i.ones = 0 then 0::float8
    else -(
      (i.ones::float8 / i.answered) * ln(i.ones::float8 / i.answered)
      + (i.zeros::float8 / i.answered) * ln(i.zeros::float8 / i.answered)
    ) / ln(2)
  end as entropy,
  -- Appended last: see the note above on CREATE OR REPLACE VIEW.
  i.question_text
from (
  select
    a.class_id,
    q.assignment_id,
    q.id as question_id,
    q.external_question_code,
    q.question_text,
    q.energy_source,
    q.criterion,
    q.concept,
    count(r.id) filter (where r.response_value is not null) as answered,
    count(r.id) filter (where r.response_value = 0) as zeros,
    count(r.id) filter (where r.response_value = 1) as ones
  from public.questions q
  join public.assignments a on a.id = q.assignment_id
  left join public.responses r
    on r.question_id = q.id
    and r.is_final
    and exists (
      select 1 from public.class_members cm
      where cm.class_id = a.class_id
        and cm.user_id = r.student_id
        and cm.member_role = 'STUDENT'
        and cm.status = 'ACTIVE'
    )
  where q.is_active
  group by a.class_id, q.assignment_id, q.id, q.external_question_code,
           q.question_text, q.energy_source, q.criterion, q.concept
) i;

grant select on public.question_response_summary to authenticated, service_role;
