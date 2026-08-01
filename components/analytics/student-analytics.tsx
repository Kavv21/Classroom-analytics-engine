"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { focusRing } from "@/components/analytics/chart-card";
import { FilterRow, FilterSearch, ResetFiltersButton } from "@/components/analytics/filter-row";
import { attemptStateLabel } from "@/lib/ui/labels";
import type { AssignmentRow, StudentRosterRow } from "@/lib/analytics/page-data";

/**
 * The class's students, as the index into each person's full responses.
 *
 * There is no per-student metric here on purpose. The change rate,
 * stability and net-movement columns this table used to carry were all
 * computed over approved question mappings; with the mapping feature gone,
 * there is no defined way to say a student's Assignment 1 answer and their
 * Assignment 2 answer were answers to the same thing. Attempt state is
 * workflow, not a score, and the answers themselves live one click away.
 */

interface StudentAnalyticsProps {
  classId: string;
  students: StudentRosterRow[];
  assignments: AssignmentRow[];
}

const PAGE_SIZE = 25;

export function StudentAnalytics({ classId, students, assignments }: StudentAnalyticsProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return students;
    return students.filter(
      (s) =>
        s.name.toLowerCase().includes(needle) ||
        (s.email ?? "").toLowerCase().includes(needle) ||
        (s.studentIdentifier ?? "").toLowerCase().includes(needle)
    );
  }, [students, search]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <div className="mt-6 space-y-4">
      <FilterRow>
        <FilterSearch
          label="Search students"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(0);
          }}
          placeholder="Name, email or ID…"
        />
        <ResetFiltersButton
          onReset={() => {
            setSearch("");
            setPage(0);
          }}
          disabled={search === ""}
        />
      </FilterRow>

      <section aria-label="Students" className="card p-4">
        <h3 className="heading">Students ({rows.length})</h3>
        <p className="mt-0.5 text-xs text-ink-secondary">
          Open a student to see every question on both assignments with the answer they recorded.
          Attempt state describes where they are in the submission workflow — it is not a score.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-hairline">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Students in this class</caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                  Student
                </th>
                <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                  ID
                </th>
                {assignments.map((a) => (
                  <th
                    key={a.id}
                    scope="col"
                    className="px-2 py-1.5 font-medium text-ink-secondary"
                  >
                    Assignment {a.sequence_number}
                  </th>
                ))}
                <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                  Full responses
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {pageRows.map((s) => (
                <tr key={s.studentId}>
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/classes/${classId}/analytics/students/${s.studentId}`}
                      className={`link ${focusRing}`}
                    >
                      {s.name}
                    </Link>
                    {s.status !== "ACTIVE" && (
                      <span className="ml-2 text-ink-muted">{s.status.toLowerCase()}</span>
                    )}
                    {s.isSynthetic && (
                      <span className="ml-2 text-ink-muted">synthetic demo record</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-ink-secondary">
                    {s.studentIdentifier ?? "—"}
                  </td>
                  {assignments.map((a) => (
                    <td key={a.id} className="px-2 py-1.5 text-ink-secondary">
                      {s.attemptStateByAssignment[a.id]
                        ? attemptStateLabel(s.attemptStateByAssignment[a.id]!)
                        : "Not started"}
                    </td>
                  ))}
                  <td className="px-2 py-1.5">
                    <Link
                      href={`/classes/${classId}/analytics/students/${s.studentId}`}
                      className={`link ${focusRing}`}
                    >
                      All responses
                    </Link>
                  </td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={assignments.length + 3} className="px-2 py-3 text-ink-muted">
                    No students match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 && (
          <div className="mt-2 flex items-center gap-2 text-xs text-ink-secondary">
            <button
              type="button"
              disabled={safePage === 0}
              onClick={() => setPage(safePage - 1)}
              className={`input input-compact hover:bg-surface-sunken disabled:opacity-50 ${focusRing}`}
            >
              Previous
            </button>
            <span>
              Page {safePage + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage(safePage + 1)}
              className={`input input-compact hover:bg-surface-sunken disabled:opacity-50 ${focusRing}`}
            >
              Next
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
