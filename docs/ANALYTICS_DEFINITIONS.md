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

## Group count change (migration 0017)

For a group of questions (currently: one energy source) compared across the
two assignments, over final responses of active students:

```
A1 ones = count of responses with value 1 on the group's Assignment 1 questions
A2 ones = count of responses with value 1 on the group's Assignment 2 questions

Absolute count change = A2 ones − A1 ones
Relative count change = (A2 ones − A1 ones) / A1 ones
```

Two rules are part of the definition, not implementation detail:

- **Relative count change is NULL when `A1 ones = 0`**, and NULL when the
  group appears in only one of the two assignments. A zero baseline has no
  defined relative change; it is reported as `—`, never as 0%, 100%, or
  infinity. (Same principle as "rates over zero valid pairs are NULL".)
- **A group present in only one assignment keeps NULL on the absent side.**
  It is neither dropped nor zero-filled — a question nobody was asked did
  not receive zero ones.

Relative count change and percentage-point shift are **different
measurements** and neither may be presented as the other: the first is
relative to the A1 count and unbounded, the second is a difference of two
rates expressed in percentage points. Both describe direction of movement
only.

Implemented as `energy_source_assignment_change`, which is built on top of
`energy_source_response_summary` rather than recomputing the per-assignment
counts. Because energy-source labels are stored verbatim from the source
spreadsheets (A2's sheet has `"Solar "` where A1 has `"Solar"`), the view
joins the two sides on `btrim(energy_source)` and carries both raw labels
through unchanged.

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
