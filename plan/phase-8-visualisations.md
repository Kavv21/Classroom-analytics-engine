# Phase 8 — Visualisations

**Agent:** frontend-owner, worktree-per-chart-group is reasonable here
since charts 17.1-17.14 are largely independent once the Phase 7 analytics
API exists.
**Spec sections:** 17, 19, 21, 25, and Section 32 "Phase 8."

## Goal

Build all 14 required chart types (Section 17.1-17.14) plus the professor
dashboard pages that host them (Section 19), with drill-down (Section 21)
and accessibility (Section 25).

## Tasks

- Implement each of 17.1-17.14 with Apache ECharts, backed by the Phase 7
  analytics API. Include filters described per chart (question, energy
  source, criterion, section, etc.).
- Every chart: hover tooltips, click-to-filter, sort/search/pagination
  where applicable, reset filters, an accessible data-table view, export.
- Drill-down chain per Section 21 example, with breadcrumbs and reset.
- Assemble the professor dashboard pages: Overview, Assignment Analytics,
  Mapping Studio (built in Phase 6, linked here), Transition Analytics,
  Student Analytics, Visualisation Builder (scaffolded here, completed in
  Phase 9).
- Accessibility pass: keyboard nav, focus indicators, contrast,
  screen-reader labels, non-colour indicators in every chart, "0 — No" /
  "1 — Yes" style labeling wherever a binary value is shown.

## Definition of done

- Every chart has a working accessible-table fallback, not just a canvas.
- No chart or copy implies correctness/grading (spot-check against Section
  16's rule).

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
