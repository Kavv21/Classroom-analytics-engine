"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  parseRosterFile,
  missingColumnMessage,
  RosterFileFormatError,
  RosterFileTooLargeError,
  type RosterHeaderMapping,
} from "@/lib/roster/parse";
import {
  classifyRosterRows,
  extractCandidateEmail,
  isImportableClassification,
  type ClassifyRosterRowsContext,
  type RosterEmailCheck,
} from "@/lib/roster/validate";
import { describeProvisioningFailure } from "@/lib/roster/provisioning-failure";
import {
  checkManualRows,
  describeManualOutcome,
  statusForOutcome,
  MAX_MANUAL_ROWS,
  type ManualAddOutcome,
  type ManualAddRowResult,
  type ManualAddSummary,
  type ManualStudentRowInput,
} from "@/lib/roster/manual";
import type { RosterImportPreview, RosterImportSummary, RosterRowResult } from "@/lib/types/domain";

export type RosterActionResult<T> = { success: true; data: T } | { success: false; error: string };

const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? null;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireProfessorForClass(classId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, authorized: false, checkError: null } as const;

  // Surface a failed lookup instead of treating it as "not your class" —
  // discarding `error` here turns any DB failure into a misleading
  // authorization message.
  const { data: classRow, error: checkError } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .maybeSingle();

  if (checkError) {
    console.error("requireProfessorForClass: class lookup failed", checkError);
  }

  return { supabase, authorized: !!classRow, checkError } as const;
}

async function fetchEmailChecks(
  supabase: SupabaseServerClient,
  classId: string,
  emails: string[]
): Promise<Map<string, RosterEmailCheck>> {
  const emailChecks = new Map<string, RosterEmailCheck>();
  if (emails.length === 0) return emailChecks;

  const { data, error } = await supabase.rpc("check_roster_emails", {
    p_class_id: classId,
    p_emails: emails,
  });
  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    emailChecks.set(row.email, {
      hasProfile: row.has_profile,
      profileId: row.profile_id,
      alreadyClassMember: row.already_class_member,
      pendingThisClass: row.pending_this_class,
      pendingOtherClass: row.pending_other_class,
      pendingOtherClassName: row.pending_other_class_name ?? null,
    });
  }
  return emailChecks;
}

/** Parses + classifies the upload against current DB state. Used by both
 * previewRosterImport and commitRosterImport so the two never disagree —
 * commit always re-derives from a fresh DB read rather than trusting
 * whatever the client saw during preview. Returns the email-check map too,
 * since commit needs the resolved profile ids for EXISTING_PROFILE rows. */
async function parseAndClassify(
  supabase: SupabaseServerClient,
  classId: string,
  file: File
): Promise<{
  results: RosterRowResult[];
  emailChecks: Map<string, RosterEmailCheck>;
  mapping: RosterHeaderMapping;
}> {
  const { rows: rawRows, mapping } = await parseRosterFile(file);

  const candidateEmails = Array.from(
    new Set(rawRows.map(extractCandidateEmail).filter((e): e is string => !!e))
  );
  const emailChecks = await fetchEmailChecks(supabase, classId, candidateEmails);

  const context: ClassifyRosterRowsContext = {
    emailChecks,
    allowedEmailDomain: ALLOWED_EMAIL_DOMAIN,
    presentFields: mapping.presentFields,
  };
  return { results: classifyRosterRows(rawRows, context), emailChecks, mapping };
}

function splitResults(
  results: RosterRowResult[],
  mapping: RosterHeaderMapping
): RosterImportPreview {
  const importableRows = results.filter((r) => isImportableClassification(r.classification));
  const rejectedRows = results.filter((r) => !isImportableClassification(r.classification));
  return {
    totalRows: results.length,
    importableRows,
    rejectedRows,
    missingColumns: mapping.missingRequiredFields.map(missingColumnMessage),
    unmatchedHeaders: mapping.unmatchedHeaders,
    detectedHeaders: mapping.originalHeaders,
  };
}

