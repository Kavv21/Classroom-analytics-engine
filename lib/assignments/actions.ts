"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { canManageClassContent } from "@/lib/classes/access";
import {
  assignmentFormSchema,
  questionLabelsSchema,
  type AssignmentFormValues,
  type QuestionLabelsValues,
} from "@/lib/assignments/schema";
import {
  nextOtherSequenceNumber,
  PAIRED_SEQUENCE_NUMBERS,
  positionForSequenceNumber,
  positionLabel,
  sequenceNumberLabel,
  type SequencePosition,
} from "@/lib/assignments/sequence";
import {
  GridFileFormatError,
  GridFileTooLargeError,
  parseAssignmentFile,
  type GridParseResult,
} from "@/lib/imports/parse-grid";
import {
  VALID_ASSIGNMENT_TRANSITIONS,
  type AssignmentStatus,
} from "@/lib/types/domain";

export type AssignmentActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function nullIfBlank(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

/**
 * The paired positions (first/second) must be unique per class among
 * assignments still in play.
 *
 * The real enforcement is the partial unique index from migration 0018 —
 * this check exists to turn a raw Postgres unique-violation into a field
 * error the professor can act on, and to explain WHY it matters. A check
 * here is not a substitute for the constraint: two concurrent creates would
 * both pass this and one would then hit the index, which
 * `sequenceConflictResult` translates.
 *
 * "Other" assignments never come through here: their number is allocated
 * server-side from the free numbers upwards, so there is nothing for the
 * professor to resolve.
 */
async function findSequenceConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  sequenceNumber: number,
  excludeAssignmentId?: string
): Promise<{ title: string } | null> {
  let query = supabase
    .from("assignments")
    .select("id, title, status")
    .eq("class_id", classId)
    .eq("sequence_number", sequenceNumber)
    .neq("status", "ARCHIVED");
  if (excludeAssignmentId) query = query.neq("id", excludeAssignmentId);

  const { data, error } = await query.limit(1).returns<Array<{ title: string }>>();
  // A failed lookup must not block the write — the index still guards it.
  if (error) return null;
  return data?.[0] ?? null;
}

/**
 * Every sequence number already spoken for in a class, ARCHIVED included —
 * see nextOtherSequenceNumber for why archived siblings still count.
 */
async function usedSequenceNumbers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string
): Promise<number[]> {
  const { data, error } = await supabase
    .from("assignments")
    .select("sequence_number")
    .eq("class_id", classId)
    .returns<Array<{ sequence_number: number }>>();
  if (error) return [];
  return (data ?? []).map((row) => row.sequence_number);
}

function sequenceConflictResult<T>(
  position: SequencePosition,
  conflictTitle: string
): AssignmentActionResult<T> {
  const message =
    `"${conflictTitle}" is already the ${positionLabel(position)} assignment in this class. ` +
    `Only the first/second pair is limited to one each — that pair is what the ` +
    `before/after comparison is built from. Pick the other position, choose ` +
    `"Other" to add a standalone assignment instead, or change the existing ` +
    `assignment first.`;
  return {
    success: false,
    error: message,
    fieldErrors: { sequencePosition: [message] },
  };
}

/** Translates the migration-0018 index violation into the same message. */
function isSequenceIndexViolation(error: { message: string; code?: string }): boolean {
  return (
    error.code === "23505" || /assignments_class_sequence_unique/.test(error.message)
  );
}

/** Best-effort audit trail — a failed audit write is logged loudly but never
 * turns a completed action into a reported failure. */
async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
) {
  const { error } = await supabase.rpc("log_audit_event", {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: metadata ?? null,
  });
  if (error) {
    console.error(`audit log failed for ${action} on ${entityType} ${entityId}`, error);
  }
}

/**
 * May this user manage the class's content — its professor, or one of its
 * TAs? Delegated to the database's own `can_manage_class_content`, so this
 * cannot drift from the policies that actually gate the writes below. A
 * lookup error is surfaced, never conflated with "not yours" — see the
 * class-creation postmortem in lib/classes/actions.ts.
 */
