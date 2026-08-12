/**
 * Date-driven scheduling (migration 0029).
 *
 * `open_at`/`close_at` used to be columns nothing read: the form collected
 * them, the detail page printed them, and access was decided entirely by
 * whether a professor had pressed "Publish to students". These are the
 * cases the SQL predicates are written against — `assignment_accepts_answers`
 * and `attempt_is_workable` are the actual boundary, and the TypeScript here
 * exists so the UI cannot offer a link the RPC will then refuse. The two
 * have to agree, so they are tested against the same table of cases.
 *
 * The DB half is proved against real RLS in tests/integration/scheduling.
 */
import { describe, expect, it } from "vitest";
import {
  assignmentAcceptsAnswers,
  assignmentHasOpened,
  effectiveAssignmentStatus,
  isoToLocalInput,
  isScheduled,
  localInputToIso,
  type ScheduleWindow,
} from "@/lib/assignments/schedule";
import { canAnswerAssignment } from "@/lib/attempts/workable";
import { VALID_ASSIGNMENT_TRANSITIONS } from "@/lib/types/domain";

const OPENS = "2026-08-12T09:00:00.000Z";
const CLOSES = "2026-08-20T17:00:00.000Z";
const WINDOW: ScheduleWindow = { openAt: OPENS, closeAt: CLOSES };

const BEFORE = new Date("2026-08-11T23:59:59.000Z");
const DURING = new Date("2026-08-15T12:00:00.000Z");
const AFTER = new Date("2026-08-20T17:00:01.000Z");
const REOPENED_AT = "2026-08-21T09:00:00.000Z";

describe("assignmentAcceptsAnswers — a scheduled (READY) assignment", () => {
  it("refuses the class before the opening time", () => {
    expect(assignmentAcceptsAnswers("READY", WINDOW, BEFORE)).toBe(false);
  });

  it("admits the class inside the window", () => {
    expect(assignmentAcceptsAnswers("READY", WINDOW, DURING)).toBe(true);
  });

  it("refuses the class after the closing time", () => {
    expect(assignmentAcceptsAnswers("READY", WINDOW, AFTER)).toBe(false);
  });

  it("treats both bounds as inclusive — the closing minute is still inside", () => {
    expect(assignmentAcceptsAnswers("READY", WINDOW, new Date(OPENS))).toBe(true);
    expect(assignmentAcceptsAnswers("READY", WINDOW, new Date(CLOSES))).toBe(true);
  });

  it("stays shut when either date is missing — no schedule is not 'open to everyone'", () => {
    expect(assignmentAcceptsAnswers("READY", { openAt: null, closeAt: null }, DURING)).toBe(false);
    expect(assignmentAcceptsAnswers("READY", { openAt: OPENS, closeAt: null }, DURING)).toBe(false);
    expect(assignmentAcceptsAnswers("READY", { openAt: null, closeAt: CLOSES }, DURING)).toBe(false);
  });
});

describe("assignmentAcceptsAnswers — legacy OPEN assignments", () => {
  it("keeps a dateless OPEN assignment behaving exactly as before 0029", () => {
    expect(assignmentAcceptsAnswers("OPEN", { openAt: null, closeAt: null }, DURING)).toBe(true);
  });

  it("enforces the dates when an OPEN assignment has them", () => {
    expect(assignmentAcceptsAnswers("OPEN", WINDOW, BEFORE)).toBe(false);
    expect(assignmentAcceptsAnswers("OPEN", WINDOW, DURING)).toBe(true);
    expect(assignmentAcceptsAnswers("OPEN", WINDOW, AFTER)).toBe(false);
  });

  it("reads a missing bound as an absent bound, not as a closed door", () => {
    expect(assignmentAcceptsAnswers("OPEN", { openAt: OPENS, closeAt: null }, AFTER)).toBe(true);
    expect(assignmentAcceptsAnswers("OPEN", { openAt: null, closeAt: CLOSES }, BEFORE)).toBe(true);
  });
});

describe("assignmentAcceptsAnswers — statuses no date can rescue", () => {
  it("never admits DRAFT, CLOSED or ARCHIVED, whatever the window says", () => {
    for (const status of ["DRAFT", "CLOSED", "ARCHIVED"] as const) {
      expect(assignmentAcceptsAnswers(status, WINDOW, DURING), status).toBe(false);
    }
  });
});

