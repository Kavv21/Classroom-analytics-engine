# Rules: analytics & transitions

Applies whenever touching the analytics engine, transition FSM, or any
chart/query-builder code.

- Formulas come from `/docs/ANALYTICS_DEFINITIONS.md`, verbatim. Don't
  reimplement from memory or "simplify" a formula.
- S00/S01/S10/S11 only apply when both A1 and A2 values are binary for an
  approved mapping. Missing/non-comparable pairs get a
  `data_quality_status`, never a fabricated transition state.
- Never present a mapping's data in analytics unless
  `question_mappings.professor_approved = true`.
- Change rate and net shift are distinct metrics — don't collapse them into
  one number or let the UI imply one from the other.
- Consensus/disagreement/entropy are neutral descriptive stats. No copy,
  label, or color scheme may imply "correct," "better," or "learned."
- Aggregate queries should hit PostgreSQL views/materialised views, not pull
  full response tables into the browser or into app memory.
