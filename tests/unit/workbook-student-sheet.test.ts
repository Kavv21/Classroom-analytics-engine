import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildStudentWorkbook,
  STUDENT_ANSWERS_SHEET,
  studentGridSheetName,
  type StudentWorkbookData,
} from "@/lib/exports/workbook";
import { NEUTRALITY_NOTE, SINGLE_ASSIGNMENT_NOTE } from "@/lib/exports/metadata";
import { buildStudentGrid, type StudentGridQuestion } from "@/lib/analytics/student-grid";
import {
  groupStudentResponses,
  type StudentAssignmentResponses,
  type StudentResponseRow,
} from "@/lib/analytics/student-responses";
import type { ResponseValue } from "@/lib/types/domain";

/**
 * The one-student .xlsx. Four contracts:
 *
 *  - it is the SOURCE SPREADSHEET'S OWN GRID, same rows/columns/order as
 *    the screen it was downloaded from;
 *  - it carries ONE STUDENT'S answers, and says whose in its provenance
 *    block — including the synthetic-record disclosure where it applies,
 *    since the file outlives the page that explained it;
 *  - it has NO total row and no per-student sum anywhere, because that
 *    would read as a score;
 *  - a blank cell is a blank, never a 0.
 *
 * All asserted against a reopened workbook — if ExcelJS can parse it, Excel
 * can open it.
 */

const question = (
  code: string,
  row: string,
  col: string,
  energySource: string,
  criterion: string
): StudentGridQuestion => ({
  id: `q-${code}`,
  external_question_code: code,
  question_text: `Verbatim wording for ${code}`,
  original_row_reference: row,
  original_column_reference: col,
  energy_source: energySource,
  criterion,
  display_order: Number(row) * 10 + col.charCodeAt(0),
});

const QUESTIONS: StudentGridQuestion[] = [
  question("A1-001", "6", "D", "Solar", "Conventional"),
  question("A1-002", "6", "E", "Solar", "Renewable over 25 years"),
  question("A1-003", "7", "D", "Wind", "Conventional"),
  question("A1-004", "7", "E", "Wind", "Renewable over 25 years"),
  question("A1-005", "8", "D", "Hydro", "Conventional"),
  question("A1-006", "8", "E", "Hydro", "Renewable over 25 years"),
];

const ANSWERS: Record<string, ResponseValue> = {
  "q-A1-001": 1,
  "q-A1-002": 0,
  "q-A1-003": 0,
  "q-A1-004": 1,
  "q-A1-005": 1,
  "q-A1-006": null,
};

function assignment(): StudentAssignmentResponses {
  const rows: StudentResponseRow[] = QUESTIONS.map((q) => ({
    questionId: q.id,
    code: q.external_question_code,
    questionText: q.question_text,
    energySource: q.energy_source!,
    criterion: q.criterion!,
    originalCell: `${q.original_column_reference}${q.original_row_reference}`,
    value: ANSWERS[q.id] ?? null,
    recorded: ANSWERS[q.id] !== null,
  }));
  const groups = groupStudentResponses(rows);

  return {
    assignmentId: "assignment-1",
    title: "Energy sources — round 1",
    sequenceNumber: 1,
    attemptState: "SUBMITTED",
    submittedAt: "2026-01-01T00:00:00.000Z",
    submissionVersion: 1,
    questionCount: rows.length,
    answeredCount: rows.filter((r) => r.value !== null).length,
    ones: groups.reduce((n, g) => n + g.ones, 0),
    zeros: groups.reduce((n, g) => n + g.zeros, 0),
    groups,
    grid: buildStudentGrid(QUESTIONS, (id) => ANSWERS[id] ?? null, "Sheet1"),
  };
}

const DATA: StudentWorkbookData = {
  metadata: {
    className: "Student Sheet Class",
    assignmentNames: ["Energy sources — round 1"],
    generatedAt: "2026-01-01T00:00:00.000Z",
    generatedBy: "professor@example.edu",
    activeFilters: ["None"],
    metricDefinitions: [],
    notes: [NEUTRALITY_NOTE, SINGLE_ASSIGNMENT_NOTE],
  },
  classId: "class-1",
  student: {
    id: "student-1",
    name: "Asha Patel",
    identifier: "ROLL-042",
    email: "asha@example.edu",
    enrolmentStatus: "ACTIVE",
    isSynthetic: false,
  },
  assignments: [assignment()],
};

