import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  READY: "bg-blue-100 text-blue-700",
  OPEN: "bg-green-100 text-green-700",
  CLOSED: "bg-amber-100 text-amber-800",
  ARCHIVED: "bg-gray-100 text-gray-500",
};

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
    <main className="mx-auto max-w-3xl p-8">
      <p className="text-sm text-gray-500">
        <Link href={`/classes/${classId}`} className="hover:underline">
          {classRow.name}
        </Link>{" "}
        / Assignments
      </p>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Assignments</h1>
        <Link
          href={`/classes/${classId}/assignments/new`}
          className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
        >
          New assignment
        </Link>
      </div>

      {!assignments || assignments.length === 0 ? (
        <p className="mt-6 text-gray-600">
          No assignments yet. Create one, then import its questions from a spreadsheet.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded border border-gray-200">
          {assignments.map((a) => (
            <li key={a.id}>
              <Link
                href={`/classes/${classId}/assignments/${a.id}`}
                className="flex items-center justify-between p-4 hover:bg-gray-50"
              >
                <div>
                  <p className="font-medium">
                    <span className="mr-2 font-mono text-xs text-gray-500">
                      #{a.sequence_number}
                    </span>
                    {a.title}
                  </p>
                  <p className="text-sm text-gray-600">
                    {a.assignment_stage.replaceAll("_", " ").toLowerCase()}
                  </p>
                </div>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[a.status] ?? ""}`}
                >
                  {a.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
