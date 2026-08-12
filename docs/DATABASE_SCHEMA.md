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

`role` is the `user_role` enum: `ADMIN` | `PROFESSOR` | `TA` | `STUDENT`
(`TA` added in migration 0027). `TA` here is an identity label with **no
authority attached** — nothing in the schema reads `profiles.role` to
decide whether someone may act on a class. It exists so a person invited as
a teaching assistant before they have ever signed in can be provisioned at
all; their actual authority is the `class_members` row it produces.

## classes
id, professor_id, name, course_name, academic_year, semester, section,
class_code, start_date, end_date, status, created_at, updated_at

`status`: `ACTIVE` | `ARCHIVED` (CHECK constraint, migration 0005). Archiving
is a status flip, not a delete — never destroy a class with responses.

## class_members
id, class_id, user_id, member_role, status, joined_at

`member_role` is typed `user_role` and carries the class-scoped role:
`STUDENT` for an enrolment, `TA` for a teaching assistant (migrations
0027/0028). It is the authoritative statement of TA-ness — a person's
`profiles.role` is not consulted anywhere in the TA authorisation path, so
someone can be a `PROFESSOR` globally and a `TA` of a colleague's class at
the same time. See "Teaching assistants" below.

## roster_entries
Pre-provisioning for Google SSO (see docs/AUTH_SSO.md, migration 0002).
Populated by roster import
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
trigger (migrations 0009, 0023, 0029), not just the UI:
```
DRAFT  → READY      (requires ≥1 active question; READY = "professor saw
                     and approved the full question list")
READY  → DRAFT      (un-approve, resume editing)
READY  → CLOSED     (retire a scheduled assignment — added in 0029)
CLOSED → READY      (put it back on the calendar — added in 0029)
CLOSED → ARCHIVED
READY  → OPEN       (legacy manual publish; no longer offered in the UI)
OPEN   → CLOSED     (legacy)
CLOSED → OPEN       (legacy reopen-to-class — added in 0023)
```
Everything else is rejected with an exception. The TS mirror of this map is
`VALID_ASSIGNMENT_TRANSITIONS` in `lib/types/domain.ts` (friendly errors
only — the trigger is the boundary).

### Scheduling: `open_at` / `close_at` are the access control (0029)

`open_at` and `close_at` existed from 0001 and were read by nothing — the
form collected them, the detail page printed them, and student access was
decided entirely by whether a professor had pressed "Publish to students"
(READY → OPEN). Since **migration 0029 the window IS the mechanism**, and
the publish/close buttons are gone from the UI.

```
assignment_accepts_answers(status, open_at, close_at)   -- stable, reads now()
  READY  → open_at IS NOT NULL AND close_at IS NOT NULL
           AND now() BETWEEN open_at AND close_at        (both bounds inclusive)
  OPEN   → (open_at IS NULL OR now() >= open_at)
           AND (close_at IS NULL OR now() <= close_at)
  else   → false
```

* **A scheduled assignment lives at READY.** It is approved, it has a
  window, and it never passes through OPEN. The status column therefore
  reads `READY` the whole time the class is answering — which is why the
  UI prints an *effective* status (`effectiveAssignmentStatus` in
  `lib/assignments/schedule.ts`: Draft / Not scheduled / Scheduled — opens X
  / Open until X / Closed / Archived) and never the raw column.
* **A READY assignment with either date missing is unreachable.** Fail
  closed, deliberately: READY has always meant "approved, not yet
  released", so a missing schedule must not come to mean "open to
  everyone". The form requires the two dates together.
* **OPEN is legacy.** Every assignment published by hand before 0029 sits
  in it, so there a NULL bound is an ABSENT bound and a dateless OPEN row
  behaves exactly as it did before. Nothing in the UI moves an assignment
  into OPEN any more.
* **Evaluated lazily, at request time.** There is no cron job, no scheduled
  function and no status-flipping worker: `get_or_create_attempt`,
  `save_attempt_responses`, `submit_attempt` and the two student-facing RLS
  policies each compare `now()` against the row when they run.
