import type {
  EnergySourceAssignmentChange,
  StudentTransitionSummary,
} from "@/lib/analytics/queries";

/**
 * Pure shaping for the synthetic Demo Dashboard. No fetching, no ECharts,
 * no SQL — every number here arrives already computed by the Phase 7
 * views (migration 0012) or by energy_source_assignment_change (0017).
 * Nothing in this file recalculates a transition, a rate, or a shift.
 *
 * LANGUAGE RULE (.claude/rules/analytics.md, and the neutral-labelling
 * test in tests/unit/analytics-chart-data.test.ts): a movement from 0 to 1
 * and a movement from 1 to 0 are the same kind of event in opposite
 * directions. Direction is described — "shifted toward 1", "shifted toward
 * 0" — and never valued. No label here may imply correctness, progress,
 * or attainment.
 */

// ============================================================
// Per-student shift categories.
//
// The classifier reads student_transition_summary.net_movement_toward_1,
// which the view defines as S01 - S10 (docs/ANALYTICS_DEFINITIONS.md,
// "Net movement toward 1"). This is a BUCKETING of that existing number,
// not a second way of computing it.
// ============================================================

export const SHIFT_CATEGORIES = [
  "SHIFTED_TOWARD_1",
  "SHIFTED_TOWARD_0",
  "NO_NET_CHANGE",
] as const;

export type ShiftCategory = (typeof SHIFT_CATEGORIES)[number];

/**
 * A student with no comparable pairs has no direction at all. Forcing them
 * into NO_NET_CHANGE would state a finding the data does not contain —
 * the same mistake as bucketing a missing answer into a transition state.
 * They get their own status, exactly like data_quality_status does.
 */
export type ShiftClassification = ShiftCategory | "NO_COMPARABLE_PAIRS";

export const SHIFT_CATEGORY_LABELS: Record<ShiftClassification, string> = {
  SHIFTED_TOWARD_1: "Shifted toward 1 — Yes",
  SHIFTED_TOWARD_0: "Shifted toward 0 — No",
  NO_NET_CHANGE: "No net change",
  NO_COMPARABLE_PAIRS: "No comparable pairs",
};

export const SHIFT_CATEGORY_DEFINITIONS: Record<ShiftClassification, string> = {
  SHIFTED_TOWARD_1:
    "More of this student's answers moved 0 → 1 than 1 → 0 (net movement toward 1 is positive).",
  SHIFTED_TOWARD_0:
    "More of this student's answers moved 1 → 0 than 0 → 1 (net movement toward 0 is positive).",
  NO_NET_CHANGE:
    "0 → 1 and 1 → 0 moves cancel out (net movement is zero). This includes students who changed nothing and students whose changes balanced; the changed / unchanged columns separate the two.",
  NO_COMPARABLE_PAIRS:
    "This student has no paired response where both answers are binary under an approved mapping, so no direction can be stated.",
};

export function classifyStudentShift(
  summary: Pick<StudentTransitionSummary, "valid_paired" | "net_movement_toward_1">
): ShiftClassification {
  if (summary.valid_paired === 0) return "NO_COMPARABLE_PAIRS";
  if (summary.net_movement_toward_1 > 0) return "SHIFTED_TOWARD_1";
  if (summary.net_movement_toward_1 < 0) return "SHIFTED_TOWARD_0";
  return "NO_NET_CHANGE";
}

export interface ShiftCategoryCount {
  category: ShiftClassification;
  label: string;
  students: number;
  /** Share of students that HAVE comparable pairs. NULL when none do. */
  share: number | null;
}

/**
 * Counts and shares per category. The share denominator is students with
 * at least one comparable pair — NO_COMPARABLE_PAIRS is reported with a
 * count and a NULL share rather than being given a percentage of a
 * population it is excluded from. Zero classifiable students yields NULL
 * shares throughout, never 0% (Phase 7 rule: rates over nothing are
 * unknown, not zero).
 */
