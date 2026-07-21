import { beforeEach, describe, expect, it } from "vitest";
import {
  clearPending,
  loadPending,
  mergeServerAndLocal,
  parsePending,
  storePending,
  type PendingMap,
} from "@/lib/attempts/local-store";

describe("parsePending", () => {
  it("returns {} for null, garbage, and non-object JSON", () => {
    expect(parsePending(null)).toEqual({});
    expect(parsePending("not json")).toEqual({});
    expect(parsePending("[1,2]")).toEqual({});
    expect(parsePending('"str"')).toEqual({});
  });

  it("keeps only well-formed entries with legal values", () => {
    const raw = JSON.stringify({
      q1: { value: 1, changedAt: 100 },
      q2: { value: null, changedAt: 200 },
      bad1: { value: 2, changedAt: 300 }, // illegal value
      bad2: { value: 1 }, // missing changedAt
      bad3: "nope",
    });
    expect(parsePending(raw)).toEqual({
      q1: { value: 1, changedAt: 100 },
      q2: { value: null, changedAt: 200 },
    });
  });
});

describe("mergeServerAndLocal", () => {
  const server = { q1: 0 as const, q2: null, q3: 1 as const };

  it("overlays pending values and reports them dirty", () => {
    const pending: PendingMap = {
      q1: { value: 1, changedAt: 1 },
      q2: { value: 0, changedAt: 2 },
    };
    const { answers, dirtyIds } = mergeServerAndLocal(server, pending);
    expect(answers).toEqual({ q1: 1, q2: 0, q3: 1 });
    expect(dirtyIds.sort()).toEqual(["q1", "q2"]);
  });

  it("drops pending entries whose value already matches the server (synced elsewhere)", () => {
    const pending: PendingMap = { q3: { value: 1, changedAt: 1 } };
    const { answers, dirtyIds } = mergeServerAndLocal(server, pending);
    expect(answers).toEqual(server);
    expect(dirtyIds).toEqual([]);
  });

  it("ignores pending entries for questions the server no longer has", () => {
    const pending: PendingMap = { gone: { value: 1, changedAt: 1 } };
    const { answers, dirtyIds } = mergeServerAndLocal(server, pending);
    expect(answers).toEqual(server);
    expect(dirtyIds).toEqual([]);
  });
});

describe("localStorage round-trip (jsdom)", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("stores, loads, and clears pending answers per attempt", () => {
    const pending: PendingMap = { q1: { value: 0, changedAt: 42 } };
    storePending("attempt-a", pending);
    expect(loadPending("attempt-a")).toEqual(pending);
    expect(loadPending("attempt-b")).toEqual({}); // isolated per attempt

    clearPending("attempt-a");
    expect(loadPending("attempt-a")).toEqual({});
  });

  it("removes the key entirely when the pending map empties", () => {
    storePending("attempt-a", { q1: { value: 1, changedAt: 1 } });
    storePending("attempt-a", {});
    expect(window.localStorage.getItem("attempt-pending-attempt-a")).toBeNull();
  });
});