async function requireClassStaff(classId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, authorized: false, checkError: null } as const;

  const { allowed, error: checkError } = await canManageClassContent(supabase, classId);

  return { supabase, user, authorized: allowed, checkError } as const;
}

/** Same boundary, entered from an assignment id — and left to RLS, which
 *  since migration 0028 shows an assignment to its class's professor and
 *  to its TAs through the one `assignments_staff_manage` policy. */
async function requireClassStaffForAssignment(assignmentId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, user: null, assignment: null, checkError: null } as const;
  }

  const { data: assignment, error: checkError } = await supabase
    .from("assignments")
    .select("id, class_id, status, sequence_number, title")
    .eq("id", assignmentId)
    .maybeSingle();

  if (checkError) {
    console.error("requireClassStaffForAssignment: lookup failed", checkError);
  }

  return { supabase, user, assignment, checkError } as const;
}

function accessError<T>(
  checkError: { message: string } | null,
  what: string
): AssignmentActionResult<T> {
  if (checkError) {
    return { success: false, error: `Could not verify access: ${checkError.message}` };
  }
  return { success: false, error: `${what} not found, or you don't have access to it.` };
}

// ============================================================
// CRUD
// ============================================================

export async function createAssignment(
  classId: string,
  input: AssignmentFormValues
): Promise<AssignmentActionResult<{ id: string }>> {
  const parsed = assignmentFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, authorized, checkError } = await requireClassStaff(classId);
  if (!user || !authorized || checkError) return accessError(checkError, "Class");

  const v = parsed.data;

  if (v.sequencePosition !== "OTHER") {
    const conflict = await findSequenceConflict(
      supabase,
      classId,
      PAIRED_SEQUENCE_NUMBERS[v.sequencePosition]
    );
    if (conflict) return sequenceConflictResult(v.sequencePosition, conflict.title);
  }

  const row = {
    class_id: classId,
    title: v.title.trim(),
    description: nullIfBlank(v.description),
    instructions: nullIfBlank(v.instructions),
    assignment_stage: v.assignmentStage,
    open_at: nullIfBlank(v.openAt),
    close_at: nullIfBlank(v.closeAt),
    allow_draft_editing: v.allowDraftEditing,
    allow_resubmission: v.allowResubmission,
    response_zero_label: v.responseZeroLabel.trim(),
    response_one_label: v.responseOneLabel.trim(),
    created_by: user.id,
  };

  // "Other" allocates its own number, so two professors creating one at the
  // same moment can both pick the same free slot and one of them loses the
  // race against the 0018 index. Nothing about that is the professor's
  // problem to solve — re-read the taken numbers and take the next one.
  const attempts = v.sequencePosition === "OTHER" ? 3 : 1;
  let data: { id: string } | null = null;
  let lastError: { message: string; code?: string } | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const sequenceNumber =
      v.sequencePosition === "OTHER"
        ? nextOtherSequenceNumber(await usedSequenceNumbers(supabase, classId))
        : PAIRED_SEQUENCE_NUMBERS[v.sequencePosition];

    const inserted = await supabase
      .from("assignments")
      .insert({ ...row, sequence_number: sequenceNumber })
      .select("id")
      .single();

    if (!inserted.error) {
      data = inserted.data;
      break;
    }
    lastError = inserted.error;
    if (!isSequenceIndexViolation(inserted.error)) break;
  }

  if (!data) {
    if (lastError && isSequenceIndexViolation(lastError)) {
      return sequenceConflictResult(v.sequencePosition, "Another assignment");
    }
    return { success: false, error: lastError?.message ?? "Could not create the assignment." };
  }

  await logAudit(supabase, "ASSIGNMENT_CREATED", "assignment", data.id, {
    classId,
    title: v.title.trim(),
  });

  revalidatePath(`/classes/${classId}`);
  revalidatePath(`/classes/${classId}/assignments`);
  return { success: true, data: { id: data.id } };
}

