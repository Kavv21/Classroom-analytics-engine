import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mappingsToCsv, type MappingExportRow } from "@/lib/mappings/export";
import { questionLabel } from "@/lib/ui/question-label";

interface MappingDbRow {
  id: string;
  class_id: string;
  assignment_1_question_ids: string[] | null;
  assignment_2_question_ids: string[] | null;
  mapping_name: string;
  common_concept: string | null;
  energy_source: string | null;
  criterion: string | null;
  mapping_type: string;
  comparison_method: string | null;
  professor_notes: string | null;
  mapping_status: string;
  professor_approved: boolean;
  version: number;
  previous_version_id: string | null;
  superseded_by_id: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Mapping export — the professor's own record of the complete mapping
 * table, deliberately including unapproved, rejected, and superseded rows
 * (this is a bookkeeping export, not an analytics surface; analytics reads
 * only the approved_question_mappings view).
 *
 * GET /classes/:classId/mappings/export?format=csv|json
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ classId: string }> }
) {
  const { classId } = await params;
  const format = request.nextUrl.searchParams.get("format") === "json" ? "json" : "csv";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // RLS is the boundary; this explicit check exists so a student class
  // member gets a clear 403 instead of an empty export.
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

  const { data: mappings, error: mappingsError } = await supabase
    .from("question_mappings")
    .select(
      "id, class_id, assignment_1_question_ids, assignment_2_question_ids, mapping_name, " +
        "common_concept, energy_source, criterion, mapping_type, comparison_method, " +
        "professor_notes, mapping_status, professor_approved, version, " +
        "previous_version_id, superseded_by_id, created_at, updated_at"
    )
    .eq("class_id", classId)
    .order("mapping_name")
    .order("version")
    .returns<MappingDbRow[]>();
  if (mappingsError) {
    return NextResponse.json(
      { error: `Could not load mappings: ${mappingsError.message}` },
      { status: 500 }
    );
  }

  // Resolve question ids to both their wording and their code — the code
  // alone is not a human-readable export.
  const questionIds = [
    ...new Set(
      (mappings ?? []).flatMap((m) => [
        ...(m.assignment_1_question_ids ?? []),
        ...(m.assignment_2_question_ids ?? []),
      ])
    ),
  ];
  const codeById = new Map<string, string>();
  const nameById = new Map<string, string>();
  if (questionIds.length > 0) {
    const { data: questions, error: questionsError } = await supabase
      .from("questions")
      .select("id, external_question_code, question_text, energy_source, criterion")
      .in("id", questionIds);
    if (questionsError) {
      return NextResponse.json(
        { error: `Could not load questions: ${questionsError.message}` },
        { status: 500 }
      );
    }
    for (const q of questions ?? []) {
      codeById.set(q.id, q.external_question_code);
      nameById.set(
        q.id,
        questionLabel({
          questionText: q.question_text,
          energySource: q.energy_source,
          criterion: q.criterion,
          code: q.external_question_code,
        })
      );
    }
  }

  // Both lists are sorted by CODE so the two columns stay index-aligned —
  // reading the nth wording next to the nth code must always be valid.
  const orderedIds = (ids: string[] | null) =>
    [...(ids ?? [])].sort((a, b) =>
      (codeById.get(a) ?? a).localeCompare(codeById.get(b) ?? b)
    );
  const codesOf = (ids: string[] | null) =>
    orderedIds(ids).map((id) => codeById.get(id) ?? id);
  const namesOf = (ids: string[] | null) =>
    orderedIds(ids).map((id) => nameById.get(id) ?? id);

  const rows: MappingExportRow[] = (mappings ?? []).map((m) => ({
    id: m.id,
    version: m.version,
    mapping_name: m.mapping_name,
    mapping_type: m.mapping_type,
    mapping_status: m.mapping_status,
    professor_approved: m.professor_approved,
    common_concept: m.common_concept,
    energy_source: m.energy_source,
    criterion: m.criterion,
    comparison_method: m.comparison_method,
    professor_notes: m.professor_notes,
    assignment_1_question_codes: codesOf(m.assignment_1_question_ids),
    assignment_2_question_codes: codesOf(m.assignment_2_question_ids),
    assignment_1_questions: namesOf(m.assignment_1_question_ids),
    assignment_2_questions: namesOf(m.assignment_2_question_ids),
    previous_version_id: m.previous_version_id,
    superseded_by_id: m.superseded_by_id,
    created_at: m.created_at,
    updated_at: m.updated_at,
  }));

  const { error: auditError } = await supabase.rpc("log_audit_event", {
    p_action: "MAPPING_EXPORTED",
    p_entity_type: "class",
    p_entity_id: classId,
    p_metadata: { format, mappingCount: rows.length },
  });
  if (auditError) {
    console.error("audit log failed for MAPPING_EXPORTED", auditError);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    return new NextResponse(JSON.stringify({ class: classRow.name, exported_at: new Date().toISOString(), mappings: rows }, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="question-mappings-${stamp}.json"`,
      },
    });
  }
  return new NextResponse(mappingsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="question-mappings-${stamp}.csv"`,
    },
  });
}
