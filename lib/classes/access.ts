import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { ClassAccess } from "@/lib/types/domain";

/**
 * "May this user manage this class's content?" — asked of the database,
 * not re-derived here.
 *
 * Several app-level checks used to spell this out as
 * `classRow.professor_id === user.id`, which was correct while a class had
 * exactly one kind of staff and became silently wrong the moment TAs
 * existed. They all call this instead, and this calls the same
 * `can_manage_class_content` function every RLS policy and RPC calls
 * (migration 0028), so there is exactly one definition of the rule in the
 * system and an app-level check cannot drift from the boundary it is
 * standing in front of.
 *
 * Returns `{ allowed, error }` rather than a bare boolean because a failed
 * lookup is not the same thing as "not yours" — conflating them is the
 * class-creation postmortem in lib/classes/actions.ts.
 */
export async function canManageClassContent(
  supabase: SupabaseClient,
  classId: string
): Promise<{ allowed: boolean; error: { message: string } | null }> {
  const { data, error } = await supabase.rpc("can_manage_class_content", {
    p_class_id: classId,
  });
  if (error) {
    console.error("canManageClassContent: check failed", error);
    return { allowed: false, error };
  }
  return { allowed: data === true, error: null };
}

/**
 * Who the signed-in user is *to one class*.
 *
 * This is for deciding what to RENDER. It is not the security boundary and
 * must never be treated as one: every gesture it reveals is independently
 * gated in the database (migration 0028 — the `can_manage_class_content`
 * policies, the `classes_status_authority` trigger, and the
 * professor-only `delete_class_permanently` / `add_class_ta` /
 * `remove_class_ta` RPCs). Hiding a button a TA cannot use is courtesy;
 * the reason they cannot use it is the row-level policy behind it.
 *
 * Both reads run under the caller's own RLS, so a class they have no
 * relationship with simply returns no rows and every flag is false.
 */
export async function getClassAccess(classId: string): Promise<ClassAccess> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const none: ClassAccess = { isProfessor: false, isTa: false, canManageContent: false };
  if (!user) return none;

  const [{ data: owned }, { data: membership }] = await Promise.all([
    supabase
      .from("classes")
      .select("id")
      .eq("id", classId)
      .eq("professor_id", user.id)
      .maybeSingle(),
    supabase
      .from("class_members")
      .select("member_role, status")
      .eq("class_id", classId)
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);

  const isProfessor = !!owned;
  const isTa = membership?.member_role === "TA" && membership?.status === "ACTIVE";

  return { isProfessor, isTa, canManageContent: isProfessor || isTa };
}

/**
 * Does this user assist any class at all? Drives the nav and the home
 * page's destination for someone whose global `profiles.role` says
 * STUDENT (or TA) but who has staff access somewhere — without it they
 * would have no link to the classes they work on.
 */
export async function hasAnyTaMembership(userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("class_members")
    .select("id")
    .eq("user_id", userId)
    .eq("member_role", "TA")
    .eq("status", "ACTIVE")
    .limit(1)
    .maybeSingle();
  return !!data;
}
