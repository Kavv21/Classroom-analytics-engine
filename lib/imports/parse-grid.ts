import * as XLSX from "xlsx";

/**
 * General spreadsheet → question-grid parser, generalising the Phase 1
 * extraction that produced /data/assignment-1-manifest.json and
 * /data/assignment-2-manifest.json. The unit tests assert byte-for-byte
 * parity between this parser's output on /source-assignments/*.xlsx and
 * those manifests — question wording is always the verbatim
 * `${energySource} — ${criterion}` concatenation of cell values, never
 * invented or normalised (CLAUDE.md rule 1).
 *
 * Two supported layouts, auto-detected:
 *  - SOURCES_IN_ROWS (assignment 1): a numbered column of energy sources,
 *    criteria as header cells to the right of the source-name column.
 *  - SOURCES_IN_COLUMNS (assignment 2): a numbered row of energy sources
 *    across columns, a numbered column of criteria down rows.
 *
 * Malformed rows (an index with no name, a name with no index, a break in
 *  the numbering, duplicate names) are collected as row-level errors —
 * the import pipeline refuses to commit while any exist. Nothing is
 * silently skipped (spec section 23: "Never partially import silently").
 */

export const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_QUESTIONS = 2000;

export class GridFileTooLargeError extends Error {}
export class GridFileFormatError extends Error {}

export interface ParsedGridQuestion {
  rowNumber: number;
  externalQuestionCode: string;
  originalRowReference: string;
  originalColumnReference: string;
  questionText: string;
  energySource: string;
  criterion: string;
  responseZeroLabel: string;
  responseOneLabel: string;
  displayOrder: number;
}

export interface GridRowError {
  /** Cell or row/column reference, e.g. "C12" or "row 12". */
  location: string;
  message: string;
}

/** A cell inside the answer grid that should be blank but isn't (e.g. a
 * template shipped with a pre-filled mark). Warning, not an error. */
export interface GridAnomaly {
  cell: string;
  value: unknown;
}

export interface GridParseResult {
  worksheet: string;
  worksheets: string[];
  emptyWorksheets: string[];
  orientation: "SOURCES_IN_ROWS" | "SOURCES_IN_COLUMNS";
  responseZeroLabel: string;
  responseOneLabel: string;
  /** Whether the labels were detected from header text or defaulted. */
  labelsDetected: boolean;
  sources: string[];
  criteria: string[];
  questions: ParsedGridQuestion[];
  errors: GridRowError[];
  anomalies: GridAnomaly[];
}

type Matrix = Map<string, unknown>; // "r:c" (0-based) -> raw cell value

interface Run {
  /** 0-based fixed axis index (column index for a vertical run, row index
   * for a horizontal run). */
  axis: number;
  /** 0-based start position along the run. */
  start: number;
  length: number;
}

function key(r: number, c: number): string {
  return `${r}:${c}`;
}

function cellRef(r: number, c: number): string {
  return `${XLSX.utils.encode_col(c)}${r + 1}`;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function asInteger(v: unknown): number | null {
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  return null;
}

function toMatrix(sheet: XLSX.WorkSheet): { matrix: Matrix; rows: number; cols: number } {
  const matrix: Matrix = new Map();
  if (!sheet["!ref"]) return { matrix, rows: 0, cols: 0 };
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  for (let r = range.s.r; r <= range.e.r; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== undefined) matrix.set(key(r, c), cell.v);
    }
  }

  // Merged-cell handling: every cell of a merged range sees the anchor's
  // value, so headers spanning merges still resolve.
  for (const merge of sheet["!merges"] ?? []) {
    const anchor = matrix.get(key(merge.s.r, merge.s.c));
    if (anchor === undefined) continue;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        if (!matrix.has(key(r, c))) matrix.set(key(r, c), anchor);
      }
    }
  }

  return { matrix, rows: range.e.r + 1, cols: range.e.c + 1 };
}

/** Longest run of consecutive integers 1,2,3,… down a column (vertical)
 * or across a row (horizontal). */
