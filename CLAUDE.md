# Classroom Opinion Analytics Platform — CLAUDE.md

This file is read at the start of every Claude Code session. Keep it short and
factual. Deeper detail lives in /docs and is loaded on demand — don't paste
the full project spec here.

## What this is

A production web app that collects binary (0/1) student opinions across two
sequential assignments and reports descriptive statistics about each
assignment's responses.
No grades, no correctness, no answer keys, no anti-cheat, no proctoring.
See `/docs/EXCLUDED_FEATURES.md` for the full exclusion list — treat it as a
hard boundary, not a suggestion.

## Stack (do not substitute without asking)

- Frontend: Next.js (App Router), TypeScript strict mode, Tailwind CSS,
  TanStack Table, Apache ECharts, React Hook Form, Zod
- Backend/DB: Supabase, PostgreSQL, Supabase Auth, Row-Level Security,
  Next.js server actions / route handlers
- Testing: Vitest or Jest + React Testing Library, Playwright (e2e), k6 (load)
- Deployment: Vercel + Supabase

## Commands

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run db:migrate
npm run db:seed
```

All four (lint, typecheck, test, build) must pass before any change is
considered done. Never declare work complete without running them.

`npm run test` refuses to run the six DB-backed suites against the hosted
project in `.env.local` and reports them as failing files — that is the
guard, not a regression. For a real full-suite result: `npx supabase start`
then `npm run test:local` (37 files / 435 tests as of 2026-08-10).

## Non-negotiable rules

1. Never invent or paraphrase question wording. Assignment questions come
   only from `/data/assignment-1-manifest.json` and
   `/data/assignment-2-manifest.json`, generated from the source spreadsheets
   in Phase 1. If a question isn't in the manifest, it doesn't exist yet —
   stop and flag it, don't guess.
2. `response_value` is always `0`, `1`, or `NULL`. Enforce this with a DB
   CHECK constraint, not just frontend validation.
3. No RLS shortcuts. Every table with student data needs a policy before it
   ships, even in a draft PR. Frontend role checks are not a substitute.
4. Analytics never pairs one student's Assignment 1 answer with their
   Assignment 2 answer. Question mappings and the transition engine were
   removed in migration 0022; every figure describes a single assignment,
   or compares the two in aggregate via shared energy-source labels.
5. No feature from `/docs/EXCLUDED_FEATURES.md` gets built, even as a
   scaffold or disabled button.
6. Destructive edits to questions that already have responses are
   forbidden — version the assignment instead.
7. Use database migrations for every schema change. Never hand-edit the
   Supabase schema outside a migration file.
8. Secrets live in environment variables only. Never hardcode credentials,
   never commit `.env`.

## Where to look before building something

- Schema questions → `/docs/DATABASE_SCHEMA.md`
- Metric formulas (consensus, disagreement, entropy, group count change) →
  `/docs/ANALYTICS_DEFINITIONS.md`
- What the app is and where everything lives → `/README.md`
- How the build got here → `/plan/` (one file per phase, historical: the
  build is finished and deployed, so these describe what was planned, not
  what is current. `plan/phase-6-mapping-studio.md` documents a feature
  that was removed — don't build from it.)
- Anything explicitly out of scope → `/docs/EXCLUDED_FEATURES.md`

## Working agreement

- The app is built, deployed and in use. Work is now maintenance and
  extension against a live database — not phase work. Assume real data
  behind every schema change.
- After any change, update the relevant `/docs/*.md` file if reality
  diverged from what it describes (e.g. an extra table, a renamed field),
  so the next session/agent isn't working from stale docs.
- If a spreadsheet row or column can't be interpreted, fail loudly — do not
  silently skip it or guess its meaning.
