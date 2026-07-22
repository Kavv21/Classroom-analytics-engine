"use client";

import { useMemo } from "react";
import type { EChartsOption } from "echarts";
import { ChartCard } from "@/components/analytics/chart-card";
import {
  BINARY_LABELS,
  transitionMatrixCells,
  TRANSITION_STATE_LABELS,
} from "@/lib/analytics/chart-data";
import type { TransitionState } from "@/lib/types/domain";
import {
  baseChrome,
  categoryAxis,
  formatPct,
  INK,
  labelFormatter,
  tooltipFormatter,
  TRANSITION_COLORS,
} from "@/lib/charts/theme";

interface TransitionMatrixCardProps {
  title: string;
  description: string;
  counts: { s00: number; s01: number; s10: number; s11: number; valid_paired: number };
  /** Extra context rows appended to the accessible table. */
  qualityRows?: Array<[string, number]>;
  selectedState?: TransitionState | null;
  onSelectState?: (state: TransitionState) => void;
  children?: React.ReactNode;
}

const AXIS_VALUES = [BINARY_LABELS.zero, BINARY_LABELS.one];

/** 17.3 — the 2×2 transition matrix. Rows = Assignment 1 answer, columns =
 * Assignment 2 answer. Each cell keeps its fixed state colour and prints
 * count + share, so colour is never the only channel. */
export function TransitionMatrixCard({
  title,
  description,
  counts,
  qualityRows = [],
  selectedState,
  onSelectState,
  children,
}: TransitionMatrixCardProps) {
  const cells = useMemo(() => transitionMatrixCells(counts), [counts]);

  const option: EChartsOption = useMemo(
    () => ({
      ...baseChrome(),
      grid: { left: 8, right: 24, top: 32, bottom: 8, containLabel: true },
      xAxis: categoryAxis({
        data: AXIS_VALUES,
        position: "top",
        name: "Assignment 2 answer",
        nameLocation: "middle",
        nameGap: 34,
        nameTextStyle: { color: INK.secondary },
      }),
      yAxis: categoryAxis({
        data: AXIS_VALUES,
        inverse: true,
        name: "Assignment 1 answer",
        nameLocation: "middle",
        nameGap: 72,
        nameTextStyle: { color: INK.secondary },
      }),
      series: [
        {
          type: "heatmap",
          data: cells.map((cell) => ({
            value: [cell.a2, cell.a1, cell.count],
            itemStyle: {
              color: TRANSITION_COLORS[cell.state],
              opacity: selectedState && selectedState !== cell.state ? 0.35 : 1,
              borderColor: INK.surface,
              borderWidth: 3,
            },
          })),
          label: {
            show: true,
            color: "#ffffff",
            fontSize: 13,
            formatter: labelFormatter((p) => {
              const cell = cells[p.dataIndex]!;
              return `${TRANSITION_STATE_LABELS[cell.state]}\n${cell.count} (${formatPct(cell.pctOfValid, 0)})`;
            }),
          },
          emphasis: { itemStyle: { opacity: 0.85 } },
        },
      ],
      tooltip: {
        ...baseChrome().tooltip,
        formatter: tooltipFormatter((p) => {
          const cell = cells[p.dataIndex]!;
          return `${TRANSITION_STATE_LABELS[cell.state]}<br/><b>${cell.count}</b> students (${formatPct(cell.pctOfValid)})`;
        }),
      },
    }),
    [cells, selectedState]
  );

  return (
    <ChartCard
      title={title}
      description={description}
      option={option}
      height={260}
      exportName="transition-matrix"
      onChartClick={(p) => {
        const cell = cells[p.dataIndex ?? -1];
        if (cell && onSelectState) onSelectState(cell.state);
      }}
      table={{
        columns: ["Transition", "Students", "% of valid pairs"],
        rows: [
          ...cells.map((cell) => [
            TRANSITION_STATE_LABELS[cell.state],
            cell.count,
            formatPct(cell.pctOfValid),
          ]),
          ["Valid pairs total", counts.valid_paired, "100%"],
          ...qualityRows.map(([label, count]) => [label, count, "—"] as Array<string | number>),
        ],
      }}
      footnote={
        onSelectState
          ? "Click a cell to list the students in that transition. Missing / not-comparable pairs are listed in the table view — they are never counted as transitions."
          : "Missing / not-comparable pairs are listed in the table view — they are never counted as transitions."
      }
    >
      {children}
    </ChartCard>
  );
}
