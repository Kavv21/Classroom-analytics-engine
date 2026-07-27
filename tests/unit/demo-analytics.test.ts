import { describe, expect, it } from "vitest";
import {
  answerLabel,
  classifyStudentShift,
  DEMO_NEUTRALITY_NOTE,
  DEMO_PAIR_COLUMNS,
  demoEnergySourceRows,
  demoPairCells,
  demoPairRows,
  demoStudentRows,
  formatCount,
  formatPctPoints,
  formatRelativeChange,
  formatShare,
  formatSignedCount,
  FORMULAS,
  NO_VALUE,
  PAIR_SHIFT_LABELS,
  pairShiftLabel,
  provenanceFootnote,
  SHIFT_CATEGORY_DEFINITIONS,
  SHIFT_CATEGORY_LABELS,
  summariseShiftCategories,
  SYNTHETIC_NOTE,
  TRANSITION_SHIFT_CATEGORY,
  type DemoScope,
} from "@/lib/analytics/demo-data";
import type {
  EnergySourceAssignmentChange,
  ResponseTransitionLiveRow,
  StudentTransitionSummary,
} from "@/lib/analytics/queries";

function student(overrides: Partial<StudentTransitionSummary> = {}): StudentTransitionSummary {
  const base: StudentTransitionSummary = {
    class_id: "c",
    student_id: "s",
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
    changed_count: 0,
    unchanged_count: 0,
    change_rate: null,
    stability_rate: null,
    net_movement_toward_1: 0,
    pct_point_shift: null,
  };
  return { ...base, ...overrides };
}

function sourceChange(
  overrides: Partial<EnergySourceAssignmentChange> = {}
): EnergySourceAssignmentChange {
  const base: EnergySourceAssignmentChange = {
    class_id: "c",
    energy_source: "Solar",
    a1_energy_source_raw: "Solar",
    a2_energy_source_raw: "Solar ",
    both_sides_present: true,
    a1_question_count: 2,
    a2_question_count: 17,
    a1_answered: 300,
    a2_answered: 2550,
    a1_zeros: 200,
    a2_zeros: 1550,
    a1_ones: 100,
    a2_ones: 1000,
    a1_pct_one: 100 / 300,
    a2_pct_one: 1000 / 2550,
    ones_absolute_change: 900,
    ones_relative_change: 9,
    pct_point_shift: 1000 / 2550 - 100 / 300,
  };
  return { ...base, ...overrides };
}

// ============================================================
// Per-student classification.
// ============================================================

describe("classifyStudentShift", () => {
  it("reads direction from net movement toward 1", () => {
    expect(classifyStudentShift(student({ valid_paired: 10, net_movement_toward_1: 3 }))).toBe(
      "SHIFTED_TOWARD_1"
    );
    expect(classifyStudentShift(student({ valid_paired: 10, net_movement_toward_1: -3 }))).toBe(
      "SHIFTED_TOWARD_0"
    );
    expect(classifyStudentShift(student({ valid_paired: 10, net_movement_toward_1: 0 }))).toBe(
      "NO_NET_CHANGE"
    );
  });

  it("gives a student with no comparable pairs its own status, not 'no change'", () => {
    // Forcing this into NO_NET_CHANGE would assert a finding the data does
    // not contain — the same error as bucketing a missing answer into a
    // transition state.
    expect(classifyStudentShift(student({ valid_paired: 0, net_movement_toward_1: 0 }))).toBe(
      "NO_COMPARABLE_PAIRS"
    );
  });

  it("does not collapse a high-churn student into a changed category", () => {
    // 6 moves toward 1 and 6 moves toward 0: change rate is high, net
    // movement is zero. Category follows net movement; the changed count
    // stays visible separately so the two are never conflated.
    const churner = student({
      valid_paired: 20,
      s01: 6,
      s10: 6,
      s00: 4,
      s11: 4,
      changed_count: 12,
      unchanged_count: 8,
      change_rate: 0.6,
      net_movement_toward_1: 0,
    });
    expect(classifyStudentShift(churner)).toBe("NO_NET_CHANGE");
    const [row] = demoStudentRows([churner], {});
    expect(row!.changedCount).toBe(12);
    expect(row!.changeRate).toBe(0.6);
    expect(row!.netMovementToward1).toBe(0);
  });
});

