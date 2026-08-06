# Authentication: Google Workspace SSO

Replaces plain Supabase email/password auth with "log in with your
university Google account," optionally restricted to one Workspace domain.
This changes both **how people log in** and **how they get a role**, since
Google only tells you an email address — it doesn't know this app has
ADMIN/PROFESSOR/STUDENT roles.

> **Current state (verified 2026-08-06): there is no domain restriction in
> force.** The `app_config` table on the hosted project has no
> `allowed_email_domain` row, so the server-side check described in §1
> passes for every domain, and `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN` is unset
> in Vercel production, so neither the sign-in copy nor the `hd` hint
> appears. Any Google account can authenticate; §2's roster provisioning is
> the only thing granting access. To re-enable the restriction, insert
> `('allowed_email_domain', '<domain>')` into `app_config` — read live, so
> it takes effect immediately — and set the env var in Vercel (inlined at
> build time, so it needs a redeploy).

## 1. Domain restriction — and why the obvious way isn't secure enough

Google's OAuth consent screen supports an `hd` (hosted domain) query
parameter that pre-filters the account picker to one Workspace domain.
**This is a UX hint, not a security boundary** — a user can still complete
sign-in with a non-matching Google account by editing the request, and
some client libraries drop the parameter silently. The domain check that
actually matters happens **server-side**, after Google returns the
authenticated identity, by checking the verified email's domain against
an allowlist before the account is allowed to do anything in the app.

### Where the allowed domain is stored

The server-side allowlist lives in a table, **not** in a database setting.
An earlier version of this document said to configure it with:

```sql
-- DOES NOT WORK on Supabase's managed Postgres.
alter database postgres set app.settings.allowed_email_domain = 'ahduni.edu.in';
```

The project's connection role isn't permitted to set custom GUC namespaces
at the database level (`permission denied to set parameter`), even though
this works on a self-hosted instance. Migration
`0003_app_config_and_domain_fix.sql` replaced that mechanism with a real
`app_config` table, which `handle_new_user()` reads instead of
`current_setting()`.

```sql
-- Turn a restriction on, or change it later. Read live by the trigger,
-- so it takes effect on the next sign-in — no deploy needed.
insert into app_config (key, value) values ('allowed_email_domain', 'ahduni.edu.in')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- Turn it off entirely.
delete from app_config where key = 'allowed_email_domain';
```

Run these from the Supabase SQL editor: `app_config` is admin-only under
RLS (`app_config_admin_only`), which the SQL editor's role bypasses.
`handle_new_user()` reads it as a security-definer function, so that policy
never blocks provisioning.

**With no `allowed_email_domain` row, there is no domain check at all** —
the trigger skips it and any Google account can authenticate. That is the
current production state (see the banner above); roster provisioning in §2
is what actually grants access.

Separately, the client-side courtesy — the "Restricted to …" line on the
sign-in page and the `hd` hint sent to Google — comes from an environment
variable, which is optional and purely cosmetic:

```
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=<confirm with professor, e.g. ahduni.edu.in>
```

Next inlines `NEXT_PUBLIC_*` at build time, so changing it needs a
redeploy, not just an env edit. Keep it in step with the `app_config` row —
a mismatch means the page names a restriction the database isn't
enforcing, or stays silent about one it is.

## 2. Role assignment — roster-based provisioning, not self-service

Google login proves *who someone is*, not *what role they should have*.
This app decides roles from a pre-provisioned roster, not from anything
the user supplies at sign-in:

- **Professor imports the class roster first** (Phase 3, already planned) —
  this populates a `roster_entries` table keyed by email, with the
  intended role and, for students, class/section.
- **Admin and professor accounts** are seeded explicitly by an existing
  admin (via an `roster_entries` row with role `PROFESSOR`/`ADMIN`, added
  manually for the first admin) — never self-assigned by whoever happens
  to sign in first.
- **On first Google sign-in**, a database trigger on `auth.users` runs
  `handle_new_user()`:
  1. Verifies the email's domain against the `allowed_email_domain` row in
     `app_config` (§1), matching case-insensitively and ignoring stray
     whitespace on both sides (migration 0006). If the row is absent this
     step is skipped; if it's present and the domain doesn't match, the
     trigger does not create a profile and the user gets "your account
     isn't provisioned for this app" rather than access.
  2. Looks up the email in `roster_entries`. If found, creates the
     matching `profiles` row with that role (and, for students, the
     `class_members` link). If not found, the login succeeds against
     Google but the app treats them as unprovisioned — no profile, no
     access, until a professor/admin adds them to a roster.
- This means **order matters**: a student's roster entry must exist
  before their first login for them to land in the right class
  automatically. Document this for the professor in the user guide —
  import rosters before publishing an assignment, not after.

## 3. What changes in the schema

See `supabase/migrations/0002_google_sso_provisioning.sql`:
- New `roster_entries` table (email, intended role, class_id, roll_number,
  section, etc. — populated by the roster-import flow from Phase 3).
- `handle_new_user()` trigger function + trigger on `auth.users`.
- `profiles.id` continues to reference `auth.users(id)` as before — no
  change there, since Supabase Auth still owns the identity, Google is
  just the provider.

## 4. Provider setup (manual, one-time, in two dashboards)

### Google Cloud Console
1. Create (or reuse) a project → APIs & Services → OAuth consent screen.
   - User type: depends on whether this should be restricted to internal
     Workspace users at the Google level too (Internal) or open (External)
     — Internal is stronger but only works if you're inside the
     university's own Workspace org, which you likely aren't as an
     external dev. Use External + the app-level domain check above as the
     real boundary.
2. Credentials → Create Credentials → OAuth client ID → Web application.
   - Authorized redirect URI: `https://<your-supabase-project-ref>.supabase.co/auth/v1/callback`
   - Note the Client ID and Client Secret.

### Supabase Dashboard
1. Authentication → Providers → Google → enable it, paste the Client ID
   and Client Secret from above.
2. Authentication → URL Configuration → confirm the Site URL matches your
   real production domain (and add the staging URL to Redirect URLs too).

### App code
- Sign-in button calls `supabase.auth.signInWithOAuth({ provider: 'google',
  options: { queryParams: { hd: process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN } } })`
  — the `hd` param is still worth sending for UX (pre-filters the account
  picker), just not relied on for security.
- Middleware/server check on every request: reject if the authenticated
  user has no `profiles` row (i.e. the trigger didn't provision them) —
  this is the actual enforcement point, not the OAuth flow.

## 5. What this means for demo/seed data

Seed data can't use fake Google accounts. What was built (this supersedes
the earlier plan of an env-flagged password-login screen):

- **Google OAuth is the only sign-in path in the UI.** Password auth is
  still enabled at the Supabase level but no screen uses it, so there is no
  fallback login to accidentally leave exposed in production.
- **Tests** mint password-auth users through the admin API and clean them
  up afterwards (`tests/integration/helpers.ts`, `e2e/helpers.ts`), which
  needs no browser sign-in and no Workspace account.
- **Demo cohorts** are synthetic rows written straight to the database and
  permanently marked `is_synthetic` (migrations 0017/0020), not accounts
  that log in. `npm run db:seed` and the load-test tooling both refuse a
  non-local Supabase URL without an explicit override.

The hosted project currently carries such a demo cohort alongside real
data — filter on `is_synthetic` before presenting figures, or clear it with
`npm run db:seed:demo-responses --clean`.