* `assignment_has_opened(status, open_at)` is the weaker sibling: has this
  ever been in front of students? It gates student access to `questions`
  (which must outlive the window, for receipts) and the per-attempt reopen.
* `assignments_window_ordered` — CHECK `close_at >= open_at`, added NOT
  VALID in 0029 so it binds new writes without rejecting historical rows.
  `alter table public.assignments validate constraint
  assignments_window_ordered;` once the existing rows have been checked.

Timezones: `open_at`/`close_at` are `timestamptz`, and the conversion
to/from the `datetime-local` inputs happens **in the browser only**
(`isoToLocalInput` / `localInputToIso`). Doing it in a Server Component —
which is what the edit page used to do — reads Vercel's timezone (UTC)
instead of the professor's, and silently stored every schedule off by their
UTC offset.

ARCHIVED is the only terminal status *within the FSM*. CLOSED → OPEN was
absent until 0023, which made closing irreversible and left the
per-attempt reopen with nothing to reopen into; migration 0023's header
records why migration 0020's rejection of this transition does not apply
to it.

ARCHIVED → CLOSED exists since migration 0025, but deliberately NOT as an
FSM edge: it is reachable only through the `unarchive_assignment` RPC,
which disables `assignments_status_transition` for the length of one
transaction. Keeping it off the transition map is the point — adding it
would make `transitionAssignment` (and so the generic status buttons)
offer it, and ARCHIVED would stop meaning "out of play". Restoring lands
on CLOSED, never OPEN: letting students back in is a separate decision.
`VALID_ASSIGNMENT_TRANSITIONS` therefore still shows ARCHIVED as
terminal, and that is correct for every path except this one RPC.

`sequence_number` is a position, not a display number. 1 and 2 are the
compared pair — one of each per class, guarded by the
`assignments_class_sequence_unique` partial index (0018) — and they are the
pivot of `energy_source_assignment_change` and the source of each
question's `A{n}-NNN` code prefix. A class may hold any number of further
assignments; they take 3, 4, 5 … and appear in single-assignment reporting
only. Allocation: `next_assignment_sequence_number(class_id)` in SQL,
`nextOtherSequenceNumber` in `lib/assignments/sequence.ts` for the form.

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

## Removed: question_mappings / question_mapping_members / response_transitions (migration 0022)

These three tables, their RLS policies, their indexes, their immutability
triggers (`question_mappings_immutable_when_load_bearing`,
`mapping_members_immutable_when_load_bearing`), their RPCs
(`create_question_mapping`, `update_question_mapping`,
`set_mapping_approval`, `create_mapping_version`, `preview_mapping_pairs`,
`validate_mapping_questions`, `mapping_has_dependents`) and the three enum
types they alone used (`mapping_type`, `transition_state`,
`data_quality_status`) were dropped in migration 0022.

