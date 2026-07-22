-- 0015_performance_indexes.sql
-- Phase 10: indexes for the query shapes the app actually issues per page
-- load. No schema, policy, or function changes — indexes only, so this is
-- safe to apply to a live database.
--
-- Measured on the local stack with the demo seed (30 students, 285
-- questions, 1,200 responses) via EXPLAIN (ANALYZE, BUFFERS). The plan for
-- response_transitions_live showed the cost centre clearly:
--
--   Bitmap Heap Scan on responses r1  (rows=30 loops=570)
--     Bitmap Index Scan on idx_responses_question
--
-- i.e. for each of 570 (mapping × student) pairs it fetched every response
-- to that question and discarded all but one, because the only usable
-- index was on question_id alone. That is ~17,000 heap fetches to return
-- 570 rows, and it scales with class size: at 300 students each loop
-- widens 10x. The composite partial index below turns each of those into a
-- single-row lookup.
--
-- No new relations are created, so no GRANTs are required (indexes inherit
-- the table's privileges); the 0007 grant rules are unaffected.
--
-- NOTE for production: these are plain CREATE INDEX statements, which take
-- a brief write lock. Supabase runs migrations inside a transaction, so
-- CONCURRENTLY is not available here. At the expected data volume
-- (< 100k responses) each index builds in well under a second. If this is
-- ever applied to a much larger table, build the indexes manually with
-- CREATE INDEX CONCURRENTLY outside a transaction instead.

-- ============================================================
-- responses — the hot table. Every analytics view, the export, and the
-- student attempt page read it.
-- ============================================================

-- The transition views join responses twice by (question_id, student_id)
-- and only ever care about final answers. Partial + composite: smaller
-- index, single-row lookups, no heap re-check for is_final.
create index if not exists idx_responses_final_question_student
  on public.responses (question_id, student_id)
  where is_final;

-- responses.assignment_id had NO index at all, despite being the filter
-- used by the Excel export, question_response_summary's join, and the
-- assignment detail page's response count.
create index if not exists idx_responses_assignment
  on public.responses (assignment_id);

-- Export and per-student review read one student's answers for one
-- assignment; this serves that directly.
create index if not exists idx_responses_assignment_student
  on public.responses (assignment_id, student_id);

-- ============================================================
-- questions — the student attempt page loads every active question for an
-- assignment in display order (255 rows for Assignment 2). The existing
-- unique index on (assignment_id, external_question_code) cannot serve
-- that ordering, so the planner sorted every time.
-- ============================================================

create index if not exists idx_questions_assignment_order
  on public.questions (assignment_id, display_order)
  where is_active;

-- ============================================================
-- class_members — every analytics view filters
-- (class_id, member_role = 'STUDENT', status = 'ACTIVE') and then joins
-- on user_id. Composite rather than partial so the predicate stays a
-- plain column comparison regardless of the column's type.
-- ============================================================

create index if not exists idx_class_members_class_role_status
  on public.class_members (class_id, member_role, status, user_id);

-- ============================================================
-- imports / import_rows — import_rows had ONLY a primary key, so the
-- import-history panel and the export's Import Validation sheet both did
-- a sequential scan of every import row in the database.
-- ============================================================

create index if not exists idx_import_rows_import
  on public.import_rows (import_id);

create index if not exists idx_imports_assignment
  on public.imports (assignment_id);

-- ============================================================
-- audit_logs — had only a primary key. Admin audit review filters by
-- actor and by entity; test cleanup filters by actor_id.
-- ============================================================

create index if not exists idx_audit_logs_actor
  on public.audit_logs (actor_id, created_at desc);

create index if not exists idx_audit_logs_entity
  on public.audit_logs (entity_type, entity_id);

-- ============================================================
-- question_mappings — response_transitions_live's mapping_sides CTE reads
-- approved mapping members without a class filter, which produced a
-- sequential scan on question_mappings. Indexing the approval flag makes
-- that an index scan.
-- ============================================================

create index if not exists idx_mappings_approved
  on public.question_mappings (professor_approved, class_id)
  where professor_approved;
