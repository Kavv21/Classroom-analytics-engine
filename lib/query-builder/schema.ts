/**
 * The query builder's catalogue: which datasets exist, what can be
 * measured and grouped in each, which chart types can render the result,
 * and which combinations are meaningless.
 *
 * Everything here is data, not SQL. A builder query never becomes a
 * generated SQL string — `execute.ts` maps each (dataset, dimension) pair
 * to one of the Phase 7/8 PostgreSQL views and reads it through the
 * caller's own RLS. That keeps aggregation in the database and means a
 * crafted query has no injection surface to reach.
 *
 * Every dataset here is scoped to ONE assignment or to the attempt/
 * submission workflow. The paired-transitions dataset, its transition
 * measures and dimensions, and the Sankey / transition-matrix chart types
 * were removed with the question-mapping feature (migration 0022): they
 * were defined only over an approved mapping's paired answers.
 */

export type DatasetId =
  | "A1_RESPONSES"
  | "A2_RESPONSES"
  | "ATTEMPTS"
  | "SUBMISSIONS";

export type MeasureId =
  | "RESPONSE_COUNT"
  | "PCT_ONE"
  | "PCT_ZERO"
  | "CONSENSUS"
  | "DISAGREEMENT"
  | "ENTROPY"
  | "ATTEMPT_COUNT"
  | "SUBMISSION_COUNT"
  | "CUMULATIVE_SUBMISSIONS";

export type DimensionId =
  | "QUESTION"
  | "ENERGY_SOURCE"
  | "CRITERION"
  | "CONCEPT"
  | "ASSIGNMENT"
  | "ATTEMPT_STATE"
  | "DATE";

export type ChartTypeId =
  | "BAR"
  | "STACKED_BAR"
  | "LINE"
  | "HEATMAP"
  | "TABLE";

export interface DatasetSpec {
  id: DatasetId;
  label: string;
  description: string;
  measures: MeasureId[];
  dimensions: DimensionId[];
}

export interface MeasureSpec {
  id: MeasureId;
  label: string;
  /** Verbatim from docs/ANALYTICS_DEFINITIONS.md where one is defined. */
  definition: string;
  format: "count" | "percent" | "signed" | "decimal";
  /** A rate is undefined within a single transition state — see rules. */
  isRate: boolean;
}

export interface DimensionSpec {
  id: DimensionId;
  label: string;
  /** Ordered dimensions can carry a line chart's x-axis. */
  ordered: boolean;
}

export interface ChartTypeSpec {
  id: ChartTypeId;
  label: string;
  minDimensions: number;
  maxDimensions: number;
}

export const DATASETS: Record<DatasetId, DatasetSpec> = {
  A1_RESPONSES: {
    id: "A1_RESPONSES",
    label: "Assignment 1 responses",
    description: "Final submitted answers to the first assignment.",
    measures: ["RESPONSE_COUNT", "PCT_ONE", "PCT_ZERO", "CONSENSUS", "DISAGREEMENT", "ENTROPY"],
    dimensions: ["QUESTION", "ENERGY_SOURCE", "CRITERION", "CONCEPT"],
  },
  A2_RESPONSES: {
    id: "A2_RESPONSES",
    label: "Assignment 2 responses",
    description: "Final submitted answers to the second assignment.",
    measures: ["RESPONSE_COUNT", "PCT_ONE", "PCT_ZERO", "CONSENSUS", "DISAGREEMENT", "ENTROPY"],
    dimensions: ["QUESTION", "ENERGY_SOURCE", "CRITERION", "CONCEPT"],
  },
  ATTEMPTS: {
    id: "ATTEMPTS",
    label: "Assignment attempts",
    description: "Attempt workflow states per assignment.",
    measures: ["ATTEMPT_COUNT"],
    dimensions: ["ASSIGNMENT", "ATTEMPT_STATE"],
  },
  SUBMISSIONS: {
    id: "SUBMISSIONS",
    label: "Submission records",
    description: "Submissions over time.",
    measures: ["SUBMISSION_COUNT", "CUMULATIVE_SUBMISSIONS"],
    dimensions: ["ASSIGNMENT", "DATE"],
  },
};

