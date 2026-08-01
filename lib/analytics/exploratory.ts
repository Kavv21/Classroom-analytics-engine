/**
 * Section 18 EXPLORATORY analytics helpers (Phase 7).
 *
 * Everything in this module is descriptive exploration, never assessment:
 * similarity, association strength, cluster membership, or projection
 * position is NOT a grade, a score, or a correctness judgement, and no
 * caller may present it as one. Phase 8 must carry the exploratory
 * metadata through to the UI.
 *
 * All functions are pure and deterministic (fixed tie-breaking, no random
 * initialisation) so results are reproducible run to run. Heavy lifting on
 * raw responses stays in the database views
 * (student_pair_similarity_exploratory, question_pair_association_...);
 * these helpers consume pairwise view rows, never raw response tables.
 */

export const EXPLORATORY_CAVEAT =
  "Exploratory descriptive statistics only. Similarity, association, cluster " +
  "membership, or projection position is never a grade, score, or correctness " +
  "judgement.";

export interface Exploratory<T> {
  exploratory: true;
  caveat: string;
  data: T;
}

export function markExploratory<T>(data: T): Exploratory<T> {
  return { exploratory: true, caveat: EXPLORATORY_CAVEAT, data };
}

// ============================================================
// 2x2 association measures — reference implementations mirroring the SQL
// in migration 0012 (cross-checked in tests so neither drifts).
// Cell naming: nAB = count(first variable = A, second variable = B).
// ============================================================

export function phiCoefficient(n00: number, n01: number, n10: number, n11: number): number | null {
  const r0 = n00 + n01;
  const r1 = n10 + n11;
  const c0 = n00 + n10;
  const c1 = n01 + n11;
  const denominator = Math.sqrt(r1 * r0 * c1 * c0);
  if (denominator === 0) return null;
  return (n11 * n00 - n10 * n01) / denominator;
}

export function mutualInformationBits(
  n00: number,
  n01: number,
  n10: number,
  n11: number
): number | null {
  const n = n00 + n01 + n10 + n11;
  if (n === 0) return null;
  const r0 = n00 + n01;
  const r1 = n10 + n11;
  const c0 = n00 + n10;
  const c1 = n01 + n11;
  const term = (nxy: number, rx: number, cy: number) =>
    nxy > 0 ? (nxy / n) * Math.log2((nxy * n) / (rx * cy)) : 0;
  return term(n00, r0, c0) + term(n01, r0, c1) + term(n10, r1, c0) + term(n11, r1, c1);
}

/** Jaccard similarity for binary vectors: M11 / (M11 + M10 + M01). */
export function jaccardSimilarity(bothOne: number, aOnlyOne: number, bOnlyOne: number): number | null {
  const union = bothOne + aOnlyOne + bOnlyOne;
  if (union === 0) return null;
  return bothOne / union;
}

/** Hamming distance for binary vectors: number of disagreeing positions. */
export function hammingDistance(aOnlyOne: number, bOnlyOne: number): number {
  return aOnlyOne + bOnlyOne;
}

// ============================================================
// Hierarchical clustering (agglomerative, average linkage) over a pairwise
// distance list — e.g. hamming_distance rows from
// student_pair_similarity_exploratory. Deterministic: ties broken by the
// lexicographically smallest pair of member ids.
// ============================================================

export interface PairDistance {
  a: string;
  b: string;
  distance: number;
}

export interface ClusterMerge {
  /** Sorted member ids of the two clusters merged at this step. */
  left: string[];
  right: string[];
  distance: number;
}

export interface HierarchicalClusteringResult {
  ids: string[];
  merges: ClusterMerge[];
  /** Cut the dendrogram into (at most) k clusters of member ids. */
  cut(k: number): string[][];
}

export function hierarchicalClustering(
  ids: string[],
  pairs: PairDistance[]
): HierarchicalClusteringResult {
  const sortedIds = [...ids].sort();
  const distance = new Map<string, number>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const p of pairs) distance.set(key(p.a, p.b), p.distance);

  const pairDistance = (a: string, b: string): number => {
    const d = distance.get(key(a, b));
    if (d === undefined) {
      throw new Error(`missing pairwise distance between ${a} and ${b}`);
    }
    return d;
  };

  let clusters: string[][] = sortedIds.map((id) => [id]);
  const merges: ClusterMerge[] = [];

  const averageLinkage = (left: string[], right: string[]): number => {
    let sum = 0;
    for (const a of left) for (const b of right) sum += pairDistance(a, b);
    return sum / (left.length * right.length);
  };

  while (clusters.length > 1) {
    let best: { i: number; j: number; d: number } | null = null;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = averageLinkage(clusters[i]!, clusters[j]!);
        if (best === null || d < best.d) best = { i, j, d };
      }
    }
    const { i, j, d } = best!;
    const merged = [...clusters[i]!, ...clusters[j]!].sort();
    merges.push({ left: clusters[i]!, right: clusters[j]!, distance: d });
    clusters = clusters.filter((_, idx) => idx !== i && idx !== j);
    clusters.push(merged);
    // Deterministic order between rounds: sort clusters by first member.
    clusters.sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
  }

  return {
    ids: sortedIds,
    merges,
    cut(k: number): string[][] {
      if (k <= 0) throw new Error("k must be >= 1");
      let current: string[][] = sortedIds.map((id) => [id]);
      const stopAfter = Math.max(sortedIds.length - k, 0);
      for (const merge of merges.slice(0, stopAfter)) {
        const leftKey = merge.left.join(",");
        const rightKey = merge.right.join(",");
        const left = current.find((c) => c.join(",") === leftKey)!;
        const right = current.find((c) => c.join(",") === rightKey)!;
        current = current.filter((c) => c !== left && c !== right);
        current.push([...left, ...right].sort());
      }
      return current.sort((x, y) => (x[0]! < y[0]! ? -1 : 1));
    },
  };
}

