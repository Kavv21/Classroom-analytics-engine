-- 0011_question_mappings.sql
-- Phase 6: mapping studio — versioning, approval boundary, preview, and the
-- approved-only read surface for everything downstream.
--
-- Follows the standing rules from 0004/0007/0008/0009:
--  * every SECURITY DEFINER function sets search_path = public and
--    schema-qualifies every table reference;
--  * no raw correlated subqueries into classes/class_members from policies
--    or policy-adjacent checks — cross-table ownership goes through the
--    0008 helpers (is_professor_of_class);
--  * new relations get explicit GRANTs even though 0007's
--    ALTER DEFAULT PRIVILEGES should cover them — a missing grant is a
--    full outage, so belt and braces;
--  * EXECUTE revoked from anon on every new function.

-- ============================================================
-- Versioning columns. A mapping's version chain is a linked list:
-- previous_version_id points back, superseded_by_id points forward
-- (set the moment a newer version is created, which also freezes the old
-- tip against re-approval and against forking a second new version).
-- ============================================================

alter table public.question_mappings
  add column if not exists version int not null default 1,
  add column if not exists previous_version_id uuid
    references public.question_mappings(id) on delete set null,
  add column if not exists superseded_by_id uuid
    references public.question_mappings(id) on delete set null,
  add column if not exists created_by uuid references public.profiles(id);

-- mapping_status was a free-text default 'DRAFT' in 0001 — pin the value
-- set now that the workflow exists.
alter table public.question_mappings
  add constraint question_mappings_status_check check (
    mapping_status in (
      'DRAFT', 'SUGGESTED', 'NEEDS_PROFESSOR_REVIEW',
      'APPROVED', 'REJECTED', 'SUPERSEDED'
    )
  );

-- professor_approved and mapping_status must never disagree: the approved
-- flag is the hard analytics gate, the status is the workflow label.
alter table public.question_mappings
  add constraint question_mappings_approved_status_coherent check (
    professor_approved = false or mapping_status = 'APPROVED'
  );

-- One membership row per question per mapping.
create unique index if not exists uq_mapping_members_mapping_question
  on public.question_mapping_members(mapping_id, question_id);

create index if not exists idx_mappings_class_approved
  on public.question_mappings(class_id) where professor_approved;

-- ============================================================
-- Helper: does anything downstream depend on this mapping yet?
-- response_transitions (Phase 7) is the downstream artifact table.
-- SECURITY DEFINER for the same reason as assignment_has_responses (0009):
-- the boundary must hold regardless of what the acting role may read.
-- ============================================================

create or replace function public.mapping_has_dependents(p_mapping_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.response_transitions where mapping_id = p_mapping_id
  );
$$;

revoke execute on function public.mapping_has_dependents(uuid) from anon;

-- ============================================================
-- Boundary: no destructive edits to a load-bearing mapping.
-- "Load-bearing" = professor_approved (live analytics reads it through the
-- approved views) OR response_transitions rows reference it. Same category
-- as the questions_immutable_after_responses trigger (0009): fires for
-- every role — service_role bypasses RLS but NOT triggers.
--
-- Still allowed on a load-bearing row: professor_notes, mapping_status,
-- professor_approved, superseded_by_id, updated_at — the approval/
-- supersession lifecycle is exactly these fields. Content (question sets,
-- type, name, concept, source, criterion, comparison method, version
-- lineage) is frozen; create a new version instead.
-- ============================================================

create or replace function public.enforce_mapping_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.professor_approved or public.mapping_has_dependents(old.id) then
      raise exception
        'cannot delete mapping %: it is approved or analytics already depends on it — create a new version instead',
        old.id;
    end if;
    return old;
  end if;

  -- UPDATE
  if old.professor_approved or public.mapping_has_dependents(old.id) then
    if new.class_id is distinct from old.class_id
      or new.assignment_1_question_ids is distinct from old.assignment_1_question_ids
      or new.assignment_2_question_ids is distinct from old.assignment_2_question_ids
      or new.mapping_name is distinct from old.mapping_name
      or new.common_concept is distinct from old.common_concept
      or new.energy_source is distinct from old.energy_source
      or new.criterion is distinct from old.criterion
      or new.mapping_type is distinct from old.mapping_type
      or new.comparison_method is distinct from old.comparison_method
      or new.version is distinct from old.version
      or new.previous_version_id is distinct from old.previous_version_id
      or new.created_by is distinct from old.created_by
    then
      raise exception
        'cannot edit mapping %: it is approved or analytics already depends on it — create a new version instead',
        old.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists question_mappings_immutable_when_load_bearing on public.question_mappings;
