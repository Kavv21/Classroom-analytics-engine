import { describe, expect, it } from "vitest";
import { linkHostWarning, linkUrlError, LINK_WINDOW_NOTE } from "@/lib/assignments/link";
import { assignmentFormSchema } from "@/lib/assignments/schema";

const GRID_FORM = {
  title: "Assignment 1",
  description: "",
  instructions: "",
  assignmentStage: "PRE_INSTRUCTION" as const,
  sequencePosition: "FIRST" as const,
  openAt: "",
  closeAt: "",
  allowDraftEditing: true,
  allowResubmission: false,
  responseZeroLabel: "No (0)",
  responseOneLabel: "Yes (1)",
};

describe("linkUrlError — https only", () => {
  it.each([
    ["https://forms.gle/abc123", null],
    ["https://docs.google.com/forms/d/e/xyz/viewform", null],
    ["  https://forms.gle/abc  ", null],
    ["http://forms.gle/abc", "The link must start with https://"],
    ["ftp://example.com/form", "The link must start with https://"],
    ["javascript:alert(1)", "The link must start with https://"],
    ["forms.gle/abc", "That isn't a complete link — it should start with https://"],
    ["https://forms.gle/a b", "A link can't contain spaces"],
    ["", "Paste the link students should open"],
  ])("%j → %j", (url, expected) => {
    expect(linkUrlError(url)).toBe(expected);
  });
});

describe("linkHostWarning — warn, never block", () => {
  it("is quiet for the three Google hosts", () => {
    for (const url of [
      "https://docs.google.com/forms/d/x",
      "https://forms.gle/x",
      "https://drive.google.com/file/d/x",
    ]) {
      expect(linkHostWarning(url)).toBeNull();
    }
  });

  it("warns for any other https host but the URL is still valid", () => {
    const url = "https://www.surveymonkey.com/r/abc";
    expect(linkUrlError(url)).toBeNull();
    expect(linkHostWarning(url)).toContain("www.surveymonkey.com");
  });

  it("does not treat a look-alike host as Google", () => {
    expect(linkHostWarning("https://forms.gle.evil.example/x")).not.toBeNull();
  });
});

describe("assignmentFormSchema", () => {
  it("an existing grid payload, with no kind at all, is still valid and is GRID", () => {
    const parsed = assignmentFormSchema.safeParse(GRID_FORM);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.kind).toBe("GRID");
  });

  it("LINK without a URL is rejected", () => {
    const parsed = assignmentFormSchema.safeParse({ ...GRID_FORM, kind: "LINK", sequencePosition: "OTHER" });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.flatten().fieldErrors.linkUrl).toBeTruthy();
  });

  it("LINK with a non-https URL is rejected", () => {
    const parsed = assignmentFormSchema.safeParse({
      ...GRID_FORM, kind: "LINK", sequencePosition: "OTHER", linkUrl: "http://forms.gle/x",
    });
    expect(parsed.success).toBe(false);
  });

  it("GRID with a URL is rejected", () => {
    const parsed = assignmentFormSchema.safeParse({ ...GRID_FORM, linkUrl: "https://forms.gle/x" });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.flatten().fieldErrors.linkUrl).toBeTruthy();
  });

  it("LINK can't take the first or second position", () => {
    const parsed = assignmentFormSchema.safeParse({
      ...GRID_FORM, kind: "LINK", sequencePosition: "FIRST", linkUrl: "https://forms.gle/x",
    });
    expect(parsed.success).toBe(false);
    expect(!parsed.success && parsed.error.flatten().fieldErrors.sequencePosition).toBeTruthy();
  });

  it("accepts a valid LINK", () => {
    const parsed = assignmentFormSchema.safeParse({
      ...GRID_FORM, kind: "LINK", sequencePosition: "OTHER", linkUrl: "https://forms.gle/x",
    });
    expect(parsed.success).toBe(true);
  });
});

describe("professor-facing copy is honest about what the window does", () => {
  it("never claims closing hides or revokes the link", () => {
    expect(LINK_WINDOW_NOTE).toBe(
      "The open/close window controls when this appears to students. It does not stop anyone who already has the link — close the Form in Google when you're done."
    );
    expect(LINK_WINDOW_NOTE).not.toMatch(/hides?|revoke/i);
  });
});
