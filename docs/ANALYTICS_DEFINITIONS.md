# Analytics Definitions

These are descriptive statistics about opinions, not grades or correctness
judgements. Never label higher consensus as "correct" or lower consensus as
"failure." Display these definitions via tooltips in the UI.

## Removed: response transition states (migration 0022)

This document previously defined S00/S01/S10/S11, change rate, stability
rate, net movement toward 1, and percentage-point shift over paired
responses. All of them were defined **per professor-approved question
mapping** — the record that declared an Assignment 1 question and an
Assignment 2 question to be about the same thing.

Question mappings were removed in migration 0022, so there is no longer
any basis for pairing one student's two answers, and none of those metrics
is defined any more. They are not "temporarily unavailable" — the input
they were computed from does not exist. Do not reintroduce them without
first defining, here, what makes two questions comparable.

What survives is everything computable from a **single assignment**
(consensus, disagreement, entropy, response counts) plus the
**group count change** below, which compares the two assignments through
their shared energy-source labels rather than through a mapping.

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

Assignment, question, energy-source, criterion — each within a single
assignment. See the project plan (`/plan/phase-7-analytics.md`) for the
exact metric list per level — don't recompute from memory, copy from
there, and disregard any per-mapping or per-student-transition level it
still lists (removed in migration 0022).

## Implementation (Phase 7, migration 0012)

Everything above is implemented as PostgreSQL views computed on read
(never app-code loops over raw responses) — see
docs/DATABASE_SCHEMA.md "Analytics views (migration 0012)" for the view
list and the freshness contract. The TypeScript mirrors of the formulas
live in `lib/types/domain.ts` and are cross-checked against the SQL views
by the test in `tests/unit/analytics-definitions.test.ts` so neither can
drift.

One rule the implementation pins down explicitly:

- Rates over an empty denominator are NULL (unknown), never 0.

Section 18 material (Jaccard, Hamming, clustering, Phi, mutual
information, projection, network graph) is exploratory only:
views carry an `_exploratory` suffix, `lib/analytics` wraps results in
`{ exploratory: true, caveat }`, and the caveat must reach the UI —
similarity, cluster membership, or projection position is never a grade.
