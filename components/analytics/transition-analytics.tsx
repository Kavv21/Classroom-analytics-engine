"use client";

import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import { ChartCard } from "@/components/analytics/chart-card";
import {
  FilterRow,
  FilterSelect,
  ResetFiltersButton,
} from "@/components/analytics/filter-row";
import { TransitionMatrixCard } from "@/components/analytics/transition-matrix-card";
import { TransitionDrilldown } from "@/components/analytics/transition-drilldown";
import {
  beforeAfterPoint,
  BINARY_LABELS,
  NO_CRITERION,
  NO_SOURCE,
  QUALITY_KEYS,
  QUALITY_LABELS,
  sumTransitionCounts,
  TRANSITION_STATE_LABELS,
  TRANSITION_STATES,
} from "@/lib/analytics/chart-data";
import { alluvialFromTransitionCounts } from "@/lib/analytics/exploratory";
import type {
  MappingTransitionSummary,
  ResponseTransitionLiveRow,
} from "@/lib/analytics/queries";
import { changeRate } from "@/lib/types/domain";
import {
  baseChrome,
  categoryAxis,
  DIVERGING,
  formatPct,
  INK,
  labelFormatter,
  percentAxis,
  QUALITY_COLORS,
  scaleFormatter,
  SEQUENTIAL_BLUE,
  SERIES,
  seriesValueFormatter,
  TRANSITION_COLORS,
} from "@/lib/charts/theme";

interface TransitionAnalyticsProps {
  classId: string;
  mappingSummaries: MappingTransitionSummary[];
  liveRows: ResponseTransitionLiveRow[];
  studentNames: Record<string, string>;
}

const SANKEY_NODE_COLORS: Record<string, string> = {
  "a1:0": SERIES[1],
  "a1:1": SERIES[0],
  "a1:missing": QUALITY_COLORS.MISSING_BOTH,
  "a2:0": SERIES[1],
  "a2:1": SERIES[0],
  "a2:missing": QUALITY_COLORS.MISSING_BOTH,
};

