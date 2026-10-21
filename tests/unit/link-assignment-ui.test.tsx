import { forwardRef, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AssignmentForm } from "@/components/assignments/assignment-form";
import { AssignmentAnalytics } from "@/components/analytics/assignment-analytics";
import { LinkAssignmentView } from "@/components/assignments/link-assignment-view";
import { LINK_NO_RESPONSES, LINK_RESPONSES_NOTE, LINK_WINDOW_NOTE } from "@/lib/assignments/link";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
// Charts are not what these tests are about; ECharts needs a real canvas.
vi.mock("@/components/analytics/chart-card", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/analytics/chart-card")>()),
  ChartCard: ({ title }: { title: string }) => <section data-testid="chart">{title}</section>,
}));
// Radix's Select measures itself.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
// Next runs React 19 (refs are props); vitest runs React 18 — see
// add-students-dialog.test.tsx for the same shim.
vi.mock("@/components/ui/input", () => ({
  Input: forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input(props, ref) {
    return <input ref={ref} {...props} />;
  }),
}));

afterEach(cleanup);

describe("AssignmentForm type choice", () => {
  function renderForm(defaultValues = {}) {
    const onSubmitAction = vi.fn(async () => ({ success: true as const, data: { id: "a1" } }));
    render(
      <AssignmentForm
        onSubmitAction={onSubmitAction}
        submitLabel="Create assignment"
        redirectBasePath="/classes/c/assignments"
        defaultValues={defaultValues}
      />
    );
    return onSubmitAction;
  }

  it("defaults to a question grid and shows exactly what it always did", () => {
    renderForm();
    expect((screen.getByLabelText(/Question grid/) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText("Form link")).toBeNull();
    expect(screen.getByLabelText("Which assignment is this?")).toBeTruthy();
    expect(screen.getByLabelText("Label for 0")).toBeTruthy();
    expect(screen.getByText("Allow draft editing")).toBeTruthy();
  });

  it("choosing a Google Form link shows one URL field and the two notes, and hides the grid-only fields", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/Google Form link/));

    expect(screen.getByLabelText("Form link")).toBeTruthy();
    expect(screen.getByText(LINK_RESPONSES_NOTE)).toBeTruthy();
    expect(screen.getAllByText(LINK_WINDOW_NOTE, { exact: false }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Label for 0")).toBeNull();
    expect(screen.queryByText("Allow draft editing")).toBeNull();
    // Position is pinned to "other", not offered.
    expect(screen.queryByLabelText("Which assignment is this?")).toBeNull();
    expect(screen.getByText(/A Form link can.t be the first or second assignment/)).toBeTruthy();
  });

  it("warns, without blocking, for a link outside the Google hosts", () => {
    renderForm();
    fireEvent.click(screen.getByLabelText(/Google Form link/));
    fireEvent.change(screen.getByLabelText("Form link"), {
      target: { value: "https://example.org/survey" },
    });
    expect(screen.getByText(/isn.t a Google Forms, Docs or Drive link/)).toBeTruthy();
  });

  it("an existing link assignment opens in link mode with its URL", () => {
    renderForm({ kind: "LINK", linkUrl: "https://forms.gle/abc", sequencePosition: "OTHER" });
    expect((screen.getByLabelText("Form link") as HTMLInputElement).value).toBe("https://forms.gle/abc");
  });
});

describe("AssignmentAnalytics", () => {
  const assignments = [
    { id: "grid", title: "Assignment 1", sequenceNumber: 1, kind: "GRID" as const },
    { id: "link", title: "Feedback form", sequenceNumber: 3, kind: "LINK" as const },
  ];

  it("a grid assignment still gets its charts", () => {
    render(<AssignmentAnalytics assignments={assignments} questionSummaries={[]} progress={[]} timeline={[]} />);
    expect(screen.getAllByTestId("chart").length).toBeGreaterThan(0);
    expect(screen.queryByText(LINK_NO_RESPONSES)).toBeNull();
  });

  it("a link assignment shows the plain empty state instead of empty charts", () => {
    render(<AssignmentAnalytics assignments={assignments} questionSummaries={[]} progress={[]} timeline={[]} />);
    fireEvent.change(screen.getByLabelText("Assignment"), { target: { value: "link" } });
    expect(screen.getByText(LINK_NO_RESPONSES)).toBeTruthy();
    expect(screen.queryAllByTestId("chart")).toHaveLength(0);
  });
});

describe("LinkAssignmentView", () => {
  it("shows title, description and an Open button to the Form in a new tab — nothing to submit", () => {
    render(
      <LinkAssignmentView
        title="Feedback form"
        description="Tell us what you think."
        instructions={null}
        linkUrl="https://forms.gle/abc"
        closeAt={null}
      />
    );
    expect(screen.getByRole("heading", { name: "Feedback form" })).toBeTruthy();
    expect(screen.getByText("Tell us what you think.")).toBeTruthy();
    const open = screen.getByRole("link", { name: /Open/ });
    expect(open.getAttribute("href")).toBe("https://forms.gle/abc");
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
    expect(screen.queryByRole("grid")).toBeNull();
  });
});