They existed so a professor could declare an Assignment 1 question and an
Assignment 2 question comparable, which is what let the transition engine
pair one student's two answers. With no such declaration, the pairing has
no defined basis, so every view built on it went too (see "Removed
analytics views" below). Do not reintroduce a transition metric without
first defining in ANALYTICS_DEFINITIONS.md what makes two questions
comparable.

## saved_queries / saved_visualisations / dashboards / dashboard_items

The query builder's persistence (Phase 9). `saved_queries.definition` and
`saved_visualisations.query_definition` both hold a `QueryDefinition` JSON
blob (`lib/query-builder/schema.ts`): dataset, measure, dimensions,
filters, chart type. Migration 0014 adds
`saved_visualisations.description`, `dashboard_items.saved_query_id`
(a dashboard item now references exactly one of a saved visualisation or
a saved query — `dashboard_items_one_reference` CHECK), and indexes on
`(class_id, created_by)`.

**RLS hardening (migration 0014).** The 0001 policies authorised on
`created_by = auth.uid()` alone. Because a `FOR ALL` policy reuses its
USING expression as the INSERT WITH CHECK when none is given, a professor
could save a row whose `class_id` pointed at a class they did not own —
making `saved_queries.class_id` an attacker-controlled value that any
export or builder path trusting it would turn into a cross-class read.
All four policies now state USING and WITH CHECK explicitly and require
`class_id is null or is_professor_of_class(class_id)`.
`dashboard_items_owner` also stopped reaching into `dashboards` with a raw
correlated subquery — it goes through the `owns_dashboard(uuid)`
security-definer helper, per the 0008 rule.

- `owns_dashboard(p_dashboard_id uuid)` — `security definer`,
  `search_path = public`; the only cross-table reach in these policies.

## audit_logs
Logs: login (where appropriate), class creation, roster imports, assignment
import, assignment publication/closure, attempt reopening, exports, admin
changes.
No anti-cheat or browser-violation event tables — see EXCLUDED_FEATURES.md.

## Row-Level Security (enforced at the DB layer, not just frontend)

Students: read own profile; read classes they're enrolled in; read
assignments for their classes that are OPEN, CLOSED, or READY **and
scheduled** (`assignments_student_select`, rewritten in 0029 — an approved
but unscheduled assignment stays invisible); read the QUESTIONS of one only
once it has actually opened (`questions_student_select`, gated on
`assignment_has_opened`, so the text is hidden before the opening time and
still readable afterwards for receipts); read/write only their own draft
responses; submit only their own attempts; read only their own submission
receipts.
Students may NOT read another student's responses, class analytics, alter
submitted data, or export class datasets.

**Attempts and responses are read-only over PostgREST (migration 0024).**
`assignment_attempts` and `responses` carry SELECT-only policies —
`attempts_student_select`, `attempts_professor_select`,
`responses_student_select`, `responses_professor_select` — and
INSERT/UPDATE/DELETE are revoked from `authenticated` and `anon`. Every
write goes through `get_or_create_attempt`, `save_attempt_responses`,
`submit_attempt`, `reopen_attempt` or `reopen_assignment_attempts`, which
are `security definer` and carry the per-attempt rule themselves.

This replaced `attempts_student_own` / `responses_student_own`, which were
`for all using (student_id = auth.uid())`. That is a per-STUDENT question,
and it was the boundary, so it let a student rewrite their own final
responses, delete a submitted attempt, and take their own SUBMITTED attempt
to REOPENED (a legal FSM edge — the trigger validates the edge, not the
actor), which unlocked writing on any assignment of theirs. "Submitted is
locked until a professor reopens THIS pair" is only true with those
privileges gone.

Professors: manage their own classes, students, and assignments; read class
responses for their own classes; view analytics; export their own class
data. `profiles_professor_class_students_select` (migration
0005, rewritten in 0008 — see below) is the policy backing "read own
students" — scoped to profiles that are a `class_members` row in one of
that professor's classes; it grants read only, never write.

Teaching assistants: everything a professor can do with ONE class's
content, and two exceptions — archiving/restoring/deleting/reassigning the
class itself, and managing that class's other TAs. See "Teaching
assistants" below.

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
`assignment_attempts`, `responses`, `imports`,
`import_rows`, and `roster_entries` all join through `classes` and/or
`class_members` the same way; none of them formed a cycle on their own
(each only ever reached one side of the `classes`/`class_members` pair), but
a raw subquery anywhere in that chain re-opens the same hole the moment it
touches both tables. Policies that never had a subquery into
`classes`/`class_members` at all (e.g. `classes_professor_manage`, which is
just `professor_id = auth.uid()`) are unchanged.

**Rule for future policies**: never write a raw correlated subquery from
one RLS-protected table into `classes` or `class_members` (or chain through
a table that itself does). Use `can_manage_class_content(...)` /
`is_professor_of_class(...)` / `is_class_member(...)` instead.

## Teaching assistants (migrations 0027, 0028)

A TA is a `class_members` row with `member_role = 'TA'` and
`status = 'ACTIVE'` — the same kind of object as a student's enrolment, and
scoped to one class. Nobody's `profiles.role` is rewritten when they are
made a TA.

`user_role` had to gain `TA` (migration 0027, its own file because a new
enum label cannot be used in the transaction that added it) because
`class_members.member_role` is typed `user_role`. `profiles.role` and
`roster_entries.intended_role` share the type and therefore also accept
`TA`; only `roster_entries.intended_role = 'TA'` is load-bearing, as the
pre-authorisation for someone who has never signed in.

### Helpers

- `is_ta_of_class(p_class_id uuid) returns boolean` — an ACTIVE
  `class_members` row with `member_role = 'TA'` for the caller and this
  class. Same rules as the 0008 helpers: `security definer`, `stable`,
  `set search_path = public`, schema-qualified.
- `can_manage_class_content(p_class_id uuid) returns boolean` —
  `is_professor_of_class(...) OR is_ta_of_class(...)`. **Every** policy and
  RPC where a TA has professor-equivalent authority calls this and never
  spells the OR out inline, so the two authorisation paths cannot drift.
- `is_ta_of_person(p_person_id uuid) returns boolean` — the TA counterpart
  of `is_professor_of_student`, backing `profiles_ta_class_members_select`.

### What a TA may do

Policies switched from `is_professor_of_class` to
`can_manage_class_content` (and renamed `*_professor_*` → `*_staff_*`,
because a policy named for professors that admits TAs misleads whoever
reads `pg_policies` next):

| Table | Policy |
| --- | --- |
| assignments | `assignments_staff_manage` (was `assignments_professor_manage`) |
| questions | `questions_staff_manage` (was `questions_professor_manage`) |
| assignment_attempts | `attempts_staff_select` (was `attempts_professor_select`) |
| responses | `responses_staff_select` (was `responses_professor_select`) |
| saved_queries | `saved_queries_owner` (class branch only) |
| saved_visualisations | `saved_visualisations_owner` (class branch only) |
| dashboards | `dashboards_owner` (class branch only) |

Policies ADDED for TAs, leaving the professor's own policy untouched
(these carry a `class_id is null` branch, or a role predicate, that is not
a TA's to have):

| Table | Policy | Scope |
| --- | --- | --- |
| classes | `classes_ta_update` | UPDATE only; reads already come via `classes_member_select` |
| class_members | `class_members_ta_manage_students` | rows with `member_role = 'STUDENT'` only, USING **and** WITH CHECK |
| roster_entries | `roster_entries_ta_manage_students` | `class_id is not null` and `intended_role = 'STUDENT'`, both sides |
| profiles | `profiles_ta_class_members_select` | SELECT only, via `is_ta_of_person` |
| imports | `imports_ta` | `class_id is not null` |
| import_rows | `import_rows_ta` | through a class-scoped `imports` row |

RPCs switched to `can_manage_class_content`: `commit_roster_import`,
`check_roster_emails`, `set_student_active`, `commit_assignment_import`,
`record_failed_assignment_import`, `duplicate_assignment`,
`reopen_attempt`, `reopen_assignment_attempts`,
`assignment_deletion_counts`, `unarchive_assignment`,
`delete_assignment_permanently`.

`set_student_active` is narrowed further than the others: a TA may flip
`is_active` only for a member whose `member_role` is `STUDENT`. That column
is global, and without the extra check two TAs of one class could switch
each other off — managing another TA by a different door.

### The two things a TA may NOT do, and where each is enforced

1. **The class itself.** `class_deletion_counts` and
   `delete_class_permanently` (migration 0025) keep their
   `is_professor_of_class` gate unchanged. Archive/restore is not an RPC —
   it is a plain UPDATE of `classes.status` — so it is enforced by the
   `classes_status_authority` BEFORE UPDATE trigger, which raises unless
   `is_professor_of_class(old.id) or is_admin()`. The same trigger guards
   `professor_id`. It enforces only for the `authenticated` role;
   `service_role` and the migration role are server-side paths that already
   bypass RLS, and `anon` has no write privilege on `classes`.
   Assignment-level archive/unarchive/delete is deliberately NOT restricted.
2. **Other TAs.** `class_members_ta_manage_students` and
   `roster_entries_ta_manage_students` are predicated on the row's role
   being `STUDENT` in both USING and WITH CHECK, so a TA cannot insert,
   promote, demote or delete a TA row by any route. Adding and removing TAs
   goes through `add_class_ta` / `remove_class_ta`, which are
   professor-or-admin only.

Proven end to end in `tests/integration/ta-scope.test.ts` (45 tests): a TA
of class X matches its professor except on those two, has zero elevated
access to class Y, and the STUDENT role is unchanged in every direction.

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
  transaction. Since 0023 the copy takes its OWN sequence number
  (`next_assignment_sequence_number`) and its question codes are
  re-prefixed to match; copying the source's number verbatim, as it did
  before, could not succeed at all once 0018 existed.
- `next_assignment_sequence_number(p_class_id)` — `stable`; a free
  sequence number ≥ 3 for a non-paired assignment. Never 1 or 2, never a
  number a sibling holds (ARCHIVED included — its question codes still
  exist).
- `log_audit_event(p_action, p_entity_type, p_entity_id, p_metadata)` —
  `security definer`; the only write path into `audit_logs` (which has no
  INSERT policy). Actor is always `auth.uid()`; execute revoked from anon.

Migration 0010 (Phase 5) adds the student-attempt RPCs. Since migration
0024 all of them are `security definer` with `search_path = public` —
students have no direct write privilege on `assignment_attempts` or
`responses`, so these functions are the only writers, and the ownership
check each one already made (`student_id = auth.uid()`, class membership)
is what authorises the write. EXECUTE is revoked from anon on all of them:

- `get_or_create_attempt(p_assignment_id)` — idempotent entry point;
  requires the caller a class member and the assignment answerable (see
  `attempt_is_workable` below); creates the NOT_STARTED row on first call,
  returns the existing one after. A row is only ever created while
  `assignment_accepts_answers` is true — i.e. inside the schedule window
  (0029), where it used to mean "while the status is OPEN". Refusals name
  the date ("this assignment is not open yet — it opens at …") rather than
  the status.
- `save_attempt_responses(p_attempt_id, p_answers)` — batched autosave.
  Upserts on (attempt_id, question_id) so retried batches converge;
  validates each value against {0, 1, null} and each question against the
  attempt's assignment; rejects saves unless the attempt is
  NOT_STARTED/DRAFT/REOPENED and `attempt_is_workable`; moves state to
  DRAFT. One transaction — a bad answer aborts the whole batch.
- `submit_attempt(p_attempt_id)` — final submission. Locks the attempt row
  (`for update`), so concurrent/double submits serialize; an
  already-submitted attempt gets a clear "already submitted" error and no
  second submission. Marks responses is_final + stamps version. Clears
  `reopened_at` (0024) — the reopen grant is spent by the resubmission;
  `reopened_by` stays, as the record of who granted it. Only ever invoked
  from the student's explicit confirm button — no automatic trigger exists
  anywhere (EXCLUDED_FEATURES.md).
- `reopen_attempt(p_attempt_id, p_assignment_id)` — professor-only,
  `security definer`. SUBMITTED → REOPENED with reopened_at/reopened_by;
  clears responses.is_final; audit-logged. RESUBMITTED is terminal and
  cannot be reopened. Since 0023 it refuses an assignment the student could
  never act on, rather than minting an unusable REOPENED attempt; since
  0029 that test is `assignment_has_opened(status, open_at)` instead of
  `status in ('OPEN','CLOSED')`, because a scheduled assignment sits at
  READY and reopening one student after the window shuts is the whole point
  of this RPC. Since 0024 the assignment id is a required second argument and
  must match the attempt's own: it affects exactly one (assignment,
  student) pair, and the caller has to say which assignment it believed it
  was acting on. The single-argument form was dropped.
- `reopen_assignment_attempts(p_assignment_id)` (0024) — professor-only,
  `security definer`; the bulk counterpart. Reopens every SUBMITTED attempt
  on THIS assignment and no attempt on any other; leaves NOT_STARTED/DRAFT/
  REOPENED/RESUBMITTED attempts and the assignment's own status untouched
  (it is not CLOSED → OPEN); one ATTEMPT_REOPENED audit event per attempt
  plus one ASSIGNMENT_ATTEMPTS_REOPENED summary; returns the count.
- `assignment_accepts_answers(status, open_at, close_at)` (0029,
  `stable`) — may the CLASS answer this right now? See "Scheduling" under
  `assignments` for the full rule. Mirrored by `assignmentAcceptsAnswers`
  in `lib/assignments/schedule.ts`.
- `assignment_has_opened(status, open_at)` (0029, `stable`) — has this ever
  been in front of students? Gates `questions_student_select` and both
  reopen RPCs.
- `attempt_is_workable(status, open_at, close_at, state, reopened_at)`
  (0023, rewritten in 0029, `stable`) — the single definition of "may this
  student still write to this attempt": true while
  `assignment_accepts_answers`, and for an individually reopened attempt
  (`reopened_at is not null`, state REOPENED or DRAFT) on an assignment
  that has opened but is no longer accepting answers, until they submit
  again. DRAFT is inside the allowance because the first autosave moves
  REOPENED → DRAFT. The pre-0029 three-argument form was dropped, not kept
  alongside: its whole answer was "status = OPEN". Mirrored for the UI by
  `canAnswerAssignment` in `lib/attempts/workable.ts`; the SQL is the
  boundary.
  Note that `save_attempt_responses`/`submit_attempt` check the synthetic
  seeding exception (0020) FIRST — a synthetic attempt bypasses this
  predicate entirely and writes into a published assignment whatever its
  status, without the assignment ever being reopened.

Migration 0025 adds unarchive and permanent deletion. All five are
`security definer`; the first two exist because a professor has no DELETE
policy over other students' response rows and should not be given one, and
because the cascade would otherwise be blocked by
`questions_immutable_after_responses`. Since migration 0028 the three
ASSIGNMENT-level ones (`assignment_deletion_counts`,
`unarchive_assignment`, `delete_assignment_permanently`) gate on
`can_manage_class_content`, so a TA can use them; the two CLASS-level ones
(`class_deletion_counts`, `delete_class_permanently`) deliberately keep
`is_professor_of_class`:

- `assignment_deletion_counts(p_assignment_id)` /
  `class_deletion_counts(p_class_id)` — `stable`; the census of what a
  delete would destroy (questions, responses, attempts, students, imports;
  the class version adds assignments, roster entries and saved views).
  Feeds both the confirmation dialog and the audit entry, so the number
  shown and the number recorded cannot disagree. **Returns NULL for "no
  such row, or not your class"** — callers must treat NULL as an access
  error, never as an empty census.
- `unarchive_assignment(p_assignment_id)` — ARCHIVED → CLOSED only.
  Disables and re-enables `assignments_status_transition` inside the one
  transaction. Refuses if another non-archived assignment has meanwhile
  taken this one's `sequence_number` (the 0018 index is partial on
  `status <> 'ARCHIVED'`, so an archived assignment does not hold its
  slot). Audit action `ASSIGNMENT_UNARCHIVED`.