describe("assignmentHasOpened", () => {
  it("is false for a scheduled assignment that has not opened yet", () => {
    expect(assignmentHasOpened("READY", WINDOW, BEFORE)).toBe(false);
  });

  it("stays true after the window has passed — receipts outlive the deadline", () => {
    expect(assignmentHasOpened("READY", WINDOW, AFTER)).toBe(true);
  });

  it("is true for anything published or retired the old way", () => {
    expect(assignmentHasOpened("OPEN", { openAt: null, closeAt: null }, DURING)).toBe(true);
    expect(assignmentHasOpened("CLOSED", { openAt: null, closeAt: null }, DURING)).toBe(true);
  });

  it("is false for DRAFT and ARCHIVED", () => {
    expect(assignmentHasOpened("DRAFT", WINDOW, DURING)).toBe(false);
    expect(assignmentHasOpened("ARCHIVED", WINDOW, DURING)).toBe(false);
  });
});

describe("canAnswerAssignment — the window gates a student the same way", () => {
  it("keeps a student out before the opening time even though status is READY", () => {
    expect(canAnswerAssignment("READY", null, WINDOW, BEFORE)).toBe(false);
    expect(
      canAnswerAssignment("READY", { state: "NOT_STARTED", reopenedAt: null }, WINDOW, BEFORE)
    ).toBe(false);
  });

  it("lets them in once the window opens", () => {
    expect(canAnswerAssignment("READY", null, WINDOW, DURING)).toBe(true);
    expect(
      canAnswerAssignment("READY", { state: "DRAFT", reopenedAt: null }, WINDOW, DURING)
    ).toBe(true);
  });

  it("locks them out again after the closing time, mid-draft included", () => {
    expect(
      canAnswerAssignment("READY", { state: "DRAFT", reopenedAt: null }, WINDOW, AFTER)
    ).toBe(false);
  });

  it("still lets a reopened student finish after the window shuts", () => {
    // The professor's one tool for "let this one person finish late". It
    // would have silently stopped working for every scheduled assignment
    // if the reopen exception had stayed keyed to status = CLOSED.
    expect(
      canAnswerAssignment("READY", { state: "REOPENED", reopenedAt: REOPENED_AT }, WINDOW, AFTER)
    ).toBe(true);
    expect(
      canAnswerAssignment("READY", { state: "DRAFT", reopenedAt: REOPENED_AT }, WINDOW, AFTER)
    ).toBe(true);
  });

  it("does not let a reopen forward-date access to an assignment that never opened", () => {
    expect(
      canAnswerAssignment("READY", { state: "REOPENED", reopenedAt: REOPENED_AT }, WINDOW, BEFORE)
    ).toBe(false);
  });

  it("sends a submitted student to their receipt whatever the window says", () => {
    expect(
      canAnswerAssignment("READY", { state: "SUBMITTED", reopenedAt: null }, WINDOW, DURING)
    ).toBe(false);
  });
});

