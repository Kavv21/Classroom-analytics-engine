import Papa from "papaparse";
import * as XLSX from "xlsx";

/** Safety limits for an uploaded roster file — professor-only, but still a
 * user-controlled upload, so cap both size and row count defensively. */
export const MAX_ROSTER_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROSTER_ROWS = 5000;

export type RawRosterRow = Record<string, unknown>;

export type RosterField =
  | "fullName"
  | "rollNumber"
  | "email"
  | "programme"
  | "yearOfStudy"
  | "section";

export interface RosterFieldSpec {
  field: RosterField;
  /** Human label used in validation messages and UI copy. */
  label: string;
  /** Only name, enrollment number and email are required. Everything else is
   * imported opportunistically when the file happens to carry it. */
  required: boolean;
  /** Spellings quoted back to the professor when the column is missing. Kept
   * short so the message stays readable; `aliases` is the real matcher. */
  displayAliases: string[];
  /** Every accepted spelling. Compared after canonicalizeHeader(), so case,
   * padding, punctuation and separator differences need no entry here. */
  aliases: string[];
}

/**
 * The single source of truth for header matching. Extend a spec's `aliases`
 * rather than adding a second normalisation path elsewhere.
 *
 * Order matters only for headers claimed by more than one spec: the first
 * spec whose alias set contains a header wins, so ROSTER_FIELDS order
 * resolves overlap deterministically.
 */
export const ROSTER_FIELDS: readonly RosterFieldSpec[] = [
  {
    field: "fullName",
    label: "Name",
    required: true,
    displayAliases: ["Name", "Full Name", "Student Name"],
    aliases: [
      "name",
      "full name",
      "fullname",
      "student name",
      "name of student",
      "student full name",
      "full name of student",
      "candidate name",
      "participant name",
    ],
  },
  {
    field: "rollNumber",
    label: "Enrollment number",
    required: true,
    displayAliases: ["Enrollment Number", "Roll Number", "Student ID"],
    aliases: [
      "enrollment number",
      "enrolment number",
      "enrollment no",
      "enrolment no",
      "enrollment",
      "enrolment",
      "enrollment id",
      "enrolment id",
      "roll number",
      "rollnumber",
      "roll no",
      "roll",
      "student id",
      "studentid",
      "student number",
      "student no",
      "registration number",
      "registration no",
      "reg no",
      "reg number",
      "id",
      "id number",
    ],
  },
  {
    field: "email",
    label: "Email",
    required: true,
    displayAliases: ["Email", "Email Address", "Email ID"],
    aliases: [
      "email",
      "email address",
      "email id",
      "emailid",
      "e mail",
      "e mail address",
      "e mail id",
      "mail",
      "mail id",
      "gmail",
      "gmail address",
      "gmail id",
      "student email",
      "official email",
      "college email",
      "institute email",
    ],
  },
  {
    field: "programme",
    label: "Programme",
    required: false,
    displayAliases: ["Programme", "Program", "Course"],
    aliases: ["programme", "program", "course", "degree", "branch", "discipline", "stream"],
  },
  {
    field: "yearOfStudy",
    label: "Year of study",
    required: false,
    displayAliases: ["Year of Study", "Year"],
    aliases: ["year of study", "yearofstudy", "year", "study year", "academic year", "yr"],
  },
  {
    field: "section",
    label: "Section",
    required: false,
    displayAliases: ["Section"],
    aliases: ["section", "sec", "division", "div", "batch"],
  },
];

export const REQUIRED_ROSTER_FIELDS: readonly RosterFieldSpec[] = ROSTER_FIELDS.filter(
  (spec) => spec.required
);

/** Non-breaking / zero-width / exotic spaces that a spreadsheet export can
 * leave inside a header but a human can't see. */
