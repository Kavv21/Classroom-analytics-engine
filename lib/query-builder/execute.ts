import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DIMENSIONS,
  MEASURES,
  type DimensionId,
  type MeasureId,
  type QueryDefinition,
} from "@/lib/query-builder/schema";
import { validateQuery, summariseIssues } from "@/lib/query-builder/validate";
import {
  QUALITY_LABELS,
  TRANSITION_STATE_LABELS,
} from "@/lib/analytics/chart-data";
import { questionLabelWithCode } from "@/lib/ui/question-label";

/**
 * Executes a validated builder query by reading ONE of the Phase 7/8
 * views through the caller's own Supabase client.
 *
 * Three properties this design gives for free, all of which the phase's
 * acceptance criteria depend on:
 *
 *  1. No SQL is generated from user input — the query only ever selects a
 *    view from a fixed lookup table, so there is no injection surface.
 *  2. RLS applies to every read, because the caller's client is used.
 *    A professor cannot read another professor's class through the
 *    builder even if they hand-craft a class id.
 *  3. The approved-mapping boundary is structural: every transition view
 *    is built on `approved_question_mappings`, so an unapproved mapping
 *    cannot appear in a builder result or an export derived from one.
 *
 * Aggregation stays in PostgreSQL (.claude/rules/analytics.md). Where a
 * grain has no dedicated view — grouping questions by concept, or rolling
 * mapping rows up into transition-state totals — the rollup is a sum over
 * an already-aggregated view (tens to hundreds of rows), never a pull of
 * raw response tables.
 */

export interface QueryResultRow {
  /** Dimension values in the order of `query.dimensions`. */
  keys: string[];
  value: number | null;
}

export interface QueryResult {
  columns: string[];
  rows: QueryResultRow[];
  /** The view(s) the numbers actually came from — shown in exports. */
  sources: string[];
  measure: MeasureId;
  dimensions: DimensionId[];
  rowCount: number;
}

export class QueryValidationError extends Error {
  constructor(public readonly issues: string) {
    super(issues);
    this.name = "QueryValidationError";
  }
}

interface ViewRow {
  [column: string]: unknown;
}

async function readView(
  supabase: SupabaseClient,
  view: string,
  filters: Record<string, string>
): Promise<ViewRow[]> {
  let q = supabase.from(view).select("*");
  for (const [column, value] of Object.entries(filters)) {
    q = q.eq(column, value);
  }
  const { data, error } = await q;
  if (error) {
    throw new Error(`could not read ${view}: ${error.message}`);
  }
  return (data ?? []) as ViewRow[];
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown, fallback = "—"): string {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
}

/** Which view answers this (dataset, dimension) grain. */
function sourceViewFor(query: QueryDefinition): { view: string; assignmentScoped: boolean } {
  const primary = query.dimensions[0];
  switch (query.dataset) {
    case "A1_RESPONSES":
    case "A2_RESPONSES":
      if (primary === "ENERGY_SOURCE") {
        return { view: "energy_source_response_summary", assignmentScoped: true };
      }
      if (primary === "CRITERION") {
        return { view: "criterion_response_summary", assignmentScoped: true };
      }
      return { view: "question_response_summary", assignmentScoped: true };
    case "PAIRED_TRANSITIONS":
      if (primary === "STUDENT") {
        return { view: "student_transition_summary", assignmentScoped: false };
      }
      if (primary === "ENERGY_SOURCE" && query.dimensions.length === 1) {
        return { view: "energy_source_transition_summary", assignmentScoped: false };
      }
      if (primary === "CRITERION" && query.dimensions.length === 1) {
        return { view: "criterion_transition_summary", assignmentScoped: false };
      }
      return { view: "mapping_transition_summary", assignmentScoped: false };
    case "ATTEMPTS":
      return { view: "assignment_submission_progress", assignmentScoped: false };
    case "SUBMISSIONS":
      return { view: "submission_timeline", assignmentScoped: false };
  }
}

/** Column on the source view that carries a given dimension's key. */
const DIMENSION_COLUMNS: Partial<Record<DimensionId, string>> = {
  QUESTION: "external_question_code",
  ENERGY_SOURCE: "energy_source",
  CRITERION: "criterion",
  CONCEPT: "concept",
  MAPPING: "mapping_name",
  STUDENT: "student_id",
  ASSIGNMENT: "assignment_id",
  DATE: "submission_date",
};

/** Column on the source view that carries a given measure. */
const MEASURE_COLUMNS: Partial<Record<MeasureId, string>> = {
  RESPONSE_COUNT: "answered",
  PCT_ONE: "pct_one",
  PCT_ZERO: "pct_zero",
  CONSENSUS: "consensus",
  DISAGREEMENT: "disagreement",
  ENTROPY: "entropy",
  PAIR_COUNT: "pairs_considered",
  VALID_PAIRS: "valid_paired",
  CHANGE_RATE: "change_rate",
  STABILITY_RATE: "stability_rate",
  NET_MOVEMENT: "net_movement_toward_1",
  PCT_POINT_SHIFT: "pct_point_shift",
  SUBMISSION_COUNT: "submissions",
  CUMULATIVE_SUBMISSIONS: "cumulative_submissions",
};

