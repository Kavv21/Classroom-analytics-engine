import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook, gridSheetName, SHEET_NAMES, type WorkbookData } from "@/lib/exports/workbook";
import { NEUTRALITY_NOTE } from "@/lib/exports/metadata";
import { buildGridMatrix, type GridColumn, type ResponseGrid } from "@/lib/exports/response-grid";

/**
 * The added grid sheet is the SOURCE SPREADSHEET'S OWN GRID, it is
 * AGGREGATE-ONLY, and its TOTAL row is LIVE FORMULAS. All three are
 * contracts a reader relies on:
 *
 *  - the sheet must have the same rows and columns as the file the
 *    professor uploaded, with one number per answer cell;
 *  - a student's name or individual answer must never reach this sheet —
 *    that data lives on the per-student profile page and nowhere else;
 *  - the TOTAL row must be `SUM()` straight down each column, not baked-in
 *    numbers, so a professor who corrects a cell sees the totals move.
 *
 * All asserted against a reopened workbook — if ExcelJS can parse it, Excel
 * can open it.
 */

/** Assignment 1's shape: energy sources down rows 6-8, criteria in D and E. */
const column = (
  code: string,
  row: string,
  col: string,
  energySource: string,
  criterion: string,
  ones: number
): GridColumn => ({
  questionId: `q-${code}`,
  code,
  questionText: `${energySource} — ${criterion}`,
  energySource,
  criterion,
  originalCell: `${col}${row}`,
  originalRow: row,
  originalColumn: col,
  ones,
  zeros: 15 - ones,
  answered: 15,
});

const COLUMNS: GridColumn[] = [
  column("A1-001", "6", "D", "Solar", "Conventional", 10),
  column("A1-002", "6", "E", "Solar", "Renewable over 25 years", 8),
  column("A1-003", "7", "D", "Wind", "Conventional", 3),
  column("A1-004", "7", "E", "Wind", "Renewable over 25 years", 12),
  column("A1-005", "8", "D", "Hydro", "Conventional", 5),
  column("A1-006", "8", "E", "Hydro", "Renewable over 25 years", 9),
];

const GRID: ResponseGrid = {
  assignmentId: "assignment-1",
  assignmentTitle: "Energy sources — round 1",
  sequenceNumber: 1,
  classId: "class-1",
  orientation: "SOURCES_IN_ROWS",
  worksheet: "Sheet1",
  columns: COLUMNS,
  matrix: buildGridMatrix(COLUMNS, "SOURCES_IN_ROWS"),
  energySourceCount: 3,
  criterionCount: 2,
  totalStudentCount: 15,
  syntheticStudentCount: 15,
  generatedAt: "2026-01-01T00:00:00.000Z",
};

const DATA: WorkbookData = {
  metadata: {
    className: "Grid Sheet Class",
    assignmentNames: ["Energy sources — round 1"],
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatedBy: "professor@example.edu",
    activeFilters: ["None"],
    metricDefinitions: [],
    notes: [NEUTRALITY_NOTE],
  },
  // The other sheets are irrelevant here and stay empty; this test is only
  // about the added grid sheet.
  sheets: SHEET_NAMES.reduce(
    (acc, name) => ({ ...acc, [name]: [] }),
    {} as WorkbookData["sheets"]
  ),
  grids: [GRID],
};

async function openGridSheet(grid: ResponseGrid = GRID): Promise<ExcelJS.Worksheet> {
  const buffer = await buildWorkbook({ ...DATA, grids: [grid] });
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = reopened.getWorksheet(gridSheetName(grid));
  expect(sheet, "the grid sheet should exist").toBeTruthy();
  return sheet!;
}

/** Every cell value on the sheet, flattened to strings for scanning. */
function allText(sheet: ExcelJS.Worksheet): string[] {
  const out: string[] = [];
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      const v = cell.value;
      if (v === null || v === undefined) return;
      if (typeof v === "object" && "formula" in v) out.push(String(v.formula));
      else out.push(String(v));
    });
  });
  return out;
}

function rowsOf(sheet: ExcelJS.Worksheet): ExcelJS.Row[] {
  return sheet.getRows(1, sheet.rowCount) ?? [];
}

function findRow(sheet: ExcelJS.Worksheet, label: string): ExcelJS.Row {
  const row = rowsOf(sheet).find((r) => r.getCell(1).value === label);
  expect(row, `a row labelled "${label}" should exist`).toBeTruthy();
  return row!;
}

