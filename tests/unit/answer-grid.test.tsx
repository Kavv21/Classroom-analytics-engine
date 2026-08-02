/**
 * The live answer grid — layout, cell control, keyboard, accessibility.
 *
 * Two things are being pinned here. First, that the grid a student fills in
 * is the SOURCE SPREADSHEET'S grid: the same rows, the same columns and the
 * same order as the uploaded file, in both orientations, because the layout
 * is the professor-side response grid's (`detectOrientation`,
 * `buildGridMatrix`) and not a second implementation. Second, that a cell
 * cannot hold anything except blank, 0 or 1 — not "is validated to", but
 * has no reachable state that is anything else.
 *
 * The no-auto-submit guarantees for this component live in
 * tests/unit/no-auto-submit.test.tsx, next to the same guarantees for the
 * submit button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within, act } from "@testing-library/react";
import { AnswerGrid } from "@/components/attempts/answer-grid";
import { buildAnswerGrid } from "@/lib/attempts/answer-grid";
import {
  A1_LAYOUT,
  A1_QUESTIONS,
  A2_LAYOUT,
  A2_QUESTIONS,
  blankAnswers,
} from "./answer-grid-fixture";
import type { AnswerGridLayout } from "@/lib/attempts/answer-grid";
import type { ResponseValue } from "@/lib/types/domain";

vi.mock("@/lib/attempts/actions", () => ({
  saveResponses: vi.fn(async () => ({
    success: true,
    data: { saved: 1, state: "DRAFT", savedAt: new Date().toISOString() },
  })),
  submitAttempt: vi.fn(async () => ({ success: true, data: {} })),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderGrid(
  options: {
    layout?: AnswerGridLayout;
    answers?: Record<string, ResponseValue>;
    allowDraftEditing?: boolean;
  } = {}
) {
  const layout = options.layout ?? A1_LAYOUT;
  return render(
    <AnswerGrid
      attemptId="attempt-1"
      assignmentTitle="Test assignment"
      instructions={null}
      layout={layout}
      initialAnswers={options.answers ?? blankAnswers(A1_QUESTIONS)}
      receiptPath="/assignments/a/receipt"
      allowDraftEditing={options.allowDraftEditing ?? true}
    />
  );
}

const cell = (name: RegExp) => screen.getByRole("button", { name });

/** Focus a cell the way a click or a tab into the grid would. */
function focusCell(el: HTMLElement) {
  act(() => el.focus());
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});
afterEach(cleanup);

// ============================================================
// Layout — the source file's own grid
// ============================================================

describe("answer grid layout", () => {
  it("lays Assignment 1 out as sources down the rows, criteria across", () => {
    expect(A1_LAYOUT.orientation).toBe("SOURCES_IN_ROWS");
    expect(A1_LAYOUT.matrix.rowAxisHeading).toBe("Energy source");
    expect(A1_LAYOUT.matrix.rows.map((r) => r.label)).toEqual(["Solar", "Wind", "Coal"]);
    expect(A1_LAYOUT.matrix.columns.map((c) => c.label)).toEqual(["Conventional", "Renewable"]);
  });

  it("lays Assignment 2 out transposed — criteria down the rows, sources across", () => {
    expect(A2_LAYOUT.orientation).toBe("SOURCES_IN_COLUMNS");
    expect(A2_LAYOUT.matrix.rowAxisHeading).toBe("Criterion");
    expect(A2_LAYOUT.matrix.rows.map((r) => r.label)).toEqual(["Cost", "Emissions", "Reliability"]);
    expect(A2_LAYOUT.matrix.columns.map((c) => c.label)).toEqual(["Solar", "Wind"]);
  });

  it("orders rows by the source file's own cell references, not by arrival or the alphabet", () => {
    // The fixture declares Wind first and Coal in the middle; the sheet has
    // Solar (row 7), Wind (8), Coal (9).
    expect(A1_QUESTIONS[0]!.energy_source).toBe("Wind");
    const rendered = renderGrid();
    const rowHeaders = within(rendered.container)
      .getAllByRole("rowheader")
      .map((th) => th.textContent);
    expect(rowHeaders).toEqual(["Solar", "Wind", "Coal"]);
  });

  it("renders one cell control per question and nothing else in the body", () => {
    renderGrid();
    // 3 x 2 = 6 questions => 6 cell buttons.
    const cells = screen.getAllByRole("button").filter((b) => b.classList.contains("cell-toggle"));
    expect(cells).toHaveLength(A1_QUESTIONS.length);
  });

  it("leaves an intersection with no question as an empty cell, not a control", () => {
    // A sheet with a hole in it: Wind has no "Renewable" question.
    const sparse = buildAnswerGrid(A1_QUESTIONS.filter((q) => q.id !== "q3"));
    renderGrid({ layout: sparse, answers: blankAnswers(A1_QUESTIONS.filter((q) => q.id !== "q3")) });

    const cells = screen.getAllByRole("button").filter((b) => b.classList.contains("cell-toggle"));
    expect(cells).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /^Wind — Renewable/ })).toBeNull();
    expect(screen.getByText("No question at Wind — Renewable")).toBeTruthy();
  });
});