describe("summariseShiftCategories", () => {
  it("counts the three categories and shares them over classifiable students", () => {
    const summaries = [
      student({ valid_paired: 5, net_movement_toward_1: 2 }),
      student({ valid_paired: 5, net_movement_toward_1: 1 }),
      student({ valid_paired: 5, net_movement_toward_1: -3 }),
      student({ valid_paired: 5, net_movement_toward_1: 0 }),
    ];
    const { counts, classifiable, total } = summariseShiftCategories(summaries);
    expect(total).toBe(4);
    expect(classifiable).toBe(4);
    expect(counts.map((c) => [c.category, c.students])).toEqual([
      ["SHIFTED_TOWARD_1", 2],
      ["SHIFTED_TOWARD_0", 1],
      ["NO_NET_CHANGE", 1],
    ]);
    expect(counts[0]!.share).toBeCloseTo(0.5);
    expect(counts.reduce((sum, c) => sum + (c.share ?? 0), 0)).toBeCloseTo(1);
  });

  it("excludes no-comparable-pairs students from the share denominator", () => {
    const summaries = [
      student({ valid_paired: 4, net_movement_toward_1: 2 }),
      student({ valid_paired: 0, net_movement_toward_1: 0 }),
      student({ valid_paired: 0, net_movement_toward_1: 0 }),
    ];
    const { counts, classifiable } = summariseShiftCategories(summaries);
    expect(classifiable).toBe(1);
    expect(counts.find((c) => c.category === "SHIFTED_TOWARD_1")!.share).toBe(1);
    const noPairs = counts.find((c) => c.category === "NO_COMPARABLE_PAIRS")!;
    expect(noPairs.students).toBe(2);
    // Reported with a count but no percentage of a population it is not in.
    expect(noPairs.share).toBeNull();
  });

  it("reports NULL shares, never 0%, when nothing is classifiable", () => {
    const { counts, classifiable } = summariseShiftCategories([student({ valid_paired: 0 })]);
    expect(classifiable).toBe(0);
    for (const c of counts) {
      if (c.category !== "NO_COMPARABLE_PAIRS") expect(c.share).toBeNull();
    }
    expect(formatShare(counts[0]!.share)).toBe(NO_VALUE);
  });
});

// ============================================================
// Per-pair classification.
// ============================================================

describe("pair shift categories", () => {
  it("maps each transition state to a direction, with S00 and S11 as no change", () => {
    expect(TRANSITION_SHIFT_CATEGORY.S01).toBe("SHIFTED_TOWARD_1");
    expect(TRANSITION_SHIFT_CATEGORY.S10).toBe("SHIFTED_TOWARD_0");
    expect(TRANSITION_SHIFT_CATEGORY.S00).toBe("NO_NET_CHANGE");
    expect(TRANSITION_SHIFT_CATEGORY.S11).toBe("NO_NET_CHANGE");
  });

  it("reports a data-quality status as itself, never as 'no change'", () => {
    // "we don't have both answers" and "the answer did not move" are
    // different facts and must never share a label.
    expect(pairShiftLabel(null, "MISSING_A1")).toBe("No Assignment 1 answer");
    expect(pairShiftLabel(null, "MISSING_A2")).toBe("No Assignment 2 answer");
    expect(pairShiftLabel(null, "MISSING_BOTH")).toBe("No answers");
    expect(pairShiftLabel(null, "NOT_COMPARABLE")).toBe("Not comparable");
    expect(pairShiftLabel(null, null)).toBe(NO_VALUE);
    for (const status of ["MISSING_A1", "MISSING_A2", "MISSING_BOTH", "NOT_COMPARABLE"]) {
      expect(pairShiftLabel(null, status)).not.toBe(PAIR_SHIFT_LABELS.NO_NET_CHANGE);
    }
  });

  it("keeps the on-screen table and the CSV export on one definition", () => {
    const live: ResponseTransitionLiveRow[] = [
      {
        class_id: "c",
        mapping_id: "m1",
        mapping_name: "Solar — availability",
        mapping_version: 2,
        mapping_type: "CONCEPTUAL_ONE_TO_ONE",
        energy_source: "Solar ",
        criterion: "Is it renewable?",
        student_id: "stu-1",
        assignment_1_value: 0,
        assignment_2_value: 1,
        transition_state: "S01",
        data_quality_status: null,
      },
    ];
    const rows = demoPairRows(live, { "stu-1": "Demo Student 001" }, new Set(["stu-1"]));
    expect(rows).toHaveLength(1);
    // Raw label is trimmed for display grouping; the value itself is
    // preserved upstream in the view's *_raw columns.
    expect(rows[0]!.energySource).toBe("Solar");
    expect(rows[0]!.a1Answer).toBe("0 — No");
    expect(rows[0]!.a2Answer).toBe("1 — Yes");
    expect(rows[0]!.shiftLabel).toBe(PAIR_SHIFT_LABELS.SHIFTED_TOWARD_1);
    expect(rows[0]!.isSynthetic).toBe(true);

    const cells = demoPairCells(rows[0]!);
    expect(cells).toHaveLength(DEMO_PAIR_COLUMNS.length);
    expect(cells[cells.length - 1]).toBe("yes");
  });

  it("marks non-synthetic students in the same table as non-synthetic", () => {
    const live: ResponseTransitionLiveRow[] = [
      {
        class_id: "c",
        mapping_id: "m1",
        mapping_name: "m",
        mapping_version: 1,
        mapping_type: "EXACT_ONE_TO_ONE",
        energy_source: null,
        criterion: null,
        student_id: "real-1",
        assignment_1_value: 1,
        assignment_2_value: 1,
        transition_state: "S11",
        data_quality_status: null,
      },
    ];
    const rows = demoPairRows(live, {}, new Set(["stu-1"]));
    expect(rows[0]!.isSynthetic).toBe(false);
    expect(rows[0]!.energySource).toBe("(no energy source)");
  });
});

