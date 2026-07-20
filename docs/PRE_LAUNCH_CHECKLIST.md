# Pre-Launch Checklist

Don't share the production URL with the professor until every box here is
checked. This is stricter than "Phase 10 tests pass" — it's the client-
readiness gate on top of that.

## Functional correctness
- [ ] All Phase 1-9 verification commands pass on the merged, final tree
- [ ] Playwright e2e covers full admin/professor/student workflows and is
      green
- [ ] k6 load test run at 400 virtual users; submission spike and
      dashboard-aggregation results reviewed, not just "it didn't crash"
- [ ] `npm run verify:extraction` passes against the real, final source
      spreadsheets (re-run if the professor supplied a revised spreadsheet
      since Phase 1)

## Data & security
- [ ] Production Supabase project is separate from staging
- [ ] RLS policies re-verified against production (not just staging) —
      confirm a student account genuinely cannot read another student's
      responses on the live database
- [ ] `SUPABASE_SERVICE_ROLE_KEY` set only in Vercel Production scope,
      confirmed not present in any committed file or client-side bundle
- [ ] Backups/PITR enabled on production Supabase project, restore tested
      once on staging
- [ ] No seed/demo data present in production
- [ ] Data-privacy note (docs/DEPLOYMENT.md Section 6) discussed with the
      professor/institution — not silently assumed handled

## Accounts
- [ ] Real admin account created (not from seed data)
- [ ] Real professor account created, professor has logged in once and
      confirmed access before go-live
- [ ] A password-reset / account-recovery path exists and has been tested

## Domain & infra
- [ ] Custom domain attached and TLS certificate active
- [ ] `NEXT_PUBLIC_APP_URL` correctly set to the real domain in production
- [ ] Error tracking wired up and confirmed to actually receive a test
      error before launch
- [ ] Uptime check configured and pointed at a channel someone monitors

## Handoff
- [ ] `docs/USER_GUIDE_PROFESSOR.md` and `docs/USER_GUIDE_STUDENT.md` are
      complete and were actually reviewed by the professor, not just
      written and assumed adequate
- [ ] Professor knows how to open/close an assignment, approve a mapping,
      and export data without your help
- [ ] You and the professor agree on who to contact if something breaks
      during a live class session, and how fast you can respond

## Final smoke test (on the real production URL, with throwaway data)
- [ ] Log in as the real professor
- [ ] Create a real class
- [ ] Publish a test assignment
- [ ] Submit a response as a disposable test student account
- [ ] Confirm the response appears correctly in analytics
- [ ] Delete all test/throwaway data before the professor's real class uses it
