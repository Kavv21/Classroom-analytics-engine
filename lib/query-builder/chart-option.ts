import type { EChartsOption } from "echarts";
import {
  baseChrome,
  categoryAxis,
  formatPct,
  INK,
  labelFormatter,
  percentAxis,
  SEQUENTIAL_BLUE,
  SERIES,
  valueAxis,
} from "@/lib/charts/theme";
import { MEASURES, type ChartTypeId, type QueryDefinition } from "@/lib/query-builder/schema";
import type { QueryResult } from "@/lib/query-builder/execute";

/**
 * Turns a builder result into an ECharts option using the SAME theme,
 * formatters, and mark specs as the Phase 8 charts — there is one
 * charting path in this app, not two. The builder's ChartCard supplies
 * the tooltip/table/export frame around whatever this returns.
 */

function formatValue(value: number | null, measureFormat: string): string {
  if (value === null) return "—";
  switch (measureFormat) {
    case "percent":
      return formatPct(value);
    case "signed":
      return `${value > 0 ? "+" : ""}${value}`;
    case "decimal":
      return value.toFixed(3);
    default:
      return String(value);
  }
}

export function buildChartOption(
  query: QueryDefinition,
  result: QueryResult
): EChartsOption {
  const measure = MEASURES[query.measure];
  const isPercent = measure.format === "percent";
  const chrome = baseChrome();

  const primaryKeys = [...new Set(result.rows.map((r) => r.keys[0] ?? "—"))];
  const secondaryKeys =
    query.dimensions.length > 1
      ? [...new Set(result.rows.map((r) => r.keys[1] ?? "—"))]
      : [];

  const valueAt = (primary: string, secondary?: string) =>
    result.rows.find(
      (r) => (r.keys[0] ?? "—") === primary && (secondary === undefined || (r.keys[1] ?? "—") === secondary)
    )?.value ?? null;

  const axisForMeasure = () => (isPercent ? percentAxis() : valueAxis());

  switch (query.chartType as ChartTypeId) {
    case "BAR":
      return {
        ...chrome,
        tooltip: { ...chrome.tooltip, trigger: "item" },
        grid: { left: 8, right: 56, top: 16, bottom: 8, containLabel: true },
        xAxis: axisForMeasure(),
        yAxis: categoryAxis({ data: primaryKeys, inverse: true }),
        series: [
          {
            name: measure.label,
            type: "bar",
            color: SERIES[0],
            barMaxWidth: 16,
            data: primaryKeys.map((k) => valueAt(k)),
            label: {
              show: true,
              position: "right",
              color: INK.secondary,
              fontSize: 10,
              formatter: labelFormatter((p) => formatValue(p.value, measure.format)),
            },
          },
        ],
      };

    case "STACKED_BAR":
      return {
        ...chrome,
        tooltip: { ...chrome.tooltip, trigger: "axis" },
        legend: { top: 0, textStyle: { color: INK.secondary, fontSize: 10 } },
        grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
        xAxis: axisForMeasure(),
        yAxis: categoryAxis({ data: primaryKeys, inverse: true }),
        series: secondaryKeys.map((secondary, i) => ({
          name: secondary,
          type: "bar" as const,
          stack: "builder",
          color: SERIES[i % SERIES.length],
          barMaxWidth: 16,
          itemStyle: { borderColor: INK.surface, borderWidth: 1 },
          data: primaryKeys.map((k) => valueAt(k, secondary)),
        })),
      };

    case "LINE":
      return {
        ...chrome,
        tooltip: { ...chrome.tooltip, trigger: "axis" },
        legend:
          secondaryKeys.length > 0
            ? { top: 0, textStyle: { color: INK.secondary, fontSize: 10 } }
            : undefined,
        grid: { left: 8, right: 24, top: 36, bottom: 8, containLabel: true },
        xAxis: categoryAxis({ data: primaryKeys }),
        yAxis: axisForMeasure(),
        series:
          secondaryKeys.length > 0
            ? secondaryKeys.map((secondary, i) => ({
                name: secondary,
                type: "line" as const,
                color: SERIES[i % SERIES.length],
                symbol: i % 2 === 0 ? "circle" : "triangle",
                symbolSize: 8,
                lineStyle: { width: 2 },
                data: primaryKeys.map((k) => valueAt(k, secondary)),
              }))
            : [
                {
                  name: measure.label,
                  type: "line" as const,
                  color: SERIES[0],
                  symbol: "circle",
                  symbolSize: 8,
                  lineStyle: { width: 2 },
                  data: primaryKeys.map((k) => valueAt(k)),
                },
              ],
      };

    case "HEATMAP": {
      const values = result.rows
        .map((r) => r.value)
        .filter((v): v is number => v !== null);
      return {
        ...chrome,
        grid: { left: 8, right: 24, top: 16, bottom: 72, containLabel: true },
        xAxis: categoryAxis({
          data: secondaryKeys,
          axisLabel: { color: INK.muted, rotate: 30, fontSize: 10, width: 110, overflow: "truncate" },
        }),
        yAxis: categoryAxis({ data: primaryKeys, inverse: true }),
        visualMap: {
          min: values.length > 0 ? Math.min(...values) : 0,
          max: values.length > 0 ? Math.max(...values) : 1,
          inRange: { color: [...SEQUENTIAL_BLUE] },
          orient: "horizontal",
          left: "center",
          bottom: 0,
          textStyle: { color: INK.secondary, fontSize: 10 },
        },
        series: [
          {
            type: "heatmap",
            data: result.rows
              .filter((r) => r.value !== null)
              .map((r) => [
                secondaryKeys.indexOf(r.keys[1] ?? "—"),
                primaryKeys.indexOf(r.keys[0] ?? "—"),
                r.value as number,
              ]),
            label: {
              show: true,
              fontSize: 9,
              color: INK.primary,
              formatter: labelFormatter<[number, number, number]>((p) =>
                formatValue(p.value[2], measure.format)
              ),
            },
            itemStyle: { borderColor: INK.surface, borderWidth: 2 },
          },
        ],
      };
    }

    case "TABLE":
    default:
      // The table view in ChartCard already carries every value; the
      // canvas stays intentionally empty rather than inventing a chart.
      return { ...chrome, series: [] };
  }
}
