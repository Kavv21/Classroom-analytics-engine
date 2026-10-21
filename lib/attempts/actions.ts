"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  validateAnswerSet,
  validateAnswerValues,
  type AnswerSetQuestion,
} from "@/lib/attempts/commit-answers";
import {
  classifyAttemptError,
  describeSaveFailure,
  describeSubmitFailure,
  type AttemptFailureCode,
} from "@/lib/attempts/save-failure";
import type { AttemptState, ResponseValue } from "@/lib/types/domain";

export type AttemptActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/** A student-facing failure: `error` is a plain sentence from
 * lib/attempts/save-failure.ts, `code` tells the grid whether to retry.
 * The raw cause is in the server log, never in here. */
export type StudentActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; code: AttemptFailureCode };

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Logs a failed save/submit with everything needed to find it again:
 * the raw error, who, which attempt, which assignment. Only runs on the
 * failure path, so the two extra lookups cost nothing when things work.
 * The lookups themselves never throw — a log line must not become a
 * second failure.
 */
async function logAttemptFailure(
  supabase: SupabaseServerClient,
  action: "saveResponses" | "submitAttempt",
  attemptId: string,
  code: AttemptFailureCode,
  cause: unknown,
  extra: Record<string, unknown> = {}
): Promise<void> {
  let userId: string | null = null;
  let assignmentId: string | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    userId = data.user?.id ?? null;
    const { data: attempt } = await supabase
      .from("assignment_attempts")
      .select("assignment_id")
      .eq("id", attemptId)
      .maybeSingle();
    assignmentId = (attempt?.assignment_id as string | undefined) ?? null;
  } catch {
    // Keep whatever was found; the error itself is what matters.
  }

  const error =
    cause instanceof Error
      ? { name: cause.name, message: cause.message, stack: cause.stack }
      : cause;

  console.error(`${action}: failed`, {
    code,
    terminal: code !== "TEMPORARY",
    userId,
    attemptId,
    assignmentId,
    error,
    ...extra,
  });
}

export interface AnswerInput {
  questionId: string;
  value: ResponseValue;
}

export interface SaveResult {
  saved: number;
  state: AttemptState;
  savedAt: string;
}

/**
 * Batched autosave target — one call per debounce window, not one per
 * cell. Idempotency lives in the DB (upsert on attempt_id + question_id),
 * so the retry queue can safely replay a batch after a dropped connection.
 *
 * All-or-nothing, like every other write path: if any entry in the batch
 * isn't 0/1/blank the whole batch is refused rather than partly written.
 * The grid's cell control cannot produce another value, but a server action
 * is a public entry point and does not get to assume its caller is the UI.
 */
export async function saveResponses(
  attemptId: string,
  answers: AnswerInput[]
): Promise<StudentActionResult<SaveResult>> {
  const supabase = await createClient();

  if (answers.length === 0) {
    await logAttemptFailure(supabase, "saveResponses", attemptId, "ASSIGNMENT_CHANGED", "empty batch");
    return { success: false, error: describeSaveFailure("ASSIGNMENT_CHANGED"), code: "ASSIGNMENT_CHANGED" };
  }
  const issues = validateAnswerValues(answers);
  if (issues.length > 0) {
    await logAttemptFailure(supabase, "saveResponses", attemptId, "ASSIGNMENT_CHANGED", issues, {
      batchSize: answers.length,
    });
    return { success: false, error: describeSaveFailure("ASSIGNMENT_CHANGED"), code: "ASSIGNMENT_CHANGED" };
  }

  let rpcError: unknown = null;
  try {
    const { data, error } = await supabase.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: answers,
    });
    if (!error) return { success: true, data: data as SaveResult };
    rpcError = error;
  } catch (err) {
    rpcError = err;
  }

  const code = classifyAttemptError(rpcError as { code?: string; message?: string });
  await logAttemptFailure(supabase, "saveResponses", attemptId, code, rpcError, {
    batchSize: answers.length,
  });
  return { success: false, error: describeSaveFailure(code), code };
}

/**
 * Re-reads what is actually stored for an attempt and validates it as one
 * set. Returns an error message, or null when everything checks out.
 *
 * Questions are read WITHOUT the is_active filter on purpose: a question
 * deactivated after a student answered it is a professor's edit, not a
 * student's problem, and must not block the submission. Membership of the
 * assignment is still checked, so an answer belonging elsewhere is caught.
 */
async function validateSavedAnswers(
  supabase: SupabaseServerClient,
  attemptId: string
): Promise<string | null> {
  const { data: attempt, error: attemptError } = await supabase
    .from("assignment_attempts")
    .select("id, assignment_id")
    .eq("id", attemptId)
    .maybeSingle();
  if (attemptError) return attemptError.message;
  if (!attempt) return "Attempt not found, or it is not yours.";

  const [{ data: questions, error: questionsError }, { data: responses, error: responsesError }] =
    await Promise.all([
      supabase
        .from("questions")
        .select("id, external_question_code, question_text")
        .eq("assignment_id", attempt.assignment_id)
        .returns<Array<{ id: string; external_question_code: string; question_text: string }>>(),
      supabase
        .from("responses")
        .select("question_id, response_value")
        .eq("attempt_id", attemptId)
        .returns<Array<{ question_id: string; response_value: ResponseValue }>>(),
    ]);
  if (questionsError) return questionsError.message;
  if (responsesError) return responsesError.message;

  const questionSet: AnswerSetQuestion[] = (questions ?? []).map((q) => ({
    id: q.id,
    externalQuestionCode: q.external_question_code,
    questionText: q.question_text,
  }));

  const issues = validateAnswerSet(
    questionSet,
    (responses ?? []).map((r) => ({ questionId: r.question_id, value: r.response_value })),
    { requireComplete: false }
  );
  if (issues.length === 0) return null;

  return `Your saved answers didn't pass a final check, so nothing was submitted: ${issues[0]!.message}`;
}

