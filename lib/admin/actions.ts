"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/types/domain";

export type AdminResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

/**
 * Admin console actions.
 *
 * Every write goes through the caller's RLS-scoped client, so
 * `profiles_admin_all` (migration 0001) is the actual boundary. The
 * explicit role check here exists to produce a clear message rather than
 * an opaque empty result, and to refuse before touching anything — it is
 * not a substitute for the policy.
 */
async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false, checkError: null } as const;

  const { data: profile, error: checkError } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (checkError) {
    console.error("admin: role lookup failed", checkError);
  }

  return {
    supabase,
    user,
    isAdmin: profile?.role === "ADMIN",
    checkError,
  } as const;
}

function denied<T>(checkError: { message: string } | null): AdminResult<T> {
  if (checkError) {
    return { success: false, error: `Could not verify your access: ${checkError.message}` };
  }
  return { success: false, error: "You need administrator access to do that." };
}

async function logAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  entityId: string,
  metadata: Record<string, unknown>
) {
  const { error } = await supabase.rpc("log_audit_event", {
    p_action: action,
    p_entity_type: "profile",
    p_entity_id: entityId,
    p_metadata: metadata,
  });
  if (error) console.error(`audit log failed for ${action}`, error);
}

const ASSIGNABLE_ROLES: UserRole[] = ["ADMIN", "PROFESSOR", "STUDENT"];

export async function changeUserRole(
  profileId: string,
  nextRole: UserRole
): Promise<AdminResult<null>> {
  if (!ASSIGNABLE_ROLES.includes(nextRole)) {
    return { success: false, error: `"${nextRole}" is not a role.` };
  }

  const { supabase, user, isAdmin, checkError } = await requireAdmin();
  if (!user || !isAdmin || checkError) return denied(checkError);

  // An admin removing their own admin rights would lock them out of this
  // screen with no way back except raw SQL.
  if (profileId === user.id && nextRole !== "ADMIN") {
    return {
      success: false,
      error: "You can't remove your own administrator access — ask another administrator.",
    };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ role: nextRole, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .select("id, email")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "That account no longer exists." };

  await logAudit(supabase, "ADMIN_ROLE_CHANGED", profileId, {
    email: data.email,
    newRole: nextRole,
  });

  revalidatePath("/admin/users");
  return { success: true, data: null };
}

export async function setUserActive(
  profileId: string,
  isActive: boolean
): Promise<AdminResult<null>> {
  const { supabase, user, isAdmin, checkError } = await requireAdmin();
  if (!user || !isAdmin || checkError) return denied(checkError);

  if (profileId === user.id && !isActive) {
    return { success: false, error: "You can't deactivate your own account." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", profileId)
    .select("id, email")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "That account no longer exists." };

  await logAudit(supabase, isActive ? "ADMIN_USER_ACTIVATED" : "ADMIN_USER_DEACTIVATED", profileId, {
    email: data.email,
  });

  revalidatePath("/admin/users");
  return { success: true, data: null };
}

/**
 * Pre-authorises an email as a professor or admin.
 *
 * This is the UI equivalent of the manual SQL in
 * docs/MAINTAINER_GUIDE.md. It cannot create an auth account — those only
 * exist after the person signs in with Google — so it writes a
 * roster_entries row carrying the intended role, which handle_new_user()
 * consumes at first sign-in. If they have already signed in, their
 * existing profile is promoted directly instead.
 */
export async function inviteStaff(
  email: string,
  intendedRole: Extract<UserRole, "ADMIN" | "PROFESSOR">,
  fullName: string
): Promise<AdminResult<{ mode: "promoted" | "preauthorised" }>> {
  const normalised = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalised)) {
    return { success: false, error: "That doesn't look like an email address." };
  }
  if (intendedRole !== "ADMIN" && intendedRole !== "PROFESSOR") {
    return { success: false, error: "Choose either Professor or Administrator." };
  }

  const { supabase, user, isAdmin, checkError } = await requireAdmin();
  if (!user || !isAdmin || checkError) return denied(checkError);

  const { data: existing, error: lookupError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", normalised)
    .maybeSingle();
  if (lookupError) {
    return { success: false, error: `Could not check for an existing account: ${lookupError.message}` };
  }

  if (existing) {
    const { error } = await supabase
      .from("profiles")
      .update({ role: intendedRole, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) return { success: false, error: error.message };

    await logAudit(supabase, "ADMIN_ROLE_CHANGED", existing.id, {
      email: normalised,
      newRole: intendedRole,
      via: "invite",
    });
    revalidatePath("/admin/users");
    return { success: true, data: { mode: "promoted" } };
  }

  const { data: inserted, error } = await supabase
    .from("roster_entries")
    .insert({
      email: normalised,
      full_name: fullName.trim() === "" ? null : fullName.trim(),
      intended_role: intendedRole,
      created_by: user.id,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return {
        success: false,
        error: "That email is already pre-authorised or on a class roster.",
      };
    }
    return { success: false, error: error.message };
  }

  await logAudit(supabase, "ADMIN_STAFF_PREAUTHORISED", inserted!.id, {
    email: normalised,
    intendedRole,
  });

  revalidatePath("/admin/users");
  return { success: true, data: { mode: "preauthorised" } };
}