export async function updateAssignment(
  assignmentId: string,
  input: AssignmentFormValues
): Promise<AssignmentActionResult<{ id: string }>> {
  const parsed = assignmentFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const v = parsed.data;

  // An assignment that is already "other" keeps the number it was given:
  // re-saving the form must not renumber it (and so must not invalidate its
  // question codes) just because "Other" carries no fixed number.
  const currentPosition = positionForSequenceNumber(assignment.sequence_number);
  const sequenceNumber =
    v.sequencePosition === "OTHER"
      ? currentPosition === "OTHER"
        ? assignment.sequence_number
        : nextOtherSequenceNumber(await usedSequenceNumbers(supabase, assignment.class_id))
      : PAIRED_SEQUENCE_NUMBERS[v.sequencePosition];

  if (v.sequencePosition !== "OTHER") {
    const conflict = await findSequenceConflict(
      supabase,
      assignment.class_id,
      sequenceNumber,
      assignmentId
    );
    if (conflict) return sequenceConflictResult(v.sequencePosition, conflict.title);
  }

  // Changing the sequence number AFTER questions are imported silently
  // invalidates every question code on this assignment.
  //
  // `external_question_code` is generated once, at import time, as
  // `A${sequence_number}-NNN` (see parseUpload below). Nothing re-derives
  // it. This is how the real class ended up with an Assignment 2 whose 255
  // questions were all coded `A1-…`: imported while its sequence number was
  // still 1, renumbered afterwards. Both assignments then carried `A1-001…`,
  // which is legal — the unique constraint is (assignment_id, code) — but
  // means a code no longer identifies a question within a class.
  //
  // Blocked here rather than fixed silently: rewriting the codes would need
  // to punch through the questions_immutable_after_responses trigger, which
  // is a data repair, not an edit. supabase/migrations/0019 does exactly
  // that, deliberately and reviewably.
  if (sequenceNumber !== assignment.sequence_number) {
    const { count, error: questionCountError } = await supabase
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);

    if (!questionCountError && (count ?? 0) > 0) {
      const message =
        `This assignment already has ${count} imported questions, and their codes ` +
        `(A${assignment.sequence_number}-001, …) were generated from its current position. ` +
        `Moving it to ${sequenceNumberLabel(sequenceNumber)} would leave those codes ` +
        `disagreeing with it, which makes them ambiguous across the class. ` +
        `Change the position before importing questions, or ask a maintainer to run the ` +
        `code-repair migration (0019) alongside the change.`;
      return {
        success: false,
        error: message,
        fieldErrors: { sequencePosition: [message] },
      };
    }
  }

  const { data, error } = await supabase
    .from("assignments")
    .update({
      title: v.title.trim(),
      description: nullIfBlank(v.description),
      instructions: nullIfBlank(v.instructions),
      assignment_stage: v.assignmentStage,
      sequence_number: sequenceNumber,
      open_at: nullIfBlank(v.openAt),
      close_at: nullIfBlank(v.closeAt),
      allow_draft_editing: v.allowDraftEditing,
      allow_resubmission: v.allowResubmission,
      response_zero_label: v.responseZeroLabel.trim(),
      response_one_label: v.responseOneLabel.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", assignmentId)
    .select("id, class_id")
    .maybeSingle();

  if (error) {
    if (isSequenceIndexViolation(error)) {
      return sequenceConflictResult(v.sequencePosition, "Another assignment");
    }
    return { success: false, error: error.message };
  }
  if (!data) return { success: false, error: "Assignment not found, or you don't have access to it." };

  revalidatePath(`/classes/${data.class_id}/assignments`);
  revalidatePath(`/classes/${data.class_id}/assignments/${assignmentId}`);
  return { success: true, data: { id: data.id } };
}

// ============================================================
// Status transitions (publish / close / archive / approve / un-approve).
// The DB trigger (0009) is the boundary; this pre-check just gives a
// friendlier error and the audit log a clean action name.
// ============================================================

const TRANSITION_AUDIT_ACTIONS: Partial<Record<AssignmentStatus, string>> = {
  READY: "ASSIGNMENT_APPROVED",
  OPEN: "ASSIGNMENT_PUBLISHED",
  CLOSED: "ASSIGNMENT_CLOSED",
  ARCHIVED: "ASSIGNMENT_ARCHIVED",
  DRAFT: "ASSIGNMENT_UNAPPROVED",
};

export async function transitionAssignment(
  assignmentId: string,
  toStatus: AssignmentStatus
): Promise<AssignmentActionResult<{ id: string; status: AssignmentStatus }>> {
  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const from = assignment.status as AssignmentStatus;
  if (!VALID_ASSIGNMENT_TRANSITIONS[from]?.includes(toStatus)) {
    return {
      success: false,
      error: `An assignment in ${from} cannot move to ${toStatus}.`,
    };
  }

  const { data, error } = await supabase
    .from("assignments")
    .update({ status: toStatus, updated_at: new Date().toISOString() })
    .eq("id", assignmentId)
    .eq("status", from) // optimistic concurrency: bail if someone else moved it
    .select("id, class_id, status")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) {
    return {
      success: false,
      error: "The assignment's status changed underneath you — reload and try again.",
    };
  }

  // Reopening is not publishing. The audit trail has to be able to tell
  // "students first saw this" from "students were let back in".
  const auditAction =
    from === "CLOSED" && toStatus === "OPEN"
      ? "ASSIGNMENT_REOPENED"
      : (TRANSITION_AUDIT_ACTIONS[toStatus] ?? "ASSIGNMENT_STATUS_CHANGED");
  await logAudit(supabase, auditAction, "assignment", assignmentId, { from, to: toStatus });

  revalidatePath(`/classes/${data.class_id}/assignments`);
  revalidatePath(`/classes/${data.class_id}/assignments/${assignmentId}`);
  return { success: true, data: { id: data.id, status: data.status as AssignmentStatus } };
}

