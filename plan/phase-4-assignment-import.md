# Phase 4 — Assignment Import & Management

**Agent:** backend-owner + frontend-owner in parallel worktrees.
**Spec sections:** 9, 23, and Section 32 "Phase 4."

## Goal

Turn the Phase 1 manifests into real assignments the professor can review,
approve, and publish. Also generalise the spreadsheet-import pipeline for
any future assignment imports (not just the two seed ones).

## Tasks — backend-owner

- Assignment CRUD with fields/stages/statuses from
  `/docs/DATABASE_SCHEMA.md` "assignments" and "questions."
- Spreadsheet parser reused from Phase 1, exposed as an import pipeline:
  file-type/size validation, worksheet selection, header detection,
  merged/blank-cell handling, duplicate detection, row-level errors,
  rollback on critical failure, checksum, import history (Section 23).
- Publish/close/duplicate/archive assignment actions.
- Enforce: no destructive question edits once an assignment has responses
  (version instead — Section 24).

## Tasks — frontend-owner

- Assignment creation/import UI, including full question preview before
  publication.
- Explicit professor approval step before an import can be published
  (Section 4: "The professor must be required to approve the import").
- Question reorder, display-label editing.
- Submission-progress view for a professor.

## Definition of done

- A professor cannot publish an assignment without having seen and
  approved the full imported question list.
- Re-importing a corrected spreadsheet after a rejected import works
  cleanly (no orphaned partial data from the failed attempt).

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
