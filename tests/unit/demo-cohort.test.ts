import { describe, expect, it } from "vitest";
import {
  archetypeFor,
  baseRateFor,
  clamp01,
  COHORT,
  driftFor,
  FLIP_RATES,
  makeRng,
  pairedAnswer,
  RANDOM_SEED,
  STUDENT_COUNT,
  studentIdentifier,
  type Archetype,
} from "@/scripts/demo-cohort";
import {
  classifyStudentShift,
  summariseShiftCategories,
} from "@/lib/analytics/demo-data";

/**
 * The generator behind scripts/seed-demo-analytics.ts. These tests run the
 * real cohort logic end to end in memory — 150 students against a
 * stand-in question set — and assert the properties the demo depends on:
 * determinism, binary-only output, and a spread wide enough that the
 * dashboard actually shows the platform's range rather than one flat
 * pattern.
 */

describe("cohort composition", () => {
  it("adds up to exactly the student count", () => {
    expect(COHORT.reduce((sum, band) => sum + band.count, 0)).toBe(STUDENT_COUNT);
    expect(STUDENT_COUNT).toBe(150);
  });

  it("assigns every student index an archetype, in contiguous bands", () => {
    const seen = new Map<Archetype, number>();
    for (let i = 0; i < STUDENT_COUNT; i++) {
      const a = archetypeFor(i);
      seen.set(a, (seen.get(a) ?? 0) + 1);
    }
    for (const band of COHORT) {
      expect(seen.get(band.archetype), band.archetype).toBe(band.count);
    }
  });

  it("mirrors the two directional archetypes exactly", () => {
    // The demo must not make one direction look stronger than the other by
    // construction — that would be an editorial choice smuggled into data.
    expect(FLIP_RATES.TOWARD_1.to1).toBe(FLIP_RATES.TOWARD_0.to0);
    expect(FLIP_RATES.TOWARD_1.to0).toBe(FLIP_RATES.TOWARD_0.to1);
    expect(FLIP_RATES.HIGH_CHURN.to1).toBe(FLIP_RATES.HIGH_CHURN.to0);
    expect(FLIP_RATES.STABLE.to1).toBe(FLIP_RATES.STABLE.to0);
  });

  it("numbers students STU001–STU150", () => {
    expect(studentIdentifier(0)).toBe("STU001");
    expect(studentIdentifier(149)).toBe("STU150");
    // Fictional identifiers only — no real roll number shape.
    expect(studentIdentifier(42)).toMatch(/^STU\d{3}$/);
  });
});