export function TransitionAnalytics({
  classId,
  mappingSummaries,
  liveRows,
  studentNames,
}: TransitionAnalyticsProps) {
  const [energySource, setEnergySource] = useState("");
  const [criterion, setCriterion] = useState("");
  const [mappingType, setMappingType] = useState("");
  const [selectedMappingId, setSelectedMappingId] = useState("");
  const [matrixState, setMatrixState] = useState<"S00" | "S01" | "S10" | "S11" | null>(null);

  const sources = useMemo(
    () => [...new Set(mappingSummaries.map((m) => m.energy_source ?? NO_SOURCE))].sort(),
    [mappingSummaries]
  );
  const criteria = useMemo(
    () => [...new Set(mappingSummaries.map((m) => m.criterion ?? NO_CRITERION))].sort(),
    [mappingSummaries]
  );
  const types = useMemo(
    () => [...new Set(mappingSummaries.map((m) => m.mapping_type))].sort(),
    [mappingSummaries]
  );

  const filtered = useMemo(
    () =>
      mappingSummaries
        .filter((m) => (energySource ? (m.energy_source ?? NO_SOURCE) === energySource : true))
        .filter((m) => (criterion ? (m.criterion ?? NO_CRITERION) === criterion : true))
        .filter((m) => (mappingType ? m.mapping_type === mappingType : true))
        .sort((a, b) => a.mapping_name.localeCompare(b.mapping_name)),
    [mappingSummaries, energySource, criterion, mappingType]
  );

  const filtersActive = energySource !== "" || criterion !== "" || mappingType !== "";
  const totals = useMemo(() => sumTransitionCounts(filtered), [filtered]);
  const comparable = useMemo(() => filtered.filter((m) => m.valid_paired > 0), [filtered]);
  const notComparableMappings = filtered.length - comparable.length;

  const selectedMapping =
    filtered.find((m) => m.mapping_id === selectedMappingId) ?? null;
  const matrixSource = selectedMapping ?? { ...totals, mapping_name: "all filtered mappings" };

  const matrixStudents = useMemo(() => {
    if (!matrixState) return [];
    const scope = selectedMapping
      ? liveRows.filter((r) => r.mapping_id === selectedMapping.mapping_id)
      : liveRows.filter((r) => filtered.some((m) => m.mapping_id === r.mapping_id));
    return scope
      .filter((r) => r.transition_state === matrixState)
      .map((r) => ({
        name: studentNames[r.student_id] ?? `Student ${r.student_id.slice(0, 8)}`,
        mapping: r.mapping_name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matrixState, selectedMapping, liveRows, filtered, studentNames]);

  // ---- 17.2 before/after grouped bar ----------------------------------
  const beforeAfter = useMemo(() => comparable.map(beforeAfterPoint), [comparable]);
  const beforeAfterOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      tooltip: {
        ...baseChrome().tooltip,
        trigger: "axis",
        valueFormatter: seriesValueFormatter((v) => formatPct(v)),
      },
      legend: { top: 0, textStyle: { color: INK.secondary } },
      grid: { left: 8, right: 24, top: 32, bottom: 40, containLabel: true },
      dataZoom:
        beforeAfter.length > 16
          ? [{ type: "slider", yAxisIndex: 0, startValue: 0, endValue: 15, width: 16 }]
          : undefined,
      xAxis: percentAxis(),
      yAxis: categoryAxis({ data: beforeAfter.map((b) => b.name), inverse: true }),
      series: [
        {
          name: `Assignment 1 — % ${BINARY_LABELS.one}`,
          type: "bar",
          color: SERIES[0],
          barMaxWidth: 10,
          data: beforeAfter.map((b) => b.pct1A1),
        },
        {
          name: `Assignment 2 — % ${BINARY_LABELS.one}`,
          type: "bar",
          color: SERIES[1],
          barMaxWidth: 10,
          data: beforeAfter.map((b) => b.pct1A2),
        },
      ],
    }),
    [beforeAfter]
  );

  // ---- 17.4 100% stacked transition composition -----------------------
  const stackedOption: EChartsOption = useMemo(() => {
    const stateSeries = TRANSITION_STATES.map((state) => ({
      name: TRANSITION_STATE_LABELS[state],
      type: "bar" as const,
      stack: "composition",
      color: TRANSITION_COLORS[state],
      barMaxWidth: 14,
      itemStyle: { borderColor: INK.surface, borderWidth: 1 },
      data: filtered.map((m) =>
        m.pairs_considered > 0
          ? m[state.toLowerCase() as "s00" | "s01" | "s10" | "s11"] / m.pairs_considered
          : null
      ),
    }));
    const qualitySeries = QUALITY_KEYS.map((key) => ({
      name: QUALITY_LABELS[key],
      type: "bar" as const,
      stack: "composition",
      color: QUALITY_COLORS[key.toUpperCase() as keyof typeof QUALITY_COLORS],
      barMaxWidth: 14,
      itemStyle: { borderColor: INK.surface, borderWidth: 1 },
      data: filtered.map((m) => (m.pairs_considered > 0 ? m[key] / m.pairs_considered : null)),
    }));
    return {
      ...baseChrome(),
      tooltip: {
        ...baseChrome().tooltip,
        trigger: "axis",
        valueFormatter: seriesValueFormatter((v) => formatPct(v)),
      },
      legend: { top: 0, textStyle: { color: INK.secondary, fontSize: 10 } },
      grid: { left: 8, right: 24, top: 48, bottom: 40, containLabel: true },
      dataZoom:
        filtered.length > 14
          ? [{ type: "slider", yAxisIndex: 0, startValue: 0, endValue: 13, width: 16 }]
          : undefined,
      xAxis: percentAxis(),
      yAxis: categoryAxis({ data: filtered.map((m) => m.mapping_name), inverse: true }),
      series: [...stateSeries, ...qualitySeries],
    };
  }, [filtered]);

  // ---- 17.5 Sankey ------------------------------------------------------
  const alluvial = useMemo(
    () =>
      alluvialFromTransitionCounts({
        s00: totals.s00,
        s01: totals.s01,
        s10: totals.s10,
        s11: totals.s11,
        missingA2From0: totals.missing_a2_from_0,
        missingA2From1: totals.missing_a2_from_1,
        missingA1To0: totals.missing_a1_to_0,
        missingA1To1: totals.missing_a1_to_1,
        missingBoth: totals.missing_both,
      }),
    [totals]
  );
  const sankeyOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      series: [
        {
          type: "sankey",
          layoutIterations: 0,
          nodeGap: 16,
          nodeWidth: 12,
          left: 12,
          right: 130,
          top: 12,
          bottom: 12,
          emphasis: { focus: "adjacency" },
          data: alluvial.nodes.map((n) => ({
            name: n.label,
            itemStyle: { color: SANKEY_NODE_COLORS[n.id] ?? INK.muted },
          })),
          links: alluvial.links.map((l) => ({
            source: alluvial.nodes.find((n) => n.id === l.source)!.label,
            target: alluvial.nodes.find((n) => n.id === l.target)!.label,
            value: l.value,
          })),
          label: { color: INK.primary, fontSize: 11 },
          lineStyle: { color: "gradient", opacity: 0.35 },
        },
      ],
      tooltip: { ...baseChrome().tooltip },
    }),
    [alluvial]
  );

  // ---- 17.7 transition heatmap ----------------------------------------
  const heatCols = [
    ...TRANSITION_STATES.map((s) => TRANSITION_STATE_LABELS[s]),
    ...QUALITY_KEYS.map((k) => QUALITY_LABELS[k]),
  ];
  const heatMax = useMemo(
    () =>
      Math.max(
        1,
        ...filtered.flatMap((m) => [
          m.s00, m.s01, m.s10, m.s11, m.missing_a1, m.missing_a2, m.missing_both, m.not_comparable,
        ])
      ),
    [filtered]
  );
  const transitionHeatmapOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 24, top: 8, bottom: 84, containLabel: true },
      xAxis: categoryAxis({
        data: heatCols,
        axisLabel: { color: INK.muted, rotate: 30, fontSize: 10, width: 110, overflow: "truncate" },
      }),
      yAxis: categoryAxis({ data: filtered.map((m) => m.mapping_name), inverse: true }),
      visualMap: {
        min: 0,
        max: heatMax,
        inRange: { color: [...SEQUENTIAL_BLUE] },
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: INK.secondary, fontSize: 10 },
      },
      series: [
        {
          type: "heatmap",
          data: filtered.flatMap((m, row) =>
            [
              m.s00, m.s01, m.s10, m.s11,
              m.missing_a1, m.missing_a2, m.missing_both, m.not_comparable,
            ].map((v, col) => [col, row, v])
          ),
          label: { show: true, fontSize: 9, color: INK.primary },
          itemStyle: { borderColor: INK.surface, borderWidth: 2 },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, heatMax]
  );

  // ---- 17.8 energy source × criterion change-rate heatmap --------------
  const sourceCriterion = useMemo(() => {
    const keys = new Map<string, { s01: number; s10: number; valid: number }>();
    for (const m of mappingSummaries) {
      const key = `${m.energy_source ?? NO_SOURCE}|${m.criterion ?? NO_CRITERION}`;
      const cell = keys.get(key) ?? { s01: 0, s10: 0, valid: 0 };
      cell.s01 += m.s01;
      cell.s10 += m.s10;
      cell.valid += m.valid_paired;
      keys.set(key, cell);
    }
    const rows = [...new Set([...keys.keys()].map((k) => k.split("|")[0]!))].sort();
    const cols = [...new Set([...keys.keys()].map((k) => k.split("|")[1]!))].sort();
    const cells: Array<[number, number, number | null]> = [];
    rows.forEach((r, ri) =>
      cols.forEach((c, ci) => {
        const cell = keys.get(`${r}|${c}`);
        cells.push([
          ci,
          ri,
          cell && cell.valid > 0 ? changeRate(cell.s01, cell.s10, cell.valid) : null,
        ]);
      })
    );
    return { rows, cols, cells };
  }, [mappingSummaries]);

  const sourceCriterionOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 24, top: 8, bottom: 64, containLabel: true },
      xAxis: categoryAxis({
        data: sourceCriterion.cols,
        axisLabel: { color: INK.muted, rotate: 30, fontSize: 10 },
      }),
      yAxis: categoryAxis({ data: sourceCriterion.rows, inverse: true }),
      visualMap: {
        min: 0,
        max: 1,
        inRange: { color: [...SEQUENTIAL_BLUE] },
        orient: "horizontal",
        left: "center",
        bottom: 0,
        textStyle: { color: INK.secondary, fontSize: 10 },
        formatter: scaleFormatter((v) => formatPct(v, 0)),
      },
      series: [
        {
          type: "heatmap",
          data: sourceCriterion.cells.filter(([, , v]) => v !== null),
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
    [sourceCriterion]
  );

  // ---- 17.9 opinion-shift ranking / 17.10 change-rate ranking ----------
  const shiftRanked = useMemo(
    () =>
      [...comparable].sort((a, b) => (b.pct_point_shift ?? 0) - (a.pct_point_shift ?? 0)),
    [comparable]
  );
  const shiftOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 56, top: 8, bottom: 40, containLabel: true },
      dataZoom:
        shiftRanked.length > 16
          ? [{ type: "slider", yAxisIndex: 0, startValue: 0, endValue: 15, width: 16 }]
          : undefined,
      xAxis: percentAxis({
        min: -1,
        max: 1,
        axisLabel: {
          color: INK.muted,
          formatter: (v: number) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}pp`,
        },
      }),
      yAxis: categoryAxis({ data: shiftRanked.map((m) => m.mapping_name), inverse: true }),
      series: [
        {
          name: "Percentage-point shift",
          type: "bar",
          barMaxWidth: 12,
          data: shiftRanked.map((m) => ({
            value: m.pct_point_shift,
            itemStyle: {
              color: (m.pct_point_shift ?? 0) >= 0 ? DIVERGING.toward1 : DIVERGING.toward0,
            },
          })),
          label: {
            show: true,
            position: "right",
            color: INK.secondary,
            fontSize: 10,
            formatter: labelFormatter(
              (p) => `${p.value > 0 ? "+" : ""}${(p.value * 100).toFixed(1)}pp`
            ),
          },
          markLine: {
            silent: true,
            symbol: "none",
            lineStyle: { color: INK.axis, width: 1 },
            data: [{ xAxis: 0 }],
            label: { show: false },
          },
        },
      ],
    }),
    [shiftRanked]
  );

  const changeRanked = useMemo(
    () => [...comparable].sort((a, b) => (b.change_rate ?? 0) - (a.change_rate ?? 0)),
    [comparable]
  );
  const changeRateOption: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 56, top: 8, bottom: 40, containLabel: true },
      dataZoom:
        changeRanked.length > 16
          ? [{ type: "slider", yAxisIndex: 0, startValue: 0, endValue: 15, width: 16 }]
          : undefined,
      xAxis: percentAxis(),
      yAxis: categoryAxis({ data: changeRanked.map((m) => m.mapping_name), inverse: true }),
      series: [
        {
          name: "Change rate",
          type: "bar",
          color: SERIES[0],
          barMaxWidth: 12,
          data: changeRanked.map((m) => m.change_rate),
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
    [changeRanked]
  );

  function resetFilters() {
    setEnergySource("");
    setCriterion("");
    setMappingType("");
    setSelectedMappingId("");
    setMatrixState(null);
  }

  const rankingTable = (rows: MappingTransitionSummary[]) => ({
    columns: [
      "Mapping", "Type", "Valid pairs", "Change rate", "Stability", "Net → 1 — Yes",
      "Shift", QUALITY_LABELS.not_comparable,
    ],
    rows: rows.map((m) => [
      `${m.mapping_name} v${m.mapping_version}`,
      m.mapping_type,
      m.valid_paired,
      formatPct(m.change_rate),
      formatPct(m.stability_rate),
      m.net_movement_toward_1,
      m.pct_point_shift === null ? null : `${m.pct_point_shift > 0 ? "+" : ""}${(m.pct_point_shift * 100).toFixed(1)}pp`,
      m.not_comparable,
    ]),
  });

  return (
    <div className="mt-6 space-y-6">
      <FilterRow>
        <FilterSelect label="Energy source" value={energySource} onChange={setEnergySource} options={sources} allLabel="All energy sources" />
        <FilterSelect label="Criterion" value={criterion} onChange={setCriterion} options={criteria} allLabel="All criteria" />
        <FilterSelect label="Mapping type" value={mappingType} onChange={setMappingType} options={types} allLabel="All types" />
        <ResetFiltersButton onReset={resetFilters} disabled={!filtersActive && !selectedMappingId} />
      </FilterRow>

      {notComparableMappings > 0 && (
        <p className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          {notComparableMappings} of {filtered.length} filtered mapping
          {notComparableMappings === 1 ? "" : "s"} have no valid one-to-one pairs
          (multi-question or explicitly not-comparable). They appear as
          “{QUALITY_LABELS.not_comparable}” in the composition chart, heatmap, and tables —
          never as a zero transition.
        </p>
      )}

      <ChartCard
        title="Before / after (17.2)"
        description={`% of valid pairs choosing ${BINARY_LABELS.one} in each assignment, per approved mapping.`}
        option={beforeAfterOption}
        height={Math.min(560, Math.max(240, beforeAfter.length * 30 + 90))}
        exportName="before-after"
        onChartClick={(p) => {
          const b = beforeAfter[p.dataIndex ?? -1];
          if (b) setSelectedMappingId(b.mappingId);
        }}
        table={{
          columns: ["Mapping", "Valid pairs", `A1 % ${BINARY_LABELS.one}`, `A2 % ${BINARY_LABELS.one}`],
          rows: beforeAfter.map((b) => [
            b.name, b.validPaired, formatPct(b.pct1A1), formatPct(b.pct1A2),
          ]),
        }}
        footnote="Click a mapping to load it into the transition matrix below."
      />

      <TransitionMatrixCard
        title={
          selectedMapping
            ? `Transition matrix (17.3) — ${selectedMapping.mapping_name} v${selectedMapping.mapping_version}`
            : "Transition matrix (17.3) — all filtered mappings"
        }
        description="Rows are the Assignment 1 answer, columns the Assignment 2 answer. Click a cell to list the students behind it."
        counts={matrixSource}
        qualityRows={[
          [QUALITY_LABELS.missing_a1, selectedMapping?.missing_a1 ?? totals.missing_a1],
          [QUALITY_LABELS.missing_a2, selectedMapping?.missing_a2 ?? totals.missing_a2],
          [QUALITY_LABELS.missing_both, selectedMapping?.missing_both ?? totals.missing_both],
          [QUALITY_LABELS.not_comparable, selectedMapping?.not_comparable ?? totals.not_comparable],
        ]}
        selectedState={matrixState}
        onSelectState={(state) => setMatrixState(matrixState === state ? null : state)}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <label className="text-gray-600">
            Mapping:{" "}
            <select
              value={selectedMappingId}
              onChange={(e) => {
                setSelectedMappingId(e.target.value);
                setMatrixState(null);
              }}
              className="rounded border border-gray-300 px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              <option value="">All filtered mappings</option>
              {comparable.map((m) => (
                <option key={m.mapping_id} value={m.mapping_id}>
                  {m.mapping_name} v{m.mapping_version}
                </option>
              ))}
            </select>
          </label>
          {matrixState && (
            <span className="text-gray-600">
              {TRANSITION_STATE_LABELS[matrixState]}: {matrixStudents.length} student
              {matrixStudents.length === 1 ? "" : "s"} —{" "}
              {matrixStudents.slice(0, 12).map((s) => s.name).join(", ")}
              {matrixStudents.length > 12 ? ` and ${matrixStudents.length - 12} more` : ""}
              <button type="button" className="ml-1 underline" onClick={() => setMatrixState(null)}>
                clear
              </button>
            </span>
          )}
        </div>
      </TransitionMatrixCard>

      <ChartCard
        title="Transition composition (17.4)"
        description="Every student pair per mapping — the four transition states plus missing and not-comparable buckets, as shares of all pairs."
        option={stackedOption}
        height={Math.min(560, Math.max(240, filtered.length * 26 + 110))}
        exportName="transition-composition"
        table={{
          columns: [
            "Mapping",
            ...TRANSITION_STATES.map((s) => TRANSITION_STATE_LABELS[s]),
            ...QUALITY_KEYS.map((k) => QUALITY_LABELS[k]),
            "All pairs",
          ],
          rows: filtered.map((m) => [
            `${m.mapping_name} v${m.mapping_version}`,
            m.s00, m.s01, m.s10, m.s11,
            m.missing_a1, m.missing_a2, m.missing_both, m.not_comparable,
            m.pairs_considered,
          ]),
        }}
      />

      <ChartCard
        title="Answer flows (17.5)"
        description={`How answers moved from Assignment 1 to Assignment 2 across the filtered mappings (valid pairs and missing answers).`}
        option={sankeyOption}
        height={320}
        exportName="answer-flows"
        table={{
          columns: ["From", "To", "Students"],
          rows: alluvial.links.map((l) => [
            alluvial.nodes.find((n) => n.id === l.source)!.label,
            alluvial.nodes.find((n) => n.id === l.target)!.label,
            l.value,
          ]),
        }}
        footnote={
          totals.not_comparable > 0
            ? `${totals.not_comparable} not-comparable pairs have no flow to draw and are excluded here — they stay visible in the composition chart and tables.`
            : undefined
        }
      />

      <ChartCard
        title="Transition heatmap (17.7)"
        description="Student counts per mapping across all four transition states and every data-quality bucket."
        option={transitionHeatmapOption}
        height={Math.max(240, filtered.length * 28 + 150)}
        exportName="transition-heatmap"
        table={{
          columns: ["Mapping", ...heatCols],
          rows: filtered.map((m) => [
            `${m.mapping_name} v${m.mapping_version}`,
            m.s00, m.s01, m.s10, m.s11,
            m.missing_a1, m.missing_a2, m.missing_both, m.not_comparable,
          ]),
        }}
      />

      <ChartCard
        title="Energy source × criterion change rate (17.8)"
        description="Change rate pooled over each energy source × criterion group of approved mappings (all mappings, unfiltered)."
        option={sourceCriterionOption}
        height={Math.max(220, sourceCriterion.rows.length * 30 + 120)}
        exportName="source-criterion-change-rate"
        onChartClick={(p) => {
          const value = p.value as [number, number, number] | undefined;
          if (!value) return;
          setEnergySource(sourceCriterion.rows[value[1]] ?? "");
          setCriterion(sourceCriterion.cols[value[0]] ?? "");
        }}
        table={{
          columns: ["Energy source", "Criterion", "Change rate"],
          rows: sourceCriterion.cells.map(([c, r, v]) => [
            sourceCriterion.rows[r] ?? "",
            sourceCriterion.cols[c] ?? "",
            v === null ? null : formatPct(v),
          ]),
        }}
        footnote="Click a cell to filter the page to that group. Groups with no valid pairs show no cell rather than a fabricated 0%."
      />

      <ChartCard
        title="Opinion-shift ranking (17.9)"
        description={`Percentage-point shift per mapping: % choosing ${BINARY_LABELS.one} in Assignment 2 minus Assignment 1, over valid pairs. Blue = toward ${BINARY_LABELS.one}, orange = toward ${BINARY_LABELS.zero} — direction only, neither is better.`}
        option={shiftOption}
        height={Math.min(560, Math.max(220, shiftRanked.length * 26 + 80))}
        exportName="opinion-shift-ranking"
        onChartClick={(p) => {
          const m = shiftRanked[p.dataIndex ?? -1];
          if (m) setSelectedMappingId(m.mapping_id);
        }}
        table={rankingTable(shiftRanked)}
      />

      <ChartCard
        title="Change-rate ranking (17.10)"
        description="Share of valid pairs that changed answer in either direction, per mapping. Change rate and net shift are different metrics — see both columns in the table."
        option={changeRateOption}
        height={Math.min(560, Math.max(220, changeRanked.length * 26 + 80))}
        exportName="change-rate-ranking"
        onChartClick={(p) => {
          const m = changeRanked[p.dataIndex ?? -1];
          if (m) setSelectedMappingId(m.mapping_id);
        }}
        table={rankingTable(changeRanked)}
      />

      <TransitionDrilldown
        classId={classId}
        mappingSummaries={mappingSummaries}
        liveRows={liveRows}
        studentNames={studentNames}
      />
    </div>
  );
}
