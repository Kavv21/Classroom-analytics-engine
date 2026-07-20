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

## class_members
id, class_id, user_id, member_role, status, joined_at

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
their own class data.

Admins: system-level management per explicit policies (not blanket access).
