"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { parseRosterFile, RosterFileFormatError, RosterFileTooLargeError } from "@/lib/roster/parse";
import {
  classifyRosterRows,
  extractCandidateEmail,
  isImportableClassification,
  type ClassifyRosterRowsContext,
  type RosterEmailCheck,
} from "@/lib/roster/validate";
import type { RosterImportPreview, RosterImportSummary, RosterRowResult } from "@/lib/types/domain";

export type RosterActionResult<T> = { success: true; data: T } | { success: false; error: string };

const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? null;

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

async function requireProfessorForClass(classId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, authorized: false } as const;

  const { data: classRow } = await supabase
    .from("classes")
    .select("id")
    .eq("id", classId)
    .maybeSingle();

  return { supabase, authorized: !!classRow } as const;
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
): Promise<{ results: RosterRowResult[]; emailChecks: Map<string, RosterEmailCheck> }> {
  const rawRows = await parseRosterFile(file);

  const candidateEmails = Array.from(
    new Set(rawRows.map(extractCandidateEmail).filter((e): e is string => !!e))
  );
  const emailChecks = await fetchEmailChecks(supabase, classId, candidateEmails);

  const context: ClassifyRosterRowsContext = { emailChecks, allowedEmailDomain: ALLOWED_EMAIL_DOMAIN };
  return { results: classifyRosterRows(rawRows, context), emailChecks };
}

function splitResults(results: RosterRowResult[]): RosterImportPreview {
  const importableRows = results.filter((r) => isImportableClassification(r.classification));
  const rejectedRows = results.filter((r) => !isImportableClassification(r.classification));
  return { totalRows: results.length, importableRows, rejectedRows };
}

export async function previewRosterImport(
  classId: string,
  formData: FormData
): Promise<RosterActionResult<RosterImportPreview>> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { success: false, error: "No file uploaded." };

  const { supabase, authorized } = await requireProfessorForClass(classId);
  if (!authorized) return { success: false, error: "Class not found, or you don't have access to it." };

  try {
    const { results } = await parseAndClassify(supabase, classId, file);
    return { success: true, data: splitResults(results) };
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

  const { supabase, authorized } = await requireProfessorForClass(classId);
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

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}`);

  const summary = data as { importId: string; imported: number; rejected: number; total: number };
  return {
    success: true,
    data: {
      importId: summary.importId,
      imported: summary.imported,
      rejected: summary.rejected,
      total: summary.total,
    },
  };
}
