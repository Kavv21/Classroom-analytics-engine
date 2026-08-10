import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageClassContent } from "@/lib/classes/access";
import { buildCsv } from "@/lib/exports/csv";
import { buildDashboardPdf } from "@/lib/exports/pdf";
import { buildExportMetadata } from "@/lib/exports/metadata";
import { executeQuery, QueryValidationError } from "@/lib/query-builder/execute";
import { validateQuery, summariseIssues } from "@/lib/query-builder/validate";
import type { QueryDefinition } from "@/lib/query-builder/schema";

/**
 * POST /classes/:classId/exports/query?format=csv|pdf
 *
 * Exports one builder query. The definition arrives in the request body,
 * so it is treated as untrusted: it is re-validated here, executed
 * through the caller's RLS-scoped client, and never used to reach a class
 * the caller doesn't own.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const format = request.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "csv";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const [{ data: classRow, error: classError }, access] = await Promise.all([
    supabase.from("classes").select("id, name").eq("id", classId).maybeSingle(),
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

  let body: { query?: QueryDefinition; title?: string; chartPng?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }

  const query = body.query;
  if (!query) {
    return NextResponse.json({ error: "No query supplied." }, { status: 400 });
  }

  const validation = validateQuery(query);
  if (!validation.valid) {
    return NextResponse.json({ error: summariseIssues(validation) }, { status: 400 });
  }

  try {
    const [assignments, profile] = await Promise.all([
      supabase
        .from("assignments")
        .select("id, title, sequence_number")
        .eq("class_id", classId)
        .order("sequence_number"),
      supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    ]);

    if (assignments.error) {
      return NextResponse.json(
        { error: `Could not load assignments: ${assignments.error.message}` },
        { status: 500 }
      );
    }

    const assignmentIdBySequence: Record<number, string | undefined> = {};
    const assignmentTitles: Record<string, string> = {};
    for (const a of assignments.data ?? []) {
      assignmentIdBySequence[a.sequence_number] = a.id;
      assignmentTitles[a.id] = a.title;
    }
    const result = await executeQuery(supabase, query, {
      classId,
      assignmentIdBySequence,
      assignmentTitles,
    });

    const metadata = await buildExportMetadata(supabase, {
      classId,
      className: classRow.name,
      generatedBy: profile.data?.full_name ?? profile.data?.email ?? user.id,
      query,
    });

    const rows = result.rows.map((r) => [...r.keys, r.value]);
    const stamp = new Date().toISOString().slice(0, 10);

    const { error: auditError } = await supabase.rpc("log_audit_event", {
      p_action: "EXPORT_GENERATED",
      p_entity_type: "class",
      p_entity_id: classId,
      p_metadata: { format, dataset: query.dataset, measure: query.measure, rows: rows.length },
    });
    if (auditError) console.error("audit log failed for EXPORT_GENERATED", auditError);

    if (format === "pdf") {
      let chartPng: Uint8Array | undefined;
      if (typeof body.chartPng === "string" && body.chartPng.includes(",")) {
        chartPng = Buffer.from(body.chartPng.split(",")[1] ?? "", "base64");
      }
      const pdf = await buildDashboardPdf({
        metadata,
        title: body.title?.trim() || "Analytics report",
        tables: [{ title: result.columns.join(" · "), columns: result.columns, rows, chartPng }],
      });
      return new NextResponse(new Uint8Array(pdf), {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="analytics-report-${stamp}.pdf"`,
        },
      });
    }

    return new NextResponse(buildCsv(metadata, result.columns, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="query-export-${stamp}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof QueryValidationError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed." },
      { status: 500 }
    );
  }
}
