import { describe, expect, it } from "vitest";
import { csvEscape } from "@/lib/exports/csv";

/**
 * The rule these tests pin: a CSV field is quoted only when it has to be,
 * and an embedded quote is doubled rather than stripped — a mangled cell
 * would silently misreport a professor's own data.
 */

describe("csvEscape", () => {
  it("leaves an ordinary value untouched", () => {
    expect(csvEscape("plain")).toBe("plain");
  });

  it("quotes and doubles embedded quotes", () => {
    expect(csvEscape('say "hi", ok')).toBe('"say ""hi"", ok"');
  });

  it("quotes a value containing a newline", () => {
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });

  it("quotes a value containing a carriage return", () => {
    expect(csvEscape("line1\r\nline2")).toBe('"line1\r\nline2"');
  });

  it("passes an empty value through unquoted", () => {
    expect(csvEscape("")).toBe("");
  });
});
