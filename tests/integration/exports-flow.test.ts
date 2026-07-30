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
 *  1. The Excel export contains all 10 sheets with the right headers and
 *     data shape.
 *  2. Exports respect the approved-mapping boundary — an unapproved
 *     mapping contributes to no analytics figure in any export.
 *  3. Exports respect RLS — another professor cannot reach this class's
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
let approvedMappingId: string;
let unapprovedMappingId: string;
const UNAPPROVED_NAME = "UNAPPROVED SENTINEL MAPPING";

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

  // Final responses on both sides so transitions and analytics have data.
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

  // One APPROVED mapping (contributes to analytics) and one UNAPPROVED
  // mapping over the same two questions (must contribute to nothing).
  const mk = async (name: string, a1: string, a2: string) => {
    const { data, error } = await professor.client.rpc("create_question_mapping", {
      p_class_id: classId,
      p_a1_question_ids: [a1Codes.get(a1)!],
      p_a2_question_ids: [a2Codes.get(a2)!],
      p_mapping_name: name,
      p_mapping_type: "CONCEPTUAL_ONE_TO_ONE",
      p_energy_source: "Solar",
      p_mapping_status: "SUGGESTED",
    });
    expect(error, `${name}: ${error?.message}`).toBeNull();
    return data as string;
  };
  approvedMappingId = await mk("Approved export mapping", "A1-002", "A2-016");
  unapprovedMappingId = await mk(UNAPPROVED_NAME, "A1-004", "A2-017");

  const { error: approveError } = await professor.client.rpc("set_mapping_approval", {
    p_mapping_id: approvedMappingId,
    p_approve: true,
  });
  expect(approveError, approveError?.message).toBeNull();
}, 240_000);

afterAll(async () => {
  for (const cid of classIds) {
    const { error } = await admin
      .from("question_mappings")
      .update({ professor_approved: false, mapping_status: "REJECTED" })
      .eq("class_id", cid);
    if (error) throw new Error(`mapping demotion failed: ${error.message}`);
  }
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("ACCEPTANCE: the Excel export has all 10 sheets with correct headers and shape", () => {
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
    expect(data.sheets["Question Mappings"].length).toBe(2);
    expect(data.sheets["Question Analytics"].length).toBeGreaterThan(0);
    expect(data.sheets["Import Validation"].length).toBeGreaterThan(0);

    // The one approved mapping yields one transition row for one student.
    expect(data.sheets["Response Transitions"].length).toBe(1);
    const transition = data.sheets["Response Transitions"][0]!;
    expect(transition[0]).toBe("Approved export mapping");
    expect(transition[7]).toBe("0 — No"); // A1 answer, neutrally labelled
    expect(transition[8]).toBe("1 — Yes"); // A2 answer
    expect(transition[9]).toBe("0 → 1 (No → Yes)");
  }, 120_000);

  it("embeds class, assignments, timestamp, filters, definitions and mapping versions", async () => {
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
    expect(lines["Metric definitions"]).toMatch(/Change rate/);
    expect(lines["Approved mapping versions"]).toContain("Approved export mapping v1");
    // Neutral-tone note travels with every export.
    expect(lines.Notes).toMatch(/never a grade|not a grade|no value here is a grade/i);
  });
});

