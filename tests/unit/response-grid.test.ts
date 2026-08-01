import { describe, expect, it } from "vitest";
import {
  buildGridMatrix,
  defaultTotalsPosition,
  detectOrientation,
  orderGridQuestions,
  orientationDescription,
  type GridColumn,
} from "@/lib/exports/response-grid";

/**
 * Orientation detection, column ordering and grid reconstruction — the pure
 * logic behind both the Excel grid sheet and the live grid page. If this is
 * wrong, a class total appears against the wrong energy source or criterion,
 * which is the worst failure either surface could have.
 *
 * The fixtures mirror the real source workbooks: Assignment 1 lists energy
 * sources down the rows with two criteria across the columns; Assignment 2
 * is transposed, with sources across the columns and criteria down the
 * rows.
 */

interface Q {
  id: string;
  external_question_code: string;
  original_row_reference: string | null;
  original_column_reference: string | null;
  original_worksheet: string | null;
  energy_source: string | null;
  criterion: string | null;
  display_order: number;
}

/** Assignment 1 shape: rows 6-8 = Solar/Wind/Hydro, columns D/E = criteria. */
const A1: Q[] = [
  ["A1-001", "6", "D", "Solar", "Conventional"],
  ["A1-002", "6", "E", "Solar", "Renewable over 25 years"],
  ["A1-003", "7", "D", "Wind", "Conventional"],
  ["A1-004", "7", "E", "Wind", "Renewable over 25 years"],
  ["A1-005", "8", "D", "Hydro", "Conventional"],
  ["A1-006", "8", "E", "Hydro", "Renewable over 25 years"],
].map(([code, row, col, source, criterion], i) => ({
  id: `a1-${i}`,
  external_question_code: code!,
  original_row_reference: row!,
  original_column_reference: col!,
  original_worksheet: "Sheet1",
  energy_source: source!,
  criterion: criterion!,
  display_order: i + 1,
}));

/** Assignment 2 shape: rows 7-8 = criteria, columns D/E/F = sources. */
const A2: Q[] = [
  ["A2-001", "7", "D", "Solar", "Is it available all the time?"],
  ["A2-002", "7", "E", "Wind", "Is it available all the time?"],
  ["A2-003", "7", "F", "Hydro", "Is it available all the time?"],
  ["A2-004", "8", "D", "Solar", "Is it renewable?"],
  ["A2-005", "8", "E", "Wind", "Is it renewable?"],
  ["A2-006", "8", "F", "Hydro", "Is it renewable?"],
].map(([code, row, col, source, criterion], i) => ({
  id: `a2-${i}`,
  external_question_code: code!,
  original_row_reference: row!,
  original_column_reference: col!,
  original_worksheet: "Quantitative",
  energy_source: source!,
  criterion: criterion!,
  display_order: i + 1,
}));

describe("detectOrientation", () => {
  it("reads Assignment 1's layout as sources in rows", () => {
    expect(detectOrientation(A1)).toBe("SOURCES_IN_ROWS");
  });

  it("reads Assignment 2's transposed layout as sources in columns", () => {
    expect(detectOrientation(A2)).toBe("SOURCES_IN_COLUMNS");
  });

  it("does not depend on how many sources or criteria there are", () => {
    // One criterion per source, still rows.
    const single = A1.filter((q) => q.original_column_reference === "D");
    expect(detectOrientation(single)).toBe("SOURCES_IN_ROWS");
  });
});

