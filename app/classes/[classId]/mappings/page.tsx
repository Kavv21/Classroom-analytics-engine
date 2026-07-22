import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MappingStudio } from "@/components/mappings/mapping-studio";
import type { MappingRowLite, QuestionLite } from "@/components/mappings/types";
import type { MappingStatus, MappingType } from "@/lib/types/domain";

interface MappingDbRow {
  id: string;
  mapping_name: string;
  common_concept: string | null;
  energy_source: string | null;
  criterion: string | null;
  mapping_type: MappingType;
  comparison_method: string | null;
  professor_notes: string | null;
  mapping_status: MappingStatus;
  professor_approved: boolean;
  version: number;
  previous_version_id: string | null;
  superseded_by_id: string | null;
  assignment_1_question_ids: string[] | null;
  assignment_2_question_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export default async function MappingStudioPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: classRow } = await supabase
    .from("classes")
    .select("id, name, professor_id")
    .eq("id", classId)
    .maybeSingle();

  // Professor-only surface (students never see mappings; RLS blanks the
  // data anyway — this gives them a 404 instead of an empty shell).
  if (!classRow || !user || classRow.professor_id !== user.id) notFound();

  const { data: assignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("id, title, sequence_number, status")
    .eq("class_id", classId)
    .in("sequence_number", [1, 2])
    .order("sequence_number");
  if (assignmentsError) {
    throw new Error(`Could not load assignments: ${assignmentsError.message}`);
  }

  const a1 = assignments?.find((a) => a.sequence_number === 1);
  const a2 = assignments?.find((a) => a.sequence_number === 2);

  if (!a1 || !a2) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold">Question mapping</h1>
        <p className="mt-4 text-sm text-gray-600">
          The mapping studio needs both sequential assignments to exist first
          (sequence numbers 1 and 2).{" "}
          <Link href={`/classes/${classId}/assignments`} className="text-blue-600 underline">
            Manage assignments
          </Link>
        </p>
      </main>
    );
  }

  async function loadQuestions(assignmentId: string): Promise<QuestionLite[]> {
    const { data, error } = await supabase
      .from("questions")
      .select(
        "id, external_question_code, question_text, energy_source, criterion, concept, display_order"
      )
      .eq("assignment_id", assignmentId)
      .eq("is_active", true)
      .order("display_order");
    if (error) throw new Error(`Could not load questions: ${error.message}`);
    return (data ?? []).map((q) => ({
      id: q.id,
      code: q.external_question_code,
      text: q.question_text,
      energySource: q.energy_source,
      criterion: q.criterion,
      concept: q.concept,
    }));
  }

  const [a1Questions, a2Questions] = await Promise.all([
    loadQuestions(a1.id),
    loadQuestions(a2.id),
  ]);

  const { data: mappingRows, error: mappingsError } = await supabase
    .from("question_mappings")
    .select(
      "id, mapping_name, common_concept, energy_source, criterion, mapping_type, " +
        "comparison_method, professor_notes, mapping_status, professor_approved, " +
        "version, previous_version_id, superseded_by_id, " +
        "assignment_1_question_ids, assignment_2_question_ids, created_at, updated_at"
    )
    .eq("class_id", classId)
    .order("mapping_name")
    .order("version")
    .returns<MappingDbRow[]>();
  if (mappingsError) {
    throw new Error(`Could not load mappings: ${mappingsError.message}`);
  }

  const mappings: MappingRowLite[] = (mappingRows ?? []).map((m) => ({
    id: m.id,
    mappingName: m.mapping_name,
    commonConcept: m.common_concept,
    energySource: m.energy_source,
    criterion: m.criterion,
    mappingType: m.mapping_type,
    comparisonMethod: m.comparison_method,
    professorNotes: m.professor_notes,
    mappingStatus: m.mapping_status,
    professorApproved: m.professor_approved,
    version: m.version,
    previousVersionId: m.previous_version_id,
    supersededById: m.superseded_by_id,
    a1QuestionIds: m.assignment_1_question_ids ?? [],
    a2QuestionIds: m.assignment_2_question_ids ?? [],
    updatedAt: m.updated_at,
  }));

  return (
    <main className="mx-auto max-w-7xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Question mapping — {classRow.name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            Declare which Assignment 1 and Assignment 2 questions are
            comparable. Nothing appears in analytics until you approve a
            mapping.
          </p>
        </div>
        <Link
          href={`/classes/${classId}`}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Back to class
        </Link>
      </div>

      <MappingStudio
        classId={classId}
        a1Title={a1.title}
        a2Title={a2.title}
        a1Questions={a1Questions}
        a2Questions={a2Questions}
        mappings={mappings}
      />
    </main>
  );
}
