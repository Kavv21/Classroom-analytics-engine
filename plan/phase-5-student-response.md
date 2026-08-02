# Phase 5 — Student Response Workflow

**Agent:** backend-owner + frontend-owner in parallel worktrees.
**Spec sections:** 10, 11, and Section 32 "Phase 5."

> **Superseded UI (2026-08-02).** The answering surface described below —
> one question at a time with previous/next navigation, plus the CSV
> download/upload wizard added later — was replaced by a single live grid:
> the source spreadsheet reproduced in the browser with editable 0/1 cells
> (`components/attempts/answer-grid.tsx`). Everything else in this phase
> stands and is still in force: the state machine, the debounced batched
> autosave, local persistence and the retry queue, the review step before
> an explicit confirmation, the receipt, reopening — and the
> no-auto-submit rule, whose tests moved to the grid component. See
> `docs/ARCHITECTURE.md` → "One answering surface: the live grid".

## Goal

The actual assignment-taking experience: binary answers, autosave, review,
submission, reopening. No anti-cheat, no monitoring — see
`/docs/EXCLUDED_FEATURES.md`.

## Tasks — backend-owner

- Attempt state machine enforcement server-side (exact transitions from
  `/docs/DATABASE_SCHEMA.md` — reject anything else).
- Debounced autosave endpoint: idempotent updates, no write-per-click.
- Final submission: DB transaction, duplicate-submission prevention.
- Reopen-attempt action (professor-triggered), with `reopened_by` /
  `reopened_at` / `submission_version` bookkeeping.

## Tasks — frontend-owner

- Assignment-taking UI: large binary controls, question numbering,
  progress/answered/unanswered counts, save-status indicator (Saving /
  Saved / Save failed), previous/next nav.
- Local persistence + retry queue for unsynchronised changes, so a refresh
  or brief disconnect never loses answers.
- Review page with explicit final confirmation, then a submission receipt.
- Draft restoration on return to an in-progress assignment.
- Confirm: no automatic submission on tab-switch, blur, refresh,
  fullscreen-exit, or disconnect — this is a hard exclusion, verify by
  testing each of those actions manually.

## Definition of done

- Simulate flaky network in dev and confirm no answers are lost and no
  duplicate submissions occur.
- Every excluded behavior in Section 10 (tab-switch etc.) is explicitly
  tested to confirm it does NOT trigger submission.

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
