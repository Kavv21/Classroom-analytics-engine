# Database Schema Reference

Source of truth for table shape. Update this file whenever a migration
changes reality — don't let it drift.

Normalised PostgreSQL, UUID primary keys, foreign keys, indexes, timestamps,
and DB-level constraints throughout.

## Tables (minimum set)

```
profiles
classes
class_members
roster_entries
assignments
questions
question_options
assignment_attempts
responses
question_mappings
question_mapping_members
response_transitions
saved_queries
saved_visualisations
dashboards
dashboard_items
imports
import_rows
audit_logs
```

## profiles
id, email, full_name, role, student_identifier, roll_number, programme,
year_of_study, section, is_active, created_at, updated_at

## classes
id, professor_id, name, course_name, academic_year, semester, section,
class_code, start_date, end_date, status, created_at, updated_at

`status`: `ACTIVE` | `ARCHIVED` (CHECK constraint, migration 0005). Archiving
is a status flip, not a delete — never destroy a class with responses.

## class_members
id, class_id, user_id, member_role, status, joined_at

## roster_entries
Pre-provisioning for Google SSO (see docs/AUTH_SSO.md,
docs/AUTH_SSO_UPDATE.md, migration 0002). Populated by roster import
(Phase 3) rather than writing to `profiles` directly — `profiles` rows only
get created by `handle_new_user()` at a student's first sign-in, using
whichever roster_entries row matches their email.

id, email (globally unique), intended_role, class_id, roll_number,
full_name, programme, year_of_study, section, provisioned, created_by,
created_at, updated_at

**`email` is globally unique**, which means one roster_entries row can only
ever pre-provision one student for one class at a time. Roster import
(lib/roster/validate.ts, `RosterRowClassification`) therefore branches on
each row:
- email unseen anywhere → insert a new `roster_entries` row (`NEW`).
- email already has a `profiles` row (provisioned earlier, via any class)
  → enrol directly into `class_members` instead (`EXISTING_PROFILE`);
  never touch `roster_entries` for this email again.
- email already pending (`provisioned = false`) for *this* class → rejected
  as a duplicate (`DUPLICATE_ALREADY_IN_CLASS`).
