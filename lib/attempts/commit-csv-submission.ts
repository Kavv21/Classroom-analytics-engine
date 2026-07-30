import Papa from "papaparse";
import type { SupabaseClient } from "@supabase/supabase-js";
import { questionLabel } from "@/lib/ui/question-label";

/**
 * CSV answer submission — the validation + commit core.
 *
 * Deliberately framework-free: no "use server", no React, no Next.js
 * imports. It takes a Supabase client and CSV text, and it is called from
 * two places that must never diverge:
 *   - the web upload wizard (server action, student's RLS-scoped client);
 *   - scripts/seed-demo-via-csv.ts (a client signed in as each synthetic
 *     student).
 * The script therefore exercises the same validation and the same RPCs a
 * real student's upload does, rather than a lookalike written for seeding.
 *
 * IT NEVER WRITES TO `responses` DIRECTLY. Answers go through
 * save_attempt_responses and the submission through submit_attempt (both
 * migration 0010). Those own the ownership check (auth.uid() must match the
 * attempt's student), the assignment-is-OPEN check, the write-once
 * draft-editing rule, the 0/1/NULL enforcement, the (attempt_id,
 * question_id) upsert, and the attempt state machine. A direct insert would
 * bypass every one of them.
 *
 * NO AUTOMATIC SUBMISSION. `commitCsvSubmission` submits because the caller
 * asked it to, and the caller is either an explicit confirm click or a
 * seeding script. Nothing in this module is wired to a browser event, a
 * timer, or a lifecycle hook (EXCLUDED_FEATURES.md, zero tolerance).
 */

// ============================================================
// Shapes
// ============================================================

export interface CsvQuestion {
  id: string;
  externalQuestionCode: string;
  questionText: string;
  displayOrder: number;
  /** Optional because the two stored fields the wording is built from are
   *  only needed for the question-key reference sheet, not for parsing. */
  energySource?: string | null;
  criterion?: string | null;
}

export interface CsvRowIssue {
  /** 1-based row number as the professor/student sees it in a spreadsheet
   *  (row 1 is the header), or null for whole-file problems. */
  row: number | null;
  column: string | null;
  message: string;
}

export interface ParsedCsvAnswers {
  answers: Array<{ questionId: string; code: string; value: 0 | 1 }>;
  issues: CsvRowIssue[];
  /** Question codes present in the file that this assignment doesn't have. */
  unknownColumns: string[];
  /** Active questions with no answer in the file. */
  missingCodes: string[];
  /** Codes appearing more than once. */
  duplicateCodes: string[];
}

export const MAX_CSV_BYTES = 2 * 1024 * 1024;
export const CSV_STUDENT_COLUMN = "student_identifier";

/** Columns that carry context rather than an answer, ignored on parse. */
const IGNORED_COLUMNS = new Set([
  CSV_STUDENT_COLUMN,
  "student",
  "student_id",
  "email",
  "name",
  "full_name",
  "roll_number",
]);

// ============================================================
// Template
// ============================================================

/**
 * The downloadable template: one column per active question, in display
 * order, headed by `external_question_code`.
 *
 * THE CODE IS THE COLUMN HEADER HERE ON PURPOSE, and this is the one place
 * in the app where a bare code is the primary identifier. It is the key
 * `parseCsvAnswers` matches against, so replacing it with wording would
 * break every uploaded sheet. Instead the readability problem is solved
 * twice over: a second header row carries the question wording, and
 * `buildCsvQuestionKey` ships a companion reference table. Because wording
 * must never be retyped by hand (CLAUDE.md rule 1), both are copied verbatim
 * from the database.
 */
export function buildCsvTemplate(questions: CsvQuestion[]): string {
  const ordered = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);
  const header = ordered.map((q) => q.externalQuestionCode);
  const wording = ordered.map((q) => questionLabel({
    questionText: q.questionText,
    energySource: q.energySource,
    criterion: q.criterion,
    code: q.externalQuestionCode,
  }));
  const blank = ordered.map(() => "");

  return Papa.unparse(
    [
      header,
      // Every cell of the wording row is prefixed with # so a parser that
      // skips comments still sees a clean single-header CSV — same
      // convention as the Phase 9 export provenance block.
      wording.map((w) => `# ${w}`),
      blank,
    ],
    { newline: "\r\n" }
  );
}

export const QUESTION_KEY_HEADERS = [
  "Question code",
  "Question",
  "Energy source",
  "Criterion",
  "Column in answer sheet",
] as const;

