import type { SupabaseClient } from "@supabase/supabase-js";
import { detectOrientation, orderGridQuestions } from "@/lib/exports/response-grid";
import { buildStudentGrid, type StudentGrid } from "@/lib/analytics/student-grid";

/**
 * One student's FULL submission — every question on every assignment in the
 * class, with the 0/1 they actually recorded.
 *
 * WHY THIS EXISTS AND WHY IT IS PER-STUDENT. The assignment grid is
 * aggregate-only: it shows class totals per question and no individual
 * answers at all. This module is the one read path for raw per-person
 * answers, and it is reached one student at a time from that student's
 * profile page. Nothing here fans out across a class.
 *
 * WHY IT READS `responses` DIRECTLY RATHER THAN AN ANALYTICS VIEW. This is
 * not an aggregate — .claude/rules/analytics.md's "aggregates belong in
 * PostgreSQL" rule is about not pulling whole response tables into app
 * memory to compute a statistic. One student's own rows (30 + 255) are the
 * data being displayed, not an intermediate for a metric, and there is no
 * view that carries them. RLS is the access boundary: a professor may read
 * responses for their own classes, and the caller has already been checked
 * against the class.
 *
 * It covers EVERY question on the assignment. Since the question-mapping
 * feature was removed, this is the only per-student answer surface in the
 * app — there is no curated subset beside it.
 *
 * Each assignment comes back TWICE OVER, from one read: as `grid`, the
 * source spreadsheet's own layout with the student's 0/1/blank in each cell
 * (lib/analytics/student-grid.ts), and as `groups`, the flat
 * question-by-question list that carries the verbatim wording a grid cell
 * has no room for. Both describe the same answers.
 */

/** Neutral labels — 0 and 1 are two options, neither is preferred. */
export const RESPONSE_VALUE_LABELS = { 0: "0 — No", 1: "1 — Yes" } as const;

export function responseValueLabel(value: 0 | 1 | null): string {
  if (value === null) return "No answer";
  return RESPONSE_VALUE_LABELS[value];
}

export interface StudentResponseRow {
  questionId: string;
  code: string;
  questionText: string | null;
  energySource: string;
  criterion: string;
  originalCell: string;
  /** The student's final answer, or null when they left it blank. */
  value: 0 | 1 | null;
  /** True when a final response row exists at all (blank or answered). */
  recorded: boolean;
}

export interface StudentResponseGroup {
  energySource: string;
  rows: StudentResponseRow[];
  ones: number;
  zeros: number;
  blank: number;
}

export interface StudentAssignmentResponses {
  assignmentId: string;
  title: string;
  sequenceNumber: number;
  /** The attempt these answers came from — the student's final/submitted one. */
  attemptState: string | null;
  submittedAt: string | null;
  submissionVersion: number | null;
  questionCount: number;
  answeredCount: number;
  ones: number;
  zeros: number;
  groups: StudentResponseGroup[];
  /**
   * The same answers again, laid out as the source spreadsheet's own grid.
   * This is the primary reading of the submission — `groups` is the flat
   * question-by-question list beneath it, which is the only place the
   * verbatim question wording is readable.
   */
  grid: StudentGrid;
}

const NO_SOURCE = "(no energy source)";
const NO_CRITERION = "(no criterion)";

interface QuestionRow {
  id: string;
  external_question_code: string;
  question_text: string | null;
  original_row_reference: string | null;
  original_column_reference: string | null;
  original_worksheet: string | null;
  energy_source: string | null;
  criterion: string | null;
  display_order: number;
}

