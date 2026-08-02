import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResponseValue } from "@/lib/types/domain";
import { questionLabel } from "@/lib/ui/question-label";

/**
 * Answer validation + commit — the "validate everything, commit only if
 * fully valid" core, lifted out of commit-csv-submission.ts so the same
 * rule holds for every route into `responses`.
 *
 * It was written for the CSV upload path, where a whole file arrived at
 * once and a half-written submission would have been worse than a rejected
 * one: the student would have had no way to tell which answers landed. The
 * live answer grid (components/attempts/answer-grid.tsx) replaced that
 * upload, and the rule survived the replacement because the reason for it
 * did — an autosave batch or a final submission that writes some of its
 * answers and drops the rest is the same failure in a different wrapper.
 *
 * Deliberately framework-free: no "use server", no React, no Next.js
 * imports, so the seeding script and the server actions can share it.
 *
 * IT NEVER WRITES TO `responses` DIRECTLY. Answers go through
 * save_attempt_responses and the submission through submit_attempt (both
 * migration 0010). Those own the ownership check (auth.uid() must match the
 * attempt's student), the assignment-is-OPEN check, the write-once
 * draft-editing rule, the 0/1/NULL enforcement, the (attempt_id,
 * question_id) upsert, and the attempt state machine. A direct insert would
 * bypass every one of them.
 *
 * NO AUTOMATIC SUBMISSION. `commitAnswerSet` submits because its caller
 * asked it to, and every caller is an explicit click or a seeding script.
 * Nothing in this module is wired to a browser event, a timer, or a
 * lifecycle hook (EXCLUDED_FEATURES.md, zero tolerance).
 */

// ============================================================
// Shapes
// ============================================================

/** The minimum a question has to carry to be validated and named. */
export interface AnswerSetQuestion {
  id: string;
  externalQuestionCode: string;
  questionText: string;
  energySource?: string | null;
  criterion?: string | null;
}

export interface AnswerEntry {
  questionId: string;
  value: ResponseValue;
}

export interface AnswerIssue {
  /** The question the problem is about, where there is one. */
  questionId: string | null;
  /** Its code, for a message that names something the student can find. */
  code: string | null;
  message: string;
}

export interface ValidateAnswerSetOptions {
  /**
   * Treat a question with no answer as a problem. The CSV path required a
   * value in every column, because a blank column in an uploaded file was
   * far more likely to be a filling-in mistake than a decision. The grid
   * does not: a blank cell there is a visible, deliberate state the student
   * can see and count on the review step, and `response_value` is NULL-able
   * by design (CLAUDE.md rule 2 — 0, 1 or NULL).
   */
  requireComplete?: boolean;
  /**
   * Answers for a question id that isn't in `questions` are normally a
   * problem: it means a payload naming something this assignment doesn't
   * have. Set to "ignore" when validating rows already stored against an
   * assignment whose question list may since have changed — a question
   * deactivated after it was answered must not block a submission.
   */
  unknownQuestions?: "reject" | "ignore";
}

// ============================================================
// Validate
// ============================================================

/** How a question is named inside a message: wording first, then code. */
function describe(question: AnswerSetQuestion): string {
  const label = questionLabel({
    questionText: question.questionText,
    energySource: question.energySource,
    criterion: question.criterion,
    code: question.externalQuestionCode,
  });
  return label === question.externalQuestionCode
    ? label
    : `${label} (${question.externalQuestionCode})`;
}

/**
 * Value check on its own, with no knowledge of the assignment.
 *
 * Split out because the autosave path sends a partial batch and must not
 * pay for a question read to check it, while still refusing to send
 * anything that isn't 0, 1 or null. The grid's cell control cannot produce
 * another value — it cycles through exactly those three — but the check
 * stays because "the UI can't do that" is not a guarantee about what
 * reaches a server action.
 */
export function validateAnswerValues(answers: AnswerEntry[]): AnswerIssue[] {
  const issues: AnswerIssue[] = [];
  for (const answer of answers) {
    if (answer.value !== 0 && answer.value !== 1 && answer.value !== null) {
      issues.push({
        questionId: answer.questionId,
        code: null,
        message: `Answer for question ${answer.questionId} is not 0, 1 or blank.`,
      });
    }
  }
  return issues;
}

