# Maintainer's Guide

This is your playbook for running this app over time — adding people,
handling a new semester, fixing things when they break. Different from
`docs/USER_GUIDE_PROFESSOR.md`, which covers what the professor does
inside the app itself. This is what *you* do outside/around it.

---

## 1. The three roles, and how someone actually gets one

Nobody signs up directly. Every account starts as a **roster entry** —
a row saying "this email should become X once they log in" — and only
turns into a real account the first time that person logs in with Google.

> The `@ahduni.edu.in` addresses in the SQL throughout this guide are
> **illustrative only**. No domain restriction is currently enforced —
> `app_config` has no `allowed_email_domain` row, so any Google address
> works and the roster row is the whole access decision. Use whatever
> address the person actually signs in with. See `docs/AUTH_SSO.md` §1 to
> turn a restriction on.

### Adding a student

```sql
insert into roster_entries (email, intended_role, class_id, full_name, roll_number)
values ('student.email@ahduni.edu.in', 'STUDENT',
  '<class-id>', 'Student Name', 'R001');
```

Get `<class-id>` from:
```sql
select id, name from classes order by created_at desc;
```

In practice, the professor does this in bulk through the **roster import
wizard** in the app (CSV/Excel upload) — you'd only run raw SQL for a
one-off addition or when testing.

### Adding a professor

An admin can now do this in the app: **/admin/users → invite staff**
writes the same `roster_entries` row, carrying the intended role. The raw
SQL below is the equivalent, and is still how you create the *first*
admin, when there's nobody with the role to grant it:

```sql
insert into roster_entries (email, intended_role, class_id, full_name)
values ('newprofessor@ahduni.edu.in', 'PROFESSOR', null, 'Professor Name');
```

Note `class_id` is `null` — a professor isn't tied to one class at signup;
they create their own classes after logging in.

### Adding an admin

Same pattern, rare, usually just you:

```sql
insert into roster_entries (email, intended_role, class_id, full_name)
values ('admin@ahduni.edu.in', 'ADMIN', null, 'Admin Name');
```

### Important ordering rule

**The roster entry must exist *before* that person's first login.** If
someone logs in before you've added them, they land on the
"account isn't set up" page — the fix isn't retroactive from their side;
you add the roster entry, then they need to log in again (or if their
account already exists from that failed first attempt, see Section 3
below for fixing an already-created account instead).

---

## 2. Checking who exists and what role they have

```sql
select email, role, is_active, created_at from profiles order by created_at desc;
```

This is your actual "who has an account" list. `roster_entries` is the
waiting room; `profiles` is who's actually gotten in.

To see who's on a roster but hasn't logged in yet:

```sql
select email, intended_role, class_id from roster_entries where provisioned = false;
```

---

## 3. Changing someone's role after they already have an account

