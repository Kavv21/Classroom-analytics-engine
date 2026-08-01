import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExportMetadata,
  metadataLines,
  METADATA_ROW_COUNT,
  type ExportMetadata,
} from "@/lib/exports/metadata";
import { BINARY_LABELS } from "@/lib/analytics/chart-data";
import {
  gatherResponseGrid,
  GRID_TOTAL_LABEL,
  orientationDescription,
  type ResponseGrid,
} from "@/lib/exports/response-grid";
import { questionLabel } from "@/lib/ui/question-label";

/**
 * The 10-sheet Excel export (spec Section 22).
 *
 * Boundary notes, because this is the widest data surface in the app:
 *
 *  - Every read goes through the CALLER'S Supabase client, so RLS decides
 *    what is visible. A professor exporting their class cannot reach
 *    another professor's class, whatever class id is supplied — and the
 *    route re-checks ownership before getting here.
 *  - Every analytics-bearing sheet reads a Phase 7 view, so aggregation
 *    happens in PostgreSQL and the workbook cannot drift from the screen.
 *  - Every sheet describes ONE assignment at a time. The Question Mappings,
 *    Response Transitions and Student Analytics sheets were removed with
 *    the question-mapping feature (migration 0022) — each was defined only
 *    over an approved mapping's paired answers.
 */

export const SHEET_NAMES = [
  "Students",
  "Assignment 1 Questions",
  "Assignment 2 Questions",
  "Assignment 1 Responses",
  "Assignment 2 Responses",
  "Question Analytics",
  "Import Validation",
] as const;

export type SheetName = (typeof SHEET_NAMES)[number];

/** Row index (1-based) of the column-header row on every sheet. */
export const HEADER_ROW = METADATA_ROW_COUNT + 2;
/** Row index (1-based) where data begins on every sheet. */
export const FIRST_DATA_ROW = HEADER_ROW + 1;

export const SHEET_HEADERS: Record<SheetName, string[]> = {
  Students: [
    "Student ID", "Full name", "Email", "Roll number", "Programme",
    "Year of study", "Section", "Active", "Enrolment status",
  ],
  "Assignment 1 Questions": [
    "Question code", "Question text", "Energy source", "Criterion", "Concept",
    "Label for 0", "Label for 1", "Display order", "Active",
  ],
  "Assignment 2 Questions": [
    "Question code", "Question text", "Energy source", "Criterion", "Concept",
    "Label for 0", "Label for 1", "Display order", "Active",
  ],
  // "Question" (the wording) leads "Question code" on every sheet that names
  // a question: a reader should never have to cross-reference a sheet to
  // learn what a row is about.
  "Assignment 1 Responses": [
    "Student ID", "Student name", "Question", "Question code", "Response value",
    "Response label", "Is final", "Submitted at", "Version",
  ],
  "Assignment 2 Responses": [
    "Student ID", "Student name", "Question", "Question code", "Response value",
    "Response label", "Is final", "Submitted at", "Version",
  ],
  "Question Analytics": [
    "Assignment", "Question", "Question code", "Energy source", "Criterion", "Concept",
    "Answered", `Count ${BINARY_LABELS.zero}`, `Count ${BINARY_LABELS.one}`,
    `% ${BINARY_LABELS.one}`, "Consensus", "Disagreement", "Binary entropy",
  ],
  "Import Validation": [
    "Import ID", "Import type", "Source filename", "Status", "Imported at",
    "Row number", "Row status", "Error message",
  ],
};

interface Row {
  [key: string]: unknown;
}

async function selectAll(
  supabase: SupabaseClient,
  table: string,
  build: (q: ReturnType<SupabaseClient["from"]>) => unknown
): Promise<Row[]> {
  const query = build(supabase.from(table)) as {
    then: (
      onfulfilled: (r: { data: Row[] | null; error: { message: string } | null }) => unknown
    ) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
  };
  const { data, error } = (await query) as unknown as {
    data: Row[] | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(`export: could not read ${table}: ${error.message}`);
  }
  return data ?? [];
}

