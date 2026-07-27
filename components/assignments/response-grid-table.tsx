"use client";

import { useMemo, useState } from "react";
import { FilterRow, FilterSearch, FilterSelect, ResetFiltersButton } from "@/components/analytics/filter-row";
import { focusRing } from "@/components/analytics/chart-card";
import type { ResponseGrid } from "@/lib/exports/response-grid";

/**
 * The live response grid.
 *
 * Same layout as the Excel sheet, and deliberately so: both are built from
 * `gatherResponseGrid`, so the column order, the labels and the totals are
 * one definition rendered twice. The difference is freshness — this
 * recomputes on every load, the .xlsx is frozen at its download time, and
 * the page says which is which rather than leaving a professor to assume.
 *
 * Rendering note: the grid is wide (255 columns for Assignment 2), so the
 * table scrolls inside its own container with the student column pinned.
 * The whole page never scrolls sideways.
 */

interface ResponseGridTableProps {
  grid: ResponseGrid;
  exportHref: string;
}

export function ResponseGridTable({ grid, exportHref }: ResponseGridTableProps) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [provenance, setProvenance] = useState("");

  const sourceOptions = useMemo(
    () => [...new Set(grid.columns.map((c) => c.energySource))],
    [grid.columns]
  );

  // Column filtering keeps the totals aligned by filtering indices, never
  // by rebuilding the values — a mismatch here would silently show one
  // student's answer under another question's heading.
  const visibleColumns = useMemo(() => {
    return grid.columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => !source || column.energySource === source);
  }, [grid.columns, source]);

  const visibleStudents = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return grid.students.filter((s) => {
      if (provenance === "synthetic" && !s.isSynthetic) return false;
      if (provenance === "real" && s.isSynthetic) return false;
      if (!needle) return true;
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.studentIdentifier ?? "").toLowerCase().includes(needle)
      );
    });
  }, [grid.students, search, provenance]);

  const filtersActive = Boolean(search || source || provenance);

  return (
    <div className="mt-6 space-y-4">
      <FilterRow>
        <FilterSearch
          label="Student"
          value={search}
          onChange={setSearch}
          placeholder="Search by name or ID"
        />
        <FilterSelect
          label="Energy source"
          value={source}
          onChange={setSource}
          options={sourceOptions}
          allLabel="All energy sources"
        />
        <label className="text-xs text-ink-secondary">
          <span className="mb-0.5 block">Student records</span>
          <select
            value={provenance}
            onChange={(e) => setProvenance(e.target.value)}
            className={`input input-compact ${focusRing}`}
          >
            <option value="">All students</option>
            <option value="real">Non-synthetic only</option>
            <option value="synthetic">Synthetic only</option>
          </select>
        </label>
        <ResetFiltersButton
          onReset={() => {
            setSearch("");
            setSource("");
            setProvenance("");
          }}
          disabled={!filtersActive}
        />
      </FilterRow>

      <p className="text-xs text-ink-muted">
        Showing {visibleStudents.length} of {grid.students.length} students and{" "}
        {visibleColumns.length} of {grid.columns.length} questions.
        {filtersActive && " Totals below always cover every student, not just the filtered view."}
      </p>

      <div className="overflow-auto rounded border border-hairline" style={{ maxHeight: "70vh" }}>
        <table className="border-collapse text-left text-xs">
          <caption className="sr-only">
            {grid.assignmentTitle} — one row per student, one column per question, with the
            count of &ldquo;1&rdquo; answers per question on the first row.
          </caption>
          <thead className="sticky top-0 z-20 bg-surface-sunken">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 min-w-52 border-b border-r border-hairline bg-surface-sunken px-2 py-1.5 font-medium text-ink-secondary"
              >
                Energy source
              </th>
              {visibleColumns.map(({ column, index }) => (
                <th
                  key={index}
                  scope="col"
                  title={`${column.energySource} — ${column.criterion} (${column.code}, cell ${column.originalCell})`}
                  className="whitespace-nowrap border-b border-hairline px-1.5 py-1.5 text-[10px] font-medium text-ink-secondary"
                >
                  {column.energySource}
                </th>
              ))}
            </tr>
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 border-b border-r border-hairline bg-surface-sunken px-2 py-1.5 font-normal text-ink-muted"
              >
                Criterion
              </th>
              {visibleColumns.map(({ column, index }) => (
                <th
                  key={index}
                  scope="col"
                  title={column.criterion}
                  className="max-w-24 truncate border-b border-hairline px-1.5 py-1.5 text-[10px] font-normal text-ink-muted"
                >
                  {column.criterion}
                </th>
              ))}
            </tr>
            {/* The live equivalent of the Excel SUM row. */}
            <tr className="bg-surface-sunken">
              <th
                scope="row"
                className="sticky left-0 z-30 border-b-2 border-r border-hairline bg-surface-sunken px-2 py-1.5 font-semibold"
              >
                Total answering &ldquo;1&rdquo;
              </th>
              {visibleColumns.map(({ index }) => (
                <td
                  key={index}
                  className="border-b-2 border-hairline px-1.5 py-1.5 text-center font-semibold tabular-nums"
                >
                  {grid.totals[index] ?? "—"}
                </td>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {visibleStudents.length === 0 ? (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-2 py-3 text-ink-muted"
                >
                  No students match the current filters.
                </td>
              </tr>
            ) : (
              visibleStudents.map((student) => (
                <tr key={student.studentId}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-r border-hairline bg-surface px-2 py-1 text-left font-normal"
                  >
                    {student.studentIdentifier ? `${student.studentIdentifier} — ` : ""}
                    {student.name}
                    {student.isSynthetic && (
                      <span className="ml-1.5 text-[10px] text-ink-muted">(synthetic)</span>
                    )}
                  </th>
                  {visibleColumns.map(({ index }) => (
                    <td key={index} className="px-1.5 py-1 text-center tabular-nums">
                      {student.values[index] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-muted">
        A dash means the student has no final answer for that question. 0 and 1 are the two
        options — neither is a preferred answer.{" "}
        <a href={exportHref} className="link">
          Download this grid as Excel
        </a>
        .
      </p>
    </div>
  );
}
