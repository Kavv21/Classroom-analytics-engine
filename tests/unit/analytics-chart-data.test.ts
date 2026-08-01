import { describe, expect, it } from "vitest";
import {
  BINARY_LABELS,
  pivotHeatmap,
  responseHeatmap,
} from "@/lib/analytics/chart-data";
import type { QuestionResponseSummary } from "@/lib/analytics/queries";

describe("heatmap pivots (17.6)", () => {
  it("emits every row×col combination, null where no data exists", () => {
    const data = pivotHeatmap(
      [
        { r: "Solar", c: "Renewable", v: 0.8 },
        { r: "Coal", c: "Conventional", v: 0.2 },
      ],
      (x) => x.r,
      (x) => x.c,
      (x) => x.v
    );
    expect(data.rowKeys).toEqual(["Coal", "Solar"]);
    expect(data.colKeys).toEqual(["Conventional", "Renewable"]);
    expect(data.cells).toHaveLength(4);
    const solarConventional = data.cells.find(([r, c]) => r === 1 && c === 0)!;
    expect(solarConventional[2]).toBeNull(); // absent combo stays null, never 0
  });

  it("responseHeatmap skips questions without both keys instead of inventing buckets", () => {
    const rows = [
      { energy_source: "Solar", criterion: "Renewable", pct_one: 0.9 },
      { energy_source: null, criterion: "Renewable", pct_one: 0.4 },
    ] as QuestionResponseSummary[];
    const data = responseHeatmap(rows);
    expect(data.rowKeys).toEqual(["Solar"]);
  });
});

describe("neutral labelling", () => {
  it("binary labels use 0 — No / 1 — Yes wording", () => {
    expect(BINARY_LABELS.zero).toBe("0 — No");
    expect(BINARY_LABELS.one).toBe("1 — Yes");
  });

  it("no label implies correctness, improvement, or grading", () => {
    for (const label of Object.values(BINARY_LABELS)) {
      expect(label).not.toMatch(/correct|wrong|improve|better|worse|learn|score|grade|pass|fail/i);
    }
  });
});
