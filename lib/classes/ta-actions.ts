"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/classes/actions";

/**
 * Adding and removing a class's teaching assistants.
 *
 * Deliberately NOT reachable by a TA. Both actions call an RPC whose first
 * statement is `is_professor_of_class(...) or is_admin()` (migration
 * 0028 §8), so a TA who posts to these actions directly gets the same
 * refusal as one who never saw the form — the professor-only section on
 * the class page is presentation, the RPC gate is the boundary.
 *
 * Two write paths, the same split the roster import uses: someone who
 * already has an account gets a `class_members` row; someone who has never
 * signed in gets a pending `roster_entries` row that `handle_new_user`
 * consumes when they do.
 */

export interface ClassTa {
  /** Null until they first sign in. */
  userId: string | null;
  email: string;
  fullName: string | null;
  /** PENDING = pre-authorised, has not signed in yet. */
  status: "ACTIVE" | "PENDING";
}

export async function addClassTa(
  classId: string,
  email: string,
  fullName: string
): Promise<ActionResult<{ mode: "ENROLLED" | "PREAUTHORISED"; email: string }>> {
  const normalised = email.trim().toLowerCase();
  if (normalised === "") {
    return { success: false, error: "Enter an email address." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("add_class_ta", {
    p_class_id: classId,
    p_email: normalised,
    p_full_name: fullName.trim() === "" ? null : fullName.trim(),
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}`);
  return {
    success: true,
    data: data as { mode: "ENROLLED" | "PREAUTHORISED"; email: string },
  };
}

export async function removeClassTa(
  classId: string,
  email: string
): Promise<ActionResult<null>> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_class_ta", {
    p_class_id: classId,
    p_email: email.trim().toLowerCase(),
  });

  if (error) return { success: false, error: error.message };

  revalidatePath(`/classes/${classId}`);
  return { success: true, data: null };
}
