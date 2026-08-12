import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

import { effectiveAssignmentStatus } from "@/lib/assignments/schedule";
import { PILL } from "@/lib/ui/tone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LocalDateTime } from "@/components/ui/local-date-time";

/* Keyed by EFFECTIVE status, not by the status column: a scheduled
   assignment sits at READY through its whole window, so colouring by the
   raw column would paint an assignment the class is answering right now the
   same as one nobody can reach. Lifecycle order, not merit order: no state
   here is better than another. */
const KIND_TONE: Record<string, string> = {
  DRAFT: PILL.amber,
  NOT_SCHEDULED: PILL.amber,
  SCHEDULED: PILL.blue,
  OPEN: PILL.green,
  WINDOW_PASSED: PILL.purple,
  CLOSED: PILL.purple,
  ARCHIVED: PILL.slate,
};

export default async function AssignmentsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();

  // Both keyed on classId only. The assignments read is not gated on the
  // class read — RLS already hides another professor's assignments, so
  // issuing it early cannot leak anything the notFound() below was
  // protecting.
  const [{ data: classRow, error: classError }, { data: assignments, error }] =
    await Promise.all([
      supabase.from("classes").select("id, name").eq("id", classId).maybeSingle(),
      supabase
        .from("assignments")
        .select("id, title, assignment_stage, sequence_number, status, open_at, close_at")
        .eq("class_id", classId)
        .order("sequence_number", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

  if (classError) throw new Error(`Failed to load class: ${classError.message}`);
  if (!classRow) notFound();
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
        <Button asChild>
          <Link href={`/classes/${classId}/assignments/new`}>Create an assignment</Link>
        </Button>
      </div>

      {!assignments || assignments.length === 0 ? (
        <Alert className="mt-6">
          <AlertDescription>
            No assignments yet. Create one, then import its questions from your
            spreadsheet.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="mt-6 p-0"><CardContent className="p-0"><ul className="divide-y">
          {assignments.map((a) => {
            const effective = effectiveAssignmentStatus(a.status, {
              openAt: a.open_at,
              closeAt: a.close_at,
            });
            return (
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
                <Badge
                  variant="outline"
                  className={`shrink-0 ${KIND_TONE[effective.kind] ?? ""}`}
                >
                  {effective.label}
                  {effective.detail && effective.at && (
                    <>
                      {` ${effective.detail} `}
                      <LocalDateTime value={effective.at} />
                    </>
                  )}
                </Badge>
              </Link>
            </li>
            );
          })}
        </ul></CardContent></Card>
      )}
    </main>
  );
}
