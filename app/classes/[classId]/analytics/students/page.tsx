import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StudentAnalytics } from "@/components/analytics/student-analytics";
import {
  getClassAssignments,
  getClassStudentRoster,
  requireClassStaffPage,
} from "@/lib/analytics/page-data";

export default async function StudentAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireClassStaffPage(classId);
  if (!classRow) notFound();

  const [students, assignments] = await Promise.all([
    getClassStudentRoster(supabase, classId),
    getClassAssignments(supabase, classId),
  ]);

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Students</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Everyone enrolled in this class, and where they are in each
            assignment. Open a student for every answer they recorded. There
            are no scores here.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}`}>Back to class</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="students" />

      {students.length === 0 ? (
        <Alert className="mt-6">
          <AlertDescription>
            No students enrolled yet — import a roster from the class page.
          </AlertDescription>
        </Alert>
      ) : (
        <StudentAnalytics
          classId={classId}
          students={students}
          assignments={assignments}
        />
      )}
    </main>
  );
}
