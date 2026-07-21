import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import {
  GridFileFormatError,
  listWorksheets,
  parseGridWorkbook,
} from "@/lib/imports/parse-grid";

interface ManifestQuestion {
  id: string;
  original_row_reference: number;
  original_column_reference: string;
  energy_source: string;
  criterion: string;
  question_text: string;
  response_zero_label: string;
  response_one_label: string;
  display_order: number;
}

interface Manifest {
  question_count: number;
  questions: ManifestQuestion[];
}

function loadBuffer(path: string): ArrayBuffer {
  const buf = readFileSync(resolve(path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function loadManifest(path: string): Manifest {
  return JSON.parse(readFileSync(resolve(path), "utf-8"));
}

/** Builds a small SOURCES_IN_ROWS workbook for malformed-input tests. */
function buildWorkbook(rows: unknown[][]): ArrayBuffer {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out as ArrayBuffer;
}

describe("parseGridWorkbook — parity with the Phase 1 manifests", () => {
  // CLAUDE.md rule 1: wording comes only from the manifests, which were
  // generated from the source spreadsheets. These tests prove the parser
  // reproduces every manifest question verbatim — same text, same order,
  // same cell references, same labels — so importing through it can never
  // invent or paraphrase wording.
  it("reproduces all 30 assignment-1 questions exactly", () => {
    const manifest = loadManifest("data/assignment-1-manifest.json");
    const result = parseGridWorkbook(loadBuffer("source-assignments/assignment-1.xlsx"), {
      codePrefix: "A1",
    });

    expect(result.errors).toEqual([]);
    expect(result.orientation).toBe("SOURCES_IN_ROWS");
    expect(result.questions).toHaveLength(manifest.question_count);

    manifest.questions.forEach((expected, i) => {
      const actual = result.questions[i]!;
      expect(actual.externalQuestionCode).toBe(expected.id);
      expect(actual.questionText).toBe(expected.question_text);
      expect(actual.energySource).toBe(expected.energy_source);
      expect(actual.criterion).toBe(expected.criterion);
      expect(actual.originalRowReference).toBe(String(expected.original_row_reference));
      expect(actual.originalColumnReference).toBe(expected.original_column_reference);
      expect(actual.responseZeroLabel).toBe(expected.response_zero_label);
      expect(actual.responseOneLabel).toBe(expected.response_one_label);
      expect(actual.displayOrder).toBe(expected.display_order);
    });
  });

  it("reproduces all 255 assignment-2 questions exactly (transposed layout)", () => {
    const manifest = loadManifest("data/assignment-2-manifest.json");
    const result = parseGridWorkbook(loadBuffer("source-assignments/assignment-2.xlsx"), {
      codePrefix: "A2",
      worksheet: "Quantitative",
    });

    expect(result.errors).toEqual([]);
    expect(result.orientation).toBe("SOURCES_IN_COLUMNS");
    expect(result.questions).toHaveLength(manifest.question_count);

    manifest.questions.forEach((expected, i) => {
      const actual = result.questions[i]!;
      expect(actual.externalQuestionCode).toBe(expected.id);
      expect(actual.questionText).toBe(expected.question_text);
      expect(actual.energySource).toBe(expected.energy_source);
      expect(actual.criterion).toBe(expected.criterion);
      expect(actual.originalRowReference).toBe(String(expected.original_row_reference));
      expect(actual.originalColumnReference).toBe(expected.original_column_reference);
      expect(actual.responseZeroLabel).toBe(expected.response_zero_label);
      expect(actual.responseOneLabel).toBe(expected.response_one_label);
      expect(actual.displayOrder).toBe(expected.display_order);
    });
  });

  it("reports the assignment-2 template's pre-filled cell as an anomaly", () => {
    const result = parseGridWorkbook(loadBuffer("source-assignments/assignment-2.xlsx"), {
      codePrefix: "A2",
    });
    expect(result.anomalies).toEqual([{ cell: "D7", value: 0 }]);
  });

  it("lists worksheets and flags empty ones", () => {
    const sheets = listWorksheets(loadBuffer("source-assignments/assignment-2.xlsx"));
    expect(sheets).toEqual([
      { name: "Quantitative", empty: false },
      { name: "Sheet2", empty: true },
      { name: "Sheet3", empty: true },
    ]);
  });
});

describe("parseGridWorkbook — malformed input fails loudly", () => {
  const header = [
    ["Header", null, null],
    [null, "Mark = 1 for YES and Zero for NO", "Conventional"],
  ];

  it("collects a row-level error for an index with no name", () => {
    const buffer = buildWorkbook([
      ...header,
      [1, "Solar", null],
      [2, null, null], // malformed: numbered row, blank name
      [3, "Hydro", null],
    ]);
    const result = parseGridWorkbook(buffer, { codePrefix: "T" });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain("has an index but no name");
    expect(result.errors[0]!.location).toBe("B4");
  });

  it("collects an error when numbering breaks mid-list", () => {
    const buffer = buildWorkbook([
      ...header,
      [1, "Solar", null],
      [2, "Wind", null],
      [4, "Hydro", null], // malformed: 3 missing
    ]);
    const result = parseGridWorkbook(buffer, { codePrefix: "T" });
    expect(result.errors.some((e) => e.message.includes("numbering is broken"))).toBe(true);
  });

  it("collects an error for a name that has no index", () => {
    const buffer = buildWorkbook([
      ...header,
      [1, "Solar", null],
      [2, "Wind", null],
      [null, "Hydro", null], // malformed: name present, index missing
    ]);
    const result = parseGridWorkbook(buffer, { codePrefix: "T" });
    expect(result.errors.some((e) => e.message.includes("has no index number"))).toBe(true);
  });

  it("collects an error for duplicate source names", () => {
    const buffer = buildWorkbook([
      ...header,
      [1, "Solar", null],
      [2, "Solar", null],
    ]);
    const result = parseGridWorkbook(buffer, { codePrefix: "T" });
    expect(result.errors.some((e) => e.message.includes("Duplicate"))).toBe(true);
  });

  it("throws for a workbook with no numbered grid at all", () => {
    const buffer = buildWorkbook([
      ["Just", "some", "text"],
      ["no", "grid", "here"],
    ]);
    expect(() => parseGridWorkbook(buffer, { codePrefix: "T" })).toThrow(GridFileFormatError);
  });

  it("throws when the requested worksheet does not exist", () => {
    const buffer = buildWorkbook([...header, [1, "Solar", null]]);
    expect(() =>
      parseGridWorkbook(buffer, { codePrefix: "T", worksheet: "Missing" })
    ).toThrow(GridFileFormatError);
  });
});
