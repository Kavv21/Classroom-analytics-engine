import { describe, expect, it } from "vitest";
import {
  buildStudentGrid,
  studentCellGlyph,
  type StudentGridQuestion,
} from "@/lib/analytics/student-grid";
import type { ResponseValue } from "@/lib/types/domain";

/**
 * One student's answers laid back out as the source spreadsheet's grid.
 *
 * Three contracts a reader relies on:
 *
 *  - the geometry is the SAME geometry the class totals grid and the
 *    student's own answer grid use, so the three can be read side by side;
 *  - a blank cell stays a blank — "did not answer" is never folded into
 *    "answered 0";
 *  - there is NO per-student total anywhere, because a number summarising
 *    one person's opinions reads as a score and this app has none.
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
  question_text: `${energySource} — ${criterion}`,
  original_row_reference: row,
  original_column_reference: col,
  energy_source: energySource,
  criterion,
  display_order: Number(row) * 10 + col.charCodeAt(0),
});

/** Assignment 1's shape: energy sources down rows 6-8, criteria in D and E. */
const A1: StudentGridQuestion[] = [
  question("A1-001", "6", "D", "Solar", "Conventional"),
  question("A1-002", "6", "E", "Solar", "Renewable over 25 years"),
  question("A1-003", "7", "D", "Wind", "Conventional"),
  question("A1-004", "7", "E", "Wind", "Renewable over 25 years"),
  question("A1-005", "8", "D", "Hydro", "Conventional"),
  question("A1-006", "8", "E", "Hydro", "Renewable over 25 years"),
];

/** Assignment 2's shape, transposed: criteria down the rows, sources across. */
const A2: StudentGridQuestion[] = [
  question("A2-001", "7", "D", "Solar", "Is it available all the time?"),
  question("A2-002", "8", "D", "Solar", "Is it renewable?"),
  question("A2-003", "7", "E", "Wind", "Is it available all the time?"),
  question("A2-004", "8", "E", "Wind", "Is it renewable?"),
];

const answersFrom = (values: Record<string, ResponseValue>) => (id: string) => values[id] ?? null;

describe("buildStudentGrid", () => {
  it("reproduces Assignment 1's shape — sources down the rows, criteria across", () => {
    const grid = buildStudentGrid(A1, answersFrom({}), "Sheet1");

    expect(grid.orientation).toBe("SOURCES_IN_ROWS");
    expect(grid.matrix.rowAxisHeading).toBe("Energy source");
    expect(grid.matrix.rows.map((r) => r.label)).toEqual(["Solar", "Wind", "Hydro"]);
    expect(grid.matrix.columns.map((c) => c.label)).toEqual([
      "Conventional",
      "Renewable over 25 years",
    ]);
    expect(grid.worksheet).toBe("Sheet1");
  });

  it("reproduces Assignment 2's transposed shape from the same code path", () => {
    const grid = buildStudentGrid(A2, answersFrom({}));

    expect(grid.orientation).toBe("SOURCES_IN_COLUMNS");
    expect(grid.matrix.rowAxisHeading).toBe("Criterion");
    expect(grid.matrix.rows.map((r) => r.label)).toEqual([
      "Is it available all the time?",
      "Is it renewable?",
    ]);
    expect(grid.matrix.columns.map((c) => c.label)).toEqual(["Solar", "Wind"]);
  });

  it("puts each answer at the cell the source spreadsheet gave that question", () => {
    const grid = buildStudentGrid(
      A1,
      answersFrom({
        "q-A1-001": 1,
        "q-A1-002": 0,
        "q-A1-003": 0,
        "q-A1-004": 1,
        "q-A1-005": 1,
        // A1-006 deliberately left out: a blank.
      })
    );

    const read = (rowLabel: string) =>
      grid.matrix.rows
        .find((r) => r.label === rowLabel)!
        .cells.map((cell) => (cell ? grid.answers[cell.questionId] ?? null : null));

    expect(read("Solar")).toEqual([1, 0]);
    expect(read("Wind")).toEqual([0, 1]);
    expect(read("Hydro")).toEqual([1, null]);
  });

  it("gives every active question an entry, so a blank is recorded rather than missing", () => {
    const grid = buildStudentGrid(A1, answersFrom({ "q-A1-001": 1 }));

    expect(Object.keys(grid.answers).sort()).toEqual(A1.map((q) => q.id).sort());
    expect(grid.answers["q-A1-006"]).toBeNull();
  });

  it("never folds a blank into a 0", () => {
    const grid = buildStudentGrid(A1, answersFrom({ "q-A1-001": 0 }));

    expect(grid.answers["q-A1-001"]).toBe(0);
    expect(grid.answers["q-A1-002"]).toBeNull();
    expect(grid.answers["q-A1-002"]).not.toBe(0);
  });

  it("computes NO per-student total — not in the cells, not down the columns", () => {
    // Every answer a 1, which is the case a totals row would most obviously
    // turn into a score. Nothing on the matrix carries it.
    const grid = buildStudentGrid(
      A1,
      answersFrom(Object.fromEntries(A1.map((q) => [q.id, 1 as ResponseValue])))
    );

    expect(grid.matrix.columnTotals).toEqual([null, null]);
    for (const row of grid.matrix.rows) {
      for (const cell of row.cells) {
        expect(cell?.total ?? null).toBeNull();
        expect(cell?.answered ?? null).toBeNull();
      }
    }
  });

  it("survives an assignment with no questions", () => {
    const grid = buildStudentGrid([], answersFrom({}));

    expect(grid.matrix.rows).toEqual([]);
    expect(grid.matrix.columns).toEqual([]);
    expect(grid.answers).toEqual({});
  });
});

describe("studentCellGlyph", () => {
  it("shows 0 and 1 as themselves and a blank as a dot", () => {
    expect(studentCellGlyph(0)).toBe("0");
    expect(studentCellGlyph(1)).toBe("1");
    expect(studentCellGlyph(null)).toBe("·");
  });
});
