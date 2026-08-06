import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseRosterFile,
  canonicalizeHeader,
  matchHeaderToField,
  buildHeaderMapping,
  missingColumnMessage,
  REQUIRED_ROSTER_FIELDS,
} from "../../lib/roster/parse";
import { classifyRosterRows, isImportableClassification } from "../../lib/roster/validate";

// jsdom's File has no .text()/.arrayBuffer(); Node's is spec-compliant and is
// what the server action actually receives at runtime.
import { File as NodeFile } from "node:buffer";

function csvFile(contents: string, name = "roster.csv"): File {
  return new NodeFile([contents], name, { type: "text/csv" }) as unknown as File;
}

function xlsxFile(rows: unknown[][], name = "roster.xlsx"): File {
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
  const buffer = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new NodeFile([new Uint8Array(buffer)], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }) as unknown as File;
}

describe("canonicalizeHeader", () => {
  it("folds case, padding, punctuation and separators", () => {
    expect(canonicalizeHeader("  Full Name  ")).toBe("full name");
    expect(canonicalizeHeader("Roll No.")).toBe("roll no");
    expect(canonicalizeHeader("E-Mail_ID")).toBe("e mail id");
    expect(canonicalizeHeader("ENROLLMENT   NUMBER")).toBe("enrollment number");
  });

  it("folds invisible spaces a spreadsheet export leaves behind", () => {
    expect(canonicalizeHeader("Full Name")).toBe("full name");
    expect(canonicalizeHeader("Email​")).toBe("email");
    expect(canonicalizeHeader("﻿Name")).toBe("name");
  });
});

describe("matchHeaderToField", () => {
  const cases: Array<[string, string]> = [
    ["Name", "fullName"],
    ["Full Name", "fullName"],
    ["Student Name", "fullName"],
    ["  student   name ", "fullName"],
    ["Enrollment Number", "rollNumber"],
    ["Enrolment No", "rollNumber"],
    ["Roll Number", "rollNumber"],
    ["Roll No.", "rollNumber"],
    ["Student ID", "rollNumber"],
    ["Email", "email"],
    ["Email Address", "email"],
    ["Email ID", "email"],
    ["E-mail", "email"],
    ["Gmail", "email"],
    ["Programme", "programme"],
    ["Course", "programme"],
    ["Year of Study", "yearOfStudy"],
    ["Section", "section"],
  ];

  it.each(cases)("maps %s to %s", (header, field) => {
    expect(matchHeaderToField(header)).toBe(field);
  });

  it("returns null for a header it does not know", () => {
    expect(matchHeaderToField("Favourite Colour")).toBeNull();
  });
});

describe("buildHeaderMapping", () => {
  it("reports the required columns a file is missing", () => {
    const mapping = buildHeaderMapping(["Name", "Programme"]);
    expect([...mapping.presentFields].sort()).toEqual(["fullName", "programme"]);
    expect(mapping.missingRequiredFields.map((s) => s.field).sort()).toEqual([
      "email",
      "rollNumber",
    ]);
  });

  it("lists unrecognised headers instead of dropping them silently", () => {
    const mapping = buildHeaderMapping(["Name", "Enrollment Number", "Email", "Hostel Block"]);
    expect(mapping.missingRequiredFields).toEqual([]);
    expect(mapping.unmatchedHeaders).toEqual(["Hostel Block"]);
  });

  it("ignores blank trailing header cells", () => {
    const mapping = buildHeaderMapping(["Name", "Enrollment Number", "Email", "", "   "]);
    expect(mapping.unmatchedHeaders).toEqual([]);
    expect(mapping.originalHeaders).toHaveLength(3);
  });
});

/**
 * The bug this suite exists for: a real institutional export whose headers
 * differ from the app's defaults ("Name" not "Full Name", "Enrollment Number"
 * not "Roll Number") and which carries no programme/year/section columns at
 * all. Every row of such a file used to be rejected with a bare "Required".
 */
const REAL_WORLD_CSV = [
  "Enrollment Number,Name,Email",
  "AU2340001,Aarav Mehta,aarav.m@ahduni.edu.in",
  "AU2340002,Diya Sharma,diya.s@ahduni.edu.in",
  "AU2340003,Kabir Rao,kabir.r@ahduni.edu.in",
].join("\n");

