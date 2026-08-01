-- ============================================================
-- 0022 — Remove question mappings and everything downstream of them.
--
-- WHAT THIS REMOVES AND WHY
-- The question-mapping feature let a professor declare that an Assignment
-- 1 question and an Assignment 2 question asked about the same thing, and
-- everything cross-assignment was built on top of that declaration: the
-- transition engine (S00/S01/S10/S11), change rate, stability rate, net
-- movement, percentage-point shift, and the per-mapping / per-student /
-- per-source / per-criterion transition summaries. With the mapping
-- record gone there is no basis on which to pair one student's two
-- answers, so every one of those objects is dropped rather than left
-- returning empty rows — an empty view that once carried meaning is worse
-- than an absent one.
--
-- WHAT SURVIVES
-- Every SINGLE-ASSIGNMENT aggregate. question_response_summary,
-- assignment_response_summary, energy_source_response_summary and
-- criterion_response_summary keep their per-question consensus,
-- disagreement and entropy — those never referenced a mapping. The two
-- exploratory pairwise views (student_pair_similarity_exploratory,
-- question_pair_association_exploratory) also survive; only the
-- mapping-scoped third one is dropped. So does
-- energy_source_assignment_change (migration 0017), which compares the two
-- assignments through their shared energy-source LABELS rather than
-- through a mapping, and is therefore unaffected.
--
-- IMMUTABILITY CONSTRAINTS THIS RESPECTS
-- Migration 0011 installed BEFORE UPDATE OR DELETE triggers on
-- question_mappings and question_mapping_members that refuse to delete an
-- approved or load-bearing row. Those triggers are ROW triggers: DROP
-- TABLE does not fire them, so the drop is not blocked. They are dropped
-- explicitly first anyway, so the intent is on the record rather than
-- resting on that detail. The immutability rule was there to stop a
-- mapping's meaning changing under analytics that already cited it;
-- removing the feature outright is a different act, and it is deliberate.
--
-- ORDER
-- Views before the tables they read, tables before the enum types their
-- columns use, functions last. Every drop is IF EXISTS so the migration is
-- safe to re-run; none uses CASCADE, so an object this migration did not
-- anticipate raises an error instead of being silently destroyed.
-- ============================================================

-- ============================================================
-- 1. Synthetic demo cohort.
--
-- The 150 synthetic students were generated for one purpose: to give the
-- demo dashboard enough paired data to show the transition engine working.
-- That dashboard and that engine are both gone, so the rows describe
-- nothing and are removed.
--
-- SCOPE — this deletes ONLY rows carrying is_synthetic = true. That column
-- defaults to false (migration 0017) and cannot be raised by an anon or
-- authenticated session (migration 0020), so it is a trustworthy marker of
-- generated data and a real student cannot be caught by these statements.
--
-- The is_synthetic column, its indexes, the flag-authority triggers and
-- class_synthetic_census all REMAIN. They are a protected boundary, not
-- demo scaffolding: save_attempt_responses/submit_attempt still consult
-- the flag, and a future seeded cohort must go through the same gate.
--
-- Deletion runs child-first. responses and assignment_attempts both
-- cascade from profiles, so deleting the profile would be enough — the
-- explicit order exists so the row counts are attributable if this is run
-- interactively, and so a synthetic attempt belonging to a REAL profile
-- (which should not exist, but would be invisible to a profile-first
-- delete) is still removed.
-- ============================================================

delete from public.responses where is_synthetic;

delete from public.assignment_attempts where is_synthetic;

delete from public.class_members where is_synthetic;

-- auth.users is the owner of a profile row (profiles.id references it with
-- ON DELETE CASCADE). Deleting the profile alone would strand a login that
-- can never be used again, so the auth row goes and the profile follows it
-- down the cascade.
delete from auth.users u
  using public.profiles p
 where p.id = u.id
   and p.is_synthetic;

-- Belt and braces: a synthetic profile whose auth row was already gone.
delete from public.profiles where is_synthetic;

-- ============================================================
-- 2. Views built on mappings or transitions (migration 0011 / 0012).
--
-- Dropped leaf-first: mapping_association_exploratory reads
-- mapping_transition_summary, and every *_transition_summary reads
-- response_transitions_live.
-- ============================================================

drop view if exists public.mapping_association_exploratory;

drop view if exists public.criterion_transition_summary;
drop view if exists public.energy_source_transition_summary;
drop view if exists public.student_transition_summary;
drop view if exists public.class_transition_summary;
drop view if exists public.mapping_transition_summary;

drop view if exists public.response_transitions_live;

drop view if exists public.approved_question_mapping_members;
drop view if exists public.approved_question_mappings;

-- ============================================================
-- 3. Triggers and the functions only they call (migration 0011).
-- ============================================================

drop trigger if exists question_mappings_immutable_when_load_bearing
  on public.question_mappings;
drop trigger if exists mapping_members_immutable_when_load_bearing
  on public.question_mapping_members;

-- ============================================================
-- 4. Tables. RLS policies and indexes are owned by the table and go with
--    it; response_transitions is dropped before question_mappings because
--    it references it.
-- ============================================================

drop table if exists public.response_transitions;
drop table if exists public.question_mapping_members;
drop table if exists public.question_mappings;

-- ============================================================
-- 5. Mapping RPCs and helpers (migration 0011). These are dropped after
--    the tables so a dependency this migration missed surfaces as an
--    error on the table drop rather than as a broken function.
-- ============================================================

drop function if exists public.create_question_mapping(uuid, uuid[], uuid[], text, text, text, text, text, text, text);
drop function if exists public.update_question_mapping(uuid, uuid[], uuid[], text, text, text, text, text, text);
drop function if exists public.set_mapping_approval(uuid, boolean);
drop function if exists public.create_mapping_version(uuid);
drop function if exists public.preview_mapping_pairs(uuid);
drop function if exists public.validate_mapping_questions(uuid, uuid[], uuid[], text);
drop function if exists public.mapping_has_dependents(uuid);
drop function if exists public.enforce_mapping_immutability();
drop function if exists public.enforce_mapping_member_immutability();

-- Signatures drifted across 0011's revisions; drop any remaining overload
-- by name so nothing mapping-shaped is left callable. This is the one
-- place a name lookup is used instead of an exact signature, and it is
-- scoped to functions this migration is removing.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'create_question_mapping',
         'update_question_mapping',
         'set_mapping_approval',
         'create_mapping_version',
         'preview_mapping_pairs',
         'validate_mapping_questions',
         'mapping_has_dependents',
         'enforce_mapping_immutability',
         'enforce_mapping_member_immutability'
       )
  loop
    execute format('drop function if exists %s', fn.signature);
  end loop;
end;
$$;

-- ============================================================
-- 6. Enum types. All three existed only for the mapping and transition
--    columns dropped above; nothing else in the schema references them.
-- ============================================================

drop type if exists public.transition_state;
drop type if exists public.data_quality_status;
drop type if exists public.mapping_type;

-- ============================================================
-- 7. Saved builder definitions that named a removed dataset.
--
-- saved_queries.definition and saved_visualisations.query_definition are
-- jsonb blobs the app re-validates on read, so a stale one is rejected
-- rather than executed — but it would surface to the professor as a saved
-- item that always errors. Those rows are removed; dashboard_items
-- referencing a removed visualisation cascade with it.
-- ============================================================

delete from public.saved_queries
 where definition->>'dataset' = 'PAIRED_TRANSITIONS';

delete from public.saved_visualisations
 where query_definition->>'dataset' = 'PAIRED_TRANSITIONS'
    or chart_type in ('SANKEY', 'TRANSITION_MATRIX');
