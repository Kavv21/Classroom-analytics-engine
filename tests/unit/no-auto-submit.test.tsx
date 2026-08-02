/**
 * HARD REQUIREMENT (EXCLUDED_FEATURES.md, spec section 10 — zero tolerance):
 * no browser activity may ever trigger an automatic submission. These tests
 * mount the real answering UI — the live answer grid — and the real submit
 * button, fire every excluded browser event — tab switch
 * (visibilitychange), blur/minimize, refresh signals
 * (beforeunload/pagehide), fullscreen exit, navigation (popstate),
 * disconnect/reconnect (offline/online) — and prove the submit action is
 * NEVER called. They also verify the component registers no listeners for
 * any of those events in the first place (the only global listener allowed
 * is `online`, which retries pending SAVES), and that submission happens
 * only through explicit clicks.
 *
 * WHAT CHANGED WITH THE GRID. The old one-question runner and the CSV
 * upload wizard are gone, and their coverage here did not simply move
 * across — it was rewritten against the grid, because the risk has a
 * different shape. The grid's danger is that a cell edit is now one
 * keystroke among hundreds and the review step lives inside the same
 * component as the answering surface, so "reaching review" must not be
 * allowed to slide into "submitting". The events, the forbidden-listener
 * list and the two-click contract are unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { AnswerGrid } from "@/components/attempts/answer-grid";
import { SubmitAttemptButton } from "@/components/attempts/submit-attempt-button";
import { saveResponses, submitAttempt } from "@/lib/attempts/actions";
import { A1_LAYOUT, A1_QUESTIONS, blankAnswers } from "./answer-grid-fixture";

vi.mock("@/lib/attempts/actions", () => ({
  saveResponses: vi.fn(async () => ({
    success: true,
    data: { saved: 1, state: "DRAFT", savedAt: new Date().toISOString() },
  })),
  submitAttempt: vi.fn(async () => ({
    success: true,
    data: {
      attemptId: "attempt-1",
      state: "SUBMITTED",
      submittedAt: new Date().toISOString(),
      submissionVersion: 1,
      answered: 1,
      totalQuestions: 6,
    },
  })),
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

function renderGrid() {
  return render(
    <AnswerGrid
      attemptId="attempt-1"
      assignmentTitle="Test assignment"
      instructions={null}
      layout={A1_LAYOUT}
      initialAnswers={blankAnswers(A1_QUESTIONS)}
      receiptPath="/assignments/a/receipt"
      allowDraftEditing={true}
    />
  );
}

/** The first cell of the grid — "Solar — Conventional". */
function firstCell() {
  return screen.getByRole("button", { name: /^Solar — Conventional/ });
}

/** Every excluded browser behaviour, as firable events. */
function fireAllExcludedEvents() {
  // Tab switch / minimise: visibilitychange with document.hidden = true.
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  fireEvent(document, new Event("visibilitychange", { bubbles: true }));

  // Window blur / focus loss.
  fireEvent(window, new Event("blur"));
  fireEvent(document, new Event("blur"));

  // Leaving fullscreen.
  fireEvent(document, new Event("fullscreenchange", { bubbles: true }));

  // Refresh / navigate away signals.
  fireEvent(window, new Event("beforeunload", { cancelable: true }));
  fireEvent(window, new Event("pagehide"));
  fireEvent(window, new PopStateEvent("popstate"));

  // Temporary disconnection and reconnection.
  fireEvent(window, new Event("offline"));
  fireEvent(window, new Event("online"));

  // Come back to the tab.
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  fireEvent(document, new Event("visibilitychange", { bubbles: true }));
  fireEvent(window, new Event("focus"));
}

const FORBIDDEN_LISTENERS = [
  "visibilitychange",
  "blur",
  "focusout",
  "fullscreenchange",
  "webkitfullscreenchange",
  "beforeunload",
  "pagehide",
  "unload",
  "freeze",
];

