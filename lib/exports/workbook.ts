import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExportMetadata,
  metadataLines,
  METADATA_ROW_COUNT,
  type ExportMetadata,
} from "@/lib/exports/metadata";
import { BINARY_LABELS, TRANSITION_STATE_LABELS, QUALITY_LABELS } from "@/lib/analytics/chart-data";
import {
  gatherResponseGrid,
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
 *  - Analytics-bearing sheets (Response Transitions, Question Analytics,
 *    Student Analytics) read the approved-only views, so an unapproved
 *    mapping can never contribute a figure to this workbook.
 *  - The Question Mappings sheet is deliberately the professor's full
 *    inventory, including unapproved and rejected rows, carrying explicit
 *    `professor_approved` / `mapping_status` columns. That mirrors the
 *    Phase 6 mapping export: it is the professor's own record of their own
 *    class, not analytics output. The distinction that matters is that
 *    those rows contribute to no transition or analytic figure anywhere.
 */

export const SHEET_NAMES = [
  "Students",
  "Assignment 1 Questions",
  "Assignment 2 Questions",
  "Assignment 1 Responses",
  "Assignment 2 Responses",
  "Question Mappings",
  "Response Transitions",
  "Question Analytics",
  "Student Analytics",
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
  "Question Mappings": [
    "Mapping ID", "Mapping name", "Version", "Mapping type", "Status",
    "Professor approved", "Common concept", "Energy source", "Criterion",
    "Comparison method", "A1 questions", "A2 questions",
    "A1 question codes", "A2 question codes", "Notes",
    "Contributes to analytics",
  ],
  "Response Transitions": [
    "Mapping name", "Mapping version", "Mapping type", "Energy source", "Criterion",
    "Student ID", "Student name", "A1 answer", "A2 answer", "Transition state",
    "Data quality",
  ],
  "Question Analytics": [
    "Assignment", "Question", "Question code", "Energy source", "Criterion", "Concept",
    "Answered", `Count ${BINARY_LABELS.zero}`, `Count ${BINARY_LABELS.one}`,
    `% ${BINARY_LABELS.one}`, "Consensus", "Disagreement", "Binary entropy",
  ],
  "Student Analytics": [
    "Student ID", "Student name", "All pairs", "Valid pairs", "Changed", "Unchanged",
    "Change rate", "Stability rate", "Net movement toward 1 — Yes",
    "Percentage-point shift", "Missing A1", "Missing A2", "Missing both", "Not comparable",
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

  const mappings = (await selectAll(supabase, "question_mappings", (q) =>
    q
      .select(
        "id, mapping_name, version, mapping_type, mapping_status, professor_approved, common_concept, energy_source, criterion, comparison_method, professor_notes, assignment_1_question_ids, assignment_2_question_ids"
      )
      .eq("class_id", classId)
      .order("mapping_name")
  )) as Array<{
    id: string;
    mapping_name: string;
    version: number;
    mapping_type: string;
    mapping_status: string;
    professor_approved: boolean;
    common_concept: string | null;
    energy_source: string | null;
    criterion: string | null;
    comparison_method: string | null;
    professor_notes: string | null;
    assignment_1_question_ids: string[] | null;
    assignment_2_question_ids: string[] | null;
  }>;

  // Approved-only view: this is the analytics boundary.
  const transitions = (await selectAll(supabase, "response_transitions_live", (q) =>
    q.select("*").eq("class_id", classId).order("mapping_name")
  )) as Array<{
    mapping_name: string;
    mapping_version: number;
    mapping_type: string;
    energy_source: string | null;
    criterion: string | null;
    student_id: string;
    assignment_1_value: number | null;
    assignment_2_value: number | null;
    transition_state: string | null;
    data_quality_status: string | null;
  }>;

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

  const studentAnalytics = (await selectAll(supabase, "student_transition_summary", (q) =>
    q.select("*").eq("class_id", classId).order("student_id")
  )) as Array<{
    student_id: string;
    pairs_considered: number;
    valid_paired: number;
    changed_count: number;
    unchanged_count: number;
    change_rate: number | null;
    stability_rate: number | null;
    net_movement_toward_1: number;
    pct_point_shift: number | null;
    missing_a1: number;
    missing_a2: number;
    missing_both: number;
    not_comparable: number;
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
      "Question Mappings": mappings.map((m) => [
        m.id,
        m.mapping_name,
        m.version,
        m.mapping_type,
        m.mapping_status,
        m.professor_approved ? "Yes" : "No",
        m.common_concept,
        m.energy_source,
        m.criterion,
        m.comparison_method,
        (m.assignment_1_question_ids ?? []).map((id) => questionName.get(id) ?? id).join("; "),
        (m.assignment_2_question_ids ?? []).map((id) => questionName.get(id) ?? id).join("; "),
        (m.assignment_1_question_ids ?? []).map((id) => questionCode.get(id) ?? id).join("; "),
        (m.assignment_2_question_ids ?? []).map((id) => questionCode.get(id) ?? id).join("; "),
        m.professor_notes,
        m.professor_approved ? "Yes" : "No — inventory only, contributes to no figure",
      ]),
      "Response Transitions": transitions.map((t) => [
        t.mapping_name,
        t.mapping_version,
        t.mapping_type,
        t.energy_source,
        t.criterion,
        t.student_id,
        studentName.get(t.student_id) ?? "—",
        answerLabel(t.assignment_1_value),
        answerLabel(t.assignment_2_value),
        t.transition_state
          ? TRANSITION_STATE_LABELS[t.transition_state as keyof typeof TRANSITION_STATE_LABELS]
          : null,
        t.data_quality_status
          ? QUALITY_LABELS[t.data_quality_status.toLowerCase() as keyof typeof QUALITY_LABELS]
          : "Valid pair",
      ]),
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
      "Student Analytics": studentAnalytics.map((s) => [
        s.student_id,
        studentName.get(s.student_id) ?? "—",
        s.pairs_considered,
        s.valid_paired,
        s.changed_count,
        s.unchanged_count,
        s.change_rate,
        s.stability_rate,
        s.net_movement_toward_1,
        s.pct_point_shift,
        s.missing_a1,
        s.missing_a2,
        s.missing_both,
        s.not_comparable,
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
 * The added per-assignment grid sheet: the source spreadsheet's own layout,
 * carrying each question's ANSWER TOTALS and a rolled-up subtotal for every
 * energy-source group.
 *
 * NO STUDENT ROWS. This sheet is aggregate-only — no names, no per-person
 * answers. An individual student's full submission lives on the per-student
 * profile page in the app, which is the one surface that shows it.
 *
 * Four things here are deliberate:
 *
 *  - THE SUBTOTALS ARE REAL FORMULAS, `=SUM(B12:AE12)` across each energy
 *    source's own question columns, not baked-in numbers. A professor who
 *    corrects a question total sees every subtotal and the grand total move,
 *    which is the whole point of handing them a spreadsheet rather than a
 *    picture. (The per-question counts themselves are counts of student
 *    answers from the database — there are no rows left underneath them to
 *    sum, so a formula there would only ever sum an empty range.)
 *  - THE COLUMN ORDER MIRRORS THE SOURCE SHEET (see response-grid.ts), so
 *    the grid reads the way the original workbook does, each source's
 *    questions stay adjacent, and each column header carries its original
 *    cell reference.
 *  - IT IS A SNAPSHOT AND SAYS SO. An .xlsx cannot re-query this database;
 *    the header block states the generation time and says plainly that the
 *    file will not update itself.
 *  - NEITHER ANSWER IS SHADED AS BETTER. The colour scale runs across the
 *    question totals, never over an answer value.
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
  const notes: Array<[string, string]> = [
    ["Sheet", `Response totals — ${grid.assignmentTitle}`],
    ["Assignment", `${grid.assignmentTitle} (sequence ${grid.sequenceNumber})`],
    ["Source worksheet", grid.worksheet ?? "—"],
    ["Layout", orientationDescription(grid.orientation)],
    ["Generated at", grid.generatedAt],
    [
      "What this sheet shows",
      "Class totals per question, in the source spreadsheet's own column order, plus a " +
        "subtotal for each energy source. It holds no individual student rows — a single " +
        "student's full submission is on their profile page in the app.",
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

  // Stacked header rows so a column is identifiable by its energy source,
  // its criterion, its wording and its original cell — the grid is wide, and
  // a bare question code would make it unreadable (lib/ui/question-label.ts).
  const headerTop = notes.length + 2;
  const labelRows: Array<[string, (c: (typeof grid.columns)[number]) => string]> = [
    ["Energy source", (c) => c.energySource],
    ["Criterion", (c) => c.criterion],
    ["Question", (c) => c.questionText ?? ""],
    ["Original cell", (c) => c.originalCell],
    ["Question code", (c) => c.code],
  ];
  labelRows.forEach(([label, pick], i) => {
    const row = sheet.getRow(headerTop + i);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, size: 9 };
    grid.columns.forEach((c, ci) => {
      row.getCell(ci + 2).value = pick(c);
      row.getCell(ci + 2).font = { bold: i === 0, size: 9 };
      row.getCell(ci + 2).alignment = { textRotation: i === 0 ? 45 : 0, vertical: "bottom" };
    });
    row.commit();
  });

  // Three total rows, one per number, so a column stays six characters wide.
  const totalRows: Array<[string, (c: (typeof grid.columns)[number]) => number | null]> = [
    ['Total answering "1" (Yes)', (c) => c.ones],
    ['Total answering "0" (No)', (c) => c.zeros],
    ["Students who answered", (c) => c.answered],
  ];
  const firstTotalRow = headerTop + labelRows.length;
  totalRows.forEach(([label, pick], i) => {
    const row = sheet.getRow(firstTotalRow + i);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: i === 0 };
    grid.columns.forEach((c, ci) => {
      const cell = row.getCell(ci + 2);
      cell.value = pick(c);
      cell.font = { bold: i === 0 };
    });
    row.commit();
  });
  const onesRow = firstTotalRow;
  const zerosRow = firstTotalRow + 1;
  const answeredRow = firstTotalRow + 2;

  // Conditional formatting on the "1" totals row only: a 3-colour scale
  // across the question totals, so which energy sources drew the most and
  // fewest "1" answers is visible at a glance. Applied to the totals rather
  // than to answer values on purpose — shading an answer would make one of
  // the two look better than the other, which this platform does not do.
  if (grid.columns.length > 0) {
    const lastLetter = colLetter(grid.columns.length + 1);
    sheet.addConditionalFormatting({
      ref: `B${onesRow}:${lastLetter}${onesRow}`,
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

  // ---- energy-source subtotals, as live SUM formulas ----------------------
  // Each subtotal sums that source's own question columns on the rows above,
  // so the block recomputes if a professor edits a question total.
  const sumOver = (row: number, ranges: Array<[number, number]>) =>
    ranges
      .map(([from, to]) => `${colLetter(from + 2)}${row}:${colLetter(to + 2)}${row}`)
      .join(",");

  const subtotalTop = answeredRow + 2;
  const subtotalHeader = sheet.getRow(subtotalTop);
  // Wrapped, on a taller row: the subtotal block shares the question grid's
  // narrow columns, and a clipped header would be worse than a two-line one.
  subtotalHeader.height = 30;
  ["Energy source", "Questions", 'Answered "1"', 'Answered "0"', "Answers given", 'Share "1"'].forEach(
    (label, ci) => {
      const cell = subtotalHeader.getCell(ci + 1);
      cell.value = label;
      cell.font = { bold: true };
      cell.alignment = { wrapText: true, vertical: "bottom" };
    }
  );
  subtotalHeader.commit();

  grid.sourceSubtotals.forEach((subtotal, si) => {
    const r = subtotalTop + 1 + si;
    const row = sheet.getRow(r);
    row.getCell(1).value = subtotal.energySource;
    row.getCell(2).value = subtotal.questionCount;
    row.getCell(3).value = { formula: `SUM(${sumOver(onesRow, subtotal.columnRanges)})` };
    row.getCell(4).value = { formula: `SUM(${sumOver(zerosRow, subtotal.columnRanges)})` };
    row.getCell(5).value = { formula: `SUM(${sumOver(answeredRow, subtotal.columnRanges)})` };
    row.getCell(6).value = { formula: `IF(E${r}=0,"",C${r}/E${r})` };
    row.getCell(6).numFmt = "0.0%";
    row.commit();
  });

  const grandRow = subtotalTop + 1 + grid.sourceSubtotals.length;
  if (grid.columns.length > 0) {
    const lastLetter = colLetter(grid.columns.length + 1);
    const row = sheet.getRow(grandRow);
    row.getCell(1).value = "All energy sources";
    row.getCell(2).value = grid.columns.length;
    row.getCell(3).value = { formula: `SUM(B${onesRow}:${lastLetter}${onesRow})` };
    row.getCell(4).value = { formula: `SUM(B${zerosRow}:${lastLetter}${zerosRow})` };
    row.getCell(5).value = { formula: `SUM(B${answeredRow}:${lastLetter}${answeredRow})` };
    row.getCell(6).value = { formula: `IF(E${grandRow}=0,"",C${grandRow}/E${grandRow})` };
    row.getCell(6).numFmt = "0.0%";
    for (let c = 1; c <= 6; c++) row.getCell(c).font = { bold: true };
    row.commit();
  }

  const footer = sheet.getRow(grandRow + 2);
  footer.getCell(1).value = "How to read this";
  footer.getCell(1).font = { bold: true, size: 9 };
  footer.getCell(2).value =
    '0 and 1 are the two options — neither is a preferred answer. "Students who answered" counts ' +
    "students with a non-blank final answer to that question; a student who left it blank is in " +
    "neither total. The subtotal block below uses live SUM formulas over the question totals above.";
  footer.getCell(2).font = { size: 9 };
  footer.commit();

  sheet.getColumn(1).width = 32;
  for (let c = 2; c <= Math.max(6, grid.columns.length + 1); c++) sheet.getColumn(c).width = 9;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: answeredRow }];
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
