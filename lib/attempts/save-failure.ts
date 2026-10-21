/**
 * What went wrong with a save or a submission, in two classes, and what a
 * student is told about it.
 *
 * TRANSIENT failures are worth retrying: the network dropped, the request
 * timed out, the database was briefly busy, the session needed refreshing.
 * The grid retries these silently with backoff.
 *
 * TERMINAL failures will fail the same way every time: the assignment has
 * closed, the attempt was already submitted (another tab), draft editing is
 * off, the attempt isn't this student's. Retrying them forever under a
 * "we're trying" message would be a lie, so the grid stops and says what
 * happened.
 *
 * The raw error never reaches the browser. The server action logs it in
 * full and returns only a code; every student-facing sentence lives here.
 * None of them may mention a server, a database, retrying, or an error code.
 */

export type AttemptFailureCode =
  // terminal
  | "CLOSED"
  | "NOT_OPEN_YET"
  | "ALREADY_SUBMITTED"
  | "DRAFT_LOCKED"
  | "NOT_YOURS"
  | "ASSIGNMENT_CHANGED"
  | "FINAL_CHECK_FAILED"
  // transient
  | "TEMPORARY";

export const TERMINAL_CODES: ReadonlySet<AttemptFailureCode> = new Set([
  "CLOSED",
  "NOT_OPEN_YET",
  "ALREADY_SUBMITTED",
  "DRAFT_LOCKED",
  "NOT_YOURS",
  "ASSIGNMENT_CHANGED",
  "FINAL_CHECK_FAILED",
]);

export function isTerminal(code: AttemptFailureCode): boolean {
  return TERMINAL_CODES.has(code);
}

interface ErrorLike {
  code?: string | null;
  message?: string | null;
}

/**
 * Classifies a PostgREST / Postgres error from save_attempt_responses or
 * submit_attempt (migration 0029). Those RPCs raise plain exceptions
 * (SQLSTATE P0001), so the message is what tells the cases apart; the
 * patterns below are the RPCs' own wording. Anything unrecognised is
 * TEMPORARY: retrying something that turns out to be permanent ends in the
 * "keep this tab open" line, which is true; calling a blip permanent would
 * stop saving for good.
 */
export function classifyAttemptError(error: ErrorLike | null | undefined): AttemptFailureCode {
  const message = (error?.message ?? "").toLowerCase();
  const code = error?.code ?? "";

  if (/closed at|no longer open|is not open \(status|can no longer be submitted/.test(message)) {
    return "CLOSED";
  }
  if (/not open yet/.test(message)) return "NOT_OPEN_YET";
  if (/already submitted|already been submitted/.test(message)) return "ALREADY_SUBMITTED";
  if (/draft editing is disabled/.test(message)) return "DRAFT_LOCKED";
  if (/not found, or it is not yours/.test(message) || code === "42501") return "NOT_YOURS";
  if (/does not belong to this assignment|invalid response value/.test(message)) {
    return "ASSIGNMENT_CHANGED";
  }
  // Everything else — fetch failures, 5xx, statement timeouts (57014),
  // connection errors (08xxx, PGRST000-003), lock/serialisation conflicts,
  // an expired session (PGRST301, "not signed in") — is worth another try.
  return "TEMPORARY";
}

/** The one calm line shown once silent retries have gone on too long. */
export const STILL_SAVING_MESSAGE =
  "Some answers haven't saved yet. Keep this tab open — we'll keep trying.";

/** What the student reads when a save stops for good. Says what happened
 * and what to do. */
export function describeSaveFailure(code: AttemptFailureCode): string {
  switch (code) {
    case "CLOSED":
      return "This assignment has closed, so your latest changes weren't saved. Answers saved before it closed are kept. If you think it closed too early, tell your professor.";
    case "NOT_OPEN_YET":
      return "This assignment isn't open yet, so answers can't be saved. Come back once it opens.";
    case "ALREADY_SUBMITTED":
      return "This assignment has already been submitted, perhaps from another tab or device, so these changes weren't saved. Reload the page to see your submission.";
    case "DRAFT_LOCKED":
      return "On this assignment an answer can't be changed once it's saved, so your last change wasn't kept. Reload the page to see your saved answers.";
    case "NOT_YOURS":
      return "Your answers can't be saved from this page. Reload it, and if this keeps happening, tell your professor.";
    case "ASSIGNMENT_CHANGED":
    case "FINAL_CHECK_FAILED":
      return "Your professor has changed this assignment since you opened it, so some answers weren't saved. Reload the page to carry on.";
    case "TEMPORARY":
      return STILL_SAVING_MESSAGE;
  }
}

/** What the student reads when a submission doesn't go through. */
export function describeSubmitFailure(code: AttemptFailureCode): string {
  switch (code) {
    case "CLOSED":
      return "This assignment has closed, so it can no longer be submitted. If you think it closed too early, tell your professor.";
    case "NOT_OPEN_YET":
      return "This assignment isn't open yet, so it can't be submitted.";
    case "NOT_YOURS":
      return "This attempt can't be submitted from your account. Reload the page, and if this keeps happening, tell your professor.";
    case "ASSIGNMENT_CHANGED":
    case "FINAL_CHECK_FAILED":
      return "Your professor has changed this assignment since you opened it, so nothing was submitted. Reload the page and check your answers before submitting again.";
    case "ALREADY_SUBMITTED":
      return "This assignment has already been submitted.";
    case "DRAFT_LOCKED":
    case "TEMPORARY":
      return "Your submission didn't go through. Your answers are still saved — please try again in a moment.";
  }
}
