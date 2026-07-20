# Testing Google SSO provisioning (temporary, dev-only)

Phase 3's roster-import UI doesn't exist yet, so there's no in-app way to
add a `roster_entries` row. Until then, insert one manually via the
Supabase SQL editor (or `psql`) to test the "provisioned" login path.
Delete this file once Phase 3 ships a real import flow.

## Before you insert anything

- **Your email's domain must match `app_config.allowed_email_domain`**
  (currently `ahduni.edu.in` — see
  `supabase/migrations/0003_app_config_and_domain_fix.sql`). If the Google
  account you sign in with is outside that domain, `handle_new_user()`
  rejects it before it even looks at `roster_entries` — no profile gets
  created no matter what you insert below. A personal Gmail address will
  not work here.
- **Order matters, and it's not retroactive.** If you already signed in
  once with this account *before* inserting its roster row,
  `handle_new_user()` already ran, found no roster entry, and returned
  without creating a profile — that trigger doesn't re-run later.
  Inserting a roster row now will not provision that existing
  `auth.users` row. Fix: Supabase Dashboard → Authentication → Users →
  find the account → Delete, insert the roster row below, then sign in
  again.

## Insert yourself into the roster

```sql
insert into roster_entries (email, intended_role, full_name)
values ('you@ahduni.edu.in', 'PROFESSOR', 'Your Name');
```

- `intended_role` is `'ADMIN'`, `'PROFESSOR'`, or `'STUDENT'`.
- Leave `class_id` as `null` for now — no `classes` row exists until
  Phase 3. `handle_new_user()` only creates a `class_members` link when
  `class_id` is set, so a null value just skips that step; the
  `profiles` row is still created.

## Test the flow

1. Visit `/login` and click "Sign in with Google" using the exact email
   you inserted above.
2. You should land on `/` and see your name and role with a "Sign out"
   button, instead of `/not-provisioned`.
3. To re-test the *unprovisioned* path, sign in with any account that has
   no matching `roster_entries` row (or hasn't been inserted yet) — you
   should land on `/not-provisioned` with the "ask your professor" copy.

## Cleaning up

```sql
delete from roster_entries where email = 'you@ahduni.edu.in';
```

This does not remove the `profiles` row already created by a completed
sign-in — that's a real (if manually provisioned) account at that point.
Delete from `profiles` and the corresponding `auth.users` row too if you
want a clean slate.
