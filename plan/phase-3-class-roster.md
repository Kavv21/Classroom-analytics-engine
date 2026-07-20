# Phase 3 — Class & Roster Management

**Agent:** backend-owner (server actions/API) + frontend-owner (UI) can run
in parallel worktrees from here on, syncing against the frozen contract
from Phase 2.
**Spec sections:** 8, and Section 32 "Phase 3."

## Goal

Class CRUD, student roster import, enrolment.

## Deviation from original plan (see docs/DATABASE_SCHEMA.md#roster_entries)

Roster import writes to `roster_entries` (email, intended_role, class_id,
roll_number, full_name, programme, year_of_study, section), **not**
directly to `profiles`. `profiles` rows are created only by
`handle_new_user()` at a student's first Google sign-in (migration 0002).
This has one consequence worth knowing before touching this code again:
`roster_entries.email` is globally unique, so a student who already has a
`profiles` row (via another class) or an existing pending `roster_entries`
row (pending for another class) can't get a second `roster_entries` row.
Import handles both cases explicitly rather than guessing — see the
`RosterRowClassification` branches documented in
docs/DATABASE_SCHEMA.md#roster_entries and lib/roster/validate.ts.

## Tasks — backend-owner (done)

- Class create/edit/archive server actions — lib/classes/actions.ts,
  lib/classes/schema.ts.
- CSV and Excel roster import: parsing (lib/roster/parse.ts), validation
  and duplicate detection (lib/roster/validate.ts).
- Bulk import pipeline: preview (`previewRosterImport`) then commit
  (`commitRosterImport`), both in lib/roster/actions.ts. Commit re-parses
  and re-classifies server-side rather than trusting the client's preview,
  and calls the `commit_roster_import` RPC (migration 0005) so the whole
  write (imports + import_rows + roster_entries/class_members) is one
  transaction — a failure rolls back everything, including the `imports`
  row itself.
- Student activation/deactivation — `set_student_active` RPC (migration
  0005) + `setStudentActive` action, wired into the class detail page's
  roster table.

## Tasks — frontend-owner (done)

- Class creation/edit/archive forms — app/classes/new,
  components/classes/class-form.tsx, archive-button.tsx.
- Roster import UI — app/classes/[classId]/roster/import,
  components/roster/roster-import-wizard.tsx (file upload, preview table,
  validation/duplicate badges, downloadable rejection report CSV, import
  summary).
- Class list / detail views — app/classes/page.tsx,
  app/classes/[classId]/page.tsx (roster table with per-student
  activate/deactivate).

Admin views were not built in this pass — DATABASE_SCHEMA.md's admin RLS
note ("system-level management per explicit policies, not blanket access")
still applies whenever that's picked up.

## Definition of done

- Duplicate students in an uploaded roster are caught and reported, not
  silently imported. ✅ `RosterRowClassification` (DUPLICATE_IN_FILE /
  DUPLICATE_ALREADY_IN_CLASS / DUPLICATE_PENDING_OTHER_CLASS), surfaced in
  the preview table before commit.
- A partial import failure never leaves the DB in an inconsistent
  half-imported state (transactional import). ✅ via `commit_roster_import`.

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
