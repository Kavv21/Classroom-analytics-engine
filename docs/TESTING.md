# Testing

## Commands

```bash
npm run lint
npm run typecheck
npm run test        # vitest: unit + integration (needs a Supabase target)
npm run test:e2e    # Playwright (needs local stack + seed)
npm run build
npm run verify:extraction
```

## Test targets — read this first

`npm run test` resolves its Supabase target from `SUPABASE_TEST_URL` /
`SUPABASE_TEST_ANON_KEY` / `SUPABASE_TEST_SERVICE_ROLE_KEY`, falling back
to `.env.local`. **The fallback is the hosted project.** For routine work
point it at the local stack:

```bash
npx supabase start && npx supabase db reset --local
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
SUPABASE_TEST_URL=$API_URL SUPABASE_TEST_ANON_KEY=$ANON_KEY \
  SUPABASE_TEST_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run test
```

E2E and load tests **refuse** to run against a non-local URL without an
explicit override, because the hosted project holds real data.

## Suite composition (verified 2026-08-10)

| Suite | Files | Tests |
|---|---|---|
| Unit | 31 | 326 without a database target |
| Integration | 6 | requires a local stack |
| Vitest total against `npx supabase start` | 37 | **435, all passing** |
| Playwright e2e | 4 | requires the local stack; not part of the four-command gate |

`npm run test` with no test-target variables set reports **6 failing
files** — the five integration suites plus `tests/unit/analytics-
definitions.test.ts`, which imports the same helper. That is the guard in
`tests/integration/helpers.ts` refusing to touch the hosted project, not a
regression. `npm run test:local` is the command that produces the 435
number above.

Unit coverage includes: binary/response validation, attempt-transition
FSM, every Section 16 formula, question grouping by energy source across
both spreadsheet orientations, the spreadsheet parser, export formatting
and CSV quoting, chart-data shaping, query-builder compatibility rules,
and the exploratory statistics.

It also covers the student answer grid in two files:
`tests/unit/answer-grid.test.tsx` (the grid is the source spreadsheet's
own layout in both orientations, a cell has exactly three reachable
states, keyboard navigation, and the accessible name of every cell) and
`tests/unit/no-auto-submit.test.tsx` (below). The shared
validate-everything-commit-only-if-valid core has its own file,
`tests/unit/commit-answers.test.ts`.

Integration coverage includes: class creation through RLS, roster import,
assignment import (including atomic rollback on a bad row), question
approval and publication, draft saving, submission, reopening,
resubmission, analytics generation against the real views, the Excel
export, and RLS access across professors/students.

`tests/integration/ta-scope.test.ts` covers the teaching-assistant
boundary as a 2×2 — {TA of class X, professor of class X} × {class X,
class Y}. A TA must match the professor on class X except on the two
exclusions (archiving/restoring/deleting/reassigning the class, and
managing other TAs), match a stranger on class Y, and change nothing for
the STUDENT role. Everything is asserted against the database through a
really signed-in client: what the UI renders is not evidence, so no
assertion in that file looks at it.

E2E covers the three workflows end to end in a browser: professor (class →
assignment → publish → analytics → export), student
(fill grid cells → **refresh mid-way** → review → submit → receipt →
reopened → resubmit),
and admin (audit-log access, absence of an admin UI, student
deactivation).

## Notable test-design decisions

**E2E authentication.** The app signs in with Google OAuth, which a
browser test cannot drive. `e2e/helpers.ts` mints a real session in Node
with `signInWithPassword` and lets `@supabase/ssr` serialise it into
cookies, capturing exactly what it would set and injecting that into the
browser context. Using the library's own serialiser means this survives
cookie-format changes.

**Assert content, not HTTP status, for `notFound()`.** `next dev` streams
`notFound()` with a 200 status while `next start` returns a real 404. E2E
tests assert the rendered 404 page *and* the absence of the professor's
data, which is the property that actually matters.

## Known flakiness

The integration files share one database and vitest runs files in
parallel. Under contention one test transiently failed once in ~5 full
runs (`student-flow`, attempt-state assertion). Three consecutive clean
175/175 runs followed. If it recurs, run with `--no-file-parallelism`.

## Performance findings (Phase 10 investigation)

Measured on the local stack with the demo seed and a 300-student /
78,150-response fixture.

