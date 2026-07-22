import { describe, expect, it } from "vitest";
import { validateQuery, summariseIssues } from "@/lib/query-builder/validate";
import {
  DATASETS,
  DEFAULT_QUERY,
  type QueryDefinition,
} from "@/lib/query-builder/schema";

/**
 * ACCEPTANCE (Phase 9): an incompatible chart / dataset / measure
 * combination is rejected with a clear message, not a silent broken
 * render. Every case below asserts both the rejection AND that the
 * message actually explains the problem.
 */

function q(overrides: Partial<QueryDefinition>): QueryDefinition {
  return { ...DEFAULT_QUERY, ...overrides };
}

describe("valid combinations are accepted", () => {
  it("accepts the default query", () => {
    expect(validateQuery(DEFAULT_QUERY).valid).toBe(true);
  });

  it("accepts a Sankey on paired transitions grouped by transition state", () => {
    const result = validateQuery(
      q({
        dataset: "PAIRED_TRANSITIONS",
        measure: "PAIR_COUNT",
        dimensions: ["TRANSITION_STATE"],
        chartType: "SANKEY",
      })
    );
    expect(result.issues).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a heatmap with exactly two groupings", () => {
    expect(
      validateQuery(
        q({
          dataset: "A1_RESPONSES",
          measure: "PCT_ONE",
          dimensions: ["ENERGY_SOURCE", "CRITERION"],
          chartType: "HEATMAP",
        })
      ).valid
    ).toBe(true);
  });

  it("accepts a line chart over the ordered Date grouping", () => {
    expect(
      validateQuery(
        q({
          dataset: "SUBMISSIONS",
          measure: "CUMULATIVE_SUBMISSIONS",
          dimensions: ["DATE"],
          chartType: "LINE",
        })
      ).valid
    ).toBe(true);
  });
});

describe("ACCEPTANCE: incompatible combinations are rejected with a clear message", () => {
  it("rejects a Sankey with no transition dimension selected", () => {
    const result = validateQuery(
      q({
        dataset: "PAIRED_TRANSITIONS",
        measure: "PAIR_COUNT",
        dimensions: ["MAPPING"],
        chartType: "SANKEY",
      })
    );
    expect(result.valid).toBe(false);
    const message = summariseIssues(result);
    expect(message).toMatch(/Sankey/i);
    expect(message).toMatch(/Transition state/i);
    // The message must say what to do, not just that it failed.
    expect(message).toMatch(/Add it|choose a bar chart/i);
    expect(result.issues[0]!.field).toBe("dimensions");
  });

  it("rejects a Sankey on a dataset that has no transitions at all", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["QUESTION"],
        chartType: "SANKEY",
      })
    );
    expect(result.valid).toBe(false);
    const message = summariseIssues(result);
    expect(message).toMatch(/Paired transitions dataset/i);
    expect(message).toMatch(/Assignment 1 responses/i);
  });

  it("rejects a measure that does not belong to the dataset, and lists the valid ones", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "CHANGE_RATE",
        dimensions: ["QUESTION"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.field === "measure")!;
    expect(issue.message).toMatch(/Change rate/);
    expect(issue.message).toMatch(/not available for Assignment 1 responses/i);
    // Names an alternative that actually is available.
    expect(issue.message).toMatch(/Consensus|% choosing/);
  });

  it("rejects a grouping the dataset does not have", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["STUDENT"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/cannot be grouped by .Student./i);
  });

  it("rejects a transition matrix outside the paired dataset", () => {
    const result = validateQuery(
      q({
        dataset: "ATTEMPTS",
        measure: "ATTEMPT_COUNT",
        dimensions: ["ASSIGNMENT"],
        chartType: "TRANSITION_MATRIX",
      })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/Paired transitions dataset/i);
  });

  it("rejects a line chart over unordered categories", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["ENERGY_SOURCE"],
        chartType: "LINE",
      })
    );
    expect(result.valid).toBe(false);
    const message = summariseIssues(result);
    expect(message).toMatch(/line chart joins points in order/i);
    expect(message).toMatch(/no ordered grouping|switch to a bar chart/i);
  });

  it("rejects a heatmap with only one grouping and says how many it needs", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["ENERGY_SOURCE"],
        chartType: "HEATMAP",
      })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/needs at least 2 groupings/i);
  });

  it("rejects a bar chart with two groupings and suggests a chart that fits", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["ENERGY_SOURCE", "CRITERION"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/at most 1 grouping/i);
    expect(summariseIssues(result)).toMatch(/heatmap or table/i);
  });

  it("rejects a rate grouped by transition state — it would always be 100% or 0%", () => {
    const result = validateQuery(
      q({
        dataset: "PAIRED_TRANSITIONS",
        measure: "CHANGE_RATE",
        dimensions: ["TRANSITION_STATE"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    const message = summariseIssues(result);
    expect(message).toMatch(/only ever return 100% or 0%/i);
    expect(message).toMatch(/All pairs|Valid paired responses/);
  });

  it("rejects a rate grouped by data quality — undefined, not zero", () => {
    const result = validateQuery(
      q({
        dataset: "PAIRED_TRANSITIONS",
        measure: "STABILITY_RATE",
        dimensions: ["DATA_QUALITY"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/undefined for missing and not-comparable/i);
  });

  it("rejects a duplicated grouping", () => {
    const result = validateQuery(
      q({ dimensions: ["MAPPING", "MAPPING"], chartType: "HEATMAP" })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/selected twice/i);
  });

  it("rejects a filter with no value", () => {
    const result = validateQuery(
      q({ filters: [{ dimension: "ENERGY_SOURCE", value: "  " }] })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/has no value/i);
  });

  it("rejects unknown identifiers rather than passing them through to a query", () => {
    const bad = validateQuery({
      ...DEFAULT_QUERY,
      dataset: "DROP TABLE responses" as never,
    });
    expect(bad.valid).toBe(false);
    expect(summariseIssues(bad)).toMatch(/Unknown dataset/i);
  });
});

describe("every dataset's own defaults are internally consistent", () => {
  it("each dataset's first measure and first dimension validate together", () => {
    for (const dataset of Object.values(DATASETS)) {
      const result = validateQuery({
        dataset: dataset.id,
        measure: dataset.measures[0]!,
        dimensions: [dataset.dimensions[0]!],
        filters: [],
        chartType: "TABLE",
      });
      expect(result.issues, `${dataset.id} defaults should validate`).toEqual([]);
    }
  });
});
