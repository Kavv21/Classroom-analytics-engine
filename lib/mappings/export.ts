/**
 * Mapping export formatting — pure functions so the CSV shape is
 * unit-testable. The export deliberately includes EVERY mapping
 * (unapproved and rejected too): it is the professor's own record of the
 * whole mapping table, not an analytics surface.
 */

export interface MappingExportRow {
  id: string;
  version: number;
  mapping_name: string;
  mapping_type: string;
  mapping_status: string;
  professor_approved: boolean;
  common_concept: string | null;
  energy_source: string | null;
  criterion: string | null;
  comparison_method: string | null;
  professor_notes: string | null;
  assignment_1_question_codes: string[];
  assignment_2_question_codes: string[];
  /** Question wording, verbatim, in the same order as the code lists — the
   *  codes alone make an exported row unreadable away from the app. */
  assignment_1_questions: string[];
  assignment_2_questions: string[];
  previous_version_id: string | null;
  superseded_by_id: string | null;
  created_at: string;
  updated_at: string;
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

const CSV_COLUMNS: Array<[header: string, pick: (r: MappingExportRow) => string]> = [
  ["id", (r) => r.id],
  ["version", (r) => String(r.version)],
  ["mapping_name", (r) => r.mapping_name],
  ["mapping_type", (r) => r.mapping_type],
  ["mapping_status", (r) => r.mapping_status],
  ["professor_approved", (r) => String(r.professor_approved)],
  ["common_concept", (r) => r.common_concept ?? ""],
  ["energy_source", (r) => r.energy_source ?? ""],
  ["criterion", (r) => r.criterion ?? ""],
  ["comparison_method", (r) => r.comparison_method ?? ""],
  ["professor_notes", (r) => r.professor_notes ?? ""],
  // Wording before codes, so the readable column is the one a reader hits
  // first when scanning left to right.
  ["assignment_1_questions", (r) => r.assignment_1_questions.join("; ")],
  ["assignment_2_questions", (r) => r.assignment_2_questions.join("; ")],
  ["assignment_1_question_codes", (r) => r.assignment_1_question_codes.join("; ")],
  ["assignment_2_question_codes", (r) => r.assignment_2_question_codes.join("; ")],
  ["previous_version_id", (r) => r.previous_version_id ?? ""],
  ["superseded_by_id", (r) => r.superseded_by_id ?? ""],
  ["created_at", (r) => r.created_at],
  ["updated_at", (r) => r.updated_at],
];

export function mappingsToCsv(rows: MappingExportRow[]): string {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(",")];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map(([, pick]) => csvEscape(pick(row))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
