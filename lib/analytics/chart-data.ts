import type { TransitionState } from "@/lib/types/domain";
import type {
  MappingTransitionSummary,
  QuestionResponseSummary,
} from "@/lib/analytics/queries";

/**
 * Pure, unit-tested shaping from Phase 7 view rows to chart-ready data.
 * No fetching, no ECharts imports — components feed these into options.
 *
 * Binary values are always presented as "0 — No" / "1 — Yes"; transition
 * states carry both digits and words; missing / not-comparable pairs are
 * their own buckets, never folded into an S-state or silently dropped.
 */

export const BINARY_LABELS = { zero: "0 — No", one: "1 — Yes" } as const;

export const TRANSITION_STATES: TransitionState[] = ["S00", "S01", "S10", "S11"];

export const TRANSITION_STATE_LABELS: Record<TransitionState, string> = {
  S00: "0 → 0 (No → No)",
  S01: "0 → 1 (No → Yes)",
  S10: "1 → 0 (Yes → No)",
  S11: "1 → 1 (Yes → Yes)",
};

export const QUALITY_KEYS = [
  "missing_a1",
  "missing_a2",
  "missing_both",
  "not_comparable",
] as const;

export const QUALITY_LABELS: Record<(typeof QUALITY_KEYS)[number], string> = {
  missing_a1: "No A1 answer",
  missing_a2: "No A2 answer",
  missing_both: "No answers",
  not_comparable: "Not comparable",
};

// ============================================================
// 17.2 — before/after: % choosing "1 — Yes" on each side, over valid pairs.
// ============================================================

export interface BeforeAfterPoint {
  mappingId: string;
  name: string;
  validPaired: number;
  pct1A1: number | null;
  pct1A2: number | null;
}

export function beforeAfterPoint(
  m: Pick<MappingTransitionSummary, "mapping_id" | "mapping_name" | "s01" | "s10" | "s11" | "valid_paired">
): BeforeAfterPoint {
  const valid = m.valid_paired;
  return {
    mappingId: m.mapping_id,
    name: m.mapping_name,
    validPaired: valid,
    pct1A1: valid > 0 ? (m.s10 + m.s11) / valid : null,
    pct1A2: valid > 0 ? (m.s01 + m.s11) / valid : null,
  };
}

// ============================================================
// Transition count totals (17.3 matrix, 17.5 sankey) across any subset of
// mapping summaries — sums only, no rate math here (rates come from the
// views / domain.ts, never re-derived in charts).
// ============================================================

export interface TransitionTotals {
  s00: number;
  s01: number;
  s10: number;
  s11: number;
  valid_paired: number;
  missing_a1: number;
  missing_a2: number;
  missing_both: number;
  not_comparable: number;
  missing_a2_from_0: number;
  missing_a2_from_1: number;
  missing_a1_to_0: number;
  missing_a1_to_1: number;
  pairs_considered: number;
}

export function sumTransitionCounts(
  summaries: Array<
    Pick<
      MappingTransitionSummary,
      | "s00" | "s01" | "s10" | "s11" | "valid_paired" | "pairs_considered"
      | "missing_a1" | "missing_a2" | "missing_both" | "not_comparable"
      | "missing_a2_from_0" | "missing_a2_from_1" | "missing_a1_to_0" | "missing_a1_to_1"
    >
  >
): TransitionTotals {
  const total: TransitionTotals = {
    s00: 0, s01: 0, s10: 0, s11: 0, valid_paired: 0,
    missing_a1: 0, missing_a2: 0, missing_both: 0, not_comparable: 0,
    missing_a2_from_0: 0, missing_a2_from_1: 0, missing_a1_to_0: 0,
    missing_a1_to_1: 0, pairs_considered: 0,
  };
  for (const m of summaries) {
    total.s00 += m.s00;
    total.s01 += m.s01;
    total.s10 += m.s10;
    total.s11 += m.s11;
    total.valid_paired += m.valid_paired;
    total.missing_a1 += m.missing_a1;
    total.missing_a2 += m.missing_a2;
    total.missing_both += m.missing_both;
    total.not_comparable += m.not_comparable;
    total.missing_a2_from_0 += m.missing_a2_from_0;
    total.missing_a2_from_1 += m.missing_a2_from_1;
    total.missing_a1_to_0 += m.missing_a1_to_0;
    total.missing_a1_to_1 += m.missing_a1_to_1;
    total.pairs_considered += m.pairs_considered;
  }
  return total;
}

