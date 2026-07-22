import { createClient } from "@/lib/supabase/server";
import { UserTable, type AdminUserRow } from "@/components/admin/user-table";

interface MembershipRow {
  user_id: string;
  status: string;
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
        .select("user_id, status, classes(id, name)")
        .returns<MembershipRow[]>(),
    ]);

  if (profilesError) throw new Error(`Could not load people: ${profilesError.message}`);
  if (membersError) throw new Error(`Could not load class memberships: ${membersError.message}`);

  const byUser = new Map<string, string[]>();
  for (const m of memberships ?? []) {
    if (!m.classes) continue;
    byUser.set(m.user_id, [...(byUser.get(m.user_id) ?? []), m.classes.name]);
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