export interface WorkbookData {
  metadata: ExportMetadata;
  sheets: Record<SheetName, Array<Array<string | number | null>>>;
  /**
   * The response-grid sheets (one per assignment), written separately from
   * the flat `sheets` map because they carry live SUM formulas and
   * conditional formatting rather than plain values.
   */
  grids: ResponseGrid[];
}

/** Sheet-name prefix for the added per-assignment grids. */
export const GRID_SHEET_PREFIX = "Grid — ";

/** Excel sheet names are capped at 31 characters and reject []:*?/\ */
export function gridSheetName(grid: ResponseGrid): string {
  const base = `${GRID_SHEET_PREFIX}A${grid.sequenceNumber}`;
  const suffix = grid.assignmentTitle.replace(/[[\]:*?/\\]/g, " ").trim();
  return `${base} ${suffix}`.slice(0, 31).trim();
}

function answerLabel(value: number | null): string {
  if (value === null || value === undefined) return "no answer";
  return value === 0 ? BINARY_LABELS.zero : BINARY_LABELS.one;
}

/**
 * Fetches every sheet's rows. Errors are surfaced with the table that
 * failed — never swallowed into an empty sheet, which would look like
 * "this class has no data" rather than "the export is broken".
 */
export async function gatherWorkbookData(
  supabase: SupabaseClient,
  options: { classId: string; className: string; generatedBy: string }
): Promise<WorkbookData> {
  const { classId } = options;

  const metadata = await buildExportMetadata(supabase, options);

  const assignments = (await selectAll(supabase, "assignments", (q) =>
    q.select("id, title, sequence_number").eq("class_id", classId).order("sequence_number")
  )) as Array<{ id: string; title: string; sequence_number: number }>;
  const a1 = assignments.find((a) => a.sequence_number === 1);
  const a2 = assignments.find((a) => a.sequence_number === 2);
  const assignmentTitle = (id: string) =>
    assignments.find((a) => a.id === id)?.title ?? id;

  const members = (await selectAll(supabase, "class_members", (q) =>
    q
      .select(
        "user_id, status, profiles(id, full_name, email, roll_number, programme, year_of_study, section, is_active)"
      )
      .eq("class_id", classId)
      .eq("member_role", "STUDENT")
  )) as Array<{
    user_id: string;
    status: string;
    profiles: {
      id: string;
      full_name: string | null;
      email: string;
      roll_number: string | null;
      programme: string | null;
      year_of_study: string | null;
      section: string | null;
      is_active: boolean;
    } | null;
  }>;

  const studentName = new Map<string, string>();
  for (const m of members) {
    if (m.profiles) studentName.set(m.user_id, m.profiles.full_name ?? m.profiles.email);
  }

  const questionsFor = async (assignmentId: string | undefined) =>
    assignmentId
      ? ((await selectAll(supabase, "questions", (q) =>
          q
            .select(
              "id, external_question_code, question_text, energy_source, criterion, concept, response_zero_label, response_one_label, display_order, is_active"
            )
            .eq("assignment_id", assignmentId)
            .order("display_order")
        )) as Array<{
          id: string;
          external_question_code: string;
          question_text: string;
          energy_source: string | null;
          criterion: string | null;
          concept: string | null;
          response_zero_label: string;
          response_one_label: string;
          display_order: number;
          is_active: boolean;
        }>)
      : [];

  const a1Questions = await questionsFor(a1?.id);
  const a2Questions = await questionsFor(a2?.id);
  const questionCode = new Map<string, string>();
  // The readable name for every question id, so no sheet has to identify a
  // row by its code alone.
  const questionName = new Map<string, string>();
  for (const q of [...a1Questions, ...a2Questions]) {
    questionCode.set(q.id, q.external_question_code);
    questionName.set(
      q.id,
      questionLabel({
        questionText: q.question_text,
        energySource: q.energy_source,
        criterion: q.criterion,
        code: q.external_question_code,
      })
    );
  }

  const responsesFor = async (assignmentId: string | undefined) =>
    assignmentId
      ? ((await selectAll(supabase, "responses", (q) =>
          q
            .select("student_id, question_id, response_value, is_final, submitted_at, version")
            .eq("assignment_id", assignmentId)
        )) as Array<{
          student_id: string;
          question_id: string;
          response_value: number | null;
          is_final: boolean;
          submitted_at: string | null;
          version: number;
        }>)
      : [];

  const a1Responses = await responsesFor(a1?.id);
  const a2Responses = await responsesFor(a2?.id);

  const questionAnalytics = (await selectAll(supabase, "question_response_summary", (q) =>
    q.select("*").eq("class_id", classId).order("external_question_code")
  )) as Array<{
    assignment_id: string;
    external_question_code: string;
    question_text: string;
    energy_source: string | null;
    criterion: string | null;
    concept: string | null;
    answered: number;
    zeros: number;
    ones: number;
    pct_one: number | null;
    consensus: number | null;
    disagreement: number | null;
    entropy: number | null;
  }>;

  const imports = (await selectAll(supabase, "imports", (q) =>
    q
      .select("id, import_type, source_filename, status, created_at")
      .eq("class_id", classId)
      .order("created_at")
  )) as Array<{
    id: string;
    import_type: string;
    source_filename: string;
    status: string;
    created_at: string;
  }>;

  const importRows =
    imports.length > 0
      ? ((await selectAll(supabase, "import_rows", (q) =>
          q
            .select("import_id, row_number, status, error_message")
            .in(
              "import_id",
              imports.map((i) => i.id)
            )
            .order("row_number")
        )) as Array<{
          import_id: string;
          row_number: number;
          status: string;
          error_message: string | null;
        }>)
      : [];

  const responseRows = (
    rows: typeof a1Responses
  ): Array<Array<string | number | null>> =>
    rows.map((r) => [
      r.student_id,
      studentName.get(r.student_id) ?? "—",
      questionName.get(r.question_id) ?? questionCode.get(r.question_id) ?? r.question_id,
      questionCode.get(r.question_id) ?? r.question_id,
      r.response_value,
      answerLabel(r.response_value),
      r.is_final ? "Yes" : "No",
      r.submitted_at,
      r.version,
    ]);

  const questionRows = (
    rows: typeof a1Questions
  ): Array<Array<string | number | null>> =>
    rows.map((q) => [
      q.external_question_code,
      q.question_text,
      q.energy_source,
      q.criterion,
      q.concept,
      q.response_zero_label,
      q.response_one_label,
      q.display_order,
      q.is_active ? "Yes" : "No",
    ]);

  // Added grid sheets — one per live assignment, built from the same
  // gatherResponseGrid the live /grid page uses so the two cannot diverge.
  // No student limit here: an export is a complete snapshot by definition.
  const grids: ResponseGrid[] = [];
  for (const assignment of [a1, a2]) {
    if (!assignment) continue;
    grids.push(await gatherResponseGrid(supabase, assignment.id));
  }

  return {
    metadata,
    grids,
    sheets: {
      Students: members.map((m) => [
        m.user_id,
        m.profiles?.full_name ?? null,
        m.profiles?.email ?? null,
        m.profiles?.roll_number ?? null,
        m.profiles?.programme ?? null,
        m.profiles?.year_of_study ?? null,
        m.profiles?.section ?? null,
        m.profiles?.is_active ? "Yes" : "No",
        m.status,
      ]),
      "Assignment 1 Questions": questionRows(a1Questions),
      "Assignment 2 Questions": questionRows(a2Questions),
      "Assignment 1 Responses": responseRows(a1Responses),
      "Assignment 2 Responses": responseRows(a2Responses),
      "Question Analytics": questionAnalytics.map((q) => [
        assignmentTitle(q.assignment_id),
        questionLabel({
          questionText: q.question_text,
          energySource: q.energy_source,
          criterion: q.criterion,
          code: q.external_question_code,
        }),
        q.external_question_code,
        q.energy_source,
        q.criterion,
        q.concept,
        q.answered,
        q.zeros,
        q.ones,
        q.pct_one,
        q.consensus,
        q.disagreement,
        q.entropy,
      ]),
      "Import Validation": importRows.map((r) => {
        const parent = imports.find((i) => i.id === r.import_id);
        return [
          r.import_id,
          parent?.import_type ?? null,
          parent?.source_filename ?? null,
          parent?.status ?? null,
          parent?.created_at ?? null,
          r.row_number,
          r.status,
          r.error_message,
        ];
      }),
    },
  };
}

