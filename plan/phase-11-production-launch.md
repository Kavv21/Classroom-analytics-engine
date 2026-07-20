# Phase 11 — Production Launch

**Agent:** single agent, or you directly — this phase involves real
credentials and a real institution, keep a human in the loop for every
irreversible step (creating the production Supabase project, attaching
the domain, sharing the URL with the professor).
**Reference:** `docs/DEPLOYMENT.md`, `docs/PRE_LAUNCH_CHECKLIST.md`.
**Prerequisite:** Phase 10 fully green on staging.

## Goal

Take the verified, tested application from staging to a real production
deployment a professor and 250-300 real students will actually use.

## Tasks

1. Create the production Supabase project (separate from staging), pick a
   region deliberately, enable backups/PITR.
2. Apply migrations to production. Confirm RLS on production with a real
   test account, not just staging.
3. Set production environment variables in Vercel, scoped to Production
   only.
4. Attach the custom domain, confirm TLS.
5. Wire up error tracking and an uptime check; confirm both actually fire
   on a deliberate test error/downtime before relying on them.
6. Create the real admin and professor accounts by hand. No seed data in
   production.
7. Run the full smoke test from `docs/PRE_LAUNCH_CHECKLIST.md`, then purge
   the throwaway test data.
8. Have the professor review `docs/USER_GUIDE_PROFESSOR.md` and confirm
   they can open/close assignments, approve mappings, and export data
   without you.
9. Agree explicitly with the professor on an incident-response contact
   path before the first real class session goes live on it.

## Definition of done

- Every box in `docs/PRE_LAUNCH_CHECKLIST.md` is checked, not assumed.
- The professor has used the production URL themselves at least once
  before their students do.

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run test:e2e && npm run build
# then the manual smoke test in docs/PRE_LAUNCH_CHECKLIST.md against the
# real production URL
```
