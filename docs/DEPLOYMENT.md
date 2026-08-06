# Deployment (Production)

This assumes Vercel (frontend/API) + Supabase (database/auth), per the
required stack. Written for a real client engagement, not a demo.

> **Status note.** Sections 1–8 below were written during planning.
> Section 0 records what actually exists and is authoritative where the two
> disagree; Section 9 records what load testing could and could not
> establish from a developer machine.

## 0. What exists now (verified 2026-08-06)

- **The app is deployed and live.** Vercel serves commit `c63d125` on
  `classroom-analytics-engine.vercel.app` (GitHub deployment
  `5739108461`, state `success`). Deployments are triggered by pushes to
  `main`; there is no custom domain.
- **25 migrations** (`supabase/migrations/0001`–`0025`), forward-only, and
  **all 25 are applied to the hosted project** — confirm with
  `npx supabase migration list` rather than assuming.
- **One Supabase project, not two.** Section 1 below recommends separate
  staging and production projects; that was not done. The hosted project
  is both, and it carries the labelled synthetic demo cohort alongside
  real data (`is_synthetic`).
- **Seed script** (`npm run db:seed`) refuses any non-local Supabase URL
  unless `SEED_ALLOW_REMOTE=true`. It is for staging/demo only; production
  gets real accounts, never seed data.
- **Load-test tooling** (`load-tests/`) likewise refuses non-local targets.
- Google OAuth is the only sign-in path in the UI. Password auth exists in
  the database but no screen uses it.
- **No domain restriction is configured.** `app_config` has no
  `allowed_email_domain` row and `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` is
  unset in the Vercel production environment, so any Google account can
  complete sign-in. Access is gated by `roster_entries` alone — see
  `docs/AUTH_SSO.md` §1.
- **The admin console exists** (`/admin/users`, `/admin/audit`, added
  after Phase 10). §7.5's manual database step is still how the *first*
  admin is created — there is no one to grant the role otherwise.

## 1. Environments — never share one Supabase project across dev/prod

Create **two** Supabase projects, not one:

- `classroom-analytics-staging` — where Claude Code and you test against
  freely, safe to wipe/reseed.
- `classroom-analytics-production` — real professor, real students. Nobody
  runs ad-hoc SQL against this by hand. All changes arrive via migration
  files, applied through CI or a deliberate manual `supabase db push`.

Matching Vercel setup: one Vercel project, two environments (Preview =
staging Supabase, Production = production Supabase), driven by environment
variables scoped per-environment in the Vercel dashboard — not a single
shared `.env`.

## 2. Domain

1. Buy/point a domain (or subdomain, e.g. `classroom.ahmedabaduniversity.example`)
   at Vercel: Project Settings → Domains → Add.
2. Vercel issues the TLS certificate automatically once DNS propagates —
   nothing to configure manually.
3. Point `NEXT_PUBLIC_APP_URL` at the real domain in the Production
   environment variables.

## 3. Secrets — production checklist

- `SUPABASE_SERVICE_ROLE_KEY` — production value, set only in Vercel's
  Production environment scope, never in Preview/Development, never in a
  committed file.
- Demo/seed credentials (`DEMO_ADMIN_PASSWORD` etc.) — **do not deploy seed
  data to production at all.** Seed data is for staging only. Production
  gets real accounts created by an actual admin/professor sign-up flow.
- Rotate the Supabase service role key if it was ever pasted into a chat,
  screenshot, or committed by accident — treat any such exposure as a
  live incident, not a formality.

## 4. Pre-launch data safety

- Enable Supabase's point-in-time recovery (PITR) or, at minimum, scheduled
  daily backups on the production project before real student data enters
  it. Confirm restore actually works on staging once, before you need it
  for real.
- Migrations are forward-only in production. If a migration needs
  reverting, write a new migration that undoes it — never hand-edit
  production schema, never re-run `supabase db reset` against production.

## 5. Monitoring & error tracking

Add before go-live, not after the first incident:

- Vercel's built-in analytics/logs are a starting point but not alerting.
  Add a real error tracker (Sentry or similar) to both the Next.js app and
  server actions, so a failed submission during class doesn't go unnoticed
  until a student complains.
- Supabase dashboard → Database → set up alerts for connection-pool
  exhaustion and slow queries, given the 250-300 concurrent student target.
