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

  if (!user) return { supabase, user: null, profile: null } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  return { supabase, user, profile } as const;
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

  const { supabase, user, profile } = await requireProfessor();
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