- `delete_assignment_permanently(p_assignment_id)` — irreversible; deletes
  the assignment row and lets the existing `on delete cascade` FKs take
  questions, attempts, responses, question_options and import history with
  it. Disables and re-enables `questions_immutable_after_responses` around
  the delete. **Deliberately not gated on status or response count**: the
  case it exists for is a wrong spreadsheet imported against a live class.
  Audit action `ASSIGNMENT_DELETED_PERMANENTLY`.
- `delete_class_permanently(p_class_id)` — the same, one level up: the
  class row cascades to every assignment (and everything under each),
  class_members, roster_entries, saved_queries, saved_visualisations and
  dashboards. `profiles` rows are NOT touched — deleting a class deletes
  its record of a student, not the student's account. Audit action
  `CLASS_DELETED_PERMANENTLY`. Professor-only: this is exclusion 1 of the
  TA model, and the reason it did not move to `can_manage_class_content`.

Migration 0028 adds the two TA-management RPCs. Both are `security definer`
solely because adding a TA by email needs a `profiles` lookup across the
whole table, which a professor's own RLS cannot do for a person who is not
yet in their class; neither returns any profile field beyond the id it acts
on, so neither can be used to browse accounts. Both refuse anyone who is
not the class's professor or an admin:

- `add_class_ta(p_class_id, p_email, p_full_name)` — writes
  `class_members.member_role = 'TA'` when the email already has an account
  anywhere, or a pending `roster_entries` row with `intended_role = 'TA'`
  when it does not. Never modifies an existing account's `profiles.role`.
  Refuses an email already pending on another class's roster (the same rule
  the roster import's `DUPLICATE_PENDING_OTHER_CLASS` encodes). Returns
  `{mode: 'ENROLLED' | 'PREAUTHORISED', email, userId}`. Audit actions
  `CLASS_TA_ADDED` / `CLASS_TA_PREAUTHORISED`.
