"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  commitCsvSubmission,
  type CommitCsvResult,
  type CsvRowIssue,
} from "@/lib/attempts/commit-csv-submission";
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
 * click. Idempotency lives in the DB (upsert on attempt_id + question_id),
 * so the retry queue can safely replay a batch after a dropped connection.
 */
export async function saveResponses(
  attemptId: string,
  answers: AnswerInput[]
): Promise<AttemptActionResult<SaveResult>> {
  if (answers.length === 0) {
    return { success: false, error: "Nothing to save." };
  }
  for (const a of answers) {
    if (a.value !== 0 && a.value !== 1 && a.value !== null) {
      return { success: false, error: `Invalid answer value for question ${a.questionId}.` };
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_attempt_responses", {
    p_attempt_id: attemptId,
    p_answers: answers,
  });

  if (error) return { success: false, error: error.message };
  return { success: true, data: data as SaveResult };
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
 * button — nothing in this codebase invokes it from a browser event
 * (EXCLUDED_FEATURES.md: no automatic submission of any kind). The DB
 * function locks the attempt row, so double-clicks cannot double-submit.
 */
export async function submitAttempt(
  attemptId: string
): Promise<AttemptActionResult<SubmitReceipt>> {
  const supabase = await createClient();
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

/**
 * CSV submission — the web half of the two-layer design in
 * lib/attempts/commit-csv-submission.ts.
 *
 * This action is invoked by exactly one thing: the student's explicit
 * "Submit these answers" click in the upload wizard, after they have seen
 * the parsed preview. It is not wired to the file input's change event, so
 * choosing a file previews it and nothing more (EXCLUDED_FEATURES.md — no
 * automatic submission from any browser activity, and picking a file is
 * browser activity).
 *
 * The questions are re-read here from the database rather than accepted
 * from the client, so a tampered payload cannot introduce a question code
 * that isn't really on this assignment.
 */
export async function submitCsvAnswers(
  attemptId: string,
  csvText: string
): Promise<AttemptActionResult<CommitCsvResult> & { issues?: CsvRowIssue[] }> {
  const supabase = await createClient();

  const { data: attempt, error: attemptError } = await supabase
    .from("assignment_attempts")
    .select("id, assignment_id")
    .eq("id", attemptId)
    .maybeSingle();
  if (attemptError) return { success: false, error: attemptError.message };
  if (!attempt) return { success: false, error: "Attempt not found, or it is not yours." };

  const { data: questions, error: questionsError } = await supabase
    .from("questions")
    .select("id, external_question_code, question_text, display_order")
    .eq("assignment_id", attempt.assignment_id)
    .eq("is_active", true)
    .order("display_order")
    .returns<
      Array<{
        id: string;
        external_question_code: string;
        question_text: string;
        display_order: number;
      }>
    >();
  if (questionsError) return { success: false, error: questionsError.message };

  const result = await commitCsvSubmission(supabase, {
    attemptId,
    csvText,
    questions: (questions ?? []).map((q) => ({
      id: q.id,
      externalQuestionCode: q.external_question_code,
      questionText: q.question_text,
      displayOrder: q.display_order,
    })),
  });

  if (!result.success) {
    return { success: false, error: result.error, issues: result.issues };
  }
  return { success: true, data: result.data };
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