describe("effectiveAssignmentStatus — what the professor is shown", () => {
  it("says Draft while the questions are still being edited", () => {
    const s = effectiveAssignmentStatus("DRAFT", { openAt: null, closeAt: null }, DURING);
    expect(s.kind).toBe("DRAFT");
    expect(s.label).toBe("Draft");
    expect(s.at).toBeNull();
    expect(s.studentsCanAnswer).toBe(false);
  });

  it("says Not scheduled for an approved assignment with no dates — not 'Ready to publish'", () => {
    const s = effectiveAssignmentStatus("READY", { openAt: null, closeAt: null }, DURING);
    expect(s.kind).toBe("NOT_SCHEDULED");
    expect(s.label).toBe("Not scheduled");
    expect(s.studentsCanAnswer).toBe(false);
  });

  it("says Not scheduled when only one of the two dates is set", () => {
    expect(
      effectiveAssignmentStatus("READY", { openAt: OPENS, closeAt: null }, DURING).kind
    ).toBe("NOT_SCHEDULED");
    expect(
      effectiveAssignmentStatus("READY", { openAt: null, closeAt: CLOSES }, DURING).kind
    ).toBe("NOT_SCHEDULED");
  });

  it("says Scheduled — opens <open_at> before the window", () => {
    const s = effectiveAssignmentStatus("READY", WINDOW, BEFORE);
    expect(s.kind).toBe("SCHEDULED");
    expect(s.label).toBe("Scheduled");
    expect(s.detail).toBe("opens");
    expect(s.at).toBe(OPENS);
    expect(s.studentsCanAnswer).toBe(false);
  });

  it("says Open until <close_at> inside the window, while the column still reads READY", () => {
    const s = effectiveAssignmentStatus("READY", WINDOW, DURING);
    expect(s.kind).toBe("OPEN");
    expect(s.label).toBe("Open");
    expect(s.detail).toBe("until");
    expect(s.at).toBe(CLOSES);
    expect(s.studentsCanAnswer).toBe(true);
  });

  it("says Closed — ended <close_at> after the window, while the column STILL reads READY", () => {
    const s = effectiveAssignmentStatus("READY", WINDOW, AFTER);
    expect(s.kind).toBe("WINDOW_PASSED");
    expect(s.label).toBe("Closed");
    expect(s.detail).toBe("ended");
    expect(s.at).toBe(CLOSES);
    expect(s.studentsCanAnswer).toBe(false);
  });

  it("says Open with no end date for a legacy OPEN assignment that has none", () => {
    const s = effectiveAssignmentStatus("OPEN", { openAt: null, closeAt: null }, DURING);
    expect(s.kind).toBe("OPEN");
    expect(s.detail).toBeNull();
    expect(s.at).toBeNull();
    expect(s.studentsCanAnswer).toBe(true);
  });

  it("says Closed for a retired assignment even if its window is still current", () => {
    const s = effectiveAssignmentStatus("CLOSED", WINDOW, DURING);
    expect(s.kind).toBe("CLOSED");
    expect(s.label).toBe("Closed");
    expect(s.studentsCanAnswer).toBe(false);
  });

  it("says Archived, and never anything else", () => {
    const s = effectiveAssignmentStatus("ARCHIVED", WINDOW, DURING);
    expect(s.kind).toBe("ARCHIVED");
    expect(s.label).toBe("Archived");
    expect(s.studentsCanAnswer).toBe(false);
  });

  it("agrees with assignmentAcceptsAnswers on every case it describes", () => {
    const cases: Array<[string, ScheduleWindow, Date]> = [
      ["DRAFT", WINDOW, DURING],
      ["READY", { openAt: null, closeAt: null }, DURING],
      ["READY", WINDOW, BEFORE],
      ["READY", WINDOW, DURING],
      ["READY", WINDOW, AFTER],
      ["OPEN", { openAt: null, closeAt: null }, DURING],
      ["OPEN", WINDOW, AFTER],
      ["CLOSED", WINDOW, DURING],
      ["ARCHIVED", WINDOW, DURING],
    ];
    for (const [status, window, now] of cases) {
      expect(
        effectiveAssignmentStatus(status, window, now).studentsCanAnswer,
        `${status} @ ${now.toISOString()}`
      ).toBe(assignmentAcceptsAnswers(status, window, now));
    }
  });
});

describe("isScheduled", () => {
  it("needs both bounds, and rejects an unparseable one", () => {
    expect(isScheduled(WINDOW)).toBe(true);
    expect(isScheduled({ openAt: OPENS, closeAt: null })).toBe(false);
    expect(isScheduled({ openAt: "not a date", closeAt: CLOSES })).toBe(false);
  });
});

describe("VALID_ASSIGNMENT_TRANSITIONS", () => {
  it("matches docs/DATABASE_SCHEMA.md exactly — nothing added, nothing missing", () => {
    expect(VALID_ASSIGNMENT_TRANSITIONS).toEqual({
      DRAFT: ["READY"],
      READY: ["DRAFT", "OPEN", "CLOSED"],
      OPEN: ["CLOSED"],
      CLOSED: ["OPEN", "READY", "ARCHIVED"],
      ARCHIVED: [],
    });
  });

  it("keeps ARCHIVED reachable now that scheduled assignments live at READY", () => {
    // READY -> CLOSED -> ARCHIVED. Without the first edge a scheduled
    // assignment could never be put away at all.
    expect(VALID_ASSIGNMENT_TRANSITIONS.READY).toContain("CLOSED");
    expect(VALID_ASSIGNMENT_TRANSITIONS.CLOSED).toContain("ARCHIVED");
  });

  it("lets a retired assignment be put back on the calendar", () => {
    expect(VALID_ASSIGNMENT_TRANSITIONS.CLOSED).toContain("READY");
  });

  it("still refuses to reach a student-visible status straight from DRAFT", () => {
    expect(VALID_ASSIGNMENT_TRANSITIONS.DRAFT).toEqual(["READY"]);
  });
});

describe("datetime-local <-> ISO", () => {
  it("round-trips through the ambient timezone without drifting", () => {
    const local = isoToLocalInput(CLOSES);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    // The input's resolution is the minute; CLOSES lands on one exactly,
    // so a correct round-trip returns the same instant.
    expect(localInputToIso(local)).toBe(CLOSES);
  });

  it("is idempotent over an already-local value, so the form's effect can't corrupt one", () => {
    const local = isoToLocalInput(OPENS);
    expect(isoToLocalInput(local)).toBe(local);
  });

  it("maps blank and unparseable input to blank, never to Invalid Date", () => {
    expect(isoToLocalInput(null)).toBe("");
    expect(isoToLocalInput("nonsense")).toBe("");
    expect(localInputToIso("")).toBe("");
    expect(localInputToIso("nonsense")).toBe("");
  });
});