// ============================================================
// Energy-source change + zero-baseline safety.
// ============================================================

describe("energy source change rows", () => {
  it("carries both raw spreadsheet labels through unchanged", () => {
    // A2's sheet writes "Solar " with a trailing space; the view joins on
    // the trimmed key but must not rewrite either original label.
    const [row] = demoEnergySourceRows([sourceChange()]);
    expect(row!.energySource).toBe("Solar");
    expect(row!.a1Label).toBe("Solar");
    expect(row!.a2Label).toBe("Solar ");
  });

  it("renders a zero baseline as '—', never as a number", () => {
    const zeroBaseline = sourceChange({
      a1_ones: 0,
      a2_ones: 40,
      ones_absolute_change: 40,
      ones_relative_change: null,
    });
    const [row] = demoEnergySourceRows([zeroBaseline]);
    expect(row!.relativeChange).toBeNull();
    expect(formatRelativeChange(row!.relativeChange)).toBe(NO_VALUE);
    // The absolute change is still a real, defined number.
    expect(formatSignedCount(row!.absoluteChange)).toBe("+40");
  });

  it("renders a one-sided energy source as '—' rather than zero", () => {
    // Assignment 1 has Thermal/Fusion/Kinetic/Magnetic; Assignment 2 has
    // Geothermal/Tidal/Wave/Garbage. A source nobody was asked about did
    // not score zero — it has no value.
    const oneSided = sourceChange({
      energy_source: "Tidal",
      both_sides_present: false,
      a1_energy_source_raw: null,
      a1_question_count: null,
      a1_answered: null,
      a1_zeros: null,
      a1_ones: null,
      a1_pct_one: null,
      ones_absolute_change: null,
      ones_relative_change: null,
      pct_point_shift: null,
    });
    const [row] = demoEnergySourceRows([oneSided]);
    expect(row!.bothSidesPresent).toBe(false);
    expect(formatCount(row!.a1Ones)).toBe(NO_VALUE);
    expect(formatSignedCount(row!.absoluteChange)).toBe(NO_VALUE);
    expect(formatRelativeChange(row!.relativeChange)).toBe(NO_VALUE);
    expect(formatPctPoints(row!.pctPointShift)).toBe(NO_VALUE);
  });
});

