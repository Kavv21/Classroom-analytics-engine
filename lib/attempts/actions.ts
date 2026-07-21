"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
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
