import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildCsv } from "@/lib/exports/csv";
import { buildExportMetadata } from "@/lib/exports/metadata";
import { getResponseTransitionsLive } from "@/lib/analytics/queries";
import { getStudentNameMap, getSyntheticStudentIds } from "@/lib/analytics/page-data";
import {
  DEMO_PAIR_COLUMNS,
  demoPairCells,
  demoPairRows,
  FORMULAS,
  SYNTHETIC_NOTE,
} from "@/lib/analytics/demo-data";

/**
 * GET /classes/:classId/exports/demo — the Demo Dashboard's per-pair table
 * as CSV.
 *
 * Reuses the Phase 9 export pipeline unchanged: `buildExportMetadata` for
 * the provenance block (class, assignments, timestamp, mapping versions,
 * neutrality and approval notes) and `buildCsv` to emit it as leading `#`
 * comment lines above a valid single-table CSV. The only addition is the
 * synthetic-origin note, prepended to the metadata notes so it is the
 * first thing in the file — a downloaded spreadsheet outlives the page it
 * came from, and must not be readable as a real class's results.
 *
 * Rows and columns come from the same `demoPairRows` / `demoPairCells`
 * used by the on-screen table, so the download cannot drift from the
 * screen. Reads go through the caller's RLS-scoped client; the ownership
 * check turns a non-owner's empty result into an honest 403.
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

  try {
    const [liveRows, studentNames, syntheticIds, profile] = await Promise.all([
      getResponseTransitionsLive(supabase, classId),
      getStudentNameMap(supabase, classId),
      getSyntheticStudentIds(supabase, classId),
      supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
    ]);

    const rows = demoPairRows(liveRows, studentNames, syntheticIds);

    const metadata = await buildExportMetadata(supabase, {
      classId,
      className: classRow.name,
      generatedBy: profile.data?.full_name ?? profile.data?.email ?? user.id,
      measureIds: [],
    });
    metadata.activeFilters = [
      "Dataset: paired transitions (approved mappings only)",
      `Synthetic students: ${syntheticIds.size}`,
      `Rows: one per student per approved mapping`,
    ];
    metadata.notes = [SYNTHETIC_NOTE, FORMULAS.transitionStates, ...metadata.notes];

    const { error: auditError } = await supabase.rpc("log_audit_event", {
      p_action: "EXPORT_GENERATED",
      p_entity_type: "class",
      p_entity_id: classId,
      p_metadata: { format: "csv", dataset: "DEMO_PAIRS", rows: rows.length },
    });
    if (auditError) console.error("audit log failed for EXPORT_GENERATED", auditError);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(
      buildCsv(metadata, [...DEMO_PAIR_COLUMNS], rows.map(demoPairCells)),
      {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="demo-response-pairs-${stamp}.csv"`,
        },
      }
    );
  } catch (err) {
    // Never a silent empty file — say what broke.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed." },
      { status: 500 }
    );
  }
}
