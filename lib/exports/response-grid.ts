import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The response grid: one column per question laid out in the ORIGINAL
 * spreadsheet's reading order, one row per student, and a totals row.
 *
 * ONE SOURCE FOR TWO SURFACES. The Excel sheet (lib/exports/workbook.ts)
 * and the live page (/classes/:id/assignments/:id/grid) both call
 * `gatherResponseGrid`. Neither computes its own layout, ordering or
 * totals, so the downloaded snapshot and the live screen cannot drift into
 * showing different things.
 *
 * TOTALS COME FROM A DATABASE VIEW, NOT FROM THE ROWS BELOW THEM.
 * `question_response_summary` (migration 0012) already counts 1s per
 * question over final responses of active student members, and
 * .claude/rules/analytics.md requires aggregates to be computed in
 * PostgreSQL rather than by looping in app memory. Using it here also means
 * the totals on this grid are the same numbers the rest of analytics uses.
 * The per-student cells are a separate, paginated read — the live page only
 * ever materialises the page of students it is showing.
 */

export type GridOrientation = "SOURCES_IN_ROWS" | "SOURCES_IN_COLUMNS";

export interface GridColumn {
  questionId: string;
  code: string;
  energySource: string;
  criterion: string;
  /** The cell this question occupied in the source workbook, e.g. "D6". */
  originalCell: string;
}

export interface GridStudentRow {
  studentId: string;
  name: string;
  studentIdentifier: string | null;
  isSynthetic: boolean;
  /** Aligned to `columns`; null where the student has no final answer. */
  values: Array<0 | 1 | null>;
}

export interface ResponseGrid {
  assignmentId: string;
  assignmentTitle: string;
  sequenceNumber: number;
  classId: string;
  orientation: GridOrientation;
  worksheet: string | null;
  columns: GridColumn[];
  students: GridStudentRow[];
  /** Count of "1" answers per column, from question_response_summary. */
  totals: Array<number | null>;
  /** Students answering this assignment at all, regardless of paging. */
  totalStudentCount: number;
  syntheticStudentCount: number;
  generatedAt: string;
}

interface QuestionRow {
  id: string;
  external_question_code: string;
  original_row_reference: string | null;
  original_column_reference: string | null;
  original_worksheet: string | null;
  energy_source: string | null;
  criterion: string | null;
  display_order: number;
}

const NO_SOURCE = "(no energy source)";
const NO_CRITERION = "(no criterion)";

/** Spreadsheet column letters → a sortable number ("D" → 4, "AA" → 27). */
function columnIndex(ref: string | null): number {
  if (!ref) return Number.MAX_SAFE_INTEGER;
  let n = 0;
  for (const ch of ref.trim().toUpperCase()) {
    const code = ch.charCodeAt(0) - 64;
    if (code < 1 || code > 26) return Number.MAX_SAFE_INTEGER;
    n = n * 26 + code;
  }
  return n === 0 ? Number.MAX_SAFE_INTEGER : n;
}

