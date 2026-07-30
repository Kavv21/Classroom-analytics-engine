/**
 * How a question is named to a human.
 *
 * `external_question_code` ("A1-017") is a machine key: it is what the
 * import pipeline generates, what the CSV answer sheet uses as a column
 * header, and what every export carries as the stable identifier. It is not
 * a name a person can read. A screen that shows only the code makes the
 * reader hold a lookup table in their head, so no human-facing surface may
 * use it as the sole identifier for a question.
 *
 * These helpers never compose new wording. Rule 1 in CLAUDE.md: question
 * text comes from the manifest via the database, verbatim. All this does is
 * choose which stored field to show and, if `question_text` is somehow
 * absent, fall back to the two stored fields the wording is built from
 * (`energy_source` — `criterion`) before ever falling back to the code.
 */

export interface QuestionLabelFields {
  questionText?: string | null;
  energySource?: string | null;
  criterion?: string | null;
  /** Last-resort identifier, used only when nothing readable is stored. */
  code?: string | null;
}

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

/**
 * The primary label: the full stored question text where it exists,
 * otherwise `energy_source — criterion`, otherwise whichever of the two is
 * present, otherwise the code (a question with no wording at all is a data
 * problem, and showing the code beats showing nothing).
 */
export function questionLabel(question: QuestionLabelFields): string {
  const text = clean(question.questionText);
  if (text !== "") return text;

  const source = clean(question.energySource);
  const criterion = clean(question.criterion);
  if (source !== "" && criterion !== "") return `${source} — ${criterion}`;
  if (source !== "") return source;
  if (criterion !== "") return criterion;

  return clean(question.code);
}

/**
 * Single-string form for places that can only carry one string — a chart
 * axis category, a CSV cell, a query-builder dimension key. The code stays
 * present for traceability but parenthesised and after the wording, so the
 * readable part leads.
 */
export function questionLabelWithCode(question: QuestionLabelFields): string {
  const label = questionLabel(question);
  const code = clean(question.code);
  if (code === "" || label === code) return label;
  return `${label} (${code})`;
}

/** True when `questionLabel` had nothing better than the code to return. */
export function isCodeOnlyLabel(question: QuestionLabelFields): boolean {
  const code = clean(question.code);
  return code !== "" && questionLabel(question) === code;
}