// ============================================================
// Unarchive, and permanent deletion.
//
// Both go through SECURITY DEFINER RPCs (migration 0025) rather than
// through table writes from here, because both have to punch through a
// trigger that exists precisely to stop this table being written this
// way: `assignments_status_transition` has no path out of ARCHIVED, and
// `questions_immutable_after_responses` refuses to delete a question
// whose assignment has responses. The RPC is where that authority is
// scoped to one named gesture; see 0025's header for the full argument.
// ============================================================

/** Shape of `assignment_deletion_counts` / `delete_assignment_permanently`. */
export interface AssignmentDeletionCounts {
  assignmentId: string;
  classId: string;
  title: string;
  status: AssignmentStatus;
  sequenceNumber: number;
  questions: number;
  responses: number;
  attempts: number;
  students: number;
  imports: number;
}

/**
 * What `deleteAssignmentPermanently` would destroy, read live for the
 * confirmation dialog.
 *
 * The RPC returns NULL for "no such assignment, or not your class" — it
 * cannot distinguish those two without telling a stranger which
 * assignment ids exist, and it should not. Null is an access error here,
 * never an empty census.
 */
export async function getAssignmentDeletionCounts(
  assignmentId: string
): Promise<AssignmentActionResult<AssignmentDeletionCounts>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("assignment_deletion_counts", {
    p_assignment_id: assignmentId,
  });

  if (error) return { success: false, error: error.message };
  if (!data) {
    return {
      success: false,
      error: "Assignment not found, or you don't have access to it.",
    };
  }
  return { success: true, data: data as AssignmentDeletionCounts };
}

/**
 * ARCHIVED -> CLOSED. Restores to CLOSED and not to OPEN: putting the
 * class back in front of the assignment is a separate decision the
 * professor makes with the Reopen button, and folding it in here would
 * mean undoing an accidental archive silently republished something the
 * class had finished with.
 */
