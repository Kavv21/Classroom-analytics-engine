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
import type { ResponseValue } from "@/lib/types/domain";

/**
 * ONE student's stored answers, laid back out as the source spreadsheet's
 * own grid.
 *
 * This is the third surface built on the same geometry, and like the other
 * two it imports every layout decision rather than re-deriving one:
 * `detectOrientation` recovers which axis the energy sources run down,
 * `orderGridQuestions` puts the questions in the source file's reading
 * order, and `buildGridMatrix` places each one at its stored
 * `original_row_reference` / `original_column_reference`. So a professor
 * reading one student's profile sees the same rows, the same columns and
 * the same order as:
 *
 *   - that student saw while answering (lib/attempts/answer-grid.ts),
 *   - the class totals grid (/classes/:id/assignments/:id/grid),
 *   - the .xlsx grid sheets (lib/exports/workbook.ts).
 *
 * WHY THE MATRIX CARRIES NO VALUES. `buildGridMatrix` computes a totals row
 * from the per-cell counts it is handed. Handed one student's own 0s and 1s
 * it would happily sum them into a per-column figure — and a number
 * summarising one person's opinions reads as a score, which this app does
 * not have (CLAUDE.md: no grades, no correctness;
 * .claude/rules/analytics.md: nothing may imply "better"). So the matrix is
 * built with NO counts, exactly as the student's own answer grid builds it,
 * leaving every `total` and every `columnTotals` entry null — and the
 * answers travel beside it in `answers`, keyed by question id. The geometry
 * is shared; the score is structurally absent rather than merely unrendered.
 */

export interface StudentGridQuestion extends GridQuestionFields {
  display_order: number;
}

export interface StudentGrid {
  orientation: GridOrientation;
  /** Plain-words description of the orientation, for the help text. */
  orientationText: string;
  /**
   * The source sheet's grid. Geometry and labels only — every cell's
   * `total`, `answered` and every `columnTotals` entry is null by
   * construction. Read `answers` for what the student actually recorded.
   */
  matrix: GridMatrix;
  /**
   * questionId -> the student's final answer. Every active question on the
   * assignment has an entry; `null` means they left that cell blank, which
   * is information and not the same as the question being absent.
   */
  answers: Record<string, ResponseValue>;
  /** The source workbook's worksheet name, for the provenance block. */
  worksheet: string | null;
}

export function buildStudentGrid(
  questions: StudentGridQuestion[],
  answerFor: (questionId: string) => ResponseValue,
  worksheet: string | null = null
): StudentGrid {
  const orientation = detectOrientation(questions);
  const ordered = orderGridQuestions(questions, orientation);
  const columns = ordered.map((q) => gridColumnFromQuestion(q));

  const answers: Record<string, ResponseValue> = {};
  for (const question of ordered) {
    answers[question.id] = answerFor(question.id);
  }

  return {
    orientation,
    orientationText: orientationDescription(orientation),
    matrix: buildGridMatrix(columns, orientation),
    answers,
    worksheet,
  };
}

/**
 * How one cell reads: "0", "1", or a dot for a cell the student left blank.
 *
 * A blank is shown, never collapsed into 0 — "did not answer" and "answered
 * 0" are different facts about a person, and the whole point of this surface
 * is to report what they actually recorded. Matches the student's own answer
 * grid, which uses the same three glyphs.
 */
export function studentCellGlyph(value: ResponseValue): string {
  return value === null ? "·" : String(value);
}
