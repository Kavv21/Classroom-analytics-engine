import { forwardRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AddStudentsDialog } from "@/components/roster/add-students-dialog";
import { addStudentsManually } from "@/lib/roster/actions";
import type { ManualStudentRowInput } from "@/lib/roster/manual";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/roster/actions", () => ({ addStudentsManually: vi.fn() }));
// The app runs on Next's bundled React 19, where a function component
// receives `ref` as a prop, so components/ui/input needs no forwardRef.
// Vitest runs React 18, which drops it — and react-hook-form's register()
// needs that ref. Same markup, ref forwarded.
vi.mock("@/components/ui/input", () => ({
  Input: forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(props, ref) {
    return <input ref={ref} {...props} />;
  }),
}));

const action = vi.mocked(addStudentsManually);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function fill(fieldset: HTMLElement, label: string, value: string) {
  fireEvent.change(within(fieldset).getByLabelText(new RegExp(`^${label}`)), {
    target: { value },
  });
}

function rowsOnScreen() {
  return screen.getAllByRole("group", { name: /^Student \d+$/ });
}

describe("AddStudentsDialog", () => {
  it("starts with one row; rows can be added and removed but never below one", () => {
    render(<AddStudentsDialog classId="class-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));

    expect(rowsOnScreen()).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Remove student 1" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByLabelText(/role/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add another row" }));
    expect(rowsOnScreen()).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Remove student 2" }));
    expect(rowsOnScreen()).toHaveLength(1);
  });

  it("sends the valid rows even when another row is invalid, clears what was added, keeps what failed", async () => {
    action.mockImplementation(async (_classId, rows: ManualStudentRowInput[]) => ({
      success: true,
      data: {
        added: 1,
        needsAttention: 1,
        results: [
          {
            key: rows[0]!.key,
            email: rows[0]!.email,
            fullName: "Asha Patel",
            status: "added",
            outcome: "PROVISIONED",
            message: "Asha Patel can sign in now.",
          },
          {
            key: rows[1]!.key,
            email: rows[1]!.email,
            fullName: "Bad Row",
            status: "failed",
            outcome: "CLIENT_INVALID",
            message: "Not a valid email address",
            fieldErrors: { email: "Not a valid email address" },
          },
        ],
      },
    }));

    render(<AddStudentsDialog classId="class-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    fireEvent.click(screen.getByRole("button", { name: "Add another row" }));

    const [first, second] = rowsOnScreen();
    fill(first!, "Full name", "Asha Patel");
    fill(first!, "Email", "asha@ahduni.edu.in");
    fill(second!, "Full name", "Bad Row");
    fill(second!, "Email", "not-an-email");

    fireEvent.click(screen.getByRole("button", { name: "Add 2 students" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    const [classId, sent] = action.mock.calls[0]!;
    expect(classId).toBe("class-1");
    expect(sent.map((r) => r.fullName)).toEqual(["Asha Patel", "Bad Row"]);
    expect(sent.every((r) => !("role" in r) && !("intendedRole" in r))).toBe(true);

    expect(await screen.findByText("1 added, 1 needs attention")).toBeTruthy();
    expect(screen.getByText("Asha Patel can sign in now.")).toBeTruthy();

    const remaining = rowsOnScreen();
    expect(remaining).toHaveLength(1);
    expect((within(remaining[0]!).getByLabelText(/^Full name/) as HTMLInputElement).value).toBe("Bad Row");
    expect(within(remaining[0]!).getAllByText("Not a valid email address").length).toBeGreaterThan(0);
    expect(refresh).toHaveBeenCalled();
  });

  it("closes when every row went through", async () => {
    action.mockImplementation(async (_classId, rows: ManualStudentRowInput[]) => ({
      success: true,
      data: {
        added: 1,
        needsAttention: 0,
        results: [
          {
            key: rows[0]!.key,
            email: rows[0]!.email,
            fullName: "Asha Patel",
            status: "added",
            outcome: "PENDING_SIGNUP",
            message: "Asha Patel added. They'll be set up at their first Google sign-in.",
          },
        ],
      },
    }));

    render(<AddStudentsDialog classId="class-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    const [row] = rowsOnScreen();
    fill(row!, "Full name", "Asha Patel");
    fill(row!, "Email", "asha@ahduni.edu.in");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add student" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("ignores blank rows and does not call the server when nothing is filled in", async () => {
    render(<AddStudentsDialog classId="class-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Add student" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Add student" }));

    expect(await screen.findByText("Fill in at least one student.")).toBeTruthy();
    expect(action).not.toHaveBeenCalled();
  });
});
