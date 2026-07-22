/**
 * Shared domain types — the contract frozen at the end of Phase 2.
 * Both backend-owner and frontend-owner import from here rather than
 * redefining these shapes locally. Keep in sync with
 * /docs/DATABASE_SCHEMA.md and supabase/migrations/0001_init.sql.
 */

export type UserRole = "ADMIN" | "PROFESSOR" | "STUDENT";

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
  email: string;
  fullName: string;
  rollNumber: string | null;
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
 * (un-approve to resume editing). Enforced at the DB layer by the
 * assignments_status_transition trigger (migration 0009) — this map exists
 * so the UI and server actions can fail fast with a friendly message, not
 * as the boundary itself.
 */
export const VALID_ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  DRAFT: ["READY"],
  READY: ["DRAFT", "OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: ["ARCHIVED"],
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

export type MappingType =
  | "EXACT_ONE_TO_ONE"
  | "CONCEPTUAL_ONE_TO_ONE"
  | "ONE_TO_MANY"
  | "MANY_TO_ONE"
  | "GROUPED_CONCEPT"
  | "NOT_COMPARABLE"
  | "UNMAPPED";

export type MappingStatus =
  | "DRAFT"
  | "SUGGESTED"
  | "NEEDS_PROFESSOR_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "SUPERSEDED";

export type TransitionState = "S00" | "S01" | "S10" | "S11";

export type DataQualityStatus =
  | "MISSING_A1"
  | "MISSING_A2"
  | "MISSING_BOTH"
  | "NOT_COMPARABLE";

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

export interface QuestionMapping {
  id: string;
  classId: string;
  assignment1QuestionIds: string[];
  assignment2QuestionIds: string[];
  mappingName: string;
  commonConcept: string | null;
  energySource: string | null;
  criterion: string | null;
  mappingType: MappingType;
  comparisonMethod: string | null;
  professorNotes: string | null;
  mappingStatus: MappingStatus;
  professorApproved: boolean;
  version: number;
  previousVersionId: string | null;
  supersededById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResponseTransition {
  id: string;
  classId: string;
  studentId: string;
  mappingId: string;
  assignment1Value: ResponseValue;
  assignment2Value: ResponseValue;
  transitionState: TransitionState | null;
  dataQualityStatus: DataQualityStatus | null;
}

/**
 * Pure formula helpers — copy of /docs/ANALYTICS_DEFINITIONS.md.
 * Do not reimplement these inline elsewhere; import from here.
 */
export function changeRate(s01: number, s10: number, validPaired: number): number {
  if (validPaired === 0) return NaN;
  return (s01 + s10) / validPaired;
}

export function stabilityRate(s00: number, s11: number, validPaired: number): number {
  if (validPaired === 0) return NaN;
  return (s00 + s11) / validPaired;
}

export function netMovementToward1(s01: number, s10: number): number {
  return s01 - s10;
}

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
