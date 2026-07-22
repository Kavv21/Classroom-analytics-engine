import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTOSAVE_RULE,
  bucketForPath,
  hit,
  resetAllLimits,
  RULES,
  SUBMIT_RULE,
} from "@/lib/rate-limit";

beforeEach(() => resetAllLimits());

describe("bucket selection from path", () => {
  it("routes the attempt page to the autosave bucket", () => {
    expect(bucketForPath("/assignments/abc-123")).toBe("autosave");
    expect(bucketForPath("/assignments/abc-123/")).toBe("autosave");
  });

  it("routes the review page to the submit bucket", () => {
    expect(bucketForPath("/assignments/abc-123/review")).toBe("submit");
  });

  it("does not mistake the receipt page for either", () => {
    expect(bucketForPath("/assignments/abc-123/receipt")).toBe("general");
  });

  it("routes professor surfaces to the general bucket", () => {
    expect(bucketForPath("/classes/xyz/mappings")).toBe("general");
    expect(bucketForPath("/classes")).toBe("general");
  });
});

describe("fixed-window counting", () => {
  it("allows exactly `limit` requests then rejects", () => {
    const rule = { limit: 3, windowMs: 60_000 };
    const results = [1, 2, 3, 4].map(() => hit("u1:test", rule, 1_000));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[2]!.remaining).toBe(0);
  });

  it("reports a Retry-After inside the window", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    hit("u2:test", rule, 1_000);
    const blocked = hit("u2:test", rule, 31_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(30);
  });

  it("resets once the window has passed", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(hit("u3:test", rule, 1_000).allowed).toBe(true);
    expect(hit("u3:test", rule, 30_000).allowed).toBe(false);
    expect(hit("u3:test", rule, 61_001).allowed).toBe(true);
  });

  it("counts each user separately — one student cannot throttle another", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(hit("studentA:autosave", rule, 1_000).allowed).toBe(true);
    expect(hit("studentA:autosave", rule, 1_100).allowed).toBe(false);
    // A different student is unaffected, which is the whole point of
    // keying on user id rather than shared university IP.
    expect(hit("studentB:autosave", rule, 1_200).allowed).toBe(true);
  });

  it("counts each bucket separately — autosave cannot exhaust submit", () => {
    const rule = { limit: 1, windowMs: 60_000 };
    expect(hit("u4:autosave", rule, 1_000).allowed).toBe(true);
    expect(hit("u4:autosave", rule, 1_100).allowed).toBe(false);
    expect(hit("u4:submit", rule, 1_200).allowed).toBe(true);
  });
});

describe("the configured limits leave room for honest use", () => {
  it("autosave tolerates a fast student plus a retry flush", () => {
    // Client debounces at 800ms, so ~75 saves/min is already unrealistic;
    // the limit must sit comfortably above that.
    expect(AUTOSAVE_RULE.limit).toBeGreaterThan(75);
    expect(AUTOSAVE_RULE.windowMs).toBe(60_000);
  });

  it("submit is tight but allows a reopen-and-resubmit cycle", () => {
    expect(SUBMIT_RULE.limit).toBeGreaterThanOrEqual(2);
    expect(SUBMIT_RULE.limit).toBeLessThan(AUTOSAVE_RULE.limit);
  });

  it("every bucket has a rule", () => {
    for (const bucket of ["autosave", "submit", "general"] as const) {
      expect(RULES[bucket]?.limit).toBeGreaterThan(0);
    }
  });
});
