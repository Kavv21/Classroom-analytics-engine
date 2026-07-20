# Master Spec (reference)

This is the complete original build prompt, kept verbatim so no phase file
or agent works from a paraphrased summary. Phase files in this folder cite
"Section N" meaning a section below.

---

# CLAUDE CODE MASTER BUILD PROMPT

## Classroom Binary Opinion Analytics Platform

You are Claude Code operating as a senior full-stack architect, database engineer, analytics engineer, UI/UX engineer, QA engineer, and deployment engineer.

Build a complete, production-ready web application called:

# Classroom Opinion Analytics Platform

Do not merely create a prototype, mock-up, design document, or partially implemented scaffold. Build, integrate, test, debug, document, and prepare the complete application for deployment.

The platform will collect binary student opinions through two assignments and visualise how responses differ between Assignment 1 and Assignment 2.

There are:

* no correct answers
* no answer keys
* no grades
* no marks
* no pass/fail judgement
* no automated declaration that a student "learnt"
* no online teaching videos
* no webcam proctoring
* no screen recording
* no tab-switch monitoring
* no fullscreen enforcement
* no browser-focus monitoring
* no anti-cheat violation detection
* no automatic submission caused by leaving the page
* no controlled assignment session

The professor teaches students separately in the physical classroom. The website is used only to collect and analyse student opinions.

---

# 1. NON-NEGOTIABLE EXECUTION REQUIREMENTS

You must:

1. Inspect the complete repository before changing anything.
2. Preserve working functionality where appropriate.
3. Build the complete system end to end.
4. Use strict TypeScript.
5. Use proper database migrations.
6. Add secure authentication and role-based permissions.
7. Add input validation on both frontend and backend.
8. Add meaningful error handling.
9. Add audit logging for important administrative actions.
10. Add automated tests for critical workflows.
11. Add seed data and demo accounts.
12. Add clear installation and deployment documentation.
13. Run linting, type checking, tests, and production build.
14. Fix all errors before declaring completion.
15. Do not leave placeholder buttons or fake analytics.
16. Do not silently omit any requirement.
17. Do not invent missing questions or spreadsheet content.
18. Preserve the exact spelling and wording of questions imported from the source spreadsheets.
19. Make the interface suitable for approximately 250-300 students.
20. Load test the submission workflow with at least 400 simulated students.

---

# 2. REQUIRED TECHNOLOGY STACK

Use the following stack unless the existing repository already contains a clearly superior compatible implementation.

## Frontend

* Next.js using the App Router
* TypeScript
* Tailwind CSS
* accessible reusable component system
* TanStack Table
* Apache ECharts
* React Hook Form
* Zod
* responsive desktop and tablet interface

## Backend and Database

* Supabase
* PostgreSQL
* Supabase Authentication
* Row-Level Security
* Next.js server actions or secure API route handlers
* PostgreSQL views and materialised views where appropriate

## Testing

* Vitest or Jest for unit testing
* React Testing Library
* Playwright for end-to-end testing
* k6 for load testing

## Deployment

* Vercel
* Supabase Pro-compatible configuration
* environment-variable-based secrets
* production-safe database migrations

Do not hardcode credentials.

---

# 3. APPLICATION PURPOSE

The platform must allow a professor to:

1. Create a class.
2. Import or register students.
3. Create Assignment 1.
4. Import the exact Assignment 1 questions.
5. Publish Assignment 1.
6. Collect student responses consisting only of `0` or `1`.
7. Close Assignment 1.
8. Teach the subject outside the platform.
9. Create Assignment 2.
10. Import the exact Assignment 2 questions.
11. Publish Assignment 2.
12. Collect student responses consisting only of `0` or `1`.
13. Map relevant Assignment 1 questions or concepts to Assignment 2 questions or concepts.
14. Compare paired student responses.
15. Generate fixed response transition states.
16. Analyse class-level, question-level, concept-level and student-level patterns.
17. Build interactive visualisations.
18. Export the raw and processed data.

The application must objectively describe opinion patterns. It must not interpret one binary value as inherently better than the other.

---

