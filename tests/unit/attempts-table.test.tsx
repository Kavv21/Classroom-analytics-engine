/**
 * The professor's reopen controls.
 *
 * Both gestures are per assignment, and this pins the part of that which
 * lives in the browser: the row action sends the assignment id alongside
 * the attempt id (the RPC refuses the call if they don't match — migration
 * 0024), and the bulk action sends only this assignment's id and asks for
 * confirmation before it does.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AttemptsTable, type AttemptTableRow } from "@/components/assignments/attempts-table";
import { reopenAllAttempts, reopenAttempt } from "@/lib/attempts/actions";

vi.mock("@/lib/attempts/actions", () => ({
  reopenAttempt: vi.fn(async () => ({
    success: true,
    data: { attemptId: "attempt-1", state: "REOPENED" },
  })),
  reopenAllAttempts: vi.fn(async () => ({
    success: true,
    data: { assignmentId: "assignment-x", reopened: 2 },
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const CLASS_ID = "class-1";
const ASSIGNMENT_ID = "assignment-x";

function row(overrides: Partial<AttemptTableRow> & { id: string }): AttemptTableRow {
  return {
    state: "SUBMITTED",
    submitted_at: "2026-08-01T10:00:00.000Z",
    reopened_at: null,
    submission_version: 1,
    studentName: "Student",
    studentEmail: "student@example.edu",
    ...overrides,
  };
}

function renderTable(attempts: AttemptTableRow[]) {
  return render(
    <AttemptsTable classId={CLASS_ID} assignmentId={ASSIGNMENT_ID} attempts={attempts} />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("row-level reopen", () => {
  it("names the assignment as well as the attempt", async () => {
    renderTable([row({ id: "attempt-1" })]);

    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));

    await waitFor(() =>
      expect(reopenAttempt).toHaveBeenCalledWith("attempt-1", CLASS_ID, ASSIGNMENT_ID)
    );
  });

  it("is offered only for a submitted attempt", () => {
    renderTable([
      row({ id: "a", state: "DRAFT", studentName: "Drafting" }),
      row({ id: "b", state: "RESUBMITTED", studentName: "Resubmitted" }),
      row({ id: "c", state: "NOT_STARTED", studentName: "Not started" }),
    ]);

    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull();
  });
});

describe("bulk reopen", () => {
  it("confirms first, then reopens this assignment only", async () => {
    renderTable([row({ id: "a" }), row({ id: "b", studentName: "Other" })]);

    fireEvent.click(screen.getByRole("button", { name: "Reopen for all students" }));
    expect(reopenAllAttempts).not.toHaveBeenCalled();

    // The confirmation says what it will and will not touch.
    expect(screen.getByText(/this assignment only/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Yes, reopen for all students" }));
    await waitFor(() => expect(reopenAllAttempts).toHaveBeenCalledWith(CLASS_ID, ASSIGNMENT_ID));
    expect(reopenAllAttempts).toHaveBeenCalledTimes(1);
  });

  it("can be cancelled without reopening anything", () => {
    renderTable([row({ id: "a" })]);

    fireEvent.click(screen.getByRole("button", { name: "Reopen for all students" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(reopenAllAttempts).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Reopen for all students" })).toBeTruthy();
  });

  it("is not offered when nothing has been submitted", () => {
    renderTable([
      row({ id: "a", state: "DRAFT" }),
      row({ id: "b", state: "RESUBMITTED" }),
    ]);

    expect(screen.queryByRole("button", { name: "Reopen for all students" })).toBeNull();
  });
});
