# Analytics Definitions

These are descriptive statistics about opinions, not grades or correctness
judgements. Never label higher consensus as "correct" or lower consensus as
"failure." Display these definitions via tooltips in the UI.

## Response transition states

For a professor-approved comparable paired response:

```
S00 = 0 → 0
S01 = 0 → 1
S10 = 1 → 0
S11 = 1 → 1
```

For student i and mapping j: `T(i,j) = (A1(i,j), A2(i,j))` — both values
must be binary to produce S00–S11.

Missing/non-comparable data gets its own status, never forced into a
transition bucket:
```
MISSING_A1
MISSING_A2
MISSING_BOTH
NOT_COMPARABLE
```

## Core metrics

- Changed count: `S01 + S10`
- Unchanged count: `S00 + S11`
- Change rate: `(S01 + S10) / valid paired responses`
- Stability rate: `(S00 + S11) / valid paired responses`
- Net movement toward 1: `S01 - S10`
- Percentage-point shift: `% selecting 1 in A2 − % selecting 1 in A1`

Change rate and net shift are different things — don't conflate them.
Example: S01 = 30%, S10 = 27% → change rate = 57%, net shift = +3pp.

## Consensus / disagreement

- Simple consensus: `max(% selecting 0, % selecting 1)`
- Simple disagreement: `1 − consensus`
- Binary entropy: `H(p) = −p·log2(p) − (1−p)·log2(1−p)`

50/50 = max disagreement. 100/0 or 0/100 = min disagreement.

## Levels analytics must be computed at

Class, assignment, question, student, energy-source, criterion. See the
project plan (`/plan/phase-7-analytics.md`) for the exact metric list per
level — don't recompute from memory, copy from there.

## Implementation (Phase 7, migration 0012)

Everything above is implemented as PostgreSQL views computed on read
(never app-code loops over raw responses) — see
docs/DATABASE_SCHEMA.md "Analytics views (migration 0012)" for the view
list and the freshness contract. The TypeScript mirrors of the formulas
live in `lib/types/domain.ts` and are cross-checked against the SQL views
by the worked-example test in `tests/unit/analytics-definitions.test.ts`
so neither can drift.

Two rules the implementation pins down explicitly:

- T(i,j) needs exactly one binary value per side. Only the two one-to-one
  mapping types have that shape, so only they produce S00–S11. No collapse
  formula for multi-question sides is defined in this document — until one
  is added here, ONE_TO_MANY / MANY_TO_ONE / GROUPED_CONCEPT pairs are
  reported as `data_quality_status = NOT_COMPARABLE`, never guessed into a
  transition bucket.
- Rates over zero valid pairs are NULL (unknown), never 0.

Section 18 material (Jaccard, Hamming, clustering, Phi, mutual
information, projection, network graph, alluvial) is exploratory only:
views carry an `_exploratory` suffix, `lib/analytics` wraps results in
`{ exploratory: true, caveat }`, and the caveat must reach the UI —
similarity, cluster membership, or projection position is never a grade.
