import { describe, expect, it } from "vitest";
import {
  alluvialFromTransitionCounts,
  buildNetworkGraph,
  classicalMdsProjection,
  EXPLORATORY_CAVEAT,
  hammingDistance,
  hierarchicalClustering,
  jaccardSimilarity,
  markExploratory,
  mutualInformationBits,
  phiCoefficient,
} from "@/lib/analytics/exploratory";

describe("exploratory metadata", () => {
  it("wraps data with the exploratory flag and the never-a-grade caveat", () => {
    const wrapped = markExploratory([1, 2, 3]);
    expect(wrapped.exploratory).toBe(true);
    expect(wrapped.caveat).toContain("never a grade");
    expect(wrapped.data).toEqual([1, 2, 3]);
    expect(EXPLORATORY_CAVEAT).toContain("Exploratory");
  });
});

describe("phi coefficient", () => {
  it("is 1 for perfect positive association", () => {
    expect(phiCoefficient(5, 0, 0, 5)).toBeCloseTo(1, 10);
  });
  it("is -1 for perfect negative association", () => {
    expect(phiCoefficient(0, 5, 5, 0)).toBeCloseTo(-1, 10);
  });
  it("is 0 for independence", () => {
    expect(phiCoefficient(3, 3, 3, 3)).toBeCloseTo(0, 10);
  });
  it("is null when a margin is empty (undefined association)", () => {
    expect(phiCoefficient(5, 5, 0, 0)).toBeNull();
    expect(phiCoefficient(0, 0, 0, 0)).toBeNull();
  });
});

describe("mutual information (bits)", () => {
  it("is 1 bit for a perfectly correlated fair split", () => {
    expect(mutualInformationBits(5, 0, 0, 5)).toBeCloseTo(1, 10);
  });
  it("is 0 for independent variables", () => {
    expect(mutualInformationBits(3, 3, 3, 3)).toBeCloseTo(0, 10);
  });
  it("is null with no observations", () => {
    expect(mutualInformationBits(0, 0, 0, 0)).toBeNull();
  });
});

describe("jaccard / hamming", () => {
  it("jaccard is shared ones over union of ones", () => {
    expect(jaccardSimilarity(3, 1, 2)).toBeCloseTo(0.5, 10);
    expect(jaccardSimilarity(0, 0, 4)).toBe(0);
  });
  it("jaccard is null when neither vector has a 1 (empty union)", () => {
    expect(jaccardSimilarity(0, 0, 0)).toBeNull();
  });
  it("hamming counts disagreements", () => {
    expect(hammingDistance(4, 3)).toBe(7);
    expect(hammingDistance(0, 0)).toBe(0);
  });
});

