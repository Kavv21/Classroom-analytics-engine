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
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

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

  // Active state is driven by aria-pressed in CSS (.btn-toggle), so the
  // visual state and the state announced to a screen reader can't diverge.
  const toggleClass = `btn btn-toggle ${focusRing}`;

  return (
    <section aria-label={title} className="card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="heading">{title}</h3>
          {description && <p className="note-muted mt-0.5">{description}</p>}
        </div>
        <div className="flex shrink-0 gap-1.5" role="group" aria-label={`${title} — view and export`}>
          <button
            type="button"
            aria-pressed={view === "chart"}
            onClick={() => setView("chart")}
            className={toggleClass}
          >
            Chart
          </button>
          <button
            type="button"
            aria-pressed={view === "table"}
            onClick={() => setView("table")}
            className={toggleClass}
          >
            Table
          </button>
          <button type="button" onClick={exportCsv} className={toggleClass}>
            CSV
          </button>
          <button
            type="button"
            onClick={exportPng}
            disabled={view === "table"}
            className={toggleClass}
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
        <div className="mt-3 max-h-96 overflow-auto rounded border border-hairline">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">
              {title}
              {description ? ` — ${description}` : ""}
            </caption>
            <thead className="sticky top-0 bg-surface-sunken">
              <tr>
                {table.columns.map((column) => (
                  <th key={column} scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline tabular-nums">
              {table.rows.length === 0 ? (
                <tr>
                  <td colSpan={table.columns.length} className="px-2 py-3 text-ink-muted">
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

      {footnote && <p className="mt-2 text-xs text-ink-muted">{footnote}</p>}
    </section>
  );
}