export const MEASURES: Record<MeasureId, MeasureSpec> = {
  RESPONSE_COUNT: {
    id: "RESPONSE_COUNT",
    label: "Answered responses",
    definition: "Count of final responses with a value of 0 or 1. Blank answers are excluded.",
    format: "count",
    isRate: false,
  },
  PCT_ONE: {
    id: "PCT_ONE",
    label: "% choosing 1 — Yes",
    definition: "Share of answered responses with the value 1.",
    format: "percent",
    isRate: true,
  },
  PCT_ZERO: {
    id: "PCT_ZERO",
    label: "% choosing 0 — No",
    definition: "Share of answered responses with the value 0.",
    format: "percent",
    isRate: true,
  },
  CONSENSUS: {
    id: "CONSENSUS",
    label: "Consensus",
    definition: "Simple consensus: max(% selecting 0, % selecting 1). A neutral description of spread, never a correctness measure.",
    format: "percent",
    isRate: true,
  },
  DISAGREEMENT: {
    id: "DISAGREEMENT",
    label: "Disagreement",
    definition: "Simple disagreement: 1 - consensus. 50/50 is maximum disagreement.",
    format: "percent",
    isRate: true,
  },
  ENTROPY: {
    id: "ENTROPY",
    label: "Binary entropy",
    definition: "H(p) = -p*log2(p) - (1-p)*log2(1-p). 0 at unanimity, 1 bit at an even split.",
    format: "decimal",
    isRate: true,
  },
  ATTEMPT_COUNT: {
    id: "ATTEMPT_COUNT",
    label: "Attempts",
    definition: "Count of attempts in the given workflow state.",
    format: "count",
    isRate: false,
  },
  SUBMISSION_COUNT: {
    id: "SUBMISSION_COUNT",
    label: "Submissions",
    definition: "Submissions recorded on the given day (UTC).",
    format: "count",
    isRate: false,
  },
  CUMULATIVE_SUBMISSIONS: {
    id: "CUMULATIVE_SUBMISSIONS",
    label: "Cumulative submissions",
    definition: "Running total of submissions up to and including the given day.",
    format: "count",
    isRate: false,
  },
};

export const DIMENSIONS: Record<DimensionId, DimensionSpec> = {
  QUESTION: { id: "QUESTION", label: "Question", ordered: false },
  ENERGY_SOURCE: { id: "ENERGY_SOURCE", label: "Energy source", ordered: false },
  CRITERION: { id: "CRITERION", label: "Criterion", ordered: false },
  CONCEPT: { id: "CONCEPT", label: "Concept", ordered: false },
  ASSIGNMENT: { id: "ASSIGNMENT", label: "Assignment", ordered: false },
  ATTEMPT_STATE: { id: "ATTEMPT_STATE", label: "Attempt state", ordered: false },
  DATE: { id: "DATE", label: "Date", ordered: true },
};

export const CHART_TYPES: Record<ChartTypeId, ChartTypeSpec> = {
  BAR: { id: "BAR", label: "Bar", minDimensions: 1, maxDimensions: 1 },
  STACKED_BAR: { id: "STACKED_BAR", label: "Stacked bar", minDimensions: 2, maxDimensions: 2 },
  LINE: { id: "LINE", label: "Line", minDimensions: 1, maxDimensions: 2 },
  HEATMAP: { id: "HEATMAP", label: "Heatmap", minDimensions: 2, maxDimensions: 2 },
  TABLE: { id: "TABLE", label: "Table", minDimensions: 0, maxDimensions: 2 },
};

export interface QueryFilter {
  dimension: DimensionId;
  value: string;
}

/** The saved shape. Persisted verbatim into saved_queries.definition. */
export interface QueryDefinition {
  dataset: DatasetId;
  measure: MeasureId;
  dimensions: DimensionId[];
  filters: QueryFilter[];
  chartType: ChartTypeId;
}

export const DEFAULT_QUERY: QueryDefinition = {
  dataset: "A1_RESPONSES",
  measure: "PCT_ONE",
  dimensions: ["ENERGY_SOURCE"],
  filters: [],
  chartType: "BAR",
};

export function datasetList(): DatasetSpec[] {
  return Object.values(DATASETS);
}

export function measuresFor(dataset: DatasetId): MeasureSpec[] {
  return DATASETS[dataset].measures.map((m) => MEASURES[m]);
}

export function dimensionsFor(dataset: DatasetId): DimensionSpec[] {
  return DATASETS[dataset].dimensions.map((d) => DIMENSIONS[d]);
}
