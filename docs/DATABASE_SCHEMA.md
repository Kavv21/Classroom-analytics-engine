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

## questions
id, assignment_id, external_question_code, original_worksheet,
original_row_reference, original_column_reference, question_text,
energy_source, criterion, concept, response_zero_label, response_one_label,
display_order, is_active, raw_source_payload, created_at, updated_at

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

## responses
id, attempt_id, assignment_id, student_id, question_id, response_value,
is_final, first_saved_at, last_saved_at, submitted_at, version, created_at,
updated_at

```sql
CHECK (response_value IN (0, 1) OR response_value IS NULL)
```
Unique constraint on (attempt_id, question_id) — no duplicate responses.

## question_mappings
id, assignment_1_question_ids[], assignment_2_question_ids[], mapping_name,
common_concept, energy_source, criterion, mapping_type, comparison_method,
professor_notes, mapping_status, professor_approved, created_at, updated_at

Mapping types: EXACT_ONE_TO_ONE, CONCEPTUAL_ONE_TO_ONE, ONE_TO_MANY,
MANY_TO_ONE, GROUPED_CONCEPT, NOT_COMPARABLE, UNMAPPED

## question_mapping_members
Junction table supporting one-to-many / many-to-one:
id, mapping_id, assignment_id, question_id, mapping_side, weight, created_at

## response_transitions
id, class_id, student_id, mapping_id, assignment_1_value,
assignment_2_value, transition_state, data_quality_status, calculated_at

transition_state: S00, S01, S10, S11 (only when both values are binary)
data_quality_status: MISSING_A1, MISSING_A2, MISSING_BOTH, NOT_COMPARABLE

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
0005) is the policy backing "read own students" — scoped to profiles that
are a `class_members` row in one of that professor's classes; it grants
read only, never write.

Admins: system-level management per explicit policies (not blanket access).

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
