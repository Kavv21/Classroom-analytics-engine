import { describe, expect, it } from "vitest";
import { VALID_ATTEMPT_TRANSITIONS } from "@/lib/types/domain";

describe("VALID_ATTEMPT_TRANSITIONS", () => {
  it("matches docs/DATABASE_SCHEMA.md exactly — nothing added, nothing missing", () => {
    expect(VALID_ATTEMPT_TRANSITIONS).toEqual({
      NOT_STARTED: ["DRAFT", "SUBMITTED"],
      DRAFT: ["DRAFT", "SUBMITTED"],
      SUBMITTED: ["REOPENED"],
      REOPENED: ["DRAFT", "RESUBMITTED"],
      RESUBMITTED: [],
    });
  });

  it("marks RESUBMITTED as terminal", () => {
    expect(VALID_ATTEMPT_TRANSITIONS.RESUBMITTED).toHaveLength(0);
  });

  it("never allows a student-visible path back from a submitted state except REOPENED", () => {
    expect(VALID_ATTEMPT_TRANSITIONS.SUBMITTED).toEqual(["REOPENED"]);
  });
});
