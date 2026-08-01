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
  it("rejects a measure that does not belong to the dataset, and lists the valid ones", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "CUMULATIVE_SUBMISSIONS",
        dimensions: ["QUESTION"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.field === "measure")!;
    expect(issue.message).toMatch(/Cumulative submissions/);
    expect(issue.message).toMatch(/not available for Assignment 1 responses/i);
    // Names an alternative that actually is available.
    expect(issue.message).toMatch(/Consensus|% choosing/);
  });

  it("rejects a grouping the dataset does not have", () => {
    const result = validateQuery(
      q({
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["DATE"],
        chartType: "BAR",
      })
    );
    expect(result.valid).toBe(false);
    expect(summariseIssues(result)).toMatch(/cannot be grouped by .Date./i);
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

  it("rejects a duplicated grouping", () => {
    const result = validateQuery(
      q({ dimensions: ["ENERGY_SOURCE", "ENERGY_SOURCE"], chartType: "HEATMAP" })
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
