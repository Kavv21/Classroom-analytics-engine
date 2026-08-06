import { z } from "zod";
import type { RosterRowInput, RosterRowResult, RosterRowClassification } from "@/lib/types/domain";
import {
  REQUIRED_ROSTER_FIELDS,
  ROSTER_FIELDS,
  missingColumnMessage,
  type RawRosterRow,
  type RosterField,
} from "@/lib/roster/parse";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Only name, enrollment number and email are required. Programme, year of
 * study and section are imported when the file happens to carry them and are
 * never a reason to reject a row — plenty of institutional exports simply
 * don't have those columns.
 */
const rosterRowSchema = z.object({
  email: z.string().trim().toLowerCase().regex(EMAIL_REGEX, "Not a valid email address"),
  fullName: z.string().trim().min(1, "Name is required"),
  rollNumber: z.string().trim().min(1, "Enrollment number is required"),
  programme: z.string().trim().optional(),
  yearOfStudy: z.string().trim().optional(),
  section: z.string().trim().optional(),
});

const FIELD_LABEL: Readonly<Record<string, string>> = Object.fromEntries(
  ROSTER_FIELDS.map((spec) => [spec.field, spec.label])
);

/**
 * Zod's default message for a key that is absent (as opposed to empty) is a
 * bare "Required" — which is precisely the note that told professors nothing.
 * Always name the field instead. Typed structurally so it doesn't couple to a
 * particular zod major.
 */
function describeIssue(issue: {
  path: readonly PropertyKey[];
  code: string;
  message: string;
}): string {
  const label = FIELD_LABEL[String(issue.path[0] ?? "")];
  if (!label) return issue.message;
  return issue.code === "invalid_type" ? `${label} is required` : issue.message;
}

function emptyToUndefined(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const str = String(value).trim();
  return str === "" ? undefined : str;
}

/** Parses + shape-validates a single raw row. Pure — no DB, no duplicate
 * detection (that needs the whole-file / whole-DB context, see
 * classifyRosterRows below).
 *
 * `presentFields` separates the two failure modes a professor confuses
 * otherwise: a required *column* the file never had, versus a required cell
 * left blank on this one row. The first is a file-wide problem worth naming
 * the accepted spellings for; the second is a per-row data problem. */
function parseRow(
  raw: RawRosterRow,
  rowNumber: number,
  presentFields: ReadonlySet<RosterField> | null
): { data: RosterRowInput | null; errors: string[] } {
  if (presentFields) {
    const missingColumns = REQUIRED_ROSTER_FIELDS.filter(
      (spec) => !presentFields.has(spec.field)
    );
    // Reporting "Name is required" 60 times for a file that never had a Name
    // column is the bug this replaces — say which column, and what it could
    // have been called.
    if (missingColumns.length > 0) {
      return {
        data: null,
        errors: missingColumns.map((spec) => `Missing: ${missingColumnMessage(spec)}`),
      };
    }
  }

  const candidate = {
    email: emptyToUndefined(raw.email),
    fullName: emptyToUndefined(raw.fullName),
    rollNumber: emptyToUndefined(raw.rollNumber),
    programme: emptyToUndefined(raw.programme),
    yearOfStudy: emptyToUndefined(raw.yearOfStudy),
    section: emptyToUndefined(raw.section),
  };

  const parsed = rosterRowSchema.safeParse(candidate);
  if (!parsed.success) {
    return { data: null, errors: parsed.error.issues.map(describeIssue) };
  }

  return {
    data: {
      rowNumber,
      email: parsed.data.email,
      fullName: parsed.data.fullName,
      rollNumber: parsed.data.rollNumber,
      programme: parsed.data.programme ?? null,
      yearOfStudy: parsed.data.yearOfStudy ?? null,
      section: parsed.data.section ?? null,
    },
    errors: [],
  };
}

/**
 * Result of the `check_roster_emails` RPC for one email — a narrow,
 * security-definer function (supabase/migrations/0005) since a professor
 * has no RLS-granted SELECT on arbitrary `profiles`/`roster_entries` rows
 * outside their own classes, but still needs a yes/no answer to "does this
 * email already exist somewhere" to avoid a unique-constraint violation on
 * roster_entries.email. The RPC returns only these booleans, never another
 * class's identity or any other student's profile fields.
 */
export interface RosterEmailCheck {
  hasProfile: boolean;
  /** Only meaningful when hasProfile is true — the professor is enrolling
   * an email they themselves typed into their own roster file, so handing
   * back the matching profile id (not any other field) is not a leak. */
  profileId: string | null;
  alreadyClassMember: boolean;
  pendingThisClass: boolean;
  pendingOtherClass: boolean;
}

