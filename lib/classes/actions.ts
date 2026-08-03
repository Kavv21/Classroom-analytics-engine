"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { classFormSchema, type ClassFormValues } from "@/lib/classes/schema";

export type ActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; fieldErrors?: Record<string, string[]> };

function generateClassCode(): string {
  // Short, human-typeable code — collisions are handled by retrying against
  // the DB's unique constraint, not by widening this alphabet.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function nullIfBlank(value: string | undefined): string | null {
  return value && value.trim() !== "" ? value.trim() : null;
}

async function requireProfessor() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, user: null, profile: null, profileError: null } as const;

  // A failed profile lookup is NOT "no profile" — during the RLS outage this
  // exact query errored, and discarding `error` made every professor see
  // "Only professors can create classes" instead of the real DB failure.
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("requireProfessor: profile lookup failed", profileError);
  }

  return { supabase, user, profile, profileError } as const;
}

export async function createClass(
  input: ClassFormValues
): Promise<ActionResult<{ id: string }>> {
  const parsed = classFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user, profile, profileError } = await requireProfessor();
  if (profileError) {
    return { success: false, error: `Could not verify your account: ${profileError.message}` };
  }
  if (!user || !profile || (profile.role !== "PROFESSOR" && profile.role !== "ADMIN")) {
    return { success: false, error: "Only professors can create classes." };
  }

  const values = parsed.data;
  const classCode = nullIfBlank(values.classCode) ?? generateClassCode();

  const { data, error } = await supabase
    .from("classes")
    .insert({
      professor_id: user.id,
      name: values.name.trim(),
      course_name: nullIfBlank(values.courseName),
      academic_year: nullIfBlank(values.academicYear),
      semester: nullIfBlank(values.semester),
      section: nullIfBlank(values.section),
      class_code: classCode,
      start_date: nullIfBlank(values.startDate),
      end_date: nullIfBlank(values.endDate),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: "That class code is already in use." };
    }
    return { success: false, error: error.message };
  }

  revalidatePath("/classes");
  return { success: true, data: { id: data.id } };
}

export async function updateClass(
  classId: string,
  input: ClassFormValues
): Promise<ActionResult<{ id: string }>> {
  const parsed = classFormSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: "Please fix the highlighted fields.",
      fieldErrors: parsed.error.flatten().fieldErrors,
    };
  }

  const { supabase, user } = await requireProfessor();
  if (!user) return { success: false, error: "Not signed in." };

  const values = parsed.data;

  const { data, error } = await supabase
    .from("classes")
    .update({
      name: values.name.trim(),
      course_name: nullIfBlank(values.courseName),
      academic_year: nullIfBlank(values.academicYear),
      semester: nullIfBlank(values.semester),
      section: nullIfBlank(values.section),
      class_code: nullIfBlank(values.classCode),
      start_date: nullIfBlank(values.startDate),
      end_date: nullIfBlank(values.endDate),
      updated_at: new Date().toISOString(),
    })
    .eq("id", classId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { success: false, error: "That class code is already in use." };
    }
    return { success: false, error: error.message };
  }
  if (!data) {
    return { success: false, error: "Class not found, or you don't have access to it." };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  return { success: true, data: { id: data.id } };
}

async function setClassStatus(
  classId: string,
  status: "ACTIVE" | "ARCHIVED"
): Promise<ActionResult<{ id: string }>> {
  const { supabase, user } = await requireProfessor();
  if (!user) return { success: false, error: "Not signed in." };

  const { data, error } = await supabase
    .from("classes")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", classId)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) {
    return { success: false, error: "Class not found, or you don't have access to it." };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  return { success: true, data: { id: data.id } };
}

export async function archiveClass(classId: string): Promise<ActionResult<{ id: string }>> {
  return setClassStatus(classId, "ARCHIVED");
}

export async function unarchiveClass(classId: string): Promise<ActionResult<{ id: string }>> {
  return setClassStatus(classId, "ACTIVE");
}

// ============================================================
// Permanent deletion of a whole class.
//
// Archiving (above) is a status flip and nothing more — classes.status is
// a plain CHECK constraint ('ACTIVE' | 'ARCHIVED', migration 0005) with no
// transition trigger behind it, unlike assignments.status. That is why
// there is no `unarchiveClass` RPC to match `unarchive_assignment`:
// restoring a class never needed one, and `unarchiveClass` above has
// always just written the column.
//
// Deleting is the opposite kind of act, and goes through the SECURITY
// DEFINER `delete_class_permanently` (migration 0025): it has to cross
// the questions immutability trigger and reach response rows no professor
// has a DELETE policy over. See 0025's header.
// ============================================================

/** Shape of `class_deletion_counts` / `delete_class_permanently`. */
export interface ClassDeletionCounts {
  classId: string;
  name: string;
  status: "ACTIVE" | "ARCHIVED";
  assignments: number;
  questions: number;
  responses: number;
  attempts: number;
  students: number;
  rosterEntries: number;
  savedViews: number;
}

/**
 * What `deleteClassPermanently` would destroy, read live for the
 * confirmation dialog. NULL from the RPC means "no such class, or not
 * yours" — an access error, never an empty census.
 */
export async function getClassDeletionCounts(
  classId: string
): Promise<ActionResult<ClassDeletionCounts>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("class_deletion_counts", {
    p_class_id: classId,
  });

  if (error) return { success: false, error: error.message };
  if (!data) {
    return { success: false, error: "Class not found, or you don't have access to it." };
  }
  return { success: true, data: data as ClassDeletionCounts };
}

/**
 * Irreversible, and strictly larger than deleting an assignment: every
 * assignment in the class goes with it, and so do the roster, the pending
 * roster entries, and the saved queries / visualisations / dashboards
 * scoped to the class.
 *
 * Student *profiles* are not touched. Deleting a class deletes this
 * class's record of a student, not the student's account — they may be
 * enrolled elsewhere, and their login is not this class's property.
 */
export async function deleteClassPermanently(
  classId: string
): Promise<ActionResult<ClassDeletionCounts>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_class_permanently", {
    p_class_id: classId,
  });

  if (error) return { success: false, error: error.message };
  if (!data) {
    return { success: false, error: "Class not found, or you don't have access to it." };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${classId}`);
  return { success: true, data: data as ClassDeletionCounts };
}

/**
 * Toggles a student's profiles.is_active via the set_student_active RPC
 * (supabase/migrations/0005), which writes only that one column after
 * checking the caller is the class's professor and the student is a member
 * of it — see that migration's comment for why this isn't a plain RLS
 * UPDATE policy.
 */
export async function setStudentActive(
  classId: string,
  profileId: string,
  isActive: boolean
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_student_active", {
    p_class_id: classId,
    p_profile_id: profileId,
    p_is_active: isActive,
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}`);
  return { success: true, data: null };
}