- email already pending for a *different* class → rejected
  (`DUPLICATE_PENDING_OTHER_CLASS`) — the professor of that other class (or
  the student's first sign-in) needs to resolve it; this deliberately does
  not silently reassign `roster_entries.class_id`.

Duplicate detection and cross-class lookups are done via the
`check_roster_emails` RPC (migration 0005) — a professor has no RLS-granted
read access to another class's `roster_entries`/`profiles`, so this
security-definer function answers only the yes/no questions import needs,
never a full row.

## assignments
id, class_id, title, description, instructions, assignment_stage,
sequence_number, open_at, close_at, status, allow_draft_editing,
allow_resubmission, response_zero_label, response_one_label, created_by,
created_at, updated_at

Stages: PRE_INSTRUCTION, POST_INSTRUCTION, FOLLOW_UP, OTHER
Statuses: DRAFT, READY, OPEN, CLOSED, ARCHIVED

Status transitions are enforced by the `assignments_status_transition`
trigger (migration 0009), not just the UI:
```
DRAFT  → READY      (requires ≥1 active question; READY = "professor saw
                     and approved the full question list")
READY  → DRAFT      (un-approve, resume editing)
READY  → OPEN       (publish)
OPEN   → CLOSED
CLOSED → ARCHIVED
```
Everything else is rejected with an exception. The TS mirror of this map is
`VALID_ASSIGNMENT_TRANSITIONS` in `lib/types/domain.ts` (friendly errors
only — the trigger is the boundary).

## questions
id, assignment_id, external_question_code, original_worksheet,
original_row_reference, original_column_reference, question_text,
energy_source, criterion, concept, response_zero_label, response_one_label,
display_order, is_active, raw_source_payload, created_at, updated_at

**Destructive-edit blocking** (CLAUDE.md rule 6): the
`questions_immutable_after_responses` trigger (migration 0009) fires for
every role — including service_role, which bypasses RLS but not triggers.
Once `assignment_has_responses(assignment_id)` is true: INSERT and DELETE
are rejected, and UPDATE may only change `display_order` / `updated_at`
(reordering is presentation; wording, codes, labels, classification
fields, and `is_active` are locked). Version the assignment (duplicate)
instead.

## assignment_attempts
id, assignment_id, student_id, state, started_at, last_saved_at,
submitted_at, reopened_at, reopened_by, submission_version, created_at,
updated_at

States: NOT_STARTED, DRAFT, SUBMITTED, REOPENED, RESUBMITTED
Valid transitions:
```
NOT_STARTED → DRAFT
NOT_STARTED → SUBMITTED
DRAFT → DRAFT
DRAFT → SUBMITTED
SUBMITTED → REOPENED
REOPENED → DRAFT
REOPENED → RESUBMITTED
```
Backend must reject any transition not in this list.

Enforced by the `attempts_state_transition` trigger (migration 0010) —
fires for every role, INSERT included (a new row may only start as
NOT_STARTED or DRAFT). Updates that don't change `state` are bookkeeping,
not transitions, and pass. The TS mirror is `VALID_ATTEMPT_TRANSITIONS`
in `lib/types/domain.ts`.

Unique on (assignment_id, student_id) — one attempt per student per
assignment; `get_or_create_attempt` leans on it for idempotency.

`submission_version` bumps on any submission after a previous one
(including the REOPENED → DRAFT → SUBMITTED editing path, which the FSM
routes through SUBMITTED rather than RESUBMITTED); `responses.version` is
stamped to match at submit time.

`assignments.allow_draft_editing = false` means a saved answer is
write-once: blank answers can still be filled in, but changing an
already-saved 0/1 is rejected by `save_attempt_responses`.

## responses
id, attempt_id, assignment_id, student_id, question_id, response_value,
is_final, first_saved_at, last_saved_at, submitted_at, version, created_at,
updated_at

```sql
CHECK (response_value IN (0, 1) OR response_value IS NULL)
```
Unique constraint on (attempt_id, question_id) — no duplicate responses.

## question_mappings
id, class_id, assignment_1_question_ids[], assignment_2_question_ids[],
mapping_name, common_concept, energy_source, criterion, mapping_type,
comparison_method, professor_notes, mapping_status, professor_approved,
version, previous_version_id, superseded_by_id, created_by, created_at,
updated_at

Mapping types: EXACT_ONE_TO_ONE, CONCEPTUAL_ONE_TO_ONE, ONE_TO_MANY,
MANY_TO_ONE, GROUPED_CONCEPT, NOT_COMPARABLE, UNMAPPED

`mapping_status` (CHECK, migration 0011): DRAFT | SUGGESTED |
NEEDS_PROFESSOR_REVIEW | APPROVED | REJECTED | SUPERSEDED. A second CHECK
keeps the flag and label coherent: `professor_approved = true` requires
`mapping_status = 'APPROVED'`.

**Versioning** (migration 0011): a version chain is a linked list —
`previous_version_id` points back, `superseded_by_id` points forward.
`create_mapping_version` copies content + members into a fresh DRAFT
(version + 1) and stamps `superseded_by_id` on the old tip, which freezes
it against re-approval and against forking a second version. The old
version stays approved/live until the new one is approved;
`set_mapping_approval(new, true)` then retires every earlier version
(professor_approved = false, SUPERSEDED).

**Destructive-edit blocking** (same category as the questions trigger):
`question_mappings_immutable_when_load_bearing` +
`mapping_members_immutable_when_load_bearing` (migration 0011) fire for
every role, service_role included. Once a mapping is `professor_approved`
OR referenced by `response_transitions` (`mapping_has_dependents()`
security-definer helper), DELETE is rejected and UPDATE may only change
the lifecycle fields (professor_notes, mapping_status, professor_approved,
superseded_by_id, updated_at); member rows are frozen entirely. Version
the mapping instead.

## question_mapping_members
Junction table supporting one-to-many / many-to-one:
id, mapping_id, assignment_id, question_id, mapping_side, weight, created_at

Unique on (mapping_id, question_id) — migration 0011. `mapping_side` 1 is
the class's sequence_number-1 assignment, side 2 is sequence 2; sides are
derived server-side in the RPCs, never trusted from the client.

## response_transitions
id, class_id, student_id, mapping_id, assignment_1_value,
assignment_2_value, transition_state, data_quality_status, calculated_at

transition_state: S00, S01, S10, S11 (only when both values are binary)
data_quality_status: MISSING_A1, MISSING_A2, MISSING_BOTH, NOT_COMPARABLE

**Phase 7 note:** live analytics does NOT read this table — transitions
are computed on read by the `response_transitions_live` view (migration
0012, see "Analytics views" below). The table is retained as a durable
snapshot target (exports/audit, future use); any rows written to it still
arm the 0011 `mapping_has_dependents` immutability boundary.

## audit_logs
Logs: login (where appropriate), class creation, roster imports, assignment
import, assignment publication/closure, attempt reopening, mapping
approval, exports, admin changes.
No anti-cheat or browser-violation event tables — see EXCLUDED_FEATURES.md.

## Row-Level Security (enforced at the DB layer, not just frontend)

Students: read own profile; read classes they're enrolled in; read open
assignments for their classes; read/write only their own draft responses;
submit only their own attempts; read only their own submission receipts.
Students may NOT read another student's responses, class analytics, alter
submitted data, approve mappings, or export class datasets.

Professors: manage their own classes, students, and assignments; read class
responses for their own classes; approve mappings; view analytics; export
their own class data. `profiles_professor_class_students_select` (migration
0005, rewritten in 0008 — see below) is the policy backing "read own
students" — scoped to profiles that are a `class_members` row in one of
that professor's classes; it grants read only, never write.

Admins: system-level management per explicit policies (not blanket access).

## RLS recursion: the classes / class_members helper functions (migration 0008)

`classes` and `class_members` each had a policy that reached into the other
table via a raw correlated subquery: `classes_member_select` queried
`class_members`, and `class_members_professor_manage` queried `classes`.
Both are plain table references, so evaluating either one pulls in the
other table's RLS policies — which pulls the first table's policies back in
— a genuine two-table cycle that existed from `0001_init.sql` onward.
Nothing hit it reliably until `0005_class_roster_management.sql` added
`profiles_professor_class_students_select`, which joins `class_members` and
`classes` in one policy body, turning even a plain "read my own profile"
query into a query that forces both sides of the cycle to be planned
together — surfaced as Postgres error `42P17` ("infinite recursion detected
in policy for relation class_members").

The fix: three `security definer` helper functions, following the
`current_user_role()` pattern already established in `0001_init.sql`.
A `security definer` function executes with its owner's privileges, and
Postgres does not apply RLS to a table's own owner — so a `classes` or
`class_members` lookup done *inside* one of these functions never
re-triggers that table's policies, which is what breaks the cycle. Each
sets `search_path = public` explicitly, per the reasoning in
`0004_fix_trigger_search_path.sql` (a `security definer` function must not
resolve unqualified table names via a caller-controlled `search_path`).

- `is_professor_of_class(p_class_id uuid) returns boolean` — replaces
  `exists (select 1 from classes where id = ... and professor_id =
  auth.uid())`.
- `is_class_member(p_class_id uuid) returns boolean` — replaces
  `exists (select 1 from class_members where class_id = ... and user_id =
  auth.uid())`.
- `is_professor_of_student(p_student_id uuid) returns boolean` — the
  `class_members` ⋈ `classes` join `profiles_professor_class_students_select`
  needs, done once inside the function so neither table's RLS re-enters
  while `profiles`' RLS is being resolved.

These are boolean, single-class helpers rather than a set-returning
`user_class_ids()`, because every call site already checks membership for
one `class_id` correlated to the row being filtered — a boolean short-
circuits per row instead of materialising a set to probe with `IN (...)`.

Every policy that reached `classes` or `class_members` through a raw
correlated subquery was rewritten to call these helpers instead — not only
the two that formed the cycle. `assignments`, `questions`,
`assignment_attempts`, `responses`, `question_mappings`,
`question_mapping_members`, `response_transitions`, `imports`,
`import_rows`, and `roster_entries` all join through `classes` and/or
`class_members` the same way; none of them formed a cycle on their own
(each only ever reached one side of the `classes`/`class_members` pair), but
a raw subquery anywhere in that chain re-opens the same hole the moment it
touches both tables. Policies that never had a subquery into
`classes`/`class_members` at all (e.g. `classes_professor_manage`, which is
just `professor_id = auth.uid()`) are unchanged.

**Rule for future policies**: never write a raw correlated subquery from
one RLS-protected table into `classes` or `class_members` (or chain through
a table that itself does). Use `is_professor_of_class(...)` /
`is_class_member(...)` instead.

## Security-definer RPCs (bypass RLS deliberately, narrowly)

Three functions in migration 0005 do more than a scoped RLS policy could
express without over-widening table-level access. Each starts with an
explicit ownership check standing in for RLS, per CLAUDE.md's "No RLS
shortcuts" rule — see the migration file for the full reasoning:

- `commit_roster_import(...)` — `security invoker` (relies on RLS, doesn't
  bypass it); wraps the whole roster-import commit in one transaction so a
  failure never leaves a partial import.
- `check_roster_emails(p_class_id, p_emails)` — `security definer`; answers
  only yes/no duplicate-detection questions for roster import, never
  returns another class's identity or a student's other fields.
- `set_student_active(p_class_id, p_profile_id, p_is_active)` —
  `security definer`; writes only `profiles.is_active`, nothing else.

Migration 0009 (Phase 4) adds, following the same rules (definer functions
pin `search_path = public` and schema-qualify; invoker functions lean on
RLS plus an explicit ownership check for clear errors):

- `assignment_has_responses(p_assignment_id)` — `security definer` boolean
  helper used by the 0009 triggers.
- `commit_assignment_import(p_assignment_id, p_source_filename,
  p_source_checksum, p_source_worksheet, p_questions)` — `security
  invoker`; all-or-nothing transactional question import into a DRAFT,
  response-free assignment. Replaces the assignment's question set (clean
  re-import after a rejected attempt), writes `imports`/`import_rows`
  history, audit-logs, and raises (rolling everything back) on any bad
  row — never a silent partial import.
- `record_failed_assignment_import(...)` — `security invoker`; records a
  FAILED import plus REJECTED rows as history without touching questions.
  Called by the server action when the parser reports row-level errors.
- `duplicate_assignment(p_assignment_id)` — `security invoker`; copies the
  assignment + questions into a new DRAFT (`title || ' (copy)'`) in one
  transaction.
- `log_audit_event(p_action, p_entity_type, p_entity_id, p_metadata)` —
  `security definer`; the only write path into `audit_logs` (which has no
  INSERT policy). Actor is always `auth.uid()`; execute revoked from anon.

Migration 0010 (Phase 5) adds the student-attempt RPCs. All but the last
are `security invoker` (RLS + an explicit ownership check for clear
errors); EXECUTE is revoked from anon on all four:

- `get_or_create_attempt(p_assignment_id)` — idempotent entry point;
  requires the assignment OPEN and the caller a class member; creates the
  NOT_STARTED row on first call, returns the existing one after.
- `save_attempt_responses(p_attempt_id, p_answers)` — batched autosave.
  Upserts on (attempt_id, question_id) so retried batches converge;
  validates each value against {0, 1, null} and each question against the
  attempt's assignment; rejects saves unless the attempt is
  NOT_STARTED/DRAFT/REOPENED and the assignment is OPEN; moves state to
  DRAFT. One transaction — a bad answer aborts the whole batch.
- `submit_attempt(p_attempt_id)` — final submission. Locks the attempt row
  (`for update`), so concurrent/double submits serialize; an
  already-submitted attempt gets a clear "already submitted" error and no
  second submission. Marks responses is_final + stamps version. Only ever
  invoked from the student's explicit confirm button — no automatic
  trigger exists anywhere (EXCLUDED_FEATURES.md).
- `reopen_attempt(p_attempt_id)` — professor-only, `security definer`
  (professors deliberately have no UPDATE policy on responses; this is the
  one narrow write path, per the set_student_active precedent). SUBMITTED →
  REOPENED with reopened_at/reopened_by; clears responses.is_final;
  audit-logged. RESUBMITTED is terminal and cannot be reopened.

Migration 0011 (Phase 6) adds the mapping-studio RPCs. All are `security
invoker` (RLS + `is_professor_of_class` ownership check for clear errors);
EXECUTE revoked from anon on every one:

- `validate_mapping_questions(p_class_id, p_a1_question_ids,
  p_a2_question_ids, p_mapping_type)` — shared validation: every id must
  belong to the class's sequence-1/-2 assignment respectively, and the
  side counts must fit the mapping type (1:1 types need exactly 1+1,
  ONE_TO_MANY 1+2..., MANY_TO_ONE 2...+1, GROUPED_CONCEPT ≥1 each side;
  NOT_COMPARABLE/UNMAPPED may be one-sided).
- `create_question_mapping(...)` — insert mapping + member rows in one
  transaction. New mappings may only start as
  DRAFT/SUGGESTED/NEEDS_PROFESSOR_REVIEW — there is no auto-approval path.
- `update_question_mapping(...)` — full edit (fields + members) of a
  non-load-bearing, non-superseded mapping; editing a REJECTED mapping
  moves it back to DRAFT.
- `set_mapping_approval(p_mapping_id, p_approve)` — approve (rejecting
  supersession-tips only) or reject; approving retires every earlier
  version in the chain. Audit-logged (MAPPING_APPROVED/MAPPING_REJECTED).
- `create_mapping_version(p_mapping_id)` — see versioning above.
- `preview_mapping_pairs(p_mapping_id)` — the pre-approval analytics
  preview, aggregated in the database: per-question respondent counts and
  per-(A1×A2)-pair combination counts (pair00/01/10/11 + missing buckets)
  over final responses of active student members. Deliberately neutral
  vocabulary — S00-S11 transition states belong to approved-mapping
  analytics (Phase 7), never to previews.
- `mapping_has_dependents(p_mapping_id)` — `security definer` boolean
  helper for the 0011 triggers (does response_transitions reference it).

## Views (migration 0009)

- `assignment_submission_progress` (`security_invoker = on`) — per
  assignment: enrolled_students plus counts by attempt state
  (not_started/draft/submitted/reopened/resubmitted), aggregated over
  active STUDENT `class_members` left-joined to `assignment_attempts`.
  The querying user's own RLS applies; explicit SELECT grants to
  authenticated/service_role.

## Views (migration 0011) — the approved-only mapping surface

- `approved_question_mappings` / `approved_question_mapping_members`
  (`security_invoker = on`) — the ONLY relations downstream features
  (transition engine, analytics, dashboards) may read mappings from.
  `professor_approved = true and mapping_status = 'APPROVED'` is baked
  into the view definition, so an unapproved mapping is structurally
  invisible no matter who queries — including service_role, which
  bypasses RLS but not the view's filter. TS access goes through
  `lib/mappings/queries.ts` (`getApprovedMappings`). Verified by
  tests/integration/mapping-flow.test.ts ("ACCEPTANCE" block).

## Analytics views (migration 0012) — Phase 7

**DECISION: transitions and every aggregate are COMPUTED ON READ** (plain
views), not written by a recompute job when a mapping is approved. Why:

- responses keep arriving while assignments are OPEN, so any snapshot
  taken at approval time is stale by the next student submission;
- Phase 6 versioning flips which mapping version is live at approval
  time, and the phase-7 definition of done requires approval changes to
  reach aggregates with **no manual recompute step**;
- the data volumes here (tens of students × hundreds of questions) make
  on-read aggregation cheap.

**Consequence for Phase 8: data from these views is ALWAYS fresh. There
is no refresh trigger, no staleness window, and no cache-invalidation
concern — charts can query on every render.** If profiling ever shows
these views are too slow, convert them to materialised views + a refresh
step — but that changes this contract and must be re-documented here.

All views are `security_invoker = on` with explicit SELECT grants to
authenticated/service_role. Mappings enter only via
`approved_question_mappings` (the 0011 structural filter). Formulas are
docs/ANALYTICS_DEFINITIONS.md verbatim; rates are NULL (never 0) when
there is no valid data. TS access goes through `lib/analytics/queries.ts`.

- `response_transitions_live` — one row per (approved mapping × active
  student member). Only EXACT_ONE_TO_ONE / CONCEPTUAL_ONE_TO_ONE
  mappings (whose sides are exactly one question each) can produce
  S00–S11: ANALYTICS_DEFINITIONS.md defines T(i,j) on a single binary
  value per side, and no collapse formula for multi-question sides is
  documented — so ONE_TO_MANY / MANY_TO_ONE / GROUPED_CONCEPT (and
  explicit NOT_COMPARABLE / UNMAPPED) pairs are reported as
  `data_quality_status = NOT_COMPARABLE`, never forced into a transition
  bucket. A final-but-blank answer (NULL response_value) counts as
  missing (MISSING_A1 / MISSING_A2 / MISSING_BOTH).
- Transition aggregates, one per grain, all with s00/s01/s10/s11,
  valid_paired, missing buckets, changed/unchanged counts, change_rate,
  stability_rate, net_movement_toward_1, pct_point_shift:
  `mapping_transition_summary` (also carries missing_a2_from_0/1 and
  missing_a1_to_0/1 splits for alluvial diagrams),
  `class_transition_summary`, `student_transition_summary`,
  `energy_source_transition_summary`, `criterion_transition_summary`
  (the last two group by the mapping's energy_source/criterion field and
  skip NULLs).
- Response-distribution aggregates (consensus / disagreement / entropy
  over final responses of active members):
  `question_response_summary`, `assignment_response_summary` (per-question
  averages + distinct respondents), `energy_source_response_summary` and
  `criterion_response_summary` (pooled per group within an assignment).
- `submission_timeline` (migration 0013, Phase 8) — submissions per day
  (UTC) and cumulative per assignment, from `assignment_attempts.submitted_at`.
  Feeds the completion-timeline chart (17.14); same computed-on-read
  freshness contract as everything above.
- **Section 18 exploratory** (suffix `_exploratory` is the machine-readable
  marker; `lib/analytics/queries.ts` wraps rows in
  `{ exploratory: true, caveat }` and Phase 8 must show the caveat —
  similarity/association/cluster/projection output is never a grade):
  `student_pair_similarity_exploratory` (contingency counts, Jaccard,
  Hamming, agreement rate per student pair per assignment — also the
  input for hierarchical clustering and the deterministic classical-MDS
  projection in `lib/analytics/exploratory.ts`, chosen over UMAP because
  UMAP is stochastic), `question_pair_association_exploratory` (2×2
  contingency + Phi + mutual information per question pair within an
  assignment), `mapping_association_exploratory` (Phi + mutual
  information on each approved mapping's A1↔A2 table). Alluvial-diagram
  data comes from `mapping_transition_summary` via
  `alluvialFromTransitionCounts`.

## Table grants (migration 0007)

RLS policies filter *rows* a role may see; they do nothing without a
table-level GRANT first — Postgres checks privileges before RLS, and a
missing GRANT fails the whole query with `permission denied for table X`,
not an empty result. Migrations 0001-0006 enabled RLS on every table but
never granted base privileges to `anon`/`authenticated`/`service_role`,
which made every table unreadable by every role (including `service_role`,
which bypasses RLS but still needs the GRANT) until migration 0007 fixed
it. Any new table added in a future migration needs no additional GRANT —
0007 also sets `ALTER DEFAULT PRIVILEGES` so `authenticated`/`service_role`
inherit access to tables created later by the same migration role — but
this is exactly the kind of thing to double check with a manual query if a
new table mysteriously behaves as if RLS is denying everything.
