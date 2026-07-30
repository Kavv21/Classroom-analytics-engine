import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { Button } from "@/components/ui/button";
import {
  getClassTransitionSummary,
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

  const [summary, progress, assignments] = await Promise.all([
    getClassTransitionSummary(supabase, classId),
    getSubmissionProgress(supabase, classId),
    getClassAssignments(supabase, classId),
  ]);

  const assignmentTitle = (id: string) =>
    assignments.find((a) => a.id === id)?.title ?? "Untitled assignment";

  const tiles = [
    { label: "Students with transition data", value: summary?.students_considered ?? 0 },
    { label: "Approved mappings", value: summary?.mappings_considered ?? 0 },
    { label: "Valid response pairs", value: summary?.valid_paired ?? 0 },
    { label: "Change rate", value: pct(summary?.change_rate) },
    {
      label: "Net movement toward 1 — Yes",
      value:
        summary === null
          ? "—"
          : `${summary.net_movement_toward_1 > 0 ? "+" : ""}${summary.net_movement_toward_1}`,
    },
    {
      label: "Shift (percentage points)",
      value:
        summary?.pct_point_shift === null || summary === null
          ? "—"
          : `${summary.pct_point_shift > 0 ? "+" : ""}${(summary.pct_point_shift * 100).toFixed(1)}pp`,
    },
  ];

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Analytics overview</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Descriptive statistics about opinion responses and how they moved
            between the two assignments. Nothing here is a grade or a
            correctness judgement. Figures update live as responses arrive and
            mappings are approved.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href={`/classes/${classId}`}>Back to class</Link>
        </Button>
      </div>

      <AnalyticsNav classId={classId} active="overview" />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {tiles.map((tile) => (
          <Card key={tile.label} className="p-0">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{tile.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{tile.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {!summary && (
        <p className="mt-4 rounded border border-hairline bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          No transition data yet — it appears once at least one mapping is{" "}
          <Link href={`/classes/${classId}/mappings`} className="link">
            approved in the mapping studio
          </Link>{" "}
          and students have submitted responses to both assignments.
        </p>
      )}

      {summary && (summary.missing_a1 + summary.missing_a2 + summary.missing_both > 0 || summary.not_comparable > 0) && (
        <p className="mt-4 text-xs text-ink-muted">
          Data quality: {summary.missing_a1} pairs missing the Assignment 1 answer,{" "}
          {summary.missing_a2} missing Assignment 2, {summary.missing_both} missing both,{" "}
          {summary.not_comparable} not comparable. These are reported separately and never
          counted as transitions.
        </p>
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
        ,{" "}
        <Link href={`/classes/${classId}/analytics/transitions`} className="link">
          transition analytics
        </Link>{" "}
        and{" "}
        <Link href={`/classes/${classId}/analytics/students`} className="link">
          student analytics
        </Link>
        .
      </p>
    </main>
  );
}
