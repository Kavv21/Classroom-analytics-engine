/**
 * HARD REQUIREMENT (EXCLUDED_FEATURES.md, spec section 10 — zero tolerance):
 * no browser activity may ever trigger an automatic submission. These tests
 * mount the real taking UI and the real submit button, fire every excluded
 * browser event — tab switch (visibilitychange), blur/minimize, refresh
 * signals (beforeunload/pagehide), fullscreen exit, navigation (popstate),
 * disconnect/reconnect (offline/online) — and prove the submit action is
 * NEVER called. They also verify the component registers no listeners for
 * any of those events in the first place (the only global listener allowed
 * is `online`, which retries pending SAVES), and that submission happens
 * only through two explicit clicks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { AttemptRunner, type TakingQuestion } from "@/components/attempts/attempt-runner";
import { SubmitAttemptButton } from "@/components/attempts/submit-attempt-button";
import { CsvAnswerUpload } from "@/components/attempts/csv-answer-upload";
import { saveResponses, submitAttempt, submitCsvAnswers } from "@/lib/attempts/actions";

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
      totalQuestions: 2,
    },
  })),
  submitCsvAnswers: vi.fn(async () => ({
    success: true,
    data: {
      attemptId: "attempt-1",
      state: "SUBMITTED",
      submittedAt: new Date().toISOString(),
      submissionVersion: 1,
      answered: 2,
      totalQuestions: 2,
    },
  })),
}));

const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: vi.fn() }),
}));

const questions: TakingQuestion[] = [
  {
    id: "q1",
    externalQuestionCode: "T-001",
    questionText: "Question one",
    responseZeroLabel: "No (0)",
    responseOneLabel: "Yes (1)",
    displayOrder: 1,
  },
  {
    id: "q2",
    externalQuestionCode: "T-002",
    questionText: "Question two",
    responseZeroLabel: "No (0)",
    responseOneLabel: "Yes (1)",
    displayOrder: 2,
  },
];

function renderRunner() {
  return render(
    <AttemptRunner
      attemptId="attempt-1"
      assignmentTitle="Test assignment"
      instructions={null}
      questions={questions}
      initialAnswers={{ q1: null, q2: null }}
      reviewPath="/assignments/a/review"
      allowDraftEditing={true}
    />
  );
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

describe("no automatic submission — taking UI", () => {
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

    renderRunner();

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
    renderRunner();

    // Answer a question so there is a dirty draft in flight — the riskiest
    // moment for an over-eager "submit on leave" implementation.
    fireEvent.click(screen.getAllByRole("button", { name: /1\s/ })[0]!);

    fireAllExcludedEvents();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    fireAllExcludedEvents();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(submitAttempt).not.toHaveBeenCalled();
    // Navigation to review/receipt was never forced either.
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("autosaves (debounced) but a reconnect retries only the SAVE, never a submit", async () => {
    renderRunner();

    fireEvent.click(screen.getAllByRole("button", { name: /1\s/ })[0]!);
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

  it("batches rapid answers into one debounced save (no write per click)", async () => {
    renderRunner();

    fireEvent.click(screen.getAllByRole("button", { name: /1\s/ })[0]!);
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getAllByRole("button", { name: /0\s/ })[0]!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(saveResponses).toHaveBeenCalledTimes(1);
    const batch = vi.mocked(saveResponses).mock.calls[0]![1];
    expect(batch).toHaveLength(2);
    expect(submitAttempt).not.toHaveBeenCalled();
  });

  it("restores a local draft after an unmount/remount (refresh) and re-syncs it", async () => {
    const first = renderRunner();
    fireEvent.click(screen.getAllByRole("button", { name: /1\s/ })[0]!);
    // Unmount BEFORE the debounced save fires — like closing/refreshing the
    // tab mid-draft. The answer must survive in localStorage.
    first.unmount();
    expect(saveResponses).not.toHaveBeenCalled();

    renderRunner(); // fresh mount with server-known answers all null
    expect(screen.getByText("Answered 1 · Unanswered 1")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(saveResponses).toHaveBeenCalledTimes(1);
    expect(submitAttempt).not.toHaveBeenCalled();
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

/**
 * The CSV upload path (Part 2) is now the primary way a student submits, so
 * the zero-tolerance rule has to hold here too — and the risk is different
 * in kind. On the per-question runner the danger was a lifecycle listener;
 * here it is the file input, because `onChange` firing is browser activity
 * and wiring submission to it would auto-submit the moment a file is picked.
 */
