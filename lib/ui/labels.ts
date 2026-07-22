import type {
  AssignmentStatus,
  AttemptState,
  MappingStatus,
  MappingType,
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

export const MAPPING_TYPE_LABELS: Record<MappingType, string> = {
  EXACT_ONE_TO_ONE: "Exact match",
  CONCEPTUAL_ONE_TO_ONE: "Same concept",
  ONE_TO_MANY: "One to many",
  MANY_TO_ONE: "Many to one",
  GROUPED_CONCEPT: "Grouped concept",
  NOT_COMPARABLE: "Not comparable",
  UNMAPPED: "Not mapped",
};

export function mappingTypeLabel(type: string): string {
  return MAPPING_TYPE_LABELS[type as MappingType] ?? type;
}

export const MAPPING_STATUS_LABELS: Record<MappingStatus, string> = {
  DRAFT: "Draft",
  SUGGESTED: "Suggested",
  NEEDS_PROFESSOR_REVIEW: "Needs your review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  SUPERSEDED: "Replaced by a newer version",
};

export function mappingStatusLabel(status: string): string {
  return MAPPING_STATUS_LABELS[status as MappingStatus] ?? status;
}

export function mappingStatusTone(status: string): string {
  switch (status) {
    case "APPROVED":
      return "badge badge-good";
    case "NEEDS_PROFESSOR_REVIEW":
      return "badge badge-warning";
    case "REJECTED":
      return "badge badge-critical";
    case "SUGGESTED":
      return "badge badge-info";
    default:
      return "badge";
  }
}
