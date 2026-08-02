import { buildAnswerGrid, type AnswerGridQuestion } from "@/lib/attempts/answer-grid";

/**
 * Grid fixtures shared by the answer-grid tests and the no-auto-submit
 * suite, in both real orientations.
 *
 * They are built the way the real page builds one — from stored
 * `original_row_reference` / `original_column_reference` values through
 * `buildAnswerGrid` — so a test grid has the same geometry a student's
 * does, at a size that stays readable in an assertion.
 */

function question(
  id: string,
  code: string,
  energySource: string,
  criterion: string,
  row: string,
  column: string,
  displayOrder: number
): AnswerGridQuestion {
  return {
    id,
    external_question_code: code,
    question_text: `${energySource} — ${criterion}`,
    energy_source: energySource,
    criterion,
    original_row_reference: row,
    original_column_reference: column,
    response_zero_label: "No (0)",
    response_one_label: "Yes (1)",
    display_order: displayOrder,
  };
}

/**
 * Assignment 1's shape in miniature: energy sources down the rows,
 * criteria across the columns. The real sheet is 15 x 2; this is 3 x 2.
 * Deliberately declared out of source order to prove the grid orders
 * itself by the source-cell references rather than by arrival.
 */
export const A1_QUESTIONS: AnswerGridQuestion[] = [
  question("q4", "A1-004", "Wind", "Conventional", "8", "C", 4),
  question("q1", "A1-001", "Solar", "Conventional", "7", "C", 1),
  question("q2", "A1-002", "Solar", "Renewable", "7", "D", 2),
  question("q6", "A1-006", "Coal", "Renewable", "9", "D", 6),
  question("q3", "A1-003", "Wind", "Renewable", "8", "D", 3),
  question("q5", "A1-005", "Coal", "Conventional", "9", "C", 5),
];

/**
 * Assignment 2's shape in miniature: transposed — criteria down the rows,
 * energy sources across the columns. The real sheet is 17 x 15.
 */
export const A2_QUESTIONS: AnswerGridQuestion[] = [
  question("r1", "A2-001", "Solar", "Cost", "7", "C", 1),
  question("r2", "A2-002", "Wind", "Cost", "7", "D", 2),
  question("r3", "A2-003", "Solar", "Emissions", "8", "C", 3),
  question("r4", "A2-004", "Wind", "Emissions", "8", "D", 4),
  question("r5", "A2-005", "Solar", "Reliability", "9", "C", 5),
  question("r6", "A2-006", "Wind", "Reliability", "9", "D", 6),
];

export const A1_LAYOUT = buildAnswerGrid(A1_QUESTIONS);
export const A2_LAYOUT = buildAnswerGrid(A2_QUESTIONS);

/** Every question unanswered, as the page hands it to the component. */
export function blankAnswers(questions: AnswerGridQuestion[]): Record<string, null> {
  return Object.fromEntries(questions.map((q) => [q.id, null]));
}
