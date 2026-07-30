import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { StudentAnalytics } from "@/components/analytics/student-analytics";
import {
  getResponseTransitionsLive,
  getStudentTransitionSummaries,
} from "@/lib/analytics/queries";
import {
  getStudentNameMap,
  requireProfessorClassPage,
} from "@/lib/analytics/page-data";

export default async function StudentAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const [studentSummaries, liveRows, studentNames] = await Promise.all([
    getStudentTransitionSummaries(supabase, classId),
    getResponseTransitionsLive(supabase, classId),
    getStudentNameMap(supabase, classId),
  ]);

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Student analytics</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Per-student opinion movement across all approved mappings. Change
            rates describe movement, not performance — there are no scores
            here.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}`}>Back to class</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="students" />

      {studentSummaries.length === 0 ? (
        <Alert className="mt-6"><AlertDescription>No per-student data yet — it appears once mappings are approved in the{" "}
          <Link href={`/classes/${classId}/mappings`} className="link">
            mapping studio
          </Link>
          .</AlertDescription></Alert>
      ) : (
        <StudentAnalytics
          studentSummaries={studentSummaries}
          liveRows={liveRows}
          studentNames={studentNames}
        />
      )}
    </main>
  );
}
