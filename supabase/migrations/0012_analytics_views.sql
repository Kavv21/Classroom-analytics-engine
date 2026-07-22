-- 0012_analytics_views.sql
-- Phase 7: transition + analytics engine.
--
-- DECISION — transitions are COMPUTED ON READ (plain views), not written by
-- a recompute job at approval time:
--  * responses keep arriving while assignments are OPEN, so any snapshot
--    taken when a mapping is approved goes stale on the next submission;
--  * Phase 6 versioning means approval can flip between versions at any
--    moment, and the phase-7 definition of done requires those flips to
--    reach aggregates with no manual recompute step;
--  * class sizes here (tens of students, hundreds of questions) make
--    on-read aggregation cheap; revisit with materialised views only if
--    Phase 8 profiling demands it.
-- The physical response_transitions table (0001) is NOT read by analytics.
-- It is retained as a durable snapshot target (exports/audit, future use);
-- any rows written there still arm the 0011 mapping_has_dependents boundary.
--
-- Every view:
--  * reads mappings ONLY through approved_question_mappings /
--    approved_question_mapping_members (the 0011 structural filter — an
--    unapproved mapping is invisible here by construction);
--  * is security_invoker = on (the querying user's own RLS applies; views
--    add no privilege — lesson 1: no policy here does raw cross-table
--    subqueries, the underlying tables' policies already hold);
--  * gets an explicit GRANT (lesson 2 — a missing grant is a full outage).
--
-- Formulas are docs/ANALYTICS_DEFINITIONS.md verbatim:
--   change rate        = (S01 + S10) / valid paired
--   stability rate     = (S00 + S11) / valid paired
--   net movement to 1  = S01 - S10
--   pct-point shift    = %1 in A2 - %1 in A1 (over valid pairs)
--                      = (S01 - S11 margin diff) = (s01 - s10) / valid
--   consensus          = max(%0, %1);  disagreement = 1 - consensus
--   binary entropy     = -p*log2(p) - (1-p)*log2(1-p), 0 at p in {0,1}
-- Rates are NULL (not 0) when there is no valid data to rate.

-- ============================================================
-- response_transitions_live — one row per (approved mapping x active
-- student member of the mapping's class).
--
-- T(i,j) in docs/ANALYTICS_DEFINITIONS.md is defined on exactly ONE binary
-- value per side. Only the two one-to-one mapping types carry that shape,
-- so only they can yield S00-S11. Multi-question sides (ONE_TO_MANY,
-- MANY_TO_ONE, GROUPED_CONCEPT) have no documented collapse formula —
-- inventing one (majority? unanimity?) would violate the formulas-verbatim
-- rule, so those pairs are reported as data_quality_status NOT_COMPARABLE
-- (never forced into a transition bucket), same as explicit NOT_COMPARABLE
-- and UNMAPPED mappings. A submitted-blank answer (response_value NULL on
-- a final response) counts as missing.
-- ============================================================

create or replace view public.response_transitions_live
with (security_invoker = on) as
with mapping_sides as (
  select
    m.mapping_id,
    count(*) filter (where m.mapping_side = 1) as a1_count,
    count(*) filter (where m.mapping_side = 2) as a2_count,
    -- No min(uuid) on PG15; array_agg with a fixed order is deterministic
    -- (only read when the side has exactly one question anyway).
    (array_agg(m.question_id order by m.question_id)
       filter (where m.mapping_side = 1))[1] as a1_question_id,
    (array_agg(m.question_id order by m.question_id)
       filter (where m.mapping_side = 2))[1] as a2_question_id
  from public.approved_question_mapping_members m
  group by m.mapping_id
)
select
  qm.class_id,
  qm.id as mapping_id,
  qm.mapping_name,
  qm.version as mapping_version,
  qm.mapping_type,
  qm.energy_source,
  qm.criterion,
  cm.user_id as student_id,
  case when comp.comparable then r1.response_value end as assignment_1_value,
  case when comp.comparable then r2.response_value end as assignment_2_value,
  case
    when comp.comparable
         and r1.response_value is not null
         and r2.response_value is not null
    then ('S' || r1.response_value::text || r2.response_value::text)::transition_state
  end as transition_state,
  case
    when not comp.comparable then 'NOT_COMPARABLE'::data_quality_status
    when r1.response_value is null and r2.response_value is null
      then 'MISSING_BOTH'::data_quality_status
    when r1.response_value is null then 'MISSING_A1'::data_quality_status
    when r2.response_value is null then 'MISSING_A2'::data_quality_status
  end as data_quality_status
from public.approved_question_mappings qm
join mapping_sides ms on ms.mapping_id = qm.id
cross join lateral (
  select qm.mapping_type in ('EXACT_ONE_TO_ONE', 'CONCEPTUAL_ONE_TO_ONE')
         and ms.a1_count = 1 and ms.a2_count = 1 as comparable
) comp
join public.class_members cm
  on cm.class_id = qm.class_id
  and cm.member_role = 'STUDENT'
  and cm.status = 'ACTIVE'
left join public.responses r1
  on r1.question_id = ms.a1_question_id
  and r1.student_id = cm.user_id
  and r1.is_final
left join public.responses r2
  on r2.question_id = ms.a2_question_id
  and r2.student_id = cm.user_id
  and r2.is_final;

grant select on public.response_transitions_live to authenticated, service_role;

-- ============================================================
-- Transition aggregates. One skeleton, five grains: mapping, class,
-- student, energy source, criterion. Counts in the inner query, rates in
-- the outer one so the formulas appear exactly once per view.
-- ============================================================

create or replace view public.mapping_transition_summary
with (security_invoker = on) as
select
  t.*,
  (t.s01 + t.s10) as changed_count,
  (t.s00 + t.s11) as unchanged_count,
  case when t.valid_paired > 0 then (t.s01 + t.s10)::float8 / t.valid_paired end as change_rate,
  case when t.valid_paired > 0 then (t.s00 + t.s11)::float8 / t.valid_paired end as stability_rate,
  (t.s01 - t.s10) as net_movement_toward_1,
  case when t.valid_paired > 0 then (t.s01 - t.s10)::float8 / t.valid_paired end as pct_point_shift
from (
  select
    l.class_id,
    l.mapping_id,
    l.mapping_name,
    l.mapping_version,
    l.mapping_type,
    l.energy_source,
    l.criterion,
    count(*) as pairs_considered,
    count(*) filter (where l.transition_state = 'S00') as s00,
    count(*) filter (where l.transition_state = 'S01') as s01,
    count(*) filter (where l.transition_state = 'S10') as s10,
    count(*) filter (where l.transition_state = 'S11') as s11,
    count(l.transition_state) as valid_paired,
    count(*) filter (where l.data_quality_status = 'MISSING_A1') as missing_a1,
    count(*) filter (where l.data_quality_status = 'MISSING_A2') as missing_a2,
    count(*) filter (where l.data_quality_status = 'MISSING_BOTH') as missing_both,
    count(*) filter (where l.data_quality_status = 'NOT_COMPARABLE') as not_comparable,
    -- One-sided-missing splits by the answered side's value: alluvial
    -- diagrams need "0 -> no answer" as a distinct flow from
    -- "1 -> no answer", and this is the only grain that feeds alluvials.
    count(*) filter (where l.data_quality_status = 'MISSING_A2' and l.assignment_1_value = 0) as missing_a2_from_0,
    count(*) filter (where l.data_quality_status = 'MISSING_A2' and l.assignment_1_value = 1) as missing_a2_from_1,
    count(*) filter (where l.data_quality_status = 'MISSING_A1' and l.assignment_2_value = 0) as missing_a1_to_0,
    count(*) filter (where l.data_quality_status = 'MISSING_A1' and l.assignment_2_value = 1) as missing_a1_to_1
  from public.response_transitions_live l
  group by l.class_id, l.mapping_id, l.mapping_name, l.mapping_version,
           l.mapping_type, l.energy_source, l.criterion
) t;

grant select on public.mapping_transition_summary to authenticated, service_role;

create or replace view public.class_transition_summary
with (security_invoker = on) as
select
  t.*,
  (t.s01 + t.s10) as changed_count,
  (t.s00 + t.s11) as unchanged_count,
  case when t.valid_paired > 0 then (t.s01 + t.s10)::float8 / t.valid_paired end as change_rate,
  case when t.valid_paired > 0 then (t.s00 + t.s11)::float8 / t.valid_paired end as stability_rate,
  (t.s01 - t.s10) as net_movement_toward_1,
  case when t.valid_paired > 0 then (t.s01 - t.s10)::float8 / t.valid_paired end as pct_point_shift
from (
  select
    l.class_id,
    count(distinct l.mapping_id) as mappings_considered,
    count(distinct l.student_id) as students_considered,
    count(*) as pairs_considered,
    count(*) filter (where l.transition_state = 'S00') as s00,
    count(*) filter (where l.transition_state = 'S01') as s01,
    count(*) filter (where l.transition_state = 'S10') as s10,
    count(*) filter (where l.transition_state = 'S11') as s11,
    count(l.transition_state) as valid_paired,
    count(*) filter (where l.data_quality_status = 'MISSING_A1') as missing_a1,
    count(*) filter (where l.data_quality_status = 'MISSING_A2') as missing_a2,
    count(*) filter (where l.data_quality_status = 'MISSING_BOTH') as missing_both,
    count(*) filter (where l.data_quality_status = 'NOT_COMPARABLE') as not_comparable
  from public.response_transitions_live l
  group by l.class_id
) t;

grant select on public.class_transition_summary to authenticated, service_role;

create or replace view public.student_transition_summary
with (security_invoker = on) as
select
  t.*,
  (t.s01 + t.s10) as changed_count,
  (t.s00 + t.s11) as unchanged_count,
  case when t.valid_paired > 0 then (t.s01 + t.s10)::float8 / t.valid_paired end as change_rate,
  case when t.valid_paired > 0 then (t.s00 + t.s11)::float8 / t.valid_paired end as stability_rate,
  (t.s01 - t.s10) as net_movement_toward_1,
  case when t.valid_paired > 0 then (t.s01 - t.s10)::float8 / t.valid_paired end as pct_point_shift
from (
  select
    l.class_id,
    l.student_id,
    count(*) as pairs_considered,
    count(*) filter (where l.transition_state = 'S00') as s00,
    count(*) filter (where l.transition_state = 'S01') as s01,
    count(*) filter (where l.transition_state = 'S10') as s10,
    count(*) filter (where l.transition_state = 'S11') as s11,
    count(l.transition_state) as valid_paired,
    count(*) filter (where l.data_quality_status = 'MISSING_A1') as missing_a1,
    count(*) filter (where l.data_quality_status = 'MISSING_A2') as missing_a2,
    count(*) filter (where l.data_quality_status = 'MISSING_BOTH') as missing_both,
    count(*) filter (where l.data_quality_status = 'NOT_COMPARABLE') as not_comparable
  from public.response_transitions_live l
  group by l.class_id, l.student_id
) t;

grant select on public.student_transition_summary to authenticated, service_role;

create or replace view public.energy_source_transition_summary
with (security_invoker = on) as
select
  t.*,
  (t.s01 + t.s10) as changed_count,
  (t.s00 + t.s11) as unchanged_count,
  case when t.valid_paired > 0 then (t.s01 + t.s10)::float8 / t.valid_paired end as change_rate,
  case when t.valid_paired > 0 then (t.s00 + t.s11)::float8 / t.valid_paired end as stability_rate,
  (t.s01 - t.s10) as net_movement_toward_1,
  case when t.valid_paired > 0 then (t.s01 - t.s10)::float8 / t.valid_paired end as pct_point_shift
from (
  select
    l.class_id,
    l.energy_source,
    count(distinct l.mapping_id) as mappings_considered,
    count(*) as pairs_considered,
    count(*) filter (where l.transition_state = 'S00') as s00,
    count(*) filter (where l.transition_state = 'S01') as s01,
    count(*) filter (where l.transition_state = 'S10') as s10,
    count(*) filter (where l.transition_state = 'S11') as s11,
    count(l.transition_state) as valid_paired,
    count(*) filter (where l.data_quality_status = 'MISSING_A1') as missing_a1,
    count(*) filter (where l.data_quality_status = 'MISSING_A2') as missing_a2,
    count(*) filter (where l.data_quality_status = 'MISSING_BOTH') as missing_both,
    count(*) filter (where l.data_quality_status = 'NOT_COMPARABLE') as not_comparable
  from public.response_transitions_live l
  where l.energy_source is not null
  group by l.class_id, l.energy_source
) t;

grant select on public.energy_source_transition_summary to authenticated, service_role;

create or replace view public.criterion_transition_summary
with (security_invoker = on) as
select
  t.*,
  (t.s01 + t.s10) as changed_count,
  (t.s00 + t.s11) as unchanged_count,
  case when t.valid_paired > 0 then (t.s01 + t.s10)::float8 / t.valid_paired end as change_rate,
  case when t.valid_paired > 0 then (t.s00 + t.s11)::float8 / t.valid_paired end as stability_rate,
  (t.s01 - t.s10) as net_movement_toward_1,
  case when t.valid_paired > 0 then (t.s01 - t.s10)::float8 / t.valid_paired end as pct_point_shift
from (
  select
    l.class_id,
    l.criterion,
    count(distinct l.mapping_id) as mappings_considered,
    count(*) as pairs_considered,
    count(*) filter (where l.transition_state = 'S00') as s00,
    count(*) filter (where l.transition_state = 'S01') as s01,
    count(*) filter (where l.transition_state = 'S10') as s10,
    count(*) filter (where l.transition_state = 'S11') as s11,
    count(l.transition_state) as valid_paired,
    count(*) filter (where l.data_quality_status = 'MISSING_A1') as missing_a1,
    count(*) filter (where l.data_quality_status = 'MISSING_A2') as missing_a2,
    count(*) filter (where l.data_quality_status = 'MISSING_BOTH') as missing_both,
    count(*) filter (where l.data_quality_status = 'NOT_COMPARABLE') as not_comparable
  from public.response_transitions_live l
  where l.criterion is not null
  group by l.class_id, l.criterion
) t;

grant select on public.criterion_transition_summary to authenticated, service_role;

-- ============================================================
-- Response-distribution aggregates (consensus / disagreement / entropy).
-- Question grain, then assignment / energy-source / criterion rollups.
-- Final responses of active student members only; blank (NULL) answers
-- are excluded from the distribution. Consensus/entropy are NULL when a
-- question has no answered responses (no data is not "zero entropy").
-- ============================================================

create or replace view public.question_response_summary
with (security_invoker = on) as
select
  i.*,
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
  end as entropy
from (
  select
    a.class_id,
    q.assignment_id,
    q.id as question_id,
    q.external_question_code,
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
           q.energy_source, q.criterion, q.concept
) i;

grant select on public.question_response_summary to authenticated, service_role;

create or replace view public.assignment_response_summary
with (security_invoker = on) as
with per_question as (
  select * from public.question_response_summary
),
respondents as (
  select
    r.assignment_id,
    count(distinct r.student_id) as respondents
  from public.responses r
  join public.assignments a on a.id = r.assignment_id
  where r.is_final
    and exists (
      select 1 from public.class_members cm
      where cm.class_id = a.class_id
        and cm.user_id = r.student_id
        and cm.member_role = 'STUDENT'
        and cm.status = 'ACTIVE'
    )
  group by r.assignment_id
)
select
  pq.class_id,
  pq.assignment_id,
  count(*) as question_count,
  sum(pq.answered) as answered_responses,
  coalesce(max(re.respondents), 0) as respondents,
  avg(pq.consensus) filter (where pq.answered > 0) as avg_consensus,
  avg(pq.disagreement) filter (where pq.answered > 0) as avg_disagreement,
  avg(pq.entropy) filter (where pq.answered > 0) as avg_entropy
from per_question pq
left join respondents re on re.assignment_id = pq.assignment_id
group by pq.class_id, pq.assignment_id;

grant select on public.assignment_response_summary to authenticated, service_role;

-- Pooled distributions per energy source / criterion within an assignment
-- (all final responses of that group's questions pooled together, plus the
-- question count for context).
create or replace view public.energy_source_response_summary
with (security_invoker = on) as
select
  i.*,
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
  end as entropy
from (
  select
    qs.class_id,
    qs.assignment_id,
    qs.energy_source,
    count(*) as question_count,
    sum(qs.answered) as answered,
    sum(qs.zeros) as zeros,
    sum(qs.ones) as ones
  from public.question_response_summary qs
  where qs.energy_source is not null
  group by qs.class_id, qs.assignment_id, qs.energy_source
) i;

grant select on public.energy_source_response_summary to authenticated, service_role;

create or replace view public.criterion_response_summary
with (security_invoker = on) as
select
  i.*,
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
  end as entropy
from (
  select
    qs.class_id,
    qs.assignment_id,
    qs.criterion,
    count(*) as question_count,
    sum(qs.answered) as answered,
    sum(qs.zeros) as zeros,
    sum(qs.ones) as ones
  from public.question_response_summary qs
  where qs.criterion is not null
  group by qs.class_id, qs.assignment_id, qs.criterion
) i;

grant select on public.criterion_response_summary to authenticated, service_role;

-- ============================================================
-- Section 18 EXPLORATORY views. Descriptive exploration only — the
-- frontend must label everything from these as exploratory; similarity,
-- association, cluster membership, or projection position is never a
-- grade or a correctness judgement. The *_exploratory suffix is the
-- machine-readable marker; lib/analytics wraps rows in explicit
-- { exploratory: true } metadata for Phase 8.
-- ============================================================

-- Pairwise student similarity over one assignment's final, answered
-- responses: contingency counts, Jaccard similarity (M11/(M11+M10+M01)),
-- Hamming distance (disagreements), simple agreement rate. Also the input
-- for hierarchical clustering / MDS projection in lib/analytics — the app
-- consumes this pairwise view, never raw response rows.
create or replace view public.student_pair_similarity_exploratory
with (security_invoker = on) as
with v as (
  select
    a.class_id,
    r.assignment_id,
    r.student_id,
    r.question_id,
    r.response_value
  from public.responses r
  join public.assignments a on a.id = r.assignment_id
  join public.questions q on q.id = r.question_id and q.is_active
  where r.is_final
    and r.response_value is not null
    and exists (
      select 1 from public.class_members cm
      where cm.class_id = a.class_id
        and cm.user_id = r.student_id
        and cm.member_role = 'STUDENT'
        and cm.status = 'ACTIVE'
    )
)
select
  i.*,
  (i.a_only_one + i.b_only_one) as hamming_distance,
  (i.both_one + i.both_zero)::float8 / i.shared_questions as agreement_rate,
  i.both_one::float8 / nullif(i.both_one + i.a_only_one + i.b_only_one, 0) as jaccard_similarity
from (
  select
    v1.class_id,
    v1.assignment_id,
    v1.student_id as student_a,
    v2.student_id as student_b,
    count(*) as shared_questions,
    count(*) filter (where v1.response_value = 1 and v2.response_value = 1) as both_one,
    count(*) filter (where v1.response_value = 0 and v2.response_value = 0) as both_zero,
    count(*) filter (where v1.response_value = 1 and v2.response_value = 0) as a_only_one,
    count(*) filter (where v1.response_value = 0 and v2.response_value = 1) as b_only_one
  from v v1
  join v v2
    on v2.assignment_id = v1.assignment_id
    and v2.question_id = v1.question_id
    and v1.student_id < v2.student_id
  group by v1.class_id, v1.assignment_id, v1.student_id, v2.student_id
) i;

grant select on public.student_pair_similarity_exploratory to authenticated, service_role;

-- Pairwise question association within one assignment, over students who
-- answered both questions: 2x2 contingency, Phi coefficient, mutual
-- information (bits). Network-graph edge data.
create or replace view public.question_pair_association_exploratory
with (security_invoker = on) as
with v as (
  select
    a.class_id,
    r.assignment_id,
    r.student_id,
    r.question_id,
    r.response_value
  from public.responses r
  join public.assignments a on a.id = r.assignment_id
  join public.questions q on q.id = r.question_id and q.is_active
  where r.is_final
    and r.response_value is not null
    and exists (
      select 1 from public.class_members cm
      where cm.class_id = a.class_id
        and cm.user_id = r.student_id
        and cm.member_role = 'STUDENT'
        and cm.status = 'ACTIVE'
    )
)
select
  i.*,
  case when i.m1x > 0 and i.m0x > 0 and i.mx1 > 0 and i.mx0 > 0
       then (i.n11::float8 * i.n00 - i.n10::float8 * i.n01)
            / sqrt(i.m1x::float8 * i.m0x * i.mx1 * i.mx0)
  end as phi_coefficient,
  ( case when i.n00 > 0 then (i.n00::float8 / i.n) * ln(i.n00::float8 * i.n / (i.m0x::float8 * i.mx0)) / ln(2) else 0 end
  + case when i.n01 > 0 then (i.n01::float8 / i.n) * ln(i.n01::float8 * i.n / (i.m0x::float8 * i.mx1)) / ln(2) else 0 end
  + case when i.n10 > 0 then (i.n10::float8 / i.n) * ln(i.n10::float8 * i.n / (i.m1x::float8 * i.mx0)) / ln(2) else 0 end
  + case when i.n11 > 0 then (i.n11::float8 / i.n) * ln(i.n11::float8 * i.n / (i.m1x::float8 * i.mx1)) / ln(2) else 0 end
  ) as mutual_information_bits
from (
  select
    v1.class_id,
    v1.assignment_id,
    v1.question_id as question_a,
    v2.question_id as question_b,
    count(*) as n,
    count(*) filter (where v1.response_value = 0 and v2.response_value = 0) as n00,
    count(*) filter (where v1.response_value = 0 and v2.response_value = 1) as n01,
    count(*) filter (where v1.response_value = 1 and v2.response_value = 0) as n10,
    count(*) filter (where v1.response_value = 1 and v2.response_value = 1) as n11,
    count(*) filter (where v1.response_value = 1) as m1x,
    count(*) filter (where v1.response_value = 0) as m0x,
    count(*) filter (where v2.response_value = 1) as mx1,
    count(*) filter (where v2.response_value = 0) as mx0
  from v v1
  join v v2
    on v2.assignment_id = v1.assignment_id
    and v2.student_id = v1.student_id
    and v1.question_id < v2.question_id
  group by v1.class_id, v1.assignment_id, v1.question_id, v2.question_id
) i;

grant select on public.question_pair_association_exploratory to authenticated, service_role;

-- A1 <-> A2 association per approved mapping, from the transition counts
-- (rows = A1 value, columns = A2 value over valid pairs). Alluvial-diagram
-- source data is mapping_transition_summary itself (s00..s11 + missing
-- buckets); this adds Phi and mutual information on the same 2x2 table.
create or replace view public.mapping_association_exploratory
with (security_invoker = on) as
select
  s.class_id,
  s.mapping_id,
  s.mapping_name,
  s.mapping_version,
  s.valid_paired,
  s.s00, s.s01, s.s10, s.s11,
  case when (s.s00 + s.s01) > 0 and (s.s10 + s.s11) > 0
        and (s.s00 + s.s10) > 0 and (s.s01 + s.s11) > 0
       then (s.s11::float8 * s.s00 - s.s10::float8 * s.s01)
            / sqrt((s.s10 + s.s11)::float8 * (s.s00 + s.s01) * (s.s01 + s.s11) * (s.s00 + s.s10))
  end as phi_coefficient,
  case when s.valid_paired > 0 then
    ( case when s.s00 > 0 then (s.s00::float8 / s.valid_paired) * ln(s.s00::float8 * s.valid_paired / ((s.s00 + s.s01)::float8 * (s.s00 + s.s10))) / ln(2) else 0 end
    + case when s.s01 > 0 then (s.s01::float8 / s.valid_paired) * ln(s.s01::float8 * s.valid_paired / ((s.s00 + s.s01)::float8 * (s.s01 + s.s11))) / ln(2) else 0 end
    + case when s.s10 > 0 then (s.s10::float8 / s.valid_paired) * ln(s.s10::float8 * s.valid_paired / ((s.s10 + s.s11)::float8 * (s.s00 + s.s10))) / ln(2) else 0 end
    + case when s.s11 > 0 then (s.s11::float8 / s.valid_paired) * ln(s.s11::float8 * s.valid_paired / ((s.s10 + s.s11)::float8 * (s.s01 + s.s11))) / ln(2) else 0 end
    )
  end as mutual_information_bits
from public.mapping_transition_summary s;

grant select on public.mapping_association_exploratory to authenticated, service_role;
