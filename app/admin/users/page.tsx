import { createClient } from "@/lib/supabase/server";
import {
  UserTable,
  type AdminUserRow,
  type ClassMembership,
} from "@/components/admin/user-table";

interface MembershipRow {
  user_id: string;
  status: string;
  member_role: string;
  classes: { id: string; name: string } | null;
}

export default async function AdminUsersPage() {
  const supabase = await createClient();

  // Both reads are independent, so they share one round-trip.
  const [{ data: profiles, error: profilesError }, { data: memberships, error: membersError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, email, full_name, role, roll_number, programme, is_active, created_at")
        .order("role")
        .order("email"),
      supabase
        .from("class_members")
        .select("user_id, status, member_role, classes(id, name)")
        .returns<MembershipRow[]>(),
    ]);

  if (profilesError) throw new Error(`Could not load people: ${profilesError.message}`);
  if (membersError) throw new Error(`Could not load class memberships: ${membersError.message}`);

  // A membership's role is not the person's role — someone can be a
  // PROFESSOR globally and a TA of one class — so the class list marks
  // which memberships are assistantships rather than inferring it from
  // profiles.role, which would be wrong in both directions.
  const byUser = new Map<string, ClassMembership[]>();
  for (const m of memberships ?? []) {
    if (!m.classes) continue;
    byUser.set(m.user_id, [
      ...(byUser.get(m.user_id) ?? []),
      { name: m.classes.name, isTa: m.member_role === "TA" },
    ]);
  }

  const rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
    id: p.id,
    email: p.email,
    fullName: p.full_name,
    role: p.role,
    rollNumber: p.roll_number,
    programme: p.programme,
    isActive: p.is_active,
    classes: byUser.get(p.id) ?? [],
  }));

  return <UserTable rows={rows} />;
}
