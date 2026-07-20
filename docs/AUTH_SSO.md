# Authentication: Google Workspace SSO

Replaces plain Supabase email/password auth with "log in with your
university Google account," restricted to the institution's Workspace
domain. This changes both **how people log in** and **how they get a
role**, since Google only tells you an email address — it doesn't know
this app has ADMIN/PROFESSOR/STUDENT roles.

## 1. Domain restriction — and why the obvious way isn't secure enough

Google's OAuth consent screen supports an `hd` (hosted domain) query
parameter that pre-filters the account picker to one Workspace domain.
**This is a UX hint, not a security boundary** — a user can still complete
sign-in with a non-matching Google account by editing the request, and
some client libraries drop the parameter silently. The domain check that
actually matters happens **server-side**, after Google returns the
authenticated identity, by checking the verified email's domain against
an allowlist before the account is allowed to do anything in the app.

Set the real domain once you've confirmed it with the professor:

```
NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN=<confirm with professor, e.g. ahduni.edu.in>
```

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
  1. Verifies the email's domain matches `NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN`
     — if not, the trigger does not create a profile and the user gets
     "your account isn't provisioned for this app" rather than access.
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

Seed data (Phase 10) can't use fake Google accounts. For staging/demo
purposes, keep Supabase email/password auth enabled *in addition to*
Google, gated behind an environment flag, so automated tests and demo
walkthroughs don't require a real Google Workspace account. Never enable
that fallback in production — production should accept Google sign-in
only, enforced in both Supabase provider settings and app-level checks.