export function summariseShiftCategories(
  summaries: Array<Pick<StudentTransitionSummary, "valid_paired" | "net_movement_toward_1">>
): { counts: ShiftCategoryCount[]; classifiable: number; total: number } {
  const tally: Record<ShiftClassification, number> = {
    SHIFTED_TOWARD_1: 0,
    SHIFTED_TOWARD_0: 0,
    NO_NET_CHANGE: 0,
    NO_COMPARABLE_PAIRS: 0,
  };
  for (const s of summaries) tally[classifyStudentShift(s)] += 1;

  const classifiable = tally.SHIFTED_TOWARD_1 + tally.SHIFTED_TOWARD_0 + tally.NO_NET_CHANGE;

  const counts: ShiftCategoryCount[] = SHIFT_CATEGORIES.map((category) => ({
    category,
    label: SHIFT_CATEGORY_LABELS[category],
    students: tally[category],
    share: classifiable > 0 ? tally[category] / classifiable : null,
  }));

  if (tally.NO_COMPARABLE_PAIRS > 0) {
    counts.push({
      category: "NO_COMPARABLE_PAIRS",
      label: SHIFT_CATEGORY_LABELS.NO_COMPARABLE_PAIRS,
      students: tally.NO_COMPARABLE_PAIRS,
      share: null,
    });
  }

  return { counts, classifiable, total: summaries.length };
}

// ============================================================
// Per-pair shift categories.
//
// The same three neutral categories applied at the grain of one
// (student × approved mapping) pair, read straight off the transition
// state the view already assigned. S00 and S11 are "no change" because
// the answer did not move — not because the student stayed correct.
// ============================================================

export const TRANSITION_SHIFT_CATEGORY: Record<"S00" | "S01" | "S10" | "S11", ShiftCategory> = {
  S00: "NO_NET_CHANGE",
  S01: "SHIFTED_TOWARD_1",
  S10: "SHIFTED_TOWARD_0",
  S11: "NO_NET_CHANGE",
};

export const PAIR_SHIFT_LABELS: Record<ShiftCategory, string> = {
  SHIFTED_TOWARD_1: "Shifted toward 1 — Yes",
  SHIFTED_TOWARD_0: "Shifted toward 0 — No",
  NO_NET_CHANGE: "No change",
};

/**
 * A pair with no transition state carries a data_quality_status instead —
 * it is reported as that status, never as "no change", because "we don't
 * have both answers" and "the answer did not move" are different facts.
 */
export function pairShiftLabel(
  transitionState: "S00" | "S01" | "S10" | "S11" | null,
  dataQualityStatus: string | null
): string {
  if (transitionState) return PAIR_SHIFT_LABELS[TRANSITION_SHIFT_CATEGORY[transitionState]];
  switch (dataQualityStatus) {
    case "MISSING_A1":
      return "No Assignment 1 answer";
    case "MISSING_A2":
      return "No Assignment 2 answer";
    case "MISSING_BOTH":
      return "No answers";
    case "NOT_COMPARABLE":
      return "Not comparable";
    default:
      return NO_VALUE;
  }
}

export function answerLabel(value: 0 | 1 | null): string {
  if (value === null) return "no answer";
  return value === 0 ? "0 — No" : "1 — Yes";
}

// ============================================================
// Per-student table rows.
// ============================================================

export interface DemoStudentRow {
  studentId: string;
  name: string;
  category: ShiftClassification;
  categoryLabel: string;
  validPaired: number;
  changedCount: number;
  unchangedCount: number;
  s00: number;
  s01: number;
  s10: number;
  s11: number;
  changeRate: number | null;
  netMovementToward1: number;
  pctPointShift: number | null;
}

export function demoStudentRows(
  summaries: StudentTransitionSummary[],
  studentNames: Record<string, string>
): DemoStudentRow[] {
  return summaries.map((s) => {
    const category = classifyStudentShift(s);
    return {
      studentId: s.student_id,
      name: studentNames[s.student_id] ?? `Student ${s.student_id.slice(0, 8)}`,
      category,
      categoryLabel: SHIFT_CATEGORY_LABELS[category],
      validPaired: s.valid_paired,
      changedCount: s.changed_count,
      unchangedCount: s.unchanged_count,
      s00: s.s00,
      s01: s.s01,
      s10: s.s10,
      s11: s.s11,
      changeRate: s.change_rate,
      netMovementToward1: s.net_movement_toward_1,
      pctPointShift: s.pct_point_shift,
    };
  });
}