If someone's already provisioned (has a `profiles` row) and you need to
change their role — e.g. you accidentally set them as ADMIN instead of
PROFESSOR — update `profiles` directly, not `roster_entries` (that only
matters for people who haven't logged in yet):

```sql
update profiles set role = 'PROFESSOR', updated_at = now()
where email = 'the-persons-email@ahduni.edu.in';
```

Takes effect on their next page load — no need for them to log out/in.

---

## 4. Deactivating someone (without deleting their data)

Never hard-delete a student who has submitted responses — the
immutability trigger (Phase 4) will actually block you from deleting
their questions/responses anyway, on purpose. Instead, deactivate:

```sql
update profiles set is_active = false, updated_at = now()
where email = 'the-persons-email@ahduni.edu.in';
```

This should also be doable from the professor's class roster page in the
UI (a toggle, per the Phase 3 report) — use that when possible instead of
raw SQL.

---

## 5. Starting a new semester / new class

1. Professor creates a new class in the app (or you do it for them).
2. Import that semester's roster (CSV/Excel) through the roster wizard.
3. Import that semester's Assignment 1 / Assignment 2 spreadsheets
   through the assignment import wizard — this reuses the same parser
   from Phase 1/4, so it should handle a similarly-shaped spreadsheet
   automatically. If the new spreadsheet has a meaningfully different
   layout, it may need a parser update — that's a Claude Code task, not
   something to force through manually.
4. Old classes from a previous semester: don't delete them, **archive**
   them (`status = 'ARCHIVED'` on the `classes` table, or an archive
   button in the UI if one exists) — this preserves historical data
   without it cluttering the active class list.

---

## 6. Applying a code/database update

When you (or a future Claude Code session) make a change:

```bash
cd "/run/media/kavish/New Volume/ProfJJ/app"   # or wherever the repo lives by then
git pull                                        # if changes came from elsewhere
npm install                                     # if package.json changed
npx supabase db push --dry-run                  # see what migrations are pending
npx supabase db push                            # apply them
npm run build                                   # confirm it still builds
```

**Never apply a migration you haven't read.** Even a one-line migration
can contain a destructive change — open the file, understand what it
does, before pushing to a database with real student data in it.

---

## 7. Where the important secrets live

- **`.env.local`** (on your machine, never in git) — Supabase URL, anon
  key, service role key, allowed email domain.
- **Supabase dashboard → Settings → API Keys** — where those keys come
  from originally; this is also where you'd rotate the service role key
  if it's ever been exposed (it has been, once, in this project's chat
  history — worth rotating before this handles real production data, if
  you haven't already).
- **Google Cloud Console → APIs & Services → Credentials** — the OAuth
  Client ID/Secret, entered into Supabase's Google provider settings.
- **Supabase database password** — set when you created the project;
  needed for `supabase link`. Store it in a password manager, not a file.

If you ever bring on a second developer, they need their own copy of
`.env.local` (never share the actual file) and their own `supabase login`
— credentials aren't meant to be shared verbatim.

---

## 8. When something breaks — the checklist that solved every bug today

In the order today's actual bugs were found, cheapest checks first:

1. **Check the browser console and the `npm run dev` terminal** for the
   actual error text — don't guess, read it.
2. **"Permission denied for table X"** → a GRANT is missing. Every table
   needs an explicit grant to `authenticated`/`service_role`, separate
   from RLS policies. See `supabase/migrations/0007_grant_table_privileges.sql`
   for the pattern.
3. **"Infinite recursion detected in policy"** → two RLS policies
   reference each other's tables directly. Fix: route through a
   `security definer` helper function instead of a raw subquery. See
   `supabase/migrations/0008_fix_rls_recursion.sql`.
4. **A trigger silently does nothing / "relation X does not exist"
   inside a trigger** → the function needs `set search_path = public`
   and every table reference needs to be `public.table_name`, not just
   `table_name`. See `supabase/migrations/0004_fix_trigger_search_path.sql`.
5. **A confusing "not authorized" message that doesn't make sense** →
   check whether the code is silently swallowing a real database error
   and mis-displaying it as an authorization failure. This happened
   multiple times today — always check `error`, never just `data`, from
   any Supabase call.
6. **"Functions cannot be passed to Client Components"** → a Server
   Component is passing a literal function as a prop to a `"use client"`
   component. Fix: pass a plain value (string/data) instead, or use a
   proper bound Server Action.

If none of these fit, the actual error message plus the query
`information_schema.triggers` / `pg_policies` (used repeatedly today) are
your best diagnostic tools before asking Claude Code to investigate.

---

## 9. Backups

Free-tier Supabase has **no automatic backups** — see
`docs/DEPLOYMENT.md` Section 4. Until you upgrade to Pro (optional,
$25/month, whenever you decide the free-tier cold-start delay stops being
acceptable), you are your own backup. Periodically:

```bash
npx supabase db dump -f backup-$(date +%Y%m%d).sql
```

Store that file somewhere other than the same external drive this
project lives on — ideally somewhere with its own versioning (even just
a separate cloud folder), given today's drive already had two unrelated
failures.

---

## 10. Yearly rhythm — a rough checklist

**Start of semester:**
- [ ] Create/reactivate the class for this semester
- [ ] Import the roster
- [ ] Import Assignment 1, review the question list, publish
- [ ] Confirm the professor can log in and see their class

**Mid-semester (between Assignment 1 and Assignment 2):**
- [ ] Close Assignment 1 if not already
- [ ] Nothing else required — this is the "teach outside the platform" gap

**Second assignment:**
- [ ] Import Assignment 2, review, publish
- [ ] Check the Analytics page shows real data

**End of semester:**
- [ ] Take a manual backup (Section 9)
- [ ] Archive the class (don't delete)
- [ ] Deactivate graduated/departed students rather than deleting them