export async function previewRosterImport(
  classId: string,
  formData: FormData
): Promise<RosterActionResult<RosterImportPreview>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "No file uploaded." };

  const { supabase, authorized, checkError } = await requireProfessorForClass(classId);
  if (checkError) {
    return { success: false, error: `Could not verify class access: ${checkError.message}` };
  }
  if (!authorized) return { success: false, error: "Class not found, or you don't have access to it." };

  try {
    const { results, mapping } = await parseAndClassify(supabase, classId, file);
    return { success: true, data: splitResults(results, mapping) };
  } catch (err) {
    if (err instanceof RosterFileTooLargeError || err instanceof RosterFileFormatError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to parse file." };
  }
}

export async function commitRosterImport(
  classId: string,
  formData: FormData
): Promise<RosterActionResult<RosterImportSummary>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "No file uploaded." };

  const { supabase, authorized, checkError } = await requireProfessorForClass(classId);
  if (checkError) {
    return { success: false, error: `Could not verify class access: ${checkError.message}` };
  }
  if (!authorized) return { success: false, error: "Class not found, or you don't have access to it." };

  let results: RosterRowResult[];
  let emailChecks: Map<string, RosterEmailCheck>;
  let checksum: string;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    checksum = createHash("sha256").update(buffer).digest("hex");
    // parseRosterFile consumes the File's stream, so hand it a fresh one
    // built from the buffer we just hashed.
    ({ results, emailChecks } = await parseAndClassify(supabase, classId, new File([buffer], file.name)));
  } catch (err) {
    if (err instanceof RosterFileTooLargeError || err instanceof RosterFileFormatError) {
      return { success: false, error: err.message };
    }
    return { success: false, error: err instanceof Error ? err.message : "Failed to parse file." };
  }

  const newRosterRows = results
    .filter((r): r is RosterRowResult & { data: NonNullable<RosterRowResult["data"]> } =>
      r.classification === "NEW" && !!r.data
    )
    .map((r) => ({ ...r.data, rowNumber: r.rowNumber }));

  const existingMemberRows = results
    .filter((r) => r.classification === "EXISTING_PROFILE" && r.data)
    .map((r) => ({ rowNumber: r.rowNumber, profileId: emailChecks.get(r.data!.email)?.profileId ?? null }))
    .filter((r): r is { rowNumber: number; profileId: string } => !!r.profileId);

  const rejectedRows = results
    .filter((r) => !isImportableClassification(r.classification))
    .map((r) => ({
      rowNumber: r.rowNumber,
      raw: r.raw,
      errorMessage: r.errors.join("; ") || r.classification,
    }));

  const { data, error } = await supabase.rpc("commit_roster_import", {
    p_class_id: classId,
    p_source_filename: file.name,
    p_source_checksum: checksum,
    p_new_roster_rows: newRosterRows,
    p_existing_member_rows: existingMemberRows,
    p_rejected_rows: rejectedRows,
  });

  if (error) {
    console.error("commitRosterImport: commit_roster_import failed", { classId, error });
    return { success: false, error: error.message };
  }

  revalidatePath(`/classes/${classId}`);

  const summary = data as {
    importId: string;
    imported: number;
    needsAttention: { rowNumber: number; email: string; errorCode: string; errorMessage: string }[];
    rejected: number;
    total: number;
  };

  // Rows on the roster whose provisioning failed. The import still
  // succeeded; the raw cause goes to the log, the professor gets a reason.
  for (const row of summary.needsAttention) {
    console.error("commitRosterImport: roster entry added but not provisioned", {
      classId,
      importId: summary.importId,
      ...row,
    });
  }

  return {
    success: true,
    data: {
      importId: summary.importId,
      imported: summary.imported,
      needsAttention: summary.needsAttention.map((row) => ({
        rowNumber: row.rowNumber,
        email: row.email,
        errorCode: row.errorCode,
        reason: describeProvisioningFailure(row.errorCode),
      })),
      rejected: summary.rejected,
      total: summary.total,
    },
  };
}

