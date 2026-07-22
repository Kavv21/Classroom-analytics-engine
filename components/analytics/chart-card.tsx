"use client";

import { useRef, useState } from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { csvEscape } from "@/lib/mappings/export";

/**
 * The shared frame around every Phase 8 chart. Guarantees, uniformly:
 *  - hover tooltips (from the ECharts option itself);
 *  - an ACCESSIBLE DATA TABLE twin — real <table> markup carrying every
 *    value the canvas shows (the canvas is aria-hidden; the table is the
 *    screen-reader/keyboard path and the WCAG-clean equivalent);
 *  - CSV export of the table data and PNG export of the canvas;
 *  - keyboard-reachable controls with visible focus rings.
 * Copy stays neutral — descriptive statistics, never grading language.
 */

export interface ChartTable {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

interface ChartCardProps {
  title: string;
  description?: string;
  height?: number;
  option: EChartsOption;
  table: ChartTable;
  exportName: string;
  /** ECharts click handler — used for click-to-filter / drill-down. */
  onChartClick?: (params: { seriesName?: string; name?: string; value?: unknown; dataIndex?: number; seriesIndex?: number }) => void;
  footnote?: string;
  children?: React.ReactNode;
}

function cellText(value: string | number | null): string {
  if (value === null) return "—";
  return String(value);
}

export const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700";

export function ChartCard({
  title,
  description,
  height = 320,
  option,
  table,
  exportName,
  onChartClick,
  footnote,
  children,
}: ChartCardProps) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const chartRef = useRef<ReactECharts | null>(null);

  function exportCsv() {
    const lines = [table.columns.map(csvEscape).join(",")];
    for (const row of table.rows) {
      lines.push(row.map((c) => csvEscape(cellText(c))).join(","));
    }
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportPng() {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const url = instance.getDataURL({ pixelRatio: 2, backgroundColor: "#fcfcfb" });
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName}.png`;
    a.click();
  }

  const toggleClass = (active: boolean) =>
    `rounded px-2.5 py-1 text-xs font-medium ${focusRing} ${
      active ? "bg-gray-900 text-white" : "border border-gray-300 text-gray-700 hover:bg-gray-50"
    }`;

  return (
    <section aria-label={title} className="rounded border border-gray-200 bg-[#fcfcfb] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          {description && <p className="mt-0.5 text-xs text-gray-600">{description}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5" role="group" aria-label={`${title} — view and export`}>
          <button
            type="button"
            aria-pressed={view === "chart"}
            onClick={() => setView("chart")}
            className={toggleClass(view === "chart")}
          >
            Chart
          </button>
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
            className={toggleClass(view === "table")}
          >
            Table
          </button>
          <button type="button" onClick={exportCsv} className={toggleClass(false)}>
            CSV
          </button>
          <button
            type="button"
            onClick={exportPng}
            disabled={view === "table"}
            className={`${toggleClass(false)} disabled:opacity-50`}
          >
            PNG
          </button>
        </div>
      </div>

      {children}

      {view === "chart" ? (
        <div aria-hidden="true">
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height }}
            notMerge
            onEvents={onChartClick ? { click: onChartClick } : undefined}
          />
        </div>
      ) : (
        <div className="mt-3 max-h-96 overflow-auto rounded border border-gray-200">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              {title}
              {description ? ` — ${description}` : ""}
            </caption>
            <thead className="sticky top-0 bg-gray-50">
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="px-2 py-1.5 font-medium text-gray-600">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 tabular-nums">
              {table.rows.length === 0 ? (
                <tr>
                  <td colSpan={table.columns.length} className="px-2 py-3 text-gray-500">
                    No data for the current filters.
                  </td>
                </tr>
              ) : (
                table.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="px-2 py-1.5">
                        {cellText(cell)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {footnote && <p className="mt-2 text-xs text-gray-500">{footnote}</p>}
    </section>
  );
}