describe("hierarchical clustering (average linkage, deterministic)", () => {
  // Two tight pairs far apart: {a,b} at distance 1, {c,d} at distance 1,
  // everything across at distance 10.
  const ids = ["a", "b", "c", "d"];
  const pairs = [
    { a: "a", b: "b", distance: 1 },
    { a: "c", b: "d", distance: 1 },
    { a: "a", b: "c", distance: 10 },
    { a: "a", b: "d", distance: 10 },
    { a: "b", b: "c", distance: 10 },
    { a: "b", b: "d", distance: 10 },
  ];

  it("cuts into the two obvious clusters at k=2", () => {
    const result = hierarchicalClustering(ids, pairs);
    expect(result.cut(2)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("k=1 merges everything; k=n gives singletons", () => {
    const result = hierarchicalClustering(ids, pairs);
    expect(result.cut(1)).toEqual([["a", "b", "c", "d"]]);
    expect(result.cut(4)).toEqual([["a"], ["b"], ["c"], ["d"]]);
  });

  it("is deterministic — same input, identical merge order", () => {
    const r1 = hierarchicalClustering(ids, pairs);
    const r2 = hierarchicalClustering(ids, [...pairs].reverse());
    expect(r1.merges).toEqual(r2.merges);
  });

  it("fails loudly on a missing pairwise distance", () => {
    expect(() =>
      hierarchicalClustering(["x", "y", "z"], [{ a: "x", b: "y", distance: 1 }]).cut(1)
    ).toThrowError(/missing pairwise distance/);
  });
});

describe("classical MDS projection (deterministic PCA-equivalent)", () => {
  it("preserves distances for three collinear points", () => {
    const points = classicalMdsProjection(
      ["p", "q", "r"],
      [
        { a: "p", b: "q", distance: 1 },
        { a: "q", b: "r", distance: 1 },
        { a: "p", b: "r", distance: 2 },
      ]
    );
    const byId = new Map(points.map((p) => [p.id, p]));
    const d = (x: string, y: string) => {
      const px = byId.get(x)!;
      const py = byId.get(y)!;
      return Math.hypot(px.x - py.x, px.y - py.y);
    };
    expect(d("p", "q")).toBeCloseTo(1, 6);
    expect(d("q", "r")).toBeCloseTo(1, 6);
    expect(d("p", "r")).toBeCloseTo(2, 6);
  });

  it("is deterministic and handles trivial inputs", () => {
    expect(classicalMdsProjection([], [])).toEqual([]);
    expect(classicalMdsProjection(["only"], [])).toEqual([{ id: "only", x: 0, y: 0 }]);
    const run = () =>
      classicalMdsProjection(
        ["a", "b", "c", "d"],
        [
          { a: "a", b: "b", distance: 1 },
          { a: "a", b: "c", distance: 4 },
          { a: "a", b: "d", distance: 4 },
          { a: "b", b: "c", distance: 4 },
          { a: "b", b: "d", distance: 4 },
          { a: "c", b: "d", distance: 1 },
        ]
      );
    expect(run()).toEqual(run());
  });
});

describe("network graph shaping", () => {
  it("keeps only edges at or above the threshold, sorted and normalised", () => {
    const graph = buildNetworkGraph(
      ["s3", "s1", "s2"],
      [
        { a: "s2", b: "s1", weight: 0.9 },
        { a: "s1", b: "s3", weight: 0.2 },
        { a: "s3", b: "s2", weight: null },
      ],
      0.5
    );
    expect(graph.nodes.map((n) => n.id)).toEqual(["s1", "s2", "s3"]);
    expect(graph.edges).toEqual([{ source: "s1", target: "s2", weight: 0.9 }]);
  });
});

describe("alluvial data shaping", () => {
  it("maps transition + missing counts to neutral-labelled flows", () => {
    const data = alluvialFromTransitionCounts({
      s00: 20,
      s01: 30,
      s10: 27,
      s11: 23,
      missingA2From0: 2,
      missingA2From1: 1,
      missingA1To0: 0,
      missingA1To1: 3,
      missingBoth: 4,
    });
    expect(data.links).toContainEqual({ source: "a1:0", target: "a2:1", value: 30 });
    expect(data.links).toContainEqual({ source: "a1:1", target: "a2:missing", value: 1 });
    expect(data.links).toContainEqual({ source: "a1:missing", target: "a2:1", value: 3 });
    // Zero-value flows are dropped entirely.
    expect(data.links.every((l) => l.value > 0)).toBe(true);
    // Labels stay neutral — no assessment language anywhere.
    for (const node of data.nodes) {
      expect(node.label).not.toMatch(/correct|improve|better|learn|score|grade/i);
    }
  });

  it("omits nodes with no flows", () => {
    const data = alluvialFromTransitionCounts({
      s00: 5,
      s01: 0,
      s10: 0,
      s11: 5,
      missingA2From0: 0,
      missingA2From1: 0,
      missingA1To0: 0,
      missingA1To1: 0,
      missingBoth: 0,
    });
    expect(data.nodes.map((n) => n.id).sort()).toEqual(["a1:0", "a1:1", "a2:0", "a2:1"]);
  });
});
