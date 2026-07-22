import {
  CHART_TYPES,
  DATASETS,
  DIMENSIONS,
  MEASURES,
  type QueryDefinition,
} from "@/lib/query-builder/schema";

/**
 * Compatibility validation. A meaningless combination is rejected with a
 * message that names the problem and the way out — never a silent broken
 * render, and never a chart that implies something the data can't support.
 *
 * Pure and synchronous so the UI can call it on every keystroke and the
 * server can call the same function before executing anything. The server
 * is the boundary: `executeQuery` refuses to run an invalid definition.
 */

export interface ValidationIssue {
  /** Which control the professor should change. */
  field: "dataset" | "measure" | "dimensions" | "chartType" | "filters";
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export function validateQuery(query: QueryDefinition): ValidationResult {
  const issues: ValidationIssue[] = [];

  const dataset = DATASETS[query.dataset];
  if (!dataset) {
    return {
      valid: false,
      issues: [{ field: "dataset", message: `Unknown dataset "${query.dataset}".` }],
    };
  }

  const chartType = CHART_TYPES[query.chartType];
  if (!chartType) {
    return {
      valid: false,
      issues: [{ field: "chartType", message: `Unknown chart type "${query.chartType}".` }],
    };
  }

  // --- measure belongs to the dataset ---------------------------------
  const measure = MEASURES[query.measure];
  if (!measure) {
    issues.push({ field: "measure", message: `Unknown measure "${query.measure}".` });
  } else if (!dataset.measures.includes(query.measure)) {
    issues.push({
      field: "measure",
      message: `“${measure.label}” is not available for ${dataset.label}. Choose one of: ${dataset.measures
        .map((m) => MEASURES[m].label)
        .join(", ")}.`,
    });
  }

  // --- dimensions belong to the dataset, and are not repeated ---------
  for (const dimensionId of query.dimensions) {
    const dimension = DIMENSIONS[dimensionId];
    if (!dimension) {
      issues.push({ field: "dimensions", message: `Unknown grouping "${dimensionId}".` });
      continue;
    }
    if (!dataset.dimensions.includes(dimensionId)) {
      issues.push({
        field: "dimensions",
        message: `${dataset.label} cannot be grouped by “${dimension.label}”. Available groupings: ${dataset.dimensions
          .map((d) => DIMENSIONS[d].label)
          .join(", ")}.`,
      });
    }
  }
  if (new Set(query.dimensions).size !== query.dimensions.length) {
    issues.push({
      field: "dimensions",
      message: "The same grouping is selected twice — pick two different ones.",
    });
  }

  // --- dimension count fits the chart type ----------------------------
  const count = query.dimensions.length;
  if (count < chartType.minDimensions) {
    issues.push({
      field: "chartType",
      message:
        `A ${chartType.label.toLowerCase()} chart needs at least ${chartType.minDimensions} ` +
        `grouping${chartType.minDimensions === 1 ? "" : "s"}; ${count} selected.`,
    });
  }
  if (count > chartType.maxDimensions) {
    issues.push({
      field: "chartType",
      message:
        `A ${chartType.label.toLowerCase()} chart takes at most ${chartType.maxDimensions} ` +
        `grouping${chartType.maxDimensions === 1 ? "" : "s"}; ${count} selected. ` +
        `Remove one, or switch to a heatmap or table.`,
    });
  }

  // --- chart types that require a specific shape of data --------------
  // A Sankey draws flows between the Assignment 1 and Assignment 2
  // answers. Without the transition dimension there is nothing to flow
  // between, so this is the headline "meaningless combination" case.
  if (query.chartType === "SANKEY") {
    if (query.dataset !== "PAIRED_TRANSITIONS") {
      issues.push({
        field: "chartType",
        message:
          "A Sankey diagram shows answers flowing from Assignment 1 to Assignment 2, " +
          "so it only works on the Paired transitions dataset. " +
          `${dataset.label} has no transition dimension to flow between.`,
      });
    } else if (!query.dimensions.includes("TRANSITION_STATE")) {
      issues.push({
        field: "dimensions",
        message:
          "A Sankey diagram needs the Transition state grouping — that is what defines " +
          "the flow from each Assignment 1 answer to each Assignment 2 answer. " +
          "Add it, or choose a bar chart instead.",
      });
    }
  }

  if (query.chartType === "TRANSITION_MATRIX") {
    if (query.dataset !== "PAIRED_TRANSITIONS") {
      issues.push({
        field: "chartType",
        message:
          "A transition matrix plots the Assignment 1 answer against the Assignment 2 " +
          `answer, which only exists in the Paired transitions dataset — not in ${dataset.label}.`,
      });
    } else if (!query.dimensions.includes("TRANSITION_STATE")) {
      issues.push({
        field: "dimensions",
        message:
          "A transition matrix needs the Transition state grouping to fill its four cells. " +
          "Add it, or choose a different chart type.",
      });
    }
  }

  // A line chart implies continuity along its x-axis; an unordered
  // category axis would invent a trend that isn't in the data.
  if (query.chartType === "LINE" && count > 0) {
    const hasOrdered = query.dimensions.some((d) => DIMENSIONS[d]?.ordered);
    if (!hasOrdered) {
      const orderedForDataset = dataset.dimensions.filter((d) => DIMENSIONS[d].ordered);
      issues.push({
        field: "chartType",
        message:
          "A line chart joins points in order, which only means something along an ordered " +
          "grouping like Date. " +
          (orderedForDataset.length > 0
            ? `Group by ${orderedForDataset.map((d) => DIMENSIONS[d].label).join(" or ")}, or switch to a bar chart.`
            : `${dataset.label} has no ordered grouping — switch to a bar chart or a table.`),
      });
    }
  }

  // --- measure / dimension interactions -------------------------------
  // Every row within a single transition state has, by definition, that
  // transition — so a rate computed within it is either 100% or 0% and
  // tells the reader nothing. Counts are fine.
  if (measure?.isRate && query.dimensions.includes("TRANSITION_STATE")) {
    issues.push({
      field: "measure",
      message:
        `“${measure.label}” is a rate over all valid pairs, so grouping it by Transition state ` +
        "would only ever return 100% or 0% for each cell. " +
        "Use “All pairs” or “Valid paired responses” to count transition states instead.",
    });
  }

  // Data-quality rows have no transition and no valid pair, so every rate
  // over them is undefined rather than zero.
  if (measure?.isRate && query.dimensions.includes("DATA_QUALITY")) {
    issues.push({
      field: "measure",
      message:
        `“${measure.label}” is undefined for missing and not-comparable pairs, which is what ` +
        "the Data quality grouping contains. Use “All pairs” to count them instead.",
    });
  }

  // --- filters --------------------------------------------------------
  for (const filter of query.filters) {
    if (!DIMENSIONS[filter.dimension]) {
      issues.push({ field: "filters", message: `Unknown filter field "${filter.dimension}".` });
      continue;
    }
    if (!dataset.dimensions.includes(filter.dimension)) {
      issues.push({
        field: "filters",
        message: `${dataset.label} cannot be filtered by “${DIMENSIONS[filter.dimension].label}”.`,
      });
    }
    if (filter.value.trim() === "") {
      issues.push({
        field: "filters",
        message: `The “${DIMENSIONS[filter.dimension].label}” filter has no value — remove it or choose one.`,
      });
    }
  }

  return { valid: issues.length === 0, issues };
}

/** One-line summary for error banners and export metadata. */
export function summariseIssues(result: ValidationResult): string {
  return result.issues.map((i) => i.message).join(" ");
}
