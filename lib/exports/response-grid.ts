import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The response grid: the ORIGINAL spreadsheet's own grid, cell for cell,
 * with each answer cell carrying ONE NUMBER — the sum of every student's
 * 0/1 answer for that cell, i.e. how many students answered 1.
 *
 * The shape is the source file's shape, not a redesigned summary. Assignment
 * 1's sheet lists 15 energy sources down the rows against 2 criteria across
 * the columns, and closes with a TOTAL row BELOW them (its own blank "TOTAL"
 * at C21); the grid here is 15 rows x 2 columns with that same closing row.
 * Assignment 2's sheet is transposed — 17 criteria down the rows against 15
 * energy sources across the columns — and puts its totals row ABOVE the data
 * ("Total score" at C6), so the grid does too, giving one grand total per
 * energy source at the top.
 *
 * That divergence is deliberate: each assignment's totals row goes exactly
 * where its own source file has it. It is not a second rule to keep in
 * step, though — the position falls out of `detectOrientation`'s existing
 * SOURCES_IN_ROWS / SOURCES_IN_COLUMNS answer, the same distinction
 * lib/imports/parse-grid.ts makes at import time. See
 * `defaultTotalsPosition`.
 *
 * THIS VIEW IS AGGREGATE-ONLY. It holds no student rows, no names, and no
 * individual answers. Every cell is a class total. An individual student's
 * full submission lives on the per-student profile page
 * (/classes/:id/analytics/students/:studentId), which is the one surface
 * that shows raw per-person answers.
 *
 * ONE SOURCE FOR TWO SURFACES. The Excel sheet (lib/exports/workbook.ts)
 * and the live page (/classes/:id/assignments/:id/grid) both call
 * `gatherResponseGrid`. Neither computes its own layout, ordering or
 * totals, so the downloaded snapshot and the live screen cannot drift into
 * showing different things.
 *
 * EVERY NUMBER COMES FROM A DATABASE VIEW. `question_response_summary`
 * (migration 0012) counts 0s, 1s and respondents per question over final
 * responses of active student members — .claude/rules/analytics.md requires
 * aggregates to be computed in PostgreSQL rather than by looping in app
 * memory. Using it here also means the numbers on this grid are the same
 * numbers the rest of analytics uses.
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
  /** Source-workbook row number, e.g. "6". Drives the grid's row axis. */
  originalRow: string | null;
  /** Source-workbook column letters, e.g. "D". Drives the grid's column axis. */
  originalColumn: string | null;
  /** Students answering "1". Null when the question has no summary row. */
  ones: number | null;
  /** Students answering "0". */
  zeros: number | null;
  /** Students with a non-blank final answer to this question. */
  answered: number | null;
}

/** Which of the two axes the energy sources run down. */
export type GridRowAxis = "ENERGY_SOURCE" | "CRITERION";

/** Where the source file puts its totals row, relative to the data rows. */
export type GridTotalsPosition = "TOP" | "BOTTOM";

/**
 * One answer cell of the reproduced grid. `total` is the number shown: a
 * student would have typed 0 or 1 here, so the class figure is the sum of
 * those answers — which is exactly the count of students who answered 1.
 */
export interface GridMatrixCell {
  questionId: string;
  code: string;
  questionText: string | null;
  energySource: string;
  criterion: string;
  originalCell: string;
  /** SUM(response_value) over the class. Null when nobody has answered. */
  total: number | null;
  /** Students with a non-blank answer, for the "N of M" reading. */
  answered: number | null;
}

export interface GridMatrixRow {
  /** Left-hand label: the energy source (A1) or the criterion (A2). */
  label: string;
  /** The source workbook's own row number for this row. */
  originalRow: string;
  /** One entry per column, in `columns` order. Null where the source grid
   *  has no question at that intersection. */
  cells: Array<GridMatrixCell | null>;
}

export interface GridMatrixColumn {
  /** Top label: the criterion (A1) or the energy source (A2). */
  label: string;
  /** The source workbook's own column letters for this column. */
  originalColumn: string;
}

/**
 * The source spreadsheet's grid, reproduced.
 *
 * Rows and columns are placed by the questions' stored
 * `original_row_reference` / `original_column_reference`, so the order is
 * the source file's order rather than anything this app chose. The row and
 * column LABELS are picked by orientation: whichever of energy source /
 * criterion is constant along a row labels that row.
 */
export interface GridMatrix {
  rowAxis: GridRowAxis;
  /** Heading over the label column. */
  rowAxisHeading: string;
  columns: GridMatrixColumn[];
  rows: GridMatrixRow[];
  /**
   * One grand total per column, summing straight down every data row — the
   * source sheet's own totals row. Null for a column where no question has
   * been answered at all, so an untouched column reads as "—" rather than
   * as a real zero.
   */
  columnTotals: Array<number | null>;
  /**
   * Where that row goes: BELOW the data for Assignment 1, ABOVE it for
   * Assignment 2, matching each source file. Both surfaces read this rather
   * than deciding for themselves.
   */
  totalsPosition: GridTotalsPosition;
  /**
   * Questions that could not be placed because another question already
   * occupies their source cell. Should always be empty; surfaced rather
   * than dropped so a data problem is visible instead of silent.
   */
  unplaced: GridMatrixCell[];
}

