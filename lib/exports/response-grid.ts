import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The response grid: one column per question laid out in the ORIGINAL
 * spreadsheet's reading order, carrying that question's ANSWER TOTALS —
 * plus a rolled-up subtotal for each energy-source group.
 *
 * THIS VIEW IS AGGREGATE-ONLY. It holds no student rows, no names, and no
 * individual answers. An individual student's full submission lives on the
 * per-student profile page (/classes/:id/analytics/students/:studentId),
 * which is the one surface that shows raw per-person answers.
 *
 * ONE SOURCE FOR TWO SURFACES. The Excel sheet (lib/exports/workbook.ts)
 * and the live page (/classes/:id/assignments/:id/grid) both call
 * `gatherResponseGrid`. Neither computes its own layout, ordering or
 * totals, so the downloaded snapshot and the live screen cannot drift into
 * showing different things.
 *
 * EVERY NUMBER COMES FROM A DATABASE VIEW. `question_response_summary`
 * (migration 0012) counts 0s, 1s and respondents per question over final
 * responses of active student members, and
 * `energy_source_response_summary` rolls those up per energy source —
 * .claude/rules/analytics.md requires aggregates to be computed in
 * PostgreSQL rather than by looping in app memory. Using both here also
 * means the totals on this grid are the same numbers the rest of analytics
 * uses.
 */

export type GridOrientation = "SOURCES_IN_ROWS" | "SOURCES_IN_COLUMNS";

export interface GridColumn {
  questionId: string;
  code: string;
  /** Verbatim wording from the manifest (CLAUDE.md rule 1), never composed. */
  questionText: string | null;
  energySource: string;
  criterion: string;
  /** The cell this question occupied in the source workbook, e.g. "D6". */
  originalCell: string;
  /** Students answering "1". Null when the question has no summary row. */
  ones: number | null;
  /** Students answering "0". */
  zeros: number | null;
  /** Students with a non-blank final answer to this question. */
  answered: number | null;
}

/**
 * A rolled-up total across every question belonging to one energy source.
 *
 * `columnRanges` are inclusive 0-based index pairs into `columns`. Ordering
 * keeps each source's questions adjacent, so a source is normally one run —
 * but the ranges are a list rather than a single pair so that a source split
 * across the sheet still sums correctly instead of silently covering the
 * questions in between.
 */
export interface GridSourceSubtotal {
  energySource: string;
  questionCount: number;
  ones: number;
  zeros: number;
  answered: number;
  columnRanges: Array<[number, number]>;
  /** True when this row was rolled up in app code rather than read from
   *  energy_source_response_summary — see `rollUpSources`. */
  derived: boolean;
}

