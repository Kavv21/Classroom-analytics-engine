"use server";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { mappingFormSchema, type MappingFormValues } from "@/lib/mappings/schema";
import {
  DEFAULT_SUGGEST_CONFIG,
  suggestMappings,
  suggestionSignature,
  suggestionsFromTemplate,
  TemplateResolutionError,
  type MappingSuggestion,
  type MappingTemplate,
  type SuggestableQuestion,
} from "@/lib/mappings/suggest";
import type { MappingStatus, MappingType } from "@/lib/types/domain";

export type MappingActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function nullIfBlank(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

/** Best-effort audit trail (same contract as lib/assignments/actions.ts). */
async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  entityType: string,
  entityId: string,
  metadata?: Record<string, unknown>
) {
  const { error } = await supabase.rpc("log_audit_event", {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_metadata: metadata ?? null,
  });
  if (error) {
    console.error(`audit log failed for ${action} on ${entityType} ${entityId}`, error);
  }
}

/**
 * Professor-of-class check via RLS. A lookup error is surfaced explicitly,
 * never conflated with "not yours" (class-creation postmortem rule).
 */
async function requireProfessorForClass(classId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, authorized: false, checkError: null } as const;

  const { data: classRow, error: checkError } = await supabase
    .from("classes")
    .select("id, professor_id")
    .eq("id", classId)
    .maybeSingle();

  if (checkError) {
    console.error("requireProfessorForClass: class lookup failed", checkError);
  }

  return {
    supabase,
    user,
    authorized: !!classRow && classRow.professor_id === user.id,
    checkError,
  } as const;
}

/** Same boundary, entered from a mapping id (RLS hides other classes' rows). */
async function requireProfessorForMapping(mappingId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, mapping: null, checkError: null } as const;

  const { data: mapping, error: checkError } = await supabase
    .from("question_mappings")
    .select("id, class_id, mapping_status, professor_approved, superseded_by_id")
    .eq("id", mappingId)
    .maybeSingle();

  if (checkError) {
    console.error("requireProfessorForMapping: lookup failed", checkError);
  }

  return { supabase, user, mapping, checkError } as const;
}

function accessError<T>(
  checkError: { message: string } | null,
  what: string
): MappingActionResult<T> {
  if (checkError) {
    return { success: false, error: `Could not verify access: ${checkError.message}` };
  }
  return { success: false, error: `${what} not found, or you don't have access to it.` };
}

function mappingsPath(classId: string): string {
  return `/classes/${classId}/mappings`;
}

// ============================================================
// CRUD
// ============================================================