export async function unarchiveAssignment(
  assignmentId: string
): Promise<AssignmentActionResult<{ id: string; status: AssignmentStatus }>> {
  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  if (assignment.status !== "ARCHIVED") {
    return {
      success: false,
      error: `Only an archived assignment can be restored (this one is ${assignment.status}).`,
    };
  }

  const { error } = await supabase.rpc("unarchive_assignment", {
    p_assignment_id: assignmentId,
  });
  if (error) return { success: false, error: error.message };

  // The RPC writes its own audit entry (ASSIGNMENT_UNARCHIVED) inside the
  // same transaction as the status change, so there is nothing to log here.
  revalidatePath(`/classes/${assignment.class_id}/assignments`);
  revalidatePath(`/classes/${assignment.class_id}/assignments/${assignmentId}`);
  return { success: true, data: { id: assignmentId, status: "CLOSED" } };
}

/**
 * Irreversible. Removes the assignment and, through the FK cascade, its
 * questions, attempts, responses and import history — whatever its status
 * and however many responses it holds.
 *
 * Not gated on response count on purpose: a professor who imported the
 * wrong spreadsheet against a live class has no other way out, and
 * "archive it and live with it" is not an answer when the rows are wrong.
 * The protections are the audit record the RPC writes before deleting and
 * the type-to-confirm in front of this call, not a refusal.
 */
export async function deleteAssignmentPermanently(
  assignmentId: string
): Promise<AssignmentActionResult<AssignmentDeletionCounts>> {
  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const { data, error } = await supabase.rpc("delete_assignment_permanently", {
    p_assignment_id: assignmentId,
  });
  if (error) return { success: false, error: error.message };
  if (!data) {
    return { success: false, error: "Assignment not found, or you don't have access to it." };
  }

  const counts = data as AssignmentDeletionCounts;

  revalidatePath("/classes");
  revalidatePath(`/classes/${assignment.class_id}`);
  revalidatePath(`/classes/${assignment.class_id}/assignments`);
  revalidatePath(`/classes/${assignment.class_id}/analytics`);
  return { success: true, data: counts };
}

