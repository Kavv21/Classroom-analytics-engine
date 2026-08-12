import type { AssignmentStatus } from "@/lib/types/domain";

/**
 * Date-driven scheduling: the one place the "may students answer this right
 * now?" rule is written in TypeScript.
 *
 * WHY THIS EXISTS
 * Access used to be a button. A professor moved an assignment READY -> OPEN
 * to let the class in and OPEN -> CLOSED to shut it again, and `open_at` /
 * `close_at` were columns nothing read — collected by the form, printed on
 * the detail page, enforced nowhere. The window is now the mechanism, and
 * it is evaluated lazily at every access and every write (no cron, no
 * scheduled function: a request-time comparison against now() is exact and
 * needs no infrastructure).
 *
 * THE RULE (mirrored verbatim by `assignment_accepts_answers` in migration
 * 0029, which is the actual boundary — this copy exists so the UI cannot
 * offer a link the RPC will then refuse):
 *
 *   READY  — scheduled. Answerable only when BOTH dates are set and now()
 *            falls inside [open_at, close_at]. A READY assignment with a
 *            missing date is NOT scheduled and nobody can reach it. Fail
 *            closed: "no dates" must never mean "open to everyone", and
 *            READY has always meant "approved, not yet released".
 *   OPEN   — the legacy manually-published status, kept working for the
 *            assignments already live in the database. A missing bound is
 *            an absent bound (open_at null = already open, close_at null =
 *            no end), so an OPEN assignment with no dates behaves exactly
 *            as it did before this change. Dates, if present, are enforced.
 *   others — never. DRAFT is unapproved, CLOSED is retired, ARCHIVED is out
 *            of play.
 *
 * DRAFT -> READY is untouched by any of this: it is still the professor's
 * manual, checkbox-confirmed approval of the full question list, and no
 * date can substitute for it.
 */

export interface ScheduleWindow {
  /** `assignments.open_at` — ISO 8601, or null when unset. */
  openAt: string | null;
  /** `assignments.close_at` — ISO 8601, or null when unset. */
  closeAt: string | null;
}

export const NO_WINDOW: ScheduleWindow = { openAt: null, closeAt: null };