// ============================================================
// The cell control
// ============================================================

describe("cell control", () => {
  it("cycles blank → 0 → 1 → blank on click, and can reach no other state", () => {
    renderGrid();
    const target = () => cell(/^Solar — Conventional/);

    expect(target().getAttribute("data-answer")).toBe("blank");
    expect(target().getAttribute("aria-label")).toContain("not answered");

    fireEvent.click(target());
    expect(target().getAttribute("data-answer")).toBe("0");
    expect(target().textContent).toBe("0");

    fireEvent.click(target());
    expect(target().getAttribute("data-answer")).toBe("1");
    expect(target().textContent).toBe("1");

    fireEvent.click(target());
    expect(target().getAttribute("data-answer")).toBe("blank");
    // Full circle: the three states above are the whole state space, so
    // there is no way for this control to produce a value the DB CHECK
    // constraint would reject.
  });

  it("is a button, never a text field — nothing can be typed into a cell", () => {
    const { container } = renderGrid();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(container.querySelectorAll("textarea")).toHaveLength(0);
    expect(cell(/^Solar — Conventional/).tagName).toBe("BUTTON");
  });

  it("keyboard-activates the same cycle (Enter/Space are the button's own)", () => {
    renderGrid();
    const target = () => cell(/^Solar — Renewable/);
    // fireEvent.click is what both Enter and Space dispatch on a button.
    fireEvent.click(target());
    expect(target().getAttribute("data-answer")).toBe("0");
  });

  it("takes 0 and 1 directly, and Delete/Backspace to clear", () => {
    renderGrid();
    const target = () => cell(/^Wind — Conventional/);

    fireEvent.keyDown(target(), { key: "1" });
    expect(target().getAttribute("data-answer")).toBe("1");

    fireEvent.keyDown(target(), { key: "0" });
    expect(target().getAttribute("data-answer")).toBe("0");

    fireEvent.keyDown(target(), { key: "Delete" });
    expect(target().getAttribute("data-answer")).toBe("blank");

    fireEvent.keyDown(target(), { key: "1" });
    fireEvent.keyDown(target(), { key: "Backspace" });
    expect(target().getAttribute("data-answer")).toBe("blank");
  });

  it("refuses to change a cell that is already saved when draft editing is off", () => {
    renderGrid({
      allowDraftEditing: false,
      answers: { ...blankAnswers(A1_QUESTIONS), q1: 1 },
    });
    const locked = cell(/^Solar — Conventional/);
    expect(locked.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(locked);
    expect(cell(/^Solar — Conventional/).getAttribute("data-answer")).toBe("1");
    // Still focusable, so a locked cell cannot swallow keyboard navigation.
    expect(locked.hasAttribute("disabled")).toBe(false);
  });
});

// ============================================================
// Keyboard navigation
// ============================================================

describe("keyboard navigation", () => {
  it("moves between cells with the arrow keys", () => {
    renderGrid();
    const start = cell(/^Solar — Conventional/);
    focusCell(start);

    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(/^Solar — Renewable/));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(/^Wind — Renewable/));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell(/^Wind — Conventional/));

    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell(/^Solar — Conventional/));
  });

  it("stops at the edges instead of wrapping into the wrong row", () => {
    renderGrid();
    const start = cell(/^Solar — Conventional/);
    focusCell(start);
    fireEvent.keyDown(start, { key: "ArrowUp" });
    expect(document.activeElement).toBe(start);
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(start);
  });

  it("moves with Tab and Shift+Tab in the sheet's reading order", () => {
    renderGrid();
    const start = cell(/^Solar — Conventional/);
    focusCell(start);

    fireEvent.keyDown(start, { key: "Tab" });
    expect(document.activeElement).toBe(cell(/^Solar — Renewable/));
    // End of the row continues onto the next one, as a spreadsheet does.
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    expect(document.activeElement).toBe(cell(/^Wind — Conventional/));

    fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(cell(/^Solar — Renewable/));
  });

  it("lets Tab out of the grid at both ends — never a keyboard trap", () => {
    renderGrid();

    const first = cell(/^Solar — Conventional/);
    focusCell(first);
    const backOut = fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    // Not consumed: the browser's own focus order takes over from here.
    expect(backOut).toBe(true);

    const last = cell(/^Coal — Renewable/);
    focusCell(last);
    const forwardOut = fireEvent.keyDown(last, { key: "Tab" });
    expect(forwardOut).toBe(true);
  });

  it("jumps to the ends of a row with Home/End, and of the grid with Ctrl", () => {
    renderGrid();
    const start = cell(/^Wind — Conventional/);
    focusCell(start);

    fireEvent.keyDown(start, { key: "End" });
    expect(document.activeElement).toBe(cell(/^Wind — Renewable/));
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(document.activeElement).toBe(cell(/^Wind — Conventional/));

    fireEvent.keyDown(document.activeElement!, { key: "End", ctrlKey: true });
    expect(document.activeElement).toBe(cell(/^Coal — Renewable/));
    fireEvent.keyDown(document.activeElement!, { key: "Home", ctrlKey: true });
    expect(document.activeElement).toBe(cell(/^Solar — Conventional/));
  });

  it("keeps exactly one cell in the tab order (roving tabindex)", () => {
    renderGrid();
    const cells = screen.getAllByRole("button").filter((b) => b.classList.contains("cell-toggle"));
    expect(cells.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);

    const start = cell(/^Solar — Conventional/);
    focusCell(start);
    fireEvent.keyDown(start, { key: "ArrowRight" });

    const after = screen.getAllByRole("button").filter((b) => b.classList.contains("cell-toggle"));
    expect(after.filter((c) => c.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(cell(/^Solar — Renewable/).getAttribute("tabindex")).toBe("0");
  });
});

