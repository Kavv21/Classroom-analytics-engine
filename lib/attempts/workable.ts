import {
  assignmentAcceptsAnswers,
  assignmentHasOpened,
  NO_WINDOW,
  type ScheduleWindow,
} from "@/lib/assignments/schedule";
import type { AssignmentStatus, AttemptState } from "@/lib/types/domain";

export interface WorkableAttempt {
  state: AttemptState;
  /** `assignment_attempts.reopened_at` — null until a professor reopens it. */
  reopenedAt: string | null;
}

/**
 * Can this student still open the answering grid for this assignment?
 *
 * The database is the boundary (`attempt_is_workable`, migration 0029);
 * this is the same rule stated once for the UI, so the list, the answering
 * route and the receipt route cannot disagree about it. Three hand-rolled
 * copies of "is it open?" is how a student ends up reading
 * "Reopened — submit again when you're ready" next to a dead Closed badge.
 *
 * Two ways in:
 *   * the assignment is accepting answers from the class — since migration
 *     0029 that means its schedule window admits now(), not that a
 *     professor pressed a button (lib/assignments/schedule.ts);
 *   * the assignment has opened at some point but is no longer accepting
 *     answers, AND this student's own attempt was reopened and not yet
 *     resubmitted — the point of a per-student reopen is to let one student
 *     finish without reopening the window for the class.
 *
 * REOPENED becomes DRAFT on the first autosave (the FSM has no
 * REOPENED -> REOPENED edge), so DRAFT must count as well or the student is
 * locked out by their own first keystroke. `reopenedAt` is what keeps that
 * from letting every drafting student work outside the window.
 *
 * `window` defaults to no window at all, which for a legacy OPEN/CLOSED
 * assignment reproduces the pre-0029 behaviour exactly.
 */
export function canAnswerAssignment(
  assignmentStatus: AssignmentStatus | string,
  attempt: WorkableAttempt | null | undefined,
  window: ScheduleWindow = NO_WINDOW,
  now: Date = new Date()
): boolean {
  if (attempt?.state === "SUBMITTED" || attempt?.state === "RESUBMITTED") return false;
  if (assignmentAcceptsAnswers(assignmentStatus, window, now)) return true;
  return (
    assignmentHasOpened(assignmentStatus, window, now) &&
    !!attempt?.reopenedAt &&
    (attempt.state === "REOPENED" || attempt.state === "DRAFT")
  );
}
