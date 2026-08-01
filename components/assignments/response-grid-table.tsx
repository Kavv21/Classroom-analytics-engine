"use client";

import { useMemo, useState } from "react";
import { FilterRow, FilterSelect, ResetFiltersButton } from "@/components/analytics/filter-row";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GridColumn, ResponseGrid } from "@/lib/exports/response-grid";

/**
 * The live response grid — class totals per question, in the source
 * spreadsheet's own column order, with a subtotal per energy source.
 *
 * AGGREGATE-ONLY. There are no student rows here and no way to reach one
 * person's answer: an individual submission lives on that student's profile
 * page, which is the single surface for raw per-person data.
 *
 * Same layout as the Excel sheet, and deliberately so: both are built from
 * `gatherResponseGrid`, so the column order, the labels and the totals are
 * one definition rendered twice. The difference is freshness — this
 * recomputes on every load, the .xlsx is frozen at its download time, and
 * the page says which is which rather than leaving a professor to assume.
 *
 * Rendering note: the grid is wide (255 columns for Assignment 2), so the
 * table scrolls inside its own container with the label column pinned. The
 * whole page never scrolls sideways.
 */

interface ResponseGridTableProps {
  grid: ResponseGrid;
  exportHref: string;
}

function share(ones: number | null, answered: number | null): string {
  if (ones === null || !answered) return "—";
  return `${Math.round((ones / answered) * 100)}%`;
}

/** The phrase the totals are meant to be read as, used as a cell tooltip. */
function totalPhrase(column: GridColumn): string {
  if (column.ones === null || column.answered === null) return "No answers recorded yet.";
  return `${column.ones} of ${column.answered} students who answered chose 1 (Yes) — ${column.energySource}, ${column.criterion}`;
}