export interface SubmitReceipt {
  attemptId: string;
  state: AttemptState;
  submittedAt: string;
  submissionVersion: number;
  answered: number;
  totalQuestions: number;
}

/**
 * Final submission. Only ever called from the student's explicit confirm
 * button on the review step — nothing in this codebase invokes it from a
 * browser event (EXCLUDED_FEATURES.md: no automatic submission of any
 * kind). The DB function locks the attempt row, so double-clicks cannot
 * double-submit.
 *
 * VALIDATE EVERYTHING, COMMIT ONLY IF FULLY VALID. The rule the CSV upload
 * enforced over a whole file is enforced here over the whole attempt: the
 * saved answers are re-read and checked as a set before the submission is
 * allowed to go through, so an attempt cannot be finalised around a
 * response row that shouldn't exist. It is the review step that triggers
 * it, rather than a file upload.
 *
 * Blank answers are not a failure — `response_value` is 0, 1 or NULL by
 * design (CLAUDE.md rule 2), the review step shows the student exactly how
 * many cells they are leaving blank, and the confirm dialog says they will
 * be recorded as unanswered. What this rejects is a value that is not
 * 0/1/NULL, or an answer against a question belonging to another
 * assignment.
 */
export async function submitAttempt(
  attemptId: string
): Promise<StudentActionResult<SubmitReceipt>> {
  const supabase = await createClient();

  let validation: string | null;
  try {
    validation = await validateSavedAnswers(supabase, attemptId);
  } catch (err) {
    await logAttemptFailure(supabase, "submitAttempt", attemptId, "TEMPORARY", err, {
      stage: "validate",
    });
    return { success: false, error: describeSubmitFailure("TEMPORARY"), code: "TEMPORARY" };
  }
  if (validation) {
    // validateSavedAnswers returns either a read error's message (worth
    // another try) or the final-check sentence (it won't change on retry).
    const code: AttemptFailureCode = validation.startsWith("Your saved answers didn't pass")
      ? "FINAL_CHECK_FAILED"
      : classifyAttemptError({ message: validation });
    await logAttemptFailure(supabase, "submitAttempt", attemptId, code, validation, {
      stage: "validate",
    });
    return { success: false, error: describeSubmitFailure(code), code };
  }

  let rpcError: unknown = null;
  try {
    const { data, error } = await supabase.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    if (!error) return { success: true, data: data as SubmitReceipt };
    rpcError = error;
  } catch (err) {
    rpcError = err;
  }

  const code = classifyAttemptError(rpcError as { code?: string; message?: string });
  // A second submission is the expected outcome of a double click or a
  // second tab — the button sends the student to their receipt.
  if (code !== "ALREADY_SUBMITTED") {
    await logAttemptFailure(supabase, "submitAttempt", attemptId, code, rpcError, { stage: "submit" });
  }
  return { success: false, error: describeSubmitFailure(code), code };
}

/**
 * Professor-only: SUBMITTED -> REOPENED with full bookkeeping (DB-side),
 * for exactly ONE (assignment, student) pair.
 *
 * The assignment id is passed to the RPC as well as the attempt id, and the
 * DB refuses the call if the attempt doesn't belong to that assignment
 * (migration 0024). The attempt id alone would find the row — what the
 * second id adds is the caller stating which assignment it believed it was
 * acting on, so a reopen issued from one assignment's page can never land
 * on another assignment's attempt.
 */
export async function reopenAttempt(
  attemptId: string,
  classId: string,
  assignmentId: string
): Promise<AttemptActionResult<{ attemptId: string; state: AttemptState }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reopen_attempt", {
    p_attempt_id: attemptId,
    p_assignment_id: assignmentId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}/assignments/${assignmentId}`);
  return { success: true, data: data as { attemptId: string; state: AttemptState } };
}

/**
 * Professor-only: reopen every SUBMITTED attempt on ONE assignment.
 *
 * The bulk counterpart of reopenAttempt, and scoped the same way — the
 * assignment id is the only selector, so "for all students" means all
 * students of this assignment and cannot reach a sibling assignment. Work
 * in progress is left alone: only SUBMITTED attempts move, so a student
 * mid-draft is not disturbed and a student who already resubmitted is not
 * pulled back in.
 *
 * This is not the same gesture as reopening the ASSIGNMENT (CLOSED ->
 * OPEN, see transitionAssignment): that one lets everyone who has not yet
 * submitted carry on; this one lets the students who HAVE submitted submit
 * again, and leaves the assignment's status untouched.
 */
export async function reopenAllAttempts(
  classId: string,
  assignmentId: string
): Promise<AttemptActionResult<{ assignmentId: string; reopened: number }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reopen_assignment_attempts", {
    p_assignment_id: assignmentId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}/assignments/${assignmentId}`);
  return { success: true, data: data as { assignmentId: string; reopened: number } };
}
