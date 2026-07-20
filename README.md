# Classroom Opinion Analytics Platform

Collects binary (0/1) student opinions across two sequential assignments and
analyses how responses shift between them. No grades, no correctness, no
proctoring — see `docs/EXCLUDED_FEATURES.md`.

## Status

Foundation scaffold + Phase 1 extraction complete. Phase 2 (auth/RLS
migration) is drafted and verified locally but not yet applied to a live
Supabase project. See `plan/` for what's next.

## What's already done

- **Phase 1 — extraction**: `data/assignment-1-manifest.json` and
  `data/assignment-2-manifest.json` were generated from the real source
  spreadsheets in `source-assignments/`. Counts verified: Assignment 1 =
  15 energy sources × 2 criteria = 30 questions; Assignment 2 = 15 energy
  sources × 17 criteria = 255 questions. Full human-readable version in
  `docs/ASSIGNMENT_QUESTION_APPENDIX.md`. One anomaly was found (a stray
  value in the Assignment 2 template grid) and is flagged there — read it
  before publishing that assignment.
- Deterministic mapping suggestions in `data/question-mapping-template.json`
  (11 energy sources common to both assignments, keyword-matched on
  "renewable"; nothing pre-approved — all need professor review in Phase 6).
- **Phase 2 groundwork**: Next.js + TypeScript strict + Tailwind scaffold,
  Supabase client/server/admin helpers, shared domain types in
  `lib/types/domain.ts`, and the full schema + RLS migration in
  `supabase/migrations/0001_init.sql`. `lint`, `typecheck`, `test`, and
  `build` all pass on this scaffold as-is.

## Prerequisites

- Node.js 20+
- A Supabase project (free tier is fine for development)
- The Supabase CLI (`npm install -g supabase`) if you want to run
  migrations locally against a linked project

## Local setup

```bash
npm install
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
# SUPABASE_SERVICE_ROLE_KEY from your Supabase project settings
```

## Database

```bash
supabase link --project-ref <your-project-ref>
supabase db push          # applies supabase/migrations/0001_init.sql
npm run verify:extraction # re-checks the manifests against source counts
npm run db:seed           # once scripts/seed.ts exists (Phase 10)
```

## Commands

```bash
npm run dev         # local dev server
npm run lint
npm run typecheck
npm run test         # unit tests (vitest)
npm run test:e2e     # Playwright, once written
npm run build        # production build
```

## Where to go next

Start Claude Code in this directory — it reads `CLAUDE.md` automatically.
Work `plan/phase-2-foundation-schema-auth.md` first (apply the migration to
a real Supabase project, wire up auth), then proceed phase by phase. See
`README-SETUP.md` for the two-worktree parallel workflow once Phase 2 is
merged.

## Troubleshooting

- **`supabase db push` fails on `auth.users`**: that table is managed by
  Supabase Auth and only exists once Auth is enabled on the project — make
  sure the project has Auth enabled before pushing.
- **RLS blocks everything in local testing**: policies rely on
  `auth.uid()`, which is only populated for authenticated requests. Test
  through the Supabase client with a real session, not the SQL editor's
  default role.