# 4. SOURCE ASSIGNMENT FILES AND EXACT QUESTION EXTRACTION

The project input folder will contain the two original assignment spreadsheets.

Use a folder such as:

```text
/source-assignments/
    assignment-1.xlsx
    assignment-2.xlsx
```

Search the repository if they are stored elsewhere.

Before building the assignment seed data:

1. Open both spreadsheets programmatically.
2. Inspect all worksheets.
3. Detect merged cells and multi-row headers.
4. Preserve the original worksheet names.
5. Extract every energy source.
6. Extract every criterion.
7. Extract every question or binary response field.
8. Preserve the exact original sequence.
9. Preserve the exact original wording.
10. Preserve punctuation, capitalisation and labels.
11. Do not paraphrase or shorten anything.
12. Generate a machine-readable manifest.
13. Generate a human-readable question appendix.
14. Fail loudly if a row or column cannot be interpreted.
15. Do not create guessed mappings.

Create:

```text
/data/assignment-1-manifest.json
/data/assignment-2-manifest.json
/data/question-mapping-template.json
/docs/ASSIGNMENT_QUESTION_APPENDIX.md
```

The appendix must contain the complete content of both assignments.

Its structure must be:

```text
# Assignment 1 - Complete Question Set

## Source worksheet: [worksheet name]

### Question A1-001
- Original row/column reference:
- Energy source:
- Criterion/category:
- Exact displayed question:
- Response 0 label:
- Response 1 label:

### Question A1-002
...

# Assignment 2 - Complete Question Set

## Source worksheet: [worksheet name]

### Question A2-001
- Original row/column reference:
- Energy source:
- Criterion/category:
- Exact displayed question:
- Response 0 label:
- Response 1 label:

### Question A2-002
...
```

The generated appendix must contain every question from both assignments, not examples.

Also display the complete imported question list inside the professor interface before publication.

The professor must be required to approve the import.

---

# 5. EXPECTED ASSIGNMENT STRUCTURE

The preliminary understanding is:

## Assignment 1

Assignment 1 concerns energy-source classification and contains binary fields associated with energy sources, including concepts such as:

* conventional
* renewable over the relevant future period

Do not rely on this summary as the source of truth. Extract the exact content from the original spreadsheet.

## Assignment 2

Assignment 2 contains a broader matrix of energy sources and binary criteria.

Do not assume the exact number of sources or criteria. Extract the complete source data from the original spreadsheet.

The spreadsheet is authoritative.

---

# 6. FULL QUESTION-MAPPING SYSTEM

Assignment 1 and Assignment 2 are structurally different. The application must therefore include a first-class mapping module.

Do not assume that every Assignment 1 question has one direct Assignment 2 equivalent.

Support:

* exact question mapping
* concept-level mapping
* one-to-one mapping
* one-to-many mapping
* many-to-one mapping
* grouped concept mapping
* unmapped question
* non-comparable question

## 6.1 Mapping record fields

Each mapping must contain:

```text
id
assignment_1_question_ids[]
assignment_2_question_ids[]
mapping_name
common_concept
energy_source
criterion
mapping_type
comparison_method
professor_notes
mapping_status
professor_approved
created_at
updated_at
```

## 6.2 Mapping types

```text
EXACT_ONE_TO_ONE
CONCEPTUAL_ONE_TO_ONE
ONE_TO_MANY
MANY_TO_ONE
GROUPED_CONCEPT
NOT_COMPARABLE
UNMAPPED
```

## 6.3 Mapping workflow

The professor must be able to:

1. Open a split-screen mapping interface.
2. See every Assignment 1 question on the left.
3. See every Assignment 2 question on the right.
4. Search by wording, energy source, concept or criterion.
5. Select one or more questions from either assignment.
6. Assign a common concept.
7. Select the mapping type.
8. Add a note explaining the mapping.
9. preview how the mapping affects analytics.
10. Approve or reject the mapping.
11. revise mappings later.
12. export the complete mapping table.

No mapped comparison may appear in production analytics until the professor approves the mapping.

## 6.4 Mapping suggestions