describe("ACCEPTANCE: exports never leak unapproved mapping data", () => {
  it("the unapproved mapping appears in the inventory sheet but in no analytics sheet", async () => {
    const data = await gatherWorkbookData(professor.client, {
      classId,
      className: "Export Flow Class",
      generatedBy: professor.email,
    });

    // It IS in the professor's own mapping inventory, clearly flagged.
    // Columns are located by header name, not by a hard-coded index — this
    // assertion is about the flag, not about the sheet's column layout.
    const inventory = data.sheets["Question Mappings"];
    const mappingHeaders = SHEET_HEADERS["Question Mappings"];
    const column = (header: string) => {
      const index = mappingHeaders.indexOf(header);
      expect(index, `"${header}" column should exist`).toBeGreaterThanOrEqual(0);
      return index;
    };
    const unapprovedRow = inventory.find((r) => r[column("Mapping name")] === UNAPPROVED_NAME);
    expect(unapprovedRow, "unapproved mapping should be in the inventory").toBeTruthy();
    expect(unapprovedRow![column("Professor approved")]).toBe("No");
    expect(String(unapprovedRow![column("Contributes to analytics")])).toMatch(
      /contributes to no figure/i
    );

    // It is in NO analytics-bearing sheet, by name or by id.
    const analyticsSheets = [
      "Response Transitions",
      "Question Analytics",
      "Student Analytics",
    ] as const;
    for (const name of analyticsSheets) {
      const flat = JSON.stringify(data.sheets[name]);
      expect(flat, `${name} must not mention the unapproved mapping`).not.toContain(
        UNAPPROVED_NAME
      );
      expect(flat, `${name} must not mention the unapproved mapping id`).not.toContain(
        unapprovedMappingId
      );
    }
  }, 120_000);

  it("a builder query over paired transitions cannot surface the unapproved mapping", async () => {
    const query: QueryDefinition = {
      dataset: "PAIRED_TRANSITIONS",
      measure: "PAIR_COUNT",
      dimensions: ["MAPPING"],
      filters: [],
      chartType: "BAR",
    };
    const result = await executeQuery(professor.client, query, {
      classId,
      assignmentIdBySequence: { 1: a1AssignmentId, 2: a2AssignmentId },
    });
    const names = result.rows.map((r) => r.keys[0]);
    expect(names).toContain("Approved export mapping");
    expect(names).not.toContain(UNAPPROVED_NAME);
  });

  it("even filtering explicitly for the unapproved mapping returns nothing", async () => {
    const query: QueryDefinition = {
      dataset: "PAIRED_TRANSITIONS",
      measure: "PAIR_COUNT",
      dimensions: ["MAPPING"],
      filters: [{ dimension: "MAPPING", value: UNAPPROVED_NAME }],
      chartType: "BAR",
    };
    const result = await executeQuery(professor.client, query, {
      classId,
      assignmentIdBySequence: { 1: a1AssignmentId, 2: a2AssignmentId },
    });
    expect(result.rows).toEqual([]);
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
    expect(data.metadata.mappingVersions).toEqual([]);
  }, 120_000);

  it("a crafted builder query naming this class id returns nothing for another professor", async () => {
    const query: QueryDefinition = {
      dataset: "PAIRED_TRANSITIONS",
      measure: "PAIR_COUNT",
      dimensions: ["MAPPING"],
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
      "response_transitions_live",
      "mapping_transition_summary",
      "student_transition_summary",
      "question_response_summary",
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
      definition: { dataset: "PAIRED_TRANSITIONS" },
    });
    expect(error, "cross-class saved query should be rejected by RLS").not.toBeNull();
  });
});

describe("saved queries, visualisations and dashboards persist for their owner", () => {
  it("round-trips a saved query, visualisation and dashboard", async () => {
    const definition: QueryDefinition = {
      dataset: "PAIRED_TRANSITIONS",
      measure: "CHANGE_RATE",
      dimensions: ["MAPPING"],
      filters: [],
      chartType: "BAR",
    };

    const { data: savedQuery, error: queryError } = await professor.client
      .from("saved_queries")
      .insert({ class_id: classId, created_by: professor.id, name: "My query", definition })
      .select("id, definition")
      .single();
    expect(queryError, queryError?.message).toBeNull();
    expect(savedQuery!.definition).toMatchObject({ measure: "CHANGE_RATE" });

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
    const csv = buildCsv(metadata, ["Mapping", "Valid pairs"], [["Approved export mapping", 1]]);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toMatch(/^# Class: Export Flow Class/);
    expect(lines.some((l) => l.startsWith("# Approved mapping versions:"))).toBe(true);
    const headerIndex = lines.findIndex((l) => l === "Mapping,Valid pairs");
    expect(headerIndex).toBeGreaterThan(0);
    expect(lines[headerIndex + 1]).toBe("Approved export mapping,1");
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
          title: "Change rate by mapping",
          columns: ["Mapping", "Change rate"],
          rows: [["Approved export mapping", "100.0%"]],
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
      measure: "CHANGE_RATE", // not a measure of this dataset
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
