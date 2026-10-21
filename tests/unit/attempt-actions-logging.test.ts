// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * saveResponses / submitAttempt: every failure is logged server-side with
 * the raw error, the user, the attempt and the assignment — and none of
 * that raw detail is returned to the browser.
 */

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc,
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        returns: () => chain,
        maybeSingle: async () => ({ data: { id: "attempt-1", assignment_id: "assignment-1" }, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveResponses, submitAttempt } = await import("@/lib/attempts/actions");

const RAW = { code: "P0001", message: "this assignment closed at 2026-10-22 09:30:00+00 — nothing more can be saved", details: null, hint: null };

afterEach(() => vi.clearAllMocks());

describe("saveResponses", () => {
  it("logs the raw failure with user, attempt and assignment, and returns only a plain sentence and a code", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: RAW });

    const result = await saveResponses("attempt-1", [{ questionId: "q1", value: 1 }]);

    expect(result).toMatchObject({ success: false, code: "CLOSED" });
    expect(JSON.stringify(result)).not.toMatch(/2026|P0001|nothing more can be saved/);
    expect(log).toHaveBeenCalledWith(
      "saveResponses: failed",
      expect.objectContaining({
        code: "CLOSED",
        terminal: true,
        userId: "user-1",
        attemptId: "attempt-1",
        assignmentId: "assignment-1",
        error: RAW,
        batchSize: 1,
      })
    );
  });

  it("a thrown fetch failure is logged and classed as temporary", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockRejectedValue(new TypeError("fetch failed"));

    const result = await saveResponses("attempt-1", [{ questionId: "q1", value: 0 }]);
    expect(result).toMatchObject({ success: false, code: "TEMPORARY" });
    expect(log.mock.calls[0]![1]).toMatchObject({ error: { name: "TypeError", message: "fetch failed" } });
  });

  it("logs nothing when the save works", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: { saved: 1, state: "DRAFT", savedAt: "now" }, error: null });
    expect((await saveResponses("attempt-1", [{ questionId: "q1", value: 0 }])).success).toBe(true);
    expect(log).not.toHaveBeenCalled();
  });
});

describe("submitAttempt", () => {
  it("logs the raw failure and returns a plain sentence", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });

    const result = await submitAttempt("attempt-1");
    expect(result).toMatchObject({ success: false, code: "TEMPORARY" });
    expect(JSON.stringify(result)).not.toMatch(/statement|57014/);
    expect(log).toHaveBeenCalledWith(
      "submitAttempt: failed",
      expect.objectContaining({ userId: "user-1", attemptId: "attempt-1", assignmentId: "assignment-1", stage: "submit" })
    );
  });

  it("a second submission is reported as ALREADY_SUBMITTED, not logged as a failure", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "already submitted — this attempt was submitted at x" } });
    expect(await submitAttempt("attempt-1")).toMatchObject({ success: false, code: "ALREADY_SUBMITTED" });
    expect(log).not.toHaveBeenCalled();
  });
});
