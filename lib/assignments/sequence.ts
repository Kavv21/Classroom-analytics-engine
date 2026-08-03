/**
 * Where an assignment sits in its class.
 *
 * `assignments.sequence_number` is not a display field: 1 and 2 are the
 * pivot the aggregate A1/A2 comparison is built on
 * (`energy_source_assignment_change`, migration 0017, which filters
 * `sequence_number in (1, 2)`), and every question's
 * `external_question_code` is stamped `A${sequence_number}-NNN` at import
 * time. So positions 1 and 2 stay exactly-one-each per class, guarded by the
 * partial unique index from migration 0018.
 *
 * A class is NOT limited to two assignments, though — that was a UI
 * restriction, not a data one. Anything that is not one of the paired
 * before/after assignments is an "other" assignment: it gets the next free
 * number from 3 upwards, as many times as the professor likes. Those
 * assignments carry their own single-assignment statistics and are simply
 * absent from the A1/A2 comparison, which is what "not part of the pair"
 * means.
 */

export type SequencePosition = "FIRST" | "SECOND" | "OTHER";

/** The two positions that mean something to the cross-assignment view. */
export const PAIRED_SEQUENCE_NUMBERS: Record<"FIRST" | "SECOND", number> = {
  FIRST: 1,
  SECOND: 2,
};

/** "Other" assignments start here so they can never shadow the pair. */
export const FIRST_OTHER_SEQUENCE_NUMBER = 3;

export function positionForSequenceNumber(sequenceNumber: number): SequencePosition {
  if (sequenceNumber === PAIRED_SEQUENCE_NUMBERS.FIRST) return "FIRST";
  if (sequenceNumber === PAIRED_SEQUENCE_NUMBERS.SECOND) return "SECOND";
  return "OTHER";
}

/**
 * The number a newly created "other" assignment should take.
 *
 * `used` must include ARCHIVED siblings even though the unique index
 * ignores them: an archived assignment keeps its imported questions, and
 * those codes (`A3-001`, …) would become ambiguous inside the class if a
 * new assignment reused the number. Uniqueness of the index is the floor
 * here, not the ceiling.
 */
export function nextOtherSequenceNumber(used: readonly number[]): number {
  const taken = new Set(used);
  let candidate = FIRST_OTHER_SEQUENCE_NUMBER;
  while (taken.has(candidate)) candidate++;
  return candidate;
}

/** Human wording for a position, used in professor-facing errors. */
export function positionLabel(position: SequencePosition): string {
  if (position === "FIRST") return "first";
  if (position === "SECOND") return "second";
  return "other";
}

/** Human wording for a raw stored number. */
export function sequenceNumberLabel(sequenceNumber: number): string {
  if (sequenceNumber === 1) return "first";
  if (sequenceNumber === 2) return "second";
  return `other (#${sequenceNumber})`;
}
