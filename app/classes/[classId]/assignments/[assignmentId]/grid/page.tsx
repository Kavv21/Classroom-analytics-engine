import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ResponseGridTable } from "@/components/assignments/response-grid-table";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { gatherResponseGrid, orientationDescription } from "@/lib/exports/response-grid";
import { requireProfessorClassPage } from "@/lib/analytics/page-data";

/**
 * The live response grid — the same layout as the Excel grid sheet, kept in
 * step by both being built from `gatherResponseGrid`.
 *
 * THIS VIEW IS AGGREGATE-ONLY. It reproduces the source spreadsheet's own
 * grid — same rows, same columns, same order — with each answer cell
 * showing one number: how many students answered 1 there. It carries no
 * student rows, no names and no individual answers. One student's full
 * submission is on their profile page under Analytics → Students, which is
 * the single surface for raw per-person data.
 *
 * The honest distinction this page has to make, and states in its own copy:
 * this view re-queries on every load, the .xlsx does not. A downloaded
 * workbook is frozen at its download time and no spreadsheet formula can
 * make it call back here.
 *
 * Every number comes from an analytics view (question_response_summary) —
 * .claude/rules/analytics.md is explicit that aggregates belong in
 * PostgreSQL rather than app memory.
 */

export default async function ResponseGridPage({
  params,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
}) {
  const { classId, assignmentId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const grid = await gatherResponseGrid(supabase, assignmentId);

  // The grid is reached from a class page, so an assignment id belonging to
  // a different class would be a broken link, not a data leak (RLS already
  // scopes both reads) — but say so rather than rendering a confusing page.
  if (grid.classId !== classId) notFound();

  const exportHref = `/classes/${classId}/exports/workbook`;

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow mb-1">{classRow.name}</p>
          <h1 className="title-md">Response totals — {grid.assignmentTitle}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-secondary">
            The source spreadsheet&apos;s own grid — {orientationDescription(grid.orientation)}.
            Each cell holds one number: how many students answered 1 there. The closing TOTAL row
            sums straight down each column.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/classes/${classId}/assignments/${assignmentId}`}>Back to assignment</Link>
          </Button>
          <Button asChild>
            <a href={exportHref}>Download Excel workbook</a>
          </Button>
        </div>
      </div>

      {/* What this page is, and where the per-student answers went. */}
      <div className="mt-4 rounded-md border border-hairline bg-surface-sunken px-4 py-3 text-sm">
        <p>
          <strong>This page is live, and it is aggregate-only.</strong> It re-reads the database
          every time you load it, so new submissions appear on refresh. It shows no individual
          student answers — for one student&apos;s full submission, open their profile from{" "}
          <Link href={`/classes/${classId}/analytics/students`} className="link">
            Analytics → Students
          </Link>
          .
        </p>
        <p className="mt-1 text-ink-secondary">
          The Excel workbook contains this same grid as an added sheet, with a real <code>SUM</code>{" "}
          formula behind every figure in the TOTAL row — but a downloaded file is a{" "}
          <strong>point-in-time snapshot</strong> and cannot refresh itself. Download it
          again after new submissions to bring it up to date. For charts, use the PNG and PDF
          exports on the{" "}
          <Link href={`/classes/${classId}/analytics`} className="link">
            analytics pages
          </Link>
          .
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-secondary md:grid-cols-4 lg:grid-cols-7">
        <div>
          <dt className="text-ink-muted">Grid</dt>
          <dd className="font-medium tabular-nums">
            {grid.matrix.rows.length} × {grid.matrix.columns.length}
          </dd>
        </div>
        <div>
          <dt className="text-ink-muted">Questions</dt>
          <dd className="font-medium tabular-nums">{grid.columns.length}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Energy sources</dt>
          <dd className="font-medium tabular-nums">{grid.energySourceCount}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Criteria</dt>
          <dd className="font-medium tabular-nums">{grid.criterionCount}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Students enrolled</dt>
          <dd className="font-medium tabular-nums">{grid.totalStudentCount}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Of which synthetic</dt>
          <dd className="font-medium tabular-nums">{grid.syntheticStudentCount}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Source worksheet</dt>
          <dd className="font-medium">{grid.worksheet ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Loaded at</dt>
          <dd className="font-medium">
            <LocalDateTime value={grid.generatedAt} />
          </dd>
        </div>
      </dl>

      {grid.syntheticStudentCount > 0 && (
        <p className="mt-3 rounded border border-dashed border-hairline px-3 py-2 text-xs text-ink-secondary">
          {grid.syntheticStudentCount} of these {grid.totalStudentCount} enrolled students are
          synthetic demo records. The totals below count every student, real and synthetic
          together.
        </p>
      )}

      <ResponseGridTable grid={grid} exportHref={exportHref} />
    </main>
  );
}