create trigger question_mappings_immutable_when_load_bearing
  before update or delete on public.question_mappings
  for each row execute function public.enforce_mapping_immutability();

-- Member rows are part of the mapping's content: frozen under the same
-- condition. (create_mapping_version copies members onto the NEW mapping
-- row, which is never load-bearing at that point, so versioning is safe.)
create or replace function public.enforce_mapping_member_immutability()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mapping_id uuid := coalesce(new.mapping_id, old.mapping_id);
  v_locked boolean;
begin
  select qm.professor_approved or public.mapping_has_dependents(qm.id)
    into v_locked
  from public.question_mappings qm
  where qm.id = v_mapping_id;

  if coalesce(v_locked, false) then
    raise exception
      'cannot change members of mapping %: it is approved or analytics already depends on it — create a new version instead',
      v_mapping_id;
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists mapping_members_immutable_when_load_bearing on public.question_mapping_members;
create trigger mapping_members_immutable_when_load_bearing
  before insert or update or delete on public.question_mapping_members
  for each row execute function public.enforce_mapping_member_immutability();

-- ============================================================
-- Shared validation for create/update: resolves question ids to sides
-- (side 1 = the class's sequence_number 1 assignment, side 2 = sequence 2),
-- rejects questions from other classes/assignments, and enforces the
-- side-count shape of each mapping type. SECURITY INVOKER throughout —
-- RLS governs what the caller can see; the explicit ownership check exists
-- for a clear error message (0009 precedent).
-- ============================================================

create or replace function public.validate_mapping_questions(
  p_class_id uuid,
  p_a1_question_ids uuid[],
  p_a2_question_ids uuid[],
  p_mapping_type mapping_type
) returns void
language plpgsql
security invoker
stable
as $$
declare
  v_a1_count int := coalesce(array_length(p_a1_question_ids, 1), 0);
  v_a2_count int := coalesce(array_length(p_a2_question_ids, 1), 0);
  v_valid int;
begin
  -- Every side-1 id must be an active question on THIS class's sequence-1
  -- assignment (and likewise for side 2).
  select count(*) into v_valid
  from questions q
  join assignments a on a.id = q.assignment_id
  where q.id = any(p_a1_question_ids)
    and a.class_id = p_class_id and a.sequence_number = 1;
  if v_valid <> v_a1_count then
    raise exception 'one or more Assignment 1 question ids do not belong to this class''s sequence-1 assignment';
  end if;

  select count(*) into v_valid
  from questions q
  join assignments a on a.id = q.assignment_id
  where q.id = any(p_a2_question_ids)
    and a.class_id = p_class_id and a.sequence_number = 2;
  if v_valid <> v_a2_count then
    raise exception 'one or more Assignment 2 question ids do not belong to this class''s sequence-2 assignment';
  end if;

  if v_a1_count + v_a2_count = 0 then
    raise exception 'a mapping must reference at least one question';
  end if;

  if p_mapping_type in ('EXACT_ONE_TO_ONE', 'CONCEPTUAL_ONE_TO_ONE')
     and (v_a1_count <> 1 or v_a2_count <> 1) then
    raise exception '% requires exactly one question on each side (got % and %)',
      p_mapping_type, v_a1_count, v_a2_count;
  end if;
  if p_mapping_type = 'ONE_TO_MANY' and (v_a1_count <> 1 or v_a2_count < 2) then
    raise exception 'ONE_TO_MANY requires exactly one Assignment 1 question and two or more Assignment 2 questions (got % and %)',
      v_a1_count, v_a2_count;
  end if;
  if p_mapping_type = 'MANY_TO_ONE' and (v_a1_count < 2 or v_a2_count <> 1) then
    raise exception 'MANY_TO_ONE requires two or more Assignment 1 questions and exactly one Assignment 2 question (got % and %)',
      v_a1_count, v_a2_count;
  end if;
  if p_mapping_type = 'GROUPED_CONCEPT' and (v_a1_count < 1 or v_a2_count < 1) then
    raise exception 'GROUPED_CONCEPT requires at least one question on each side (got % and %)',
      v_a1_count, v_a2_count;
  end if;
  -- NOT_COMPARABLE / UNMAPPED may be one-sided by design (a source that
  -- exists in only one assignment).
end;
$$;

-- ============================================================
-- Create a mapping (never approved at creation — suggestions and manual
-- drafts alike go through the explicit approval step).
-- ============================================================

create or replace function public.create_question_mapping(
  p_class_id uuid,
  p_a1_question_ids uuid[],
  p_a2_question_ids uuid[],
  p_mapping_name text,
  p_mapping_type mapping_type,
  p_common_concept text default null,
  p_energy_source text default null,
  p_criterion text default null,
  p_comparison_method text default null,
  p_professor_notes text default null,
  p_mapping_status text default 'DRAFT'
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_mapping_id uuid;
begin
  if not is_professor_of_class(p_class_id) then
    raise exception 'class not found, or you are not its professor';
  end if;

  if coalesce(trim(p_mapping_name), '') = '' then
    raise exception 'mapping name is required';
  end if;

  if p_mapping_status not in ('DRAFT', 'SUGGESTED', 'NEEDS_PROFESSOR_REVIEW') then
    raise exception 'a new mapping must start as DRAFT, SUGGESTED, or NEEDS_PROFESSOR_REVIEW (got %)', p_mapping_status;
  end if;

  perform validate_mapping_questions(
    p_class_id, p_a1_question_ids, p_a2_question_ids, p_mapping_type
  );

  insert into question_mappings (
    class_id, assignment_1_question_ids, assignment_2_question_ids,
    mapping_name, common_concept, energy_source, criterion, mapping_type,
    comparison_method, professor_notes, mapping_status, professor_approved,
    created_by
  ) values (
    p_class_id, coalesce(p_a1_question_ids, '{}'), coalesce(p_a2_question_ids, '{}'),
    trim(p_mapping_name), p_common_concept, p_energy_source, p_criterion,
    p_mapping_type, p_comparison_method, p_professor_notes, p_mapping_status,
    false, auth.uid()
  ) returning id into v_mapping_id;

  insert into question_mapping_members (mapping_id, assignment_id, question_id, mapping_side)
  select v_mapping_id, q.assignment_id, q.id, case a.sequence_number when 1 then 1 else 2 end
  from questions q
  join assignments a on a.id = q.assignment_id
  where q.id = any(coalesce(p_a1_question_ids, '{}') || coalesce(p_a2_question_ids, '{}'));

  perform log_audit_event(
    'MAPPING_CREATED', 'question_mapping', v_mapping_id,
    jsonb_build_object('classId', p_class_id, 'mappingType', p_mapping_type,
                       'status', p_mapping_status, 'name', trim(p_mapping_name))
  );

  return v_mapping_id;
end;
$$;

-- ============================================================
-- Edit a mapping that is NOT load-bearing. The trigger is the boundary;
-- the explicit checks here produce actionable errors.
-- ============================================================

create or replace function public.update_question_mapping(
  p_mapping_id uuid,
  p_a1_question_ids uuid[],
  p_a2_question_ids uuid[],
  p_mapping_name text,
  p_mapping_type mapping_type,
  p_common_concept text default null,
  p_energy_source text default null,
  p_criterion text default null,
  p_comparison_method text default null,
  p_professor_notes text default null
) returns uuid
language plpgsql
security invoker
as $$
declare
  v_class_id uuid;
  v_approved boolean;
  v_status text;
begin
  select qm.class_id, qm.professor_approved, qm.mapping_status
    into v_class_id, v_approved, v_status
  from question_mappings qm
  where qm.id = p_mapping_id and is_professor_of_class(qm.class_id);

  if v_class_id is null then
    raise exception 'mapping not found, or you are not the professor of its class';
  end if;
  if v_approved or mapping_has_dependents(p_mapping_id) then
    raise exception 'this mapping is approved or already used by analytics — create a new version instead of editing it';
  end if;
  if v_status = 'SUPERSEDED' then
    raise exception 'this mapping has been superseded by a newer version — edit the newest version instead';
  end if;

  if coalesce(trim(p_mapping_name), '') = '' then
    raise exception 'mapping name is required';
  end if;

  perform validate_mapping_questions(
    v_class_id, p_a1_question_ids, p_a2_question_ids, p_mapping_type
  );

  update question_mappings set
    assignment_1_question_ids = coalesce(p_a1_question_ids, '{}'),
    assignment_2_question_ids = coalesce(p_a2_question_ids, '{}'),
    mapping_name = trim(p_mapping_name),
    common_concept = p_common_concept,
    energy_source = p_energy_source,
    criterion = p_criterion,
    mapping_type = p_mapping_type,
    comparison_method = p_comparison_method,
    professor_notes = p_professor_notes,
    mapping_status = case when mapping_status = 'REJECTED' then 'DRAFT' else mapping_status end,
    updated_at = now()
  where id = p_mapping_id;

  delete from question_mapping_members where mapping_id = p_mapping_id;
  insert into question_mapping_members (mapping_id, assignment_id, question_id, mapping_side)
  select p_mapping_id, q.assignment_id, q.id, case a.sequence_number when 1 then 1 else 2 end
  from questions q
  join assignments a on a.id = q.assignment_id
  where q.id = any(coalesce(p_a1_question_ids, '{}') || coalesce(p_a2_question_ids, '{}'));

  perform log_audit_event(
    'MAPPING_UPDATED', 'question_mapping', p_mapping_id,
    jsonb_build_object('classId', v_class_id, 'mappingType', p_mapping_type)
  );

  return p_mapping_id;
end;
$$;

-- ============================================================
-- Approve / reject. Approving the tip of a version chain automatically
-- retires every earlier version (professor_approved = false + SUPERSEDED)
-- so at most one version of a chain is ever live in analytics.
-- ============================================================

create or replace function public.set_mapping_approval(
  p_mapping_id uuid,
  p_approve boolean
) returns void
language plpgsql
security invoker
as $$
declare
  v_class_id uuid;
  v_status text;
  v_superseded_by uuid;
  v_prev uuid;
begin
  select qm.class_id, qm.mapping_status, qm.superseded_by_id, qm.previous_version_id
    into v_class_id, v_status, v_superseded_by, v_prev
  from question_mappings qm
  where qm.id = p_mapping_id and is_professor_of_class(qm.class_id);

  if v_class_id is null then
    raise exception 'mapping not found, or you are not the professor of its class';
  end if;

  if p_approve then
    if v_superseded_by is not null or v_status = 'SUPERSEDED' then
      raise exception 'this mapping has been superseded by a newer version — approve the newest version instead';
    end if;

    update question_mappings
      set professor_approved = true, mapping_status = 'APPROVED', updated_at = now()
      where id = p_mapping_id;

    -- Retire every earlier version in the chain.
    while v_prev is not null loop
      update question_mappings
        set professor_approved = false, mapping_status = 'SUPERSEDED', updated_at = now()
        where id = v_prev
        returning previous_version_id into v_prev;
    end loop;

    perform log_audit_event('MAPPING_APPROVED', 'question_mapping', p_mapping_id,
      jsonb_build_object('classId', v_class_id));
  else
    update question_mappings
      set professor_approved = false, mapping_status = 'REJECTED', updated_at = now()
      where id = p_mapping_id;

    perform log_audit_event('MAPPING_REJECTED', 'question_mapping', p_mapping_id,
      jsonb_build_object('classId', v_class_id));
  end if;
end;
$$;

-- ============================================================
-- Version a mapping: copy content + members into a fresh DRAFT
-- (version + 1), link the chain, and freeze the old tip against forking.
-- The old version stays approved/live until the new one is approved.
-- ============================================================

create or replace function public.create_mapping_version(p_mapping_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_class_id uuid;
  v_superseded_by uuid;
  v_new_id uuid;
begin
  select qm.class_id, qm.superseded_by_id into v_class_id, v_superseded_by
  from question_mappings qm
  where qm.id = p_mapping_id and is_professor_of_class(qm.class_id);

  if v_class_id is null then
    raise exception 'mapping not found, or you are not the professor of its class';
  end if;
  if v_superseded_by is not null then
    raise exception 'this mapping already has a newer version — edit or version that one instead';
  end if;

  insert into question_mappings (
    class_id, assignment_1_question_ids, assignment_2_question_ids,
    mapping_name, common_concept, energy_source, criterion, mapping_type,
    comparison_method, professor_notes, mapping_status, professor_approved,
    version, previous_version_id, created_by
  )
  select
    qm.class_id, qm.assignment_1_question_ids, qm.assignment_2_question_ids,
    qm.mapping_name, qm.common_concept, qm.energy_source, qm.criterion,
    qm.mapping_type, qm.comparison_method, qm.professor_notes, 'DRAFT', false,
    qm.version + 1, qm.id, auth.uid()
  from question_mappings qm
  where qm.id = p_mapping_id
  returning id into v_new_id;

  insert into question_mapping_members (mapping_id, assignment_id, question_id, mapping_side)
  select v_new_id, m.assignment_id, m.question_id, m.mapping_side
  from question_mapping_members m
  where m.mapping_id = p_mapping_id;

  -- superseded_by_id is one of the lifecycle fields the immutability
  -- trigger deliberately allows on a load-bearing row.
  update question_mappings
    set superseded_by_id = v_new_id, updated_at = now()
    where id = p_mapping_id;

  perform log_audit_event('MAPPING_VERSIONED', 'question_mapping', v_new_id,
    jsonb_build_object('classId', v_class_id, 'previousVersionId', p_mapping_id));

  return v_new_id;
end;
$$;

-- ============================================================
-- Analytics preview: what WOULD this mapping show, before approval.
-- Aggregated in the database (analytics rule — no response tables pulled
-- into app memory). SECURITY INVOKER: the professor's own RLS grants read
-- of their class's responses; students can't reach any of this.
--
-- Counts pair combinations per (A1 question × A2 question) over final
-- (submitted) responses of active student members. Neutral pair counts —
-- the S00-S11 transition vocabulary belongs to approved-mapping analytics
-- (Phase 7), so the preview reports "pair_00" etc., never a fabricated
-- transition state.
-- ============================================================

create or replace function public.preview_mapping_pairs(p_mapping_id uuid)
returns jsonb
language plpgsql
security invoker
stable
as $$
declare
  v_class_id uuid;
  v_enrolled int;
  v_pairs jsonb;
  v_side_counts jsonb;
begin
  select qm.class_id into v_class_id
  from question_mappings qm
  where qm.id = p_mapping_id and is_professor_of_class(qm.class_id);

  if v_class_id is null then
    raise exception 'mapping not found, or you are not the professor of its class';
  end if;

  select count(*) into v_enrolled
  from class_members cm
  where cm.class_id = v_class_id
    and cm.member_role = 'STUDENT' and cm.status = 'ACTIVE';

  -- Per-question respondent counts (both sides).
  select coalesce(jsonb_agg(jsonb_build_object(
      'questionId', t.question_id,
      'side', t.mapping_side,
      'answered', t.answered,
      'zeros', t.zeros,
      'ones', t.ones
    ) order by t.mapping_side, t.question_id), '[]'::jsonb)
    into v_side_counts
  from (
    select m.question_id, m.mapping_side,
      count(r.id) filter (where r.response_value is not null) as answered,
      count(r.id) filter (where r.response_value = 0) as zeros,
      count(r.id) filter (where r.response_value = 1) as ones
    from question_mapping_members m
    left join responses r
      on r.question_id = m.question_id and r.is_final
      and exists (
        select 1 from class_members cm
        where cm.class_id = v_class_id and cm.user_id = r.student_id
          and cm.member_role = 'STUDENT' and cm.status = 'ACTIVE'
      )
    where m.mapping_id = p_mapping_id
    group by m.question_id, m.mapping_side
  ) t;

  -- Pairwise combination counts across the two sides.
  select coalesce(jsonb_agg(jsonb_build_object(
      'a1QuestionId', p.a1_question_id,
      'a2QuestionId', p.a2_question_id,
      'paired', p.paired,
      'pair00', p.pair00,
      'pair01', p.pair01,
      'pair10', p.pair10,
      'pair11', p.pair11,
      'missingA1', p.missing_a1,
      'missingA2', p.missing_a2,
      'missingBoth', p.missing_both
    ) order by p.a1_question_id, p.a2_question_id), '[]'::jsonb)
    into v_pairs
  from (
    select
      q1.question_id as a1_question_id,
      q2.question_id as a2_question_id,
      count(*) filter (where r1.response_value is not null and r2.response_value is not null) as paired,
      count(*) filter (where r1.response_value = 0 and r2.response_value = 0) as pair00,
      count(*) filter (where r1.response_value = 0 and r2.response_value = 1) as pair01,
      count(*) filter (where r1.response_value = 1 and r2.response_value = 0) as pair10,
      count(*) filter (where r1.response_value = 1 and r2.response_value = 1) as pair11,
      count(*) filter (where r1.response_value is null and r2.response_value is not null) as missing_a1,
      count(*) filter (where r1.response_value is not null and r2.response_value is null) as missing_a2,
      count(*) filter (where r1.response_value is null and r2.response_value is null) as missing_both
    from (select question_id from question_mapping_members
          where mapping_id = p_mapping_id and mapping_side = 1) q1
    cross join (select question_id from question_mapping_members
                where mapping_id = p_mapping_id and mapping_side = 2) q2
    cross join (select cm.user_id from class_members cm
                where cm.class_id = v_class_id
                  and cm.member_role = 'STUDENT' and cm.status = 'ACTIVE') s
    left join responses r1
      on r1.question_id = q1.question_id and r1.student_id = s.user_id and r1.is_final
    left join responses r2
      on r2.question_id = q2.question_id and r2.student_id = s.user_id and r2.is_final
    group by q1.question_id, q2.question_id
  ) p;

  return jsonb_build_object(
    'mappingId', p_mapping_id,
    'enrolledStudents', v_enrolled,
    'questionCounts', v_side_counts,
    'pairCounts', v_pairs
  );
end;
$$;

revoke execute on function public.validate_mapping_questions(uuid, uuid[], uuid[], mapping_type) from anon;
revoke execute on function public.create_question_mapping(uuid, uuid[], uuid[], text, mapping_type, text, text, text, text, text, text) from anon;
revoke execute on function public.update_question_mapping(uuid, uuid[], uuid[], text, mapping_type, text, text, text, text, text) from anon;
revoke execute on function public.set_mapping_approval(uuid, boolean) from anon;
revoke execute on function public.create_mapping_version(uuid) from anon;
revoke execute on function public.preview_mapping_pairs(uuid) from anon;

-- ============================================================
-- The approved-only read surface. Downstream features (transition engine,
-- analytics, dashboards) read mappings ONLY through these views — the
-- professor_approved = true filter is baked into the relation itself, so
-- an unapproved mapping is structurally invisible no matter who queries
-- (the filter applies even to service_role, which bypasses RLS).
-- security_invoker = on: the querying user's own RLS still applies on top
-- for authenticated roles — the views add no privilege.
-- ============================================================

create or replace view public.approved_question_mappings
with (security_invoker = on) as
select
  qm.id, qm.class_id, qm.assignment_1_question_ids,
  qm.assignment_2_question_ids, qm.mapping_name, qm.common_concept,
  qm.energy_source, qm.criterion, qm.mapping_type, qm.comparison_method,
  qm.mapping_status, qm.professor_approved, qm.version,
  qm.previous_version_id, qm.created_at, qm.updated_at
from public.question_mappings qm
where qm.professor_approved = true and qm.mapping_status = 'APPROVED';

create or replace view public.approved_question_mapping_members
with (security_invoker = on) as
select m.id, m.mapping_id, m.assignment_id, m.question_id, m.mapping_side, m.weight
from public.question_mapping_members m
join public.question_mappings qm on qm.id = m.mapping_id
where qm.professor_approved = true and qm.mapping_status = 'APPROVED';

-- 0007's ALTER DEFAULT PRIVILEGES should cover these, but explicit grants
-- cost nothing and a missing grant is a hard outage (lesson from 0007).
grant select on public.approved_question_mappings to authenticated, service_role;
grant select on public.approved_question_mapping_members to authenticated, service_role;
