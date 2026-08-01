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

/** Badge tone per status — workflow state only, never a judgement. */
export function assignmentStatusTone(status: string): string {
  switch (status) {
    case "OPEN":
      return "badge badge-good";
    case "READY":
      return "badge badge-info";
    case "CLOSED":
    case "ARCHIVED":
      return "badge";
    default:
      return "badge";
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