/**
 * Every problem in a set of answers, reported together rather than
 * stopping at the first — a caller showing these to a student should show
 * all of them, not make them fix one per round trip.
 */
export function validateAnswerSet(
  questions: AnswerSetQuestion[],
  answers: AnswerEntry[],
  options: ValidateAnswerSetOptions = {}
): AnswerIssue[] {
  const { requireComplete = false, unknownQuestions = "reject" } = options;
  const issues: AnswerIssue[] = [...validateAnswerValues(answers)];

  const byId = new Map(questions.map((q) => [q.id, q]));
  const seen = new Set<string>();

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) {
      if (unknownQuestions === "reject") {
        issues.push({
          questionId: answer.questionId,
          code: null,
          message: `Question ${answer.questionId} is not part of this assignment.`,
        });
      }
      continue;
    }
    if (seen.has(answer.questionId)) {
      issues.push({
        questionId: answer.questionId,
        code: question.externalQuestionCode,
        message: `${describe(question)} was answered more than once in the same batch.`,
      });
      continue;
    }
    seen.add(answer.questionId);
  }

  if (requireComplete) {
    const answered = new Set(
      answers.filter((a) => a.value !== null).map((a) => a.questionId)
    );
    const missing = questions.filter((q) => !answered.has(q.id));
    if (missing.length > 0) {
      issues.push({
        questionId: null,
        code: null,
        message:
          `${missing.length} question${missing.length === 1 ? " has" : "s have"} no answer: ` +
          `${missing.slice(0, 8).map(describe).join("; ")}` +
          `${missing.length > 8 ? `, and ${missing.length - 8} more` : ""}.`,
      });
    }
  }

  return issues;
}

// ============================================================
// Commit
// ============================================================

export interface CommitResult {
  attemptId: string;
  state: string;
  submittedAt: string;
  submissionVersion: number;
  answered: number;
  totalQuestions: number;
}

export type CommitOutcome =
  | { success: true; data: CommitResult }
  | { success: false; error: string; issues?: AnswerIssue[] };

export interface CommitAnswerSetOptions extends ValidateAnswerSetOptions {
  attemptId: string;
  /** The assignment's questions, read server-side — never trusted from a client. */
  questions: AnswerSetQuestion[];
  answers: AnswerEntry[];
  /**
   * Submit after saving. Always an explicit argument so submission can
   * never be an implicit consequence of saving.
   */
  submit?: boolean;
}

/**
 * Validate, save, and (only if asked) submit. Refuses to write anything at
 * all unless the whole set is valid — a partial write is worse than a
 * rejected one, because nobody can tell afterwards which answers landed.
 */
export async function commitAnswerSet(
  supabase: SupabaseClient,
  options: CommitAnswerSetOptions
): Promise<CommitOutcome> {
  const {
    attemptId,
    questions,
    answers,
    submit = false,
    requireComplete = false,
    unknownQuestions = "reject",
  } = options;

  if (questions.length === 0) {
    return { success: false, error: "This assignment has no active questions to answer." };
  }

  const issues = validateAnswerSet(questions, answers, { requireComplete, unknownQuestions });
  if (issues.length > 0) {
    return {
      success: false,
      error: `There ${issues.length === 1 ? "is 1 problem" : `are ${issues.length} problems`} with these answers, so nothing was saved.`,
      issues,
    };
  }

  if (answers.length > 0) {
    const { error: saveError } = await supabase.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: answers.map((a) => ({ questionId: a.questionId, value: a.value })),
    });
    if (saveError) return { success: false, error: saveError.message };
  }

  const answered = answers.filter((a) => a.value !== null).length;

  if (!submit) {
    return {
      success: true,
      data: {
        attemptId,
        state: "DRAFT",
        submittedAt: "",
        submissionVersion: 0,
        answered,
        totalQuestions: questions.length,
      },
    };
  }

  const { data: receipt, error: submitError } = await supabase.rpc("submit_attempt", {
    p_attempt_id: attemptId,
  });
  if (submitError) {
    // The answers ARE saved at this point; say so rather than implying the
    // whole thing was lost.
    return {
      success: false,
      error: `Your answers were saved, but the submission did not complete: ${submitError.message}`,
    };
  }

  return { success: true, data: receipt as CommitResult };
}
