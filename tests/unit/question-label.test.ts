import { describe, expect, it } from "vitest";
import {
  isCodeOnlyLabel,
  questionLabel,
  questionLabelWithCode,
} from "@/lib/ui/question-label";

/**
 * The rule these tests pin: a human-facing surface never identifies a
 * question by its `external_question_code` alone, and the label is never
 * composed wording — only stored fields, chosen in a fixed order.
 */

describe("questionLabel", () => {
  it("prefers the stored wording, verbatim", () => {
    expect(
      questionLabel({
        questionText: "Solar — Renewable over 25 years",
        energySource: "Solar",
        criterion: "Renewable over 25 years",
        code: "A1-002",
      })
    ).toBe("Solar — Renewable over 25 years");
  });

  it("falls back to energy source + criterion, not to the code", () => {
    expect(
      questionLabel({ questionText: null, energySource: "Wind", criterion: "Conventional", code: "A1-003" })
    ).toBe("Wind — Conventional");
  });

  it("uses whichever single field is present before the code", () => {
    expect(questionLabel({ energySource: "Wind", code: "A1-003" })).toBe("Wind");
    expect(questionLabel({ criterion: "Conventional", code: "A1-003" })).toBe("Conventional");
  });

  it("treats whitespace-only wording as absent", () => {
    expect(
      questionLabel({ questionText: "   ", energySource: "Solar", criterion: "Conventional" })
    ).toBe("Solar — Conventional");
  });

  it("returns the code only when nothing readable is stored", () => {
    expect(questionLabel({ code: "A2-088" })).toBe("A2-088");
    expect(isCodeOnlyLabel({ code: "A2-088" })).toBe(true);
    expect(isCodeOnlyLabel({ questionText: "Solar — Conventional", code: "A1-001" })).toBe(false);
  });

  it("never invents wording — an empty question yields an empty label", () => {
    expect(questionLabel({})).toBe("");
  });
});

describe("questionLabelWithCode", () => {
  it("leads with the wording and parenthesises the code", () => {
    expect(
      questionLabelWithCode({ questionText: "Solar — Conventional", code: "A1-001" })
    ).toBe("Solar — Conventional (A1-001)");
  });

  it("does not repeat the code when that is all there is", () => {
    expect(questionLabelWithCode({ code: "A2-088" })).toBe("A2-088");
  });

  it("omits the bracket when there is no code", () => {
    expect(questionLabelWithCode({ questionText: "Solar — Conventional" })).toBe(
      "Solar — Conventional"
    );
  });
});