/** Paged read — Supabase caps a plain select at 1000 rows. */
async function selectAllPaged<T>(
  supabase: SupabaseClient,
  build: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label: string
): Promise<T[]> {
  const pageSize = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw new Error(`could not read ${label}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

/**
 * Groups the ordered questions by energy source.
 *
 * Ordering reuses the grid's orientation detection so a question sits where
 * the source spreadsheet puts it — the professor reads the same sequence on
 * the profile page, the assignment totals page and the Excel sheet.
 */
export function groupStudentResponses(rows: StudentResponseRow[]): StudentResponseGroup[] {
  const groups: StudentResponseGroup[] = [];
  for (const row of rows) {
    let group = groups.find((g) => g.energySource === row.energySource);
    if (!group) {
      group = { energySource: row.energySource, rows: [], ones: 0, zeros: 0, blank: 0 };
      groups.push(group);
    }
    group.rows.push(row);
    if (row.value === 1) group.ones += 1;
    else if (row.value === 0) group.zeros += 1;
    else group.blank += 1;
  }
  return groups;
}

/**
 * Every assignment in the class, each with every one of its active questions
 * and this student's final answer to it. Assignments with no attempt still
 * appear, with every answer null — "not submitted" is information, and
 * silently dropping the assignment would read as "there is no such
 * assignment".
 */
export async function getStudentFullResponses(
  supabase: SupabaseClient,
  classId: string,
  studentId: string
): Promise<StudentAssignmentResponses[]> {
  const { data: assignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("id, title, sequence_number")
    .eq("class_id", classId)
    .order("sequence_number");
  if (assignmentsError) {
    throw new Error(`could not read assignments: ${assignmentsError.message}`);
  }

  // One assignment's three reads do not depend on each other, and one
  // assignment's reads do not depend on another's. Left sequential, a
  // student with two assignments cost six round-trips end to end (~360ms
  // of pure network wait against hosted Supabase); as one batch it costs
  // the slowest of the six. `Promise.all` over `.map` also keeps the
  // output in assignment order, which the sequential push relied on.
  return Promise.all(
    ((assignments ?? []) as Array<{
      id: string;
      title: string;
      sequence_number: number;
    }>).map(async (assignment) => {
      const questionsPromise = selectAllPaged<QuestionRow>(
        supabase,
        (from, to) =>
          supabase
            .from("questions")
            .select(
              "id, external_question_code, question_text, original_row_reference, original_column_reference, original_worksheet, energy_source, criterion, display_order"
            )
            .eq("assignment_id", assignment.id)
            .eq("is_active", true)
            .order("display_order")
            .range(from, to)
            .returns<QuestionRow[]>(),
        "questions"
      );

      const responsesPromise = selectAllPaged<{
        question_id: string;
        response_value: 0 | 1 | null;
      }>(
        supabase,
        (from, to) =>
          supabase
            .from("responses")
            .select("question_id, response_value")
            .eq("assignment_id", assignment.id)
            .eq("student_id", studentId)
            .eq("is_final", true)
            .order("question_id")
            .range(from, to)
            .returns<Array<{ question_id: string; response_value: 0 | 1 | null }>>(),
        "responses"
      );

      const attemptPromise = supabase
        .from("assignment_attempts")
        .select("state, submitted_at, submission_version")
        .eq("assignment_id", assignment.id)
        .eq("student_id", studentId)
        .maybeSingle();

      const [questions, responses, { data: attempt, error: attemptError }] =
        await Promise.all([questionsPromise, responsesPromise, attemptPromise]);
      if (attemptError) {
        throw new Error(`could not read attempt: ${attemptError.message}`);
      }
      const byQuestion = new Map(responses.map((r) => [r.question_id, r.response_value]));

      const ordered = orderGridQuestions(questions, detectOrientation(questions));
      const rows: StudentResponseRow[] = ordered.map((q) => ({
        questionId: q.id,
        code: q.external_question_code,
        questionText: q.question_text,
        energySource: q.energy_source?.trim() || NO_SOURCE,
        criterion: q.criterion?.trim() || NO_CRITERION,
        originalCell:
          `${q.original_column_reference ?? ""}${q.original_row_reference ?? ""}` || "—",
        value: byQuestion.get(q.id) ?? null,
        recorded: byQuestion.has(q.id),
      }));

      const groups = groupStudentResponses(rows);
      // The grid is the same answers in the source file's own shape. It is
      // built from the questions rather than from `rows` because placement
      // needs the row/column references separately, and `rows` has already
      // joined them into one display string.
      const grid = buildStudentGrid(
        questions,
        (questionId) => byQuestion.get(questionId) ?? null,
        ordered[0]?.original_worksheet ?? null
      );
      return {
        assignmentId: assignment.id,
        title: assignment.title,
        sequenceNumber: assignment.sequence_number,
        attemptState: (attempt as { state?: string } | null)?.state ?? null,
        submittedAt: (attempt as { submitted_at?: string | null } | null)?.submitted_at ?? null,
        submissionVersion:
          (attempt as { submission_version?: number | null } | null)?.submission_version ?? null,
        questionCount: rows.length,
        answeredCount: rows.filter((r) => r.value !== null).length,
        ones: groups.reduce((n, g) => n + g.ones, 0),
        zeros: groups.reduce((n, g) => n + g.zeros, 0),
        groups,
        grid,
      };
    })
  );
}
