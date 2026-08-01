import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { Button } from "@/components/ui/button";
import {
  getAssignmentResponseSummaries,
  getSubmissionProgress,
} from "@/lib/analytics/queries";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getClassAssignments,
  requireProfessorClassPage,
} from "@/lib/analytics/page-data";

/**
 * Professor dashboard — Overview (Section 19). Headline numbers plus
 * pointers into the deeper sections. All figures are descriptive
 * statistics about opinions, never grades; data is computed on read from
 * the Phase 7 views, so it is always current.
 *
 * Every figure here describes ONE assignment on its own. The cross-
 * assignment transition tiles that used to head this page were removed
 * with the question-mapping feature — a per-student comparison between the
 * two assignments required an approved mapping to say which question
 * corresponded to which, and no such record exists any more.
 */

function pct(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

export default async function AnalyticsOverviewPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const [summaries, progress, assignments] = await Promise.all([
    getAssignmentResponseSummaries(supabase, classId),
    getSubmissionProgress(supabase, classId),
    getClassAssignments(supabase, classId),
  ]);

  const assignmentTitle = (id: string) =>
    assignments.find((a) => a.id === id)?.title ?? "Untitled assignment";

  const bySequence = [...summaries].sort((a, b) => {
    const seqOf = (id: string) =>
      assignments.find((x) => x.id === id)?.sequence_number ?? Number.MAX_SAFE_INTEGER;
    return seqOf(a.assignment_id) - seqOf(b.assignment_id);
  });

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Analytics overview</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Descriptive statistics about the opinions recorded on each
            assignment. Nothing here is a grade or a correctness judgement.
            Figures update live as responses arrive.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}`}>Back to class</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="overview" />

      {bySequence.length === 0 ? (
        <p className="mt-6 rounded border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          No response data yet — figures appear once students submit answers to
          an assignment.
        </p>
      ) : (
        <div className="mt-6 space-y-4">
          {bySequence.map((s) => (
            <section key={s.assignment_id} aria-label={assignmentTitle(s.assignment_id)}>
              <h2 className="title-sm">{assignmentTitle(s.assignment_id)}</h2>
              <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
                {[
                  { label: "Questions", value: s.question_count },
                  { label: "Answered responses", value: s.answered_responses },
                  { label: "Respondents", value: s.respondents },
                  { label: "Average consensus", value: pct(s.avg_consensus) },
                  {
                    label: "Average entropy",
                    value:
                      s.avg_entropy === null ? "—" : `${s.avg_entropy.toFixed(2)} bits`,
                  },
                ].map((tile) => (
                  <Card key={tile.label} className="p-0">
                    <CardContent className="p-3">
                      <p className="text-xs text-muted-foreground">{tile.label}</p>
                      <p className="mt-1 text-xl font-semibold tabular-nums">{tile.value}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          ))}
          <p className="text-xs text-ink-muted">
            Consensus is max(% choosing 0, % choosing 1) and entropy is the
            binary entropy of the same split, both averaged over the
            assignment&apos;s questions. They describe how spread the answers
            were — high consensus is not &ldquo;better&rdquo; than low.
          </p>
        </div>
      )}

      <h2 className="title-sm mt-10">Submission snapshot</h2>
      {progress.length === 0 ? (
        <p className="mt-2 text-sm text-ink-secondary">No assignments yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Assignment</TableHead>
                <TableHead className="text-right">Enrolled</TableHead>
                <TableHead className="text-right">Not started</TableHead>
                <TableHead className="text-right">Draft</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Reopened</TableHead>
                <TableHead className="text-right">Resubmitted</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="tabular-nums">
              {progress.map((p) => (
                <TableRow key={p.assignment_id}>
                  <TableCell>{assignmentTitle(p.assignment_id)}</TableCell>
                  <TableCell className="text-right">{p.enrolled_students}</TableCell>
                  <TableCell className="text-right">{p.not_started_count}</TableCell>
                  <TableCell className="text-right">{p.draft_count}</TableCell>
                  <TableCell className="text-right">{p.submitted_count}</TableCell>
                  <TableCell className="text-right">{p.reopened_count}</TableCell>
                  <TableCell className="text-right">{p.resubmitted_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="mt-6 text-sm text-ink-secondary">
        Full charts live in{" "}
        <Link href={`/classes/${classId}/analytics/assignments`} className="link">
          assignment analytics
        </Link>
        , and every student&apos;s own answers are under{" "}
        <Link href={`/classes/${classId}/analytics/students`} className="link">
          students
        </Link>
        .
      </p>
    </main>
  );
}