const ATTEMPT_STATE_COLUMNS: Array<[label: string, column: string]> = [
  ["Not started", "not_started_count"],
  ["Draft", "draft_count"],
  ["Submitted", "submitted_count"],
  ["Reopened", "reopened_count"],
  ["Resubmitted", "resubmitted_count"],
];

const TRANSITION_STATE_COLUMNS: Array<[label: string, column: string]> = [
  [TRANSITION_STATE_LABELS.S00, "s00"],
  [TRANSITION_STATE_LABELS.S01, "s01"],
  [TRANSITION_STATE_LABELS.S10, "s10"],
  [TRANSITION_STATE_LABELS.S11, "s11"],
];

const DATA_QUALITY_COLUMNS: Array<[label: string, column: string]> = [
  [QUALITY_LABELS.missing_a1, "missing_a1"],
  [QUALITY_LABELS.missing_a2, "missing_a2"],
  [QUALITY_LABELS.missing_both, "missing_both"],
  [QUALITY_LABELS.not_comparable, "not_comparable"],
];

export interface ExecuteContext {
  classId: string;
  /** assignment id per sequence number, for the response datasets. */
  assignmentIdBySequence: Record<number, string | undefined>;
  /** display names for the STUDENT dimension. */
  studentNames?: Record<string, string>;
  /** display names for the ASSIGNMENT dimension. */
  assignmentTitles?: Record<string, string>;
}

export async function executeQuery(
  supabase: SupabaseClient,
  query: QueryDefinition,
  context: ExecuteContext
): Promise<QueryResult> {
  // The server re-validates: a definition can arrive from a saved row or
  // a crafted request, not just from the UI that validated it once.
  const validation = validateQuery(query);
  if (!validation.valid) {
    throw new QueryValidationError(summariseIssues(validation));
  }

  const { view, assignmentScoped } = sourceViewFor(query);

  const viewFilters: Record<string, string> = { class_id: context.classId };
  if (assignmentScoped) {
    const sequence = query.dataset === "A1_RESPONSES" ? 1 : 2;
    const assignmentId = context.assignmentIdBySequence[sequence];
    if (!assignmentId) {
      return {
        columns: [...query.dimensions.map((d) => DIMENSIONS[d].label), MEASURES[query.measure].label],
        rows: [],
        sources: [view],
        measure: query.measure,
        dimensions: query.dimensions,
        rowCount: 0,
      };
    }
    viewFilters.assignment_id = assignmentId;
  }

  const raw = await readView(supabase, view, viewFilters);

  // Apply the builder's own filters against the view's columns.
  const filtered = raw.filter((row) =>
    query.filters.every((f) => {
      const column = DIMENSION_COLUMNS[f.dimension];
      if (!column) return true;
      return str(row[column]) === f.value;
    })
  );

  const labelFor = (dimension: DimensionId, row: ViewRow): string => {
    if (dimension === "STUDENT") {
      const id = str(row.student_id);
      return context.studentNames?.[id] ?? `Student ${id.slice(0, 8)}`;
    }
    if (dimension === "ASSIGNMENT") {
      const id = str(row.assignment_id);
      return context.assignmentTitles?.[id] ?? id.slice(0, 8);
    }
    if (dimension === "QUESTION") {
      // A result key is one string, and it becomes a chart category, a table
      // cell and an exported CSV cell. Wording leads; the code follows in
      // brackets so a row is still traceable to the answer sheet.
      return questionLabelWithCode({
        questionText: row.question_text as string | null | undefined,
        energySource: row.energy_source as string | null | undefined,
        criterion: row.criterion as string | null | undefined,
        code: row.external_question_code as string | null | undefined,
      });
    }
    const column = DIMENSION_COLUMNS[dimension];
    return column ? str(row[column]) : "—";
  };

  const rows: QueryResultRow[] = [];

  // Dimensions whose values live in COLUMNS rather than rows have to be
  // unpivoted; everything else is a straight projection or a sum.
  const unpivot = query.dimensions.find(
    (d) => d === "TRANSITION_STATE" || d === "DATA_QUALITY" || d === "ATTEMPT_STATE"
  );

  if (unpivot) {
    const columns =
      unpivot === "TRANSITION_STATE"
        ? TRANSITION_STATE_COLUMNS
        : unpivot === "DATA_QUALITY"
          ? DATA_QUALITY_COLUMNS
          : ATTEMPT_STATE_COLUMNS;
    const others = query.dimensions.filter((d) => d !== unpivot);

    const buckets = new Map<string, { keys: string[]; totals: Map<string, number> }>();
    for (const row of filtered) {
      const otherKeys = others.map((d) => labelFor(d, row));
      const bucketKey = otherKeys.join(" ");
      const bucket = buckets.get(bucketKey) ?? { keys: otherKeys, totals: new Map() };
      for (const [label, column] of columns) {
        bucket.totals.set(label, (bucket.totals.get(label) ?? 0) + (num(row[column]) ?? 0));
      }
      buckets.set(bucketKey, bucket);
    }

    for (const bucket of buckets.values()) {
      for (const [label] of columns) {
        const keys = query.dimensions.map((d) =>
          d === unpivot ? label : bucket.keys[others.indexOf(d)] ?? "—"
        );
        rows.push({ keys, value: bucket.totals.get(label) ?? 0 });
      }
    }
  } else {
    const measureColumn = MEASURE_COLUMNS[query.measure];
    const measureSpec = MEASURES[query.measure];

    // Group rows that share a key. A rate cannot be averaged across
    // groups without its denominator, so rates are recomputed from the
    // component counts; counts are summed.
    const buckets = new Map<
      string,
      { keys: string[]; sum: number; parts: Record<string, number>; rowCount: number }
    >();

    for (const row of filtered) {
      const keys = query.dimensions.map((d) => labelFor(d, row));
      const bucketKey = keys.join(" ");
      const bucket =
        buckets.get(bucketKey) ??
        { keys, sum: 0, parts: { s00: 0, s01: 0, s10: 0, s11: 0, valid: 0, zeros: 0, ones: 0, answered: 0 }, rowCount: 0 };

      bucket.sum += measureColumn ? (num(row[measureColumn]) ?? 0) : 0;
      bucket.parts.s00! += num(row.s00) ?? 0;
      bucket.parts.s01! += num(row.s01) ?? 0;
      bucket.parts.s10! += num(row.s10) ?? 0;
      bucket.parts.s11! += num(row.s11) ?? 0;
      bucket.parts.valid! += num(row.valid_paired) ?? 0;
      bucket.parts.zeros! += num(row.zeros) ?? 0;
      bucket.parts.ones! += num(row.ones) ?? 0;
      bucket.parts.answered! += num(row.answered) ?? 0;
      bucket.rowCount += 1;
      buckets.set(bucketKey, bucket);
    }

    for (const bucket of buckets.values()) {
      let value: number | null;
      if (!measureSpec.isRate) {
        value = bucket.sum;
      } else if (bucket.rowCount === 1) {
        // Exactly one view row backs this group — use the view's own
        // number rather than recomputing it, so the builder and the
        // Phase 8 charts always agree to the last decimal.
        const single = filtered.find(
          (r) => query.dimensions.map((d) => labelFor(d, r)).join(" ") === bucket.keys.join(" ")
        );
        value = measureColumn && single ? num(single[measureColumn]) : null;
      } else {
        value = recomputeRate(query.measure, bucket.parts);
      }
      rows.push({ keys: bucket.keys, value });
    }
  }

  rows.sort((a, b) => a.keys.join("|").localeCompare(b.keys.join("|")));

  return {
    columns: [...query.dimensions.map((d) => DIMENSIONS[d].label), MEASURES[query.measure].label],
    rows,
    sources: [view],
    measure: query.measure,
    dimensions: query.dimensions,
    rowCount: rows.length,
  };
}