export async function createMapping(
  classId: string,
  input: MappingFormValues
): Promise<MappingActionResult<{ id: string }>> {
  const parsed = mappingFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError, "Class");

  const v = parsed.data;
  const { data, error } = await supabase.rpc("create_question_mapping", {
    p_class_id: classId,
    p_a1_question_ids: v.a1QuestionIds,
    p_a2_question_ids: v.a2QuestionIds,
    p_mapping_name: v.mappingName,
    p_mapping_type: v.mappingType,
    p_common_concept: nullIfBlank(v.commonConcept),
    p_energy_source: nullIfBlank(v.energySource),
    p_criterion: nullIfBlank(v.criterion),
    p_comparison_method: nullIfBlank(v.comparisonMethod),
    p_professor_notes: nullIfBlank(v.professorNotes),
    p_mapping_status: "DRAFT",
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(mappingsPath(classId));
  return { success: true, data: { id: data as string } };
}

export async function updateMapping(
  mappingId: string,
  input: MappingFormValues
): Promise<MappingActionResult<{ id: string }>> {
  const parsed = mappingFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, mapping, checkError } = await requireProfessorForMapping(mappingId);
  if (!user || !mapping || checkError) return accessError(checkError, "Mapping");

  const v = parsed.data;
  const { error } = await supabase.rpc("update_question_mapping", {
    p_mapping_id: mappingId,
    p_a1_question_ids: v.a1QuestionIds,
    p_a2_question_ids: v.a2QuestionIds,
    p_mapping_name: v.mappingName,
    p_mapping_type: v.mappingType,
    p_common_concept: nullIfBlank(v.commonConcept),
    p_energy_source: nullIfBlank(v.energySource),
    p_criterion: nullIfBlank(v.criterion),
    p_comparison_method: nullIfBlank(v.comparisonMethod),
    p_professor_notes: nullIfBlank(v.professorNotes),
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(mappingsPath(mapping.class_id));
  return { success: true, data: { id: mappingId } };
}

export async function deleteMapping(
  mappingId: string
): Promise<MappingActionResult<null>> {
  const { supabase, user, mapping, checkError } = await requireProfessorForMapping(mappingId);
  if (!user || !mapping || checkError) return accessError(checkError, "Mapping");

  // The 0011 immutability trigger blocks deleting an approved or
  // analytics-referenced mapping regardless of what we do here.
  const { error } = await supabase.from("question_mappings").delete().eq("id", mappingId);
  if (error) return { success: false, error: error.message };

  await logAudit(supabase, "MAPPING_DELETED", "question_mapping", mappingId, {
    classId: mapping.class_id,
  });

  revalidatePath(mappingsPath(mapping.class_id));
  return { success: true, data: null };
}

// ============================================================
// Approval workflow
// ============================================================

export async function setMappingApproval(
  mappingId: string,
  approve: boolean
): Promise<MappingActionResult<null>> {
  const { supabase, user, mapping, checkError } = await requireProfessorForMapping(mappingId);
  if (!user || !mapping || checkError) return accessError(checkError, "Mapping");

  const { error } = await supabase.rpc("set_mapping_approval", {
    p_mapping_id: mappingId,
    p_approve: approve,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath(mappingsPath(mapping.class_id));
  return { success: true, data: null };
}

/**
 * Everything a bulk approval is about to do, computed without writing
 * anything — the preview half of the two-step approve-all flow.
 *
 * Only the two one-to-one types are offered. The others are excluded on
 * purpose, and the reason is not cosmetic: ANALYTICS_DEFINITIONS.md defines
 * T(i,j) on exactly one binary value per side, so ONE_TO_MANY /
 * MANY_TO_ONE / GROUPED_CONCEPT have no documented collapse formula and
 * produce NOT_COMPARABLE rather than transitions. Approving them in bulk
 * would add nothing to analytics while permanently freezing them under the
 * 0011 immutability triggers. NOT_COMPARABLE and UNMAPPED entries are
 * records that a source has no counterpart — there is nothing to approve.
 */
export interface BulkApprovalCandidate {
  id: string;
  name: string;
  type: MappingType;
  version: number;
  energySource: string | null;
  criterion: string | null;
}

export interface BulkApprovalPreview {
  candidates: BulkApprovalCandidate[];
  /** Suggested mappings deliberately left out, with the reason. */
  excluded: Array<{ name: string; type: MappingType; reason: string }>;
  alreadyApproved: number;
}

const BULK_APPROVABLE_TYPES: MappingType[] = ["EXACT_ONE_TO_ONE", "CONCEPTUAL_ONE_TO_ONE"];

export async function previewBulkApproval(
  classId: string
): Promise<MappingActionResult<BulkApprovalPreview>> {
  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError, "Class");

  const { data, error } = await supabase
    .from("question_mappings")
    .select(
      "id, mapping_name, mapping_type, mapping_status, professor_approved, version, energy_source, criterion, superseded_by_id"
    )
    .eq("class_id", classId)
    .order("mapping_name")
    .returns<
      Array<{
        id: string;
        mapping_name: string;
        mapping_type: MappingType;
        mapping_status: MappingStatus;
        professor_approved: boolean;
        version: number;
        energy_source: string | null;
        criterion: string | null;
        superseded_by_id: string | null;
      }>
    >();
  if (error) return { success: false, error: error.message };

  const rows = data ?? [];
  const candidates: BulkApprovalCandidate[] = [];
  const excluded: BulkApprovalPreview["excluded"] = [];
  let alreadyApproved = 0;

  for (const m of rows) {
    if (m.professor_approved) {
      alreadyApproved += 1;
      continue;
    }
    // Only pending-review states are eligible. REJECTED and SUPERSEDED are
    // decisions already made; re-approving them in bulk would silently
    // reverse the professor.
    if (!["DRAFT", "SUGGESTED", "NEEDS_PROFESSOR_REVIEW"].includes(m.mapping_status)) continue;

    if (m.superseded_by_id) {
      excluded.push({
        name: m.mapping_name,
        type: m.mapping_type,
        reason: "a newer version of this mapping exists — approve that one instead",
      });
      continue;
    }
    if (!BULK_APPROVABLE_TYPES.includes(m.mapping_type)) {
      excluded.push({
        name: m.mapping_name,
        type: m.mapping_type,
        reason:
          m.mapping_type === "NOT_COMPARABLE" || m.mapping_type === "UNMAPPED"
            ? "records that this question has no counterpart — carries no transition data"
            : "multi-question sides have no defined transition formula, so approving adds nothing to analytics",
      });
      continue;
    }
    candidates.push({
      id: m.id,
      name: m.mapping_name,
      type: m.mapping_type,
      version: m.version,
      energySource: m.energy_source,
      criterion: m.criterion,
    });
  }

  return { success: true, data: { candidates, excluded, alreadyApproved } };
}

export interface BulkApprovalResult {
  approved: number;
  failures: Array<{ name: string; reason: string }>;
}

/**
 * The confirm half. Re-derives the candidate list server-side rather than
 * trusting ids from the client, so a stale or tampered preview cannot
 * approve something the preview never showed. Each approval still goes
 * through set_mapping_approval, one call per mapping — the RPC owns version
 * retirement and the audit trail.
 */
export async function approveAllSuggestedMappings(
  classId: string
): Promise<MappingActionResult<BulkApprovalResult>> {
  const preview = await previewBulkApproval(classId);
  if (!preview.success) return preview;

  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError, "Class");

  let approved = 0;
  const failures: BulkApprovalResult["failures"] = [];

  for (const candidate of preview.data.candidates) {
    const { error } = await supabase.rpc("set_mapping_approval", {
      p_mapping_id: candidate.id,
      p_approve: true,
    });
    // One bad mapping must not abandon the rest half-done — collect and
    // report, so the professor sees exactly what did and did not land.
    if (error) failures.push({ name: candidate.name, reason: error.message });
    else approved += 1;
  }

  revalidatePath(mappingsPath(classId));
  return { success: true, data: { approved, failures } };
}

export async function createMappingVersion(
  mappingId: string
): Promise<MappingActionResult<{ id: string }>> {
  const { supabase, user, mapping, checkError } = await requireProfessorForMapping(mappingId);
  if (!user || !mapping || checkError) return accessError(checkError, "Mapping");

  const { data, error } = await supabase.rpc("create_mapping_version", {
    p_mapping_id: mappingId,
  });
  if (error) return { success: false, error: error.message };

  revalidatePath(mappingsPath(mapping.class_id));
  return { success: true, data: { id: data as string } };
}

// ============================================================
// Analytics preview (pre-approval, professor-only, aggregated in the DB)
// ============================================================

export interface MappingPreviewQuestionCount {
  questionId: string;
  side: 1 | 2;
  answered: number;
  zeros: number;
  ones: number;
}

export interface MappingPreviewPair {
  a1QuestionId: string;
  a2QuestionId: string;
  paired: number;
  pair00: number;
  pair01: number;
  pair10: number;
  pair11: number;
  missingA1: number;
  missingA2: number;
  missingBoth: number;
}

export interface MappingPreview {
  mappingId: string;
  enrolledStudents: number;
  questionCounts: MappingPreviewQuestionCount[];
  pairCounts: MappingPreviewPair[];
}

export async function previewMapping(
  mappingId: string
): Promise<MappingActionResult<MappingPreview>> {
  const { supabase, user, mapping, checkError } = await requireProfessorForMapping(mappingId);
  if (!user || !mapping || checkError) return accessError(checkError, "Mapping");

  const { data, error } = await supabase.rpc("preview_mapping_pairs", {
    p_mapping_id: mappingId,
  });
  if (error) return { success: false, error: error.message };

  return { success: true, data: data as MappingPreview };
}

// ============================================================
// Deterministic suggestion seeding. Template first (the matching already
// validated against the real spreadsheets), then the generic engine for
// anything the template doesn't cover. No LLM anywhere; nothing is ever
// auto-approved. Existing mappings with the same question sets or names
// are skipped, so re-running is idempotent.
// ============================================================

export interface SeedSuggestionsSummary {
  created: number;
  skippedExisting: number;
}

export async function seedMappingSuggestions(
  classId: string
): Promise<MappingActionResult<SeedSuggestionsSummary>> {
  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError, "Class");

  // The two sequential assignments, by sequence number.
  const { data: assignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("id, sequence_number")
    .eq("class_id", classId)
    .in("sequence_number", [1, 2]);
  if (assignmentsError) {
    return { success: false, error: `Could not load assignments: ${assignmentsError.message}` };
  }
  const a1Assignment = assignments?.find((a) => a.sequence_number === 1);
  const a2Assignment = assignments?.find((a) => a.sequence_number === 2);
  if (!a1Assignment || !a2Assignment) {
    return {
      success: false,
      error:
        "Suggestions need both Assignment 1 and Assignment 2 (sequence numbers 1 and 2) to exist with imported questions.",
    };
  }

  async function loadQuestions(assignmentId: string): Promise<SuggestableQuestion[]> {
    const { data, error } = await supabase
      .from("questions")
      .select("id, external_question_code, question_text, energy_source, criterion")
      .eq("assignment_id", assignmentId)
      .eq("is_active", true)
      .order("display_order");
    if (error) throw new Error(error.message);
    return (data ?? []).map((q) => ({
      id: q.id,
      externalQuestionCode: q.external_question_code,
      questionText: q.question_text,
      energySource: q.energy_source,
      criterion: q.criterion,
    }));
  }

  let a1Questions: SuggestableQuestion[];
  let a2Questions: SuggestableQuestion[];
  try {
    [a1Questions, a2Questions] = await Promise.all([
      loadQuestions(a1Assignment.id),
      loadQuestions(a2Assignment.id),
    ]);
  } catch (err) {
    return {
      success: false,
      error: `Could not load questions: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (a1Questions.length === 0 || a2Questions.length === 0) {
    return {
      success: false,
      error: "Both assignments need imported questions before suggestions can be generated.",
    };
  }

  let template: MappingTemplate;
  try {
    template = JSON.parse(
      await readFile(resolve(process.cwd(), "data/question-mapping-template.json"), "utf-8")
    ) as MappingTemplate;
  } catch (err) {
    return {
      success: false,
      error: `Could not read data/question-mapping-template.json: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  let suggestions: MappingSuggestion[];
  try {
    const fromTemplate = suggestionsFromTemplate(template, a1Questions, a2Questions);
    const fromEngine = suggestMappings(a1Questions, a2Questions, DEFAULT_SUGGEST_CONFIG);
    const seen = new Set(fromTemplate.map(suggestionSignature));
    suggestions = [
      ...fromTemplate,
      ...fromEngine.filter((s) => {
        const sig = suggestionSignature(s);
        if (seen.has(sig)) return false;
        seen.add(sig);
        return true;
      }),
    ];
  } catch (err) {
    // Fail loudly — an unresolvable template code means the imported
    // question set and the template disagree, which a human must look at.
    if (err instanceof TemplateResolutionError) {
      return { success: false, error: err.message };
    }
    return {
      success: false,
      error: `Suggestion engine failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Skip anything that already exists (same question sets or same name).
  const { data: existing, error: existingError } = await supabase
    .from("question_mappings")
    .select("mapping_name, assignment_1_question_ids, assignment_2_question_ids")
    .eq("class_id", classId);
  if (existingError) {
    return { success: false, error: `Could not load existing mappings: ${existingError.message}` };
  }
  const existingSignatures = new Set(
    (existing ?? []).map((m) =>
      suggestionSignature({
        a1QuestionIds: m.assignment_1_question_ids ?? [],
        a2QuestionIds: m.assignment_2_question_ids ?? [],
      })
    )
  );
  const existingNames = new Set((existing ?? []).map((m) => m.mapping_name));

  let created = 0;
  let skippedExisting = 0;
  for (const s of suggestions) {
    if (existingSignatures.has(suggestionSignature(s)) || existingNames.has(s.mappingName)) {
      skippedExisting++;
      continue;
    }
    const { error } = await supabase.rpc("create_question_mapping", {
      p_class_id: classId,
      p_a1_question_ids: s.a1QuestionIds,
      p_a2_question_ids: s.a2QuestionIds,
      p_mapping_name: s.mappingName,
      p_mapping_type: s.mappingType,
      p_common_concept: s.commonConcept,
      p_energy_source: s.energySource,
      p_criterion: s.criterion,
      p_comparison_method: s.comparisonMethod,
      p_professor_notes: s.professorNotes,
      p_mapping_status: s.mappingStatus,
    });
    if (error) {
      return {
        success: false,
        error:
          `Stopped after creating ${created} suggestion(s): ` +
          `"${s.mappingName}" failed — ${error.message}`,
      };
    }
    created++;
  }

  await logAudit(supabase, "MAPPING_SUGGESTIONS_SEEDED", "class", classId, {
    created,
    skippedExisting,
  });

  revalidatePath(mappingsPath(classId));
  return { success: true, data: { created, skippedExisting } };
}