describe("no automatic submission — answer grid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("registers no listeners for tab-switch/blur/fullscreen/unload events", () => {
    const windowSpy = vi.spyOn(window, "addEventListener");
    const documentSpy = vi.spyOn(document, "addEventListener");

    renderGrid();

    const registered = [
      ...windowSpy.mock.calls.map((c) => c[0]),
      ...documentSpy.mock.calls.map((c) => c[0]),
    ];
    for (const forbidden of FORBIDDEN_LISTENERS) {
      expect(registered, `no listener for "${forbidden}" may be registered`).not.toContain(
        forbidden
      );
    }
    // The one allowed global listener: reconnect-retry for SAVES.
    expect(windowSpy.mock.calls.map((c) => c[0])).toContain("online");

    windowSpy.mockRestore();
    documentSpy.mockRestore();
  });

  it("never submits on tab switch, blur, refresh, fullscreen exit, navigation, or disconnect — even mid-draft", async () => {
    renderGrid();

    // Fill a cell so there is a dirty draft in flight — the riskiest
    // moment for an over-eager "submit on leave" implementation.
    fireEvent.click(firstCell());

    fireAllExcludedEvents();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    fireAllExcludedEvents();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(submitAttempt).not.toHaveBeenCalled();
    // Navigation to the receipt was never forced either.
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("never submits when the excluded events land on the review step", async () => {
    renderGrid();

    fireEvent.click(firstCell());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // Reaching review is a navigation inside the component, and it is the
    // one place a submit call physically exists. Getting there must not
    // submit, and neither must anything the browser does afterwards.
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    });
    expect(screen.getByRole("heading", { name: /review your answers/i })).toBeTruthy();
    expect(submitAttempt).not.toHaveBeenCalled();

    fireAllExcludedEvents();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    fireAllExcludedEvents();

    expect(submitAttempt).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("autosaves (debounced) but a reconnect retries only the SAVE, never a submit", async () => {
    renderGrid();

    fireEvent.click(firstCell());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(saveResponses).toHaveBeenCalledTimes(1);

    fireEvent(window, new Event("offline"));
    fireEvent(window, new Event("online"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("batches rapid cell edits into one debounced save (no write per keystroke)", async () => {
    renderGrid();

    // Four cells filled as fast as a student can move across a row.
    fireEvent.click(firstCell());
    fireEvent.click(screen.getByRole("button", { name: /^Solar — Renewable/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Wind — Conventional/ }));
    fireEvent.keyDown(screen.getByRole("button", { name: /^Wind — Renewable/ }), { key: "1" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(saveResponses).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(saveResponses).mock.calls[0]![1];
    expect(batch).toHaveLength(4);
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("restores a local draft after an unmount/remount (refresh) and re-syncs it", async () => {
    const first = renderGrid();
    fireEvent.click(firstCell());
    // Unmount BEFORE the debounced save fires — like closing or refreshing
    // the tab mid-draft. The cell must survive in localStorage.
    first.unmount();
    expect(saveResponses).not.toHaveBeenCalled();

    renderGrid(); // fresh mount with server-known answers all null
    expect(screen.getByRole("button", { name: /^Solar — Conventional.*0 — No \(0\)/ })).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(saveResponses).toHaveBeenCalledTimes(1);
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("submits only after the review step and two explicit clicks", async () => {
    renderGrid();

    fireEvent.click(firstCell());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /review & submit/i }));
    });

    fireEvent.click(screen.getByRole("button", { name: /^submit assignment$/i }));
    expect(submitAttempt).not.toHaveBeenCalled(); // first click only opens the dialog

    fireAllExcludedEvents();
    expect(submitAttempt).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, submit now/i }));
    });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
    expect(submitAttempt).toHaveBeenCalledWith("attempt-1");
  });
});

describe("no automatic submission — submit button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  function renderButton() {
    return render(
      <SubmitAttemptButton attemptId="attempt-1" receiptPath="/receipt" unansweredCount={1} />
    );
  }

  it("ignores every excluded browser event", () => {
    renderButton();
    fireAllExcludedEvents();
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("submits only after two explicit clicks (submit, then confirm)", async () => {
    renderButton();

    fireEvent.click(screen.getByRole("button", { name: /submit assignment/i }));
    expect(submitAttempt).not.toHaveBeenCalled(); // first click only reveals confirm

    fireAllExcludedEvents();
    expect(submitAttempt).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /yes, submit now/i }));
    });
    expect(submitAttempt).toHaveBeenCalledTimes(1);
  });
});
