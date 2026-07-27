-- 0019_repair_question_code_prefix.sql
--
-- ⚠ PROPOSED REPAIR — READ BEFORE APPLYING. This is the only migration in
-- this project that rewrites existing question rows. It is written, tested
-- against a local reproduction, and deliberately NOT applied to any remote
-- database.
--
-- ============================================================
-- WHAT IS WRONG
-- ============================================================
-- `external_question_code` is generated at import time as
-- `A${sequence_number}-NNN` (lib/assignments/actions.ts -> parseUpload,
-- lib/imports/parse-grid.ts). It is a snapshot of a MUTABLE field and is
-- never re-derived afterwards.
--
-- The real class imported its second assignment while that assignment still
-- carried sequence_number = 1 — the collision migration 0018 now prevents.
-- All 255 of its questions were therefore stored as `A1-001…A1-255`. When
-- the sequence numbers were later repaired, the codes stayed behind.
--
-- The result: both assignments in the class carry `A1-001…A1-030`. The
-- unique constraint is (assignment_id, external_question_code), so this is
-- perfectly legal — and that is the danger. The code no longer identifies a
-- question within a class; only (assignment_id, code) does. Any lookup that
-- resolves a code without scoping to an assignment can match the wrong
-- assignment's question and never notice.
--
-- ============================================================
-- IS RENAMING SAFE? YES — VERIFIED, NOT ASSUMED
-- ============================================================
-- Every foreign key into questions is on questions(id):
--     responses(question_id)
--     question_mapping_members(question_id)
--     question_options(question_id)
-- `external_question_code` appears in exactly two places in the whole
-- schema: the questions table itself, and question_response_summary, a view
-- that re-reads it for display. Nothing stores it as a reference.
--
-- So no response, attempt, mapping or transition is attached to a code, and
-- renaming one cannot orphan or re-point a single student answer.
--
-- ============================================================
-- WHAT DOES CHANGE, AND WHO SEES IT
-- ============================================================
-- The code is user-visible. After this runs:
--   * the taking UI, review page and receipt show A2-… where they showed A1-…;
--   * exports, the mapping studio and analytics tables show the new codes;
--   * ANSWER-SHEET CSVs DOWNLOADED BEFORE THIS RUNS WILL NO LONGER UPLOAD.
--     The CSV template's headers are question codes, and
--     lib/attempts/commit-csv-submission.ts matches on them. A student
--     holding an old sheet gets "not a question in this assignment" for
--     every column. It fails loudly and writes nothing, which is the right
--     failure — but tell students to re-download if any are mid-flight.
--
-- Because of that last point, apply this when no one is part-way through an
-- upload — not during a submission window.
--
-- ============================================================
-- THE IMMUTABILITY TRIGGER
-- ============================================================
-- `questions_immutable_after_responses` (migration 0009) blocks UPDATE of
-- anything but display_order once an assignment has responses, for EVERY
-- role including service_role. It will reject this repair — confirmed
-- locally:
--     ERROR: cannot edit question …: its assignment already has responses
--            (only reordering is allowed) — version the assignment instead
--
-- That trigger is doing its job: it exists to stop question WORDING being
-- edited under responses that were given to the old wording (CLAUDE.md rule
-- 6). This repair changes no wording, no classification, no labels and no
-- ordering — only an identifier that references nothing. So the trigger is
-- disabled for the length of this one transaction and re-enabled inside it.
-- If this transaction fails or is rolled back, the trigger returns with it.
--
-- ============================================================
-- SCOPE
-- ============================================================
-- Only rows whose prefix disagrees with their assignment's CURRENT
-- sequence_number, and only where the corrected code is free within that
-- same assignment. Anything else is left alone and reported.

do $$
declare
  v_fixed int := 0;
  v_blocked text;
  v_report text;
begin
  -- ---- what is about to change -------------------------------------
  select string_agg(
           format('  assignment %s (seq %s): %s rows, %s -> A%s', a.title,
                  a.sequence_number, cnt, old_prefix, a.sequence_number),
           E'\n')
    into v_report
  from (
    select q.assignment_id,
           split_part(q.external_question_code, '-', 1) as old_prefix,
           count(*) as cnt
    from public.questions q
    join public.assignments a on a.id = q.assignment_id
    where split_part(q.external_question_code, '-', 1) <> 'A' || a.sequence_number::text
    group by q.assignment_id, split_part(q.external_question_code, '-', 1)
  ) d
  join public.assignments a on a.id = d.assignment_id;

  if v_report is null then
    raise notice 'Nothing to repair — every question code already matches its assignment''s sequence number.';
    return;
  end if;
  raise notice E'Repairing question code prefixes:\n%', v_report;

  -- ---- refuse to create a collision inside an assignment ------------
  select string_agg(format('  %s in assignment %s', target_code, assignment_id), E'\n')
    into v_blocked
  from (
    select q.assignment_id,
           'A' || a.sequence_number::text || '-' ||
             split_part(q.external_question_code, '-', 2) as target_code
    from public.questions q
    join public.assignments a on a.id = q.assignment_id
    where split_part(q.external_question_code, '-', 1) <> 'A' || a.sequence_number::text
  ) t
  where exists (
    select 1 from public.questions x
    where x.assignment_id = t.assignment_id
      and x.external_question_code = t.target_code
  );

  if v_blocked is not null then
    raise exception E'Refusing to repair — the corrected code is already taken in the same assignment:\n%\nResolve by hand; this migration will not overwrite an existing code.', v_blocked;
  end if;

  -- ---- apply -------------------------------------------------------
  alter table public.questions disable trigger questions_immutable_after_responses;

  update public.questions q
     set external_question_code =
           'A' || a.sequence_number::text || '-' ||
           split_part(q.external_question_code, '-', 2),
         updated_at = now()
    from public.assignments a
   where a.id = q.assignment_id
     and split_part(q.external_question_code, '-', 1) <> 'A' || a.sequence_number::text;

  get diagnostics v_fixed = row_count;

  alter table public.questions enable trigger questions_immutable_after_responses;

  raise notice 'Repaired % question codes.', v_fixed;

  -- ---- prove the invariant now holds -------------------------------
  if exists (
    select 1 from public.questions q
    join public.assignments a on a.id = q.assignment_id
    where split_part(q.external_question_code, '-', 1) <> 'A' || a.sequence_number::text
  ) then
    raise exception 'Repair incomplete — some codes still disagree with their assignment sequence number.';
  end if;
end;
$$;
