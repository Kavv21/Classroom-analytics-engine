import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { TransitionAnalytics } from "@/components/analytics/transition-analytics";
import {
  getMappingTransitionSummaries,
  getResponseTransitionsLive,
} from "@/lib/analytics/queries";
import {
  getStudentNameMap,
  requireProfessorClassPage,
} from "@/lib/analytics/page-data";

export default async function TransitionAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const [mappingSummaries, liveRows, studentNames] = await Promise.all([
    getMappingTransitionSummaries(supabase, classId),
    getResponseTransitionsLive(supabase, classId),
    getStudentNameMap(supabase, classId),
  ]);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Transition analytics — {classRow.name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            How opinions moved between the two assignments, per approved
            mapping. A change is a change — neither direction is better.
          </p>
        </div>
        <Link
          href={`/classes/${classId}`}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Back to class
        </Link>
      </div>

      <AnalyticsNav classId={classId} active="transitions" />

      {mappingSummaries.length === 0 ? (
        <p className="mt-6 rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
          No approved mappings yet — approve mappings in the{" "}
          <Link href={`/classes/${classId}/mappings`} className="text-blue-600 underline">
            mapping studio
          </Link>{" "}
          to see transitions.
        </p>
      ) : (
        <TransitionAnalytics
          classId={classId}
          mappingSummaries={mappingSummaries}
          liveRows={liveRows}
          studentNames={studentNames}
        />
      )}
    </main>
  );
}
