/**
 * How the answer grid saves, and what a student is told about it.
 *
 * The bug this file exists for: clicking "Review & submit" while the last
 * debounced save was still in flight showed "Your latest answers haven't
 * reached the server yet — hold on, we're retrying" with nothing failing
 * and nothing retrying, and the banner never cleared. flush() returned
 * early on an in-flight save instead of waiting for it.
 *
 * Also: the debounce has a maximum wait, transient failures retry silently
 * with backoff, terminal failures stop and say what happened, and no
 * student-visible text names a server, a database, retrying, or a code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnswerGrid } from "@/components/attempts/answer-grid";
import { SubmitAttemptButton } from "@/components/attempts/submit-attempt-button";
import { saveResponses, submitAttempt } from "@/lib/attempts/actions";
import { STILL_SAVING_MESSAGE } from "@/lib/attempts/save-failure";
import { A1_LAYOUT, A1_QUESTIONS, blankAnswers } from "./answer-grid-fixture";

vi.mock("@/lib/attempts/actions", () => ({
  saveResponses: vi.fn(),
  submitAttempt: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const save = vi.mocked(saveResponses);
const submit = vi.mocked(submitAttempt);

const OK = { success: true as const, data: { saved: 1, state: "DRAFT" as const, savedAt: "now" } };
const TEMPORARY = { success: false as const, error: STILL_SAVING_MESSAGE, code: "TEMPORARY" as const };

/** A save that answers after `ms`. */
function slowly<T>(value: T, ms: number): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

/** Anything a student must never read. */
const BACKEND_WORDS = /server|database|retry|retrying|postgres|supabase|pgrst|sqlstate|\b\d{5}\b|unexpected response|stack/i;

function renderGrid(allowDraftEditing = true) {
  return render(
    <AnswerGrid
      attemptId="attempt-1"
      assignmentTitle="Test assignment"
      instructions={null}
      layout={A1_LAYOUT}
      initialAnswers={blankAnswers(A1_QUESTIONS)}
      receiptPath="/assignments/a/receipt"
      allowDraftEditing={allowDraftEditing}
    />
  );
}

const firstCell = () => screen.getByRole("button", { name: /^Solar — Conventional/ });
const reviewButton = () => screen.getByRole("button", { name: /review & submit/i });
const reviewHeading = () => screen.queryByRole("heading", { name: /review your answers/i });

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

