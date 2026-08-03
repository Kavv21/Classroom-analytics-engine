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

/**
 * Which of a class's students are synthetic demo accounts (migration
 * 0017). Returned as ids rather than a boolean over the class, because a
 * class can legitimately hold both — and the Demo Dashboard has to be able
 * to say so rather than labelling everyone with the majority's provenance.
 */
export async function getSyntheticStudentIds(
  supabase: SupabaseClient,
  classId: string
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("class_members")
    .select("user_id")
    .eq("class_id", classId)
    .eq("member_role", "STUDENT")
    .eq("is_synthetic", true)
    .returns<Array<{ user_id: string }>>();
  if (error) {
    throw new Error(`Could not load synthetic student list: ${error.message}`);
  }
  return new Set((data ?? []).map((r) => r.user_id));
}

export interface StudentRosterRow {
  studentId: string;
  name: string;
  email: string | null;
  studentIdentifier: string | null;
  isSynthetic: boolean;
  status: string;
  /** Attempt state per assignment id — absent means never started. */
  attemptStateByAssignment: Record<string, string>;
}

/**
 * The class's students with their per-assignment attempt state — the index
 * that leads to each student's full-responses profile.
 *
 * This reads `assignment_attempts` (one row per student per assignment, so
 * tens to hundreds of rows), never `responses`. Per-answer data belongs to
 * one student's own profile page, reached one student at a time.
 */
export async function getClassStudentRoster(
  supabase: SupabaseClient,
  classId: string
): Promise<StudentRosterRow[]> {
  // Both reads are keyed on classId alone — neither needs the other's
  // result — so they go out together rather than one after the next.
  const [
    { data: members, error: membersError },
    { data: attempts, error: attemptsError },
  ] = await Promise.all([
    supabase
      .from("class_members")
      .select("user_id, status, is_synthetic, profiles(full_name, email, student_identifier)")
      .eq("class_id", classId)
      .eq("member_role", "STUDENT")
      .returns<
        Array<{
          user_id: string;
          status: string;
          is_synthetic: boolean;
          profiles: {
            full_name: string | null;
            email: string;
            student_identifier: string | null;
          } | null;
        }>
      >(),
    supabase
      .from("assignment_attempts")
      .select("student_id, assignment_id, state, assignments!inner(class_id)")
      .eq("assignments.class_id", classId)
      .returns<Array<{ student_id: string; assignment_id: string; state: string }>>(),
  ]);

  // Still reported separately so a failure names its own query.
  if (membersError) {
    throw new Error(`Could not load students: ${membersError.message}`);
  }
  if (attemptsError) {
    throw new Error(`Could not load attempts: ${attemptsError.message}`);
  }

  const stateByStudent = new Map<string, Record<string, string>>();
  for (const a of attempts ?? []) {
    const forStudent = stateByStudent.get(a.student_id) ?? {};
    forStudent[a.assignment_id] = a.state;
    stateByStudent.set(a.student_id, forStudent);
  }

  return (members ?? [])
    .map((m) => ({
      studentId: m.user_id,
      name: m.profiles?.full_name ?? m.profiles?.email ?? `Student ${m.user_id.slice(0, 8)}`,
      email: m.profiles?.email ?? null,
      studentIdentifier: m.profiles?.student_identifier ?? null,
      isSynthetic: m.is_synthetic,
      status: m.status,
      attemptStateByAssignment: stateByStudent.get(m.user_id) ?? {},
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