async function reopen(data: StudentWorkbookData = DATA): Promise<ExcelJS.Workbook> {
  const buffer = await buildStudentWorkbook(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  return workbook;
}

async function openGridSheet(data: StudentWorkbookData = DATA): Promise<ExcelJS.Worksheet> {
  const workbook = await reopen(data);
  const sheet = workbook.getWorksheet(studentGridSheetName(data.assignments[0]!));
  expect(sheet, "the student grid sheet should exist").toBeTruthy();
  return sheet!;
}

function rowsOf(sheet: ExcelJS.Worksheet): ExcelJS.Row[] {
  return sheet.getRows(1, sheet.rowCount) ?? [];
}

function findRow(sheet: ExcelJS.Worksheet, label: string): ExcelJS.Row {
  const row = rowsOf(sheet).find((r) => r.getCell(1).value === label);
  expect(row, `a row labelled "${label}" should exist`).toBeTruthy();
  return row!;
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

describe("the one-student Excel grid sheet", () => {
  it("reproduces the source spreadsheet's grid with this student's own answers", async () => {
    const sheet = await openGridSheet();

    const header = findRow(sheet, "Energy source");
    expect([2, 3].map((c) => header.getCell(c).value)).toEqual([
      "Conventional",
      "Renewable over 25 years",
    ]);

    for (const [label, conventional, renewable] of [
      ["Solar", 1, 0],
      ["Wind", 0, 1],
      ["Hydro", 1, null],
    ] as const) {
      const row = findRow(sheet, label);
      expect([2, 3].map((c) => row.getCell(c).value ?? null), label).toEqual([
        conventional,
        renewable,
      ]);
    }

    // The rows sit directly under the header, with nothing in between.
    expect(findRow(sheet, "Solar").number).toBe(header.number + 1);
    expect(findRow(sheet, "Hydro").number).toBe(header.number + 3);
  }, 30_000);

  it("leaves an unanswered cell empty rather than writing a 0", async () => {
    const sheet = await openGridSheet();
    const hydro = findRow(sheet, "Hydro");

    // A1-006 was never answered. An 0 here would invent an opinion.
    expect(hydro.getCell(3).value ?? null).toBeNull();
    expect(hydro.getCell(3).value).not.toBe(0);
  }, 30_000);

  it("writes NO total row and no per-student sum of any kind", async () => {
    const sheet = await openGridSheet();
    const text = allText(sheet);

    expect(rowsOf(sheet).some((r) => r.getCell(1).value === "TOTAL")).toBe(false);
    expect(text.some((t) => t.startsWith("SUM("))).toBe(false);
    // 3 is the sum of this student's answers; it must appear nowhere.
    const gridBody = ["Solar", "Wind", "Hydro"].flatMap((label) =>
      [2, 3].map((c) => findRow(sheet, label).getCell(c).value)
    );
    expect(gridBody.every((v) => v === null || v === undefined || v === 0 || v === 1)).toBe(true);
  }, 30_000);

  it("names the student it describes, so the file can be read away from the app", async () => {
    const sheet = await openGridSheet();
    const text = allText(sheet).join(" ");

    expect(findRow(sheet, "Student").getCell(2).value).toBe("Asha Patel");
    expect(findRow(sheet, "Student identifier").getCell(2).value).toBe("ROLL-042");
    expect(findRow(sheet, "Internal student ID").getCell(2).value).toBe("student-1");
    expect(findRow(sheet, "Generated at").getCell(2).value).toBe("2026-01-01T00:00:00.000Z");
    expect(findRow(sheet, "Class").getCell(2).value).toBe("Student Sheet Class");
    expect(text).toContain("POINT-IN-TIME SNAPSHOT");
    expect(text).toContain(NEUTRALITY_NOTE);
  }, 30_000);

  it("discloses a synthetic record on every sheet", async () => {
    const workbook = await reopen({
      ...DATA,
      student: { ...DATA.student, isSynthetic: true },
    });

    for (const sheet of workbook.worksheets) {
      expect(allText(sheet).join(" "), sheet.name).toContain("SYNTHETIC DEMO RECORD");
    }
  }, 30_000);

  it("labels the grid only with stored wording, and denies being a grade in words", async () => {
    const sheet = await openGridSheet();
    const text = allText(sheet).join(" ");

    // The only labels on the grid are the energy sources and criteria the
    // import stored — nothing evaluative is composed to sit beside a cell.
    const header = findRow(sheet, "Energy source");
    expect([2, 3].map((c) => header.getCell(c).value)).toEqual([
      "Conventional",
      "Renewable over 25 years",
    ]);
    for (const label of ["Solar", "Wind", "Hydro"]) {
      expect(findRow(sheet, label).getCell(1).value).toBe(label);
    }

    // Every mention of grades or scores on the sheet is a DENIAL that this
    // is one, not a figure. Both sentences are asserted verbatim so a future
    // edit cannot quietly turn a denial into a claim.
    expect(text).toContain(NEUTRALITY_NOTE);
    expect(text).toContain(
      "nothing on this sheet is a grade, a score or a correctness judgement"
    );
    expect(text).toContain(
      "a figure summing one person's answers would read as a score, and this app has none"
    );
  }, 30_000);
});

describe("the one-student answers sheet", () => {
  it("carries every question's verbatim wording against its answer", async () => {
    const workbook = await reopen();
    const sheet = workbook.getWorksheet(STUDENT_ANSWERS_SHEET);
    expect(sheet, "the answers sheet should exist").toBeTruthy();

    const text = allText(sheet!);
    for (const q of QUESTIONS) {
      expect(text, q.external_question_code).toContain(q.question_text);
      expect(text).toContain(q.external_question_code);
    }
    // The blank question is listed with "No answer", not dropped.
    expect(text).toContain("No answer");
  }, 30_000);

  it("has one data row per question, and no more", async () => {
    const workbook = await reopen();
    const sheet = workbook.getWorksheet(STUDENT_ANSWERS_SHEET)!;
    const header = findRow(sheet, "Assignment");
    const dataRows = rowsOf(sheet).filter((r) => r.number > header.number);

    expect(dataRows).toHaveLength(QUESTIONS.length);
  }, 30_000);
});