export async function duplicateAssignment(
  assignmentId: string
): Promise<AssignmentActionResult<{ id: string }>> {
  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const { data, error } = await supabase.rpc("duplicate_assignment", {
    p_assignment_id: assignmentId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${assignment.class_id}/assignments`);
  return { success: true, data: { id: data as string } };
}

// ============================================================
// Question management
// ============================================================

export async function reorderQuestions(
  assignmentId: string,
  orderedQuestionIds: string[]
): Promise<AssignmentActionResult<null>> {
  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const { data: existing, error: fetchError } = await supabase
    .from("questions")
    .select("id")
    .eq("assignment_id", assignmentId);

  if (fetchError) return { success: false, error: fetchError.message };

  const existingIds = new Set((existing ?? []).map((q) => q.id));
  if (
    orderedQuestionIds.length !== existingIds.size ||
    orderedQuestionIds.some((id) => !existingIds.has(id))
  ) {
    return {
      success: false,
      error: "The question list is out of date — reload and try reordering again.",
    };
  }

  for (let i = 0; i < orderedQuestionIds.length; i++) {
    const { error } = await supabase
      .from("questions")
      .update({ display_order: i + 1, updated_at: new Date().toISOString() })
      .eq("id", orderedQuestionIds[i])
      .eq("assignment_id", assignmentId);
    if (error) {
      return { success: false, error: `Reorder failed at position ${i + 1}: ${error.message}` };
    }
  }

  revalidatePath(`/classes/${assignment.class_id}/assignments/${assignmentId}`);
  return { success: true, data: null };
}

export async function updateQuestionLabels(
  assignmentId: string,
  questionId: string,
  input: QuestionLabelsValues
): Promise<AssignmentActionResult<null>> {
  const parsed = questionLabelsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const { data, error } = await supabase
    .from("questions")
    .update({
      response_zero_label: parsed.data.responseZeroLabel.trim(),
      response_one_label: parsed.data.responseOneLabel.trim(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", questionId)
    .eq("assignment_id", assignmentId)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Question not found on this assignment." };

  revalidatePath(`/classes/${assignment.class_id}/assignments/${assignmentId}`);
  return { success: true, data: null };
}

// ============================================================
// Spreadsheet import (preview + commit). Commit always re-parses the file
// server-side — the preview the client saw is never trusted. Import is
// all-or-nothing: row-level errors block the commit entirely and are
// recorded as a FAILED import (spec 23: never partially import silently).
// ============================================================

export interface AssignmentImportPreview extends GridParseResult {
  checksum: string;
  codePrefix: string;
}

async function parseUpload(
  formData: FormData,
  sequenceNumber: number
): Promise<
  | { ok: true; result: GridParseResult; checksum: string; file: File; codePrefix: string }
  | { ok: false; error: string }
> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file uploaded." };
  const worksheetEntry = formData.get("worksheet");
  const worksheet = typeof worksheetEntry === "string" && worksheetEntry !== "" ? worksheetEntry : undefined;

  const codePrefix = `A${sequenceNumber}`;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = createHash("sha256").update(buffer).digest("hex");
    // parseAssignmentFile consumes the stream; hand it a fresh File built
    // from the hashed buffer so checksum and parse always describe the
    // same bytes.
    const result = await parseAssignmentFile(new File([buffer], file.name), {
      codePrefix,
      worksheet,
    });
    return { ok: true, result, checksum, file, codePrefix };
  } catch (err) {
    if (err instanceof GridFileTooLargeError || err instanceof GridFileFormatError) {
      return { ok: false, error: err.message };
    }
    return {
      ok: false,
      error: err instanceof Error ? `Failed to parse file: ${err.message}` : "Failed to parse file.",
    };
  }
}

export async function previewAssignmentImport(
  assignmentId: string,
  formData: FormData
): Promise<AssignmentActionResult<AssignmentImportPreview>> {
  const { user, assignment, checkError } = await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  if (assignment.status !== "DRAFT") {
    return {
      success: false,
      error: `Questions can only be imported while the assignment is in DRAFT (current: ${assignment.status}).`,
    };
  }

  const parsed = await parseUpload(formData, assignment.sequence_number);
  if (!parsed.ok) return { success: false, error: parsed.error };

  return {
    success: true,
    data: { ...parsed.result, checksum: parsed.checksum, codePrefix: parsed.codePrefix },
  };
}

export interface AssignmentImportSummary {
  importId: string;
  imported: number;
}

export async function commitAssignmentImport(
  assignmentId: string,
  formData: FormData
): Promise<AssignmentActionResult<AssignmentImportSummary>> {
  const { supabase, user, assignment, checkError } =
    await requireClassStaffForAssignment(assignmentId);
  if (!user || !assignment || checkError) return accessError(checkError, "Assignment");

  const parsed = await parseUpload(formData, assignment.sequence_number);
  if (!parsed.ok) return { success: false, error: parsed.error };

  const { result, checksum, file } = parsed;

  if (result.errors.length > 0) {
    // Record the failed attempt as import history, import nothing.
    const { error: recordError } = await supabase.rpc("record_failed_assignment_import", {
      p_assignment_id: assignmentId,
      p_source_filename: file.name,
      p_source_checksum: checksum,
      p_error_rows: result.errors.map((e, i) => ({
        rowNumber: i + 1,
        raw: { location: e.location },
        errorMessage: `${e.location}: ${e.message}`,
      })),
    });
    if (recordError) {
      console.error("record_failed_assignment_import failed", recordError);
    }
    return {
      success: false,
      error:
        `The file has ${result.errors.length} problem row(s) and nothing was imported. ` +
        `Fix them and re-upload: ` +
        result.errors.map((e) => `${e.location}: ${e.message}`).join(" "),
    };
  }

  const { data, error } = await supabase.rpc("commit_assignment_import", {
    p_assignment_id: assignmentId,
    p_source_filename: file.name,
    p_source_checksum: checksum,
    p_source_worksheet: result.worksheet,
    p_questions: result.questions,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${assignment.class_id}/assignments/${assignmentId}`);

  const summary = data as { importId: string; imported: number };
  return { success: true, data: { importId: summary.importId, imported: summary.imported } };
}
