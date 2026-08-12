import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { effectiveAssignmentStatus } from "@/lib/assignments/schedule";
import { PILL } from "@/lib/ui/tone";

interface ClassAssignmentStatusRow {
  class_id: string;
  sequence_number: number;
  status: string;
  open_at: string | null;
  close_at: string | null;
}

interface ClassRow {
  id: string;
  name: string;
  course_name: string | null;
  academic_year: string | null;
  semester: string | null;
  section: string | null;
  status: string;
}

const CLASS_COLUMNS = "id, name, course_name, academic_year, semester, section, status";

export default async function ClassesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Two relationships lead here and they are not the same relationship:
  // classes this person owns, and classes they assist as a TA. Both are
  // listed, and the ones they assist say so — a TA should never have to
  // guess which of these they can archive.
  const [{ data: owned }, { data: assisting }, { data: profile }] = user
    ? await Promise.all([
        supabase
          .from("classes")
          .select(CLASS_COLUMNS)
          .eq("professor_id", user.id)
          .order("created_at", { ascending: false })
          .returns<ClassRow[]>(),
        supabase
          .from("class_members")
          .select(`classes(${CLASS_COLUMNS})`)
          .eq("user_id", user.id)
          .eq("member_role", "TA")
          .eq("status", "ACTIVE")
          .returns<{ classes: ClassRow | null }[]>(),
        supabase.from("profiles").select("role").eq("id", user.id).maybeSingle(),
      ])
    : [{ data: null }, { data: null }, { data: null }];

  const ownedIds = new Set((owned ?? []).map((c) => c.id));
  const assistedClasses = (assisting ?? [])
    .map((m) => m.classes)
    .filter((c): c is ClassRow => !!c && !ownedIds.has(c.id));
  const assistedIds = new Set(assistedClasses.map((c) => c.id));

  // Creating a class is a global capability (lib/classes/actions.ts refuses
  // anyone else), not a per-class one — assisting five classes does not
  // make someone able to start a sixth.
  const canCreateClasses = profile?.role === "PROFESSOR" || profile?.role === "ADMIN";
  const classes: ClassRow[] = [...(owned ?? []), ...assistedClasses];

  // Second, cheap read (indexed on class_id, at most two rows per class) so
  // each row can show where its assignments stand without opening the class.
  const classIds = classes.map((c) => c.id);
  const { data: assignmentStatuses } =
    classIds.length > 0
      ? await supabase
          .from("assignments")
          .select("class_id, sequence_number, status, open_at, close_at")
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
        {canCreateClasses && (
          <Button asChild>
            <Link href="/classes/new">Create a class</Link>
          </Button>
        )}
      </div>

      {classes.length === 0 ? (
        <Alert className="mt-6">
          <AlertDescription>
            {canCreateClasses
              ? "You haven’t created a class yet. Create one to import a roster and set up assignments."
              : "You’re not assisting any classes yet. A professor adds you to one from that class’s page."}
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
                  <p className="mt-0.5 font-medium">
                    {c.name}
                    {assistedIds.has(c.id) && (
                      <span className="badge badge-blue ml-2 align-middle">
                        You assist this class
                      </span>
                    )}
                  </p>
                  {classAssignments.length > 0 && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {/* Effective status, not the raw column: a scheduled
                          assignment stays at READY the whole time it is
                          being answered. No timestamp here — this is a
                          glance, and the detail page carries the dates. */}
                      {classAssignments.map((a) => {
                        const effective = effectiveAssignmentStatus(a.status, {
                          openAt: a.open_at,
                          closeAt: a.close_at,
                        });
                        return (
                          <span key={a.sequence_number} className={effective.tone}>
                            A{a.sequence_number}: {effective.label}
                          </span>
                        );
                      })}
                    </p>
                  )}
                </div>
                <Badge
                  variant="outline"
                  className={
                    c.status === "ARCHIVED"
                      ? `shrink-0 ${PILL.slate}`
                      : `shrink-0 ${PILL.green}`
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