describe("the Excel grid sheet", () => {
  it("reproduces the source spreadsheet's grid, one number per answer cell", async () => {
    const sheet = await openGridSheet();

    // The header row is the source sheet's criteria, in the source order.
    const header = findRow(sheet, "Energy source");
    expect([2, 3].map((c) => header.getCell(c).value)).toEqual([
      "Conventional",
      "Renewable over 25 years",
    ]);

    // One row per energy source, in the source order, each carrying the
    // count of students who answered 1 for that source/criterion cell.
    for (const [label, conventional, renewable] of [
      ["Solar", 10, 8],
      ["Wind", 3, 12],
      ["Hydro", 5, 9],
    ] as const) {
      const row = findRow(sheet, label);
      expect([2, 3].map((c) => row.getCell(c).value), label).toEqual([conventional, renewable]);
    }

    // The rows sit directly under the header, with nothing in between.
    expect(findRow(sheet, "Solar").number).toBe(header.number + 1);
    expect(findRow(sheet, "Hydro").number).toBe(header.number + 3);
  }, 30_000);

  it("closes Assignment 1 with a TOTAL row of live SUM formulas down each column", async () => {
    const sheet = await openGridSheet();
    const firstGridRow = findRow(sheet, "Solar").number;
    const lastGridRow = findRow(sheet, "Hydro").number;

    const total = findRow(sheet, "TOTAL");
    // At the very bottom of the grid, where Assignment 1's own source file
    // has its blank "TOTAL" at C21.
    expect(total.number).toBe(lastGridRow + 1);
    expect(total.getCell(2).value).toEqual({
      formula: `SUM(B${firstGridRow}:B${lastGridRow})`,
    });
    expect(total.getCell(3).value).toEqual({
      formula: `SUM(C${firstGridRow}:C${lastGridRow})`,
    });
    // Not one baked-in number among them — the row recalculates on edit.
    expect(total.getCell(2).value).not.toBe(18);
    expect(total.getCell(3).value).not.toBe(29);
  }, 30_000);

  it("opens Assignment 2 with its TOTAL row, one total per energy source", async () => {
    // Assignment 2's sheet: criteria down the rows, energy sources across,
    // and "Total score" at C6 — ABOVE the criteria rows, unlike Assignment 1.
    const columns: GridColumn[] = [
      column("A2-001", "7", "D", "Solar", "Is it available all the time?", 4),
      column("A2-002", "8", "D", "Solar", "Is it renewable?", 6),
      column("A2-003", "7", "E", "Wind", "Is it available all the time?", 7),
      column("A2-004", "8", "E", "Wind", "Is it renewable?", 9),
    ];
    const sheet = await openGridSheet({
      ...GRID,
      assignmentId: "assignment-2",
      assignmentTitle: "Energy sources — round 2",
      sequenceNumber: 2,
      orientation: "SOURCES_IN_COLUMNS",
      columns,
      matrix: buildGridMatrix(columns, "SOURCES_IN_COLUMNS"),
      energySourceCount: 2,
      criterionCount: 2,
    });

    const header = findRow(sheet, "Criterion");
    expect([2, 3].map((c) => header.getCell(c).value)).toEqual(["Solar", "Wind"]);

    const total = findRow(sheet, "TOTAL");
    const available = findRow(sheet, "Is it available all the time?");
    const renewable = findRow(sheet, "Is it renewable?");
    expect([2, 3].map((c) => available.getCell(c).value)).toEqual([4, 7]);

    // The TOTAL row comes first, directly under the header, with the data
    // rows beneath it.
    expect(total.number).toBe(header.number + 1);
    expect(available.number).toBe(total.number + 1);
    expect(renewable.number).toBe(total.number + 2);

    // Still a real SUM — the range simply points forward at the rows below,
    // which is an ordinary Excel reference and never circular.
    expect(total.getCell(2).value).toEqual({
      formula: `SUM(B${available.number}:B${renewable.number})`,
    });
    expect(total.getCell(3).value).toEqual({
      formula: `SUM(C${available.number}:C${renewable.number})`,
    });
    // The formula must not include the TOTAL row itself.
    for (const c of [2, 3]) {
      const formula = (total.getCell(c).value as { formula: string }).formula;
      expect(formula).not.toContain(String(total.number));
    }
  }, 30_000);

  it("has no student rows, no names and no individual answers", async () => {
    const sheet = await openGridSheet();

    const labelColumn = rowsOf(sheet)
      .map((r) => r.getCell(1).value)
      .filter((v) => v !== null && v !== undefined)
      .map(String);

    // Every populated row in column A is one of these — nothing person-shaped.
    const expected = new Set([
      "Sheet",
      "Assignment",
      "Source worksheet",
      "Layout",
      "Generated at",
      "What this sheet shows",
      "POINT-IN-TIME SNAPSHOT",
      "Live version",
      "Charts",
      "Class",
      "Questions",
      "Grid size",
      "Students enrolled",
      "Of which synthetic",
      "Notes",
      "Energy source",
      "Solar",
      "Wind",
      "Hydro",
      "TOTAL",
      "How to read this",
    ]);
    for (const label of labelColumn) {
      expect(expected.has(label), `unexpected row label "${label}"`).toBe(true);
    }

    // Each energy source appears exactly once — one grid row, not one row
    // per student who answered about it.
    expect(labelColumn.filter((l) => l === "Solar")).toHaveLength(1);

    // The sheet's height is a function of the source grid, never of the class
    // size — a thousand more students add no rows.
    const taller = await openGridSheet({
      ...GRID,
      totalStudentCount: 1500,
      syntheticStudentCount: 0,
    });
    expect(taller.rowCount).toBe(sheet.rowCount);
  }, 30_000);

  it("still says plainly that it is a snapshot, and carries the neutrality note", async () => {
    const text = allText(await openGridSheet()).join("\n");
    expect(text).toContain("POINT-IN-TIME SNAPSHOT");
    expect(text).toMatch(/cannot refresh itself/);
    expect(text).toContain(NEUTRALITY_NOTE);
    expect(text).toMatch(/neither is a preferred answer/);
    // The cells' meaning is stated, not left to be guessed at.
    expect(text).toMatch(/number of students who answered 1/);
  }, 30_000);
});