- `remove_class_ta(p_class_id, p_email)` — deletes the TA's
  `class_members` row and/or their pending `roster_entries` row for this
  class, and raises if they were neither. The membership goes entirely
  rather than being demoted to STUDENT: a TA was never enrolled as a
  student here, and quietly making them one would put them in the roster
  and in the analytics denominators. Audit action `CLASS_TA_REMOVED`.

Both delete functions take the census and write the `audit_logs` entry
**before** the DELETE, inside the same transaction. `audit_logs` has no FK
to either entity, so the record survives the thing it describes; taken
afterwards it would have nothing left to count.

`alter table ... disable trigger` inside these functions is safe because
it takes an ACCESS EXCLUSIVE lock and is transactional: no other session
can write the table while the boundary is down, and a failure rolls the
trigger back on along with the rows. The functions must stay owned by the
owner of `public.questions` / `public.assignments`, or the ALTER is
refused. Migration 0019 set the precedent.

Migration 0011's mapping-studio RPCs (`validate_mapping_questions`,
`create_question_mapping`, `update_question_mapping`,
`set_mapping_approval`, `create_mapping_version`, `preview_mapping_pairs`,
`mapping_has_dependents`) were dropped in migration 0022 together with the
tables they wrote to.

## Views (migration 0009)

- `assignment_submission_progress` (`security_invoker = on`) — per
  assignment: enrolled_students plus counts by attempt state
  (not_started/draft/submitted/reopened/resubmitted), aggregated over
  active STUDENT `class_members` left-joined to `assignment_attempts`.
  The querying user's own RLS applies; explicit SELECT grants to
  authenticated/service_role.