describe("orderGridQuestions", () => {
  it("keeps each source's criteria adjacent for a sources-in-rows sheet", () => {
    const ordered = orderGridQuestions(A1, "SOURCES_IN_ROWS");
    expect(ordered.map((q) => q.energy_source)).toEqual([
      "Solar",
      "Solar",
      "Wind",
      "Wind",
      "Hydro",
      "Hydro",
    ]);
    // Within a source, criteria follow the original column order (D then E).
    expect(ordered.slice(0, 2).map((q) => q.original_column_reference)).toEqual(["D", "E"]);
  });

  it("keeps each source's criteria adjacent for a transposed sheet too", () => {
    // In the raw display order A2 reads across the criteria first; the grid
    // must regroup it by source so it mirrors the original columns.
    expect(A2.map((q) => q.energy_source)).toEqual([
      "Solar", "Wind", "Hydro", "Solar", "Wind", "Hydro",
    ]);
    const ordered = orderGridQuestions(A2, "SOURCES_IN_COLUMNS");
    expect(ordered.map((q) => q.energy_source)).toEqual([
      "Solar",
      "Solar",
      "Wind",
      "Wind",
      "Hydro",
      "Hydro",
    ]);
    expect(ordered.slice(0, 2).map((q) => q.original_row_reference)).toEqual(["7", "8"]);
  });

  it("sorts spreadsheet columns as letters, not as text", () => {
    // "AA" must come after "Z", which a plain string sort gets wrong.
    const wide: Q[] = ["Z", "AA", "B"].map((col, i) => ({
      ...A2[0]!,
      id: `w-${i}`,
      external_question_code: `W-${i}`,
      original_column_reference: col,
      energy_source: `Source ${col}`,
      display_order: i + 1,
    }));
    const ordered = orderGridQuestions(wide, "SOURCES_IN_COLUMNS");
    expect(ordered.map((q) => q.original_column_reference)).toEqual(["B", "Z", "AA"]);
  });

  it("sorts spreadsheet rows numerically, not as text", () => {
    // "10" must come after "9".
    const tall: Q[] = ["9", "10", "2"].map((row, i) => ({
      ...A1[0]!,
      id: `t-${i}`,
      external_question_code: `T-${i}`,
      original_row_reference: row,
      energy_source: `Source ${row}`,
      display_order: i + 1,
    }));
    const ordered = orderGridQuestions(tall, "SOURCES_IN_ROWS");
    expect(ordered.map((q) => q.original_row_reference)).toEqual(["2", "9", "10"]);
  });

  it("never drops or duplicates a question", () => {
    for (const [set, orientation] of [
      [A1, "SOURCES_IN_ROWS"],
      [A2, "SOURCES_IN_COLUMNS"],
    ] as const) {
      const ordered = orderGridQuestions(set, orientation);
      expect(ordered).toHaveLength(set.length);
      expect(new Set(ordered.map((q) => q.id)).size).toBe(set.length);
    }
  });

  it("keeps questions with unusable references in a stable place rather than losing them", () => {
    const messy: Q[] = [
      { ...A1[0]!, id: "m1", original_row_reference: null, original_column_reference: null },
      ...A1.slice(0, 2),
    ];
    const ordered = orderGridQuestions(messy, "SOURCES_IN_ROWS");
    expect(ordered).toHaveLength(3);
    expect(ordered.map((q) => q.id)).toContain("m1");
  });
});

