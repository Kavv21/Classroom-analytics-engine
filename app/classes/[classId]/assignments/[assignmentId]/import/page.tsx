import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AssignmentImportWizard } from "@/components/assignments/import-wizard";

export default async function AssignmentImportPage({
  params,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
}) {
  const { classId, assignmentId } = await params;
  const supabase = await createClient();

  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("id, title, status, sequence_number")
    .eq("id", assignmentId)
    .eq("class_id", classId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load assignment: ${error.message}`);
  if (!assignment) notFound();

  return (
    <main className="page-standard">
      <p className="text-sm text-ink-muted">
        <Link href={`/classes/${classId}/assignments/${assignmentId}`} className="hover:underline">
          {assignment.title}
        </Link>{" "}
        / Import questions
      </p>
      <h1 className="title-md mt-2">Import questions</h1>

      {assignment.status !== "DRAFT" ? (
        <p className="mt-6 banner banner-warning">
          Questions can only be imported while the assignment is in DRAFT (current status:{" "}
          {assignment.status}). Move it back to draft first, or duplicate it as a new version.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-secondary">
            Upload the assignment spreadsheet. You&rsquo;ll see every parsed question — and every
            problem — before anything is imported. Question codes will use the prefix{" "}
            <span className="font-mono">A{assignment.sequence_number}</span>. Re-importing
            replaces this assignment&rsquo;s current question list.
          </p>
          <div className="mt-6">
            <AssignmentImportWizard classId={classId} assignmentId={assignmentId} />
          </div>
        </>
      )}
    </main>
  );
}
