import type {
  AssignmentStatus,
  AttemptState,
  UserRole,
} from "@/lib/types/domain";

/**
 * Human-readable names for internal enum values.
 *
 * Nothing user-facing should print a database enum. These are the names a
 * professor or student would use for the thing they control — the
 * underlying values are unchanged, this is presentation only.
 */

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administrator",
  PROFESSOR: "Professor",
  TA: "Teaching assistant",
  STUDENT: "Student",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] ?? role;
}

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  DRAFT: "Draft",
  READY: "Ready to publish",
  OPEN: "Open to students",
  CLOSED: "Closed",
  ARCHIVED: "Archived",
};

export function assignmentStatusLabel(status: string): string {
  return ASSIGNMENT_STATUS_LABELS[status as AssignmentStatus] ?? status;
}

/**
 * Badge tone per status — workflow state only, never a judgement.
 *
 * All five statuses now take a distinct hue rather than collapsing three
 * of them into the same neutral: the "Meridian" direction differentiates
 * workflow state by colour, and a professor scanning a class list should
 * be able to tell CLOSED from ARCHIVED without reading. The hues are
 * ordered by lifecycle, not by desirability — an assignment is not better
 * for being open, and nothing here implies one state is a success and
 * another a failure. The label is always rendered alongside, so the hue is
 * redundant reinforcement rather than the signal (WCAG 1.4.1).
 */
export function assignmentStatusTone(status: string): string {
  switch (status) {
    case "DRAFT":
      return "badge badge-amber";
    case "READY":
      return "badge badge-blue";
    case "OPEN":
      return "badge badge-green";
    case "CLOSED":
      return "badge badge-purple";
    case "ARCHIVED":
      return "badge badge-neutral";
    default:
      return "badge badge-neutral";
  }
}

export const ATTEMPT_STATE_LABELS: Record<AttemptState, string> = {
  NOT_STARTED: "Not started",
  DRAFT: "In progress",
  SUBMITTED: "Submitted",
  REOPENED: "Reopened",
  RESUBMITTED: "Resubmitted",
};

export function attemptStateLabel(state: string): string {
  return ATTEMPT_STATE_LABELS[state as AttemptState] ?? state;
}