/** Writes the provenance block, header row, and data onto one worksheet. */
function writeSheet(
  sheet: ExcelJS.Worksheet,
  name: SheetName,
  metadata: ExportMetadata,
  rows: Array<Array<string | number | null>>
) {
  const lines = metadataLines(metadata);
  lines.forEach(([key, value], i) => {
    const row = sheet.getRow(i + 1);
    row.getCell(1).value = key;
    row.getCell(2).value = value;
    row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(2).font = { size: 9 };
  });

  const headers = SHEET_HEADERS[name];
  const headerRow = sheet.getRow(HEADER_ROW);
  headers.forEach((header, i) => {
    headerRow.getCell(i + 1).value = header;
  });
  headerRow.font = { bold: true };
  headerRow.commit();

  rows.forEach((values, r) => {
    const row = sheet.getRow(FIRST_DATA_ROW + r);
    values.forEach((value, c) => {
      row.getCell(c + 1).value = value === undefined ? null : value;
    });
    row.commit();
  });

  sheet.getColumn(1).width = 26;
  for (let c = 2; c <= headers.length; c++) {
    sheet.getColumn(c).width = 20;
  }
  sheet.views = [{ state: "frozen", ySplit: HEADER_ROW }];
}

/**
 * The added per-assignment grid sheet: the SOURCE SPREADSHEET'S OWN GRID,
 * reproduced — same rows, same columns, same order as the file the
 * professor uploaded, with the totals row in the same place that file has
 * it (below the data for Assignment 1, above it for Assignment 2).
 *
 * Where a single student would have typed 0 or 1, the sheet carries one
 * number: the sum of every student's answer for that cell, which is the
 * count of students who answered 1.
 *
 * NO STUDENT ROWS. This sheet is aggregate-only — no names, no per-person
 * answers. An individual student's full submission lives on the per-student
 * profile page in the app, which is the one surface that shows it.
 *
 * Four things here are deliberate:
 *
 *  - THE TOTAL ROW IS REAL FORMULAS, `=SUM(B20:B34)` straight down each
 *    column, not baked-in numbers — whichever end of the grid it sits at. A
 *    professor who corrects a cell sees the totals move, which is the whole
 *    point of handing them a spreadsheet rather than a picture. (The cells
 *    themselves are already-aggregated counts from the database — there are
 *    no per-student rows left underneath them, so a formula there would only
 *    sum an empty range.)
 *  - THE GEOMETRY MIRRORS THE SOURCE SHEET (see response-grid.ts's
 *    `buildGridMatrix`), which is why Assignment 1 comes out 15 sources x 2
 *    criteria with its totals last and Assignment 2 comes out 17 criteria x
 *    15 sources with its totals first, from one orientation rule.
 *  - IT IS A SNAPSHOT AND SAYS SO. An .xlsx cannot re-query this database;
 *    the header block states the generation time and says plainly that the
 *    file will not update itself.
 *  - NEITHER ANSWER IS SHADED AS BETTER. The colour scale runs across the
 *    per-cell counts, never over an answer value.
 *
 * Question wording and question codes are NOT repeated here — the grid is
 * the source file's grid, and the "Assignment N Questions" sheet already
 * carries every question's verbatim text against its code and source cell.
 *
 * No native Excel chart is written. ExcelJS's chart support is partial and
 * a malformed chart part makes the whole workbook unopenable — a far worse
 * outcome than not having a chart. The header points at the PNG/PDF export
 * routes, which render real charts.
 */
