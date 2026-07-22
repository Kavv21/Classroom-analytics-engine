# Security

What is actually enforced, and where. Anything aspirational is marked.

## Authentication

Google OAuth via Supabase Auth. Password sign-in exists in the database
but **no application UI uses it** — it is used only by the seed script,
integration tests, and load tests.

Pre-provisioning: a student must appear in `roster_entries` before their
first sign-in. `handle_new_user()` matches on email at first sign-in and
creates the `profiles` row. A signed-in user with no roster entry lands on
`/not-provisioned` and can see nothing else.

The `hd` parameter on the Google button is a UX hint only. The real domain
check is server-side in `handle_new_user()` against `app_config`.

## Authorisation — Row-Level Security

RLS is enabled on every table. Policies are the boundary; frontend role
checks are not.

Standing rules, learned from two real incidents in this project:

1. **No raw correlated subquery from one RLS-protected table into
   `classes` or `class_members`.** Doing so caused a genuine two-table
   policy cycle (Postgres `42P17`) — see `DATABASE_SCHEMA.md` §"RLS
   recursion". All such reaches go through `security definer` helpers
   (`is_professor_of_class`, `is_class_member`, `is_professor_of_student`,
   `owns_dashboard`).
2. **Every `SECURITY DEFINER` function sets `search_path = public` and
   schema-qualifies every table reference.** A definer function that
   resolves unqualified names via a caller-controlled `search_path` is a
   privilege-escalation vector.
3. **Every new table needs an explicit GRANT.** Migrations 0001–0006
   enabled RLS but never granted base privileges, making every table
   unreadable by every role including `service_role` (Postgres checks
   privileges *before* RLS). Fixed in 0007.

## Authorisation gaps closed during the build

- **`saved_queries` / `saved_visualisations` / `dashboards`** (fixed in
  migration 0014). The 0001 policies authorised on `created_by =
  auth.uid()` alone. Because a `FOR ALL` policy reuses its `USING`
  expression as the INSERT `WITH CHECK` when none is given, a professor
  could save a row whose `class_id` pointed at a class they did not own —
  making `class_id` an attacker-controlled value that any export path
  trusting it would turn into a cross-class read. Both clauses are now
  explicit and require `class_id is null or is_professor_of_class(class_id)`.

## Data boundaries that are structural, not procedural

- **Unapproved mappings cannot reach analytics.** The
  `approved_question_mappings` / `approved_question_mapping_members` views
  bake the approval filter into the relation. Verified by
  `tests/integration/mapping-flow.test.ts` for the professor role *and*
  for `service_role`.
- **Exports cannot cross classes.** Every export read uses the caller's
  RLS-scoped client; the route additionally checks ownership to return an
  honest 403 rather than an empty file. Verified in
  `tests/integration/exports-flow.test.ts`.
- **The query builder cannot be crafted into a cross-class read.** It
  selects from a fixed view lookup and re-validates every definition
  server-side.

## Immutability / destructive-edit protection

Enforced by triggers that fire for **every** role, `service_role`
included (it bypasses RLS, not triggers):

- Questions become immutable once any response exists (only
  `display_order` may change). Migration 0009.
- Mappings become immutable once approved or once
  `response_transitions` references them; version instead. Migration 0011.
- Attempt state transitions are checked against the exact FSM. Migration 0010.
- `response_value` is constrained to `0 | 1 | NULL` by CHECK.

## Audit logging

`audit_logs` has **no INSERT policy**. The only write path is
`log_audit_event()` (`SECURITY DEFINER`), which always stamps
`auth.uid()` as the actor — a caller cannot forge one. Read access is
limited to `role = 'ADMIN'`.

Logged: class creation, roster import, assignment import/publication,
attempt reopening, mapping create/update/approve/reject/version, exports.

## Secrets

Environment variables only; `.env*` is gitignored. The service-role key
appears in `lib/supabase/admin.ts`, the seed script, and tests — never in
a page, action, or client bundle. Demo credentials come from `SEED_*`
environment variables and are never committed.

## Known security limitations

- **No rate limiting** on server actions or route handlers. Supabase
  applies its own auth rate limits; the application adds none.
- **No CSRF token** beyond Next.js server actions' built-in origin check.
- **No admin UI**, so admin capabilities described in the original spec
  (user management, system settings) are unimplemented rather than
  protected.
- **No 2FA / session-revocation UI.**
- **Penetration testing has not been performed.** The RLS boundaries are
  covered by automated tests, which is not the same thing.
