# Phase 9 — Query Builder & Exports

**Agent:** backend-owner (export generation) + frontend-owner (query
builder UI) in parallel worktrees.
**Spec sections:** 20, 22, and Section 32 "Phase 9."

## Goal

The self-serve visual query builder and the full export system.

## Tasks — backend-owner

- Export generation: CSV, Excel (10 sheets per Section 22), PNG, SVG, PDF
  dashboard report.
- Every export embeds: class name, assignment name, generation timestamp,
  active filters, metric definitions, mapping version.
- `saved_queries` / `saved_visualisations` / `dashboards` / `dashboard_items`
  persistence.

## Tasks — frontend-owner

- Query builder UI: dataset selector, measure selector, group-by, filters,
  chart-type selector with compatibility validation (reject meaningless
  combinations — e.g. Sankey with no transition dimension selected).
- Chart preview + underlying data table.
- Save/load visualisations and dashboards.
- Export trigger UI per format.

## Definition of done

- An incompatible chart/dataset/measure combination is rejected in the UI
  with a clear message, not silently broken.
- A downloaded Excel export opens cleanly and contains all 10 required
  sheets with correct data.

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