describe("formatters", () => {
  it("never emits NaN, Infinity, or a fabricated zero", () => {
    // NaN and ±Infinity are exactly what a divide-by-zero produces if one
    // ever escapes the SQL guard. Every formatter must show "—" instead of
    // rendering it, and must never substitute a plausible-looking zero.
    const formatters = [
      formatCount,
      formatShare,
      formatRelativeChange,
      formatPctPoints,
      formatSignedCount,
    ];
    for (const format of formatters) {
      for (const value of [null, undefined, NaN, Infinity, -Infinity]) {
        const out = format(value as number | null | undefined);
        expect(out).toBe(NO_VALUE);
      }
    }
  });

  it("signs changes in both directions identically", () => {
    expect(formatSignedCount(12)).toBe("+12");
    expect(formatSignedCount(-12)).toBe("-12");
    expect(formatRelativeChange(0.25)).toBe("+25.0%");
    expect(formatRelativeChange(-0.25)).toBe("-25.0%");
    expect(formatPctPoints(0.031)).toBe("+3.1pp");
  });
});

// ============================================================
// Provenance.
// ============================================================

describe("provenance", () => {
  const scope: DemoScope = {
    syntheticStudents: 150,
    realStudents: 0,
    assignment1Title: "Assignment 1 — Classification of Energy Sources",
    assignment2Title: "Assignment 2 — Analysis of Fuel Sources",
    approvedMappings: 19,
  };

  it("states synthetic origin, cohort size, comparison and formula", () => {
    const note = provenanceFootnote(scope, "A1 → A2, per energy source", FORMULAS.absoluteChange);
    expect(note).toContain("Synthetic demo data");
    expect(note).toContain("150 synthetic students");
    expect(note).toContain("A1 → A2, per energy source");
    expect(note).toContain(FORMULAS.absoluteChange);
  });

  it("discloses a mixed cohort instead of describing it as purely synthetic", () => {
    const note = provenanceFootnote({ ...scope, realStudents: 30 }, "comparison", "formula");
    expect(note).toContain("150 synthetic students");
    expect(note).toContain("30 non-synthetic students");
  });

  it("says the relative-change zero-baseline rule out loud", () => {
    expect(FORMULAS.relativeChange).toContain("—");
    expect(FORMULAS.relativeChange).toMatch(/zero/i);
  });
});

// ============================================================
// The neutral-language boundary. This mirrors the assertion in
// tests/unit/analytics-chart-data.test.ts and extends it over every string
// the demo dashboard can put on screen or into an export — the reframing
// of "improved / declined" into "shifted toward 1 / shifted toward 0" is a
// project rule, not a styling preference, so it gets a test.
// ============================================================

const BANNED = /correct|wrong|improve|better|worse|learn|score|grade|pass|fail/i;

describe("neutral labelling (demo dashboard)", () => {
  it("no demo label, definition, formula or note uses assessment language", () => {
    const strings = [
      ...Object.values(SHIFT_CATEGORY_LABELS),
      ...Object.values(SHIFT_CATEGORY_DEFINITIONS),
      ...Object.values(PAIR_SHIFT_LABELS),
      ...Object.values(FORMULAS),
      ...DEMO_PAIR_COLUMNS,
      SYNTHETIC_NOTE,
      DEMO_NEUTRALITY_NOTE,
      answerLabel(0),
      answerLabel(1),
      answerLabel(null),
      pairShiftLabel(null, "MISSING_A1"),
      pairShiftLabel(null, "NOT_COMPARABLE"),
      provenanceFootnote(
        {
          syntheticStudents: 150,
          realStudents: 0,
          assignment1Title: "A1",
          assignment2Title: "A2",
          approvedMappings: 19,
        },
        "comparison",
        FORMULAS.changeRate
      ),
    ];
    for (const value of strings) {
      expect(value, `"${value}" must not use assessment language`).not.toMatch(BANNED);
    }
  });

  it("names both directions symmetrically", () => {
    // Neither direction may be described in stronger or weaker terms than
    // the other: same verb, same shape, only the target differs.
    expect(SHIFT_CATEGORY_LABELS.SHIFTED_TOWARD_1).toBe("Shifted toward 1 — Yes");
    expect(SHIFT_CATEGORY_LABELS.SHIFTED_TOWARD_0).toBe("Shifted toward 0 — No");
    expect(PAIR_SHIFT_LABELS.SHIFTED_TOWARD_1.replace("1 — Yes", "")).toBe(
      PAIR_SHIFT_LABELS.SHIFTED_TOWARD_0.replace("0 — No", "")
    );
  });

  it("keeps 0/1 answer wording identical to the rest of the app", () => {
    expect(answerLabel(0)).toBe("0 — No");
    expect(answerLabel(1)).toBe("1 — Yes");
    expect(answerLabel(null)).toBe("no answer");
  });
});