describe("determinism", () => {
  it("produces an identical sequence from the same seed", () => {
    const a = makeRng(RANDOM_SEED);
    const b = makeRng(RANDOM_SEED);
    const first = Array.from({ length: 500 }, () => a());
    const second = Array.from({ length: 500 }, () => b());
    expect(first).toEqual(second);
  });

  it("produces values in [0, 1)", () => {
    const rng = makeRng(RANDOM_SEED);
    for (let i = 0; i < 2000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("derives stable, bounded base rates and symmetric drift from labels", () => {
    expect(baseRateFor("Solar", "Is it renewable?")).toBe(
      baseRateFor("Solar", "Is it renewable?")
    );
    for (const source of ["Solar", "Coal", "Tidal", "Nuclear", null]) {
      const rate = baseRateFor(source, "criterion");
      expect(rate).toBeGreaterThanOrEqual(0.2);
      expect(rate).toBeLessThanOrEqual(0.8);
      const drift = driftFor(source);
      expect(Math.abs(drift)).toBeLessThanOrEqual(0.25);
    }
    // Trailing whitespace in the A2 sheet must not create a second drift.
    expect(driftFor("Solar ")).toBe(driftFor("Solar"));
  });

  it("clamps probabilities into range", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(0.4)).toBe(0.4);
  });
});

describe("pairedAnswer", () => {
  it("only ever returns 0 or 1", () => {
    const rng = makeRng(RANDOM_SEED);
    for (let i = 0; i < 1000; i++) {
      for (const previous of [0, 1] as const) {
        for (const archetype of Object.keys(FLIP_RATES) as Archetype[]) {
          const v = pairedAnswer(previous, archetype, driftFor("Solar"), rng());
          expect(v === 0 || v === 1).toBe(true);
        }
      }
    }
  });

  it("keeps the previous answer when the roll misses the flip chance", () => {
    // roll = 1 can never be below any probability, so the answer holds.
    expect(pairedAnswer(0, "TOWARD_1", 0, 1)).toBe(0);
    expect(pairedAnswer(1, "TOWARD_0", 0, 1)).toBe(1);
    // roll = 0 is below any positive probability, so the answer flips.
    expect(pairedAnswer(0, "TOWARD_1", 0, 0)).toBe(1);
    expect(pairedAnswer(1, "TOWARD_0", 0, 0)).toBe(0);
  });

  it("never flips when the clamped chance is zero", () => {
    // A drift strong enough to cancel the flip rate must floor at 0, not
    // go negative and start behaving unpredictably.
    expect(pairedAnswer(0, "STABLE", -1, 0)).toBe(0);
    expect(pairedAnswer(1, "STABLE", 1, 0)).toBe(1);
  });
});

// ============================================================
// The property that actually matters for the demo: run the whole cohort
// and check the resulting transition mix is spread across all four states
// and all three shift categories.
// ============================================================

interface FakeQuestion {
  id: string;
  energy_source: string;
  criterion: string;
}

/** A stand-in for the real mapped question set: 15 energy sources × 2
 *  criteria, the shape Assignment 1 actually has. */
const MAPPED: FakeQuestion[] = [
  "Solar", "Wind", "Hydro", "Biomass", "Coal", "Oil", "Thermal", "Human",
  "Animal", "Gas", "Nuclear", "Fusion", "Kinetic", "Magnetic", "Chemical",
].flatMap((source, i) =>
  ["Conventional", "Renewable over 25 years"].map((criterion, j) => ({
    id: `q-${i}-${j}`,
    energy_source: source,
    criterion,
  }))
);

function runCohort() {
  const rng = makeRng(RANDOM_SEED);
  const totals = { s00: 0, s01: 0, s10: 0, s11: 0 };
  const perStudent: Array<{ valid_paired: number; net_movement_toward_1: number; archetype: Archetype }> = [];

  for (let i = 0; i < STUDENT_COUNT; i++) {
    const archetype = archetypeFor(i);
    let s01 = 0;
    let s10 = 0;
    let pairs = 0;

    for (const q of MAPPED) {
      const a1 = rng() < baseRateFor(q.energy_source, q.criterion) ? 1 : 0;
      const a2 = pairedAnswer(a1 as 0 | 1, archetype, driftFor(q.energy_source), rng());
      expect(a1 === 0 || a1 === 1).toBe(true);
      expect(a2 === 0 || a2 === 1).toBe(true);
      totals[`s${a1}${a2}` as keyof typeof totals] += 1;
      if (a1 === 0 && a2 === 1) s01 += 1;
      if (a1 === 1 && a2 === 0) s10 += 1;
      pairs += 1;
    }

    perStudent.push({ valid_paired: pairs, net_movement_toward_1: s01 - s10, archetype });
  }

  return { totals, perStudent };
}

describe("generated cohort shape", () => {
  it("produces every transition state, none of them empty", () => {
    const { totals } = runCohort();
    const all = totals.s00 + totals.s01 + totals.s10 + totals.s11;
    expect(all).toBe(STUDENT_COUNT * MAPPED.length);
    for (const state of ["s00", "s01", "s10", "s11"] as const) {
      expect(totals[state], `${state} must not be empty`).toBeGreaterThan(0);
    }
  });

  it("fills all three shift categories with a real spread", () => {
    const { perStudent } = runCohort();
    const { counts, classifiable } = summariseShiftCategories(perStudent);
    expect(classifiable).toBe(STUDENT_COUNT);

    const by = Object.fromEntries(counts.map((c) => [c.category, c.students]));
    // The whole point of the demo dataset: none of the three categories is
    // a rounding error, so the dashboard shows the platform's range.
    expect(by.SHIFTED_TOWARD_1).toBeGreaterThan(10);
    expect(by.SHIFTED_TOWARD_0).toBeGreaterThan(10);
    expect(by.NO_NET_CHANGE).toBeGreaterThan(0);
  });

  it("puts the directional archetypes in the categories they were built for", () => {
    const { perStudent } = runCohort();
    const toward1 = perStudent.filter((s) => s.archetype === "TOWARD_1");
    const toward0 = perStudent.filter((s) => s.archetype === "TOWARD_0");

    // Not "every single one" — these are random draws, not scripted
    // outcomes. The claim is that the archetype dominates its cohort.
    const shifted1 = toward1.filter((s) => classifyStudentShift(s) === "SHIFTED_TOWARD_1").length;
    const shifted0 = toward0.filter((s) => classifyStudentShift(s) === "SHIFTED_TOWARD_0").length;
    expect(shifted1 / toward1.length).toBeGreaterThan(0.8);
    expect(shifted0 / toward0.length).toBeGreaterThan(0.8);
  });

  it("gives high-churn students movement in both directions, not a net drift", () => {
    // This is the case docs/ANALYTICS_DEFINITIONS.md warns about: a high
    // change rate with a net shift near zero. If the demo lacked it, a
    // viewer could wrongly read change rate and net shift as the same
    // number.
    const { perStudent } = runCohort();
    const churn = perStudent.filter((s) => s.archetype === "HIGH_CHURN");
    const meanNet =
      churn.reduce((sum, s) => sum + s.net_movement_toward_1, 0) / churn.length;
    expect(Math.abs(meanNet)).toBeLessThan(MAPPED.length * 0.15);
  });

  it("is reproducible run to run", () => {
    expect(runCohort().totals).toEqual(runCohort().totals);
  });
});
