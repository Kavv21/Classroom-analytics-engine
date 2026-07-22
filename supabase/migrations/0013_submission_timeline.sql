-- 0013_submission_timeline.sql
-- Phase 8: the one aggregate the 0012 views don't cover — submissions per
-- day for the completion-timeline chart (17.14). Computed on read like all
-- Phase 7 analytics (same freshness contract, documented in
-- docs/DATABASE_SCHEMA.md). security_invoker + explicit grants, as always.

create or replace view public.submission_timeline
with (security_invoker = on) as
select
  d.class_id,
  d.assignment_id,
  d.submission_date,
  d.submissions,
  sum(d.submissions) over (
    partition by d.assignment_id
    order by d.submission_date
  )::bigint as cumulative_submissions
from (
  select
    a.class_id,
    att.assignment_id,
    (att.submitted_at at time zone 'utc')::date as submission_date,
    count(*) as submissions
  from public.assignment_attempts att
  join public.assignments a on a.id = att.assignment_id
  where att.submitted_at is not null
  group by a.class_id, att.assignment_id, (att.submitted_at at time zone 'utc')::date
) d;

grant select on public.submission_timeline to authenticated, service_role;
