# Phase 2 — Foundation: Schema, Auth, RLS

**Agent:** single agent, no worktree split yet. This phase produces the
shared contract everything else depends on — do not parallelize it.
**Spec sections:** 2, 7, 13, 14, 24, and Section 32 "Phase 2."
**Reference:** `/docs/DATABASE_SCHEMA.md`

## Goal

Stand up the Next.js + Supabase foundation: auth, roles, full schema
migrations, RLS policies. Freeze this contract before splitting into
parallel backend/frontend work.

## Tasks

1. Scaffold Next.js (App Router) + TypeScript strict + Tailwind.
2. Configure Supabase project, environment variables (no hardcoded
   credentials).
3. Implement Supabase Auth with three roles: ADMIN, PROFESSOR, STUDENT
   (Section 7).
4. Write migrations for every table in `/docs/DATABASE_SCHEMA.md`.
5. Write RLS policies per the "Row-Level Security" section of the same
   doc — every table with student data must have a policy before this
   phase is done, not after.
6. Add the `response_value` CHECK constraint and the
   `(attempt_id, question_id)` unique constraint.
7. Add data-integrity items from Section 24 that apply at the schema level
   (FK constraints, UTC timestamps, soft deletion for academic records).
8. Define shared TypeScript types in `/lib/types/` that both future
   backend and frontend agents will consume.

## Definition of done

- `npm run db:migrate` runs clean on a fresh database.
- RLS policy tests confirm: a student cannot read another student's
  responses, class analytics, or export data (write a quick integration
  test now — don't wait for Phase 10).
- `/docs/DATABASE_SCHEMA.md` matches the actual migrations exactly.
- This is the point to freeze the schema/type contract and, if desired,
  split into `backend-owner` / `frontend-owner` worktrees for Phases 3-9.

## Verification

```bash
npm install && npm run lint && npm run typecheck && npm run test && npm run build
npm run db:migrate
```
