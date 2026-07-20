# Deployment (Production)

This assumes Vercel (frontend/API) + Supabase (database/auth), per the
required stack. Written for a real client engagement, not a demo.

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
5. Create the real admin account and the real professor account by hand
   (not from seed data) — see `docs/USER_GUIDE_PROFESSOR.md` for the
   professor-facing steps.
6. Smoke-test the actual production URL end to end: log in as the real
   professor, create a real class, publish a test assignment, submit a
   test response as a throwaway student account, confirm it appears in
   analytics, then delete the test data.
7. Only then share the URL with the professor for real classroom use.

## 8. Ongoing

- Treat every schema change post-launch as a new migration file, reviewed
  before it touches production.
- Keep a running `docs/CHANGELOG.md` (or use git tags) so the professor
  can be told in plain language what changed and when — they are not going
  to read migration diffs.
