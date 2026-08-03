/**
 * The reported bug: reopening one student's Assignment 2 attempt also let
 * them re-attempt Assignment 1, which nobody had reopened.
 *
 * The root cause was in the database boundary (see migration 0024 and
 * tests/integration/reopen-scope.test.ts, which proves it against real
 * RLS). What this file pins is the rule the UI states in one place: the
 * answer to "can this student work on this assignment right now" is a
 * function of exactly ONE row — the assignment_attempts row for that
 * (assignment_id, student_id) pair, which is unique by constraint — and of
 * nothing else in the student's history.
 *
 * So the cases below are a matrix, not a list: two assignments × two
 * students, one pair reopened, every other cell asserted unchanged.
 */
import { describe, expect, it } from "vitest";
import { canAnswerAssignment, type WorkableAttempt } from "@/lib/attempts/workable";
import type { AssignmentStatus, AttemptState } from "@/lib/types/domain";

interface AttemptRow extends WorkableAttempt {
  assignmentId: string;
  studentId: string;
}

const ASSIGNMENTS: Record<string, AssignmentStatus> = { X: "CLOSED", Y: "CLOSED" };

function submitted(assignmentId: string, studentId: string): AttemptRow {
  return { assignmentId, studentId, state: "SUBMITTED", reopenedAt: null };
}

/** Everyone has submitted both assignments; nothing is reopened yet. */
function fresh(): AttemptRow[] {
  return [
    submitted("X", "A"),
    submitted("Y", "A"),
    submitted("X", "B"),
    submitted("Y", "B"),
  ];
}

/**
 * The lookup every gate does: the student's list page, the answering
 * route, the receipt route and the RPCs all resolve the attempt by BOTH
 * ids. Written once here so a test can't accidentally assert against a
 * looser lookup than the app's.
 */
function attemptFor(rows: AttemptRow[], assignmentId: string, studentId: string) {
  return rows.find((r) => r.assignmentId === assignmentId && r.studentId === studentId) ?? null;
}

function canWork(rows: AttemptRow[], assignmentId: string, studentId: string): boolean {
  return canAnswerAssignment(
    ASSIGNMENTS[assignmentId]!,
    attemptFor(rows, assignmentId, studentId)
  );
}

/** What reopen_attempt / reopen_assignment_attempts do: one row, or one
 *  assignment's rows — never a student's whole history. */
function reopenPair(rows: AttemptRow[], assignmentId: string, studentId: string): AttemptRow[] {
  return rows.map((r) =>
    r.assignmentId === assignmentId && r.studentId === studentId && r.state === "SUBMITTED"
      ? { ...r, state: "REOPENED" as AttemptState, reopenedAt: "2026-08-03T10:00:00.000Z" }
      : r
  );
}

function reopenAssignment(rows: AttemptRow[], assignmentId: string): AttemptRow[] {
  return rows.map((r) =>
    r.assignmentId === assignmentId && r.state === "SUBMITTED"
      ? { ...r, state: "REOPENED" as AttemptState, reopenedAt: "2026-08-03T10:00:00.000Z" }
      : r
  );
}

describe("a submitted attempt is locked until it is reopened", () => {
  it("locks every pair while nothing is reopened", () => {
    const rows = fresh();
    for (const assignment of ["X", "Y"]) {
      for (const student of ["A", "B"]) {
        expect(canWork(rows, assignment, student), `${student} on ${assignment}`).toBe(false);
      }
    }
  });
});

describe("reopening student A on assignment X", () => {
  const rows = reopenPair(fresh(), "X", "A");

  it("lets student A back into assignment X", () => {
    expect(canWork(rows, "X", "A")).toBe(true);
  });

  it("does NOT unlock student A's attempt on assignment Y — the reported bug", () => {
    expect(canWork(rows, "Y", "A")).toBe(false);
  });

  it("does NOT unlock student B's attempt on assignment X", () => {
    expect(canWork(rows, "X", "B")).toBe(false);
  });

  it("leaves the fourth cell (student B, assignment Y) alone", () => {
    expect(canWork(rows, "Y", "B")).toBe(false);
  });

  it("locks again the moment student A resubmits", () => {
    const afterResubmit = rows.map((r) =>
      r.assignmentId === "X" && r.studentId === "A"
        ? { ...r, state: "RESUBMITTED" as AttemptState, reopenedAt: null }
        : r
    );
    expect(canWork(afterResubmit, "X", "A")).toBe(false);
    // ...and resubmitting changed nothing for anyone else either.
    expect(canWork(afterResubmit, "Y", "A")).toBe(false);
    expect(canWork(afterResubmit, "X", "B")).toBe(false);
  });
});

describe("reopening assignment X for ALL students", () => {
  const rows = reopenAssignment(fresh(), "X");

  it("lets every student back into assignment X", () => {
    expect(canWork(rows, "X", "A")).toBe(true);
    expect(canWork(rows, "X", "B")).toBe(true);
  });

  it("does not touch assignment Y for anybody", () => {
    expect(canWork(rows, "Y", "A")).toBe(false);
    expect(canWork(rows, "Y", "B")).toBe(false);
  });
});

describe("the gate reads one row and only one row", () => {
  it("is unaffected by any state the student's other attempts are in", () => {
    const otherStates: AttemptState[] = [
      "NOT_STARTED",
      "DRAFT",
      "SUBMITTED",
      "REOPENED",
      "RESUBMITTED",
    ];

    for (const state of otherStates) {
      const rows = fresh().map((r) =>
        r.assignmentId === "Y" && r.studentId === "A"
          ? { ...r, state, reopenedAt: "2026-08-03T10:00:00.000Z" }
          : r
      );
      expect(
        canWork(rows, "X", "A"),
        `student A's assignment-X attempt must stay locked while their assignment-Y attempt is ${state}`
      ).toBe(false);
    }
  });

  it("treats a student with no attempt on a closed assignment as locked out", () => {
    const rows = fresh().filter((r) => !(r.assignmentId === "X" && r.studentId === "A"));
    expect(canWork(rows, "X", "A")).toBe(false);
  });
});