export interface ResponseGrid {
  assignmentId: string;
  assignmentTitle: string;
  sequenceNumber: number;
  classId: string;
  orientation: GridOrientation;
  worksheet: string | null;
  /** Every question, ordered as the source sheet reads. The per-cell counts
   *  that `matrix` lays out. */
  columns: GridColumn[];
  /** The source spreadsheet's grid, reproduced, with a TOTAL row. */
  matrix: GridMatrix;
  energySourceCount: number;
  criterionCount: number;
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

/** The label on the reproduced TOTAL row — the source sheets' own word. */
export const GRID_TOTAL_LABEL = "TOTAL";

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
 * Where a sheet of this orientation puts its totals row.
 *
 * Assignment 1 (sources down the rows) closes with a blank "TOTAL" row at
 * C21, BELOW its 15 source rows. Assignment 2 (sources across the columns)
 * carries "Total score" at C6, ABOVE its 17 criterion rows. Both are the
 * source files' own choices, and both are recovered from the orientation
 * `detectOrientation` already reports rather than from a second rule.
 */
export function defaultTotalsPosition(orientation: GridOrientation): GridTotalsPosition {
  return orientation === "SOURCES_IN_COLUMNS" ? "TOP" : "BOTTOM";
}

/**
 * Lay the per-question counts back out as the source spreadsheet's own grid.
 *
 * Placement uses the questions' stored source-cell references, so the rows,
 * the columns and their order are the original file's, not this app's. The
 * only orientation-dependent decisions are which of energy source /
 * criterion labels which axis, and where the totals row sits — and both
 * reuse `detectOrientation`'s answer rather than inventing a second rule,
 * so both assignments work through one path.
 *
 * `totalsPosition` is a parameter so a caller can override it for a source
 * file that puts its totals somewhere else; left alone it follows the
 * orientation, which is what both real assignments need.
 *
 * The totals row sums straight down each column, which is what the source
 * sheets' own totals row does — above or below the data, the arithmetic is
 * the same.
 */
export function buildGridMatrix(
  columns: GridColumn[],
  orientation: GridOrientation,
  totalsPosition: GridTotalsPosition = defaultTotalsPosition(orientation)
): GridMatrix {
  const sourcesInRows = orientation === "SOURCES_IN_ROWS";
  const rowAxis: GridRowAxis = sourcesInRows ? "ENERGY_SOURCE" : "CRITERION";

  const rowKeys: number[] = [];
  const colKeys: number[] = [];
  const rowRefs = new Map<number, string>();
  const colRefs = new Map<number, string>();
  const rowLabels = new Map<number, string>();
  const colLabels = new Map<number, string>();
  const placed = new Map<string, GridMatrixCell>();
  const unplaced: GridMatrixCell[] = [];

  for (const column of columns) {
    const cell: GridMatrixCell = {
      questionId: column.questionId,
      code: column.code,
      questionText: column.questionText,
      energySource: column.energySource,
      criterion: column.criterion,
      originalCell: column.originalCell,
      total: column.ones,
      answered: column.answered,
    };

    const r = rowIndex(column.originalRow);
    const c = columnIndex(column.originalColumn);

    if (!rowRefs.has(r)) {
      rowKeys.push(r);
      rowRefs.set(r, column.originalRow?.trim() || "—");
      rowLabels.set(r, sourcesInRows ? column.energySource : column.criterion);
    }
    if (!colRefs.has(c)) {
      colKeys.push(c);
      colRefs.set(c, column.originalColumn?.trim() || "—");
      colLabels.set(c, sourcesInRows ? column.criterion : column.energySource);
    }

    const at = `${r}:${c}`;
    if (placed.has(at)) unplaced.push(cell);
    else placed.set(at, cell);
  }

  rowKeys.sort((a, b) => a - b);
  colKeys.sort((a, b) => a - b);

  const rows: GridMatrixRow[] = rowKeys.map((r) => ({
    label: rowLabels.get(r)!,
    originalRow: rowRefs.get(r)!,
    cells: colKeys.map((c) => placed.get(`${r}:${c}`) ?? null),
  }));

  const columnTotals = colKeys.map((_c, ci) => {
    let total: number | null = null;
    for (const row of rows) {
      const value = row.cells[ci]?.total;
      if (value === null || value === undefined) continue;
      total = (total ?? 0) + value;
    }
    return total;
  });

  return {
    rowAxis,
    rowAxisHeading: sourcesInRows ? "Energy source" : "Criterion",
    columns: colKeys.map((c) => ({ label: colLabels.get(c)!, originalColumn: colRefs.get(c)! })),
    rows,
    columnTotals,
    totalsPosition,
    unplaced,
  };
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
      originalRow: q.original_row_reference,
      originalColumn: q.original_column_reference,
      ones: summary?.ones ?? null,
      zeros: summary?.zeros ?? null,
      answered: summary?.answered ?? null,
    };
  });

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
    matrix: buildGridMatrix(columns, orientation),
    energySourceCount: new Set(columns.map((c) => c.energySource)).size,
    criterionCount: new Set(columns.map((c) => c.criterion)).size,
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