## Removed analytics views (migration 0022)

Dropped with the mapping tables above, because each read
`approved_question_mappings` or `response_transitions_live`:
`approved_question_mappings`, `approved_question_mapping_members`,
`response_transitions_live`, `mapping_transition_summary`,
`class_transition_summary`, `student_transition_summary`,
`energy_source_transition_summary`, `criterion_transition_summary`,
`mapping_association_exploratory`.

Everything single-assignment survived untouched — see the next section.

## Analytics views (migration 0012) — Phase 7

**DECISION: every aggregate is COMPUTED ON READ** (plain views), not
written by a recompute job. Why:

- responses keep arriving while assignments are OPEN, so any snapshot
  taken at write time is stale by the next student submission;
- the data volumes here (tens of students × hundreds of questions) make
  on-read aggregation cheap.

**Consequence for Phase 8: data from these views is ALWAYS fresh. There
is no refresh trigger, no staleness window, and no cache-invalidation
concern — charts can query on every render.** If profiling ever shows
these views are too slow, convert them to materialised views + a refresh
step — but that changes this contract and must be re-documented here.

All views are `security_invoker = on` with explicit SELECT grants to
authenticated/service_role. Formulas are docs/ANALYTICS_DEFINITIONS.md
verbatim; rates are NULL (never 0) when there is no valid data. TS access
goes through `lib/analytics/queries.ts`.