The system may generate deterministic mapping suggestions using:

* exact normalised text match
* energy-source match
* criterion match
* keyword overlap
* configurable string similarity

These are suggestions only.

Do not use a paid LLM.

Never automatically approve a mapping.

---

# 7. USER ROLES

Support:

```text
ADMIN
PROFESSOR
STUDENT
```

## Administrator

Can:

* manage professor accounts
* manage system configuration
* access audit logs
* manage classes where necessary
* deactivate users
* inspect failed imports and system errors

## Professor

Can:

* create classes
* add students
* import student rosters
* create and publish assignments
* import assignment spreadsheets
* review every imported question
* configure 0 and 1 labels
* open and close assignments
* map questions
* view analytics
* save visualisations
* export data
* reopen a submitted attempt where required

## Student

Can:

* log in
* view available assignments
* answer with 0 or 1
* save a draft
* submit
* view submission status

Students must not see other students' responses or professor-only analytics.

---

# 8. CLASS MANAGEMENT

Implement:

* class creation
* class editing
* class archiving
* course name
* academic year
* semester
* section
* class code
* start date
* end date
* professor ownership
* student enrolment
* CSV and Excel roster import
* duplicate detection
* student activation and deactivation

Student fields:

```text
student_id
roll_number
name
email
programme
year_of_study
section
status
```

Support bulk import with:

* preview
* validation
* duplicate warnings
* rejected-row report
* final import summary

---

# 9. ASSIGNMENT MANAGEMENT

Each assignment must contain:

```text
id
class_id
title
description
instructions
assignment_stage
sequence_number
open_at
close_at
status
allow_draft_editing
allow_resubmission
response_zero_label
response_one_label
created_by
created_at
updated_at
```

Assignment stages:

```text
PRE_INSTRUCTION
POST_INSTRUCTION
FOLLOW_UP
OTHER
```

Assignment statuses:

```text
DRAFT
READY
OPEN
CLOSED
ARCHIVED
```

Professor capabilities:

* create manually
* import from spreadsheet
* preview questions
* reorder questions
* edit display labels
* publish assignment
* close assignment
* duplicate assignment
* archive assignment
* inspect submission progress

Do not include any controlled-session, anti-cheat or browser-monitoring settings.

---

# 10. NORMAL ASSIGNMENT ATTEMPT WORKFLOW

There is no anti-cheat state machine.

Use the following straightforward attempt states:

```text
NOT_STARTED
DRAFT
SUBMITTED
REOPENED
RESUBMITTED
```

Valid transitions:

```text
NOT_STARTED -> DRAFT
NOT_STARTED -> SUBMITTED

DRAFT -> DRAFT
DRAFT -> SUBMITTED

SUBMITTED -> REOPENED

REOPENED -> DRAFT
REOPENED -> RESUBMITTED
```

The backend must reject invalid transitions.

A student may navigate away and return while the assignment remains open. Their saved draft must be restored.

There must be no automatic submission due to:

* tab switching
* minimising the browser
* changing browser windows
* refreshing the page
* leaving fullscreen
* leaving the page
* temporary disconnection

---

# 11. RESPONSE COLLECTION

Every question must accept only:

```text
0
1
NULL
```

Where `NULL` means unanswered.

The interface must clearly display what 0 and 1 mean.

Use:

* large binary selection controls
* clear question numbering
* current progress
* answered count
* unanswered count
* save status
* previous and next navigation
* review page before submission
* explicit final confirmation
* submission receipt

## Draft saving

Implement:

```text
UI state
-> local browser persistence
-> debounced server autosave
-> final server submission
```

Requirements:

* do not send a write request on every click
* debounce autosave
* recover drafts after refresh
* show `Saving`, `Saved`, or `Save failed`
* queue unsynchronised changes
* retry failed saves
* use idempotent update operations
* prevent duplicate final submissions
* protect final submission with a database transaction

---

# 12. RESPONSE TRANSITION FINITE STATE MACHINE

For every professor-approved comparable paired response, generate one of four fixed states:

```text
S00 = 0 -> 0
S01 = 0 -> 1
S10 = 1 -> 0
S11 = 1 -> 1
```

