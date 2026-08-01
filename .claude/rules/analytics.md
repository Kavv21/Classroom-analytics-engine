# Rules: analytics

Applies whenever touching the analytics engine or any chart/query-builder
code.

- Formulas come from `/docs/ANALYTICS_DEFINITIONS.md`, verbatim. Don't
  reimplement from memory or "simplify" a formula.
- Every figure describes ONE assignment on its own, or compares the two
  assignments through their shared energy-source labels
  (`energy_source_assignment_change`). There is no per-student pairing of
  an A1 answer with an A2 answer: question mappings and the S00/S01/S10/S11
  transition engine were removed in migration 0022. Don't reintroduce a
  transition state, change rate, stability rate or net-shift metric without
  first defining in ANALYTICS_DEFINITIONS.md what makes two questions
  comparable.
- Consensus/disagreement/entropy are neutral descriptive stats. No copy,
  label, or color scheme may imply "correct," "better," or "learned."
- A rate over an empty denominator is NULL (unknown), never 0.
- Aggregate queries should hit PostgreSQL views/materialised views, not pull
  full response tables into the browser or into app memory.