**1. The dominant cause of "pages feel slow" was sequential awaits, not
the database.** Seven pages issued 3–6 dependent-looking-but-independent
queries one after another. Hosted Supabase round-trip measured **~60 ms
warm** (376 ms cold, including TLS). The assignment detail page's six
sequential reads therefore cost ~360 ms of pure network wait. Fixed by
batching independent reads with `Promise.all` in:
`classes/[classId]/assignments/[assignmentId]`, `assignments/[assignmentId]`
(student attempt), `classes/[classId]`, `assignments/[assignmentId]/review`,
`.../receipt`, and `assignments`. Genuinely dependent reads (attempt →
saved answers) were left sequential. (`/review` has since been folded into
the attempt page as the answer grid's review step; the batching on that
page survives it.)

**2. Stale planner statistics mattered more than missing indexes.** A
controlled experiment at seed scale (measured on `response_transitions_live`,
a view since removed in migration 0022 — the finding is about planner
statistics, not that view):

| Condition | Execution time |
|---|---|
| Fresh seed, no ANALYZE, no new indexes | 6.13 ms |
| After `ANALYZE` only | **1.20 ms** |
| After `ANALYZE` + new indexes | 1.51 ms |

An earlier "17–24× improvement" figure was an artifact of running
`ANALYZE` between the before/after measurements. Reported here corrected.
Autovacuum handles this in steady state; the risk window is immediately
after a bulk import.

**3. Indexes (migration 0015) are worth keeping but are not the fix.** At
300-student scale the measured view improved 37.6 → 29.3 ms
(~22%). They also close genuine gaps: `responses` had no
`assignment_id` index and `import_rows` had only a primary key. Point
lookups were already covered by existing indexes.

**4. Bundle sizes.** Most routes are 103–134 kB first-load JS. The four
analytics routes are **455–459 kB** because ECharts is statically
imported. Deferring it with `next/dynamic` was considered and rejected for
now: `next/dynamic` does not forward refs by default and `ChartCard`
needs its ref for `getEchartsInstance()` PNG export. Worth revisiting with
a ref-forwarding wrapper.

## Load tests (k6)

Run against the **local** stack only.

```bash
eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
LOAD_SUPABASE_URL=$API_URL LOAD_ANON_KEY=$ANON_KEY \
  LOAD_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY LOAD_PASSWORD=<pick one> \
  npx tsx load-tests/provision.ts 400
LOAD_SUPABASE_URL=$API_URL LOAD_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  npx tsx load-tests/reset.ts            # before each stateful scenario
k6 run -e SCENARIO=autosave -e VUS=400 load-tests/scenarios.js
```

`reset.ts` is mandatory before `autosave` and `submission_spike`: without
it the second run measures the FSM correctly refusing to save an
already-submitted attempt, which looks like a load failure but is correct
behaviour. (This caught us during the phase.)

### Results

| Scenario | 100 VU | 300 VU | 400 VU |
|---|---|---|---|
| Login (password grant) | 0.00% fail, p95 857 ms | — | 79.6% fail |
| Assignment load | 0.00% fail, p95 13.5 ms | — | 5.0% fail |
| Autosave | 0.00% fail, p95 14.6 ms | 0.00% fail, p95 12.6 ms | 0.003% fail, p95 187 ms |
| Submission spike | 0.00% fail, p95 308 ms | 10.3% fail, p95 855 ms | 19.3% fail, p95 863 ms |
| Analytics aggregates | 0.00% fail, p95 43.8 ms | — | 37.0% fail |

**Autosave — the dominant real-world load — is clean to 400 concurrent
users** (1 failure in 35,472 requests).

**Submission spike detail at 300 VU** (all 300 firing simultaneously with
zero ramp, the deliberate worst case):

- `get_or_create_attempt`: 79% success ← the bottleneck
- `save_attempt_responses`: 95% success
- **`submit_attempt`: 99% success** (237 of 239 reached `SUBMITTED`)

The submission RPC itself is robust; failures concentrate on connection
acquisition during the thundering herd.

### The binding constraint, and what it does and does not tell us

All high-concurrency failures trace to one thing: the local stack's
Postgres runs with `max_connections = 100` in a single container on a
laptop. Failing logins returned
`{"code":500,"error_code":"unexpected_failure","msg":"Database error querying schema"}`
— GoTrue exhausting its pool. Below ~150 concurrent, every scenario is
0% failure; 120 concurrent analytics reads succeeded 100%.

Two caveats that must not be glossed over:

1. **The login scenario does not model production.** Production sign-in is
   Google OAuth, not the password grant. Those numbers characterise the
   local GoTrue container, not real logins.
2. **Local capacity is not production capacity.** Supabase cloud fronts
   Postgres with a connection pooler (Supavisor) and the pool size depends
   on the plan. Whether 300 concurrent students are comfortable in
   production **cannot be determined from this machine** and must be
   re-run against staging. See `DEPLOYMENT.md`.
