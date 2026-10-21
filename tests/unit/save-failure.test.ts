import { describe, expect, it } from "vitest";
import {
  classifyAttemptError,
  describeSaveFailure,
  describeSubmitFailure,
  isTerminal,
  type AttemptFailureCode,
} from "@/lib/attempts/save-failure";

/** The RPCs' own wording (migration 0029), so a rewording there breaks this. */
describe("classifyAttemptError", () => {
  it.each([
    ["this assignment closed at 2026-10-22 09:30:00+00 — nothing more can be saved", "CLOSED"],
    ["this assignment closed at 2026-10-22 09:30:00+00 — it can no longer be submitted", "CLOSED"],
    ["the assignment is no longer open (status: CLOSED)", "CLOSED"],
    ["this assignment is not open yet — it opens at 2026-10-23", "NOT_OPEN_YET"],
    ["answers cannot be saved while the attempt is SUBMITTED — it has already been submitted", "ALREADY_SUBMITTED"],
    ["already submitted — this attempt was submitted at 2026-10-22", "ALREADY_SUBMITTED"],
    ["draft editing is disabled for this assignment — the answer for question x is already saved", "DRAFT_LOCKED"],
    ["attempt not found, or it is not yours", "NOT_YOURS"],
    ["question 1234 does not belong to this assignment (or is inactive)", "ASSIGNMENT_CHANGED"],
  ] as const)("%s → %s", (message, code) => {
    expect(classifyAttemptError({ code: "P0001", message })).toBe(code);
  });

  it("treats a permission error as terminal", () => {
    expect(classifyAttemptError({ code: "42501", message: "permission denied for function" })).toBe("NOT_YOURS");
  });

  it.each([
    [{ code: "57014", message: "canceling statement due to statement timeout" }],
    [{ code: "08006", message: "connection failure" }],
    [{ code: "PGRST301", message: "JWT expired" }],
    [{ code: "P0001", message: "not signed in" }],
    [{ message: "TypeError: fetch failed" }],
    [{ code: "", message: "" }],
    [null],
  ])("treats %j as transient", (error) => {
    expect(classifyAttemptError(error)).toBe("TEMPORARY");
  });
});

describe("student-facing sentences", () => {
  const codes: AttemptFailureCode[] = [
    "CLOSED", "NOT_OPEN_YET", "ALREADY_SUBMITTED", "DRAFT_LOCKED",
    "NOT_YOURS", "ASSIGNMENT_CHANGED", "FINAL_CHECK_FAILED", "TEMPORARY",
  ];

  it("never mention a server, a database, retrying, or a code", () => {
    for (const code of codes) {
      for (const text of [describeSaveFailure(code), describeSubmitFailure(code)]) {
        expect(text).not.toMatch(/server|database|retry|postgres|supabase|error|code|[A-Z]{2,}_[A-Z]/i);
      }
    }
  });

  it("only TEMPORARY is retried", () => {
    expect(codes.filter((c) => !isTerminal(c))).toEqual(["TEMPORARY"]);
  });
});
