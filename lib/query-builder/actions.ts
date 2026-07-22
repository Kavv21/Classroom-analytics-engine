"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  executeQuery,
  QueryValidationError,
  type QueryResult,
} from "@/lib/query-builder/execute";
import { validateQuery, summariseIssues } from "@/lib/query-builder/validate";
import type { ChartTypeId, QueryDefinition } from "@/lib/query-builder/schema";

export type BuilderResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Professor-of-class boundary. RLS is the enforcement; this check exists
 * so an unauthorised request gets a clear message instead of an empty
 * result, and so a saved definition's `class_id` is never trusted
 * (migration 0014 also blocks saving a row against someone else's class).
 * A lookup error is surfaced, never conflated with "not yours".
 */
async function requireProfessorForClass(classId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, authorized: false, checkError: null } as const;

  const { data: classRow, error: checkError } = await supabase
    .from("classes")
    .select("id, name, professor_id")
    .eq("id", classId)
    .maybeSingle();
  if (checkError) {
    console.error("query-builder: class lookup failed", checkError);
  }
  return {
    supabase,
    user,
    classRow,
    authorized: !!classRow && classRow.professor_id === user.id,
    checkError,
  } as const;
}

function accessError<T>(checkError: { message: string } | null): BuilderResult<T> {
  if (checkError) {
    return { success: false, error: `Could not verify access: ${checkError.message}` };
  }
  return { success: false, error: "Class not found, or you are not its professor." };
}

async function buildContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string
) {
  const { data: assignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("id, title, sequence_number")
    .eq("class_id", classId)
    .order("sequence_number");
  if (assignmentsError) {
    throw new Error(`Could not load assignments: ${assignmentsError.message}`);
  }

  const { data: members, error: membersError } = await supabase
    .from("class_members")
    .select("user_id, profiles(full_name, email)")
    .eq("class_id", classId)
    .eq("member_role", "STUDENT")
    .returns<
      Array<{ user_id: string; profiles: { full_name: string | null; email: string } | null }>
    >();
  if (membersError) {
    throw new Error(`Could not load students: ${membersError.message}`);
  }

  const assignmentIdBySequence: Record<number, string | undefined> = {};
  const assignmentTitles: Record<string, string> = {};
  for (const a of assignments ?? []) {
    assignmentIdBySequence[a.sequence_number] = a.id;
    assignmentTitles[a.id] = a.title;
  }
  const studentNames: Record<string, string> = {};
  for (const m of members ?? []) {
    if (m.profiles) studentNames[m.user_id] = m.profiles.full_name ?? m.profiles.email;
  }

  return { classId, assignmentIdBySequence, studentNames, assignmentTitles };
}

// ============================================================
// Preview
// ============================================================

export async function runBuilderQuery(
  classId: string,
  query: QueryDefinition
): Promise<BuilderResult<QueryResult>> {
  const validation = validateQuery(query);
  if (!validation.valid) {
    return { success: false, error: summariseIssues(validation) };
  }

  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError);

  try {
    const context = await buildContext(supabase, classId);
    const result = await executeQuery(supabase, query, context);
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof QueryValidationError) {
      return { success: false, error: err.issues };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "The query could not be run.",
    };
  }
}

// ============================================================
// Saved queries / visualisations / dashboards
// ============================================================

export interface SavedQuerySummary {
  id: string;
  name: string;
  definition: QueryDefinition;
  updatedAt: string;
}

export interface SavedVisualisationSummary {
  id: string;
  name: string;
  description: string | null;
  chartType: ChartTypeId;
  definition: QueryDefinition;
  updatedAt: string;
}

export interface DashboardSummary {
  id: string;
  name: string;
  itemCount: number;
  updatedAt: string;
}

export async function saveQuery(
  classId: string,
  name: string,
  definition: QueryDefinition
): Promise<BuilderResult<{ id: string }>> {
  const trimmed = name.trim();
  if (trimmed === "") return { success: false, error: "Give the query a name before saving." };

  const validation = validateQuery(definition);
  if (!validation.valid) {
    return {
      success: false,
      error: `This query can't be saved until it is valid: ${summariseIssues(validation)}`,
    };
  }

  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError);

  const { data, error } = await supabase
    .from("saved_queries")
    .insert({ class_id: classId, created_by: user.id, name: trimmed, definition })
    .select("id")
    .single();
  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}/analytics/builder`);
  return { success: true, data: { id: data.id } };
}

export async function saveVisualisation(
  classId: string,
  name: string,
  description: string,
  definition: QueryDefinition
): Promise<BuilderResult<{ id: string }>> {
  const trimmed = name.trim();
  if (trimmed === "") {
    return { success: false, error: "Give the visualisation a name before saving." };
  }

  const validation = validateQuery(definition);
  if (!validation.valid) {
    return {
      success: false,
      error: `This visualisation can't be saved until it is valid: ${summariseIssues(validation)}`,
    };
  }

  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError);

  const { data, error } = await supabase
    .from("saved_visualisations")
    .insert({
      class_id: classId,
      created_by: user.id,
      name: trimmed,
      description: description.trim() === "" ? null : description.trim(),
      chart_type: definition.chartType,
      query_definition: definition,
    })
    .select("id")
    .single();
  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}/analytics/builder`);
  return { success: true, data: { id: data.id } };
}

export async function deleteSavedItem(
  classId: string,
  kind: "query" | "visualisation" | "dashboard",
  id: string
): Promise<BuilderResult<null>> {
  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError);

  const table =
    kind === "query"
      ? "saved_queries"
      : kind === "visualisation"
        ? "saved_visualisations"
        : "dashboards";

  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}/analytics/builder`);
  return { success: true, data: null };
}

export async function createDashboard(
  classId: string,
  name: string,
  visualisationIds: string[]
): Promise<BuilderResult<{ id: string }>> {
  const trimmed = name.trim();
  if (trimmed === "") return { success: false, error: "Give the dashboard a name." };

  const { supabase, user, authorized, checkError } = await requireProfessorForClass(classId);
  if (!user || !authorized || checkError) return accessError(checkError);

  const { data, error } = await supabase
    .from("dashboards")
    .insert({ class_id: classId, created_by: user.id, name: trimmed })
    .select("id")
    .single();
  if (error) return { success: false, error: error.message };

  if (visualisationIds.length > 0) {
    const { error: itemsError } = await supabase.from("dashboard_items").insert(
      visualisationIds.map((visualisationId, index) => ({
        dashboard_id: data.id,
        saved_visualisation_id: visualisationId,
        position: index,
      }))
    );
    if (itemsError) {
      return {
        success: false,
        error: `The dashboard was created but its items could not be added: ${itemsError.message}`,
      };
    }
  }

  revalidatePath(`/classes/${classId}/analytics/builder`);
  return { success: true, data: { id: data.id } };
}
