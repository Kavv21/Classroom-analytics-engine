import { describe, expect, it } from "vitest";
import {
  detectOrientation,
  orderGridQuestions,
  orientationDescription,
  rollUpSources,
  type GridColumn,
} from "@/lib/exports/response-grid";

/**
 * Orientation detection and column ordering — the pure logic behind both
 * the Excel grid sheet and the live grid page. If this is wrong, a
 * student's answer appears under the wrong question heading, which is the
 * worst failure either surface could have.
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

describe("rollUpSources", () => {
  const column = (
    energySource: string,
    ones: number | null,
    zeros: number | null,
    answered: number | null
  ): GridColumn => ({
    questionId: `${energySource}-${ones}-${zeros}-${answered}-${Math.random()}`,
    code: "Q",
    questionText: "Some wording",
    energySource,
    criterion: "A criterion",
    originalCell: "D6",
    ones,
    zeros,
    answered,
  });

  const columns: GridColumn[] = [
    column("Solar", 10, 5, 15),
    column("Solar", 8, 7, 15),
    column("Wind", 3, 12, 15),
  ];

  it("prefers the database rollup when the view covers the group", () => {
    // Deliberately different from the sum of the columns: whichever number
    // this returns tells us which source it came from.
    const view = new Map([
      ["Solar", { question_count: 2, ones: 99, zeros: 1, answered: 100 }],
      ["Wind", { question_count: 1, ones: 3, zeros: 12, answered: 15 }],
    ]);
    const [solar, wind] = rollUpSources(columns, view);
    expect(solar).toMatchObject({ energySource: "Solar", ones: 99, derived: false });
    expect(wind).toMatchObject({ energySource: "Wind", ones: 3, derived: false });
  });

  it("rolls the group up here, flagged, when the view has no row for it", () => {
    const [solar] = rollUpSources(columns, new Map());
    expect(solar).toMatchObject({
      energySource: "Solar",
      questionCount: 2,
      ones: 18,
      zeros: 12,
      answered: 30,
      derived: true,
    });
  });

  it("falls back rather than trusting a view row that covers a different question count", () => {
    // A stale or differently-filtered view row must not be presented as this
    // group's total — the columns on screen are the contract.
    const view = new Map([["Solar", { question_count: 5, ones: 99, zeros: 1, answered: 100 }]]);
    const [solar] = rollUpSources(columns, view);
    expect(solar).toMatchObject({ ones: 18, derived: true });
  });

  it("treats a question with no summary row as contributing nothing, not as NaN", () => {
    const [group] = rollUpSources([column("Solar", null, null, null), columns[0]!], new Map());
    expect(group).toMatchObject({ questionCount: 2, ones: 10, zeros: 5, answered: 15 });
  });

  it("keeps groups in column order and records the ranges each one spans", () => {
    const split = [columns[0]!, columns[2]!, columns[1]!];
    const groups = rollUpSources(split, new Map());
    expect(groups.map((g) => g.energySource)).toEqual(["Solar", "Wind"]);
    // Solar is split across two runs; both must be summed, and the Wind
    // column between them must not be swept in.
    expect(groups[0]!.columnRanges).toEqual([
      [0, 0],
      [2, 2],
    ]);
    expect(groups[0]!.ones).toBe(18);
    expect(groups[1]!.columnRanges).toEqual([[1, 1]]);
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
