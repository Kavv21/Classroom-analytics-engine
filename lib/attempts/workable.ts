import type { AssignmentStatus, AttemptState } from "@/lib/types/domain";

export interface WorkableAttempt {
  state: AttemptState;
  /** `assignment_attempts.reopened_at` — null until a professor reopens it. */
  reopenedAt: string | null;
}

/**
 * Can this student still open the answering grid for this assignment?
 *
 * The database is the boundary (`attempt_is_workable`, migration 0023);
 * this is the same rule stated once for the UI, so the list, the answering
 * route and the receipt route cannot disagree about it. Three hand-rolled
 * copies of "is it open?" is how a student ends up reading
 * "Reopened — submit again when you're ready" next to a dead Closed badge.
 *
 * Two ways in:
 *   * the assignment is OPEN and they haven't submitted;
 *   * the assignment is CLOSED but this student's own attempt was reopened
 *     and they haven't resubmitted yet — the point of a per-student reopen
 *     is to let one student finish without republishing to the class.
 *
 * REOPENED becomes DRAFT on the first autosave (the FSM has no
 * REOPENED -> REOPENED edge), so DRAFT must count as well or the student is
 * locked out by their own first keystroke. `reopenedAt` is what keeps that
 * from letting every drafting student work on a closed assignment.
 */
export function canAnswerAssignment(
  assignmentStatus: AssignmentStatus | string,
  attempt: WorkableAttempt | null | undefined
): boolean {
  if (attempt?.state === "SUBMITTED" || attempt?.state === "RESUBMITTED") return false;
  if (assignmentStatus === "OPEN") return true;
  return (
    assignmentStatus === "CLOSED" &&
    !!attempt?.reopenedAt &&
    (attempt.state === "REOPENED" || attempt.state === "DRAFT")
  );
}
