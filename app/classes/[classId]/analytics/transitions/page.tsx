import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Transition analytics</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            How opinions moved between the two assignments, per approved
            mapping. A change is a change — neither direction is better.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}`}>Back to class</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="transitions" />

      {mappingSummaries.length === 0 ? (
        <Alert className="mt-6"><AlertDescription>No approved mappings yet — approve mappings in the{" "}
          <Link href={`/classes/${classId}/mappings`} className="link">
            mapping studio
          </Link>{" "}
          to see transitions.</AlertDescription></Alert>
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
