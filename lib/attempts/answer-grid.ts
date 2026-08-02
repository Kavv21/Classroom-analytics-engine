import {
  buildGridMatrix,
  detectOrientation,
  gridColumnFromQuestion,
  orderGridQuestions,
  orientationDescription,
  type GridMatrix,
  type GridOrientation,
  type GridQuestionFields,
} from "@/lib/exports/response-grid";

/**
 * The student's answer grid — the SAME layout the professor's response grid
 * uses, with editable cells where that one shows class totals.
 *
 * Every geometry decision is imported, not re-derived:
 * `detectOrientation` recovers which axis the energy sources run down,
 * `orderGridQuestions` puts them in the source file's reading order, and
 * `buildGridMatrix` places each question at its own
 * `original_row_reference` / `original_column_reference`. So a student sees
 * the spreadsheet their professor uploaded — Assignment 1 as 15 energy
 * sources down the rows against 2 criteria across, Assignment 2 transposed
 * to 17 criteria down against 15 energy sources across — and the professor
 * later reads the class's answers in that same shape. One layout
 * definition, three surfaces (this, the live response grid, the .xlsx
 * export).
 *
 * WHAT IT DOES NOT REUSE: the totals row. `buildGridMatrix` computes
 * `columnTotals` from the counts it is given; here it is given none, so
 * they are all null and the grid does not render that row. That is
 * deliberate rather than incidental — summing a student's own 0s and 1s
 * into a per-column figure would put a number on their opinions that reads
 * like a score, and this app has none (CLAUDE.md: no grades, no
 * correctness; .claude/rules/analytics.md: nothing may imply "better").
 * The answered/unanswered counts on the review step are the only figures a
 * student sees about their own sheet.
 */

export interface AnswerGridQuestion extends GridQuestionFields {
  /** The professor's wording for the 0 option, e.g. "No (0)". Verbatim. */
  response_zero_label: string;
  /** The professor's wording for the 1 option, e.g. "Yes (1)". Verbatim. */
  response_one_label: string;
  display_order: number;
}

export interface AnswerGridLayout {
  orientation: GridOrientation;
  /** Plain-words description of the orientation, for the help text. */
  orientationText: string;
  matrix: GridMatrix;
  /** Active questions on the assignment — the denominator of "N of M". */
  questionCount: number;
  /**
   * How the two values are worded, when every question agrees on it. The
   * legend prints these next to the grid so the meaning of 0 and 1 is
   * readable text rather than something to infer from a cell's appearance.
   * Null when the assignment's questions disagree, in which case no single
   * legend could be honest and each cell's own label carries the wording.
   */
  legend: { zero: string; one: string } | null;
}

/** Wording shared by every question, or null when they differ. */
export function answerLegend(
  questions: Array<Pick<AnswerGridQuestion, "response_zero_label" | "response_one_label">>
): { zero: string; one: string } | null {
  if (questions.length === 0) return null;
  const zero = new Set(questions.map((q) => q.response_zero_label.trim()));
  const one = new Set(questions.map((q) => q.response_one_label.trim()));
  if (zero.size !== 1 || one.size !== 1) return null;
  const zeroLabel = [...zero][0]!;
  const oneLabel = [...one][0]!;
  if (zeroLabel === "" || oneLabel === "") return null;
  return { zero: zeroLabel, one: oneLabel };
}

export function buildAnswerGrid(questions: AnswerGridQuestion[]): AnswerGridLayout {
  const orientation = detectOrientation(questions);
  const ordered = orderGridQuestions(questions, orientation);
  const columns = ordered.map((q) => gridColumnFromQuestion(q));

  return {
    orientation,
    orientationText: orientationDescription(orientation),
    matrix: buildGridMatrix(columns, orientation),
    questionCount: questions.length,
    legend: answerLegend(questions),
  };
}

/**
 * What one cell is, in words: "Solar — Conventional". Row label first
 * because that is the axis a reader travels down, whichever of energy
 * source / criterion it happens to be for this assignment.
 *
 * This composes two STORED labels for a screen-reader name; it is not
 * question wording and never replaces it (CLAUDE.md rule 1). The cell's
 * accessible name adds the question's own text where there is one.
 */
export function answerCellContext(rowLabel: string, columnLabel: string): string {
  return `${rowLabel} — ${columnLabel}`;
}