For missing data, use a separate data-quality status rather than treating it as a binary transition:

```text
MISSING_A1
MISSING_A2
MISSING_BOTH
NOT_COMPARABLE
```

For student `i` and mapping `j`:

```text
T(i,j) = (A1(i,j), A2(i,j))
```

where both responses must be binary for `S00-S11`.

## Required metrics

### Changed count

```text
S01 + S10
```

### Unchanged count

```text
S00 + S11
```

### Change rate

```text
(S01 + S10) / valid paired responses
```

### Stability rate

```text
(S00 + S11) / valid paired responses
```

### Net movement toward 1

```text
S01 - S10
```

### Percentage-point shift

```text
Percentage selecting 1 in Assignment 2
-
Percentage selecting 1 in Assignment 1
```

Do not confuse change rate with net shift.

Example:

```text
S01 = 30%
S10 = 27%

Change rate = 57%
Net shift = +3 percentage points
```

---

# 13. DATABASE SCHEMA

See /docs/DATABASE_SCHEMA.md for the full extracted table list — kept in
sync with this section, updated as reality diverges.

---

# 14. ROW-LEVEL SECURITY

See /docs/DATABASE_SCHEMA.md "Row-Level Security" section.

---

# 15. ANALYTICS ENGINE

Build analytics at the following levels:

## Class level

* enrolled students
* Assignment 1 submission count
* Assignment 2 submission count
* submission rates
* paired-student count
* overall percentage selecting 0
* overall percentage selecting 1
* overall change rate
* overall stability rate
* overall net shift
* missing-response rate

## Assignment level

* response distributions
* question completion
* unanswered rates
* energy-source summaries
* criterion summaries
* section comparison

## Question level

* response count
* unanswered count
* percentage selecting 0
* percentage selecting 1
* S00 count
* S01 count
* S10 count
* S11 count
* change rate
* stability rate
* net shift
* consensus
* disagreement
* valid paired count

## Student level

* responses completed
* unanswered questions
* S00 count
* S01 count
* S10 count
* S11 count
* total changed
* total unchanged
* individual change rate
* submission timestamps

These are descriptive statistics, not marks.

## Energy-source level

* percentage selecting 0 and 1
* distribution by criterion
* change rate
* stability rate
* net shift
* consensus
* disagreement

## Criterion level

* distribution across energy sources
* change rate
* consensus
* disagreement
* class-section comparisons

---

# 16. CONSENSUS AND DISAGREEMENT

See /docs/ANALYTICS_DEFINITIONS.md.

---

# 17. REQUIRED VISUALISATIONS

Use Apache ECharts for the main visualisation system. Implement all of the
following (see original spec sections 17.1-17.14 for full detail):

17.1 Assignment response distribution (filterable by question, energy
source, criterion, section)
17.2 Before-versus-after grouped bar chart (percentage selecting 1/0,
consensus, disagreement, for approved mappings)
17.3 Four-state transition matrix (2x2: S00/S01/S10/S11, count and
percentage modes)
17.4 100% stacked transition chart (one bar per question/mapping)
17.5 Sankey diagram (A1:0/1 -> A2:0/1 for a selected mapping)
17.6 Assignment response heatmaps (students x questions, values 0/1/unanswered)
- one per assignment
17.7 Transition heatmap (students x approved mappings, values S00/S01/S10/S11/Missing)
17.8 Energy-source x criterion heatmap (selectable measure: %1, %0, change
rate, net shift, consensus, disagreement)
17.9 Opinion-shift ranking (horizontal ranked bar, percentage-point shift,
positive/negative clearly shown)
17.10 Change-rate ranking ((S01+S10)/valid paired responses)
17.11 Consensus ranking (highest/lowest consensus, largest increase/decrease)
17.12 Student change distribution (histogram of % answers changed per student)
17.13 Submission status dashboard (Not started/Draft/Submitted/Reopened/Resubmitted)
17.14 Completion timeline (submission activity over time; no anti-cheat timelines)

---

# 18. ADVANCED ANALYTICS

