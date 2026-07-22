# Classroom Opinion Analytics Platform

A web application that collects binary (0/1) student opinions across two
sequential assignments and analyses how those opinions shift over time —
built for a real energy-sources classification course at Ahmedabad
University. No grades, no correctness, no proctoring: this measures what
people *said*, never whether they were right. See
[`docs/EXCLUDED_FEATURES.md`](docs/EXCLUDED_FEATURES.md) for the hard
boundaries this project deliberately does not cross.

## Status

**Core build: complete.** All 9 feature phases plus a full UI/UX design
pass are built, tested, and verified against a live Supabase project.
**Phase 10** (end-to-end Playwright tests, k6 load testing at 400
simulated users, seed/demo data, and final documentation) is the current
phase in progress — see [`plan/phase-10-testing-deployment.md`](plan/phase-10-testing-deployment.md).

As of the last verified pass: **175 automated tests passing** (unit +
integration, run against the live database), lint/typecheck/build all
clean, zero known test regressions. Load-test results and the final
completion report land in `docs/` once Phase 10 finishes — check there
for the authoritative, most current numbers rather than this file if it's
been a while since this README was last touched.

## What it actually does

1. Professor imports two spreadsheets (Assignment 1: 15 energy sources ×
   2 criteria = 30 questions; Assignment 2: 15 energy sources × 17
   criteria = 255 questions — 285 questions total, extracted and
   verified against the real source files, not invented).
2. Professor publishes each assignment; students answer with 0/1 via
   Google Workspace SSO (`@ahduni.edu.in` accounts only).
3. Professor maps related questions between the two assignments (e.g.
   "is Solar renewable?" on both sides) and approves those mappings.
4. For every approved mapping, the app classifies each student's paired
   answers into one of four states — no change (S00/S11) or a genuine
   shift (S01/S10) — plus change rate, net shift, consensus, and entropy
   at the class/question/student/energy-source/criterion level.
5. All of it renders as 14 interactive chart types, a custom query
   builder, and CSV/Excel/PDF exports — see
   [`docs/ANALYTICS_DEFINITIONS.md`](docs/ANALYTICS_DEFINITIONS.md) for
   the exact formulas behind every number on screen.

## Stack

Next.js (App Router) + TypeScript (strict) + Tailwind, Supabase
(PostgreSQL + Auth + Row-Level Security), Apache ECharts, TanStack Table,
React Hook Form + Zod. Full reasoning for the stack choices in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) and this project's chat
history — Supabase was chosen specifically because Row-Level Security
enforces "a student can never read another student's response" at the
database layer, not just in application code.

## Documentation index

Read `CLAUDE.md` first if you're using Claude Code — it's auto-loaded
every session. Otherwise, start here depending on what you need:

| Doc | Read this when... |
|---|---|
| [`docs/HOW_IT_WORKS.md`](docs/HOW_IT_WORKS.md) | You want to understand the architecture and data flow in plain language — start here if you're new to the project |
| [`docs/MAINTAINER_GUIDE.md`](docs/MAINTAINER_GUIDE.md) | You're operating this day-to-day: adding users, starting a new semester, fixing something that broke |
| [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) | You need the exact table/view/RPC list and what each one does |
| [`docs/ANALYTICS_DEFINITIONS.md`](docs/ANALYTICS_DEFINITIONS.md) | You need the exact math behind change rate, consensus, entropy, etc. |
| [`docs/QUESTION_MAPPING.md`](docs/QUESTION_MAPPING.md) | You're working on how Assignment 1 and 2 questions relate to each other |
| [`docs/AUTH_SSO.md`](docs/AUTH_SSO.md) | You're touching login, roles, or roster provisioning |
| [`docs/EXCLUDED_FEATURES.md`](docs/EXCLUDED_FEATURES.md) | You want the list of things this app will never do, on purpose |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | You're setting up staging/production environments |
| [`docs/PRE_LAUNCH_CHECKLIST.md`](docs/PRE_LAUNCH_CHECKLIST.md) | You're about to let real students use this for the first time |
| [`docs/ASSIGNMENT_QUESTION_APPENDIX.md`](docs/ASSIGNMENT_QUESTION_APPENDIX.md) | You need the verbatim wording of all 285 questions |
| `docs/USER_GUIDE_PROFESSOR.md`, `docs/USER_GUIDE_STUDENT.md` | Written in Phase 10 — how to actually use the app, for non-technical readers |
| `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md` | Written in Phase 10 — deeper technical reference |
| `plan/*.md` | The build plan, one file per phase, in order |

## Local setup

```bash
npm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Settings → API Keys),
# and NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN (your Google Workspace domain)
```

```bash
npm install -g supabase   # or: npm install -D supabase, then npx supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase db push --dry-run   # see what's pending before applying
supabase db push             # apply migrations
```

Google Workspace SSO also needs a one-time setup in Google Cloud Console
and the Supabase Auth dashboard — full walkthrough in
[`docs/AUTH_SSO.md`](docs/AUTH_SSO.md).

## Commands

```bash
npm run dev              # local dev server
npm run lint
npm run typecheck
npm run test             # unit + integration tests (vitest)
npm run test:e2e         # Playwright end-to-end tests
npm run build            # production build
npm run verify:extraction  # re-check the question manifests against the source spreadsheets
npm run db:seed          # seed demo data (local/staging only — never run against production)
```

All four of `lint`/`typecheck`/`test`/`build` must pass before any change
is considered done — this has been the standing rule for every phase of
this build.

## Repository structure

```
app/                    Next.js pages (App Router)
components/              Shared React components
lib/                     Business logic: classes, roster, assignments,
                          mappings, analytics, Supabase clients, shared
                          domain types and formulas
supabase/migrations/     Every database schema change, in order —
                          read before applying, never edit an old one
data/                    Extracted question manifests (JSON) from the
                          real source spreadsheets
docs/                    Everything in the table above
plan/                    The 10-phase build plan Claude Code worked from
source-assignments/      The original Assignment 1 / Assignment 2 Excel files
tests/                   Unit and integration tests
e2e/                     Playwright end-to-end tests
load-tests/              k6 load-testing scripts
.claude/                 Claude Code configuration (rules, subagents)
```

## Known limitations

This section gets a full, honest rewrite once Phase 10's completion
report lands — check there (or `docs/TESTING.md`) for the authoritative,
current list of anything descoped, simplified, or not yet built against
the original specification. As of this build:

- Running on Supabase's free tier — no automatic backups yet, and the
  project auto-pauses after 7 days of inactivity (adds a few seconds to
  the first request after a pause; see `docs/DEPLOYMENT.md`). Upgrading
  to Pro ($25/month) removes both, whenever real production use warrants
  it.
- Google OAuth is still in "Testing" publishing status — only
  explicitly-added test-user emails can log in. Needs to be switched to
  "In production" before real students can access it (see
  `docs/PRE_LAUNCH_CHECKLIST.md`).
- No custom domain attached yet — running on `localhost` / a default
  Vercel URL until Phase 11 (production launch).