function visibleText(): string {
  return document.body.textContent ?? "";
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// ============================================================
describe("the Review & submit race", () => {
  it("click the last cell, open review while its save is in flight: no banner, review opens once it lands", async () => {
    save.mockImplementation(() => slowly(OK, 400));
    renderGrid();

    fireEvent.click(firstCell());
    await advance(900); // debounce fired at 800ms; the save is now in flight
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(reviewButton());
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(visibleText()).not.toMatch(/haven.t (reached|saved)/);

    await advance(400); // the in-flight save lands
    expect(reviewHeading()).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // Waiting on the in-flight save, not sending it twice.
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a change made while a save is in flight is sent before review opens", async () => {
    save.mockImplementation(() => slowly(OK, 400));
    renderGrid();

    fireEvent.click(firstCell());
    await advance(900);
    fireEvent.click(screen.getByRole("button", { name: /^Solar — Renewable/ }));
    await act(async () => {
      fireEvent.click(reviewButton());
    });
    await advance(1000);

    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1]![1]).toEqual([
      expect.objectContaining({ questionId: expect.any(String), value: 0 }),
    ]);
    expect(reviewHeading()).toBeTruthy();
  });

  it("opening review before the debounce fires saves at once and waits for it", async () => {
    save.mockImplementation(() => slowly(OK, 300));
    renderGrid();

    fireEvent.click(firstCell());
    await act(async () => {
      fireEvent.click(reviewButton());
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(reviewHeading()).toBeNull();

    await advance(300);
    expect(reviewHeading()).toBeTruthy();
  });
});

// ============================================================
describe("batching", () => {
  it("a student clicking faster than the debounce still saves every 2 seconds", async () => {
    save.mockImplementation(async () => OK);
    renderGrid();

    // 0.3s apart for 6s: the old pure debounce sent nothing at all.
    for (let i = 0; i < 20; i++) {
      fireEvent.click(firstCell());
      await advance(300);
    }
    expect(save.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(save.mock.calls.length).toBeLessThanOrEqual(4);
  });

  it("still sends one batch for a burst of edits", async () => {
    save.mockImplementation(async () => OK);
    renderGrid();

    fireEvent.click(firstCell());
    fireEvent.click(screen.getByRole("button", { name: /^Solar — Renewable/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Wind — Conventional/ }));
    await advance(1000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]![1]).toHaveLength(3);
  });

  it("focus leaving the grid saves straight away", async () => {
    save.mockImplementation(async () => OK);
    renderGrid();

    fireEvent.click(firstCell());
    fireEvent.blur(firstCell(), { relatedTarget: document.body });
    await advance(0);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("moving between cells does not save on every move", async () => {
    save.mockImplementation(async () => OK);
    renderGrid();

    fireEvent.click(firstCell());
    fireEvent.blur(firstCell(), {
      relatedTarget: screen.getByRole("button", { name: /^Solar — Renewable/ }),
    });
    await advance(0);
    expect(save).not.toHaveBeenCalled();
  });
});

// ============================================================
describe("transient failures", () => {
  it("retry silently: nothing but 'Saving…' until it lands, then 'Saved'", async () => {
    save
      .mockImplementationOnce(async () => TEMPORARY)
      .mockImplementationOnce(() => Promise.reject(new Error("An unexpected response was received from the server.")))
      .mockImplementation(async () => OK);
    renderGrid();

    fireEvent.click(firstCell());
    await advance(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Saving…")).toBeTruthy();

    await advance(10_000);
    expect(save).toHaveBeenCalledTimes(3);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(visibleText()).not.toMatch(BACKEND_WORDS);
  });

  it("only once retries are exhausted: one calm line, and it keeps trying — never a false 'Saved'", async () => {
    save.mockImplementation(async () => TEMPORARY);
    renderGrid();

    fireEvent.click(firstCell());
    await advance(5_000);
    expect(screen.queryByText(STILL_SAVING_MESSAGE)).toBeNull();

    await advance(60_000);
    expect(screen.getByText(STILL_SAVING_MESSAGE)).toBeTruthy();
    expect(screen.queryByText("Saved")).toBeNull();
    expect(visibleText()).not.toMatch(BACKEND_WORDS);

    const calls = save.mock.calls.length;
    await advance(60_000);
    expect(save.mock.calls.length).toBeGreaterThan(calls);

    // It lands: the line goes, "Saved" appears.
    save.mockImplementation(async () => OK);
    await advance(60_000);
    expect(screen.queryByText(STILL_SAVING_MESSAGE)).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();
  });
});

// ============================================================
describe("terminal failures", () => {
  it.each([
    ["CLOSED", /has closed/],
    ["ALREADY_SUBMITTED", /already been submitted/],
    ["DRAFT_LOCKED", /can.t be changed once it.s saved/],
    ["NOT_YOURS", /can.t be saved from this page/],
  ] as const)("%s stops retrying at once and says what happened", async (code, sentence) => {
    save.mockImplementation(async () => ({ success: false, error: "ignored", code }));
    renderGrid();

    fireEvent.click(firstCell());
    await advance(800);
    expect(save).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert").textContent).toMatch(sentence);

    await advance(120_000);
    expect(save).toHaveBeenCalledTimes(1);
    expect(visibleText()).not.toMatch(BACKEND_WORDS);
    expect(screen.queryByText(STILL_SAVING_MESSAGE)).toBeNull();
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("keeps the unsaved cell in this browser", async () => {
    save.mockImplementation(async () => ({ success: false, error: "x", code: "CLOSED" }));
    renderGrid();

    fireEvent.click(firstCell());
    await advance(800);
    expect(window.localStorage.getItem("attempt-pending-attempt-1")).toContain("q1");
  });
});

// ============================================================
describe("Review & submit is blocked until everything is saved", () => {
  it("does not open review while a save keeps failing, says so plainly, and clears when it lands", async () => {
    save.mockImplementation(async () => TEMPORARY);
    renderGrid();

    fireEvent.click(firstCell());
    await act(async () => {
      fireEvent.click(reviewButton());
    });
    await advance(0);

    expect(reviewHeading()).toBeNull();
    const notice = screen.getByRole("alert").textContent ?? "";
    expect(notice).toMatch(/can.t submit just now/);
    expect(notice).not.toMatch(BACKEND_WORDS);

    save.mockImplementation(async () => OK);
    await advance(5_000);
    expect(screen.queryByRole("alert")).toBeNull();

    await act(async () => {
      fireEvent.click(reviewButton());
    });
    expect(reviewHeading()).toBeTruthy();
  });

  it("the submit button refuses to submit when answers are still unsaved", async () => {
    vi.useRealTimers();
    const ensureSaved = vi.fn(async () => "Some answers haven't saved yet, so you can't submit just now.");
    render(
      <SubmitAttemptButton attemptId="attempt-1" receiptPath="/r" unansweredCount={0} ensureSaved={ensureSaved} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit assignment" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, submit now/i }));
    });

    expect(ensureSaved).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByText(/can.t submit just now/)).toBeTruthy();
  });

  it("a submission that never came back shows a plain sentence, not the framework's", async () => {
    vi.useRealTimers();
    submit.mockRejectedValue(new Error("An unexpected response was received from the server."));
    render(<SubmitAttemptButton attemptId="attempt-1" receiptPath="/r" unansweredCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: "Submit assignment" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, submit now/i }));
    });

    const text = visibleText();
    expect(text).toMatch(/didn.t go through/);
    expect(text).not.toMatch(BACKEND_WORDS);
  });
});

// ============================================================
describe("draft editing off", () => {
  it("locks a cell once its answer has saved, so no batch is sent that would be refused", async () => {
    save.mockImplementation(async () => OK);
    renderGrid(false);

    fireEvent.click(firstCell()); // blank -> 0
    await advance(1000);
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.click(firstCell()); // would be 0 -> 1: refused locally
    await advance(3000);
    expect(firstCell().getAttribute("data-answer")).toBe("0");
    expect(save).toHaveBeenCalledTimes(1);
  });
});