export interface ResponseGrid {
  assignmentId: string;
  assignmentTitle: string;
  sequenceNumber: number;
  classId: string;
  orientation: GridOrientation;
  worksheet: string | null;
  columns: GridColumn[];
  sourceSubtotals: GridSourceSubtotal[];
  /** Students enrolled on this assignment's class, for context on the totals. */
  totalStudentCount: number;
  syntheticStudentCount: number;
  generatedAt: string;
}

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
export function detectOrientation(
  questions: Array<Pick<QuestionRow, "original_row_reference" | "energy_source">>
): GridOrientation {
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
export function orderGridQuestions<T extends Pick<
  QuestionRow,
  "original_row_reference" | "original_column_reference" | "display_order"
>>(questions: T[], orientation: GridOrientation): T[] {
  const sourceAxis = (q: T) =>
    orientation === "SOURCES_IN_ROWS"
      ? rowIndex(q.original_row_reference)
      : columnIndex(q.original_column_reference);
  const criterionAxis = (q: T) =>
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

/**
 * Group the ordered columns into per-energy-source subtotals.
 *
 * The numbers come from `energy_source_response_summary` wherever that view
 * has a row, which is the PostgreSQL-side rollup of exactly these questions.
 * The view excludes questions whose `energy_source` is NULL, so the
 * "(no energy source)" bucket — and any group the view somehow has no row
 * for — is summed here instead and flagged `derived: true` so neither
 * surface can present an app-side rollup as if it came from the view.
 */
export function rollUpSources(
  columns: GridColumn[],
  fromView: Map<string, { question_count: number; ones: number; zeros: number; answered: number }>
): GridSourceSubtotal[] {
  const order: string[] = [];
  const ranges = new Map<string, Array<[number, number]>>();

  columns.forEach((column, index) => {
    const key = column.energySource;
    let runs = ranges.get(key);
    if (!runs) {
      runs = [];
      ranges.set(key, runs);
      order.push(key);
    }
    const last = runs[runs.length - 1];
    if (last && last[1] === index - 1) last[1] = index;
    else runs.push([index, index]);
  });

  return order.map((energySource) => {
    const columnRanges = ranges.get(energySource)!;
    const members = columnRanges.flatMap(([from, to]) => columns.slice(from, to + 1));
    const view = fromView.get(energySource);
    if (view && view.question_count === members.length) {
      return {
        energySource,
        questionCount: view.question_count,
        ones: view.ones,
        zeros: view.zeros,
        answered: view.answered,
        columnRanges,
        derived: false,
      };
    }
    const sum = (pick: (c: GridColumn) => number | null) =>
      members.reduce((total, c) => total + (pick(c) ?? 0), 0);
    return {
      energySource,
      questionCount: members.length,
      ones: sum((c) => c.ones),
      zeros: sum((c) => c.zeros),
      answered: sum((c) => c.answered),
      columnRanges,
      derived: true,
    };
  });
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

export async function gatherResponseGrid(
  supabase: SupabaseClient,
  assignmentId: string
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
          "id, external_question_code, question_text, original_row_reference, original_column_reference, original_worksheet, energy_source, criterion, display_order"
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

  // ---- per-question totals, from the analytics view ----
  const summaryRows = await selectAllPaged<{
    question_id: string;
    answered: number;
    zeros: number;
    ones: number;
  }>(
    supabase,
    (from, to) =>
      supabase
        .from("question_response_summary")
        .select("question_id, answered, zeros, ones")
        .eq("assignment_id", assignmentId)
        .range(from, to)
        .returns<Array<{ question_id: string; answered: number; zeros: number; ones: number }>>(),
    "question_response_summary"
  );
  const summaryByQuestion = new Map(summaryRows.map((r) => [r.question_id, r]));

  const columns: GridColumn[] = ordered.map((q) => {
    const summary = summaryByQuestion.get(q.id);
    return {
      questionId: q.id,
      code: q.external_question_code,
      questionText: q.question_text,
      energySource: q.energy_source?.trim() || NO_SOURCE,
      criterion: q.criterion?.trim() || NO_CRITERION,
      originalCell: `${q.original_column_reference ?? ""}${q.original_row_reference ?? ""}` || "—",
      ones: summary?.ones ?? null,
      zeros: summary?.zeros ?? null,
      answered: summary?.answered ?? null,
    };
  });

  // ---- per-energy-source subtotals, from the analytics view ----
  const sourceRows = await selectAllPaged<{
    energy_source: string;
    question_count: number;
    answered: number;
    zeros: number;
    ones: number;
  }>(
    supabase,
    (from, to) =>
      supabase
        .from("energy_source_response_summary")
        .select("energy_source, question_count, answered, zeros, ones")
        .eq("assignment_id", assignmentId)
        .range(from, to)
        .returns<
          Array<{
            energy_source: string;
            question_count: number;
            answered: number;
            zeros: number;
            ones: number;
          }>
        >(),
    "energy_source_response_summary"
  );
  const sourceSubtotals = rollUpSources(
    columns,
    new Map(sourceRows.map((r) => [r.energy_source.trim(), r]))
  );

  // ---- enrolment counts, for context on the totals ----
  // Ids and the synthetic flag only. This view names no student, so nothing
  // here reads a profile.
  const members = await selectAllPaged<{ user_id: string; is_synthetic: boolean }>(
    supabase,
    (from, to) =>
      supabase
        .from("class_members")
        .select("user_id, is_synthetic")
        .eq("class_id", assignment.class_id)
        .eq("member_role", "STUDENT")
        .eq("status", "ACTIVE")
        .order("user_id")
        .range(from, to)
        .returns<Array<{ user_id: string; is_synthetic: boolean }>>(),
    "class_members"
  );

  return {
    assignmentId,
    assignmentTitle: assignment.title,
    sequenceNumber: assignment.sequence_number,
    classId: assignment.class_id,
    orientation,
    worksheet: ordered[0]?.original_worksheet ?? null,
    columns,
    sourceSubtotals,
    totalStudentCount: members.length,
    syntheticStudentCount: members.filter((m) => m.is_synthetic).length,
    generatedAt: new Date().toISOString(),
  };
}

/** How the two orientations are described to a reader, in plain words. */
export function orientationDescription(orientation: GridOrientation): string {
  return orientation === "SOURCES_IN_ROWS"
    ? "the source sheet lists energy sources down the rows, with the criteria across the columns"
    : "the source sheet is transposed — energy sources run across the columns, with the criteria down the rows";
}