function writeGridSheet(
  sheet: ExcelJS.Worksheet,
  grid: ResponseGrid,
  metadata: ExportMetadata
): void {
  const { matrix } = grid;
  const columnAxisName = matrix.rowAxis === "ENERGY_SOURCE" ? "criteria" : "energy sources";

  const notes: Array<[string, string]> = [
    ["Sheet", `Response totals — ${grid.assignmentTitle}`],
    ["Assignment", `${grid.assignmentTitle} (sequence ${grid.sequenceNumber})`],
    ["Source worksheet", grid.worksheet ?? "—"],
    ["Layout", orientationDescription(grid.orientation)],
    ["Generated at", grid.generatedAt],
    [
      "What this sheet shows",
      "The source spreadsheet's own grid, cell for cell. Where one student would have entered " +
        "0 or 1, this shows the sum of every student's answer for that cell — the number of " +
        "students who answered 1. It holds no individual student rows; a single student's full " +
        "submission is on their profile page in the app. Question wording and codes are on the " +
        "Assignment " +
        String(grid.sequenceNumber) +
        " Questions sheet.",
    ],
    [
      "POINT-IN-TIME SNAPSHOT",
      "This file cannot refresh itself. It shows the responses as they were at the " +
        "generation time above. Download it again after new submissions to see them.",
    ],
    [
      "Live version",
      `The same grid updates on every page load at /classes/${grid.classId}/assignments/${grid.assignmentId}/grid`,
    ],
    [
      "Charts",
      "This sheet carries no chart. Use the PNG/PDF export buttons on the analytics pages for charts.",
    ],
    ["Class", metadata.className],
    ["Questions", String(grid.columns.length)],
    ["Grid size", `${matrix.rows.length} rows x ${matrix.columns.length} columns`],
    ["Students enrolled", String(grid.totalStudentCount)],
    ["Of which synthetic", String(grid.syntheticStudentCount)],
    ["Notes", metadata.notes.join(" ")],
  ];

  notes.forEach(([key, value], i) => {
    const row = sheet.getRow(i + 1);
    row.getCell(1).value = key;
    row.getCell(2).value = value;
    row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(2).font = { size: 9 };
    row.commit();
  });

  // ---- the grid itself -----------------------------------------------------
  // One header row of column labels, then one row per source row, then the
  // TOTAL row. Nothing between them: this is the original sheet's shape.
  const headerRowNumber = notes.length + 2;
  const headerRow = sheet.getRow(headerRowNumber);
  headerRow.getCell(1).value = matrix.rowAxisHeading;
  headerRow.getCell(1).font = { bold: true };
  headerRow.height = 30;
  matrix.columns.forEach((column, ci) => {
    const cell = headerRow.getCell(ci + 2);
    cell.value = column.label;
    cell.font = { bold: true };
    cell.alignment = { wrapText: true, vertical: "bottom", horizontal: "center" };
  });
  headerRow.commit();

  // The totals row goes where the SOURCE FILE puts it — below the data for
  // Assignment 1, above it for Assignment 2 — so the two blocks swap places
  // rather than the grid being reshaped. `matrix.totalsPosition` decides;
  // nothing here re-derives it.
  const totalsOnTop = matrix.totalsPosition === "TOP";
  const totalRowNumber = totalsOnTop ? headerRowNumber + 1 : headerRowNumber + 1 + matrix.rows.length;
  const firstGridRow = totalsOnTop ? headerRowNumber + 2 : headerRowNumber + 1;
  const lastGridRow = firstGridRow + matrix.rows.length - 1;

  matrix.rows.forEach((row, ri) => {
    const sheetRow = sheet.getRow(firstGridRow + ri);
    sheetRow.getCell(1).value = row.label;
    row.cells.forEach((cell, ci) => {
      sheetRow.getCell(ci + 2).value = cell?.total ?? null;
      sheetRow.getCell(ci + 2).alignment = { horizontal: "center" };
    });
    sheetRow.commit();
  });

  // ---- the TOTAL row, as live SUM formulas --------------------------------
  // Straight down each column over the data rows, so the row recomputes if a
  // professor edits anything in the grid. When the row sits on top the range
  // simply points forward at the rows beneath it — an ordinary Excel
  // reference, and not circular, because the totals row is never inside it.
  if (matrix.rows.length > 0) {
    const totalRow = sheet.getRow(totalRowNumber);
    totalRow.getCell(1).value = GRID_TOTAL_LABEL;
    matrix.columns.forEach((_column, ci) => {
      const letter = colLetter(ci + 2);
      const cell = totalRow.getCell(ci + 2);
      cell.value = { formula: `SUM(${letter}${firstGridRow}:${letter}${lastGridRow})` };
      cell.alignment = { horizontal: "center" };
    });
    for (let c = 1; c <= matrix.columns.length + 1; c++) totalRow.getCell(c).font = { bold: true };
    totalRow.border = totalsOnTop ? { bottom: { style: "thin" } } : { top: { style: "thin" } };
    totalRow.commit();

    // Conditional formatting across the grid body only: a 3-colour scale over
    // the per-cell counts, so which cells drew the most and fewest "1"
    // answers is visible at a glance. Applied to counts rather than to answer
    // values on purpose — shading an answer would make one of the two look
    // better than the other, which this platform does not do. The TOTAL row
    // is left out so its larger numbers do not flatten the scale.
    if (matrix.columns.length > 0) {
      const lastLetter = colLetter(matrix.columns.length + 1);
      sheet.addConditionalFormatting({
        ref: `B${firstGridRow}:${lastLetter}${lastGridRow}`,
        rules: [
          {
            type: "colorScale",
            priority: 1,
            cfvo: [{ type: "min" }, { type: "percentile", value: 50 }, { type: "max" }],
            color: [
              { argb: "FFF3F6FB" },
              { argb: "FF9EC5F4" },
              { argb: "FF2A78D6" },
            ],
          },
        ],
      });
    }
  }

  // Questions that collided on one source cell are named rather than dropped.
  let nextRow = Math.max(lastGridRow, totalRowNumber) + 2;
  if (matrix.unplaced.length > 0) {
    const row = sheet.getRow(nextRow);
    row.getCell(1).value = "Not placed on the grid";
    row.getCell(1).font = { bold: true, size: 9 };
    row.getCell(2).value =
      `${matrix.unplaced.length} question(s) share a source cell with another question and are ` +
      "not shown above or counted in TOTAL: " +
      matrix.unplaced.map((c) => `${c.code} (${c.originalCell})`).join(", ");
    row.getCell(2).font = { size: 9 };
    row.commit();
    nextRow += 1;
  }

  const footer = sheet.getRow(nextRow);
  footer.getCell(1).value = "How to read this";
  footer.getCell(1).font = { bold: true, size: 9 };
  footer.getCell(2).value =
    "Each cell is the sum of every student's answer for that cell — the number of students who " +
    "answered 1. 0 and 1 are the two options and neither is a preferred answer. A blank cell " +
    "means no answers have been recorded there yet, and a student who left a cell blank counts " +
    `in neither figure. The TOTAL row is a live SUM down each of the ${matrix.columns.length} ` +
    `${columnAxisName} columns, so it recalculates if anything in the grid is edited. It sits ` +
    `${totalsOnTop ? "above" : "below"} the data because that is where this assignment's own ` +
    "source spreadsheet puts it.";
  footer.getCell(2).font = { size: 9 };
  footer.commit();

  sheet.getColumn(1).width = 32;
  for (let c = 2; c <= Math.max(6, matrix.columns.length + 1); c++) sheet.getColumn(c).width = 14;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowNumber }];
}

/** 1-based column index → spreadsheet letters (1 → A, 27 → AA). */
function colLetter(index: number): string {
  let n = index;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export async function buildWorkbook(data: WorkbookData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "EVALUATING ENERGY SOURCES";
  workbook.created = new Date(data.metadata.generatedAt);
  workbook.description = `${data.metadata.className} — generated ${data.metadata.generatedAt}`;

  // The original ten sheets are written exactly as before — the grids are
  // ADDED sheets and change nothing about the question/response sheets.
  for (const name of SHEET_NAMES) {
    const sheet = workbook.addWorksheet(name);
    writeSheet(sheet, name, data.metadata, data.sheets[name]);
  }

  for (const grid of data.grids) {
    const sheet = workbook.addWorksheet(gridSheetName(grid));
    writeGridSheet(sheet, grid, data.metadata);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
