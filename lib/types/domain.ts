/**
 * Shared domain types — the contract frozen at the end of Phase 2.
 * Both backend-owner and frontend-owner import from here rather than
 * redefining these shapes locally. Keep in sync with
 * /docs/DATABASE_SCHEMA.md and supabase/migrations/0001_init.sql.
 */

/**
 * The `user_role` enum (migrations 0001, 0027).
 *
 * It types three different columns, and "TA" means the same thing in only
 * one of them:
 *
 *   * `class_members.member_role` — THE authoritative one. `TA` here is a
 *     teaching assistant OF THAT CLASS, with professor-equivalent access
 *     to its content but not to the class itself or to its other TAs.
 *   * `roster_entries.intended_role` — a pre-authorisation waiting to
 *     become the two rows above at first sign-in.
 *   * `profiles.role` — a global identity label. `TA` there confers no
 *     authority anywhere; it exists so a TA who has never signed in can be
 *     provisioned at all. Someone can be a `PROFESSOR` globally and a `TA`
 *     of a colleague's class at the same time — ask
 *     `can_manage_class_content(classId)`, never `profiles.role`.
 */
export type UserRole = "ADMIN" | "PROFESSOR" | "TA" | "STUDENT";

/** How the signed-in user relates to one particular class. */
export interface ClassAccess {
  /** Owns the class: everything, including archiving, deleting and TAs. */
  isProfessor: boolean;
  /** Assists the class: everything except those three. */
  isTa: boolean;
  /** Professor-equivalent access to the class's CONTENT. */
  canManageContent: boolean;
}

export type ClassStatus = "ACTIVE" | "ARCHIVED";

export interface Class {
  id: string;
  professorId: string;
  name: string;
  courseName: string | null;
  academicYear: string | null;
  semester: string | null;
  section: string | null;
  classCode: string | null;
  startDate: string | null;
  endDate: string | null;
  status: ClassStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Roster import row lifecycle. A row is classified against the DB during
 * preview and re-classified (never trusted from the client) at commit time.
 * See docs/DATABASE_SCHEMA.md#roster_entries for why NEW / EXISTING_PROFILE
 * are different write paths (roster_entries.email is globally unique, so a
 * student already provisioned — or already pending for another class —
 * cannot get a second roster_entries row).
 */
export type RosterRowClassification =
  | "NEW"
  | "EXISTING_PROFILE"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_ALREADY_IN_CLASS"
  | "DUPLICATE_PENDING_OTHER_CLASS"
  | "INVALID";

export interface RosterRowInput {
  rowNumber: number;
  /** The three required fields — see ROSTER_FIELDS in lib/roster/parse.ts. */
  email: string;
  fullName: string;
  rollNumber: string;
  /** Optional: imported opportunistically when the file carries the column,
   * null when it doesn't. Never a reason to reject a row. */
  programme: string | null;
  yearOfStudy: string | null;
  section: string | null;
}

export interface RosterRowResult {
  rowNumber: number;
  raw: Record<string, unknown>;
  classification: RosterRowClassification;
  errors: string[];
  data: RosterRowInput | null;
}

export interface RosterImportPreview {
  totalRows: number;
  importableRows: RosterRowResult[];
  rejectedRows: RosterRowResult[];
  /** One message per required column the file is missing, e.g. "Email column
   * not found — expected one of: Email, Email Address, Email ID". Empty when
   * every required column matched. */
  missingColumns: string[];
  /** Column headers that matched no known field. Surfaced rather than
   * silently ignored, so a mis-detected header row is visible. */
  unmatchedHeaders: string[];
  /** Header text exactly as it appears in the uploaded file. */
  detectedHeaders: string[];
}

export interface RosterImportSummary {
  importId: string;
  imported: number;
  rejected: number;
  total: number;
}

export type AssignmentStage =
  | "PRE_INSTRUCTION"
  | "POST_INSTRUCTION"
  | "FOLLOW_UP"
  | "OTHER";

export type AssignmentStatus = "DRAFT" | "READY" | "OPEN" | "CLOSED" | "ARCHIVED";

/**
 * DRAFT -> READY -> OPEN -> CLOSED -> ARCHIVED, plus READY -> DRAFT
 * (un-approve to resume editing) and CLOSED -> OPEN (reopen to students).
 * Enforced at the DB layer by the assignments_status_transition trigger
 * (migrations 0009, 0023) — this map exists so the UI and server actions
 * can fail fast with a friendly message, not as the boundary itself.
 *
 * CLOSED -> OPEN was missing until 0023, and its absence was a dead end
 * rather than a safety property: closing was irreversible, so a professor
 * who closed an assignment early — or who reopened a student's ATTEMPT
 * afterwards — had no way to let anyone answer again. ARCHIVED stays
 * terminal; that is the irreversible one.
 */
export const VALID_ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  DRAFT: ["READY"],
  READY: ["DRAFT", "OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: ["OPEN", "ARCHIVED"],
  ARCHIVED: [],
};

export interface Assignment {
  id: string;
  classId: string;
  title: string;
  description: string | null;
  instructions: string | null;
  assignmentStage: AssignmentStage;
  sequenceNumber: number;
  openAt: string | null;
  closeAt: string | null;
  status: AssignmentStatus;
  allowDraftEditing: boolean;
  allowResubmission: boolean;
  responseZeroLabel: string;
  responseOneLabel: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type AttemptState =
  | "NOT_STARTED"
  | "DRAFT"
  | "SUBMITTED"
  | "REOPENED"
  | "RESUBMITTED";

/** Server must reject any transition not in this list. */
export const VALID_ATTEMPT_TRANSITIONS: Record<AttemptState, AttemptState[]> = {
  NOT_STARTED: ["DRAFT", "SUBMITTED"],
  DRAFT: ["DRAFT", "SUBMITTED"],
  SUBMITTED: ["REOPENED"],
  REOPENED: ["DRAFT", "RESUBMITTED"],
  RESUBMITTED: [],
};

/** 0, 1, or unanswered — never anything else. */
export type ResponseValue = 0 | 1 | null;

export interface Question {
  id: string;
  assignmentId: string;
  externalQuestionCode: string;
  originalWorksheet: string;
  originalRowReference: string;
  originalColumnReference: string;
  questionText: string;
  energySource: string | null;
  criterion: string | null;
  concept: string | null;
  responseZeroLabel: string;
  responseOneLabel: string;
  displayOrder: number;
  isActive: boolean;
}

/**
 * Pure formula helpers — copy of /docs/ANALYTICS_DEFINITIONS.md.
 * Do not reimplement these inline elsewhere; import from here.
 *
 * These are all single-assignment, per-question descriptive statistics.
 * The cross-assignment transition formulas (change rate, stability rate,
 * net movement) were removed with the question-mapping feature: they were
 * only defined over an approved mapping's paired answers, and with no
 * mappings there is no pair to compute them from.
 */
export function simpleConsensus(pctZero: number, pctOne: number): number {
  return Math.max(pctZero, pctOne);
}

export function simpleDisagreement(consensus: number): number {
  return 1 - consensus;
}

export function binaryEntropy(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  return -p * Math.log2(p) - (1 - p) * Math.log2(1 - p);
}