// ============================================================
// The filterable per-pair table.
//
// ONE definition of the columns and of each row, used by BOTH the on-screen
// table and the CSV export route, so the file a professor downloads can
// never disagree with the screen it was downloaded from.
// ============================================================

export const DEMO_PAIR_COLUMNS = [
  "Student",
  "Student ID",
  "Energy source",
  "Criterion",
  "Mapping",
  "Mapping version",
  "Assignment 1 answer",
  "Assignment 2 answer",
  "Transition state",
  "Shift category",
  "Synthetic",
] as const;

export interface DemoPairRow {
  studentId: string;
  studentName: string;
  energySource: string;
  criterion: string;
  mappingName: string;
  mappingVersion: number;
  a1Answer: string;
  a2Answer: string;
  transitionState: string;
  shiftLabel: string;
  isSynthetic: boolean;
}

export const NO_SOURCE_LABEL = "(no energy source)";
export const NO_CRITERION_LABEL = "(no criterion)";

export function demoPairRows(
  liveRows: Array<{
    student_id: string;
    energy_source: string | null;
    criterion: string | null;
    mapping_name: string;
    mapping_version: number;
    assignment_1_value: 0 | 1 | null;
    assignment_2_value: 0 | 1 | null;
    transition_state: "S00" | "S01" | "S10" | "S11" | null;
    data_quality_status: string | null;
  }>,
  studentNames: Record<string, string>,
  syntheticStudentIds: ReadonlySet<string>
): DemoPairRow[] {
  return liveRows.map((r) => ({
    studentId: r.student_id,
    studentName: studentNames[r.student_id] ?? `Student ${r.student_id.slice(0, 8)}`,
    energySource: r.energy_source?.trim() || NO_SOURCE_LABEL,
    criterion: r.criterion?.trim() || NO_CRITERION_LABEL,
    mappingName: r.mapping_name,
    mappingVersion: r.mapping_version,
    a1Answer: answerLabel(r.assignment_1_value),
    a2Answer: answerLabel(r.assignment_2_value),
    transitionState: r.transition_state ?? (r.data_quality_status ?? NO_VALUE),
    shiftLabel: pairShiftLabel(r.transition_state, r.data_quality_status),
    isSynthetic: syntheticStudentIds.has(r.student_id),
  }));
}

export function demoPairCells(row: DemoPairRow): Array<string | number | null> {
  return [
    row.studentName,
    row.studentId,
    row.energySource,
    row.criterion,
    row.mappingName,
    row.mappingVersion,
    row.a1Answer,
    row.a2Answer,
    row.transitionState,
    row.shiftLabel,
    row.isSynthetic ? "yes" : "no",
  ];
}

// ============================================================
// Per-energy-source rows.
// ============================================================

export interface DemoEnergySourceRow {
  energySource: string;
  /** Verbatim spreadsheet labels, kept even where they differ per side. */
  a1Label: string | null;
  a2Label: string | null;
  bothSidesPresent: boolean;
  a1Answered: number | null;
  a2Answered: number | null;
  a1Ones: number | null;
  a2Ones: number | null;
  a1PctOne: number | null;
  a2PctOne: number | null;
  absoluteChange: number | null;
  relativeChange: number | null;
  pctPointShift: number | null;
}

export function demoEnergySourceRows(
  rows: EnergySourceAssignmentChange[]
): DemoEnergySourceRow[] {
  return rows.map((r) => ({
    energySource: r.energy_source,
    a1Label: r.a1_energy_source_raw,
    a2Label: r.a2_energy_source_raw,
    bothSidesPresent: r.both_sides_present,
    a1Answered: r.a1_answered,
    a2Answered: r.a2_answered,
    a1Ones: r.a1_ones,
    a2Ones: r.a2_ones,
    a1PctOne: r.a1_pct_one,
    a2PctOne: r.a2_pct_one,
    absoluteChange: r.ones_absolute_change,
    relativeChange: r.ones_relative_change,
    pctPointShift: r.pct_point_shift,
  }));
}