export function ResponseGridTable({ grid, exportHref }: ResponseGridTableProps) {
  const [source, setSource] = useState("");

  const sourceOptions = useMemo(
    () => [...new Set(grid.columns.map((c) => c.energySource))],
    [grid.columns]
  );

  const visibleColumns = useMemo(
    () => grid.columns.filter((column) => !source || column.energySource === source),
    [grid.columns, source]
  );
  const visibleSubtotals = useMemo(
    () => grid.sourceSubtotals.filter((s) => !source || s.energySource === source),
    [grid.sourceSubtotals, source]
  );

  // Header grouping: each run of adjacent columns sharing an energy source
  // becomes one spanning cell, which is how the source sheet reads.
  const sourceSpans = useMemo(() => {
    const spans: Array<{ energySource: string; span: number }> = [];
    for (const column of visibleColumns) {
      const last = spans[spans.length - 1];
      if (last && last.energySource === column.energySource) last.span += 1;
      else spans.push({ energySource: column.energySource, span: 1 });
    }
    return spans;
  }, [visibleColumns]);

  const totalRows: Array<{ label: string; pick: (c: GridColumn) => string; strong?: boolean }> = [
    {
      label: 'Answered "1" (Yes)',
      pick: (c) => (c.ones === null ? "—" : String(c.ones)),
      strong: true,
    },
    { label: 'Answered "0" (No)', pick: (c) => (c.zeros === null ? "—" : String(c.zeros)) },
    { label: "Students who answered", pick: (c) => (c.answered === null ? "—" : String(c.answered)) },
    { label: 'Share answering "1"', pick: (c) => share(c.ones, c.answered) },
  ];

  const anyDerived = visibleSubtotals.some((s) => s.derived);

  return (
    <div className="mt-6 space-y-6">
      <FilterRow>
        <FilterSelect
          label="Energy source"
          value={source}
          onChange={setSource}
          options={sourceOptions}
          allLabel="All energy sources"
        />
        <ResetFiltersButton onReset={() => setSource("")} disabled={!source} />
      </FilterRow>

      <p className="text-xs text-ink-muted">
        Showing {visibleColumns.length} of {grid.columns.length} questions across{" "}
        {visibleSubtotals.length} of {grid.sourceSubtotals.length} energy sources.
      </p>

      <div className="overflow-auto rounded border border-hairline" style={{ maxHeight: "70vh" }}>
        <table className="border-collapse text-left text-xs">
          <caption className="sr-only">
            {grid.assignmentTitle} — one column per question in the source spreadsheet&apos;s
            order, with the class totals for each question. No individual student answers.
          </caption>
          <thead className="sticky top-0 z-20 bg-surface-sunken">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 min-w-56 border-b border-r border-hairline bg-surface-sunken px-2 py-1.5 font-medium text-ink-secondary"
              >
                Energy source
              </th>
              {sourceSpans.map((group, i) => (
                <th
                  key={`${group.energySource}-${i}`}
                  scope="colgroup"
                  colSpan={group.span}
                  className="whitespace-nowrap border-b border-l border-hairline px-1.5 py-1.5 text-center text-[10px] font-medium text-ink-secondary"
                >
                  {group.energySource}
                </th>
              ))}
            </tr>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 border-b border-r border-hairline bg-surface-sunken px-2 py-1.5 font-normal text-ink-muted"
              >
                Question
              </th>
              {visibleColumns.map((column) => (
                <th
                  key={column.questionId}
                  scope="col"
                  title={`${column.questionText ?? column.criterion} (${column.code}, cell ${column.originalCell})`}
                  className="max-w-24 truncate border-b border-hairline px-1.5 py-1.5 text-[10px] font-normal text-ink-muted"
                >
                  {column.criterion}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {visibleColumns.length > 0 &&
              totalRows.map((row) => (
                <tr key={row.label} className={row.strong ? "bg-surface-sunken" : undefined}>
                  <th
                    scope="row"
                    className={`sticky left-0 z-10 whitespace-nowrap border-r border-hairline px-2 py-1.5 text-left ${
                      row.strong ? "bg-surface-sunken font-semibold" : "bg-surface font-normal"
                    }`}
                  >
                    {row.label}
                  </th>
                  {visibleColumns.map((column) => (
                    <td
                      key={column.questionId}
                      title={totalPhrase(column)}
                      className={`px-1.5 py-1.5 text-center tabular-nums ${
                        row.strong ? "font-semibold" : ""
                      }`}
                    >
                      {row.pick(column)}
                    </td>
                  ))}
                </tr>
              ))}
            {visibleColumns.length === 0 && (
              <tr>
                <td className="px-2 py-3 text-ink-muted">No questions match the current filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <section aria-label="Energy-source subtotals" className="card p-4">
        <h3 className="heading">Energy-source subtotals</h3>
        <p className="mt-0.5 text-xs text-ink-secondary">
          Every question belonging to an energy source, rolled up. These are counts of answers,
          not counts of students — a student contributes one answer per question.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-hairline">
          <Table>
            <TableCaption className="sr-only">
              Answer totals per energy source for {grid.assignmentTitle}
            </TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>Energy source</TableHead>
                <TableHead className="text-right">Questions</TableHead>
                <TableHead className="text-right">Answered &ldquo;1&rdquo; (Yes)</TableHead>
                <TableHead className="text-right">Answered &ldquo;0&rdquo; (No)</TableHead>
                <TableHead className="text-right">Answers given</TableHead>
                <TableHead className="text-right">Share &ldquo;1&rdquo;</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSubtotals.map((subtotal) => (
                <TableRow key={subtotal.energySource}>
                  <TableCell>
                    {subtotal.energySource}
                    {subtotal.derived && (
                      <span className="ml-1.5 text-[10px] text-ink-muted">(rolled up here)</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{subtotal.questionCount}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {subtotal.ones}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{subtotal.zeros}</TableCell>
                  <TableCell className="text-right tabular-nums">{subtotal.answered}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {share(subtotal.ones, subtotal.answered)}
                  </TableCell>
                </TableRow>
              ))}
              {visibleSubtotals.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-ink-muted">
                    No energy sources match the current filter.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        {anyDerived && (
          <p className="mt-2 text-xs text-ink-muted">
            Rows marked <em>(rolled up here)</em> are summed from the question totals above rather
            than read from the energy-source analytics view, which only covers questions that carry
            an energy source.
          </p>
        )}
      </section>

      <p className="text-xs text-ink-muted">
        0 and 1 are the two options — neither is a preferred answer. A dash means no answers have
        been recorded for that question yet, and a student who left a question blank counts in
        neither total.{" "}
        <a href={exportHref} className="link">
          Download these totals as Excel
        </a>
        .
      </p>
    </div>
  );
}
