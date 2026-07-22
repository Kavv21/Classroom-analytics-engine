# Architecture

Written against what is actually built and verified, not the original
aspirational spec. Where the spec and the implementation diverge, the
divergence is stated.

## Shape

```
Browser ──▶ Next.js (App Router, Vercel) ──▶ Supabase (Postgres + GoTrue)
             server components / server actions / route handlers
```

There is no separate API service. Data access happens in three places
only:

1. **Server components** — read via `lib/supabase/server.ts`, which uses
   the anon key plus the caller's session cookie, so RLS applies.
2. **Server actions** (`lib/*/actions.ts`) — writes and privileged reads,
   same RLS-scoped client.
3. **Route handlers** (`app/**/route.ts`) — exports only.

`lib/supabase/admin.ts` (service-role) is used by tests and the seed
script. No page or action uses it.

## Layers

| Layer | Location | Notes |
|---|---|---|
| Schema, RLS, RPCs, views | `supabase/migrations/` | 15 migrations, forward-only |
| Domain types & formulas | `lib/types/domain.ts` | Metric formulas live here, mirrored by SQL views |
| Import parsing | `lib/imports/parse-grid.ts` | Pure; fails loudly on ambiguous rows |
| Roster | `lib/roster/` | Parse, classify, commit |
| Attempts | `lib/attempts/` | Autosave batching + local draft store |
| Mappings | `lib/mappings/` | Deterministic suggestions, approval, export |
| Analytics | `lib/analytics/` | View readers + pure chart shaping |
| Query builder | `lib/query-builder/` | Catalogue, validation, execution |
| Exports | `lib/exports/` | Excel / CSV / PDF + provenance |
| Charts | `lib/charts/theme.ts` | Validated palette; data-encoding colours |
| Design tokens | `app/globals.css`, `tailwind.config.ts` | Hand-authored |

## Key design decisions

**Analytics is computed on read.** All 14 analytics views (migrations
0012/0013) are plain views, not materialised. Consequence: figures are
always current with the latest responses and mapping approvals, and there
is no refresh step, no staleness window, and no cache invalidation.
Rationale and the alternative are documented in
`DATABASE_SCHEMA.md` → "Analytics views".

**The approved-mapping boundary is structural, not procedural.**
`approved_question_mappings` bakes `professor_approved = true` into the
view definition. Downstream code physically cannot read an unapproved
mapping through it — including `service_role`, which bypasses RLS but not
a view's WHERE clause.

**The query builder generates no SQL.** A builder query selects one of a
fixed set of views by lookup table (`lib/query-builder/execute.ts`), so
there is no injection surface and RLS always applies.

**Invariants live in the database.** Attempt-state transitions, question
immutability after responses, mapping immutability once load-bearing, and
the `response_value ∈ {0,1,NULL}` constraint are all enforced by triggers
and CHECK constraints that fire for every role — `service_role` included.
UI checks exist only to produce friendly errors earlier.

## Request path for a page load

Server components issue their reads in parallel (`Promise.all`) wherever
the queries are independent. This matters more than it looks: against
hosted Supabase each round-trip measured ~60 ms warm, so six sequential
reads cost ~360 ms of pure network wait before render. See
`TESTING.md` → "Performance findings".

## What is NOT in the architecture

- No admin UI. The only admin-specific capability is the
  `audit_logs_admin` RLS policy.
- No background jobs, queues, or cron. Nothing is scheduled.
- No caching layer, CDN data cache, or ISR on data pages — every
  analytics page is dynamic because it is user- and RLS-scoped.
- No websockets/realtime.
- No natural-language querying (explicitly excluded).