/** 2×2 matrix cells for 17.3: rows = A1 value, cols = A2 value. */
export interface MatrixCell {
  a1: 0 | 1;
  a2: 0 | 1;
  state: TransitionState;
  count: number;
  pctOfValid: number | null;
}

export function transitionMatrixCells(
  t: Pick<TransitionTotals, "s00" | "s01" | "s10" | "s11" | "valid_paired">
): MatrixCell[] {
  const pct = (n: number) => (t.valid_paired > 0 ? n / t.valid_paired : null);
  return [
    { a1: 0, a2: 0, state: "S00", count: t.s00, pctOfValid: pct(t.s00) },
    { a1: 0, a2: 1, state: "S01", count: t.s01, pctOfValid: pct(t.s01) },
    { a1: 1, a2: 0, state: "S10", count: t.s10, pctOfValid: pct(t.s10) },
    { a1: 1, a2: 1, state: "S11", count: t.s11, pctOfValid: pct(t.s11) },
  ];
}

// ============================================================
// 17.12 — histogram of per-student change rates.
// ============================================================

export interface HistogramBin {
  start: number;
  end: number;
  label: string;
  count: number;
}

/** Fixed-width bins over [0, 1]; the final bin is inclusive of 1. */
export function histogramBins(values: Array<number | null>, binCount = 10): HistogramBin[] {
  if (binCount < 1) throw new Error("binCount must be >= 1");
  const width = 1 / binCount;
  const bins: HistogramBin[] = Array.from({ length: binCount }, (_, i) => ({
    start: i * width,
    end: (i + 1) * width,
    label: `${Math.round(i * width * 100)}–${Math.round((i + 1) * width * 100)}%`,
    count: 0,
  }));
  for (const value of values) {
    if (value === null || Number.isNaN(value)) continue;
    if (value < 0 || value > 1) continue;
    const index = Math.min(Math.floor(value / width), binCount - 1);
    bins[index]!.count += 1;
  }
  return bins;
}

// ============================================================
// Heatmap pivots (17.6, 17.7, 17.8).
// ============================================================

export interface HeatmapData {
  rowKeys: string[];
  colKeys: string[];
  /** [rowIndex, colIndex, value|null] triples for every combination. */
  cells: Array<[number, number, number | null]>;
}

export function pivotHeatmap<T>(
  rows: T[],
  rowOf: (t: T) => string,
  colOf: (t: T) => string,
  valueOf: (t: T) => number | null
): HeatmapData {
  const rowKeys = [...new Set(rows.map(rowOf))].sort();
  const colKeys = [...new Set(rows.map(colOf))].sort();
  const byKey = new Map<string, number | null>();
  for (const r of rows) {
    byKey.set(`${rowOf(r)}|${colOf(r)}`, valueOf(r));
  }
  const cells: Array<[number, number, number | null]> = [];
  for (let ri = 0; ri < rowKeys.length; ri++) {
    for (let ci = 0; ci < colKeys.length; ci++) {
      const v = byKey.get(`${rowKeys[ri]}|${colKeys[ci]}`);
      cells.push([ri, ci, v === undefined ? null : v]);
    }
  }
  return { rowKeys, colKeys, cells };
}

/** 17.6: energy source × criterion → % choosing "1 — Yes" per question. */
export function responseHeatmap(questions: QuestionResponseSummary[]): HeatmapData {
  const usable = questions.filter((q) => q.energy_source !== null && q.criterion !== null);
  return pivotHeatmap(
    usable,
    (q) => q.energy_source!,
    (q) => q.criterion!,
    (q) => q.pct_one
  );
}

// ============================================================
// Drill-down groupings (Section 21): energy source → criterion → mapping.
// The "(no criterion)" bucket keeps criterion-less mappings visible —
// they are real mappings, not data to drop.
// ============================================================

export const NO_CRITERION = "(no criterion)";
export const NO_SOURCE = "(no energy source)";

export interface DrilldownGroup<T> {
  key: string;
  items: T[];
  totals: TransitionTotals;
}

export function groupMappings(
  summaries: MappingTransitionSummary[],
  keyOf: (m: MappingTransitionSummary) => string
): Array<DrilldownGroup<MappingTransitionSummary>> {
  const groups = new Map<string, MappingTransitionSummary[]>();
  for (const m of summaries) {
    const key = keyOf(m);
    groups.set(key, [...(groups.get(key) ?? []), m]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => ({ key, items, totals: sumTransitionCounts(items) }));
}

export const bySource = (m: MappingTransitionSummary) => m.energy_source ?? NO_SOURCE;
export const byCriterion = (m: MappingTransitionSummary) => m.criterion ?? NO_CRITERION;
