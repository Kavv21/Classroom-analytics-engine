/**
 * The reported bug: a professor reopened an assignment and the student
 * still could not answer it.
 *
 * Two separate dead ends caused it, and both are pinned here.
 *
 *  1. CLOSED was terminal-but-for-archiving. There was no way to put an
 *     assignment back in front of the class at all.
 *  2. Reopening a single ATTEMPT set the attempt to REOPENED without
 *     touching the assignment, and every student-side path required the
 *     assignment to be OPEN. The student saw "Reopened — submit again when
 *     you're ready" next to a Closed badge with no link.
 *
 * `canAnswerAssignment` is the UI half of the fix; `attempt_is_workable`
 * (migration 0023) is the enforced half. They have to agree, so the cases
 * below are deliberately the same cases the SQL predicate is written
 * against.
 */
import { describe, expect, it } from "vitest";
import { VALID_ASSIGNMENT_TRANSITIONS, type AssignmentStatus } from "@/lib/types/domain";
import { canAnswerAssignment } from "@/lib/attempts/workable";

const REOPENED_AT = "2026-08-02T12:00:00.000Z";

// The exact map (and the READY <-> CLOSED edges migration 0029 added for
// scheduled assignments) is asserted once, in assignment-schedule.test.ts.
// What matters here is the dead end this file was written about.
describe("VALID_ASSIGNMENT_TRANSITIONS", () => {
  it("lets a closed assignment be reopened to students", () => {
    expect(VALID_ASSIGNMENT_TRANSITIONS.CLOSED).toContain("OPEN");
  });

  it("keeps ARCHIVED terminal — that is the irreversible one", () => {
    expect(VALID_ASSIGNMENT_TRANSITIONS.ARCHIVED).toHaveLength(0);
  });

  it("never lets a student-visible status be reached from DRAFT directly", () => {
    expect(VALID_ASSIGNMENT_TRANSITIONS.DRAFT).toEqual(["READY"]);
  });
});

describe("canAnswerAssignment — open assignment", () => {
  it("lets a student start one they have never opened", () => {
    expect(canAnswerAssignment("OPEN", null)).toBe(true);
  });

  it("lets a student continue a draft", () => {
    expect(canAnswerAssignment("OPEN", { state: "DRAFT", reopenedAt: null })).toBe(true);
  });

  it("sends a submitted student to their receipt instead", () => {
    expect(canAnswerAssignment("OPEN", { state: "SUBMITTED", reopenedAt: null })).toBe(false);
    expect(canAnswerAssignment("OPEN", { state: "RESUBMITTED", reopenedAt: REOPENED_AT })).toBe(
      false
    );
  });
});

describe("canAnswerAssignment — closed assignment, attempt reopened", () => {
  it("lets the reopened student back in (the bug: this was false)", () => {
    expect(canAnswerAssignment("CLOSED", { state: "REOPENED", reopenedAt: REOPENED_AT })).toBe(
      true
    );
  });

  it("keeps them in once their first autosave moves REOPENED to DRAFT", () => {
    // The FSM has no REOPENED -> REOPENED edge: saving one cell makes the
    // attempt DRAFT. If DRAFT were excluded the student would be locked out
    // by their own first keystroke.
    expect(canAnswerAssignment("CLOSED", { state: "DRAFT", reopenedAt: REOPENED_AT })).toBe(true);
  });

  it("stops again the moment they resubmit", () => {
    expect(canAnswerAssignment("CLOSED", { state: "RESUBMITTED", reopenedAt: REOPENED_AT })).toBe(
      false
    );
  });
});

describe("canAnswerAssignment — closed assignment, attempt NOT reopened", () => {
  it("does not let an unreopened student answer just because they were drafting", () => {
    expect(canAnswerAssignment("CLOSED", { state: "DRAFT", reopenedAt: null })).toBe(false);
  });

  it("does not let a student who never opened it start after the close", () => {
    expect(canAnswerAssignment("CLOSED", null)).toBe(false);
    expect(canAnswerAssignment("CLOSED", { state: "NOT_STARTED", reopenedAt: null })).toBe(false);
  });
});

describe("canAnswerAssignment — statuses that are never answerable", () => {
  const neverAnswerable: AssignmentStatus[] = ["DRAFT", "READY", "ARCHIVED"];

  it("refuses every non-OPEN, non-CLOSED status even for a reopened attempt", () => {
    for (const status of neverAnswerable) {
      expect(
        canAnswerAssignment(status, { state: "REOPENED", reopenedAt: REOPENED_AT }),
        `${status} must not be answerable`
      ).toBe(false);
    }
  });
});
