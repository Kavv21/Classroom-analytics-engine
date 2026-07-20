# Phase 7 — Transition & Analytics Engine

**Agent:** backend-owner primarily (this is data-layer heavy); frontend
work here is limited to loading states/empty states, real charts come in
Phase 8.
**Spec sections:** 12, 15, 16, 18, and Section 32 "Phase 7." Reference:
`/docs/ANALYTICS_DEFINITIONS.md`.

## Goal

Compute S00/S01/S10/S11 transitions and every aggregate metric, exposed
through efficient queries (views/materialised views), for approved
mappings only.

## Tasks

- `response_transitions` generation job/query: for every approved mapping
  and student, compute transition_state or data_quality_status per the
  exact rules in `/docs/ANALYTICS_DEFINITIONS.md`.
- Class/assignment/question/student/energy-source/criterion level
  aggregates (full metric list in Section 15) as PostgreSQL views or
  materialised views — do not compute these by pulling raw rows into app
  code.
- Consensus, disagreement, binary entropy calculations.
- Section 18 advanced analytics (Jaccard, Hamming, clustering, Phi
  coefficient, mutual information, PCA/UMAP, network graph, alluvial) —
  build only after core analytics above are stable and tested. Label all
  of these as exploratory in any API response/metadata used by the
  frontend.

## Definition of done

- Unit tests cover: transition-state generation, change rate, stability
  rate, net shift, consensus, entropy — using the worked example from
  Section 12 (S01=30%, S10=27% -> change rate 57%, net shift +3pp) as a
  literal test case.
- Changing a mapping's approval status correctly includes/excludes it from
  aggregates without a manual recompute step.

## Verification

```bash
npm run lint && npm run typecheck && npm run test && npm run build
```
