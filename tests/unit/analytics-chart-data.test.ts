import { describe, expect, it } from "vitest";
import {
  beforeAfterPoint,
  BINARY_LABELS,
  byCriterion,
  bySource,
  groupMappings,
  histogramBins,
  NO_CRITERION,
  pivotHeatmap,
  QUALITY_LABELS,
  responseHeatmap,
  sumTransitionCounts,
  transitionMatrixCells,
  TRANSITION_STATE_LABELS,
} from "@/lib/analytics/chart-data";
import type {
  MappingTransitionSummary,
  QuestionResponseSummary,
} from "@/lib/analytics/queries";

function mapping(overrides: Partial<MappingTransitionSummary>): MappingTransitionSummary {
  return {
    class_id: "c",
    mapping_id: "m",
    mapping_name: "M",
    mapping_version: 1,
    mapping_type: "CONCEPTUAL_ONE_TO_ONE",
    energy_source: null,
    criterion: null,
    pairs_considered: 0,
    s00: 0,
    s01: 0,
    s10: 0,
    s11: 0,
    valid_paired: 0,
    missing_a1: 0,
    missing_a2: 0,
    missing_both: 0,
    not_comparable: 0,
    missing_a2_from_0: 0,
    missing_a2_from_1: 0,
    missing_a1_to_0: 0,
    missing_a1_to_1: 0,
    changed_count: 0,
    unchanged_count: 0,
    change_rate: null,
    stability_rate: null,
    net_movement_toward_1: 0,
    pct_point_shift: null,
    ...overrides,
  };
}

describe("before/after (17.2)", () => {
  it("computes % choosing 1 — Yes on each side over valid pairs", () => {
    const point = beforeAfterPoint(
      mapping({ s00: 20, s01: 30, s10: 27, s11: 23, valid_paired: 100 })
    );
    expect(point.pct1A1).toBeCloseTo(0.5, 10); // s10 + s11
    expect(point.pct1A2).toBeCloseTo(0.53, 10); // s01 + s11
  });

  it("is null — not 0 — when there are no valid pairs", () => {
    const point = beforeAfterPoint(mapping({ valid_paired: 0 }));
    expect(point.pct1A1).toBeNull();
    expect(point.pct1A2).toBeNull();
  });
});

describe("transition totals and matrix (17.3)", () => {
  it("sums every bucket including one-sided-missing splits", () => {
    const totals = sumTransitionCounts([
      mapping({ s01: 3, valid_paired: 3, missing_a2: 2, missing_a2_from_0: 1, missing_a2_from_1: 1, pairs_considered: 5 }),
      mapping({ s10: 2, valid_paired: 2, not_comparable: 4, pairs_considered: 6 }),
    ]);
    expect(totals).toMatchObject({
      s01: 3,
      s10: 2,
      valid_paired: 5,
      missing_a2: 2,
      missing_a2_from_0: 1,
      missing_a2_from_1: 1,
      not_comparable: 4,
      pairs_considered: 11,
    });
  });

  it("builds the 2×2 cells with per-cell share of valid pairs", () => {
    const cells = transitionMatrixCells({ s00: 20, s01: 30, s10: 27, s11: 23, valid_paired: 100 });
    expect(cells).toHaveLength(4);
    const s01 = cells.find((c) => c.state === "S01")!;
    expect(s01).toMatchObject({ a1: 0, a2: 1, count: 30 });
    expect(s01.pctOfValid).toBeCloseTo(0.3, 10);
  });

  it("matrix shares are null when no valid pairs exist", () => {
    for (const cell of transitionMatrixCells({ s00: 0, s01: 0, s10: 0, s11: 0, valid_paired: 0 })) {
      expect(cell.pctOfValid).toBeNull();
    }
  });
});

describe("histogram (17.12)", () => {
  it("bins values into fixed-width bands with 1.0 in the last bin", () => {
    const bins = histogramBins([0, 0.05, 0.1, 0.55, 1, 1, null], 10);
    expect(bins).toHaveLength(10);
    expect(bins[0]!.count).toBe(2); // 0, 0.05
    expect(bins[1]!.count).toBe(1); // 0.1
    expect(bins[5]!.count).toBe(1); // 0.55
    expect(bins[9]!.count).toBe(2); // both 1.0s — never an 11th bin
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(6); // null skipped
  });

  it("ignores out-of-range values rather than mis-binning them", () => {
    const bins = histogramBins([-0.1, 1.1, 0.5], 10);
    expect(bins.reduce((s, b) => s + b.count, 0)).toBe(1);
  });

  it("rejects a nonsensical bin count loudly", () => {
    expect(() => histogramBins([0.5], 0)).toThrowError(/binCount/);
  });
});

describe("heatmap pivots (17.6 / 17.7 / 17.8)", () => {
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

describe("drill-down grouping (Section 21)", () => {
  it("groups by source and criterion with a visible bucket for missing keys", () => {
    const summaries = [
      mapping({ mapping_id: "a", energy_source: "Solar", criterion: "Renewable", valid_paired: 5, s01: 5, pairs_considered: 5 }),
      mapping({ mapping_id: "b", energy_source: "Solar", criterion: null, valid_paired: 3, s10: 3, pairs_considered: 3 }),
    ];
    const sources = groupMappings(summaries, bySource);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.totals.valid_paired).toBe(8);

    const criteria = groupMappings(summaries, byCriterion);
    expect(criteria.map((g) => g.key)).toEqual([NO_CRITERION, "Renewable"]);
  });
});

describe("neutral labelling", () => {
  it("binary and transition labels use 0 — No / 1 — Yes wording", () => {
    expect(BINARY_LABELS.zero).toBe("0 — No");
    expect(BINARY_LABELS.one).toBe("1 — Yes");
    expect(TRANSITION_STATE_LABELS.S01).toContain("0 → 1");
    expect(TRANSITION_STATE_LABELS.S01).toContain("No → Yes");
  });

  it("no label implies correctness, improvement, or grading", () => {
    const labels = [
      ...Object.values(TRANSITION_STATE_LABELS),
      ...Object.values(QUALITY_LABELS),
      ...Object.values(BINARY_LABELS),
    ];
    for (const label of labels) {
      expect(label).not.toMatch(/correct|wrong|improve|better|worse|learn|score|grade|pass|fail/i);
    }
  });
});
