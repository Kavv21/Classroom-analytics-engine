"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ChartCard, focusRing } from "@/components/analytics/chart-card";
import { FilterRow, FilterSearch, FilterSelect, ResetFiltersButton } from "@/components/analytics/filter-row";
import { SyntheticDataBanner } from "@/components/analytics/synthetic-banner";
import {
  DEMO_PAIR_COLUMNS,
  demoEnergySourceRows,
  demoPairCells,
  demoPairRows,
  demoStudentRows,
  formatCount,
  formatPctPoints,
  formatRelativeChange,
  formatShare,
  formatSignedCount,
  FORMULAS,
  NO_VALUE,
  PAIR_SHIFT_LABELS,
  provenanceFootnote,
  SHIFT_CATEGORY_DEFINITIONS,
  summariseShiftCategories,
  type DemoScope,
} from "@/lib/analytics/demo-data";
import type {
  EnergySourceAssignmentChange,
  ResponseTransitionLiveRow,
  StudentTransitionSummary,
} from "@/lib/analytics/queries";
import {
  baseChrome,
  categoryAxis,
  DIVERGING,
  INK,
  labelFormatter,
  SERIES,
  tooltipFormatter,
  valueAxis,
} from "@/lib/charts/theme";

/**
 * The Demo Dashboard body. Every figure on this page is read from the
 * Phase 7 analytics views (migration 0012) or from
 * energy_source_assignment_change (migration 0017) — nothing here
 * recomputes a transition, a rate, or a shift.
 *
 * Presentation rules this component is responsible for:
 *  - the synthetic origin of the data is stated on the page AND on every
 *    single chart and table, because a screenshot travels further than the
 *    page it came from;
 *  - "shifted toward 1" and "shifted toward 0" are directions, not
 *    outcomes: same colour weight, same prominence, neutral wording;
 *  - an undefined figure renders as "—", never as 0 and never as a number
 *    the data does not support.
 */

const PAGE_SIZE = 25;
const ALL = "";

interface DemoDashboardProps {
  scope: DemoScope;
  energyChange: EnergySourceAssignmentChange[];
  studentSummaries: StudentTransitionSummary[];
  liveRows: ResponseTransitionLiveRow[];
  studentNames: Record<string, string>;
  syntheticStudentIds: string[];
  exportHref: string;
}

