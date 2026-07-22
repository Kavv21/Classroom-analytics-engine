import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * Shared server-side plumbing for the analytics pages: the professor-only
 * boundary (RLS is the enforcement; this yields a clean 404 for anyone
 * else) and the student-name map for drill-downs. Errors are surfaced,
 * never swallowed.
 */

export async function requireProfessorClassPage(classId: string): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  classRow: { id: string; name: string } | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: classRow, error } = await supabase
    .from("classes")
    .select("id, name, professor_id")
    .eq("id", classId)
    .maybeSingle();
  if (error) {
    throw new Error(`Could not verify access: ${error.message}`);
  }
  if (!classRow || !user || classRow.professor_id !== user.id) {
    return { supabase, classRow: null };
  }
  return { supabase, classRow: { id: classRow.id, name: classRow.name } };
}

export async function getStudentNameMap(
  supabase: SupabaseClient,
  classId: string
): Promise<Record<string, string>> {
  const { data, error } = await supabase
    .from("class_members")
    .select("user_id, profiles(full_name, email)")
    .eq("class_id", classId)
    .eq("member_role", "STUDENT")
    .returns<
      Array<{
        user_id: string;
        profiles: { full_name: string | null; email: string } | null;
      }>
    >();
  if (error) {
    throw new Error(`Could not load student names: ${error.message}`);
  }
  const names: Record<string, string> = {};
  for (const row of data ?? []) {
    if (row.profiles) {
      names[row.user_id] = row.profiles.full_name ?? row.profiles.email;
    }
  }
  return names;
}

export interface AssignmentRow {
  id: string;
  title: string;
  sequence_number: number;
}

export async function getClassAssignments(
  supabase: SupabaseClient,
  classId: string
): Promise<AssignmentRow[]> {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, sequence_number")
    .eq("class_id", classId)
    .order("sequence_number");
  if (error) {
    throw new Error(`Could not load assignments: ${error.message}`);
  }
  return (data ?? []) as AssignmentRow[];
}