Implement these only after all core functionality is stable and tested:

* student similarity using Jaccard similarity
* Hamming distance
* hierarchical clustering
* clustered heatmap
* question-association matrix
* Phi coefficient
* mutual information
* PCA exploratory projection
* UMAP exploratory projection
* network graph
* alluvial or parallel-set diagram

Do not treat cluster membership or dimensionality-reduction position as a grade.

Clearly label these as exploratory views.

---

# 19. PROFESSOR DASHBOARD

Pages: Overview, Assignment Analytics, Mapping Studio, Transition
Analytics, Student Analytics, Visualisation Builder. See original section
19 for the exact contents of each page.

---

# 20. VISUAL QUERY BUILDER

Datasets: Assignment 1 responses, Assignment 2 responses, Paired
transitions, Assignment attempts, Submission records.

Measures: Response count, % selecting 0, % selecting 1, Unanswered count,
Change rate, Stability rate, Net shift, Consensus, Disagreement, S00/S01/
S10/S11 counts, Submission count.

Group by: Assignment, Question, Energy source, Criterion, Concept, Student,
Section, Mapping, Transition state, Submission state.

Filters: Class, Assignment, Question, Energy source, Criterion, Concept,
Section, Student, Transition state, Submission state, Date.

Chart types: Table, Bar, Grouped bar, Stacked bar, 100% stacked bar, Line,
Pie, Heatmap, Transition matrix, Sankey, Histogram, Scatter.

Validate chart compatibility. Do not allow meaningless combinations.

---

# 21. INTERACTIVE DRILL-DOWN

Charts must support hover tooltips, click-to-filter, sorting, search,
pagination, zoom where appropriate, reset filters, data-table view, export.

Example drill-down: Energy source -> criterion -> mapped question ->
transition matrix -> selected transition -> corresponding students ->
individual student profile. Provide breadcrumbs and a clear reset action.

---

# 22. EXPORTS

Formats: CSV, Excel, PNG, SVG, PDF dashboard report.

Excel workbook sheets: Students, Assignment 1 Questions, Assignment 2
Questions, Assignment 1 Responses, Assignment 2 Responses, Question
Mappings, Response Transitions, Question Analytics, Student Analytics,
Import Validation.

Every export must include: class name, assignment name, generation
timestamp, active filters, metric definitions, mapping version.

The professor must be able to export the complete original question wording.

---

# 23. IMPORT VALIDATION

File-type validation, file-size validation, worksheet selection, header
detection, merged-cell handling, blank-cell handling, duplicate detection,
preview, row-level errors, downloadable rejection report, import
transaction, rollback on critical failure, source-file checksum, import
history.

Never partially import silently.

---

# 24. DATA INTEGRITY

Foreign-key constraints, unique constraints, check constraints,
transactional final submission, idempotency keys, optimistic concurrency
where useful, versioning for reopened submissions, mapping versioning, soft
deletion for important academic records, UTC database timestamps,
timezone-aware UI display.

Once an assignment has responses, do not permit destructive question
editing. Use versioning or create a new assignment revision.

---

# 25. ACCESSIBILITY AND UX

Meet reasonable WCAG standards: keyboard navigation, clear focus
indicators, proper labels, sufficient contrast, screen-reader-compatible
controls, non-colour indicators in charts, accessible tables accompanying
complex visualisations, descriptive empty states, clear error messages,
loading and saving states.

Binary choices must display both the numeric value and its meaning, e.g.
"0 - No". Do not rely on colour alone.

---

# 26. PERFORMANCE

Optimise for 250-300 simultaneous students. Load test with at least 400
concurrent simulated students. Test: login, assignment loading, autosave,
final submission spike, dashboard aggregation, spreadsheet import, Excel
export.

Use: database indexes, efficient bulk writes, pagination, server-side
filtering, cached aggregate queries, PostgreSQL views, materialised views
where appropriate, background refresh after assignment closure if
supported.

Do not load the entire student-response dataset into the browser
unnecessarily.

---

# 27. TESTING

