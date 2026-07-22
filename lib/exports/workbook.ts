import ExcelJS from "exceljs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildExportMetadata,
  metadataLines,
  METADATA_ROW_COUNT,
  type ExportMetadata,
} from "@/lib/exports/metadata";
import { BINARY_LABELS, TRANSITION_STATE_LABELS, QUALITY_LABELS } from "@/lib/analytics/chart-data";

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
  "Assignment 1 Responses": [
    "Student ID", "Student name", "Question code", "Response value",
    "Response label", "Is final", "Submitted at", "Version",
  ],
  "Assignment 2 Responses": [
    "Student ID", "Student name", "Question code", "Response value",
    "Response label", "Is final", "Submitted at", "Version",
  ],
  "Question Mappings": [
    "Mapping ID", "Mapping name", "Version", "Mapping type", "Status",
    "Professor approved", "Common concept", "Energy source", "Criterion",
    "Comparison method", "A1 questions", "A2 questions", "Notes",
    "Contributes to analytics",
  ],
  "Response Transitions": [
    "Mapping name", "Mapping version", "Mapping type", "Energy source", "Criterion",
    "Student ID", "Student name", "A1 answer", "A2 answer", "Transition state",
    "Data quality",
  ],
  "Question Analytics": [
    "Assignment", "Question code", "Energy source", "Criterion", "Concept",
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
  for (const q of [...a1Questions, ...a2Questions]) {
    questionCode.set(q.id, q.external_question_code);
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

  return {
    metadata,
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

export async function buildWorkbook(data: WorkbookData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Classroom Opinion Analytics Platform";
  workbook.created = new Date(data.metadata.generatedAt);
  workbook.description = `${data.metadata.className} — generated ${data.metadata.generatedAt}`;

  for (const name of SHEET_NAMES) {
    const sheet = workbook.addWorksheet(name);
    writeSheet(sheet, name, data.metadata, data.sheets[name]);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
