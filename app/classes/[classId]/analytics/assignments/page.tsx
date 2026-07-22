import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { AssignmentAnalytics } from "@/components/analytics/assignment-analytics";
import {
  getQuestionResponseSummaries,
  getSubmissionProgress,
  getSubmissionTimeline,
} from "@/lib/analytics/queries";
import {
  getClassAssignments,
  requireProfessorClassPage,
} from "@/lib/analytics/page-data";

export default async function AssignmentAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const assignments = await getClassAssignments(supabase, classId);
  const [questionSummaryLists, progress, timeline] = await Promise.all([
    Promise.all(assignments.map((a) => getQuestionResponseSummaries(supabase, a.id))),
    getSubmissionProgress(supabase, classId),
    getSubmissionTimeline(supabase, classId),
  ]);

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="title-md">Assignment analytics — {classRow.name}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Response distributions, agreement, and submission progress per
            assignment. Descriptive statistics about opinions — never grades.
          </p>
        </div>
        <Link
          href={`/classes/${classId}`}
          className="btn btn-secondary"
        >
          Back to class
        </Link>
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
