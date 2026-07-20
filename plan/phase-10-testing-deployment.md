# Phase 10 — Testing & Deployment

**Agent:** single agent (merge backend-owner + frontend-owner worktrees
first). Needs the full tree, not a partial view.
**Spec sections:** 26, 27, 28, 29, 30, 33, 34, and Section 32 "Phase 10."

## Goal

Merge everything, prove it under load, document it, and produce the final
build report. Nothing here should surface a requirement gap for the first
time — if Phases 1-9 were done against their own Definition of Done, this
phase is verification, not new discovery.

## Tasks

1. Merge worktrees; resolve any contract drift between backend-owner and
   frontend-owner (flagged in their respective summaries).
2. Unit tests: binary validation, attempt transitions, transition
   generation, all Section 12/16 formulas, mapping validation, spreadsheet
   parser, export formatting.
3. Integration tests: class creation, roster import, assignment import,
   question approval, publication, draft saving, submission, reopening,
   mapping approval, analytics generation, exports, RLS access.
4. Playwright e2e: full admin, professor, and student workflows.
5. k6 load tests: 400 logins, 400 assignment loads, autosave activity,
   simultaneous final submissions, dashboard queries. Fix perf issues found
   (indexes, pagination, materialised-view refresh, etc.).
6. Seed data: 1 admin, 1 professor, 1 class, 30+ fictional students, real
   imported A1/A2 questions, sample approved mappings, responses covering
   all 4 transition states, saved visualisations. Demo credentials via env
   vars, never committed.
7. Write remaining docs from Section 29's list (ARCHITECTURE, SECURITY,
   DEPLOYMENT, TESTING, USER_GUIDE_PROFESSOR, USER_GUIDE_STUDENT,
   IMPORT_FORMAT) plus README covering setup through deployment.
8. Run spreadsheet-extraction verification again: counts match source
   files, no duplicate IDs, no missing/invented wording.
9. Produce the Final Completion Report (Section 34 checklist).

## Verification (must all pass before declaring done)

```bash
npm install
npm run lint
npm run typecheck
npm run test
npm run test:e2e
npm run build
npm run db:migrate -- --check
k6 run load-tests/*.js
```

Do not claim success unless build + critical tests pass. If something in
the spec could not be completed, say so explicitly in the report — don't
omit it silently (Section 1, rule 16).
