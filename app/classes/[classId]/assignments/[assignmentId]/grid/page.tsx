import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ResponseGridTable } from "@/components/assignments/response-grid-table";
import { gatherResponseGrid, orientationDescription } from "@/lib/exports/response-grid";
import { requireProfessorClassPage } from "@/lib/analytics/page-data";

/**
 * The live response grid — the same layout as the Excel grid sheet, kept in
 * step by both being built from `gatherResponseGrid`.
 *
 * The honest distinction this page has to make, and states in its own copy:
 * this view re-queries on every load, the .xlsx does not. A downloaded
 * workbook is frozen at its download time and no spreadsheet formula can
 * make it call back here.
 *
 * Student rows are capped per page. The grid is a per-student pivot, not an
 * aggregate, and .claude/rules/analytics.md is explicit that aggregates
 * belong in PostgreSQL rather than app memory — so the totals row comes
 * from the question_response_summary view (all students, computed in the
 * database) while only the visible page of student rows is materialised.
 */

const STUDENTS_PER_PAGE = 60;

export default async function ResponseGridPage({
  params,
  searchParams,
}: {
  params: Promise<{ classId: string; assignmentId: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { classId, assignmentId } = await params;
  const { page: pageParam } = await searchParams;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const page = Math.max(0, Number.parseInt(pageParam ?? "0", 10) || 0);

  const grid = await gatherResponseGrid(supabase, assignmentId, {
    studentLimit: STUDENTS_PER_PAGE,
    studentOffset: page * STUDENTS_PER_PAGE,
  });

  // The grid is reached from a class page, so an assignment id belonging to
  // a different class would be a broken link, not a data leak (RLS already
  // scopes both reads) — but say so rather than rendering a confusing page.
  if (grid.classId !== classId) notFound();

  const pageCount = Math.max(1, Math.ceil(grid.totalStudentCount / STUDENTS_PER_PAGE));
  const exportHref = `/classes/${classId}/exports/workbook`;

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="title-md">Response grid — {grid.assignmentTitle}</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-secondary">
            Every student&apos;s answers laid out the way the source spreadsheet reads —{" "}
            {orientationDescription(grid.orientation)}. The first row is the number of students
            answering &ldquo;1&rdquo; for each question.
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

      {/* The live-vs-snapshot distinction, stated plainly. */}
      <div className="mt-4 rounded-md border border-hairline bg-surface-sunken px-4 py-3 text-sm">
        <p>
          <strong>This page is live.</strong> It re-reads the database every time you load it, so
          new submissions appear on refresh.
        </p>
        <p className="mt-1 text-ink-secondary">
          The Excel workbook contains this same grid as an added sheet, with real{" "}
          <code>SUM</code> formulas in its totals row — but a downloaded file is a{" "}
          <strong>point-in-time snapshot</strong> and cannot refresh itself. Download it again
          after new submissions to bring it up to date. For charts, use the PNG and PDF exports on
          the{" "}
          <Link href={`/classes/${classId}/analytics`} className="link">
            analytics pages
          </Link>
          .
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-secondary md:grid-cols-5">
        <div>
          <dt className="text-ink-muted">Questions</dt>
          <dd className="font-medium tabular-nums">{grid.columns.length}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Students</dt>
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
          <dd className="font-medium">{new Date(grid.generatedAt).toLocaleString()}</dd>
        </div>
      </dl>

      {grid.syntheticStudentCount > 0 && (
        <p className="mt-3 rounded border border-dashed border-hairline px-3 py-2 text-xs text-ink-secondary">
          {grid.syntheticStudentCount} of these {grid.totalStudentCount} students are synthetic
          demo records, marked <em>(synthetic)</em> in the table and filterable above. The totals
          row counts every student, real and synthetic together.
        </p>
      )}

      <ResponseGridTable grid={grid} exportHref={exportHref} />

      {pageCount > 1 && (
        <nav
          aria-label="Student pages"
          className="mt-4 flex items-center justify-between text-sm"
        >
          <span className="text-ink-secondary">
            Students {page * STUDENTS_PER_PAGE + 1}–
            {Math.min((page + 1) * STUDENTS_PER_PAGE, grid.totalStudentCount)} of{" "}
            {grid.totalStudentCount} · page {page + 1} of {pageCount}
          </span>
          <span className="flex gap-2">
            <Button asChild variant="outline" disabled={page === 0}>
              <Link
                href={`/classes/${classId}/assignments/${assignmentId}/grid?page=${Math.max(0, page - 1)}`}
              >
                Previous
              </Link>
            </Button>
            <Button asChild variant="outline" disabled={page + 1 >= pageCount}>
              <Link
                href={`/classes/${classId}/assignments/${assignmentId}/grid?page=${Math.min(pageCount - 1, page + 1)}`}
              >
                Next
              </Link>
            </Button>
          </span>
        </nav>
      )}
    </main>
  );
}