- A simple uptime check (e.g. a scheduled ping to `/` or a `/health` route)
  pointed at a notification channel (email/Slack) you actually watch.

## 6. Data privacy note (India — DPDP Act 2023)

This app processes personal data of students at an Indian institution
(names, roll numbers, emails, opinions). Before real data flows through
production:

- Confirm with the professor/institution who is the "Data Fiduciary" under
  the DPDP Act for this data, and that the institution has a lawful basis
  and, where required, consent mechanism for collecting it via a
  third-party-hosted (Vercel/Supabase) tool.
- Supabase lets you choose a project region — pick one appropriate for the
  institution's data-residency preferences and confirm this with them
  rather than defaulting silently.
- This is not legal advice — if the institution has a formal data-protection
  or IT-security review process, route this project through it before
  go-live. Flag this explicitly to the professor; don't assume it's been
  handled.

## 7. Go-live sequence

1. Finish Phase 10 fully on staging: all four verification commands green,
   Playwright e2e passing, k6 load test run at 400 virtual users.
2. Apply `supabase/migrations/*.sql` to the **production** Supabase project
   (fresh, no seed data).
3. Set all production environment variables in Vercel.
4. Deploy to Vercel Production (`vercel --prod` or via git push to the
   production branch, depending on your Vercel git integration setup).
5. **Create the real admin and professor accounts by hand.** There is no
   admin UI and no self-signup, so this is a deliberate manual step:
   a. Have the person sign in once with Google — this fails at
      `/not-provisioned`, but creates their `auth.users` row.
   b. In the Supabase dashboard, insert their `profiles` row with the
      correct `role` (`ADMIN` or `PROFESSOR`), or update the row if
      `handle_new_user()` created one as `STUDENT`.
   c. They sign in again and now have access.
   See `docs/USER_GUIDE_PROFESSOR.md` for what they do next.
6. Smoke-test the actual production URL end to end: log in as the real
   professor, create a real class, publish a test assignment, submit a
   test response as a throwaway student account, confirm it appears in
   analytics, then delete the test data.
7. Only then share the URL with the professor for real classroom use.

## 9. Capacity — what load testing did and did not establish

Full numbers in `docs/TESTING.md`. Summary:

- **Autosave, the dominant real-world load, is clean to 400 concurrent
  virtual users** on the local stack (1 failure in 35,472 requests,
  p95 187 ms). This is the operation 300 students generate continuously.
- **`submit_attempt` resolved 99%** under a deliberate 300-user
  simultaneous spike with zero ramp.
- Every high-concurrency failure traced to the **local** Postgres running
  `max_connections = 100` in one container on a laptop. Below ~150
  concurrent, all five scenarios were 0% failure.

**What this does not tell you.** Local capacity is not production
capacity, and the load test's login scenario used the password grant,
which production does not use (production is Google OAuth). Before real
classroom use:

1. Re-run `load-tests/scenarios.js` against the **staging** Supabase
   project at 400 VUs and compare. This is the only way to size the real
   thing.
2. Confirm the project uses Supabase's connection pooler (Supavisor) for
   the application's connection string, not a direct Postgres connection.
   Pool exhaustion was the binding constraint in every local failure and
   will be the first thing to bite in production.
3. Check the pool size available on your Supabase plan against the peak
   concurrent student count, and raise the plan if 300 simultaneous
   submissions are expected.
4. Run `ANALYZE` (or confirm autovacuum has) after the first bulk import
   and after the first assignment closes. Stale planner statistics were
   measurably worse than missing indexes — a fresh bulk load ran a core
   analytics view 5× slower until statistics caught up.

## 9.5 Performance notes carried into production

- Analytics views are computed on read, so there is nothing to refresh
  and no staleness — but they are also not cached. If the professor
  reloads analytics constantly on a large class, that is real query load.
- The four analytics routes ship ~456 kB of first-load JS (ECharts). On a
  slow connection the first visit is noticeably heavier than other pages.
  Deferring ECharts is a known, unimplemented optimisation.
- Page-level reads were parallelised in Phase 10; each remaining
  sequential await is a genuine data dependency.

## 8. Ongoing

- Treat every schema change post-launch as a new migration file, reviewed
  before it touches production.
- Keep a running `docs/CHANGELOG.md` (or use git tags) so the professor
  can be told in plain language what changed and when — they are not going
  to read migration diffs.
