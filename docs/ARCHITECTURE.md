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
| Schema, RLS, RPCs, views | `supabase/migrations/` | 22 migrations, forward-only |
| Domain types & formulas | `lib/types/domain.ts` | Metric formulas live here, mirrored by SQL views |
| Import parsing | `lib/imports/parse-grid.ts` | Pure; fails loudly on ambiguous rows |
| Roster | `lib/roster/` | Parse, classify, commit |
| Attempts | `lib/attempts/` | Autosave batching + local draft store |
| Analytics | `lib/analytics/` | View readers + pure chart shaping |
| Query builder | `lib/query-builder/` | Catalogue, validation, execution |
| Exports | `lib/exports/` | Excel / CSV / PDF + provenance |
| Charts | `lib/charts/theme.ts` | Validated palette; data-encoding colours |
| Design tokens | `app/globals.css`, `tailwind.config.ts` | Hand-authored |

## Key design decisions

**Analytics is computed on read.** The analytics views (migrations
0012/0013/0017) are plain views, not materialised. Consequence: figures
are always current with the latest responses, and there is no refresh
step, no staleness window, and no cache invalidation. Rationale and the
alternative are documented in `DATABASE_SCHEMA.md` → "Analytics views".

**Analytics is single-assignment.** Question mappings and the transition
engine built on them were removed in migration 0022. Every figure now
describes one assignment on its own, except `energy_source_assignment_change`,
which compares the two assignments through their shared energy-source
labels — no per-student pairing of an A1 answer with an A2 answer exists
anywhere. See `ANALYTICS_DEFINITIONS.md` → "Removed: response transition
states".

**The query builder generates no SQL.** A builder query selects one of a
fixed set of views by lookup table (`lib/query-builder/execute.ts`), so
there is no injection surface and RLS always applies.

**Individual answers have exactly one surface.** The assignment response
grid (`lib/exports/response-grid.ts`, the `/grid` page, and the `Grid — …`
Excel sheets) is aggregate-only: per-question class totals in the source
spreadsheet's column order, plus a per-energy-source rollup, all read from
`question_response_summary` / `energy_source_response_summary`. It holds no
student rows. One student's raw 0/1 answers are read by
`lib/analytics/student-responses.ts` and shown only on that student's
profile page (`/classes/:id/analytics/students/:studentId`) — the single
place in the app a per-person answer appears.

**Invariants live in the database.** Attempt-state transitions, question
immutability after responses, the `is_synthetic` flag authority, and
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
