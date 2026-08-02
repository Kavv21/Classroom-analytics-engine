import { describe, expect, it, vi } from "vitest";
import {
  commitAnswerSet,
  validateAnswerSet,
  validateAnswerValues,
  type AnswerSetQuestion,
} from "@/lib/attempts/commit-answers";

/**
 * The shared answer-commit core, extracted from the CSV path so the grid
 * and the seeding script enforce one rule rather than two.
 *
 * The contract these pin: a set of answers is either completely valid and
 * written, or rejected with every problem named — never partially written.
 * That mattered for an uploaded file because the student could not tell
 * which answers landed; it matters for the grid because an autosave batch
 * or a final submission that half-lands is the same failure.
 */

const questions: AnswerSetQuestion[] = [
  { id: "q1", externalQuestionCode: "A1-001", questionText: "Solar — Conventional" },
  { id: "q2", externalQuestionCode: "A1-002", questionText: "Solar — Renewable" },
  { id: "q3", externalQuestionCode: "A1-003", questionText: "Wind — Conventional" },
];

function fakeClient(overrides: { save?: unknown; submit?: unknown } = {}) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "save_attempt_responses") {
      return overrides.save ?? { data: { saved: 3 }, error: null };
    }
    if (name === "submit_attempt") {
      return (
        overrides.submit ?? {
          data: {
            attemptId: "attempt-1",
            state: "SUBMITTED",
            submittedAt: "2026-08-02T00:00:00Z",
            submissionVersion: 1,
            answered: 3,
            totalQuestions: 3,
          },
          error: null,
        }
      );
    }
    throw new Error(`unexpected rpc ${name}`);
  });
  return { rpc } as never;
}

const rpcOf = (client: unknown) => (client as { rpc: ReturnType<typeof vi.fn> }).rpc;

// ============================================================
// Values
// ============================================================

describe("validateAnswerValues", () => {
  it("accepts exactly 0, 1 and blank", () => {
    expect(
      validateAnswerValues([
        { questionId: "q1", value: 0 },
        { questionId: "q2", value: 1 },
        { questionId: "q3", value: null },
      ])
    ).toEqual([]);
  });

  it("rejects anything else, however plausible", () => {
    for (const bad of [2, -1, "1", "yes", true, 0.5]) {
      const issues = validateAnswerValues([
        { questionId: "q1", value: bad as never },
      ]);
      expect(issues, `"${String(bad)}" must not be accepted`).toHaveLength(1);
    }
  });
});

// ============================================================
// Sets
// ============================================================

describe("validateAnswerSet", () => {
  it("passes a partial set by default — a blank cell is a real state, not an error", () => {
    expect(validateAnswerSet(questions, [{ questionId: "q1", value: 1 }])).toEqual([]);
  });

  it("reports the gap when completeness is required", () => {
    const issues = validateAnswerSet(questions, [{ questionId: "q1", value: 1 }], {
      requireComplete: true,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("Solar — Renewable");
  });

  it("counts a blank answer as unanswered, not as answered", () => {
    const issues = validateAnswerSet(
      questions,
      questions.map((q) => ({ questionId: q.id, value: q.id === "q2" ? null : (1 as const) })),
      { requireComplete: true }
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.message).toContain("A1-002");
  });

  it("rejects an answer for a question this assignment doesn't have", () => {
    const issues = validateAnswerSet(questions, [{ questionId: "elsewhere", value: 1 }]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.questionId).toBe("elsewhere");
  });

  it("can be told to ignore unknown questions, for rows already stored", () => {
    // A question deactivated after it was answered is the professor's edit,
    // not the student's problem — it must not block their submission.
    expect(
      validateAnswerSet(questions, [{ questionId: "retired-question", value: 1 }], {
        unknownQuestions: "ignore",
      })
    ).toEqual([]);
  });

  it("rejects the same question answered twice in one batch", () => {
    const issues = validateAnswerSet(questions, [
      { questionId: "q1", value: 1 },
      { questionId: "q1", value: 0 },
    ]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.code).toBe("A1-001");
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const issues = validateAnswerSet(questions, [
      { questionId: "q1", value: 7 as never },
      { questionId: "elsewhere", value: 1 },
    ]);
    expect(issues.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================
// Commit
// ============================================================

describe("commitAnswerSet", () => {
  it("saves through the RPC and does not submit unless asked", async () => {
    const client = fakeClient();
    const result = await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions,
      answers: [{ questionId: "q1", value: 1 }],
    });

    expect(result.success).toBe(true);
    expect(rpcOf(client).mock.calls.map((c) => c[0])).toEqual(["save_attempt_responses"]);
  });

  it("saves then submits, in that order, when asked to submit", async () => {
    const client = fakeClient();
    const result = await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions,
      answers: questions.map((q) => ({ questionId: q.id, value: 1 as const })),
      submit: true,
    });

    expect(result.success).toBe(true);
    expect(rpcOf(client).mock.calls.map((c) => c[0])).toEqual([
      "save_attempt_responses",
      "submit_attempt",
    ]);
  });

  it("writes NOTHING when any answer in the set is invalid", async () => {
    const client = fakeClient();
    const result = await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions,
      answers: [
        { questionId: "q1", value: 1 },
        { questionId: "q2", value: 9 as never },
      ],
      submit: true,
    });

    expect(result.success).toBe(false);
    // The decisive assertion: the valid half must not land on its own.
    expect(rpcOf(client)).not.toHaveBeenCalled();
    if (!result.success) expect(result.issues?.length).toBeGreaterThan(0);
  });

  it("never writes to `responses` directly — only the two RPCs exist", async () => {
    const client = fakeClient();
    await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions,
      answers: [{ questionId: "q1", value: 0 }],
      submit: true,
    });
    // The RPCs own ownership, assignment-is-OPEN, write-once and the state
    // machine; a direct insert would bypass all of them.
    expect((client as { from?: unknown }).from).toBeUndefined();
    expect(new Set(rpcOf(client).mock.calls.map((c) => c[0]))).toEqual(
      new Set(["save_attempt_responses", "submit_attempt"])
    );
  });

  it("surfaces a save failure without claiming success", async () => {
    const client = fakeClient({ save: { data: null, error: { message: "assignment is not open" } } });
    const result = await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions,
      answers: [{ questionId: "q1", value: 1 }],
      submit: true,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("not open");
      expect(rpcOf(client).mock.calls.map((c) => c[0])).toEqual(["save_attempt_responses"]);
    }
  });

  it("says the answers were saved when only the submit step failed", async () => {
    const client = fakeClient({ submit: { data: null, error: { message: "already submitted" } } });
    const result = await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions,
      answers: [{ questionId: "q1", value: 1 }],
      submit: true,
    });
    expect(result.success).toBe(false);
    // Saying "it all failed" here would be a lie — the answers are stored.
    if (!result.success) expect(result.error).toContain("saved");
  });

  it("refuses an assignment with no questions", async () => {
    const client = fakeClient();
    const result = await commitAnswerSet(client, {
      attemptId: "attempt-1",
      questions: [],
      answers: [],
    });
    expect(result.success).toBe(false);
    expect(rpcOf(client)).not.toHaveBeenCalled();
  });
});