describe("buildGridMatrix", () => {
  const column = (q: Q, ones: number | null): GridColumn => ({
    questionId: q.id,
    code: q.external_question_code,
    questionText: `${q.energy_source} — ${q.criterion}`,
    energySource: q.energy_source!,
    criterion: q.criterion!,
    originalCell: `${q.original_column_reference}${q.original_row_reference}`,
    originalRow: q.original_row_reference,
    originalColumn: q.original_column_reference,
    ones,
    zeros: ones === null ? null : 20 - ones,
    answered: ones === null ? null : 20,
  });

  /** The grid as a professor reads it: row label, then the row's numbers. */
  const asText = (columns: GridColumn[], orientation: "SOURCES_IN_ROWS" | "SOURCES_IN_COLUMNS") => {
    const m = buildGridMatrix(columns, orientation);
    return {
      header: [m.rowAxisHeading, ...m.columns.map((c) => c.label)],
      rows: m.rows.map((r) => [r.label, ...r.cells.map((c) => c?.total ?? null)]),
      total: m.columnTotals,
      totalsPosition: m.totalsPosition,
    };
  };

  it("reproduces Assignment 1's grid: energy sources down the rows, criteria across", () => {
    // Solar/Wind/Hydro x Conventional/Renewable, exactly as the source file.
    const ones = [11, 2, 3, 14, 5, 6];
    const grid = asText(
      orderGridQuestions(A1, "SOURCES_IN_ROWS").map((q, i) => column(q, ones[i]!)),
      "SOURCES_IN_ROWS"
    );
    expect(grid.header).toEqual(["Energy source", "Conventional", "Renewable over 25 years"]);
    expect(grid.rows).toEqual([
      ["Solar", 11, 2],
      ["Wind", 3, 14],
      ["Hydro", 5, 6],
    ]);
    // One number per criterion column, summed straight down.
    expect(grid.total).toEqual([19, 22]);
    // Assignment 1's source file closes with its blank "TOTAL" at C21.
    expect(grid.totalsPosition).toBe("BOTTOM");
  });

  it("reproduces Assignment 2's transposed grid: criteria down the rows, sources across", () => {
    const ones = [1, 2, 3, 4, 5, 6];
    const ordered = orderGridQuestions(A2, "SOURCES_IN_COLUMNS");
    const grid = asText(
      ordered.map((q, i) => column(q, ones[i]!)),
      "SOURCES_IN_COLUMNS"
    );
    expect(grid.header).toEqual(["Criterion", "Solar", "Wind", "Hydro"]);
    // Solar owns A2-001 (row 7) and A2-004 (row 8); after ordering those are
    // the first two entries, so they carry ones = 1 and 2.
    expect(grid.rows).toEqual([
      ["Is it available all the time?", 1, 3, 5],
      ["Is it renewable?", 2, 4, 6],
    ]);
    // One grand total per energy source.
    expect(grid.total).toEqual([3, 7, 11]);
    // Assignment 2's source file carries "Total score" at C6, above the
    // criteria rows — the opposite end from Assignment 1, on purpose.
    expect(grid.totalsPosition).toBe("TOP");
  });

  it("puts each assignment's totals row where its own source file has it", () => {
    // The position is not a second rule to keep in step with the layout —
    // it comes out of the orientation the detector already reports.
    expect(defaultTotalsPosition("SOURCES_IN_ROWS")).toBe("BOTTOM");
    expect(defaultTotalsPosition("SOURCES_IN_COLUMNS")).toBe("TOP");

    const a1 = buildGridMatrix(A1.map((q) => column(q, 1)), "SOURCES_IN_ROWS");
    const a2 = buildGridMatrix(A2.map((q) => column(q, 1)), "SOURCES_IN_COLUMNS");
    expect(a1.totalsPosition).toBe("BOTTOM");
    expect(a2.totalsPosition).toBe("TOP");
  });

  it("takes an explicit position for a source file that puts its totals elsewhere", () => {
    const m = buildGridMatrix(A1.map((q) => column(q, 2)), "SOURCES_IN_ROWS", "TOP");
    expect(m.totalsPosition).toBe("TOP");
    // Moving the row changes nothing about the arithmetic or the grid.
    expect(m.columnTotals).toEqual([6, 6]);
    expect(m.rows.map((r) => r.label)).toEqual(["Solar", "Wind", "Hydro"]);
  });

  it("places cells by their source references, not by the order they arrive in", () => {
    const shuffled = [A1[3]!, A1[0]!, A1[4]!, A1[1]!, A1[5]!, A1[2]!];
    const byCode = new Map([
      ["A1-001", 10], ["A1-002", 20], ["A1-003", 30],
      ["A1-004", 40], ["A1-005", 50], ["A1-006", 60],
    ]);
    const grid = asText(
      shuffled.map((q) => column(q, byCode.get(q.external_question_code)!)),
      "SOURCES_IN_ROWS"
    );
    expect(grid.rows).toEqual([
      ["Solar", 10, 20],
      ["Wind", 30, 40],
      ["Hydro", 50, 60],
    ]);
  });

  it("leaves a hole rather than shifting cells when the source grid is incomplete", () => {
    // Wind's "Conventional" question is missing from the assignment.
    const kept = A1.filter((q) => q.external_question_code !== "A1-003");
    const m = buildGridMatrix(
      kept.map((q, i) => column(q, i + 1)),
      "SOURCES_IN_ROWS"
    );
    const wind = m.rows.find((r) => r.label === "Wind")!;
    expect(wind.cells[0]).toBeNull();
    expect(wind.cells[1]?.total).toBe(3);
  });

  it("shows a column nobody has answered as no total, not as a real zero", () => {
    const m = buildGridMatrix(
      orderGridQuestions(A1, "SOURCES_IN_ROWS").map((q) =>
        column(q, q.original_column_reference === "E" ? null : 4)
      ),
      "SOURCES_IN_ROWS"
    );
    expect(m.columnTotals).toEqual([12, null]);
  });

  it("counts a partially answered column from the cells that do have answers", () => {
    const m = buildGridMatrix(
      orderGridQuestions(A1, "SOURCES_IN_ROWS").map((q, i) => column(q, i === 0 ? null : 2)),
      "SOURCES_IN_ROWS"
    );
    // Column D loses only Solar's cell; it is not NaN and not the full 6.
    expect(m.columnTotals[0]).toBe(4);
  });

  it("surfaces a question that collides on a source cell instead of dropping it", () => {
    const clash: Q = { ...A1[0]!, id: "clash", external_question_code: "A1-999" };
    const m = buildGridMatrix(
      [...A1, clash].map((q, i) => column(q, i + 1)),
      "SOURCES_IN_ROWS"
    );
    expect(m.unplaced.map((c) => c.code)).toEqual(["A1-999"]);
    // The first-placed question keeps the cell, and the stray total is not
    // silently folded into the TOTAL row.
    expect(m.rows[0]!.cells[0]!.code).toBe("A1-001");
    expect(m.columnTotals[0]).toBe(1 + 3 + 5);
  });

  it("labels the row axis with whichever field is constant along a row", () => {
    expect(buildGridMatrix(A1.map((q) => column(q, 1)), "SOURCES_IN_ROWS").rowAxis).toBe(
      "ENERGY_SOURCE"
    );
    expect(buildGridMatrix(A2.map((q) => column(q, 1)), "SOURCES_IN_COLUMNS").rowAxis).toBe(
      "CRITERION"
    );
  });

  it("has no student-shaped data anywhere in the matrix", () => {
    const m = buildGridMatrix(A1.map((q) => column(q, 7)), "SOURCES_IN_ROWS");
    const keys = new Set(Object.keys(m.rows[0]!.cells[0]!));
    for (const forbidden of ["studentId", "studentName", "responses", "students"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    // Every cell is one aggregate number plus the labels that identify it.
    expect([...keys].sort()).toEqual([
      "answered",
      "code",
      "criterion",
      "energySource",
      "originalCell",
      "questionId",
      "questionText",
      "total",
    ]);
  });
});

describe("orientationDescription", () => {
  it("describes both layouts in plain words, with no jargon", () => {
    for (const orientation of ["SOURCES_IN_ROWS", "SOURCES_IN_COLUMNS"] as const) {
      const text = orientationDescription(orientation);
      expect(text).not.toMatch(/SOURCES_IN|orientation|transpose\b/i);
      expect(text.length).toBeGreaterThan(20);
    }
    expect(orientationDescription("SOURCES_IN_ROWS")).toContain("down the rows");
    expect(orientationDescription("SOURCES_IN_COLUMNS")).toContain("across the columns");
  });
});