const EXOTIC_SPACE = /[\u00a0\u1680\u2000-\u200b\u202f\u205f\u3000\ufeff]/g;
/** Punctuation used as a word separator in header text. */
const HEADER_PUNCTUATION = /[._\-/\\|(){}[\]<>#:;,*'"`]+/g;

/**
 * Folds the cosmetic differences between one institution's spreadsheet and
 * the next into a single comparable key: unicode compatibility forms,
 * invisible spaces, separator punctuation, casing, and repeated or
 * surrounding whitespace.
 *
 *   "Roll No."    → "roll no"
 *   "E-Mail_ID"   → "e mail id"
 *   "Full Name " → "full name"
 */
export function canonicalizeHeader(header: string): string {
  return header
    .normalize("NFKC")
    .replace(EXOTIC_SPACE, " ")
    .replace(HEADER_PUNCTUATION, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const ALIAS_TO_FIELD: ReadonlyMap<string, RosterField> = (() => {
  const map = new Map<string, RosterField>();
  for (const spec of ROSTER_FIELDS) {
    for (const alias of spec.aliases) {
      const key = canonicalizeHeader(alias);
      if (!map.has(key)) map.set(key, spec.field);
    }
  }
  return map;
})();

export function matchHeaderToField(header: string): RosterField | null {
  return ALIAS_TO_FIELD.get(canonicalizeHeader(header)) ?? null;
}

/**
 * Maps a header to its canonical field name, or leaves it alone when it
 * matches nothing. Unrecognised headers keep their original text so they
 * stay visible in the raw row (and so in the rejection report) rather than
 * silently vanishing.
 */
function normalizeHeader(header: string): string {
  return matchHeaderToField(header) ?? header.trim();
}

export interface RosterHeaderMapping {
  /** Header text as it appears in the file, in column order. */
  originalHeaders: string[];
  /** Fields the file actually supplies a column for. */
  presentFields: Set<RosterField>;
  /** Headers that matched no known field — reported, never silently dropped. */
  unmatchedHeaders: string[];
  /** Required fields with no matching column. */
  missingRequiredFields: RosterFieldSpec[];
}

export function buildHeaderMapping(headers: string[]): RosterHeaderMapping {
  const originalHeaders = headers.filter((header) => header.trim() !== "");
  const presentFields = new Set<RosterField>();
  const unmatchedHeaders: string[] = [];

  for (const header of originalHeaders) {
    const field = matchHeaderToField(header);
    if (field) presentFields.add(field);
    else unmatchedHeaders.push(header.trim());
  }

  return {
    originalHeaders,
    presentFields,
    unmatchedHeaders,
    missingRequiredFields: REQUIRED_ROSTER_FIELDS.filter(
      (spec) => !presentFields.has(spec.field)
    ),
  };
}

/** "Name column not found — expected one of: Name, Full Name, Student Name" */
export function missingColumnMessage(spec: RosterFieldSpec): string {
  return `${spec.label} column not found — expected one of: ${spec.displayAliases.join(", ")}`;
}

function normalizeRowKeys(row: RawRosterRow): RawRosterRow {
  const normalized: RawRosterRow = {};
  for (const [key, value] of Object.entries(row)) {
    normalized[normalizeHeader(key)] = value;
  }
  return normalized;
}

export interface ParsedRosterFile {
  rows: RawRosterRow[];
  mapping: RosterHeaderMapping;
}

function parseCsv(text: string): ParsedRosterFile {
  const originalHeaders: string[] = [];
  const result = Papa.parse<RawRosterRow>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => {
      originalHeaders.push(header);
      return normalizeHeader(header);
    },
  });
  return { rows: result.data, mapping: buildHeaderMapping(originalHeaders) };
}

function parseExcel(buffer: ArrayBuffer): ParsedRosterFile {
  const empty: ParsedRosterFile = { rows: [], mapping: buildHeaderMapping([]) };

  // Hand SheetJS a Uint8Array, not the raw ArrayBuffer: its `type: "array"`
  // branch identifies the input with `instanceof`, which silently fails for an
  // ArrayBuffer originating in another realm (File.arrayBuffer() under jsdom,
  // some edge/worker boundaries). On that path it falls back to parsing the
  // raw ZIP bytes as CSV and yields one garbage column.
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return empty;
  const sheet = workbook.Sheets[firstSheetName];
  if (!sheet) return empty;

  // Read the header row verbatim first: sheet_to_json's object form
  // de-duplicates and renames repeated keys, and the professor needs to see
  // their own column names quoted back when a match fails.
  const headerRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  const originalHeaders = (headerRows[0] ?? []).map((cell) =>
    cell === null || cell === undefined ? "" : String(cell)
  );

  const rows = XLSX.utils.sheet_to_json<RawRosterRow>(sheet, { defval: "" });
  return { rows: rows.map(normalizeRowKeys), mapping: buildHeaderMapping(originalHeaders) };
}

export class RosterFileTooLargeError extends Error {}
export class RosterFileFormatError extends Error {}

export async function parseRosterFile(file: File): Promise<ParsedRosterFile> {
  if (file.size > MAX_ROSTER_FILE_BYTES) {
    throw new RosterFileTooLargeError(
      `File is larger than ${MAX_ROSTER_FILE_BYTES / (1024 * 1024)}MB.`
    );
  }

  const name = file.name.toLowerCase();
  let parsed: ParsedRosterFile;

  if (name.endsWith(".csv")) {
    parsed = parseCsv(await file.text());
  } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
    parsed = parseExcel(await file.arrayBuffer());
  } else {
    throw new RosterFileFormatError("Only .csv, .xlsx, and .xls files are supported.");
  }

  if (parsed.rows.length > MAX_ROSTER_ROWS) {
    throw new RosterFileTooLargeError(`File has more than ${MAX_ROSTER_ROWS} rows.`);
  }

  return parsed;
}