- Response-distribution aggregates (consensus / disagreement / entropy
  over final responses of active members):
  `question_response_summary`, `assignment_response_summary` (per-question
  averages + distinct respondents), `energy_source_response_summary` and
  `criterion_response_summary` (pooled per group within an assignment).
  `question_response_summary` also carries `question_text` verbatim
  (**migration 0021**) so charts, the query builder and the Excel export can
  name a question instead of printing `external_question_code`. It is the
  view's LAST column: `create or replace view` may only append, so 0021
  replaced the old `i.*` expansion with an explicit column list to keep
  positions 1–15 byte-identical to migration 0012. No metric changed —
  `questions` is already the driving table of the inner aggregate, so this
  is one more attribute on a GROUP BY of the question's own primary key.
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
  assignment).

## Synthetic demo data (migration 0017)

`is_synthetic boolean not null default false` on **profiles**,
**class_members**, **assignment_attempts** and **responses**. True only for
a fictional seeded cohort; every pre-existing row is real by default, which
is the safe direction — this migration can never reclassify a real row as
demo data.

`classes`, `assignments` and `questions` deliberately carry no such flag: a
seeded cohort reuses the already-imported assignments and creates or alters
none of them.

**The seeded 150-student cohort was deleted in migration 0022** along with
the demo dashboard it existed to populate. The COLUMN, its indexes, the
`enforce_synthetic_flag_authority` triggers (migration 0020) and
`class_synthetic_census` all remain: `is_synthetic` gates the
closed-assignment seeding exception in `save_attempt_responses` /
`submit_attempt`, so it is a protected security boundary, not demo
scaffolding.

