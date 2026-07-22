import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { assignmentStatusLabel, assignmentStatusTone } from "@/lib/ui/labels";

export default async function AssignmentsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .maybeSingle();

  if (classError) throw new Error(`Failed to load class: ${classError.message}`);
  if (!classRow) notFound();

  const { data: assignments, error } = await supabase
    .from("assignments")
    .select("id, title, assignment_stage, sequence_number, status, open_at, close_at")
    .eq("class_id", classId)
    .order("sequence_number", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw new Error(`Failed to load assignments: ${error.message}`);

  return (
    <main className="page-standard">
      <nav aria-label="Breadcrumb" className="note-muted">
        <Link href={`/classes/${classId}`} className="link-quiet">
          {classRow.name}
        </Link>{" "}
        / Assignments
      </nav>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="title-md">Assignments</h1>
        <Link href={`/classes/${classId}/assignments/new`} className="btn btn-primary">
          Create an assignment
        </Link>
      </div>

      {!assignments || assignments.length === 0 ? (
        <p className="banner mt-6">
          No assignments yet. Create one, then import its questions from your
          spreadsheet.
        </p>
      ) : (
        <ul className="table-frame mt-6 divide-y divide-hairline">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link
                href={`/classes/${classId}/assignments/${a.id}`}
                className="flex items-center justify-between gap-4 bg-surface-raised p-4 hover:bg-surface-sunken"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    <span className="mono mr-2 text-ink-muted">#{a.sequence_number}</span>
                    {a.title}
                  </p>
                  <p className="note mt-0.5 capitalize">
                    {a.assignment_stage.replaceAll("_", " ").toLowerCase()}
                  </p>
                </div>
                <span className={assignmentStatusTone(a.status)}>
                  {assignmentStatusLabel(a.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
