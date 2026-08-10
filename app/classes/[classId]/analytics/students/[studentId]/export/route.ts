import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageClassContent } from "@/lib/classes/access";
import { buildStudentWorkbook, gatherStudentWorkbookData } from "@/lib/exports/workbook";

/**
 * GET /classes/:classId/analytics/students/:studentId/export — ONE student's
 * full submission as .xlsx, in the source spreadsheet's own grid.
 *
 * This is the narrowest and most personal export in the app: a named
 * individual's raw answers. It is reached only from that student's profile
 * page, which is the single screen that shows the same data.
 *
 * The ownership check below is belt-and-braces — every read inside
 * `gatherStudentWorkbookData` uses this same RLS-scoped client, so a
 * non-owner reaches nothing whatever ids are supplied — but an explicit
 * check turns a silent empty file into an honest 403. The membership read
 * inside the gatherer is the second half of that: it also confirms the
 * student belongs to THIS class, so a professor cannot reach another
 * class's student by editing the URL.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ classId: string; studentId: string }> }
) {
  const { classId, studentId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: classRow, error: classError }, { data: profile }, access] = await Promise.all([
    supabase.from("classes").select("id, name").eq("id", classId).maybeSingle(),
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    canManageClassContent(supabase, classId),
  ]);
  if (classError) {
    return NextResponse.json(
      { error: `Could not verify access: ${classError.message}` },
      { status: 500 }
    );
  }
  if (access.error) {
    return NextResponse.json(
      { error: `Could not verify access: ${access.error.message}` },
      { status: 500 }
    );
  }
  if (!classRow || !access.allowed) {
    return NextResponse.json(
      { error: "Class not found, or you do not manage it." },
      { status: 403 }
    );
  }

  try {
    const data = await gatherStudentWorkbookData(supabase, {
      classId,
      studentId,
      className: classRow.name,
      generatedBy: profile?.full_name ?? profile?.email ?? user.id,
    });
    const buffer = await buildStudentWorkbook(data);

    const { error: auditError } = await supabase.rpc("log_audit_event", {
      p_action: "EXPORT_GENERATED",
      p_entity_type: "class_member",
      p_entity_id: studentId,
      p_metadata: {
        format: "xlsx",
        scope: "student",
        class_id: classId,
        assignments: data.assignments.length,
      },
    });
    if (auditError) console.error("audit log failed for EXPORT_GENERATED", auditError);

    // The filename names the student, because a professor downloading two
    // of these needs to tell them apart in a downloads folder.
    const stamp = new Date().toISOString().slice(0, 10);
    const slug =
      (data.student.identifier ?? data.student.name)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40) || studentId.slice(0, 8);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="student-${slug}-responses-${stamp}.xlsx"`,
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
