import { z } from "zod";
import { describeProvisioningFailure } from "@/lib/roster/provisioning-failure";

/**
 * Adding students by hand — the no-file path beside the roster import.
 * Shared by the dialog (inline validation, per-row messages) and the
 * server action (re-validation; nothing the client says is trusted).
 *
 * There is no role field anywhere in here on purpose. The database writes
 * 'STUDENT' (add_students_to_class, migration 0031); TAs have their own
 * professor-only path.
 */

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Generous upper bound per call, matching the RPC's own limit. A
 * professor typing in one or two students never gets near it. */
export const MAX_MANUAL_ROWS = 50;

const optionalText = z
  .string()
  .trim()
  .max(200, "Keep this under 200 characters")
  .optional()
  .transform((v) => (v ? v : null));

export function manualStudentRowSchema(allowedEmailDomain: string | null) {
  return z.object({
    fullName: z.string().trim().min(1, "Name is required").max(200, "Keep this under 200 characters"),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, "Email is required")
      .regex(EMAIL_REGEX, "Not a valid email address")
      .refine(
        (email) => !allowedEmailDomain || email.split("@")[1] === allowedEmailDomain.toLowerCase(),
        { message: `Email must end in @${allowedEmailDomain ?? ""}` }
      ),
    rollNumber: optionalText,
    programme: optionalText,
    yearOfStudy: optionalText,
    section: optionalText,
  });
}

export type ManualStudentRow = z.output<ReturnType<typeof manualStudentRowSchema>>;

/** What the dialog sends: the raw text of each row plus a client-generated
 * key, so results can be matched back to rows that may have been reordered
 * or removed in the meantime. */
export interface ManualStudentRowInput {
  key: string;
  fullName: string;
  email: string;
  rollNumber: string;
  programme: string;
  yearOfStudy: string;
  section: string;
}

export const MANUAL_ROW_FIELDS = [
  { name: "fullName", label: "Full name" },
  { name: "email", label: "Email" },
  { name: "rollNumber", label: "Roll number" },
  { name: "programme", label: "Programme" },
  { name: "yearOfStudy", label: "Year of study" },
  { name: "section", label: "Section" },
] as const satisfies ReadonlyArray<{ name: keyof Omit<ManualStudentRowInput, "key">; label: string }>;

export function emptyManualRow(key: string): ManualStudentRowInput {
  return { key, fullName: "", email: "", rollNumber: "", programme: "", yearOfStudy: "", section: "" };
}

export function isBlankManualRow(row: ManualStudentRowInput): boolean {
  return MANUAL_ROW_FIELDS.every(({ name }) => (row[name] ?? "").trim() === "");
}

export type ManualFieldErrors = Partial<Record<keyof Omit<ManualStudentRowInput, "key">, string>>;

export type ManualRowCheck =
  | { ok: true; data: ManualStudentRow }
  | { ok: false; fieldErrors: ManualFieldErrors };

/** Validates every row on its own, then flags repeated emails (the second
 * and later occurrences). One bad row never affects another's result. */
export function checkManualRows(
  rows: ManualStudentRowInput[],
  allowedEmailDomain: string | null
): ManualRowCheck[] {
  const schema = manualStudentRowSchema(allowedEmailDomain);
  const firstRowForEmail = new Map<string, number>();

  return rows.map((row, index) => {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      const fieldErrors: ManualFieldErrors = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0] as keyof ManualFieldErrors;
        fieldErrors[field] ??= issue.message;
      }
      return { ok: false, fieldErrors };
    }

    const first = firstRowForEmail.get(parsed.data.email);
    if (first !== undefined) {
      return { ok: false, fieldErrors: { email: `Same email as row ${first + 1}` } };
    }
    firstRowForEmail.set(parsed.data.email, index);
    return { ok: true, data: parsed.data };
  });
}

