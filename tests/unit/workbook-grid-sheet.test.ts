import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildWorkbook, gridSheetName, SHEET_NAMES, type WorkbookData } from "@/lib/exports/workbook";
import { NEUTRALITY_NOTE } from "@/lib/exports/metadata";
import type { GridColumn, ResponseGrid } from "@/lib/exports/response-grid";

/**
 * The added grid sheet is AGGREGATE-ONLY and its subtotals are LIVE
 * FORMULAS. Both are contracts a reader relies on:
 *
 *  - a student's name or individual answer must never reach this sheet —
 *    that data lives on the per-student profile page and nowhere else;
 *  - the energy-source subtotals must be `SUM()` over the question totals,
 *    not baked-in numbers, so a professor who corrects a total sees every
 *    rollup move.
 *
 * Both are asserted against a reopened workbook — if ExcelJS can parse it,
 * Excel can open it.
 */

const column = (
  code: string,
  energySource: string,
  criterion: string,
  ones: number,
  zeros: number
): GridColumn => ({
  questionId: `q-${code}`,
  code,
  questionText: `${energySource}: ${criterion}?`,
  energySource,
  criterion,
  originalCell: "D6",
  ones,
  zeros,
  answered: ones + zeros,
});

const GRID: ResponseGrid = {
  assignmentId: "assignment-1",
  assignmentTitle: "Energy sources — round 1",
  sequenceNumber: 1,
  classId: "class-1",
  orientation: "SOURCES_IN_ROWS",
  worksheet: "Sheet1",
  columns: [
    column("A1-001", "Solar", "Conventional", 10, 5),
    column("A1-002", "Solar", "Renewable", 8, 7),
    column("A1-003", "Wind", "Conventional", 3, 12),
  ],
  sourceSubtotals: [
    {
      energySource: "Solar",
      questionCount: 2,
      ones: 18,
      zeros: 12,
      answered: 30,
      columnRanges: [[0, 1]],
      derived: false,
    },
    {
      energySource: "Wind",
      questionCount: 1,
      ones: 3,
      zeros: 12,
      answered: 15,
      columnRanges: [[2, 2]],
      derived: false,
    },
  ],
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
    mappingVersions: [],
    notes: [NEUTRALITY_NOTE],
  },
  // The ten original sheets are irrelevant here and stay empty; this test is
  // only about the added grid sheet.
  sheets: SHEET_NAMES.reduce(
    (acc, name) => ({ ...acc, [name]: [] }),
    {} as WorkbookData["sheets"]
  ),
  grids: [GRID],
};

async function openGridSheet(): Promise<ExcelJS.Worksheet> {
  const buffer = await buildWorkbook(DATA);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = reopened.getWorksheet(gridSheetName(GRID));
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

describe("the Excel grid sheet", () => {
  it("carries the question totals in the source sheet's column order", async () => {
    const sheet = await openGridSheet();
    const text = allText(sheet);

    // The label row and the totals row line up: each question's column keeps
    // its criterion, its code and its count of "1" answers.
    const codeRow = sheet.getRows(1, sheet.rowCount)!.find(
      (r) => r.getCell(1).value === "Question code"
    );
    expect(codeRow, "the question-code label row should exist").toBeTruthy();
    expect([2, 3, 4].map((c) => codeRow!.getCell(c).value)).toEqual([
      "A1-001",
      "A1-002",
      "A1-003",
    ]);

    const onesRow = sheet.getRows(1, sheet.rowCount)!.find(
      (r) => r.getCell(1).value === 'Total answering "1" (Yes)'
    );
    expect(onesRow, 'the "1" totals row should exist').toBeTruthy();
    expect([2, 3, 4].map((c) => onesRow!.getCell(c).value)).toEqual([10, 8, 3]);

    // The wording travels with the sheet — a bare code is not a label.
    expect(text).toContain("Solar: Conventional?");
  }, 30_000);

  it("has no student rows, no names and no individual answers", async () => {
    const sheet = await openGridSheet();

    // The sheet's height is fixed by its structure, not by the class size:
    // header notes, label rows, three total rows, the subtotal block, the
    // grand total and the footer. A per-student row would grow it.
    const labelColumn = sheet
      .getRows(1, sheet.rowCount)!
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
      "Students enrolled",
      "Of which synthetic",
      "Notes",
      "Energy source",
      "Criterion",
      "Question",
      "Original cell",
      "Question code",
      'Total answering "1" (Yes)',
      'Total answering "0" (No)',
      "Students who answered",
      "Solar",
      "Wind",
      "All energy sources",
      "How to read this",
    ]);
    for (const label of labelColumn) {
      expect(expected.has(label), `unexpected row label "${label}"`).toBe(true);
    }

    expect(labelColumn.filter((l) => l === "Solar")).toHaveLength(1);

    // The sheet's height is a function of its questions and sources, never
    // of the class size — a thousand more students add no rows.
    const buffer = await buildWorkbook({
      ...DATA,
      grids: [{ ...GRID, totalStudentCount: 1500, syntheticStudentCount: 0 }],
    });
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as unknown as ArrayBuffer);
    expect(reopened.getWorksheet(gridSheetName(GRID))!.rowCount).toBe(sheet.rowCount);
  }, 30_000);

  it("computes the energy-source subtotals with live SUM formulas over the question totals", async () => {
    const sheet = await openGridSheet();
    const rows = sheet.getRows(1, sheet.rowCount)!;

    const onesRowNumber = rows.find((r) => r.getCell(1).value === 'Total answering "1" (Yes)')!
      .number;

    const solar = rows.find((r) => r.getCell(1).value === "Solar")!;
    expect(solar.getCell(2).value).toBe(2);
    // Solar owns the first two question columns (B and C).
    expect(solar.getCell(3).value).toEqual({
      formula: `SUM(B${onesRowNumber}:C${onesRowNumber})`,
    });

    const wind = rows.find((r) => r.getCell(1).value === "Wind")!;
    expect(wind.getCell(3).value).toEqual({
      formula: `SUM(D${onesRowNumber}:D${onesRowNumber})`,
    });

    const grand = rows.find((r) => r.getCell(1).value === "All energy sources")!;
    expect(grand.getCell(3).value).toEqual({
      formula: `SUM(B${onesRowNumber}:D${onesRowNumber})`,
    });

    // Not one baked-in number among them.
    for (const row of [solar, wind, grand]) {
      for (const c of [3, 4, 5, 6]) {
        expect(row.getCell(c).value, `row ${row.number} column ${c}`).toHaveProperty("formula");
      }
    }
  }, 30_000);

  it("still says plainly that it is a snapshot, and carries the neutrality note", async () => {
    const text = allText(await openGridSheet()).join("\n");
    expect(text).toContain("POINT-IN-TIME SNAPSHOT");
    expect(text).toMatch(/cannot refresh itself/);
    expect(text).toContain(NEUTRALITY_NOTE);
    expect(text).toMatch(/neither is a preferred answer/);
  }, 30_000);
});