function rowIndex(ref: string | null): number {
  const n = Number.parseInt((ref ?? "").trim(), 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
}

/**
 * Which axis carries the energy sources, recovered from the stored
 * `original_row_reference` / `original_column_reference` rather than by
 * re-parsing the workbook.
 *
 * Assignment 1's sheet lists sources down a column, so every question on a
 * given ROW shares one energy source. Assignment 2's sheet is transposed:
 * every question on a given row shares one CRITERION instead. Testing for
 * "is energy source constant along each row" therefore separates the two,
 * and matches parse-grid.ts's SOURCES_IN_ROWS / SOURCES_IN_COLUMNS.
 */
export function detectOrientation(questions: QuestionRow[]): GridOrientation {
  const sourcesPerRow = new Map<number, Set<string>>();
  for (const q of questions) {
    const r = rowIndex(q.original_row_reference);
    const set = sourcesPerRow.get(r) ?? new Set<string>();
    set.add(q.energy_source ?? NO_SOURCE);
    sourcesPerRow.set(r, set);
  }
  const rowsWithOneSource = [...sourcesPerRow.values()].filter((s) => s.size === 1).length;
  // A tie (every row has exactly one question) is reported as SOURCES_IN_ROWS,
  // which is also the layout a single-column sheet reads as.
  return rowsWithOneSource >= sourcesPerRow.size / 2 ? "SOURCES_IN_ROWS" : "SOURCES_IN_COLUMNS";
}

/**
 * Column order mirrors how the source sheet reads: walk the energy-source
 * axis on the outside, the criterion axis on the inside, so every source's
 * criteria stay adjacent exactly as they are in the original grid — whether
 * that axis is rows (Assignment 1) or columns (Assignment 2).
 */
export function orderGridQuestions(
  questions: QuestionRow[],
  orientation: GridOrientation
): QuestionRow[] {
  const sourceAxis = (q: QuestionRow) =>
    orientation === "SOURCES_IN_ROWS"
      ? rowIndex(q.original_row_reference)
      : columnIndex(q.original_column_reference);
  const criterionAxis = (q: QuestionRow) =>
    orientation === "SOURCES_IN_ROWS"
      ? columnIndex(q.original_column_reference)
      : rowIndex(q.original_row_reference);

  return [...questions].sort(
    (a, b) =>
      sourceAxis(a) - sourceAxis(b) ||
      criterionAxis(a) - criterionAxis(b) ||
      a.display_order - b.display_order
  );
}

/** Paged read — Supabase caps a plain select at 1000 rows. */
async function selectAllPaged<T>(
  supabase: SupabaseClient,
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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

export interface GatherGridOptions {
  /** Max students to materialise. Omit for all (the export path). */
  studentLimit?: number;
  studentOffset?: number;
}

export async function gatherResponseGrid(
  supabase: SupabaseClient,
  assignmentId: string,
  options: GatherGridOptions = {}
): Promise<ResponseGrid> {
  // ---- assignment ----
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("id, class_id, title, sequence_number")
    .eq("id", assignmentId)
    .maybeSingle();
  if (assignmentError) throw new Error(`could not read assignment: ${assignmentError.message}`);
  if (!assignment) throw new Error("Assignment not found, or you don't have access to it.");

  // ---- questions ----
  const questions = await selectAllPaged<QuestionRow>(
    supabase,
    (from, to) =>
      supabase
        .from("questions")
        .select(
          "id, external_question_code, original_row_reference, original_column_reference, original_worksheet, energy_source, criterion, display_order"
        )
        .eq("assignment_id", assignmentId)
        .eq("is_active", true)
        .order("display_order")
        .range(from, to)
        .returns<QuestionRow[]>(),
    "questions"
  );

  const orientation = detectOrientation(questions);
  const ordered = orderGridQuestions(questions, orientation);
  const columns: GridColumn[] = ordered.map((q) => ({
    questionId: q.id,
    code: q.external_question_code,
    energySource: q.energy_source?.trim() || NO_SOURCE,
    criterion: q.criterion?.trim() || NO_CRITERION,
    originalCell: `${q.original_column_reference ?? ""}${q.original_row_reference ?? ""}` || "—",
  }));
  const columnIndexById = new Map(columns.map((c, i) => [c.questionId, i]));

  // ---- totals, from the analytics view (not from the rows below) ----
  const summaryRows = await selectAllPaged<{ question_id: string; ones: number }>(
    supabase,
    (from, to) =>
      supabase
        .from("question_response_summary")
        .select("question_id, ones")
        .eq("assignment_id", assignmentId)
        .range(from, to)
        .returns<Array<{ question_id: string; ones: number }>>(),
    "question_response_summary"
  );
  const onesByQuestion = new Map(summaryRows.map((r) => [r.question_id, r.ones]));
  const totals = columns.map((c) => onesByQuestion.get(c.questionId) ?? null);

  // ---- students (active members of this assignment's class) ----
  const members = await selectAllPaged<{
    user_id: string;
    is_synthetic: boolean;
    profiles: { full_name: string | null; email: string; student_identifier: string | null } | null;
  }>(
    supabase,
    (from, to) =>
      supabase
        .from("class_members")
        .select("user_id, is_synthetic, profiles(full_name, email, student_identifier)")
        .eq("class_id", assignment.class_id)
        .eq("member_role", "STUDENT")
        .eq("status", "ACTIVE")
        .order("user_id")
        .range(from, to)
        .returns<
          Array<{
            user_id: string;
            is_synthetic: boolean;
            profiles: {
              full_name: string | null;
              email: string;
              student_identifier: string | null;
            } | null;
          }>
        >(),
    "class_members"
  );

  const allStudents = members
    .map((m) => ({
      studentId: m.user_id,
      name: m.profiles?.full_name ?? m.profiles?.email ?? `Student ${m.user_id.slice(0, 8)}`,
      studentIdentifier: m.profiles?.student_identifier ?? null,
      isSynthetic: m.is_synthetic,
    }))
    .sort((a, b) =>
      (a.studentIdentifier ?? a.name).localeCompare(b.studentIdentifier ?? b.name, undefined, {
        numeric: true,
      })
    );

  const offset = options.studentOffset ?? 0;
  const page =
    options.studentLimit === undefined
      ? allStudents
      : allStudents.slice(offset, offset + options.studentLimit);
  const pageIds = new Set(page.map((s) => s.studentId));

  // ---- cells ----
  const responses =
    page.length === 0
      ? []
      : await selectAllPaged<{ student_id: string; question_id: string; response_value: 0 | 1 | null }>(
          supabase,
          (from, to) =>
            supabase
              .from("responses")
              .select("student_id, question_id, response_value")
              .eq("assignment_id", assignmentId)
              .eq("is_final", true)
              .in("student_id", [...pageIds])
              .order("student_id")
              .range(from, to)
              .returns<
                Array<{ student_id: string; question_id: string; response_value: 0 | 1 | null }>
              >(),
          "responses"
        );

  const rowByStudent = new Map<string, GridStudentRow>();
  for (const s of page) {
    rowByStudent.set(s.studentId, {
      ...s,
      values: new Array<0 | 1 | null>(columns.length).fill(null),
    });
  }
  for (const r of responses) {
    const row = rowByStudent.get(r.student_id);
    const column = columnIndexById.get(r.question_id);
    if (!row || column === undefined) continue;
    row.values[column] = r.response_value;
  }

  return {
    assignmentId,
    assignmentTitle: assignment.title,
    sequenceNumber: assignment.sequence_number,
    classId: assignment.class_id,
    orientation,
    worksheet: ordered[0]?.original_worksheet ?? null,
    columns,
    students: page.map((s) => rowByStudent.get(s.studentId)!),
    totals,
    totalStudentCount: allStudents.length,
    syntheticStudentCount: allStudents.filter((s) => s.isSynthetic).length,
    generatedAt: new Date().toISOString(),
  };
}

/** How the two orientations are described to a reader, in plain words. */
export function orientationDescription(orientation: GridOrientation): string {
  return orientation === "SOURCES_IN_ROWS"
    ? "the source sheet lists energy sources down the rows, with the criteria across the columns"
    : "the source sheet is transposed — energy sources run across the columns, with the criteria down the rows";
}
