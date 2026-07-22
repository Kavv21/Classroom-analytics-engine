"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ChartCard } from "@/components/analytics/chart-card";
import {
  FilterRow,
  FilterSearch,
  FilterSelect,
  ResetFiltersButton,
} from "@/components/analytics/filter-row";
import { BINARY_LABELS, responseHeatmap } from "@/lib/analytics/chart-data";
import type {
  QuestionResponseSummary,
  SubmissionProgressRow,
  SubmissionTimelineRow,
} from "@/lib/analytics/queries";
import {
  baseChrome,
  categoryAxis,
  formatPct,
  INK,
  labelFormatter,
  percentAxis,
  QUALITY_COLORS,
  scaleFormatter,
  SEQUENTIAL_BLUE,
  SERIES,
  valueAxis,
} from "@/lib/charts/theme";

export interface AssignmentInfo {
  id: string;
  title: string;
  sequenceNumber: number;
}

interface AssignmentAnalyticsProps {
  assignments: AssignmentInfo[];
  questionSummaries: QuestionResponseSummary[];
  progress: SubmissionProgressRow[];
  timeline: SubmissionTimelineRow[];
}

const YES_COLOR = SERIES[0]; // "1 — Yes" is always slot 1 (blue)
const NO_COLOR = SERIES[1]; // "0 — No" is always slot 2 (orange)