A replacement cohort is generated by `scripts/seed-demo-responses.ts`
(`npm run db:seed:demo-responses`, `--clean` to remove it). It answers both
assignments through `commitCsvSubmission` — the real CSV path — and depends
on nothing that migration 0022 removed: each assignment is answered
independently, and no student's A1 answer informs their A2 answer.

Synthetic rows obey every real constraint — the `response_value` CHECK, the
`(attempt_id, question_id)` unique constraint, and the
`attempts_state_transition` FSM all apply unchanged.

No new tables, so no new RLS policies: these are columns on tables that
already carry student-data policies.

Two views ship with it, both `security_invoker = on` with explicit grants,
same computed-on-read contract as the 0012 views:

- `class_synthetic_census` — per class, active student count split into
  synthetic and non-synthetic. Lets any surface state the mixture honestly
  rather than describing a partly-real class as a demo.
- `energy_source_assignment_change` — per energy source, Assignment 1 vs
  Assignment 2 totals with absolute and relative change plus percentage-
  point shift. Built on top of `energy_source_response_summary` (it does
  not recompute the per-assignment counts). Joins the two sides on
  `btrim(energy_source)` because labels are stored verbatim and A2's sheet
  writes `"Solar "` where A1 writes `"Solar"`; both raw labels are carried
  through in `a1_energy_source_raw` / `a2_energy_source_raw`. Relative
  change is NULL on a zero A1 baseline or a one-sided energy source, never
  0 and never a divide-by-zero — see docs/ANALYTICS_DEFINITIONS.md
  "Group count change".

TS access for both is in `lib/analytics/queries.ts`, like every other view.

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
