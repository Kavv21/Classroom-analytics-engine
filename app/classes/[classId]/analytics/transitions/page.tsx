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
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="title-md">Transition analytics — {classRow.name}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            How opinions moved between the two assignments, per approved
            mapping. A change is a change — neither direction is better.
          </p>
        </div>
        <Link
          href={`/classes/${classId}`}
          className="btn btn-secondary"
        >
          Back to class
        </Link>
      </div>

      <AnalyticsNav classId={classId} active="transitions" />

      {mappingSummaries.length === 0 ? (
        <p className="mt-6 rounded border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          No approved mappings yet — approve mappings in the{" "}
          <Link href={`/classes/${classId}/mappings`} className="link">
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