function findRun(
  matrix: Matrix,
  rows: number,
  cols: number,
  direction: "vertical" | "horizontal"
): Run | null {
  const axisMax = direction === "vertical" ? cols : rows;
  const posMax = direction === "vertical" ? rows : cols;
  let best: Run | null = null;

  for (let axis = 0; axis < axisMax; axis++) {
    for (let pos = 0; pos < posMax; pos++) {
      const at = (p: number) =>
        direction === "vertical" ? matrix.get(key(p, axis)) : matrix.get(key(axis, p));
      if (asInteger(at(pos)) !== 1) continue;
      let len = 1;
      while (pos + len < posMax && asInteger(at(pos + len)) === len + 1) len++;
      if (len >= 2 && (!best || len > best.length)) {
        best = { axis, start: pos, length: len };
      }
      pos += len - 1;
    }
  }
  return best;
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Detects response labels from header text: "Positive = 1", "Negative = 0",
 * or "Mark = 1 for YES and Zero for NO" style. */
function detectLabels(
  matrix: Matrix,
  headerRowLimit: number,
  cols: number
): { zero: string; one: string; detected: boolean } {
  let zero: string | null = null;
  let one: string | null = null;

  for (let r = 0; r < headerRowLimit; r++) {
    for (let c = 0; c < cols; c++) {
      const v = matrix.get(key(r, c));
      if (typeof v !== "string") continue;

      // "… 1 for YES … Zero for NO …" (word bound to the value via "for")
      const oneFor = v.match(/(?:^|[^0-9])1\s+for\s+([A-Za-z]+)/i)?.[1];
      const zeroFor = v.match(/(?:zero|0)\s+for\s+([A-Za-z]+)/i)?.[1];
      if (!one && oneFor) one = titleCase(oneFor);
      if (!zero && zeroFor) zero = titleCase(zeroFor);

      // "Positive = 1" / "Negative = 0"
      const oneEq = v.match(/([A-Za-z]+)\s*=\s*1(?!\d)/)?.[1];
      const zeroEq = v.match(/([A-Za-z]+)\s*=\s*0(?!\d)/)?.[1];
      if (!one && oneEq && !/for/i.test(v)) one = titleCase(oneEq);
      if (!zero && zeroEq && !/for/i.test(v)) zero = titleCase(zeroEq);
    }
  }

  const detected = !!(zero && one);
  return {
    zero: zero ? `${zero} (0)` : "No (0)",
    one: one ? `${one} (1)` : "Yes (1)",
    detected,
  };
}

interface AxisEntry {
  /** 0-based row (vertical axis) or column (horizontal axis) of the entry. */
  pos: number;
  label: string;
}

/** Reads labels adjacent to a numbered run and reports malformed entries.
 * Nothing is skipped silently: a blank label next to an index, an index
 * continuing after a break, or a label continuing past the numbering all
 * become row-level errors. */
function readAxis(
  matrix: Matrix,
  run: Run,
  direction: "vertical" | "horizontal",
  axisName: string,
  errors: GridRowError[]
): AxisEntry[] {
  const labelAxis = run.axis + 1; // labels immediately right of / below the numbers
  const at = (pos: number, axis: number) =>
    direction === "vertical" ? matrix.get(key(pos, axis)) : matrix.get(key(axis, pos));
  const refAt = (pos: number, axis: number) =>
    direction === "vertical" ? cellRef(pos, axis) : cellRef(axis, pos);

  const entries: AxisEntry[] = [];
  const seen = new Map<string, number>();

  for (let i = 0; i < run.length; i++) {
    const pos = run.start + i;
    const raw = at(pos, labelAxis);
    if (isBlank(raw)) {
      errors.push({
        location: refAt(pos, labelAxis),
        message: `${axisName} #${i + 1} has an index but no name — fix the cell or remove the row/column.`,
      });
      continue;
    }
    const label = String(raw);
    const norm = label.trim().toLowerCase();
    const firstAt = seen.get(norm);
    if (firstAt !== undefined) {
      errors.push({
        location: refAt(pos, labelAxis),
        message: `Duplicate ${axisName.toLowerCase()} "${label.trim()}" (already used at ${refAt(firstAt, labelAxis)}).`,
      });
      continue;
    }
    seen.set(norm, pos);
    entries.push({ pos, label });
  }

  // The entry immediately after the numbered run: numbering that resumes
  // (e.g. 1,2,4) or a name without an index would otherwise vanish silently.
  // A summary footer ("TOTAL", "Total score", …) is an expected part of the
  // template, not a malformed data row.
  const after = run.start + run.length;
  const afterNumber = asInteger(at(after, run.axis));
  let afterLabel = at(after, labelAxis);
  if (
    typeof afterLabel === "string" &&
    /^(grand\s+)?total(\s+score)?$|^sum$|^average$/i.test(afterLabel.trim())
  ) {
    afterLabel = null;
  }
  if (afterNumber !== null) {
    errors.push({
      location: refAt(after, run.axis),
      message: `${axisName} numbering is broken: expected ${run.length + 1} next but found ${afterNumber}.`,
    });
  } else if (!isBlank(afterLabel)) {
    errors.push({
      location: refAt(after, labelAxis),
      message: `"${String(afterLabel).trim()}" has no index number and would not be imported — fix the numbering or remove it.`,
    });
  }

  return entries;
}

export function listWorksheets(buffer: ArrayBuffer): { name: string; empty: boolean }[] {
  // Uint8Array, not ArrayBuffer: under jsdom (vitest) SheetJS's cross-realm
  // instanceof check misidentifies a Node ArrayBuffer and falls back to a
  // garbage single-sheet parse.
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    return { name, empty: !sheet || !sheet["!ref"] };
  });
}

