import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { Button } from "@/components/ui/button";
import { AssignmentAnalytics } from "@/components/analytics/assignment-analytics";
import {
  getQuestionResponseSummaries,
  getSubmissionProgress,
  getSubmissionTimeline,
} from "@/lib/analytics/queries";
import {
  getClassAssignments,
  requireClassStaffPage,
} from "@/lib/analytics/page-data";

export default async function AssignmentAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireClassStaffPage(classId);
  if (!classRow) notFound();

  // Only the per-question summaries need the assignment list; progress
  // and timeline are class-scoped and were waiting behind it for nothing.
  const [assignments, progress, timeline] = await Promise.all([
    getClassAssignments(supabase, classId),
    getSubmissionProgress(supabase, classId),
    getSubmissionTimeline(supabase, classId),
  ]);
  const questionSummaryLists = await Promise.all(
    assignments.map((a) => getQuestionResponseSummaries(supabase, a.id))
  );

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Assignment analytics</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Response distributions, agreement, and submission progress per
            assignment. Descriptive statistics about opinions — never grades.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}`}>Back to class</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="assignments" />

      {assignments.length === 0 ? (
        <p className="mt-6 text-sm text-ink-secondary">No assignments in this class yet.</p>
      ) : (
        <AssignmentAnalytics
          assignments={assignments.map((a) => ({
            id: a.id,
            title: a.title,
            sequenceNumber: a.sequence_number,
          }))}
          questionSummaries={questionSummaryLists.flat()}
          progress={progress}
          timeline={timeline}
        />
      )}
    </main>
  );
}