/**
 * The companion "question key": every code paired with its full wording, its
 * energy source and its criterion, plus which column of the answer sheet it
 * is. Downloaded alongside the template so a student filling in 0s and 1s
 * has something to check against rather than a row of codes.
 *
 * Same rule as the template — wording is copied, never composed.
 */
export function buildCsvQuestionKey(questions: CsvQuestion[]): string {
  const ordered = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);
  return Papa.unparse(
    [
      [...QUESTION_KEY_HEADERS],
      ...ordered.map((q, i) => [
        q.externalQuestionCode,
        questionLabel({
          questionText: q.questionText,
          energySource: q.energySource,
          criterion: q.criterion,
          code: q.externalQuestionCode,
        }),
        q.energySource ?? "",
        q.criterion ?? "",
        // 1-based so it matches what a spreadsheet shows.
        String(i + 1),
      ]),
    ],
    { newline: "\r\n" }
  );
}

// ============================================================
// Parse + validate
// ============================================================

function normaliseCode(raw: string): string {
  return raw.trim().toUpperCase();
}

/** How a question is named inside an error message: wording, then code. */
function describe(question: CsvQuestion): string {
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
 * Parses one student's answers out of CSV text and reports every problem it
 * finds, rather than stopping at the first. Nothing is coerced: a value
 * that is not recognisably 0 or 1 is an error, never a guess and never a
 * silent blank (spec section 23 — never partially import silently).
 */
export function parseCsvAnswers(
  csvText: string,
  questions: CsvQuestion[]
): ParsedCsvAnswers {
  const issues: CsvRowIssue[] = [];
  const byCode = new Map<string, CsvQuestion>();
  for (const q of questions) byCode.set(normaliseCode(q.externalQuestionCode), q);

  const parsed = Papa.parse<string[]>(csvText, {
    skipEmptyLines: "greedy",
  });

  for (const err of parsed.errors ?? []) {
    issues.push({
      row: typeof err.row === "number" ? err.row + 1 : null,
      column: null,
      message: err.message,
    });
  }

  const rows = (parsed.data ?? []).filter(
    (r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== "")
  );
  // Drop the wording/comment rows the template ships.
  const dataRows = rows.filter((r) => !String(r[0] ?? "").trim().startsWith("#"));

  if (dataRows.length === 0) {
    issues.push({ row: null, column: null, message: "The file has no rows." });
    return { answers: [], issues, unknownColumns: [], missingCodes: [], duplicateCodes: [] };
  }

  const header = (dataRows[0] ?? []).map((h) => String(h ?? "").trim());
  const answerRows = dataRows.slice(1);

  if (answerRows.length === 0) {
    issues.push({
      row: null,
      column: null,
      message: "The file has a header row but no answers underneath it.",
    });
  }
  if (answerRows.length > 1) {
    issues.push({
      row: 3,
      column: null,
      message:
        `This file has ${answerRows.length} rows of answers. A submission covers one ` +
        `student, so it must have exactly one — only the first row would be read.`,
    });
  }

  // ---- header ----
  const unknownColumns: string[] = [];
  const duplicateCodes: string[] = [];
  const seen = new Set<string>();
  const columnQuestion: Array<CsvQuestion | null> = [];

  header.forEach((rawHeader, index) => {
    const code = normaliseCode(rawHeader);
    if (code === "" || IGNORED_COLUMNS.has(code.toLowerCase())) {
      columnQuestion.push(null);
      return;
    }
    const question = byCode.get(code);
    if (!question) {
      unknownColumns.push(rawHeader);
      columnQuestion.push(null);
      issues.push({
        row: 1,
        column: rawHeader,
        message: `"${rawHeader}" is not a question in this assignment.`,
      });
      return;
    }
    if (seen.has(code)) {
      duplicateCodes.push(rawHeader);
      columnQuestion.push(null);
      issues.push({
        row: 1,
        column: rawHeader,
        message: `"${rawHeader}" appears more than once — each question may have one column.`,
      });
      return;
    }
    seen.add(code);
    columnQuestion.push(question);
    void index;
  });

  // ---- values ----
  const answers: ParsedCsvAnswers["answers"] = [];
  const firstRow = answerRows[0];

  if (firstRow) {
    columnQuestion.forEach((question, columnIndex) => {
      if (!question) return;
      const raw = String(firstRow[columnIndex] ?? "").trim();
      // `column` stays the code because that IS the CSV column heading the
      // student has to find. The message names the question in words, so
      // fixing it doesn't require the question key open alongside.
      const columnLabel = question.externalQuestionCode;
      const named = describe(question);

      if (raw === "") {
        issues.push({
          row: 2,
          column: columnLabel,
          message: `${named} has no answer. Every question needs a 0 or a 1.`,
        });
        return;
      }
      if (raw !== "0" && raw !== "1") {
        issues.push({
          row: 2,
          column: columnLabel,
          message: `${named} is "${raw}". Only 0 or 1 is allowed.`,
        });
        return;
      }
      answers.push({
        questionId: question.id,
        code: question.externalQuestionCode,
        value: raw === "1" ? 1 : 0,
      });
    });
  }

  // ---- completeness ----
  const answeredIds = new Set(answers.map((a) => a.questionId));
  const missingCodes = questions
    .filter((q) => !answeredIds.has(q.id))
    .map((q) => q.externalQuestionCode);

  // Only report the aggregate gap for questions with no column at all —
  // a present-but-blank column already produced its own row-level issue.
  const headerCodes = new Set(
    columnQuestion.filter((q): q is CsvQuestion => q !== null).map((q) => q.externalQuestionCode)
  );
  const absentFromFile = questions.filter(
    (q) => !answeredIds.has(q.id) && !headerCodes.has(q.externalQuestionCode)
  );
  if (absentFromFile.length > 0) {
    issues.push({
      row: 1,
      column: null,
      message:
        `${absentFromFile.length} question${absentFromFile.length === 1 ? " is" : "s are"} ` +
        `missing from the file: ${absentFromFile.slice(0, 8).map(describe).join("; ")}` +
        `${absentFromFile.length > 8 ? `, and ${absentFromFile.length - 8} more` : ""}.`,
    });
  }

  return { answers, issues, unknownColumns, missingCodes, duplicateCodes };
}

// ============================================================
// Commit
// ============================================================

export interface CommitCsvResult {
  attemptId: string;
  state: string;
  submittedAt: string;
  submissionVersion: number;
  answered: number;
  totalQuestions: number;
}

export type CommitCsvOutcome =
  | { success: true; data: CommitCsvResult }
  | { success: false; error: string; issues?: CsvRowIssue[] };

export interface CommitCsvOptions {
  attemptId: string;
  questions: CsvQuestion[];
  /** Raw CSV text. Parsed and validated here, never trusted pre-parsed. */
  csvText: string;
  /**
   * Save the answers but stop short of submitting. Used by nothing in the
   * UI today; exists so a caller can stage answers without the irreversible
   * step, and so `submit` is always an explicit argument rather than an
   * implicit consequence of uploading a file.
   */
  submit?: boolean;
}

/**
 * Validate, save, submit. Refuses to write anything unless the file is
 * completely valid — a partial submission is worse than a rejected one,
 * because the student would have no way to tell which answers landed.
 */
export async function commitCsvSubmission(
  supabase: SupabaseClient,
  options: CommitCsvOptions
): Promise<CommitCsvOutcome> {
  const { attemptId, questions, csvText, submit = true } = options;

  if (questions.length === 0) {
    return { success: false, error: "This assignment has no active questions to answer." };
  }
  if (csvText.length > MAX_CSV_BYTES) {
    return { success: false, error: "That file is too large to be an answer sheet." };
  }

  const parsed = parseCsvAnswers(csvText, questions);
  if (parsed.issues.length > 0) {
    return {
      success: false,
      error: `The file has ${parsed.issues.length} problem${parsed.issues.length === 1 ? "" : "s"} and was not submitted.`,
      issues: parsed.issues,
    };
  }
  if (parsed.answers.length !== questions.length) {
    // Belt and braces: the issue list above should already have caught it.
    return {
      success: false,
      error: `Expected ${questions.length} answers, found ${parsed.answers.length}.`,
      issues: parsed.issues,
    };
  }

  const { error: saveError } = await supabase.rpc("save_attempt_responses", {
    p_attempt_id: attemptId,
    p_answers: parsed.answers.map((a) => ({ questionId: a.questionId, value: a.value })),
  });
  if (saveError) return { success: false, error: saveError.message };

  if (!submit) {
    return {
      success: true,
      data: {
        attemptId,
        state: "DRAFT",
        submittedAt: "",
        submissionVersion: 0,
        answered: parsed.answers.length,
        totalQuestions: questions.length,
      },
    };
  }

  const { data: receipt, error: submitError } = await supabase.rpc("submit_attempt", {
    p_attempt_id: attemptId,
  });
  if (submitError) {
    // The answers ARE saved at this point; say so rather than implying the
    // whole upload was lost.
    return {
      success: false,
      error:
        `Your answers were saved, but the submission did not complete: ${submitError.message}`,
    };
  }

  return { success: true, data: receipt as CommitCsvResult };
}