// ============================================================
// Accessibility
// ============================================================

describe("accessibility", () => {
  it("names every cell by its row and column, plus the value in words", () => {
    renderGrid({ answers: { ...blankAnswers(A1_QUESTIONS), q2: 1 } });

    expect(cell(/^Solar — Conventional/).getAttribute("aria-label")).toBe(
      "Solar — Conventional. not answered"
    );
    expect(cell(/^Solar — Renewable/).getAttribute("aria-label")).toBe(
      "Solar — Renewable. 1 — Yes (1)"
    );
  });

  it("names transposed cells by their own axes too", () => {
    renderGrid({ layout: A2_LAYOUT, answers: blankAnswers(A2_QUESTIONS) });
    expect(screen.getByRole("button", { name: /^Cost — Solar/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Reliability — Wind/ })).toBeTruthy();
  });

  it("spells out what 0 and 1 mean in text next to the grid", () => {
    const { container } = renderGrid();
    const legend = container.querySelector(".well")!;
    expect(legend.textContent).toContain("What the numbers mean");
    // The professor's own wording for each value, verbatim from the
    // question rows — not colour, not position.
    expect(legend.textContent).toContain("0 — No (0)");
    expect(legend.textContent).toContain("1 — Yes (1)");
    expect(legend.textContent).toContain("blank, not answered yet");
  });

  it("falls back to neutral wording when the questions disagree on the labels", () => {
    const mixed = buildAnswerGrid(
      A1_QUESTIONS.map((q, i) =>
        i === 0 ? { ...q, response_one_label: "Agree" } : q
      )
    );
    expect(mixed.legend).toBeNull();
    const { container } = renderGrid({ layout: mixed });
    expect(container.querySelector(".well")!.textContent).toContain("the second option");
  });

  it("gives the table a caption and header cells on both axes", () => {
    const { container } = renderGrid();
    expect(container.querySelector("caption")!.textContent).toContain("your answer sheet");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual([
      "Energy source",
      "Conventional",
      "Renewable",
    ]);
    expect(screen.getAllByRole("rowheader")).toHaveLength(3);
  });
});

// ============================================================
// Review step
// ============================================================

describe("review step", () => {
  it("counts answered and unanswered cells and lists the blank ones", async () => {
    renderGrid({ answers: { ...blankAnswers(A1_QUESTIONS), q1: 0, q2: 1 } });

    expect(screen.getByText(/Review & submit \(2 of 6 answered\)/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    });

    const summary = screen.getByText(/You have answered/).textContent ?? "";
    expect(summary).toContain("2");
    expect(summary).toContain("6");
    expect(summary).toContain("4");
    expect(summary).toContain("cells are still blank");

    // Each blank cell is named by where it is on the grid.
    expect(screen.getByText("Wind — Conventional")).toBeTruthy();
    expect(screen.getByText("Coal — Renewable")).toBeTruthy();
  });

  it("says so plainly when nothing is blank", async () => {
    renderGrid({
      answers: Object.fromEntries(A1_QUESTIONS.map((q) => [q.id, 1 as ResponseValue])),
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    });
    expect(screen.getByText(/Every cell has a 0 or a 1/)).toBeTruthy();
  });

  it("goes back to the grid with the answers intact", async () => {
    renderGrid({ answers: { ...blankAnswers(A1_QUESTIONS), q1: 1 } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: /back to the grid/i }));
    expect(cell(/^Solar — Conventional/).getAttribute("data-answer")).toBe("1");
  });
});