/**
 * Adds typed-in students to a class — the no-file path beside the import.
 *
 * Every row gets its own result; a bad row never blocks the others. Rows
 * that fail validation here never reach the database. The rest go to
 * add_students_to_class (migration 0031) in one call, which re-checks
 * everything itself (email, name, allowed domain, who already exists) and
 * hard-codes the STUDENT role — nothing role-like is read from `rows`.
 */
export async function addStudentsManually(
  classId: string,
  rows: ManualStudentRowInput[]
): Promise<RosterActionResult<ManualAddSummary>> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, error: "Add at least one student." };
  }
  if (rows.length > MAX_MANUAL_ROWS) {
    return {
      success: false,
      error: `Add at most ${MAX_MANUAL_ROWS} students at a time — use Import a roster for more.`,
    };
  }

  const { supabase, authorized, checkError } = await requireProfessorForClass(classId);
  if (checkError) {
    return { success: false, error: "Couldn't check your access to this class. Please try again." };
  }
  if (!authorized) return { success: false, error: "Class not found, or you don't have access to it." };

  // Rebuild each row from known fields only, as strings.
  const clean: ManualStudentRowInput[] = rows.map((row) => ({
    key: String(row?.key ?? ""),
    fullName: String(row?.fullName ?? ""),
    email: String(row?.email ?? ""),
    rollNumber: String(row?.rollNumber ?? ""),
    programme: String(row?.programme ?? ""),
    yearOfStudy: String(row?.yearOfStudy ?? ""),
    section: String(row?.section ?? ""),
  }));
  const checks = checkManualRows(clean, ALLOWED_EMAIL_DOMAIN);

  const results = new Map<string, ManualAddRowResult>();
  const toSend: Array<{ key: string } & Record<string, string | null>> = [];

  clean.forEach((row, index) => {
    const check = checks[index]!;
    if (!check.ok) {
      results.set(row.key, {
        key: row.key,
        email: row.email.trim().toLowerCase(),
        fullName: row.fullName.trim(),
        status: "failed",
        outcome: "CLIENT_INVALID",
        message: Object.values(check.fieldErrors)[0] ?? "Check this row's details.",
        fieldErrors: check.fieldErrors,
      });
      return;
    }
    toSend.push({ key: row.key, ...check.data });
  });

  if (toSend.length > 0) {
    const { data, error } = await supabase.rpc("add_students_to_class", {
      p_class_id: classId,
      p_rows: toSend,
    });

    if (error) {
      console.error("addStudentsManually: add_students_to_class failed", { classId, error });
      return { success: false, error: "Couldn't add these students. Nothing was changed — please try again." };
    }

    const byKey = new Map(toSend.map((row) => [row.key, row]));
    for (const row of data as Array<{
      key: string;
      email: string;
      outcome: ManualAddOutcome;
      otherClassName?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }>) {
      if (row.outcome === "NEEDS_ATTENTION" || row.outcome === "ERROR") {
        console.error("addStudentsManually: row not added cleanly", { classId, ...row });
      }
      const fullName = String(byKey.get(row.key)?.fullName ?? row.email);
      const { message, fieldErrors } = describeManualOutcome(row.outcome, fullName, row);
      results.set(row.key, {
        key: row.key,
        email: row.email,
        fullName,
        status: statusForOutcome(row.outcome),
        outcome: row.outcome,
        message,
        fieldErrors,
      });
    }
  }

  const ordered = clean.map(
    (row) =>
      results.get(row.key) ?? {
        // The RPC answers every row it is sent; this is a backstop, not a path.
        key: row.key,
        email: row.email,
        fullName: row.fullName,
        status: "failed" as const,
        outcome: "ERROR" as const,
        message: "This student couldn't be added. Try again; if it keeps happening, contact an administrator.",
      }
  );

  const added = ordered.filter((r) => r.status === "added").length;
  const needsAttention = ordered.length - added;
  if (ordered.some((r) => r.status !== "failed")) revalidatePath(`/classes/${classId}`);

  return { success: true, data: { results: ordered, added, needsAttention } };
}
