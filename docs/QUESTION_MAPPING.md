# Question Mapping Module

Assignment 1 and Assignment 2 are structurally different question sets.
Never assume a 1:1 relationship exists — the mapping module is how the
professor declares comparability, and nothing downstream trusts an
unapproved mapping.

## Mapping types

```
EXACT_ONE_TO_ONE
CONCEPTUAL_ONE_TO_ONE
ONE_TO_MANY
MANY_TO_ONE
GROUPED_CONCEPT
NOT_COMPARABLE
UNMAPPED
```

## Mapping record fields

id, assignment_1_question_ids[], assignment_2_question_ids[], mapping_name,
common_concept, energy_source, criterion, mapping_type, comparison_method,
professor_notes, mapping_status, professor_approved, created_at, updated_at

## Workflow (professor-facing)

1. Split-screen: all A1 questions on the left, all A2 questions on the right
2. Search by wording / energy source / concept / criterion
3. Select one or more questions from either side
4. Assign a common concept, pick mapping type, add a note
5. Preview how the mapping affects analytics before approving
6. Approve or reject; mappings can be revised later (version, don't
   destructively edit once responses depend on it)
7. Export the complete mapping table

## Mapping suggestions

Deterministic only — exact normalised text match, energy-source match,
criterion match, keyword overlap, configurable string similarity.
No paid LLM. Suggestions are never auto-approved.

Implementation (Phase 6): `lib/mappings/suggest.ts`. Seeding
(`seedMappingSuggestions` in `lib/mappings/actions.ts`) replays
`data/question-mapping-template.json` — the matching already validated
against the real spreadsheets (11 renewable-concept pairs across the
common energy sources, NOT_COMPARABLE groups for the 4 sources unique to
each assignment, needs-review entries for the Conventional criterion) —
against the class's real `questions` rows by external code, then adds any
extra matches from the generic engine. An unresolvable template code
fails the whole seed loudly. Re-running is idempotent (existing question
sets / names are skipped).

## Versioning

An approved mapping — or one that `response_transitions` already
references — can never be destructively edited or deleted; the 0011
triggers enforce this for every role (same pattern as the Phase 4
question-immutability trigger). `create_mapping_version` copies it into a
fresh DRAFT (version + 1); the old version stays live in analytics until
the new one is approved, at which point it flips to SUPERSEDED and drops
out of the approved views. See docs/DATABASE_SCHEMA.md#question_mappings.

## Hard rule

No mapped comparison appears anywhere in production analytics until
`professor_approved = true`. This is enforced at the query layer, not just
hidden in the UI: downstream code reads mappings only through the
`approved_question_mappings` / `approved_question_mapping_members` views
(migration 0011), which bake the approved filter into the relation itself
— even service_role cannot see an unapproved mapping through them.
Covered by the ACCEPTANCE block in tests/integration/mapping-flow.test.ts.
