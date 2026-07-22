import { createClient } from "@/lib/supabase/server";
import { AuditTable, type AuditRow } from "@/components/admin/audit-table";

interface AuditQueryRow {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  profiles: { email: string; full_name: string | null } | null;
}

export default async function AdminAuditPage() {
  const supabase = await createClient();

  // audit_logs_admin (migration 0001) is SELECT-only and admin-only; the
  // join to profiles names the actor rather than showing a bare uuid.
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, metadata, created_at, profiles(email, full_name)")
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<AuditQueryRow[]>();

  if (error) throw new Error(`Could not load the activity log: ${error.message}`);

  const rows: AuditRow[] = (data ?? []).map((r) => ({
    id: r.id,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    actor: r.profiles?.full_name ?? r.profiles?.email ?? "System",
    createdAt: r.created_at,
    metadata: r.metadata,
  }));

  return <AuditTable rows={rows} />;
}
