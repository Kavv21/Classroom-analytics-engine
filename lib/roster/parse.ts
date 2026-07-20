import Papa from "papaparse";
import * as XLSX from "xlsx";

/** Safety limits for an uploaded roster file — professor-only, but still a
 * user-controlled upload, so cap both size and row count defensively. */
export const MAX_ROSTER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROSTER_ROWS = 5000;

export type RawRosterRow = Record<string, unknown>;

/** Maps every accepted header spelling to the canonical field name used by
 * lib/roster/validate.ts. Extend this map, don't add a second normalisation
 * path elsewhere. */
const HEADER_ALIASES: Record<string, string> = {
  email: "email",
  "email address": "email",
  "student email": "email",
  name: "fullName",
  "full name": "fullName",
  "student name": "fullName",
  "roll no": "rollNumber",
  "roll no.": "rollNumber",
  "roll number": "rollNumber",
  roll_number: "rollNumber",
  rollnumber: "rollNumber",
  programme: "programme",
  program: "programme",
  "year of study": "yearOfStudy",
  year: "yearOfStudy",
  year_of_study: "yearOfStudy",
  section: "section",
};

function normalizeHeader(header: string): string {
  const key = header.trim().toLowerCase();
  return HEADER_ALIASES[key] ?? header.trim();
}

function normalizeRowKeys(row: RawRosterRow): RawRosterRow {
  const normalized: RawRosterRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value;
  }
  return normalized;
}

function parseCsv(text: string): RawRosterRow[] {
  const result = Papa.parse<RawRosterRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: normalizeHeader,
  });
  return result.data;
}

function parseExcel(buffer: ArrayBuffer): RawRosterRow[] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<RawRosterRow>(sheet, { defval: "" });
  return rows.map(normalizeRowKeys);
}

export class RosterFileTooLargeError extends Error {}
export class RosterFileFormatError extends Error {}

export async function parseRosterFile(file: File): Promise<RawRosterRow[]> {
  if (file.size > MAX_ROSTER_FILE_BYTES) {
    throw new RosterFileTooLargeError(
      `File is larger than ${MAX_ROSTER_FILE_BYTES / (1024 * 1024)}MB.`
    );
  }

  const name = file.name.toLowerCase();
  let rows: RawRosterRow[];

  if (name.endsWith(".csv")) {
    rows = parseCsv(await file.text());
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    rows = parseExcel(await file.arrayBuffer());
  } else {
    throw new RosterFileFormatError("Only .csv, .xlsx, and .xls files are supported.");
  }

  if (rows.length > MAX_ROSTER_ROWS) {
    throw new RosterFileTooLargeError(`File has more than ${MAX_ROSTER_ROWS} rows.`);
  }

  return rows;
}