export interface ClassifyRosterRowsContext {
  /** Keyed by lowercase email — one entry per unique email in the upload,
   * from lib/roster/actions.ts calling check_roster_emails. */
  emailChecks: ReadonlyMap<string, RosterEmailCheck>;
  /** From app_config.allowed_email_domain. Rows outside this domain can
   * never be auto-provisioned by handle_new_user(), so they're rejected at
   * import time rather than silently creating a dead roster_entries row. */
  allowedEmailDomain: string | null;
  /** Which fields the uploaded file supplies a column for, from
   * parseRosterFile's header mapping. Omit (or pass null) when classifying
   * rows that didn't come from a file — every field is then assumed present
   * and only cell-level emptiness is reported. */
  presentFields?: ReadonlySet<RosterField> | null;
}

/**
 * Classifies every parsed row against the rest of the file and the current
 * DB state. Pure function — the caller (lib/roster/actions.ts) is
 * responsible for fetching the DB context and for re-running this at
 * commit time rather than trusting whatever the client last saw.
 */
export function classifyRosterRows(
  rawRows: RawRosterRow[],
  context: ClassifyRosterRowsContext
): RosterRowResult[] {
  const seenInFile = new Set<string>();
  const results: RosterRowResult[] = [];

  rawRows.forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1 in the source file
    const { data, errors } = parseRow(raw, rowNumber, context.presentFields ?? null);

    if (!data) {
      results.push({
        rowNumber,
        raw,
        classification: "INVALID",
        errors,
        data: null,
      });
      return;
    }

    if (context.allowedEmailDomain) {
      const domain = data.email.split("@")[1];
      if (domain !== context.allowedEmailDomain) {
        results.push({
          rowNumber,
          raw,
          classification: "INVALID",
          errors: [`Email domain must be @${context.allowedEmailDomain}`],
          data,
        });
        return;
      }
    }

    if (seenInFile.has(data.email)) {
      results.push({
        rowNumber,
        raw,
        classification: "DUPLICATE_IN_FILE",
        errors: [`Duplicate email within this file: ${data.email}`],
        data,
      });
      return;
    }
    seenInFile.add(data.email);

    let classification: RosterRowClassification;
    const errorsOut: string[] = [];
    const check = context.emailChecks.get(data.email);

    if (check?.alreadyClassMember || check?.pendingThisClass) {
      classification = "DUPLICATE_ALREADY_IN_CLASS";
      errorsOut.push("This student is already enrolled (or pending import) in this class.");
    } else if (check?.hasProfile) {
      classification = "EXISTING_PROFILE";
    } else if (check?.pendingOtherClass) {
      classification = "DUPLICATE_PENDING_OTHER_CLASS";
      errorsOut.push(
        "This student is already pre-provisioned for a different class and hasn't signed in yet. " +
          "Ask that class's professor, or wait until they sign in and enrol them directly."
      );
    } else {
      classification = "NEW";
    }

    results.push({ rowNumber, raw, classification, errors: errorsOut, data });
  });

  return results;
}

export function isImportableClassification(classification: RosterRowClassification): boolean {
  return classification === "NEW" || classification === "EXISTING_PROFILE";
}

/** Best-effort email extraction for rows that may otherwise fail full
 * row validation — used only to build the batch passed to
 * check_roster_emails, so an invalid email here simply won't match
 * anything and the row will still be rejected by classifyRosterRows. */
export function extractCandidateEmail(raw: RawRosterRow): string | null {
  const value = emptyToUndefined(raw.email);
  return value ? value.toLowerCase() : null;
}

const CSV_ESCAPE_REGEX = /[",\n]/;

function escapeCsvField(value: string): string {
  return CSV_ESCAPE_REGEX.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Builds the downloadable rejection report — plain CSV, no external dep,
 * since the shape is fixed and tiny. */
export function buildRejectionReportCsv(rows: RosterRowResult[]): string {
  const header = ["row_number", "email", "full_name", "roll_number", "classification", "errors"];
  const lines = rows.map((row) =>
    [
      String(row.rowNumber),
      row.data?.email ?? String(row.raw.email ?? ""),
      row.data?.fullName ?? String(row.raw.fullName ?? ""),
      row.data?.rollNumber ?? String(row.raw.rollNumber ?? ""),
      row.classification,
      row.errors.join("; "),
    ]
      .map(escapeCsvField)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}