// ============================================================
// 2D projection via classical multidimensional scaling (Torgerson MDS) on
// the pairwise distance matrix — the PCA-equivalent projection computed
// from distances, which lets the projection run off the pairwise view
// instead of raw response vectors. Deterministic (Jacobi eigensolver, no
// random initialisation) — chosen over UMAP precisely because UMAP is
// stochastic and this project treats reproducibility as a feature.
// ============================================================

export interface ProjectedPoint {
  id: string;
  x: number;
  y: number;
}

/** Jacobi eigenvalue algorithm for a symmetric matrix. Deterministic. */
function jacobiEigen(matrix: number[][]): { values: number[]; vectors: number[][] } {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
  );

  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p]![q]! * a[p]![q]!;
    }
    if (off < 1e-12) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p]![q]!) < 1e-15) continue;
        const theta = (a[q]![q]! - a[p]![p]!) / (2 * a[p]![q]!);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k]![p]!;
          const akq = a[k]![q]!;
          a[k]![p] = c * akp - s * akq;
          a[k]![q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p]![k]!;
          const aqk = a[q]![k]!;
          a[p]![k] = c * apk - s * aqk;
          a[q]![k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k]![p]!;
          const vkq = v[k]![q]!;
          v[k]![p] = c * vkp - s * vkq;
          v[k]![q] = s * vkp + c * vkq;
        }
      }
    }
  }

  const values = Array.from({ length: n }, (_, i) => a[i]![i]!);
  return { values, vectors: v };
}

export function classicalMdsProjection(ids: string[], pairs: PairDistance[]): ProjectedPoint[] {
  const sortedIds = [...ids].sort();
  const n = sortedIds.length;
  if (n === 0) return [];
  if (n === 1) return [{ id: sortedIds[0]!, x: 0, y: 0 }];

  const index = new Map(sortedIds.map((id, i) => [id, i]));
  const d2: number[][] = Array.from({ length: n }, () => Array(n).fill(0));
  for (const p of pairs) {
    const i = index.get(p.a);
    const j = index.get(p.b);
    if (i === undefined || j === undefined) continue;
    d2[i]![j] = p.distance * p.distance;
    d2[j]![i] = p.distance * p.distance;
  }

  // Double-centre: B = -1/2 * J D² J
  const rowMean = d2.map((row) => row.reduce((s, x) => s + x, 0) / n);
  const grandMean = rowMean.reduce((s, x) => s + x, 0) / n;
  const b: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => -0.5 * (d2[i]![j]! - rowMean[i]! - rowMean[j]! + grandMean))
  );

  const { values, vectors } = jacobiEigen(b);
  const order = values
    .map((value, i) => ({ value, i }))
    .sort((x, y) => y.value - x.value)
    .slice(0, 2);

  return sortedIds.map((id, row) => {
    const coords = order.map(({ value, i }) =>
      value > 1e-9 ? vectors[row]![i]! * Math.sqrt(value) : 0
    );
    return { id, x: coords[0] ?? 0, y: coords[1] ?? 0 };
  });
}

// ============================================================
// Chart-shaped exploratory data for Phase 8.
// ============================================================

export interface NetworkGraph {
  nodes: Array<{ id: string }>;
  edges: Array<{ source: string; target: string; weight: number }>;
}

/**
 * Similarity network: one node per id, an edge for every pair at or above
 * minWeight (e.g. agreement_rate or jaccard_similarity from the pairwise
 * view). Edge direction is meaningless; source < target by construction.
 */
export function buildNetworkGraph(
  ids: string[],
  pairs: Array<{ a: string; b: string; weight: number | null }>,
  minWeight: number
): NetworkGraph {
  const nodes = [...ids].sort().map((id) => ({ id }));
  const edges = pairs
    .filter((p) => p.weight !== null && p.weight >= minWeight)
    .map((p) => ({
      source: p.a < p.b ? p.a : p.b,
      target: p.a < p.b ? p.b : p.a,
      weight: p.weight as number,
    }))
    .sort((x, y) =>
      x.source === y.source ? (x.target < y.target ? -1 : 1) : x.source < y.source ? -1 : 1
    );
  return { nodes, edges };
}
