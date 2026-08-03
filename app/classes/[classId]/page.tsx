import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart3, ClipboardList } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { EditClassForm } from "@/components/classes/edit-class-form";
import { ArchiveButton } from "@/components/classes/archive-button";
import { StudentActiveToggle } from "@/components/classes/student-active-toggle";
import { Badge } from "@/components/ui/badge";
import { PILL } from "@/lib/ui/tone";
import { PersonChip, PeopleStack } from "@/components/ui/person-avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface ClassMemberRow {
  id: string;
  status: string;
  profiles: {
    id: string;
    full_name: string | null;
    email: string;
    roll_number: string | null;
    is_active: boolean;
  } | null;
}

export default async function ClassDetailPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();

  // All four reads depend only on classId — one parallel batch, not four
  // sequential round-trips.
  const [{ data: classRow }, { count: memberCount }, { count: pendingCount }, { data: members }] =
    await Promise.all([
      supabase
        .from("classes")
        .select(
          "id, name, course_name, academic_year, semester, section, class_code, start_date, end_date, status"
        )
        .eq("id", classId)
        .maybeSingle(),
      supabase
        .from("class_members")
        .select("id", { count: "exact", head: true })
        .eq("class_id", classId),
      supabase
        .from("roster_entries")
        .select("id", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("provisioned", false),
      supabase
        .from("class_members")
        .select("id, status, profiles(id, full_name, email, roll_number, is_active)")
        .eq("class_id", classId)
        .order("joined_at", { ascending: true })
        .returns<ClassMemberRow[]>(),
    ]);

  if (!classRow) notFound();

  const context = [
    classRow.course_name,
    classRow.academic_year,
    classRow.semester,
    classRow.section,
  ].filter(Boolean);

  return (
    <main className="page-standard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {context.length > 0 && <p className="eyebrow">{context.join(" · ")}</p>}
          <h1 className="title-md mt-0.5">{classRow.name}</h1>
        </div>
        <ArchiveButton classId={classRow.id} status={classRow.status} />
      </div>

      <div className="card-standard mt-5 flex flex-wrap items-center gap-8">
        <div>
          <p className="note-muted">Enrolled students</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{memberCount ?? 0}</p>
        </div>
        <div>
          <p className="note-muted">Awaiting first sign-in</p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums">{pendingCount ?? 0}</p>
        </div>
        <div className="ml-auto">
          <Button asChild>
            <Link href={`/classes/${classId}/roster/import`}>Import a roster</Link>
          </Button>
        </div>
      </div>

      {/* One hue per destination, as the direction's category marker. The
          tile is chrome: it distinguishes two areas of the app from each
          other and encodes nothing about anyone's responses. `Icon` is a
          component reference held in a local array, not a function passed
          across a props boundary, so this stays a server component. */}
      {[
        {
          title: "Assignments",
          description: "Create, import questions, and publish this class's assignments.",
          href: `/classes/${classId}/assignments`,
          cta: "Manage assignments",
          tone: "tile-blue",
          Icon: ClipboardList,
        },
        {
          title: "Analytics",
          description:
            "Response distributions, consensus and entropy for each assignment. Always current — nothing to refresh.",
          href: `/classes/${classId}/analytics`,
          cta: "View analytics",
          tone: "tile-purple",
          Icon: BarChart3,
        },
      ].map((section) => (
        <div
          key={section.title}
          className="card-standard mt-4 flex flex-wrap items-center justify-between gap-4"
        >
          <div className="flex min-w-0 items-start gap-4">
            <span className={`icon-tile ${section.tone}`} aria-hidden="true">
              <section.Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <p className="font-medium">{section.title}</p>
              <p className="note mt-0.5">{section.description}</p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href={section.href}>{section.cta}</Link>
          </Button>
        </div>
      ))}

      {/* The stack is a summary of the table directly beneath it — it adds
          no information the roster does not already list, and carries one
          accessible label with the real count so a screen reader is not
          read a run of initials. */}
      <div className="mt-10 flex flex-wrap items-center gap-3">
        <h2 className="title-sm">Roster</h2>
        {members && members.length > 0 && (
          <PeopleStack
            label={`${members.length} enrolled ${members.length === 1 ? "student" : "students"}`}
            people={members
              .filter((m) => !!m.profiles)
              .map((m) => ({
                fullName: m.profiles!.full_name,
                email: m.profiles!.email,
              }))}
          />
        )}
      </div>
      {!members || members.length === 0 ? (
        <Alert className="mt-3">
          <AlertDescription>
            No students yet. Import a roster to add them — they&rsquo;ll appear
            here once you do.
          </AlertDescription>
        </Alert>
      ) : (
        <Card className="mt-4 p-0">
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roll number</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
              {members
                .filter((m): m is ClassMemberRow & { profiles: NonNullable<ClassMemberRow["profiles"]> } =>
                  !!m.profiles
                )
                .map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <PersonChip
                        fullName={m.profiles.full_name}
                        email={m.profiles.email}
                      />
                    </TableCell>
                    <TableCell className="text-ink-secondary">{m.profiles.email}</TableCell>
                    <TableCell className="tabular-nums">{m.profiles.roll_number ?? "—"}</TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          m.profiles.is_active ? PILL.green : PILL.slate
                        }
                      >
                        {m.profiles.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <StudentActiveToggle
                        classId={classId}
                        profileId={m.profiles.id}
                        isActive={m.profiles.is_active}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <h2 className="title-sm mt-10">Class details</h2>
      <div className="mt-4">
        <EditClassForm
          classId={classRow.id}
          defaultValues={{
            name: classRow.name,
            courseName: classRow.course_name ?? "",
            academicYear: classRow.academic_year ?? "",
            semester: classRow.semester ?? "",
            section: classRow.section ?? "",
            classCode: classRow.class_code ?? "",
            startDate: classRow.start_date ?? "",
            endDate: classRow.end_date ?? "",
          }}
        />
      </div>
    </main>
  );
}