export function AssignmentAnalytics({
  assignments,
  questionSummaries,
  progress,
  timeline,
}: AssignmentAnalyticsProps) {
  const [assignmentId, setAssignmentId] = useState(assignments[0]?.id ?? "");
  const [energySource, setEnergySource] = useState("");
  const [criterion, setCriterion] = useState("");
  const [search, setSearch] = useState("");
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null);
  const [consensusOrder, setConsensusOrder] = useState<"highest" | "lowest">("highest");

  const assignmentQuestions = useMemo(
    () => questionSummaries.filter((q) => q.assignment_id === assignmentId),
    [questionSummaries, assignmentId]
  );

  const sources = useMemo(
    () => [...new Set(assignmentQuestions.map((q) => q.energy_source).filter((s): s is string => !!s))].sort(),
    [assignmentQuestions]
  );
  const criteria = useMemo(
    () => [...new Set(assignmentQuestions.map((q) => q.criterion).filter((c): c is string => !!c))].sort(),
    [assignmentQuestions]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assignmentQuestions
      .filter((q) => (energySource ? q.energy_source === energySource : true))
      .filter((q) => (criterion ? q.criterion === criterion : true))
      .filter((q) =>
        needle
          ? q.external_question_code.toLowerCase().includes(needle) ||
            (q.energy_source ?? "").toLowerCase().includes(needle) ||
            (q.criterion ?? "").toLowerCase().includes(needle)
          : true
      )
      .sort((a, b) => a.external_question_code.localeCompare(b.external_question_code));
  }, [assignmentQuestions, energySource, criterion, search]);

  const filtersActive = energySource !== "" || criterion !== "" || search !== "";
  const selected = filtered.find((q) => q.question_id === selectedQuestion) ?? null;

  // ---- 17.1 response distribution -------------------------------------
  const distributionOption: EChartsOption = useMemo(() => {
    const codes = filtered.map((q) => q.external_question_code);
    return {
      ...baseChrome(),
      tooltip: { ...baseChrome().tooltip, trigger: "axis" },
      legend: { top: 0, textStyle: { color: INK.secondary } },
      grid: { left: 8, right: 24, top: 32, bottom: 40, containLabel: true },
      dataZoom:
        filtered.length > 24
          ? [{ type: "slider", yAxisIndex: 0, startValue: 0, endValue: 23, width: 16 }]
          : undefined,
      xAxis: percentAxis(),
      yAxis: categoryAxis({ data: codes, inverse: true }),
      series: [
        {
          name: BINARY_LABELS.zero,
          type: "bar",
          stack: "dist",
          color: NO_COLOR,
          barMaxWidth: 14,
          itemStyle: { borderColor: INK.surface, borderWidth: 1 },
          data: filtered.map((q) => (q.answered > 0 ? q.zeros / q.answered : null)),
        },
        {
          name: BINARY_LABELS.one,
          type: "bar",
          stack: "dist",
          color: YES_COLOR,
          barMaxWidth: 14,
          itemStyle: { borderColor: INK.surface, borderWidth: 1 },
          data: filtered.map((q) => (q.answered > 0 ? q.ones / q.answered : null)),
        },
      ],
    };
  }, [filtered]);

  // ---- 17.6 response heatmap ------------------------------------------
  const heat = useMemo(() => responseHeatmap(filtered), [filtered]);
  const heatmapOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 24, top: 8, bottom: 64, containLabel: true },
      xAxis: categoryAxis({
        data: heat.colKeys,
        axisLabel: { color: INK.muted, rotate: 30, width: 120, overflow: "truncate" },
      }),
      yAxis: categoryAxis({ data: heat.rowKeys, inverse: true }),
      visualMap: {
        min: 0,
        max: 1,
        text: ["100% chose 1 — Yes", "0%"],
        textStyle: { color: INK.secondary, fontSize: 10 },
        inRange: { color: [...SEQUENTIAL_BLUE] },
        orient: "horizontal",
        left: "center",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 90,
        formatter: scaleFormatter((v) => formatPct(v, 0)),
      },
      series: [
        {
          type: "heatmap",
          data: heat.cells
            .filter(([, , v]) => v !== null)
            .map(([r, c, v]) => [c, r, Number((v as number).toFixed(3))]),
          label: {
            show: true,
            fontSize: 9,
            color: INK.primary,
            formatter: labelFormatter<[number, number, number]>((p) => formatPct(p.value[2], 0)),
          },
          itemStyle: { borderColor: INK.surface, borderWidth: 2 },
        },
      ],
    }),
    [heat]
  );

  // ---- 17.11 consensus ranking ----------------------------------------
  const ranked = useMemo(() => {
    const withData = filtered.filter((q) => q.consensus !== null);
    const sorted = [...withData].sort((a, b) =>
      consensusOrder === "highest"
        ? b.consensus! - a.consensus!
        : a.consensus! - b.consensus!
    );
    return sorted.slice(0, 20);
  }, [filtered, consensusOrder]);

  const consensusOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
      xAxis: percentAxis({ min: 0.5 }),
      yAxis: categoryAxis({ data: ranked.map((q) => q.external_question_code), inverse: true }),
      series: [
        {
          name: "Consensus",
          type: "bar",
          color: SERIES[0],
          barMaxWidth: 14,
          data: ranked.map((q) => q.consensus),
          label: {
            show: true,
            position: "right",
            color: INK.secondary,
            fontSize: 10,
            formatter: labelFormatter((p) => formatPct(p.value, 0)),
          },
        },
      ],
    }),
    [ranked]
  );

  // ---- 17.13 submission status ----------------------------------------
  const assignmentTitle = (id: string) =>
    assignments.find((a) => a.id === id)?.title ?? id.slice(0, 8);

  const STATUS_SERIES: Array<{ key: keyof SubmissionProgressRow; label: string; color: string }> = [
    { key: "not_started_count", label: "Not started", color: QUALITY_COLORS.MISSING_BOTH },
    { key: "draft_count", label: "Draft", color: SERIES[3] },
    { key: "submitted_count", label: "Submitted", color: SERIES[0] },
    { key: "reopened_count", label: "Reopened", color: SERIES[1] },
    { key: "resubmitted_count", label: "Resubmitted", color: SERIES[2] },
  ];

  const statusOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      tooltip: { ...baseChrome().tooltip, trigger: "axis" },
      legend: { top: 0, textStyle: { color: INK.secondary } },
      xAxis: valueAxis(),
      yAxis: categoryAxis({ data: progress.map((p) => assignmentTitle(p.assignment_id)) }),
      series: STATUS_SERIES.map((s) => ({
        name: s.label,
        type: "bar" as const,
        stack: "status",
        color: s.color,
        barMaxWidth: 22,
        itemStyle: { borderColor: INK.surface, borderWidth: 1 },
        label: {
          show: true,
          color: INK.primary,
          fontSize: 10,
          formatter: labelFormatter((p) => (p.value > 0 ? String(p.value) : "")),
        },
        data: progress.map((p) => p[s.key] as number),
      })),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress, assignments]
  );

  // ---- 17.14 completion timeline --------------------------------------
  const timelineDates = useMemo(
    () => [...new Set(timeline.map((t) => t.submission_date))].sort(),
    [timeline]
  );
  const timelineOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      tooltip: { ...baseChrome().tooltip, trigger: "axis" },
      legend: { top: 0, textStyle: { color: INK.secondary } },
      xAxis: categoryAxis({ data: timelineDates }),
      yAxis: valueAxis({ minInterval: 1 }),
      series: assignments.map((a, i) => {
        const rows = timeline.filter((t) => t.assignment_id === a.id);
        const byDate = new Map(rows.map((r) => [r.submission_date, r.cumulative_submissions]));
        let last = 0;
        const data = timelineDates.map((d) => {
          const v = byDate.get(d);
          if (v !== undefined) last = v;
          return last;
        });
        return {
          name: a.title,
          type: "line" as const,
          color: SERIES[i % 2],
          symbol: i % 2 === 0 ? "circle" : "triangle", // non-colour series cue
          symbolSize: 8,
          lineStyle: { width: 2 },
          endLabel: { show: true, formatter: "{a}", color: INK.secondary, fontSize: 10 },
          data,
        };
      }),
    }),
    [assignments, timeline, timelineDates]
  );

  function resetFilters() {
    setEnergySource("");
    setCriterion("");
    setSearch("");
    setSelectedQuestion(null);
  }

  return (
    <div className="mt-6 space-y-6">
      <FilterRow>
        <label className="text-xs text-gray-600">
          <span className="mb-0.5 block">Assignment</span>
          <select
            value={assignmentId}
            onChange={(e) => {
              setAssignmentId(e.target.value);
              resetFilters();
            }}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </label>
        <FilterSelect
          label="Energy source"
          value={energySource}
          onChange={setEnergySource}
          options={sources}
          allLabel="All energy sources"
        />
        <FilterSelect
          label="Criterion"
          value={criterion}
          onChange={setCriterion}
          options={criteria}
          allLabel="All criteria"
        />
        <FilterSearch
          label="Search questions"
          value={search}
          onChange={setSearch}
          placeholder="Code, source, criterion…"
        />
        <ResetFiltersButton onReset={resetFilters} disabled={!filtersActive} />
      </FilterRow>

      <ChartCard
        title="Response distribution (17.1)"
        description={`Share of final answers per question — ${BINARY_LABELS.zero} vs ${BINARY_LABELS.one}. Click a bar to inspect that question.`}
        option={distributionOption}
        height={Math.min(640, Math.max(260, filtered.length * 18 + 90))}
        exportName="response-distribution"
        onChartClick={(p) => {
          const q = filtered[p.dataIndex ?? -1];
          setSelectedQuestion(q ? q.question_id : null);
        }}
        table={{
          columns: ["Question", "Energy source", "Criterion", "Answered", BINARY_LABELS.zero, BINARY_LABELS.one, `% ${BINARY_LABELS.one}`, "Consensus", "Entropy"],
          rows: filtered.map((q) => [
            q.external_question_code,
            q.energy_source,
            q.criterion,
            q.answered,
            q.zeros,
            q.ones,
            formatPct(q.pct_one),
            formatPct(q.consensus),
            q.entropy === null ? null : q.entropy.toFixed(3),
          ]),
        }}
      >
        {selected && (
          <p className="mt-2 rounded bg-blue-50 px-3 py-2 text-xs text-gray-700">
            <strong>{selected.external_question_code}</strong>
            {" — "}
            {[selected.energy_source, selected.criterion].filter(Boolean).join(" · ")}: {selected.answered}{" "}
            answered · {selected.zeros} × {BINARY_LABELS.zero} · {selected.ones} × {BINARY_LABELS.one} ·
            consensus {formatPct(selected.consensus)} · entropy{" "}
            {selected.entropy === null ? "—" : selected.entropy.toFixed(3)}
            <button
              type="button"
              onClick={() => setSelectedQuestion(null)}
              className="ml-2 underline"
            >
              clear
            </button>
          </p>
        )}
      </ChartCard>

      <ChartCard
        title="Response heatmap (17.6)"
        description={`% choosing ${BINARY_LABELS.one} by energy source × criterion for this assignment. Click a cell to filter the page to it.`}
        option={heatmapOption}
        height={Math.max(240, heat.rowKeys.length * 30 + 130)}
        exportName="response-heatmap"
        onChartClick={(p) => {
          const value = p.value as [number, number, number] | undefined;
          if (!value) return;
          setEnergySource(heat.rowKeys[value[1]] ?? "");
          setCriterion(heat.colKeys[value[0]] ?? "");
        }}
        table={{
          columns: ["Energy source", "Criterion", `% ${BINARY_LABELS.one}`],
          rows: heat.cells.map(([r, c, v]) => [
            heat.rowKeys[r] ?? "",
            heat.colKeys[c] ?? "",
            v === null ? null : formatPct(v),
          ]),
        }}
        footnote="Cells show the exact percentage — colour is a redundant channel, not the only one."
      />

      <ChartCard
        title="Consensus ranking (17.11)"
        description="Questions with the strongest / weakest agreement (max of the two answer shares). Consensus describes the spread of opinions — it is not a correctness measure."
        option={consensusOption}
        height={Math.max(220, ranked.length * 22 + 60)}
        exportName="consensus-ranking"
        table={{
          columns: ["Question", "Energy source", "Criterion", "Consensus", "Disagreement", "Entropy"],
          rows: ranked.map((q) => [
            q.external_question_code,
            q.energy_source,
            q.criterion,
            formatPct(q.consensus),
            formatPct(q.disagreement),
            q.entropy === null ? null : q.entropy.toFixed(3),
          ]),
        }}
      >
        <div className="mt-2 flex gap-1.5" role="group" aria-label="Consensus sort order">
          {(["highest", "lowest"] as const).map((order) => (
            <button
              key={order}
              type="button"
              aria-pressed={consensusOrder === order}
              onClick={() => setConsensusOrder(order)}
              className={`rounded px-2.5 py-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
                consensusOrder === order
                  ? "bg-gray-900 text-white"
                  : "border border-gray-300 text-gray-700 hover:bg-gray-50"
              }`}
            >
              {order === "highest" ? "Highest consensus" : "Lowest consensus"}
            </button>
          ))}
        </div>
      </ChartCard>

      <ChartCard
        title="Submission status (17.13)"
        description="Attempt states per assignment for currently enrolled active students."
        option={statusOption}
        height={Math.max(180, progress.length * 64 + 80)}
        exportName="submission-status"
        table={{
          columns: ["Assignment", "Enrolled", "Not started", "Draft", "Submitted", "Reopened", "Resubmitted"],
          rows: progress.map((p) => [
            assignmentTitle(p.assignment_id),
            p.enrolled_students,
            p.not_started_count,
            p.draft_count,
            p.submitted_count,
            p.reopened_count,
            p.resubmitted_count,
          ]),
        }}
        footnote="Counts describe workflow state only. Segment values are printed on the chart."
      />

      <ChartCard
        title="Completion timeline (17.14)"
        description="Cumulative submissions per assignment by day (UTC)."
        option={timelineOption}
        height={300}
        exportName="completion-timeline"
        table={{
          columns: ["Date", "Assignment", "Submissions that day", "Cumulative"],
          rows: timeline.map((t) => [
            t.submission_date,
            assignmentTitle(t.assignment_id),
            t.submissions,
            t.cumulative_submissions,
          ]),
        }}
        footnote="Series are distinguished by symbol shape and an end label as well as colour."
      />
    </div>
  );
}