/**
 * Rates pooled across several view rows, recomputed from their component
 * counts. Averaging pre-computed rates would weight a 3-student mapping
 * the same as a 300-student one; these formulas are
 * docs/ANALYTICS_DEFINITIONS.md applied to the pooled counts. A rate over
 * an empty denominator is null (unknown), never 0.
 */
function recomputeRate(measure: MeasureId, parts: Record<string, number>): number | null {
  const valid = parts.valid ?? 0;
  const answered = parts.answered ?? 0;
  switch (measure) {
    case "CHANGE_RATE":
      return valid > 0 ? ((parts.s01 ?? 0) + (parts.s10 ?? 0)) / valid : null;
    case "STABILITY_RATE":
      return valid > 0 ? ((parts.s00 ?? 0) + (parts.s11 ?? 0)) / valid : null;
    case "PCT_POINT_SHIFT":
      return valid > 0 ? ((parts.s01 ?? 0) - (parts.s10 ?? 0)) / valid : null;
    case "PCT_ONE":
      return answered > 0 ? (parts.ones ?? 0) / answered : null;
    case "PCT_ZERO":
      return answered > 0 ? (parts.zeros ?? 0) / answered : null;
    case "CONSENSUS":
      return answered > 0
        ? Math.max((parts.zeros ?? 0) / answered, (parts.ones ?? 0) / answered)
        : null;
    case "DISAGREEMENT":
      return answered > 0
        ? 1 - Math.max((parts.zeros ?? 0) / answered, (parts.ones ?? 0) / answered)
        : null;
    case "ENTROPY": {
      if (answered === 0) return null;
      const p = (parts.ones ?? 0) / answered;
      if (p <= 0 || p >= 1) return 0;
      return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
    }
    default:
      return null;
  }
}