export function parseGridWorkbook(
  buffer: ArrayBuffer,
  options: { codePrefix: string; worksheet?: string }
): GridParseResult {
  // Uint8Array, not ArrayBuffer: under jsdom (vitest) SheetJS's cross-realm
  // instanceof check misidentifies a Node ArrayBuffer and falls back to a
  // garbage single-sheet parse.
  const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" });
  const worksheets = workbook.SheetNames;
  const emptyWorksheets = worksheets.filter((n) => {
    const s = workbook.Sheets[n];
    return !s || !s["!ref"];
  });

  const worksheet =
    options.worksheet ?? worksheets.find((n) => !emptyWorksheets.includes(n));
  if (!worksheet || !workbook.Sheets[worksheet]) {
    throw new GridFileFormatError(
      options.worksheet
        ? `Worksheet "${options.worksheet}" does not exist in this file.`
        : "The file contains no non-empty worksheet."
    );
  }

  const { matrix, rows, cols } = toMatrix(workbook.Sheets[worksheet]);
  if (rows === 0) {
    throw new GridFileFormatError(`Worksheet "${worksheet}" is empty.`);
  }

  const vertical = findRun(matrix, rows, cols, "vertical");
  if (!vertical) {
    throw new GridFileFormatError(
      `Worksheet "${worksheet}" has no numbered list (a column counting 1, 2, 3, …). ` +
        "Expected the assignment-grid layout — see the two source assignments for reference."
    );
  }
  const horizontal = findRun(matrix, rows, cols, "horizontal");

  const errors: GridRowError[] = [];
  const anomalies: GridAnomaly[] = [];
  const questions: ParsedGridQuestion[] = [];

  let orientation: GridParseResult["orientation"];
  let sources: AxisEntry[];
  let criteria: AxisEntry[];
  /** Answer-grid geometry: every (gridRow, gridCol) pair is one question. */
  let gridRows: AxisEntry[];
  let gridCols: AxisEntry[];
  let sourceOf: (row: AxisEntry, col: AxisEntry) => AxisEntry;
  let criterionOf: (row: AxisEntry, col: AxisEntry) => AxisEntry;

  if (horizontal) {
    // Assignment-2 layout: sources across columns (labels in the row below
    // the numbers), criteria down rows (labels right of the numbers).
    orientation = "SOURCES_IN_COLUMNS";
    sources = readAxis(matrix, horizontal, "horizontal", "Energy source", errors);
    criteria = readAxis(matrix, vertical, "vertical", "Criterion", errors);
    gridRows = criteria;
    gridCols = sources;
    sourceOf = (_row, col) => col;
    criterionOf = (row) => row;
  } else {
    // Assignment-1 layout: sources down rows, criteria in the header row
    // directly above the first source, right of the source-name column.
    orientation = "SOURCES_IN_ROWS";
    sources = readAxis(matrix, vertical, "vertical", "Energy source", errors);

    const headerRow = vertical.start - 1;
    const labelCol = vertical.axis + 1;
    criteria = [];
    if (headerRow >= 0) {
      for (let c = labelCol + 1; c < cols; c++) {
        const v = matrix.get(key(headerRow, c));
        if (!isBlank(v)) criteria.push({ pos: c, label: String(v) });
      }
    }
    if (criteria.length === 0) {
      throw new GridFileFormatError(
        `Worksheet "${worksheet}": found the numbered energy-source list but no criteria header ` +
          `cells in row ${headerRow + 1} right of column ${XLSX.utils.encode_col(labelCol)}.`
      );
    }
    const dupes = new Map<string, number>();
    criteria = criteria.filter((entry) => {
      const norm = entry.label.trim().toLowerCase();
      const firstAt = dupes.get(norm);
      if (firstAt !== undefined) {
        errors.push({
          location: cellRef(headerRow, entry.pos),
          message: `Duplicate criterion "${entry.label.trim()}" (already used at ${cellRef(headerRow, firstAt)}).`,
        });
        return false;
      }
      dupes.set(norm, entry.pos);
      return true;
    });

    gridRows = sources;
    gridCols = criteria;
    sourceOf = (row) => row;
    criterionOf = (_row, col) => col;
  }

  // Response labels come from header text above the answer grid.
  const firstDataRow = Math.min(...gridRows.map((e) => e.pos));
  const labels = detectLabels(matrix, firstDataRow, cols);

  // Pre-filled cells inside the answer grid are anomalies (the template
  // should be blank), reported but not fatal.
  for (const row of gridRows) {
    for (const col of gridCols) {
      const v = matrix.get(key(row.pos, col.pos));
      if (!isBlank(v)) {
        anomalies.push({ cell: cellRef(row.pos, col.pos), value: v });
      }
    }
  }

  // Questions in row-major order over the answer grid — this reproduces the
  // manifest display_order for both source assignments.
  let order = 0;
  for (const row of gridRows) {
    for (const col of gridCols) {
      order++;
      const source = sourceOf(row, col);
      const criterion = criterionOf(row, col);
      questions.push({
        rowNumber: order,
        externalQuestionCode: `${options.codePrefix}-${String(order).padStart(3, "0")}`,
        originalRowReference: String(row.pos + 1),
        originalColumnReference: XLSX.utils.encode_col(col.pos),
        // Verbatim concatenation — labels are NOT trimmed, so the wording
        // matches the source cells exactly (including stray spaces).
        questionText: `${source.label} — ${criterion.label}`,
        energySource: source.label,
        criterion: criterion.label,
        responseZeroLabel: labels.zero,
        responseOneLabel: labels.one,
        displayOrder: order,
      });
    }
  }

  if (questions.length > MAX_IMPORT_QUESTIONS) {
    throw new GridFileTooLargeError(
      `File would create ${questions.length} questions (limit ${MAX_IMPORT_QUESTIONS}).`
    );
  }

  return {
    worksheet,
    worksheets,
    emptyWorksheets,
    orientation,
    responseZeroLabel: labels.zero,
    responseOneLabel: labels.one,
    labelsDetected: labels.detected,
    sources: sources.map((s) => s.label),
    criteria: criteria.map((c) => c.label),
    questions,
    errors,
    anomalies,
  };
}

export async function parseAssignmentFile(
  file: File,
  options: { codePrefix: string; worksheet?: string }
): Promise<GridParseResult> {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    throw new GridFileTooLargeError(
      `File is larger than ${MAX_IMPORT_FILE_BYTES / (1024 * 1024)}MB.`
    );
  }
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xls")) {
    throw new GridFileFormatError("Only .xlsx and .xls files are supported for assignment import.");
  }
  return parseGridWorkbook(await file.arrayBuffer(), options);
}
