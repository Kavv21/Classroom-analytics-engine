# Testing Google SSO provisioning (dev-only)

Written before the roster-import UI existed. It ships now — a professor
adds students at `/classes/[classId]/roster/import` and an admin invites
staff at `/admin/users`, so the manual SQL below is no longer the only
way in. It's still the quickest way to provision the *first* account on a
fresh database, or to test the provisioning path itself, via the Supabase
SQL editor (or `psql`).

## Before you insert anything

- **`@ahduni.edu.in` below is illustrative only — no domain restriction is
  currently enforced.** The hosted project has no `allowed_email_domain`
  row in `app_config`, so `handle_new_user()` skips the domain check and
  any Google account (a personal Gmail included) reaches the
  `roster_entries` lookup. Use whatever address you'll actually sign in
  with. If someone later adds that row (`docs/AUTH_SSO.md` §1), an email
  outside the configured domain is rejected before `roster_entries` is even
  read, and no profile is created no matter what you insert below.
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
- Leave `class_id` as `null` unless you're pointing at a real class.
  `handle_new_user()` only creates a `class_members` link when
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