/** ISO -> epoch ms, or null for anything unparseable (never NaN). */
function at(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Both bounds present and parseable — the definition of "scheduled". */
export function isScheduled(window: ScheduleWindow): boolean {
  return at(window.openAt) !== null && at(window.closeAt) !== null;
}

/**
 * Does the window admit `now`? Bounds are inclusive at both ends, matching
 * SQL's `now() between open_at and close_at`: a student clicking at exactly
 * the closing minute is inside, not outside.
 */
export function isWithinWindow(window: ScheduleWindow, now: Date = new Date()): boolean {
  const opens = at(window.openAt);
  const closes = at(window.closeAt);
  const t = now.getTime();
  if (opens !== null && t < opens) return false;
  if (closes !== null && t > closes) return false;
  return true;
}

/**
 * The predicate. True when this assignment is accepting answers from the
 * class as a whole, right now.
 *
 * A per-attempt reopen is deliberately NOT considered here — that is one
 * student's exception to a closed window, and it lives in
 * `canAnswerAssignment` (lib/attempts/workable.ts) alongside the attempt it
 * belongs to.
 */
export function assignmentAcceptsAnswers(
  status: AssignmentStatus | string,
  window: ScheduleWindow,
  now: Date = new Date()
): boolean {
  if (status === "READY") {
    return isScheduled(window) && isWithinWindow(window, now);
  }
  if (status === "OPEN") {
    return isWithinWindow(window, now);
  }
  return false;
}

/**
 * Has this assignment ever been in front of students?
 *
 * Two things hang off it: whether a per-attempt reopen can still let one
 * student in (you cannot be readmitted to something that never opened), and
 * whether students may read the question text at all. It stays true after
 * the window shuts — receipts and reopened attempts both need the questions
 * after the fact.
 */
export function assignmentHasOpened(
  status: AssignmentStatus | string,
  window: ScheduleWindow,
  now: Date = new Date()
): boolean {
  if (status === "OPEN" || status === "CLOSED") return true;
  if (status !== "READY") return false;
  const opens = at(window.openAt);
  return opens !== null && now.getTime() >= opens;
}

// ============================================================
// Effective status — what the professor is shown.
// ============================================================

/**
 * `assignments.status` alone is now a misleading thing to print. A
 * scheduled assignment sits at READY from the moment it is approved until
 * the professor retires it — through the whole window and past the end of
 * it — so a badge reading "Ready to publish" would be wrong on the day the
 * class is answering and wrong again a week later.
 *
 * The effective status is status + dates + now(), resolved to the thing the
 * professor actually wants to know: can students get in, and when does that
 * change?
 */
export type EffectiveStatusKind =
  | "DRAFT"
  | "NOT_SCHEDULED"
  | "SCHEDULED"
  | "OPEN"
  | "WINDOW_PASSED"
  | "CLOSED"
  | "ARCHIVED";

export interface EffectiveStatus {
  kind: EffectiveStatusKind;
  /** Badge text. Never contains a timestamp — see `detail`/`at`. */
  label: string;
  /**
   * Preposition introducing `at`, or null when there is no date to show.
   * Kept apart from `label` because the timestamp has to be rendered by
   * <LocalDateTime> (a client component) in the reader's own timezone.
   */
  detail: "opens" | "until" | "ended" | null;
  /** The ISO timestamp `detail` refers to. */
  at: string | null;
  /** Badge class, from the same palette as `assignmentStatusTone`. */
  tone: string;
  /** Can the class answer it right now? The headline fact. */
  studentsCanAnswer: boolean;
}

export function effectiveAssignmentStatus(
  status: AssignmentStatus | string,
  window: ScheduleWindow,
  now: Date = new Date()
): EffectiveStatus {
  if (status === "ARCHIVED") {
    return {
      kind: "ARCHIVED",
      label: "Archived",
      detail: null,
      at: null,
      tone: "badge badge-neutral",
      studentsCanAnswer: false,
    };
  }
  if (status === "DRAFT") {
    return {
      kind: "DRAFT",
      label: "Draft",
      detail: null,
      at: null,
      tone: "badge badge-amber",
      studentsCanAnswer: false,
    };
  }
  if (status === "CLOSED") {
    return {
      kind: "CLOSED",
      label: "Closed",
      detail: null,
      at: null,
      tone: "badge badge-purple",
      studentsCanAnswer: false,
    };
  }

  // READY / OPEN — the two statuses the schedule governs.
  if (status === "READY" && !isScheduled(window)) {
    return {
      kind: "NOT_SCHEDULED",
      label: "Not scheduled",
      detail: null,
      at: null,
      tone: "badge badge-amber",
      studentsCanAnswer: false,
    };
  }

  const opens = at(window.openAt);
  const closes = at(window.closeAt);
  const t = now.getTime();

  if (opens !== null && t < opens) {
    return {
      kind: "SCHEDULED",
      label: "Scheduled",
      detail: "opens",
      at: window.openAt,
      tone: "badge badge-blue",
      studentsCanAnswer: false,
    };
  }
  if (closes !== null && t > closes) {
    return {
      kind: "WINDOW_PASSED",
      label: "Closed",
      detail: "ended",
      at: window.closeAt,
      tone: "badge badge-purple",
      studentsCanAnswer: false,
    };
  }
  return {
    kind: "OPEN",
    label: "Open",
    detail: closes !== null ? "until" : null,
    at: closes !== null ? window.closeAt : null,
    tone: "badge badge-green",
    studentsCanAnswer: true,
  };
}

// ============================================================
// datetime-local <-> ISO. BROWSER ONLY — both read the ambient timezone.
// ============================================================

/**
 * Why these are client-only, and why the old code was wrong.
 *
 * `<input type="datetime-local">` speaks naive wall-clock time
 * ("2026-08-20T17:00") with no zone. `assignments.open_at` is `timestamptz`
 * — an instant. Converting between them needs a timezone, and the only
 * correct one is the professor's.
 *
 * The edit page used to do the conversion in a SERVER component, so it
 * read Vercel's timezone (UTC) instead: a professor typing 5 PM had 17:00Z
 * written to the database, and was shown 17:00 again on the way back, so
 * the round-trip looked consistent and was silently off by their UTC
 * offset. Harmless while nothing read the columns. Not harmless now that
 * they decide when a class can answer.
 */

/** ISO (or an already-local value) -> the "YYYY-MM-DDTHH:mm" the input needs. */
export function isoToLocalInput(value: string | null | undefined): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/** "YYYY-MM-DDTHH:mm" in the reader's timezone -> a UTC ISO instant. */
export function localInputToIso(value: string | null | undefined): string {
  if (!value || value.trim() === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}
