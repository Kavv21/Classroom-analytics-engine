import type { ResponseValue } from "@/lib/types/domain";

/**
 * Local persistence for in-progress answers. Every selection is written
 * here synchronously (before the debounced server save), so a refresh
 * mid-assignment restores the draft instantly from the browser — before
 * any server round-trip completes — and unsynced changes survive until the
 * retry queue flushes them. Cleared on successful sync (per question) and
 * on final submission.
 */

export interface PendingAnswer {
  value: ResponseValue;
  changedAt: number;
}

export type PendingMap = Record<string, PendingAnswer>;

function storageKey(attemptId: string): string {
  return `attempt-pending-${attemptId}`;
}

function isValidValue(v: unknown): v is ResponseValue {
  return v === 0 || v === 1 || v === null;
}

/** Parses a stored pending map, dropping anything malformed. Pure. */
export function parsePending(raw: string | null): PendingMap {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: PendingMap = {};
    for (const [questionId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        isValidValue((entry as PendingAnswer).value) &&
        typeof (entry as PendingAnswer).changedAt === "number"
      ) {
        out[questionId] = {
          value: (entry as PendingAnswer).value,
          changedAt: (entry as PendingAnswer).changedAt,
        };
      }
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Overlays locally pending (not-yet-synced) answers on top of the
 * server-known ones. Local wins — it is strictly newer: entries only stay
 * pending until a successful save removes them. Returns the merged answer
 * map plus which question ids still need syncing. Pure.
 */
export function mergeServerAndLocal(
  server: Record<string, ResponseValue>,
  pending: PendingMap
): { answers: Record<string, ResponseValue>; dirtyIds: string[] } {
  const answers: Record<string, ResponseValue> = { ...server };
  const dirtyIds: string[] = [];
  for (const [questionId, entry] of Object.entries(pending)) {
    if (!(questionId in server)) continue; // question no longer exists
    if (answers[questionId] !== entry.value) {
      answers[questionId] = entry.value;
      dirtyIds.push(questionId);
    }
  }
  return { answers, dirtyIds };
}

export function loadPending(attemptId: string): PendingMap {
  if (typeof window === "undefined") return {};
  try {
    return parsePending(window.localStorage.getItem(storageKey(attemptId)));
  } catch {
    return {};
  }
}

export function storePending(attemptId: string, pending: PendingMap): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(pending).length === 0) {
      window.localStorage.removeItem(storageKey(attemptId));
    } else {
      window.localStorage.setItem(storageKey(attemptId), JSON.stringify(pending));
    }
  } catch {
    // Storage full/blocked — the server retry queue still holds the data.
  }
}

export function clearPending(attemptId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(attemptId));
  } catch {
    // ignore
  }
}
