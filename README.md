# Evaluating Energy Sources — Classroom Opinion Analytics

A web application that collects binary (0/1) student opinions on energy
sources and reports descriptive statistics about them. Built for a real
course at Ahmedabad University.

No grades, no correctness, no answer keys, no proctoring: this records what
people *said*, never whether they were right. See
[`docs/EXCLUDED_FEATURES.md`](docs/EXCLUDED_FEATURES.md) for the boundaries
this project deliberately does not cross.

## Status

**Deployed and live.** The production alias
`classroom-analytics-engine.vercel.app` is serving commit `c63d125`
(GitHub deployment `5739108461`, state `success`); `/login` responds 200.
All **25 migrations** (`0001`–`0025`) are applied to the hosted Supabase
project — confirmed with `npx supabase migration list`, not inferred from
the migration folder.

The live database currently holds 1 class, 2 assignments, 285 questions,
302 attempts and ~42.8k responses across 154 profiles (1 professor, 2
admins, 151 students — most of them the labelled synthetic demo cohort,
see `docs/DATABASE_SCHEMA.md` on `is_synthetic`).

Verification as of this README (2026-08-06):

| Command | Result |
|---|---|
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run test:local` | **35 files / 352 tests pass** |
| `npm run build` | pass — 23 pages + 4 route handlers compiled |

`npm run test` on its own reports 5 failing *files* and 288 passing tests.
That is the safety guard, not a regression: those five suites need a
database, and `tests/integration/helpers.ts` refuses to run them against
the live Supabase project configured in `.env.local`. Use
`npm run test:local` (starts against `npx supabase start`) for a genuine
full-suite result — that is the 352-test number above.

## What it does

1. **Professor imports each assignment** from the source spreadsheet.
   Assignment 1 is 15 energy sources × 2 criteria = 30 questions;
   Assignment 2 is 15 energy sources × 17 criteria = 255 questions. All 285
   are extracted from the real files into `data/*-manifest.json` and are
   never paraphrased. The import is upload → full parsed preview → commit:
   the professor reviews **every** question and every problem row before
   anything is written, and commit re-parses server-side and is
   all-or-nothing.
2. **Students answer in the browser**, on one live grid that reproduces the
   source spreadsheet's own rows, columns and order. Cells cycle blank → 0
   → 1 → blank, so an invalid value is not a state the control can produce.
   Autosave, offline retry and local draft recovery are built in;
   submission requires two explicit clicks and nothing else can trigger it.
3. **The professor reads per-assignment analytics** — response
   distribution, consensus, disagreement and entropy at the assignment,
   question, energy-source and criterion level, plus submission progress
   and a submissions-per-day timeline.
4. **Everything exports** — a 10-sheet Excel workbook, per-student .xlsx,
   and CSV/PDF for builder queries.

**Analytics is single-assignment.** Every figure describes one assignment
on its own, or compares the two in aggregate through the energy-source
labels they share. There is no per-student pairing of an Assignment 1
answer with an Assignment 2 answer: question mappings and the
S00/S01/S10/S11 transition engine were removed in migration 0022 and are
gone from the schema, the views and the UI. Don't reintroduce one without
first defining in `docs/ANALYTICS_DEFINITIONS.md` what makes two questions
comparable.

## Features

**Classes and roster**
- Create, edit, archive, unarchive a class; permanently delete one behind a
  typed `DELETE` confirmation that first shows the full census of what goes
  with it (students, assignments, questions, responses).
- Roster import from CSV/Excel (`email`, `full_name`, optional roll number
  etc.) with a preview/validation step. Roster rows are also the access
  gate — see Authentication below.
- Per-student active/inactive toggle.

**Assignments**
- Create, edit, duplicate; import questions from the spreadsheet with the
  full-review wizard; reorder questions and edit their display labels.
- Lifecycle DRAFT → READY → OPEN → CLOSED → ARCHIVED, enforced by a
  database trigger, with unarchive and typed-confirmation permanent delete.
- Per-attempt reopen (one student, one assignment) and a scoped bulk
  reopen. Reopening Assignment 2 does not reopen Assignment 1.

**Answering (student)**
- One live in-browser grid per assignment — full keyboard navigation,
  autosave, offline queue, review step, submission receipt.
- This replaced two earlier surfaces that are **gone**: the
  one-question-at-a-time runner and the CSV download/fill/upload wizard.

**Professor's response grid (aggregate only)**
- `…/assignments/[id]/grid` mirrors the original spreadsheet's layout and
  shows, in each answer cell, how many students answered `1` there. Sums
  only — no student rows, no names, no individual answers. Re-queried on
  every load, unlike a downloaded workbook.

**Individual student profile**
- Analytics → Students → a student: their full raw submission per
  assignment, read-only, in the source file's own grid shape, plus
  **Download as Excel**. This is the only surface in the app that shows one
  named person's answers, professor-of-this-class only.

**Analytics**
- Overview, per-assignment figures, per-student view, and a visualisation
  builder (saved queries, saved visualisations, dashboards) with ECharts
  rendering and CSV/PDF export.
- All aggregation happens in PostgreSQL views, computed on read, so numbers
  are always current with no refresh step.

**Admin console**
- `/admin/users` — every profile, role changes, activate/deactivate, invite
  staff by adding a roster entry.
- `/admin/audit` — the audit log, newest first, with the actor named.

## Tech stack

- **Next.js 15** (App Router, server components and server actions),
  **React 18**, **TypeScript** strict.
- **Tailwind CSS 3** + **shadcn/ui** on Radix primitives, **Apache
  ECharts**, **TanStack Table**, **React Hook Form** + **Zod**, **sonner**
  toasts, **lucide-react** icons.
- **Supabase** — PostgreSQL, Auth (Google OAuth), Row-Level Security.
  Supabase was chosen specifically because RLS enforces "a student can
  never read another student's response" at the database layer, not just in
  application code.
- **exceljs** / **xlsx** / **pdf-lib** / **papaparse** for imports and
  exports.
- **Vitest** + React Testing Library (unit/integration), **Playwright**
  (e2e), **k6** (load).
- **Vercel** (app) + **Supabase** (database/auth).

**Design system: "Meridian — warm SaaS console"** (`app/globals.css`). A
peach page backdrop carrying a floating white app frame, a dark navy
icon-only rail, rounded white cards on soft shadows, all-sans type, and
colour-coded workflow-state pills. It replaced the earlier "Ashfield sepia"
paper/serif direction outright — no serif display face, no printed-plate
offset shadows, no square corners survive from it. Colour is allowed on UI
chrome and workflow state only; anything rendering an actual student answer
or a response distribution stays neutral, because a 0/1 colour pair would
read as right/wrong and this app has no correctness. Every pairing is
checked by `node scripts/verify-contrast.mjs` (135 pairings, 0 failing —
re-run 2026-08-06).

## Authentication and access

**Google OAuth is the only sign-in method.** Password auth exists in the
database but no screen uses it.

**There is currently no domain restriction.** The live sign-in page shows
no "Restricted to …" line, `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` is unset in
the production environment, and the `app_config` table on the live database
has no `allowed_email_domain` row — so `handle_new_user()` skips the domain
check. Any Google account can authenticate.

**The real gate is the roster.** `handle_new_user()` creates a `profiles`
row only if the signing-in email matches an unprovisioned `roster_entries`
row. Without a profile, middleware sends the user to `/not-provisioned` and
they can reach nothing else. To restore a domain restriction, insert
`('allowed_email_domain', '<domain>')` into `app_config` (takes effect
immediately, it is read live) and set `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` in
Vercel for the sign-in copy and the `hd` account-picker hint (that one is
inlined at build time, so it needs a redeploy).

Full detail: [`docs/AUTH_SSO.md`](docs/AUTH_SSO.md).

## Documentation index

Read `CLAUDE.md` first if you're using Claude Code — it's auto-loaded every
session. Otherwise:

| Doc | Read this when... |
|---|---|
| [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md) | You want the architecture and data flow in plain language — start here if you're new |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | You need the technical structure: layers, boundaries, where logic lives |
| [`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md) | You're operating this day-to-day: adding users, starting a semester, fixing something |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | You need the exact table/view/RPC list and what each one does |
| [`docs/ANALYTICS_DEFINITIONS.md`](docs/ANALYTICS_DEFINITIONS.md) | You need the exact math behind consensus, disagreement, entropy |
| [`docs/AUTH_SSO.md`](docs/AUTH_SSO.md) | You're touching login, roles, or roster provisioning |
| [`docs/TESTING_SSO.md`](docs/TESTING_SSO.md) | You're testing sign-in end to end with a real Google account |
| [`docs/IMPORT_FORMAT.md`](docs/IMPORT_FORMAT.md) | You're preparing a spreadsheet for assignment import |
| [`docs/SECURITY.md`](docs/SECURITY.md) | You need the RLS/authz posture and what's enforced where |
| [`docs/TESTING.md`](docs/TESTING.md) | You want the suite composition and how to run each layer |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | You're setting up or changing environments |
| [`docs/PRE_LAUNCH_CHECKLIST.md`](docs/PRE_LAUNCH_CHECKLIST.md) | You're onboarding a new cohort of real students |
| [`docs/EXCLUDED_FEATURES.md`](docs/EXCLUDED_FEATURES.md) | You want the list of things this app will never do, on purpose |
| [`docs/ASSIGNMENT_QUESTION_APPENDIX.md`](docs/ASSIGNMENT_QUESTION_APPENDIX.md) | You need the verbatim wording of all 285 questions |
| [`docs/USER_GUIDE_PROFESSOR.md`](docs/USER_GUIDE_PROFESSOR.md), [`docs/USER_GUIDE_STUDENT.md`](docs/USER_GUIDE_STUDENT.md) | You're writing instructions for a non-technical user |
| `plan/*.md` | The original build plan, one file per phase — historical |

`docs/QUESTION_MAPPING.md` no longer exists; the feature it described was
removed in migration 0022. Two `plan/` files still reference it — see
"Known limitations".

## Local setup

```bash
npm install
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY  (Supabase dashboard → Settings → API Keys)
# NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN is OPTIONAL and currently unset in
# production — setting it only adds the sign-in copy and the Google
# account-picker hint, never the actual access boundary.
```

Applying migrations to a hosted project:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase migration list      # what's applied vs local
npx supabase db push --dry-run   # what would be applied
npx supabase db push
```

Running everything locally instead (Docker required) — this is also what
the DB-backed tests need:

```bash
npx supabase start               # applies all 25 migrations to a local stack
npm run test:local
npx supabase stop
```

Google OAuth needs a one-time setup in Google Cloud Console and the
Supabase Auth dashboard — walkthrough in
[`docs/AUTH_SSO.md`](docs/AUTH_SSO.md).

## Commands

```bash
npm run dev                      # local dev server
npm run lint
npm run typecheck
npm run test                     # unit tests; DB-backed suites self-block (see Status)
npm run test:local               # full suite against `npx supabase start`
npm run test:e2e                 # Playwright
npm run build
npm run db:migrate               # supabase db push
npm run verify:extraction        # re-check manifests against the source spreadsheets
npm run db:seed                  # demo data — refuses non-local URLs
npm run db:seed:demo-responses   # 150 synthetic students; --clean removes them
node scripts/verify-contrast.mjs # WCAG check over the design tokens
```

`lint`, `typecheck`, `test` and `build` must all pass before any change is
considered done.

## Routes

**Everyone:** `/` (routes you to the right place by role), `/login`,
`/auth/callback`, `/not-provisioned`

**Student:** `/assignments`, `/assignments/[assignmentId]` (the answer
grid), `/assignments/[assignmentId]/receipt`

**Professor:** `/classes`, `/classes/new`, `/classes/[classId]`,
`/classes/[classId]/roster/import`, `/classes/[classId]/assignments`,
`/classes/[classId]/assignments/new`,
`/classes/[classId]/assignments/[assignmentId]` (+ `/edit`, `/import`,
`/grid`)

**Analytics:** `/classes/[classId]/analytics` (+ `/assignments`,
`/students`, `/students/[studentId]`, `/builder`)

**Admin:** `/admin/users`, `/admin/audit`

**Route handlers:** `/classes/[classId]/exports/workbook`,
`/classes/[classId]/exports/query`,
`/classes/[classId]/analytics/students/[studentId]/export`

## Repository structure

```
app/                     Next.js pages and route handlers (App Router)
components/              React components — ui/ is shadcn, the rest by domain
lib/                     Server actions and domain logic: classes, roster,
                          assignments, attempts, analytics, query-builder,
                          exports, imports, Supabase clients, shared types
supabase/migrations/     0001–0025, forward-only — never edit an applied one
data/                    Question manifests (JSON) from the real spreadsheets
source-assignments/      The original Assignment 1 / 2 Excel files
docs/                    Everything in the table above
plan/                    The original phase-by-phase build plan (historical)
scripts/                 Seeding, extraction check, contrast check
tests/                   Vitest unit + integration
e2e/                     Playwright
load-tests/              k6
.claude/                 Claude Code rules and subagent definitions
```

## Migrations

| # | What it does |
|---|---|
| 0001 | Initial schema: enums, all core tables, RLS enabled |
| 0002 | Google SSO provisioning — `roster_entries` + `handle_new_user()` trigger |
| 0003 | Moves the allowed-domain setting into an `app_config` table (custom GUCs aren't permitted on managed Postgres) |
| 0004 | Schema-qualifies and pins `search_path` in the trigger, which runs as `supabase_auth_admin` |
| 0005 | Class status CHECK + transactional roster-import commit path |
| 0006 | Case-insensitive, whitespace-trimmed roster email matching |
| 0007 | The missing base `GRANT`s to `anon`/`authenticated`/`service_role` — RLS filters rows, it doesn't grant access |
| 0008 | Fixes 42P17 infinite policy recursion on `class_members`/`classes` |
| 0009 | Assignment import pipeline + DB-level integrity boundaries |
| 0010 | Attempt state machine, batched idempotent autosave, transactional submit, professor reopen |
| 0011 | Question mappings / mapping studio — **removed by 0022** |
| 0012 | Analytics views, computed on read |
| 0013 | Submissions-per-day timeline view |
| 0014 | Hardens saved-query / visualisation / dashboard policies |
| 0015 | Performance indexes only |
| 0016 | Admin-console reads + hardens `current_user_role()` |
| 0017 | Marks synthetic demo data; per-energy-source change view |
| 0018 | Unique `(class_id, sequence_number)` on assignments |
| 0019 | Repairs question codes stored as `A1-…` on Assignment 2 |
| 0020 | Lets synthetic data be seeded against CLOSED assignments without loosening the lifecycle for anyone else |
| 0021 | Carries `question_text` through `question_response_summary` |
| 0022 | **Removes question mappings and the whole transition engine** — tables, RPCs, enums and every dependent view |
| 0023 | Reopen paths + multiple-assignment fixes |
| 0024 | Reopen is per-attempt; a submitted attempt is genuinely locked |
| 0025 | Unarchive + permanent-delete RPCs for an assignment or a whole class |

## Known limitations

- **Backups.** The hosted Supabase project is on the free tier — no
  automatic backups, and the project pauses after 7 days of inactivity
  (adding a few seconds to the first request after a pause). Upgrading to
  Pro removes both. Take a manual `npx supabase db dump` before anything
  risky.
- **No custom domain.** The app runs on `classroom-analytics-engine.
  vercel.app`.
- **No domain restriction on sign-in** (see Authentication). Any Google
  account can complete OAuth; the roster is what actually grants access.
  Verify the Google OAuth consent screen's publishing status in Google
  Cloud Console before a new cohort — if it's still "Testing", only listed
  test users can sign in.
- **The live database is not clean-room.** It carries the labelled
  synthetic demo cohort (151 of 154 profiles) alongside real data. Filter
  on `is_synthetic` or clear it with `npm run db:seed:demo-responses
  --clean` before presenting real figures.
- **Load testing was never run against production-like infrastructure** —
  only from a developer machine against a local stack. The k6 scripts in
  `load-tests/` refuse non-local targets by design. Treat the numbers in
  `docs/TESTING.md` as indicative, not as a production capacity statement.
- **Two dead code paths survive their removed features.**
  `lib/attempts/commit-csv-submission.ts` (and its 25-test unit file) is
  reachable only from tests since the CSV upload flow was replaced by the
  live grid, and `TRANSITION_COLORS` in `lib/charts/theme.ts` is exported
  but unused since migration 0022. Both are harmless, both are noise for
  the next reader.
- **`plan/` is historical, not current.** `plan/MASTER_SPEC.md` and
  `plan/phase-6-mapping-studio.md` still describe the mapping studio and
  reference a `docs/QUESTION_MAPPING.md` that no longer exists. They record
  what was planned, not what shipped; the `docs/` files are authoritative.
- **Migration 0019's header caveat is out of date** — it says it was
  deliberately not applied to any remote database. It has since been
  applied (it appears in `npx supabase migration list`).
- **e2e tests need a running app and a local stack**; they are not part of
  the four-command gate and were last run manually.

## Licence / ownership

Built for a specific course engagement. The question wording in
`data/` and `source-assignments/` belongs to the course, not to this
repository — don't redistribute it separately.
