import { createHash } from "node:crypto";

/**
 * The pure, deterministic core of the synthetic demo cohort.
 *
 * Kept separate from scripts/seed-demo-analytics.ts (which owns the
 * database I/O and the safety guards) so the part that decides what 150
 * fictional students answer can be unit-tested without a database — see
 * tests/unit/demo-cohort.test.ts.
 *
 * Nothing here computes an analytic. It only produces 0/1 answers; every
 * rate, transition and shift in the demo is computed by the real Phase 7
 * views from the rows these answers become.
 */

export const STUDENT_COUNT = 150;

/** Fixed seed — reproducibility is a requirement, not a nicety. */
export const RANDOM_SEED = 20260727;

export type Archetype = "TOWARD_1" | "TOWARD_0" | "STABLE" | "HIGH_CHURN";

/**
 * Fixed cohort composition.
 *
 * HIGH_CHURN exists specifically so the demo can show the distinction
 * docs/ANALYTICS_DEFINITIONS.md insists on: those students have a high
 * change rate and a net movement near zero, which is exactly the case
 * where collapsing change rate and net shift into one number would lie.
 */
export const COHORT: Array<{ archetype: Archetype; count: number }> = [
  { archetype: "TOWARD_1", count: 40 },
  { archetype: "TOWARD_0", count: 35 },
  { archetype: "STABLE", count: 55 },
  { archetype: "HIGH_CHURN", count: 20 },
];

/**
 * Probability of moving 0 -> 1 and of moving 1 -> 0, per archetype.
 * TOWARD_1 and TOWARD_0 are exact mirrors of each other: the demo shows
 * both directions with equal strength, because neither direction is the
 * interesting one.
 */
export const FLIP_RATES: Record<Archetype, { to1: number; to0: number }> = {
  TOWARD_1: { to1: 0.45, to0: 0.05 },
  TOWARD_0: { to1: 0.05, to0: 0.45 },
  STABLE: { to1: 0.06, to0: 0.06 },
  HIGH_CHURN: { to1: 0.35, to0: 0.35 },
};

export function archetypeFor(index: number): Archetype {
  let cursor = 0;
  for (const band of COHORT) {
    cursor += band.count;
    if (index < cursor) return band.archetype;
  }
  return "STABLE";
}

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Stable [0,1) from a string. Used for per-question base rates and
 * per-source drift, so opinions vary by energy source and criterion
 * without this script encoding any real-world stance about any energy
 * source — which it has no business having.
 */
export function hashUnit(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0) / 4294967296;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Base probability of answering 1, from the question's classification. */
export function baseRateFor(energySource: string | null, criterion: string | null): number {
  return 0.2 + hashUnit(`${energySource ?? ""}|${criterion ?? ""}`) * 0.6;
}

/** Per-energy-source drift, pushing different sources in different
 *  directions between the two assignments. Symmetric around zero. */
export function driftFor(energySource: string | null): number {
  return hashUnit(`drift:${(energySource ?? "").trim()}`) * 0.5 - 0.25;
}

export function studentIdentifier(index: number): string {
  return `STU${String(index + 1).padStart(3, "0")}`;
}

/**
 * The Assignment 2 answer for a question that IS the side-2 half of an
 * approved one-to-one mapping: derived from the paired Assignment 1
 * answer so the archetype shows up as a transition pattern rather than as
 * noise. Returns 0 or 1 — never anything else.
 */
export function pairedAnswer(
  previous: 0 | 1,
  archetype: Archetype,
  drift: number,
  roll: number
): 0 | 1 {
  const flips = FLIP_RATES[archetype];
  const flipChance =
    previous === 0 ? clamp01(flips.to1 + drift) : clamp01(flips.to0 - drift);
  return roll < flipChance ? ((1 - previous) as 0 | 1) : previous;
}