describe("parseRosterFile — real-world header shapes", () => {
  it("imports a CSV with Name / Enrollment Number / Email and no optional columns", async () => {
    const { rows, mapping } = await parseRosterFile(csvFile(REAL_WORLD_CSV));

    expect(mapping.missingRequiredFields).toEqual([]);
    expect(mapping.unmatchedHeaders).toEqual([]);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      fullName: "Aarav Mehta",
      rollNumber: "AU2340001",
      email: "aarav.m@ahduni.edu.in",
    });

    const results = classifyRosterRows(rows, {
      emailChecks: new Map(),
      allowedEmailDomain: null,
      presentFields: mapping.presentFields,
    });

    // The whole point: zero false rejections.
    expect(results.filter((r) => r.classification === "INVALID")).toEqual([]);
    expect(results.every((r) => isImportableClassification(r.classification))).toBe(true);
    expect(results[0]?.data).toMatchObject({
      fullName: "Aarav Mehta",
      rollNumber: "AU2340001",
      email: "aarav.m@ahduni.edu.in",
      programme: null,
      yearOfStudy: null,
      section: null,
    });
  });

  it("imports the same shape as .xlsx, with padded and punctuated headers", async () => {
    const { rows, mapping } = await parseRosterFile(
      xlsxFile([
        ["  Student Name ", "Roll No.", "E-mail ID", "Course"],
        ["Aarav Mehta", "AU2340001", "aarav.m@ahduni.edu.in", "B.Tech"],
        ["Diya Sharma", "AU2340002", "diya.s@ahduni.edu.in", "B.Tech"],
      ])
    );

    expect(mapping.missingRequiredFields).toEqual([]);
    expect(rows).toHaveLength(2);

    const results = classifyRosterRows(rows, {
      emailChecks: new Map(),
      allowedEmailDomain: null,
      presentFields: mapping.presentFields,
    });

    expect(results.filter((r) => r.classification === "INVALID")).toEqual([]);
    // Optional columns present in the file are kept opportunistically.
    expect(results[0]?.data?.programme).toBe("B.Tech");
    expect(results[0]?.data?.yearOfStudy).toBeNull();
  });

  it("scales to a 60-row file without a single false rejection", async () => {
    const header = "Name,Enrollment Number,Email";
    const body = Array.from(
      { length: 60 },
      (_, i) => `Student ${i + 1},AU23400${String(i + 1).padStart(2, "0")},student${i + 1}@ahduni.edu.in`
    );
    const { rows, mapping } = await parseRosterFile(csvFile([header, ...body].join("\n")));

    const results = classifyRosterRows(rows, {
      emailChecks: new Map(),
      allowedEmailDomain: null,
      presentFields: mapping.presentFields,
    });

    expect(results).toHaveLength(60);
    expect(results.filter((r) => r.classification === "INVALID")).toHaveLength(0);
    expect(results.filter((r) => isImportableClassification(r.classification))).toHaveLength(60);
  });

  it("still rejects a file whose required column is genuinely absent — naming it", async () => {
    const { rows, mapping } = await parseRosterFile(
      csvFile(["Name,Programme", "Aarav Mehta,B.Tech"].join("\n"))
    );

    expect(mapping.missingRequiredFields.map((s) => s.field).sort()).toEqual([
      "email",
      "rollNumber",
    ]);

    const results = classifyRosterRows(rows, {
      emailChecks: new Map(),
      allowedEmailDomain: null,
      presentFields: mapping.presentFields,
    });

    expect(results[0]?.classification).toBe("INVALID");
    // Reported in ROSTER_FIELDS order, so the message reads the same way every time.
    expect(results[0]?.errors).toEqual([
      "Missing: Enrollment number column not found — expected one of: Enrollment Number, Roll Number, Student ID",
      "Missing: Email column not found — expected one of: Email, Email Address, Email ID",
    ]);
  });
});

describe("missingColumnMessage", () => {
  it("names the field and quotes accepted spellings", () => {
    const email = REQUIRED_ROSTER_FIELDS.find((s) => s.field === "email");
    expect(email && missingColumnMessage(email)).toBe(
      "Email column not found — expected one of: Email, Email Address, Email ID"
    );
  });

  it("covers exactly name, enrollment number and email", () => {
    expect(REQUIRED_ROSTER_FIELDS.map((s) => s.field)).toEqual([
      "fullName",
      "rollNumber",
      "email",
    ]);
  });
});
