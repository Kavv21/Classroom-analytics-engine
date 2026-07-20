# Phase 6 — Mapping Studio

**Agent:** backend-owner + frontend-owner in parallel worktrees. Needs
Phases 3-5 complete (real question/response data to map against).
**Spec sections:** 6, and Section 32 "Phase 6." Reference:
`/docs/QUESTION_MAPPING.md`.

## Goal

The split-screen mapping interface and its approval workflow — the
gatekeeper for everything in Phase 7.

## Tasks — backend-owner

- `question_mappings` + `question_mapping_members` CRUD.
- Deterministic suggestion engine: exact normalised text match,
  energy-source match, criterion match, keyword overlap, configurable
  string similarity. No paid LLM, no auto-approval.
- Mapping versioning (don't destructively edit an approved mapping that
  analytics already depends on).
- Mapping export.

## Tasks — frontend-owner

- Split-screen UI: A1 questions left, A2 questions right, search by
  wording/energy source/concept/criterion.
- Multi-select across both sides, mapping-type picker, concept/notes
  fields.
- Analytics preview of what a mapping would show, before approval.
- Approve/reject controls, revision history view.

## Definition of done

- An unapproved mapping is provably invisible to analytics — write a test
  that creates an unapproved mapping and asserts it's excluded from every
  relevant query.
- All 7 mapping types (Section 6.2) are creatable and render correctly in
  the preview.

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
