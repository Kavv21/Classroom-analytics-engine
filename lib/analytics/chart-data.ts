import type { QuestionResponseSummary } from "@/lib/analytics/queries";

/**
 * Pure, unit-tested shaping from Phase 7 view rows to chart-ready data.
 * No fetching, no ECharts imports — components feed these into options.
 *
 * Binary values are always presented as "0 — No" / "1 — Yes". Blank answers
 * are their own bucket wherever they are counted, never folded into 0.
 *
 * The transition shaping that used to live here (transition-state labels,
 * 2x2 matrix cells, per-mapping totals, the change-rate histogram) went
 * with the question-mapping feature in migration 0022 — it had no data
 * source left once the paired views were dropped.
 */

export const BINARY_LABELS = { zero: "0 — No", one: "1 — Yes" } as const;

// ============================================================
// Heatmap pivots (17.6).
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

/** Grouping buckets that keep unlabelled rows visible rather than dropped. */
export const NO_CRITERION = "(no criterion)";
export const NO_SOURCE = "(no energy source)";
