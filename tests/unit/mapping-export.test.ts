import { describe, expect, it } from "vitest";
import { csvEscape, mappingsToCsv, type MappingExportRow } from "@/lib/mappings/export";

function row(overrides: Partial<MappingExportRow>): MappingExportRow {
  return {
    id: "m-1",
    version: 1,
    mapping_name: "Renewable — Solar",
    mapping_type: "CONCEPTUAL_ONE_TO_ONE",
    mapping_status: "SUGGESTED",
    professor_approved: false,
    common_concept: "renewable",
    energy_source: "Solar",
    criterion: null,
    comparison_method: "keyword_match:renewable",
    professor_notes: null,
    assignment_1_question_codes: ["A1-002"],
    assignment_2_question_codes: ["A2-016"],
    assignment_1_questions: ["Solar — Renewable over 25 years"],
    assignment_2_questions: ["Solar — Renewable"],
    previous_version_id: null,
    superseded_by_id: null,
    created_at: "2026-07-22T00:00:00Z",
    updated_at: "2026-07-22T00:00:00Z",
    ...overrides,
  };
}

describe("mapping CSV export", () => {
  it("escapes quotes, commas, and newlines", () => {
    expect(csvEscape("plain")).toBe("plain");
    expect(csvEscape('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("includes unapproved AND rejected rows — the export is the professor's full record", () => {
    const csv = mappingsToCsv([
      row({ id: "m-1", mapping_status: "SUGGESTED", professor_approved: false }),
      row({ id: "m-2", mapping_status: "REJECTED", professor_approved: false }),
      row({ id: "m-3", mapping_status: "APPROVED", professor_approved: true }),
    ]);
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(4); // header + 3 rows
    expect(lines[0]).toContain("mapping_status");
    expect(csv).toContain("SUGGESTED");
    expect(csv).toContain("REJECTED");
    expect(csv).toContain("APPROVED");
  });

  it("renders question codes and notes with embedded commas safely", () => {
    const csv = mappingsToCsv([
      row({
        professor_notes: 'Check the "25-year" framing, then approve.',
        assignment_1_question_codes: ["A1-001", "A1-002"],
      }),
    ]);
    expect(csv).toContain('"Check the ""25-year"" framing, then approve."');
    expect(csv).toContain("A1-001; A1-002");
  });

  it("carries the question wording, not only the codes", () => {
    // A code-only export is unreadable away from the app, so the wording
    // columns come first and the em dash survives the CSV quoting rules.
    const csv = mappingsToCsv([
      row({
        assignment_1_questions: ["Solar — Conventional", "Solar — Renewable over 25 years"],
      }),
    ]);
    const header = csv.split("\r\n")[0]!.split(",");
    expect(header).toContain("assignment_1_questions");
    expect(header.indexOf("assignment_1_questions")).toBeLessThan(
      header.indexOf("assignment_1_question_codes")
    );
    expect(csv).toContain("Solar — Conventional; Solar — Renewable over 25 years");
  });
});