Unit tests: binary response validation, attempt state transitions,
transition-state generation, change-rate/stability/net-shift/consensus/
entropy calculation, mapping validation, spreadsheet parser, export
formatting.

Integration tests: class creation, roster import, assignment import,
question approval, assignment publication, draft saving, final submission,
attempt reopening, mapping approval, analytics generation, exports, RLS
access.

End-to-end tests: complete workflows for administrator, professor, student.

Load tests (k6): 400 logins, 400 assignment loads, autosave activity,
simultaneous final submissions, dashboard queries.

---

# 28. SEED AND DEMO DATA

One administrator, one professor, one class, at least 30 fictional
students, imported Assignment 1 questions, imported Assignment 2 questions,
approved sample mappings derived from the real files, realistic binary
responses, all four transition states, saved visualisations.

Use environment-variable-controlled demo credentials. Do not commit real
passwords.

---

# 29. DOCUMENTATION

Create: README.md, docs/ARCHITECTURE.md, docs/DATABASE_SCHEMA.md,
docs/ASSIGNMENT_QUESTION_APPENDIX.md, docs/QUESTION_MAPPING.md,
docs/ANALYTICS_DEFINITIONS.md, docs/SECURITY.md, docs/DEPLOYMENT.md,
docs/TESTING.md, docs/USER_GUIDE_PROFESSOR.md, docs/USER_GUIDE_STUDENT.md,
docs/IMPORT_FORMAT.md.

The question appendix must contain every extracted question from both
original assignments.

README must include: prerequisites, local setup, environment variables,
Supabase setup, migrations, seed command, development command, testing
commands, production build command, deployment procedure, troubleshooting.

---

# 30. REQUIRED DELIVERABLES

Working frontend; working backend; complete database migrations; Supabase
RLS policies; assignment spreadsheet parser; exact Assignment 1 manifest;
exact Assignment 2 manifest; full question appendix; mapping studio;
assignment interface; draft autosave; submission workflow; transition
engine; analytics engine; required visualisations; query builder; export
system; automated tests; load-test scripts; seed data; deployment
documentation; environment template; final build report.

---

# 31. EXPLICITLY EXCLUDED FUNCTIONALITY

See /docs/EXCLUDED_FEATURES.md.

Normal final submission and normal deadline closure are allowed.

---

# 32. BUILD ORDER

Phase 1 - Repository and source inspection
Phase 2 - Foundation (Next.js, Supabase, auth, roles, migrations, RLS)
Phase 3 - Class and roster management
Phase 4 - Assignment import and management
Phase 5 - Student response workflow
Phase 6 - Mapping studio
Phase 7 - Transition and analytics engine
Phase 8 - Visualisations
Phase 9 - Query builder and exports
Phase 10 - Testing and deployment

Each phase is broken out into its own file in /plan/.

---

# 33. FINAL VERIFICATION COMMANDS

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

Run database migration validation. Run spreadsheet extraction and verify:
every source row and question is represented, no duplicate IDs, no missing
wording, no invented wording, counts match the source spreadsheets. Run k6
load tests. Fix all errors.

---

# 34. FINAL COMPLETION REPORT

At completion, produce a report containing: what was built, repository
structure, exact number of Assignment 1/2 questions extracted, complete
list of source worksheets, mapping types implemented, database migrations
created, RLS policies created, visualisations completed, tests executed,
load-test results, build result, deployment steps, demo credentials
procedure, known limitations, any requirements that could not be completed.

Do not claim success unless the application builds and critical tests pass.

---

# 35. FINAL PRODUCT DEFINITION

Central data flow:

```text
Original Assignment 1 spreadsheet -> Exact Assignment 1 question manifest
Original Assignment 2 spreadsheet -> Exact Assignment 2 question manifest
Both complete question sets -> Professor-reviewed mapping
-> Student binary responses -> S00/S01/S10/S11 transitions
-> Aggregated analytics -> Interactive visualisations
-> Professor interpretation and export
```

Begin by inspecting the repository and extracting the complete contents of
both assignment spreadsheets. Do not begin question mapping or seed
generation until the complete question appendix has been generated and
validated.
