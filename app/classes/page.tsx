import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { assignmentStatusLabel, assignmentStatusTone } from "@/lib/ui/labels";

interface ClassAssignmentStatusRow {
  class_id: string;
  sequence_number: number;
  status: string;
}

export default async function ClassesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: classes } = user
    ? await supabase
        .from("classes")
        .select("id, name, course_name, academic_year, semester, section, status")
        .eq("professor_id", user.id)
        .order("created_at", { ascending: false })
    : { data: null };

  // Second, cheap read (indexed on class_id, at most two rows per class) so
  // each row can show where its assignments stand without opening the class.
  const classIds = (classes ?? []).map((c) => c.id);
  const { data: assignmentStatuses } =
    classIds.length > 0
      ? await supabase
          .from("assignments")
          .select("class_id, sequence_number, status")
          .in("class_id", classIds)
          .in("sequence_number", [1, 2])
          .order("sequence_number")
          .returns<ClassAssignmentStatusRow[]>()
      : { data: [] as ClassAssignmentStatusRow[] };

  const assignmentsByClass = new Map<string, ClassAssignmentStatusRow[]>();
  for (const row of assignmentStatuses ?? []) {
    assignmentsByClass.set(row.class_id, [...(assignmentsByClass.get(row.class_id) ?? []), row]);
  }

  return (
    <main className="page-standard">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="title-md">Your classes</h1>
        <Button asChild>
          <Link href="/classes/new">Create a class</Link>
        </Button>
      </div>

      {!classes || classes.length === 0 ? (
        <Alert className="mt-6">
          <AlertDescription>
            You haven&rsquo;t created a class yet. Create one to import a roster
            and set up assignments.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="mt-6 overflow-hidden p-0">
          <CardContent className="p-0">
            <ul className="divide-y">
          {classes.map((c) => {
            const classAssignments = assignmentsByClass.get(c.id) ?? [];
            const context = [c.course_name, c.academic_year, c.semester, c.section].filter(Boolean);
            return (
            <li key={c.id}>
              <Link
                href={`/classes/${c.id}`}
                className="flex items-center justify-between gap-4 bg-surface-raised p-4 hover:bg-surface-sunken"
              >
                <div className="min-w-0">
                  {context.length > 0 && <p className="eyebrow">{context.join(" · ")}</p>}
                  <p className="mt-0.5 font-medium">{c.name}</p>
                  {classAssignments.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {classAssignments.map((a) => (
                        <span key={a.sequence_number} className={assignmentStatusTone(a.status)}>
                          A{a.sequence_number}: {assignmentStatusLabel(a.status)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={
                    c.status === "ARCHIVED"
                      ? "shrink-0 border-transparent bg-surface-sunken text-ink-secondary"
                      : "shrink-0 border-transparent bg-surface-good text-[color:var(--status-good-text)]"
                  }
                >
                  {c.status === "ARCHIVED" ? "Archived" : "Active"}
                </Badge>
              </Link>
            </li>
            );
          })}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