/** add_students_to_class's per-row outcome (migration 0031). */
export type ManualAddOutcome =
  | "ENROLLED"
  | "PROVISIONED"
  | "PENDING_SIGNUP"
  | "ALREADY_ENROLLED"
  | "PENDING_OTHER_CLASS"
  | "NEEDS_ATTENTION"
  | "INVALID"
  | "ERROR";

export interface ManualAddRowResult {
  key: string;
  email: string;
  fullName: string;
  /** "added": now on the roster (or in the class) — clear the row.
   * "attention": on the roster, but an administrator has to look at it;
   *   resubmitting would not help, so the row is cleared too.
   * "failed": nothing was added — the row stays for the professor to fix. */
  status: "added" | "attention" | "failed";
  outcome: ManualAddOutcome | "CLIENT_INVALID";
  /** Plain-language line for the professor. */
  message: string;
  /** Present when the row failed on a specific field, for inline display. */
  fieldErrors?: ManualFieldErrors;
}

export interface ManualAddSummary {
  results: ManualAddRowResult[];
  added: number;
  needsAttention: number;
}

export const PENDING_ANOTHER_CLASS_MESSAGE =
  "This student is pending enrollment in another class. Ask them to sign in with Google once, then add them here.";

/** Shared with the import's DUPLICATE_PENDING_OTHER_CLASS row message.
 * The name is only ever present when the caller manages that class too
 * (check_roster_emails, migration 0031). */
export function pendingOtherClassMessage(otherClassName: string | null | undefined): string {
  if (!otherClassName) return PENDING_ANOTHER_CLASS_MESSAGE;
  return `This student is waiting for their first sign-in on your class “${otherClassName}”. Remove them from that roster, or ask them to sign in with Google once, then add them here.`;
}

export function statusForOutcome(outcome: ManualAddOutcome): ManualAddRowResult["status"] {
  switch (outcome) {
    case "ENROLLED":
    case "PROVISIONED":
    case "PENDING_SIGNUP":
      return "added";
    case "NEEDS_ATTENTION":
      return "attention";
    default:
      return "failed";
  }
}

const INVALID_MESSAGE: Readonly<Record<string, { field: keyof ManualFieldErrors; message: string }>> = {
  EMAIL_INVALID: { field: "email", message: "Not a valid email address" },
  NAME_REQUIRED: { field: "fullName", message: "Name is required" },
  DOMAIN_NOT_ALLOWED: {
    field: "email",
    message: "This email's domain can't sign in to this app, so they could never be set up.",
  },
};

/** The professor-facing line for one row. Never names a database, a
 * constraint or an error code — those go to the server log. */
export function describeManualOutcome(
  outcome: ManualAddOutcome,
  fullName: string,
  detail: { otherClassName?: string | null; errorCode?: string | null } = {}
): { message: string; fieldErrors?: ManualFieldErrors } {
  switch (outcome) {
    case "ENROLLED":
    case "PROVISIONED":
      return { message: `${fullName} can sign in now.` };
    case "PENDING_SIGNUP":
      return { message: `${fullName} added. They'll be set up at their first Google sign-in.` };
    case "ALREADY_ENROLLED":
      return {
        message: "Already in this class (or waiting for their first sign-in here).",
        fieldErrors: { email: "Already in this class" },
      };
    case "PENDING_OTHER_CLASS":
      return { message: pendingOtherClassMessage(detail.otherClassName), fieldErrors: { email: "Pending in another class" } };
    case "NEEDS_ATTENTION":
      return { message: describeProvisioningFailure(detail.errorCode ?? "") };
    case "INVALID": {
      const known = INVALID_MESSAGE[detail.errorCode ?? ""];
      return known
        ? { message: known.message, fieldErrors: { [known.field]: known.message } }
        : { message: "Check this row's details and try again." };
    }
    case "ERROR":
      return detail.errorCode === "ROSTER_EMAIL_CONFLICT"
        ? {
            message:
              "This email belongs to an account that isn't set up properly, so they weren't added. An administrator needs to look at it.",
          }
        : { message: "This student couldn't be added. Try again; if it keeps happening, contact an administrator." };
  }
}
