import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
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
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Student analytics — {classRow.name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            Per-student opinion movement across all approved mappings. Change
            rates describe movement, not performance — there are no scores
            here.
          </p>
        </div>
        <Link
          href={`/classes/${classId}`}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Back to class
        </Link>
      </div>

      <AnalyticsNav classId={classId} active="students" />

      {studentSummaries.length === 0 ? (
        <p className="mt-6 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          No per-student data yet — it appears once mappings are approved in the{" "}
          <Link href={`/classes/${classId}/mappings`} className="text-blue-600 underline">
            mapping studio
          </Link>
          .
        </p>
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