export function DemoDashboard({
  scope,
  energyChange,
  studentSummaries,
  liveRows,
  studentNames,
  syntheticStudentIds,
  exportHref,
}: DemoDashboardProps) {
  const syntheticSet = useMemo(() => new Set(syntheticStudentIds), [syntheticStudentIds]);

  const sources = useMemo(() => demoEnergySourceRows(energyChange), [energyChange]);
  const students = useMemo(
    () => demoStudentRows(studentSummaries, studentNames),
    [studentSummaries, studentNames]
  );
  const categories = useMemo(() => summariseShiftCategories(studentSummaries), [studentSummaries]);
  const pairs = useMemo(
    () => demoPairRows(liveRows, studentNames, syntheticSet),
    [liveRows, studentNames, syntheticSet]
  );

  const foot = (comparison: string, formula: string) =>
    provenanceFootnote(scope, comparison, formula);

  // ============================================================
  // 1. Per-energy-source totals, both assignments.
  // ============================================================
  const totalsOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      legend: { top: 0, textStyle: { color: INK.secondary } },
      grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
      xAxis: categoryAxis({
        data: sources.map((s) => s.energySource),
        axisLabel: { color: INK.muted, rotate: 45, fontSize: 10 },
      }),
      yAxis: valueAxis({ name: "Count of “1 — Yes”", nameTextStyle: { color: INK.secondary } }),
      series: [
        {
          name: scope.assignment1Title,
          type: "bar",
          barMaxWidth: 22,
          itemStyle: { color: SERIES[0] },
          data: sources.map((s) => s.a1Ones),
        },
        {
          name: scope.assignment2Title,
          type: "bar",
          barMaxWidth: 22,
          itemStyle: { color: SERIES[3] },
          data: sources.map((s) => s.a2Ones),
        },
      ],
      // Axis trigger with ECharts' own formatter: both assignments appear
      // in one tooltip, so a viewer compares the pair rather than reading
      // one bar at a time.
      tooltip: { ...baseChrome().tooltip, trigger: "axis" },
    }),
    [sources, scope.assignment1Title, scope.assignment2Title]
  );

  const totalsTable = {
    columns: [
      "Energy source",
      `${scope.assignment1Title} — label in sheet`,
      `${scope.assignment2Title} — label in sheet`,
      `${scope.assignment1Title} — answered`,
      `${scope.assignment1Title} — count of 1`,
      `${scope.assignment1Title} — % of 1`,
      `${scope.assignment2Title} — answered`,
      `${scope.assignment2Title} — count of 1`,
      `${scope.assignment2Title} — % of 1`,
    ],
    rows: sources.map((s) => [
      s.energySource,
      s.a1Label ?? NO_VALUE,
      s.a2Label ?? NO_VALUE,
      formatCount(s.a1Answered),
      formatCount(s.a1Ones),
      formatShare(s.a1PctOne),
      formatCount(s.a2Answered),
      formatCount(s.a2Ones),
      formatShare(s.a2PctOne),
    ]),
  };

  // ============================================================
  // 2. Absolute + relative change per energy source.
  // ============================================================
  const changeSources = useMemo(() => sources.filter((s) => s.bothSidesPresent), [sources]);
  const oneSided = sources.length - changeSources.length;

  const changeOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 32, top: 16, bottom: 8, containLabel: true },
      xAxis: valueAxis({ name: "Change in count of “1 — Yes”", nameLocation: "middle", nameGap: 30 }),
      yAxis: categoryAxis({
        data: changeSources.map((s) => s.energySource),
        axisLabel: { color: INK.muted, fontSize: 11 },
      }),
      series: [
        {
          name: "Absolute change",
          type: "bar",
          barMaxWidth: 22,
          data: changeSources.map((s) => ({
            value: s.absoluteChange,
            // Direction only. Blue toward 1, orange toward 0 — the
            // diverging pair from the chart theme, deliberately not
            // red/green, because neither direction is a gain or a loss.
            itemStyle: {
              color: (s.absoluteChange ?? 0) >= 0 ? DIVERGING.toward1 : DIVERGING.toward0,
            },
          })),
          label: {
            show: true,
            position: "right",
            color: INK.secondary,
            fontSize: 10,
            formatter: labelFormatter<number | null>((p) => formatSignedCount(p.value)),
          },
        },
      ],
      tooltip: {
        ...baseChrome().tooltip,
        formatter: tooltipFormatter<number | null>((p) => {
          const s = changeSources[p.dataIndex]!;
          return (
            `<b>${s.energySource}</b><br/>` +
            `Count of 1 — ${scope.assignment1Title}: ${formatCount(s.a1Ones)}<br/>` +
            `Count of 1 — ${scope.assignment2Title}: ${formatCount(s.a2Ones)}<br/>` +
            `Absolute change: ${formatSignedCount(s.absoluteChange)}<br/>` +
            `Relative change: ${formatRelativeChange(s.relativeChange)}<br/>` +
            `Percentage-point shift: ${formatPctPoints(s.pctPointShift)}`
          );
        }),
      },
    }),
    [changeSources, scope.assignment1Title, scope.assignment2Title]
  );

  const changeTable = {
    columns: [
      "Energy source",
      "Count of 1 — A1",
      "Count of 1 — A2",
      "Absolute change",
      "Relative change",
      "Percentage-point shift",
    ],
    rows: sources.map((s) => [
      s.energySource,
      formatCount(s.a1Ones),
      formatCount(s.a2Ones),
      formatSignedCount(s.absoluteChange),
      formatRelativeChange(s.relativeChange),
      formatPctPoints(s.pctPointShift),
    ]),
  };

  // ============================================================
  // 3. Student shift categories.
  // ============================================================
  const categoryOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 48, top: 16, bottom: 8, containLabel: true },
      xAxis: valueAxis({ minInterval: 1, name: "Students", nameLocation: "middle", nameGap: 28 }),
      yAxis: categoryAxis({ data: categories.counts.map((c) => c.label) }),
      series: [
        {
          name: "Students",
          type: "bar",
          barMaxWidth: 22,
          data: categories.counts.map((c, i) => ({
            value: c.students,
            itemStyle: { color: i === 0 ? DIVERGING.toward1 : i === 1 ? DIVERGING.toward0 : SERIES[2] },
          })),
          label: {
            show: true,
            position: "right",
            color: INK.secondary,
            fontSize: 11,
            formatter: labelFormatter<number>((p) => {
              const c = categories.counts[p.dataIndex]!;
              return c.share === null ? String(c.students) : `${c.students} (${formatShare(c.share, 0)})`;
            }),
          },
        },
      ],
      tooltip: {
        ...baseChrome().tooltip,
        formatter: tooltipFormatter<number>((p) => {
          const c = categories.counts[p.dataIndex]!;
          return `<b>${c.label}</b><br/>${c.students} students · ${formatShare(c.share)}<br/><span style="font-size:11px">${SHIFT_CATEGORY_DEFINITIONS[c.category]}</span>`;
        }),
      },
    }),
    [categories]
  );

  const categoryTable = {
    columns: ["Category", "Students", "% of students with comparable pairs", "Definition"],
    rows: categories.counts.map((c) => [
      c.label,
      c.students,
      formatShare(c.share),
      SHIFT_CATEGORY_DEFINITIONS[c.category],
    ]),
  };

  // ============================================================
  // 4. Per-student change table.
  // ============================================================
  const [studentSearch, setStudentSearch] = useState("");
  const [studentPage, setStudentPage] = useState(0);

  const filteredStudents = useMemo(() => {
    const needle = studentSearch.trim().toLowerCase();
    if (!needle) return students;
    return students.filter((s) => s.name.toLowerCase().includes(needle));
  }, [students, studentSearch]);

  const studentTable = {
    columns: [
      "Student",
      "Valid pairs",
      "S00",
      "S01",
      "S10",
      "S11",
      "Changed",
      "Unchanged",
      "Change rate",
      "Net movement toward 1",
      "Shift category",
    ],
    rows: filteredStudents.map((s) => [
      s.name,
      s.validPaired,
      s.s00,
      s.s01,
      s.s10,
      s.s11,
      s.changedCount,
      s.unchangedCount,
      formatShare(s.changeRate),
      formatSignedCount(s.netMovementToward1),
      s.categoryLabel,
    ]),
  };

  const studentPageRows = studentTable.rows.slice(
    studentPage * PAGE_SIZE,
    studentPage * PAGE_SIZE + PAGE_SIZE
  );
  const studentPages = Math.max(1, Math.ceil(studentTable.rows.length / PAGE_SIZE));

  // ============================================================
  // 5. Excel-style filterable per-pair table.
  // ============================================================
  const [pairSearch, setPairSearch] = useState("");
  const [pairSource, setPairSource] = useState(ALL);
  const [pairShift, setPairShift] = useState(ALL);
  const [pairAnswer, setPairAnswer] = useState(ALL);
  const [pairPage, setPairPage] = useState(0);

  const sourceOptions = useMemo(
    () => [...new Set(pairs.map((p) => p.energySource))].sort(),
    [pairs]
  );
  const shiftOptions = useMemo(() => [...new Set(pairs.map((p) => p.shiftLabel))].sort(), [pairs]);

  const filteredPairs = useMemo(() => {
    const needle = pairSearch.trim().toLowerCase();
    return pairs.filter((p) => {
      if (needle && !p.studentName.toLowerCase().includes(needle)) return false;
      if (pairSource && p.energySource !== pairSource) return false;
      if (pairShift && p.shiftLabel !== pairShift) return false;
      if (pairAnswer === "A1_ONE" && p.a1Answer !== "1 — Yes") return false;
      if (pairAnswer === "A1_ZERO" && p.a1Answer !== "0 — No") return false;
      if (pairAnswer === "A2_ONE" && p.a2Answer !== "1 — Yes") return false;
      if (pairAnswer === "A2_ZERO" && p.a2Answer !== "0 — No") return false;
      return true;
    });
  }, [pairs, pairSearch, pairSource, pairShift, pairAnswer]);

  const pairPages = Math.max(1, Math.ceil(filteredPairs.length / PAGE_SIZE));
  const pairPageRows = filteredPairs.slice(pairPage * PAGE_SIZE, pairPage * PAGE_SIZE + PAGE_SIZE);
  const pairFiltersActive = Boolean(pairSearch || pairSource || pairShift || pairAnswer);

  function resetPairFilters() {
    setPairSearch("");
    setPairSource(ALL);
    setPairShift(ALL);
    setPairAnswer(ALL);
    setPairPage(0);
  }

  return (
    <div className="mt-6 space-y-6">
      <SyntheticDataBanner scope={scope} />

      <ChartCard
        eyebrow="Demo cohort"
        title={`Answers selecting “1 — Yes” per energy source — ${scope.assignment1Title} vs ${scope.assignment2Title}`}
        description="Pooled across every active question of that energy source, for all enrolled students."
        option={totalsOption}
        table={totalsTable}
        exportName="demo-energy-source-totals"
        height={380}
        footnote={foot(
          `${scope.assignment1Title} and ${scope.assignment2Title}, side by side, per energy source`,
          FORMULAS.onesCount
        )}
      />

      <ChartCard
        eyebrow="Demo cohort"
        title="Change per energy source, Assignment 1 → Assignment 2"
        description="Direction of movement only. A shift toward 1 and a shift toward 0 are the same kind of event; neither is a gain."
        option={changeOption}
        table={changeTable}
        exportName="demo-energy-source-change"
        height={Math.max(280, changeSources.length * 26 + 80)}
        footnote={foot(
          `${scope.assignment1Title} → ${scope.assignment2Title}, per energy source`,
          `${FORMULAS.absoluteChange} ${FORMULAS.relativeChange} ${FORMULAS.pctPointShift}`
        )}
      >
        {oneSided > 0 && (
          <p className="mt-2 rounded border border-hairline bg-surface-sunken px-3 py-2 text-xs text-ink-secondary">
            {oneSided} energy source{oneSided === 1 ? " appears" : "s appear"} in only one of the two
            assignments and so cannot be charted as a change. Those rows are kept in the table below
            with “{NO_VALUE}” in every change column — they are not dropped, and not counted as zero.
          </p>
        )}
      </ChartCard>

      <ChartCard
        eyebrow="Demo cohort"
        title="Students by shift category"
        description="One category per student, from their net movement across all approved mappings."
        option={categoryOption}
        table={categoryTable}
        exportName="demo-shift-categories"
        height={260}
        footnote={foot(
          `all approved mappings, ${scope.assignment1Title} → ${scope.assignment2Title}`,
          `${FORMULAS.netMovement} ${FORMULAS.shiftCategory}`
        )}
      />

      {/* ---- per-student table ---- */}
      <section aria-label="Per-student change" className="card p-4">
        <h3 className="heading">Per-student change</h3>
        <p className="note-muted mt-0.5">
          One row per student, from <code>student_transition_summary</code>. Change rate and net
          movement are different measurements and are shown as separate columns.
        </p>
        <FilterRow>
          <FilterSearch
            label="Student"
            value={studentSearch}
            onChange={(v) => {
              setStudentSearch(v);
              setStudentPage(0);
            }}
            placeholder="Search by name"
          />
          <ResetFiltersButton onReset={() => setStudentSearch("")} disabled={!studentSearch} />
        </FilterRow>
        <DataTable columns={studentTable.columns} rows={studentPageRows} />
        <Pager
          page={studentPage}
          pages={studentPages}
          total={studentTable.rows.length}
          noun="students"
          onChange={setStudentPage}
        />
        <p className="mt-2 text-xs text-ink-muted">
          {foot(
            `per student, ${scope.assignment1Title} → ${scope.assignment2Title}`,
            `${FORMULAS.transitionStates} ${FORMULAS.changeRate} ${FORMULAS.netMovement}`
          )}
        </p>
      </section>

      {/* ---- filterable per-pair table ---- */}
      <section aria-label="Every response pair" className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="heading">Every response pair</h3>
            <p className="note-muted mt-0.5">
              One row per student per approved mapping, from{" "}
              <code>response_transitions_live</code>. Filter any column combination; the download
              carries the same rows plus the standard export provenance block.
            </p>
          </div>
          <a href={exportHref} className={`btn btn-secondary shrink-0 ${focusRing}`}>
            Download CSV
          </a>
        </div>

        <FilterRow>
          <FilterSearch
            label="Student"
            value={pairSearch}
            onChange={(v) => {
              setPairSearch(v);
              setPairPage(0);
            }}
            placeholder="Search by name"
          />
          <FilterSelect
            label="Energy source"
            value={pairSource}
            onChange={(v) => {
              setPairSource(v);
              setPairPage(0);
            }}
            options={sourceOptions}
            allLabel="All energy sources"
          />
          <FilterSelect
            label="Shift category"
            value={pairShift}
            onChange={(v) => {
              setPairShift(v);
              setPairPage(0);
            }}
            options={shiftOptions}
            allLabel="All categories"
          />
          <label className="text-xs text-ink-secondary">
            <span className="mb-0.5 block">Assignment answer</span>
            <select
              value={pairAnswer}
              onChange={(e) => {
                setPairAnswer(e.target.value);
                setPairPage(0);
              }}
              className={`input input-compact ${focusRing}`}
            >
              <option value="">Any answer</option>
              <option value="A1_ONE">{scope.assignment1Title} = 1 — Yes</option>
              <option value="A1_ZERO">{scope.assignment1Title} = 0 — No</option>
              <option value="A2_ONE">{scope.assignment2Title} = 1 — Yes</option>
              <option value="A2_ZERO">{scope.assignment2Title} = 0 — No</option>
            </select>
          </label>
          <ResetFiltersButton onReset={resetPairFilters} disabled={!pairFiltersActive} />
        </FilterRow>

        <DataTable
          columns={[...DEMO_PAIR_COLUMNS]}
          rows={pairPageRows.map((r) => demoPairCells(r))}
        />
        <Pager
          page={pairPage}
          pages={pairPages}
          total={filteredPairs.length}
          noun="response pairs"
          onChange={setPairPage}
        />
        <p className="mt-2 text-xs text-ink-muted">
          {foot(
            `every student × approved mapping pair, ${scope.assignment1Title} → ${scope.assignment2Title}`,
            `${FORMULAS.transitionStates} Shift category: S01 → ${PAIR_SHIFT_LABELS.SHIFTED_TOWARD_1}, S10 → ${PAIR_SHIFT_LABELS.SHIFTED_TOWARD_0}, S00 and S11 → ${PAIR_SHIFT_LABELS.NO_NET_CHANGE}.`
          )}
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------ table bits --

function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}) {
  return (
    <div className="mt-3 overflow-auto rounded border border-hairline">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface-sunken">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium text-ink-secondary">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline tabular-nums">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-2 py-3 text-ink-muted">
                No rows match the current filters.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-1.5">
                    {cell === null || cell === undefined ? NO_VALUE : String(cell)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Pager({
  page,
  pages,
  total,
  noun,
  onChange,
}: {
  page: number;
  pages: number;
  total: number;
  noun: string;
  onChange: (page: number) => void;
}) {
  const safePage = Math.min(page, pages - 1);
  return (
    <div className="mt-2 flex items-center justify-between text-xs text-ink-secondary">
      <span>
        {total} {noun}
        {pages > 1 ? ` · page ${safePage + 1} of ${pages}` : ""}
      </span>
      {pages > 1 && (
        <span className="flex gap-1.5">
          <button
            type="button"
            className={`btn btn-toggle ${focusRing}`}
            onClick={() => onChange(Math.max(0, safePage - 1))}
            disabled={safePage === 0}
          >
            Previous
          </button>
          <button
            type="button"
            className={`btn btn-toggle ${focusRing}`}
            onClick={() => onChange(Math.min(pages - 1, safePage + 1))}
            disabled={safePage >= pages - 1}
          >
            Next
          </button>
        </span>
      )}
    </div>
  );
}
