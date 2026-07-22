import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildWorkbook, gatherWorkbookData } from "@/lib/exports/workbook";

/**
 * GET /classes/:classId/exports/workbook — the 10-sheet Excel export.
 *
 * The ownership check below is belt-and-braces: every read inside
 * `gatherWorkbookData` uses this same RLS-scoped client, so a non-owner
 * would get empty sheets rather than another class's data. The explicit
 * check turns that into an honest 403.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id, name, professor_id")
    .eq("id", classId)
    .maybeSingle();
  if (classError) {
    return NextResponse.json(
      { error: `Could not verify access: ${classError.message}` },
      { status: 500 }
    );
  }
  if (!classRow || classRow.professor_id !== user.id) {
    return NextResponse.json(
      { error: "Class not found, or you are not its professor." },
      { status: 403 }
    );
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email")
    .eq("id", user.id)
    .maybeSingle();

  try {
    const data = await gatherWorkbookData(supabase, {
      classId,
      className: classRow.name,
      generatedBy: profile?.full_name ?? profile?.email ?? user.id,
    });
    const buffer = await buildWorkbook(data);

    const { error: auditError } = await supabase.rpc("log_audit_event", {
      p_action: "EXPORT_GENERATED",
      p_entity_type: "class",
      p_entity_id: classId,
      p_metadata: { format: "xlsx", sheets: Object.keys(data.sheets).length },
    });
    if (auditError) console.error("audit log failed for EXPORT_GENERATED", auditError);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="analytics-export-${stamp}.xlsx"`,
      },
    });
  } catch (err) {
    // Never a silent empty workbook — say what broke.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed." },
      { status: 500 }
    );
  }
}
