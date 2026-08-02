"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  validateAnswerSet,
  validateAnswerValues,
  type AnswerSetQuestion,
} from "@/lib/attempts/commit-answers";
import type { AttemptState, ResponseValue } from "@/lib/types/domain";

export type AttemptActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

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
): Promise<AttemptActionResult<SaveResult>> {
  if (answers.length === 0) {
    return { success: false, error: "Nothing to save." };
  }
  const issues = validateAnswerValues(answers);
  if (issues.length > 0) {
    return { success: false, error: issues[0]!.message };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_attempt_responses", {
    p_attempt_id: attemptId,
    p_answers: answers,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SaveResult };
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
  supabase: Awaited<ReturnType<typeof createClient>>,
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
): Promise<AttemptActionResult<SubmitReceipt>> {
  const supabase = await createClient();

  const validation = await validateSavedAnswers(supabase, attemptId);
  if (validation) return { success: false, error: validation };

  const { data, error } = await supabase.rpc("submit_attempt", {
    p_attempt_id: attemptId,
  });

  if (error) {
    if (error.message.includes("already submitted")) {
      return { success: false, error: "ALREADY_SUBMITTED" };
    }
    return { success: false, error: error.message };
  }
  return { success: true, data: data as SubmitReceipt };
}

/** Professor-only: SUBMITTED -> REOPENED with full bookkeeping (DB-side). */
export async function reopenAttempt(
  attemptId: string,
  classId: string,
  assignmentId: string
): Promise<AttemptActionResult<{ attemptId: string; state: AttemptState }>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reopen_attempt", {
    p_attempt_id: attemptId,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}/assignments/${assignmentId}`);
  return { success: true, data: data as { attemptId: string; state: AttemptState } };
}