// ============================================================
// Formatting. Every "unknown" path renders "—" — never 0, never NaN,
// never Infinity. A zero baseline is unknown relative change, not a
// hundred percent of nothing.
// ============================================================

export const NO_VALUE = "—";

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return String(value);
}

export function formatSignedCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${value > 0 ? "+" : ""}${value}`;
}

export function formatShare(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${(value * 100).toFixed(digits)}%`;
}

/** Relative change: signed percentage, or "—" on a zero/absent baseline. */
export function formatRelativeChange(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

export function formatPctPoints(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_VALUE;
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}pp`;
}

// ============================================================
// Provenance. Phase 9 exports carry a metadata block so a file that
// outlives the session is still readable; a demo screen shown to an
// audience needs the same thing on the screen itself, because a
// screenshot travels further than the page does.
//
// Every chart and table on the Demo Dashboard states: that the data is
// synthetic, how many students it covers, which assignment or comparison
// it shows, and the formula behind the number.
// ============================================================

export const SYNTHETIC_NOTE =
  "SYNTHETIC DEMO DATA — every student, attempt and response below is fictional, " +
  "generated by scripts/seed-demo-analytics.ts with a fixed random seed. " +
  "No real person is represented and no figure here describes a real class.";

// Deliberately phrased without any of the banned assessment words, so this
// note passes the same neutral-labelling assertion the on-screen labels do
// rather than needing an exemption for saying "nothing here is correct".
export const DEMO_NEUTRALITY_NOTE =
  "These are descriptive statistics about opinions. A move from 0 to 1 and a move " +
  "from 1 to 0 are the same kind of event in opposite directions — neither is a " +
  "gain, and neither answer ranks above the other. No figure here is an assessment " +
  "of a student.";

export const FORMULAS = {
  onesCount:
    'Count of "1 — Yes" answers = number of final responses with response_value = 1, pooled across every active question of that energy source.',
  absoluteChange: "Absolute change = (count of 1 in Assignment 2) − (count of 1 in Assignment 1).",
  relativeChange:
    "Relative change = (A2 count of 1 − A1 count of 1) ÷ (A1 count of 1). Shown as “—” when the A1 count is zero or an energy source appears in only one assignment — a zero baseline has no defined relative change.",
  pctPointShift:
    "Percentage-point shift = (% selecting 1 in Assignment 2) − (% selecting 1 in Assignment 1).",
  changeRate: "Change rate = (S01 + S10) ÷ valid paired responses.",
  netMovement: "Net movement toward 1 = S01 − S10.",
  shiftCategory:
    "Category from net movement toward 1: positive → shifted toward 1, negative → shifted toward 0, zero → no net change.",
  transitionStates:
    "S00 = 0→0, S01 = 0→1, S10 = 1→0, S11 = 1→1, counted only where both answers are binary under a professor-approved mapping.",
} as const;

export interface DemoScope {
  syntheticStudents: number;
  realStudents: number;
  assignment1Title: string;
  assignment2Title: string;
  approvedMappings: number;
}

/**
 * The one-line provenance footnote attached to a specific chart or table.
 * `comparison` says what is being shown; `formula` says how the number was
 * produced. Both are required — a chart that states neither is exactly the
 * chart that gets screenshotted and misread.
 */
export function provenanceFootnote(
  scope: DemoScope,
  comparison: string,
  formula: string
): string {
  const cohort =
    scope.realStudents > 0
      ? `${scope.syntheticStudents} synthetic students (plus ${scope.realStudents} non-synthetic students also enrolled in this class — see the banner above)`
      : `${scope.syntheticStudents} synthetic students`;
  return `Synthetic demo data · ${cohort} · ${comparison} · ${formula}`;
}
