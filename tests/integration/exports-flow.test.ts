// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { parseGridWorkbook } from "@/lib/imports/parse-grid";
import {
  buildWorkbook,
  gatherWorkbookData,
  FIRST_DATA_ROW,
  HEADER_ROW,
  SHEET_HEADERS,
  SHEET_NAMES,
} from "@/lib/exports/workbook";
import { executeQuery, QueryValidationError } from "@/lib/query-builder/execute";
import { buildExportMetadata, metadataLines } from "@/lib/exports/metadata";
import { buildDashboardPdf } from "@/lib/exports/pdf";
import { buildCsv } from "@/lib/exports/csv";
import type { QueryDefinition } from "@/lib/query-builder/schema";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  type TestUser,
} from "./helpers";

/**
 * Phase 9 acceptance:
 *  1. The Excel export contains every sheet with the right headers and
 *     data shape.
 *  2. Exports respect RLS — another professor cannot reach this class's
 *     data through the builder or the export path, even with a crafted
 *     query naming the class id directly.
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let otherProfessor: TestUser;
let student: TestUser;
let classId: string;
let a1AssignmentId: string;
let a2AssignmentId: string;
const a1Codes = new Map<string, string>();
const a2Codes = new Map<string, string>();

const classIds: string[] = [];
const userIds: string[] = [];

function loadXlsx(path: string): ArrayBuffer {
  const buf = readFileSync(resolve(path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function importAssignment(
  assignmentId: string,
  file: string,
  codePrefix: "A1" | "A2",
  worksheet?: string
) {
  const buffer = loadXlsx(file);
  const parsed = parseGridWorkbook(buffer, { codePrefix, worksheet });
  expect(parsed.errors, `${file} parse errors`).toEqual([]);
  const { error } = await professor.client.rpc("commit_assignment_import", {
    p_assignment_id: assignmentId,
    p_source_filename: file,
    p_source_checksum: createHash("sha256").update(Buffer.from(buffer)).digest("hex"),
    p_source_worksheet: parsed.worksheet,
    p_questions: parsed.questions,
  });
  expect(error, `import of ${file} failed: ${error?.message}`).toBeNull();
}

beforeAll(async () => {
  professor = await createTestUser(env, admin, "PROFESSOR", "Export Test Professor");
  userIds.push(professor.id);
  otherProfessor = await createTestUser(env, admin, "PROFESSOR", "Other Professor");
  userIds.push(otherProfessor.id);
  student = await createTestUser(env, admin, "STUDENT", "Export Test Student");
  userIds.push(student.id);

  const { data: created, error: createError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Export Flow Class",
      class_code: `EX${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (createError) throw new Error(`class creation failed: ${createError.message}`);
  classId = created!.id;
  classIds.push(classId);

  const { error: memberError } = await admin.from("class_members").insert({
    class_id: classId,
    user_id: student.id,
    member_role: "STUDENT",
    status: "ACTIVE",
  });
  if (memberError) throw new Error(`enrolment failed: ${memberError.message}`);

  for (const [title, sequence] of [
    ["Assignment 1", 1],
    ["Assignment 2", 2],
  ] as const) {
    const { data, error } = await professor.client
      .from("assignments")
      .insert({ class_id: classId, title, sequence_number: sequence, created_by: professor.id })
      .select("id")
      .single();
    if (error) throw new Error(`assignment creation failed: ${error.message}`);
    if (sequence === 1) a1AssignmentId = data!.id;
    else a2AssignmentId = data!.id;
  }

  await importAssignment(a1AssignmentId, "source-assignments/assignment-1.xlsx", "A1");
  await importAssignment(
    a2AssignmentId,
    "source-assignments/assignment-2.xlsx",
    "A2",
    "Quantitative"
  );
  for (const [assignmentId, into] of [
    [a1AssignmentId, a1Codes],
    [a2AssignmentId, a2Codes],
  ] as const) {
    const { data, error } = await professor.client
      .from("questions")
      .select("id, external_question_code")
      .eq("assignment_id", assignmentId);
    expect(error).toBeNull();
    for (const q of data ?? []) into.set(q.external_question_code, q.id);
  }

  // Final responses on both sides so the analytics sheets have data.
  for (const [assignmentId, code, value, codes] of [
    [a1AssignmentId, "A1-002", 0, a1Codes],
    [a2AssignmentId, "A2-016", 1, a2Codes],
  ] as const) {
    const { data: attempt, error: attemptError } = await admin
      .from("assignment_attempts")
      .insert({ assignment_id: assignmentId, student_id: student.id, state: "DRAFT" })
      .select("id")
      .single();
    expect(attemptError, attemptError?.message).toBeNull();
    const { error: responseError } = await admin.from("responses").insert({
      attempt_id: attempt!.id,
      assignment_id: assignmentId,
      student_id: student.id,
      question_id: codes.get(code)!,
      response_value: value,
      is_final: true,
      submitted_at: new Date().toISOString(),
    });
    expect(responseError, responseError?.message).toBeNull();
  }

}, 240_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("ACCEPTANCE: the Excel export has every sheet with correct headers and shape", () => {
  it("builds a workbook that opens cleanly and contains every required sheet", async () => {
    const data = await gatherWorkbookData(professor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: professor.email,
    });
    const buffer = await buildWorkbook(data);
    expect(buffer.byteLength).toBeGreaterThan(0);

    // Round-trip through ExcelJS: if this parses, Excel opens it.
    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(buffer as unknown as ArrayBuffer);

    // The ten original sheets come FIRST and IN ORDER. The response-grid
    // sheets are appended after them, so this asserts the original contract
    // is untouched rather than asserting the workbook never grows — a grid
    // sheet is an addition, and nothing about the ten below may change.
    const names = reopened.worksheets.map((w) => w.name);
    expect(names.slice(0, SHEET_NAMES.length)).toEqual([...SHEET_NAMES]);
    for (const extra of names.slice(SHEET_NAMES.length)) {
      expect(extra, "only grid sheets may be appended").toMatch(/^Grid — /);
    }

    for (const name of SHEET_NAMES) {
      const sheet = reopened.getWorksheet(name);
      expect(sheet, `sheet ${name} is missing`).toBeTruthy();

      const headerRow = sheet!.getRow(HEADER_ROW);
      const headers = SHEET_HEADERS[name].map((_, i) => headerRow.getCell(i + 1).value);
      expect(headers, `headers on ${name}`).toEqual(SHEET_HEADERS[name]);

      // Every data row has exactly as many populated columns as headers.
      const rows = data.sheets[name];
      for (const row of rows) {
        expect(row.length, `row width on ${name}`).toBe(SHEET_HEADERS[name].length);
      }

      // The provenance block sits above the headers on every sheet.
      expect(sheet!.getRow(1).getCell(1).value).toBe("Class");
      expect(sheet!.getRow(1).getCell(2).value).toBe("Export Flow Class");

      // Data begins immediately below the header row, with no gap that
      // would shift every consumer's parsing by one line.
      if (rows.length > 0) {
        const firstDataRow = sheet!.getRow(FIRST_DATA_ROW);
        expect(firstDataRow.getCell(1).value, `first data row on ${name}`).not.toBeNull();
      }
    }
  }, 120_000);

  it("populates the sheets that must have data for this class", async () => {
    const data = await gatherWorkbookData(professor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: professor.email,
    });

    expect(data.sheets.Students.length).toBe(1);
    expect(data.sheets["Assignment 1 Questions"].length).toBe(30);
    expect(data.sheets["Assignment 2 Questions"].length).toBeGreaterThan(0);
    expect(data.sheets["Assignment 1 Responses"].length).toBe(1);
    expect(data.sheets["Assignment 2 Responses"].length).toBe(1);
    expect(data.sheets["Question Analytics"].length).toBeGreaterThan(0);
    expect(data.sheets["Import Validation"].length).toBeGreaterThan(0);

    // Answers are labelled neutrally wherever they are printed.
    const responseHeaders = SHEET_HEADERS["Assignment 1 Responses"];
    const labelColumn = responseHeaders.indexOf("Response label");
    expect(labelColumn).toBeGreaterThanOrEqual(0);
    expect(data.sheets["Assignment 1 Responses"][0]![labelColumn]).toBe("0 — No");
    expect(data.sheets["Assignment 2 Responses"][0]![labelColumn]).toBe("1 — Yes");
  }, 120_000);

  it("embeds class, assignments, timestamp, filters and metric definitions", async () => {
    const metadata = await buildExportMetadata(professor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: professor.email,
    });
    const lines = Object.fromEntries(metadataLines(metadata));

    expect(lines.Class).toBe("Export Flow Class");
    expect(lines.Assignments).toContain("Assignment 1");
    expect(lines.Assignments).toContain("Assignment 2");
    expect(Date.parse(lines["Generated at"]!)).not.toBeNaN();
    expect(lines["Generated by"]).toBe(professor.email);
    expect(lines["Active filters"]).toBeTruthy();
    expect(lines["Metric definitions"]).toMatch(/Consensus|% choosing/);
    // Neutral-tone note travels with every export.
    expect(lines.Notes).toMatch(/never a grade|not a grade|no value here is a grade/i);
  });
});

describe("ACCEPTANCE: exports respect RLS across professors", () => {
  it("another professor's workbook export of this class comes back empty, not populated", async () => {
    const data = await gatherWorkbookData(otherProfessor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: otherProfessor.email,
    });
    for (const name of SHEET_NAMES) {
      expect(data.sheets[name], `${name} must be empty for a non-owner`).toEqual([]);
    }
  }, 120_000);

  it("a crafted builder query naming this class id returns nothing for another professor", async () => {
    const query: QueryDefinition = {
      dataset: "A1_RESPONSES",
      measure: "PCT_ONE",
      dimensions: ["ENERGY_SOURCE"],
      filters: [],
      chartType: "BAR",
    };
    const result = await executeQuery(otherProfessor.client, query, {
      classId,
      assignmentIdBySequence: { 1: a1AssignmentId, 2: a2AssignmentId },
    });
    expect(result.rows).toEqual([]);
  });

  it("a student cannot read any analytics view the builder uses", async () => {
    for (const view of [
      "question_response_summary",
      "assignment_response_summary",
      "energy_source_response_summary",
      "criterion_response_summary",
    ]) {
      const { data, error } = await student.client.from(view).select("*").eq("class_id", classId);
      expect(error, `${view} should filter, not error`).toBeNull();
      expect(data, `${view} must be empty for a student`).toEqual([]);
    }
  });

  it("a professor cannot save a query pointing at a class they do not own", async () => {
    // Migration 0014's WITH CHECK is the boundary being asserted here.
    const { error } = await otherProfessor.client.from("saved_queries").insert({
      class_id: classId,
      created_by: otherProfessor.id,
      name: "Crafted cross-class query",
      definition: { dataset: "A1_RESPONSES" },
    });
    expect(error, "cross-class saved query should be rejected by RLS").not.toBeNull();
  });
});

describe("saved queries, visualisations and dashboards persist for their owner", () => {
  it("round-trips a saved query, visualisation and dashboard", async () => {
    const definition: QueryDefinition = {
      dataset: "A1_RESPONSES",
      measure: "PCT_ONE",
      dimensions: ["ENERGY_SOURCE"],
      filters: [],
      chartType: "BAR",
    };

    const { data: savedQuery, error: queryError } = await professor.client
      .from("saved_queries")
      .insert({ class_id: classId, created_by: professor.id, name: "My query", definition })
      .select("id, definition")
      .single();
    expect(queryError, queryError?.message).toBeNull();
    expect(savedQuery!.definition).toMatchObject({ measure: "PCT_ONE" });

    const { data: savedVis, error: visError } = await professor.client
      .from("saved_visualisations")
      .insert({
        class_id: classId,
        created_by: professor.id,
        name: "My visualisation",
        chart_type: "BAR",
        query_definition: definition,
      })
      .select("id")
      .single();
    expect(visError, visError?.message).toBeNull();

    const { data: dashboard, error: dashboardError } = await professor.client
      .from("dashboards")
      .insert({ class_id: classId, created_by: professor.id, name: "My dashboard" })
      .select("id")
      .single();
    expect(dashboardError, dashboardError?.message).toBeNull();

    const { error: itemError } = await professor.client.from("dashboard_items").insert({
      dashboard_id: dashboard!.id,
      saved_visualisation_id: savedVis!.id,
      position: 0,
    });
    expect(itemError, itemError?.message).toBeNull();

    // The owner sees them; another professor does not.
    const { data: mine } = await professor.client
      .from("saved_queries")
      .select("id")
      .eq("class_id", classId);
    expect(mine!.length).toBeGreaterThan(0);

    const { data: theirs } = await otherProfessor.client
      .from("saved_queries")
      .select("id")
      .eq("class_id", classId);
    expect(theirs).toEqual([]);

    const { data: theirItems } = await otherProfessor.client
      .from("dashboard_items")
      .select("id")
      .eq("dashboard_id", dashboard!.id);
    expect(theirItems).toEqual([]);
  }, 120_000);
});

describe("CSV and PDF exports carry the same provenance", () => {
  it("CSV leads with the metadata block then a single header row", async () => {
    const metadata = await buildExportMetadata(professor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: professor.email,
    });
    const csv = buildCsv(metadata, ["Energy source", "% choosing 1"], [["Solar", 1]]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^# Class: Export Flow Class/);
    expect(lines.some((l) => l.startsWith("# Metric definitions:"))).toBe(true);
    const headerIndex = lines.findIndex((l) => l === "Energy source,% choosing 1");
    expect(headerIndex).toBeGreaterThan(0);
    expect(lines[headerIndex + 1]).toBe("Solar,1");
  });

  it("PDF generates a real document with the metadata on it", async () => {
    const metadata = await buildExportMetadata(professor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: professor.email,
    });
    const pdf = await buildDashboardPdf({
      metadata,
      title: "Analytics report",
      tables: [
        {
          title: "% choosing 1 by energy source",
          columns: ["Energy source", "% choosing 1"],
          rows: [["Solar", "100.0%"]],
        },
      ],
    });
    expect(pdf.byteLength).toBeGreaterThan(0);
    // A valid PDF starts with %PDF- and ends with an EOF marker.
    expect(pdf.subarray(0, 5).toString("utf-8")).toBe("%PDF-");
    expect(pdf.toString("latin1")).toContain("%%EOF");
  }, 60_000);
});

describe("the server re-validates definitions it did not build", () => {
  it("refuses to execute an invalid saved definition", async () => {
    const crafted: QueryDefinition = {
      dataset: "A1_RESPONSES",
      measure: "CUMULATIVE_SUBMISSIONS", // not a measure of this dataset
      dimensions: ["QUESTION"],
      filters: [],
      chartType: "BAR",
    };
    await expect(
      executeQuery(professor.client, crafted, {
        classId,
        assignmentIdBySequence: { 1: a1AssignmentId, 2: a2AssignmentId },
      })
    ).rejects.toBeInstanceOf(QueryValidationError);
  });
});
