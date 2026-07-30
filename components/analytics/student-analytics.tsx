"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ChartCard, focusRing } from "@/components/analytics/chart-card";
import { FilterRow, FilterSearch, ResetFiltersButton } from "@/components/analytics/filter-row";
import {
  BINARY_LABELS,
  histogramBins,
  QUALITY_LABELS,
  TRANSITION_STATE_LABELS,
} from "@/lib/analytics/chart-data";
import type {
  ResponseTransitionLiveRow,
  StudentTransitionSummary,
} from "@/lib/analytics/queries";
import {
  baseChrome,
  categoryAxis,
  formatPct,
  INK,
  labelFormatter,
  SERIES,
  tooltipFormatter,
  valueAxis,
} from "@/lib/charts/theme";

interface StudentAnalyticsProps {
  studentSummaries: StudentTransitionSummary[];
  liveRows: ResponseTransitionLiveRow[];
  studentNames: Record<string, string>;
}

type SortKey = "name" | "valid_paired" | "change_rate" | "changed_count" | "missing";
const PAGE_SIZE = 15;

function valueLabel(v: 0 | 1 | null): string {
  if (v === null) return "no answer";
  return v === 0 ? BINARY_LABELS.zero : BINARY_LABELS.one;
}

export function StudentAnalytics({
  studentSummaries,
  liveRows,
  studentNames,
}: StudentAnalyticsProps) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDesc, setSortDesc] = useState(false);
  const [page, setPage] = useState(0);
  const [binFilter, setBinFilter] = useState<number | null>(null);
  const [profileId, setProfileId] = useState<string | null>(null);

  const nameOf = (id: string) => studentNames[id] ?? `Student ${id.slice(0, 8)}`;

  // ---- 17.12 change-rate distribution ----------------------------------
  const bins = useMemo(
    () => histogramBins(studentSummaries.map((s) => s.change_rate)),
    [studentSummaries]
  );
  const noValidPairs = useMemo(
    () => studentSummaries.filter((s) => s.change_rate === null).length,
    [studentSummaries]
  );

  const histogramOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 24, top: 24, bottom: 8, containLabel: true },
      xAxis: categoryAxis({
        data: bins.map((b) => b.label),
        name: "Personal change rate",
        nameLocation: "middle",
        nameGap: 32,
        nameTextStyle: { color: INK.secondary },
        axisLabel: { color: INK.muted, fontSize: 10 },
      }),
      yAxis: valueAxis({ minInterval: 1 }),
      series: [
        {
          name: "Students",
          type: "bar",
          barMaxWidth: 28,
          data: bins.map((b, i) => ({
            value: b.count,
            itemStyle: {
              color: SERIES[0],
              opacity: binFilter !== null && binFilter !== i ? 0.35 : 1,
            },
          })),
          label: {
            show: true,
            position: "top",
            color: INK.secondary,
            fontSize: 10,
            formatter: labelFormatter((p) => (p.value > 0 ? String(p.value) : "")),
          },
        },
      ],
      tooltip: {
        ...baseChrome().tooltip,
        formatter: tooltipFormatter((p) => {
          const b = bins[p.dataIndex]!;
          return `Change rate ${b.label}<br/><b>${b.count}</b> student${b.count === 1 ? "" : "s"}`;
        }),
      },
    }),
    [bins, binFilter]
  );

  // ---- student table -----------------------------------------------------
  const tableRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    let rows = studentSummaries.map((s) => ({ ...s, name: nameOf(s.student_id) }));
    if (needle) rows = rows.filter((r) => r.name.toLowerCase().includes(needle));
    if (binFilter !== null) {
      const bin = bins[binFilter]!;
      rows = rows.filter(
        (r) =>
          r.change_rate !== null &&
          r.change_rate >= bin.start &&
          (binFilter === bins.length - 1 ? r.change_rate <= bin.end : r.change_rate < bin.end)
      );
    }
    const dir = sortDesc ? -1 : 1;
    rows.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return dir * a.name.localeCompare(b.name);
        case "valid_paired":
          return dir * (a.valid_paired - b.valid_paired);
        case "changed_count":
          return dir * (a.changed_count - b.changed_count);
        case "missing":
          return (
            dir *
            (a.missing_a1 + a.missing_a2 + a.missing_both -
              (b.missing_a1 + b.missing_a2 + b.missing_both))
          );
        case "change_rate":
          return dir * ((a.change_rate ?? -1) - (b.change_rate ?? -1));
      }
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentSummaries, search, sortKey, sortDesc, binFilter, bins, studentNames]);

  const pageCount = Math.max(1, Math.ceil(tableRows.length / PAGE_SIZE));
  const pageRows = tableRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const profileRows = useMemo(
    () =>
      profileId
        ? liveRows
            .filter((r) => r.student_id === profileId)
            .sort((a, b) => a.mapping_name.localeCompare(b.mapping_name))
        : [],
    [liveRows, profileId]
  );
  const profileSummary = studentSummaries.find((s) => s.student_id === profileId);

  function resetAll() {
    setSearch("");
    setBinFilter(null);
    setSortKey("name");
    setSortDesc(false);
    setPage(0);
    setProfileId(null);
  }

  const headerButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => {
        if (sortKey === key) setSortDesc(!sortDesc);
        else {
          setSortKey(key);
          setSortDesc(key !== "name");
        }
        setPage(0);
      }}
      aria-label={`Sort by ${label}`}
      className={`font-medium text-ink-secondary underline-offset-2 hover:underline ${focusRing}`}
    >
      {label}
      {sortKey === key ? (sortDesc ? " ↓" : " ↑") : ""}
    </button>
  );

  return (
    <div className="mt-6 space-y-6">
      <FilterRow>
        <FilterSearch label="Search students" value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Name…" />
        <ResetFiltersButton onReset={resetAll} disabled={search === "" && binFilter === null && !profileId} />
      </FilterRow>

      <ChartCard
        eyebrow="Section 17.12"
        title="Student change distribution"
        description="How many students fall in each personal change-rate band (share of their valid pairs that changed answer). Click a bar to filter the table below."
        option={histogramOption}
        height={280}
        exportName="student-change-distribution"
        onChartClick={(p) => {
          setBinFilter(binFilter === p.dataIndex ? null : p.dataIndex ?? null);
          setPage(0);
        }}
        table={{
          columns: ["Change-rate band", "Students"],
          rows: [
            ...bins.map((b) => [b.label, b.count] as Array<string | number>),
            ["No valid pairs yet", noValidPairs],
          ],
        }}
        footnote={
          noValidPairs > 0
            ? `${noValidPairs} student${noValidPairs === 1 ? "" : "s"} have no valid pairs yet (missing answers or only not-comparable mappings) and appear in the table, not the bars.`
            : undefined
        }
      />

      <section aria-label="Students" className="card p-4">
        <h3 className="heading">Students ({tableRows.length})</h3>
        <p className="mt-0.5 text-xs text-ink-secondary">
          Per-student transition summary across all approved mappings. Change describes opinion
          movement — it is not a score. Click a row for the full profile.
        </p>
        <div className="mt-3 overflow-x-auto rounded border border-hairline">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Per-student transition summaries</caption>
            <thead className="bg-surface-sunken">
              <tr>
                <th scope="col" className="px-2 py-1.5">{headerButton("name", "Student")}</th>
                <th scope="col" className="px-2 py-1.5">{headerButton("valid_paired", "Valid pairs")}</th>
                <th scope="col" className="px-2 py-1.5">{headerButton("changed_count", "Changed")}</th>
                <th scope="col" className="px-2 py-1.5">{headerButton("change_rate", "Change rate")}</th>
                <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">0→1 / 1→0</th>
                <th scope="col" className="px-2 py-1.5">{headerButton("missing", "Missing")}</th>
                <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Not comparable</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline tabular-nums">
              {pageRows.map((r) => (
                <tr
                  key={r.student_id}
                  className={profileId === r.student_id ? "bg-surface-info" : undefined}
                >
                  <td className="px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => setProfileId(profileId === r.student_id ? null : r.student_id)}
                      className={`link text-left ${focusRing}`}
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="px-2 py-1.5">{r.valid_paired}</td>
                  <td className="px-2 py-1.5">{r.changed_count}</td>
                  <td className="px-2 py-1.5">{formatPct(r.change_rate)}</td>
                  <td className="px-2 py-1.5">{r.s01} / {r.s10}</td>
                  <td className="px-2 py-1.5">{r.missing_a1 + r.missing_a2 + r.missing_both}</td>
                  <td className="px-2 py-1.5">{r.not_comparable}</td>
                </tr>
              ))}
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-2 py-3 text-ink-muted">
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
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
              className={`input input-compact hover:bg-surface-sunken disabled:opacity-50 ${focusRing}`}
            >
              Previous
            </button>
            <span>
              Page {page + 1} of {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
              className={`input input-compact hover:bg-surface-sunken disabled:opacity-50 ${focusRing}`}
            >
              Next
            </button>
          </div>
        )}
      </section>

      {profileId && profileSummary && (
        <section
          aria-label={`Profile — ${nameOf(profileId)}`}
          className="card p-4"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-ink">{nameOf(profileId)}</h3>
              <p className="mt-0.5 text-xs text-ink-secondary">
                {profileSummary.valid_paired} valid pairs · change rate{" "}
                {formatPct(profileSummary.change_rate)} · stability{" "}
                {formatPct(profileSummary.stability_rate)} · net movement toward{" "}
                {BINARY_LABELS.one}: {profileSummary.net_movement_toward_1 > 0 ? "+" : ""}
                {profileSummary.net_movement_toward_1}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setProfileId(null)}
              className={`rounded border border-strong px-2.5 py-1 text-xs font-medium text-ink-secondary hover:bg-surface-sunken ${focusRing}`}
            >
              Close profile
            </button>
          </div>
          <div className="mt-3 overflow-x-auto rounded border border-hairline">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">All transitions for {nameOf(profileId)}</caption>
              <thead className="bg-surface-sunken">
                <tr>
                  <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Mapping</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Energy source</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">A1 answer</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">A2 answer</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Transition</th>
                  <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Data quality</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {profileRows.map((r) => (
                  <tr key={r.mapping_id}>
                    <td className="px-2 py-1.5">
                      {r.mapping_name} <span className="text-ink-muted">v{r.mapping_version}</span>
                    </td>
                    <td className="px-2 py-1.5">{r.energy_source ?? "—"}</td>
                    <td className="px-2 py-1.5">{valueLabel(r.assignment_1_value)}</td>
                    <td className="px-2 py-1.5">{valueLabel(r.assignment_2_value)}</td>
                    <td className="px-2 py-1.5">
                      {r.transition_state ? TRANSITION_STATE_LABELS[r.transition_state] : "—"}
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">
                      {r.data_quality_status
                        ? QUALITY_LABELS[r.data_quality_status.toLowerCase() as keyof typeof QUALITY_LABELS]
                        : "Valid pair"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
