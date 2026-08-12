import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignmentForm } from "@/components/assignments/assignment-form";
import { updateAssignment } from "@/lib/assignments/actions";
import { positionForSequenceNumber } from "@/lib/assignments/sequence";

export default async function EditAssignmentPage({
  params,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
}) {
  const { classId, assignmentId } = await params;
  const supabase = await createClient();

  const { data: assignment, error } = await supabase
    .from("assignments")
    .select(
      "id, title, description, instructions, assignment_stage, sequence_number, open_at, close_at, status, allow_draft_editing, allow_resubmission, response_zero_label, response_one_label"
    )
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load assignment: ${error.message}`);
  if (!assignment) notFound();

  return (
    <main className="page-standard max-w-xl">
      <p className="text-sm text-ink-muted">
        <Link href={`/classes/${classId}/assignments/${assignmentId}`} className="hover:underline">
          {assignment.title}
        </Link>{" "}
        / Edit
      </p>
      <h1 className="title-md mt-2">Edit assignment</h1>
      <div className="mt-6">
        <AssignmentForm
          onSubmitAction={updateAssignment.bind(null, assignmentId)}
          submitLabel="Save changes"
          // updateAssignment returns the assignment's own id, so this lands
          // back on the detail page.
          redirectBasePath={`/classes/${classId}/assignments`}
          defaultValues={{
            title: assignment.title,
            description: assignment.description ?? "",
            instructions: assignment.instructions ?? "",
            assignmentStage: assignment.assignment_stage,
            sequencePosition: positionForSequenceNumber(assignment.sequence_number),
            // Handed over as the raw stored instants. The form converts
            // them to the professor's wall clock in the browser — doing it
            // here would read Vercel's timezone instead of theirs, which is
            // the bug that made every schedule silently UTC.
            openAt: assignment.open_at ?? "",
            closeAt: assignment.close_at ?? "",
            allowDraftEditing: assignment.allow_draft_editing,
            allowResubmission: assignment.allow_resubmission,
            responseZeroLabel: assignment.response_zero_label,
            responseOneLabel: assignment.response_one_label,
          }}
        />
      </div>
    </main>
  );
}
