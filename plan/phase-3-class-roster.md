# Phase 3 — Class & Roster Management

**Agent:** backend-owner (server actions/API) + frontend-owner (UI) can run
in parallel worktrees from here on, syncing against the frozen contract
from Phase 2.
**Spec sections:** 8, and Section 32 "Phase 3."

## Goal

Class CRUD, student roster import, enrolment.

## Tasks — backend-owner

- Class create/edit/archive server actions.
- CSV and Excel roster import: parsing, duplicate detection, validation.
- Bulk import pipeline: preview, validation, duplicate warnings,
  rejected-row report, final import summary (feeds into `imports` /
  `import_rows` tables — see Section 23, used again in Phase 4).
- Student activation/deactivation.

## Tasks — frontend-owner

- Class creation/edit/archive forms.
- Roster import UI: file upload, preview table, validation errors,
  duplicate warnings, downloadable rejection report, import summary.
- Class list / detail views for professor and admin.

## Definition of done

- Duplicate students in an uploaded roster are caught and reported, not
  silently imported.
- A partial import failure never leaves the DB in an inconsistent
  half-imported state (transactional import).

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