describe("no automatic submission — CSV upload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  const csvQuestions = [
    { id: "q1", externalQuestionCode: "A1-001", questionText: "Solar — Conventional", displayOrder: 1 },
    { id: "q2", externalQuestionCode: "A1-002", questionText: "Solar — Renewable", displayOrder: 2 },
  ];

  function renderUpload() {
    return render(
      <CsvAnswerUpload
        attemptId="attempt-1"
        assignmentTitle="Test assignment"
        instructions={null}
        questions={csvQuestions}
        receiptPath="/assignments/a/receipt"
      />
    );
  }

  function chooseFile(container: HTMLElement, contents: string) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([contents], "answers.csv", { type: "text/csv" });
    // jsdom's File.text() is not wired up in every version — pin it.
    Object.defineProperty(file, "text", { value: async () => contents });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);
    return input;
  }

  it("registers no listeners for tab-switch/blur/fullscreen/unload events", () => {
    const windowSpy = vi.spyOn(window, "addEventListener");
    const documentSpy = vi.spyOn(document, "addEventListener");

    renderUpload();

    const registered = [
      ...windowSpy.mock.calls.map((c) => c[0]),
      ...documentSpy.mock.calls.map((c) => c[0]),
    ];
    for (const forbidden of FORBIDDEN_LISTENERS) {
      expect(registered, `no listener for "${forbidden}" may be registered`).not.toContain(
        forbidden
      );
    }

    windowSpy.mockRestore();
    documentSpy.mockRestore();
  });

  it("choosing a valid file previews it and submits NOTHING", async () => {
    const { container } = renderUpload();

    await act(async () => {
      chooseFile(container, "A1-001,A1-002\r\n1,0");
    });

    // The preview rendered — both answers are shown for checking, and the
    // confirm button (which only exists in the preview stage) is enabled.
    expect(screen.getByText("A1-001")).toBeTruthy();
    expect(screen.getByText("A1-002")).toBeTruthy();
    const button = screen.getByRole("button", { name: /submit these answers/i });
    expect((button as HTMLButtonElement).disabled).toBe(false);

    // ...and nothing was submitted by the act of choosing the file.
    expect(submitCsvAnswers).not.toHaveBeenCalled();
  });

  it("never submits on any excluded browser event, even with a valid file staged", async () => {
    const { container } = renderUpload();

    await act(async () => {
      chooseFile(container, "A1-001,A1-002\r\n1,0");
    });

    fireAllExcludedEvents();
    await act(async () => {});
    fireAllExcludedEvents();

    expect(submitCsvAnswers).not.toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
  });

  it("submits only on the explicit confirm click", async () => {
    const { container } = renderUpload();

    await act(async () => {
      chooseFile(container, "A1-001,A1-002\r\n1,0");
    });
    expect(submitCsvAnswers).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /submit these answers/i }));
    });
    expect(submitCsvAnswers).toHaveBeenCalledTimes(1);
  });

  it("keeps the confirm button disabled while the file has problems", async () => {
    const { container } = renderUpload();

    await act(async () => {
      chooseFile(container, "A1-001,A1-002\r\n1,7");
    });

    const button = screen.getByRole("button", { name: /submit these answers/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      fireEvent.click(button);
    });
    expect(submitCsvAnswers).not.toHaveBeenCalled();
  });
});
