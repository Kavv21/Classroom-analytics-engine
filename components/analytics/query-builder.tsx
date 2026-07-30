"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ChartCard, focusRing } from "@/components/analytics/chart-card";
import { buildChartOption } from "@/lib/query-builder/chart-option";
import {
  CHART_TYPES,
  DATASETS,
  datasetList,
  DIMENSIONS,
  dimensionsFor,
  MEASURES,
  measuresFor,
  type ChartTypeId,
  type DatasetId,
  type DimensionId,
  type MeasureId,
  type QueryDefinition,
} from "@/lib/query-builder/schema";
import { validateQuery } from "@/lib/query-builder/validate";
import {
  createDashboard,
  deleteSavedItem,
  runBuilderQuery,
  saveQuery,
  saveVisualisation,
  type SavedQuerySummary,
  type SavedVisualisationSummary,
  type DashboardSummary,
} from "@/lib/query-builder/actions";
import type { QueryResult } from "@/lib/query-builder/execute";
import { formatPct } from "@/lib/charts/theme";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface QueryBuilderProps {
  classId: string;
  /** Serializable display string, never a function across the boundary. */
  classDisplayName: string;
  initialQuery: QueryDefinition;
  savedQueries: SavedQuerySummary[];
  savedVisualisations: SavedVisualisationSummary[];
  dashboards: DashboardSummary[];
  filterOptions: Record<string, string[]>;
}

function formatCell(value: number | null, format: string): string | number | null {
  if (value === null) return null;
  if (format === "percent") return formatPct(value);
  if (format === "signed") return `${value > 0 ? "+" : ""}${value}`;
  if (format === "decimal") return value.toFixed(3);
  return value;
}

export function QueryBuilder({
  classId,
  classDisplayName,
  initialQuery,
  savedQueries,
  savedVisualisations,
  dashboards,
  filterOptions,
}: QueryBuilderProps) {
  const router = useRouter();
  const [query, setQuery] = useState<QueryDefinition>(initialQuery);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [dashboardName, setDashboardName] = useState("");
  const [selectedVisualisations, setSelectedVisualisations] = useState<string[]>([]);

  const validation = useMemo(() => validateQuery(query), [query]);
  const dataset = DATASETS[query.dataset];
  const measure = MEASURES[query.measure];

  // Re-run whenever the query becomes valid. An invalid query never
  // reaches the server — the professor sees why instead of a broken chart.
  useEffect(() => {
    if (!validation.valid) {
      setResult(null);
      setRunError(null);
      return;
    }
    let cancelled = false;
    setBusy(true);
    runBuilderQuery(classId, query).then((r) => {
      if (cancelled) return;
      setBusy(false);
      if (!r.success) {
        setRunError(r.error);
        setResult(null);
        return;
      }
      setRunError(null);
      setResult(r.data);
    });
    return () => {
      cancelled = true;
    };
  }, [classId, query, validation.valid]);

  /** Changing dataset invalidates measure/dimensions — reset to that
   * dataset's defaults rather than leaving an impossible combination. */
  function changeDataset(next: DatasetId) {
    const spec = DATASETS[next];
    setQuery({
      dataset: next,
      measure: spec.measures[0]!,
      dimensions: spec.dimensions.slice(0, 1),
      filters: [],
      chartType: "BAR",
    });
  }

  function toggleDimension(dimension: DimensionId) {
    setQuery((q) => ({
      ...q,
      dimensions: q.dimensions.includes(dimension)
        ? q.dimensions.filter((d) => d !== dimension)
        : [...q.dimensions, dimension],
    }));
  }

  function resetAll() {
    setQuery(initialQuery);
    setRunError(null);
  }

  async function handleSaveQuery() {
    setBusy(true);
    const r = await saveQuery(classId, saveName, query);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`Saved query “${saveName}”.`);
    setSaveName("");
    router.refresh();
  }

  async function handleSaveVisualisation() {
    setBusy(true);
    const r = await saveVisualisation(classId, saveName, saveDescription, query);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`Saved visualisation “${saveName}”.`);
    setSaveName("");
    setSaveDescription("");
    router.refresh();
  }

  async function handleCreateDashboard() {
    setBusy(true);
    const r = await createDashboard(classId, dashboardName, selectedVisualisations);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    toast.success(`Created dashboard “${dashboardName}”.`);
    setDashboardName("");
    setSelectedVisualisations([]);
    router.refresh();
  }

  async function handleDelete(kind: "query" | "visualisation" | "dashboard", id: string) {
    setBusy(true);
    const r = await deleteSavedItem(classId, kind, id);
    setBusy(false);
    if (!r.success) {
      toast.error(r.error);
      return;
    }
    router.refresh();
  }

  async function exportQuery(format: "csv" | "pdf") {
    setBusy(true);
    try {
      const response = await fetch(`/classes/${classId}/exports/query?format=${format}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, title: saveName || "Analytics report" }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: response.statusText }));
        toast.error(`Export failed: ${payload.error ?? response.statusText}`);
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "pdf" ? "analytics-report.pdf" : "query-export.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }


  const tableRows = result
    ? result.rows.map((r) => [...r.keys, formatCell(r.value, measure.format)])
    : [];

  // Presentational-only summary of what's currently applied — read from
  // state already held for the query itself, no new data fetch.
  const filterSummary =
    query.filters.length === 0
      ? "No filters applied"
      : query.filters.map((f) => `${DIMENSIONS[f.dimension].label}: ${f.value}`).join(" · ");

  return (
    <div className="mt-6 space-y-6">
      <Card aria-label="Query definition"><CardContent className="pt-6">
        <p className="eyebrow mb-1">{classDisplayName}</p>
        <h2 className="title-sm">Build a query</h2>
        <p className="mt-0.5 text-xs text-ink-secondary">{dataset.description}</p>

        <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="grid gap-1.5">
            <Label htmlFor="qb-dataset">Dataset</Label>
            <Select value={query.dataset} onValueChange={(v) => changeDataset(v as DatasetId)}>
              <SelectTrigger id="qb-dataset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {datasetList().map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="qb-measure">Measure</Label>
            <Select
              value={query.measure}
              onValueChange={(v) => setQuery({ ...query, measure: v as MeasureId })}
            >
              <SelectTrigger id="qb-measure">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {measuresFor(query.dataset).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="qb-charttype">Chart type</Label>
            <Select
              value={query.chartType}
              onValueChange={(v) => setQuery({ ...query, chartType: v as ChartTypeId })}
            >
              <SelectTrigger id="qb-charttype">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.values(CHART_TYPES).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <Label>Actions</Label>
            <div className="flex gap-1.5">
              <Button size="sm" variant="outline" onClick={resetAll}>
                Reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportQuery("csv")}
                disabled={!validation.valid || busy}
              >
                CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => exportQuery("pdf")}
                disabled={!validation.valid || busy}
              >
                PDF
              </Button>
            </div>
            <p className="eyebrow mt-1">
              {classDisplayName} · {filterSummary}
            </p>
          </div>
        </div>

        <fieldset className="mt-3">
          <legend className="text-xs text-ink-secondary">Group by</legend>
          <div className="mt-1 flex flex-wrap gap-2">
            {dimensionsFor(query.dataset).map((d) => (
              <label
                key={d.id}
                className="flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs"
              >
                <Checkbox
                  checked={query.dimensions.includes(d.id)}
                  onCheckedChange={() => toggleDimension(d.id)}
                />
                {d.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="mt-3">
          <legend className="text-xs text-ink-secondary">Filters</legend>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            {dataset.dimensions
              .filter((d) => (filterOptions[d] ?? []).length > 0)
              .map((d) => {
                const current = query.filters.find((f) => f.dimension === d)?.value ?? "";
                return (
                  <label key={d} className="text-xs text-ink-secondary">
                    <span className="mb-0.5 block">{DIMENSIONS[d].label}</span>
                    <Select
                      value={current || "__all__"}
                      onValueChange={(value) => {
                        setQuery((q) => ({
                          ...q,
                          filters:
                            value === "__all__"
                              ? q.filters.filter((f) => f.dimension !== d)
                              : [...q.filters.filter((f) => f.dimension !== d), { dimension: d, value }],
                        }));
                      }}
                    >
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__all__">All</SelectItem>
                        {(filterOptions[d] ?? []).map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                );
              })}
            {query.filters.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setQuery({ ...query, filters: [] })}>
                Clear filters
              </Button>
            )}
          </div>
        </fieldset>

        {!validation.valid && (
          <Alert className="mt-3">
            <AlertTitle>This combination can&rsquo;t be charted</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-0.5 pl-5">
                {validation.issues.map((issue, i) => (
                  <li key={i}>{issue.message}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {runError && (
          <p role="alert" className="mt-3 text-sm text-[color:var(--status-critical-text)]">
            {runError}
          </p>
        )}
      </CardContent></Card>

      {validation.valid && result && (
        <ChartCard
          eyebrow="Query preview"
          title={`${measure.label} by ${query.dimensions.map((d) => DIMENSIONS[d].label).join(" and ") || "total"}`}
          description={`${dataset.label} · ${result.rowCount} row${result.rowCount === 1 ? "" : "s"} · source view: ${result.sources.join(", ")}`}
          option={buildChartOption(query, result)}
          height={Math.min(560, Math.max(240, result.rows.length * 24 + 100))}
          exportName="builder-query"
          table={{ columns: result.columns, rows: tableRows }}
          footnote={measure.definition}
        />
      )}

      <Card aria-label="Save and load"><CardContent className="pt-6">
        <h2 className="title-sm">Save</h2>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="qb-savename">Name</Label>
            <Input
              id="qb-savename"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="e.g. Change rate by energy source"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="qb-savedesc">Description (optional)</Label>
            <Input
              id="qb-savedesc"
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
            />
          </div>
          <Button
            variant="outline"
            onClick={handleSaveQuery}
            disabled={busy || !validation.valid || saveName.trim() === ""}
          >
            Save query
          </Button>
          <Button
            onClick={handleSaveVisualisation}
            disabled={busy || !validation.valid || saveName.trim() === ""}
          >
            Save visualisation
          </Button>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="title-sm">Saved queries ({savedQueries.length})</h3>
            <ul className="mt-1 space-y-1">
              {savedQueries.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setQuery(q.definition)}
                    className={`link text-left ${focusRing}`}
                  >
                    {q.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete("query", q.id)}
                    className={`text-[color:var(--status-critical-text)] hover:underline ${focusRing}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
              {savedQueries.length === 0 && <li className="text-xs text-ink-muted">None yet.</li>}
            </ul>
          </div>

          <div>
            <h3 className="title-sm">
              Saved visualisations ({savedVisualisations.length})
            </h3>
            <ul className="mt-1 space-y-1">
              {savedVisualisations.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    <Checkbox
                      checked={selectedVisualisations.includes(v.id)}
                      onCheckedChange={() =>
                        setSelectedVisualisations((prev) =>
                          prev.includes(v.id) ? prev.filter((x) => x !== v.id) : [...prev, v.id]
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() => setQuery(v.definition)}
                      className={`link text-left ${focusRing}`}
                    >
                      {v.name}
                    </button>
                    <span className="text-ink-muted">({CHART_TYPES[v.chartType]?.label ?? v.chartType})</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => handleDelete("visualisation", v.id)}
                    className={`text-[color:var(--status-critical-text)] hover:underline ${focusRing}`}
                  >
                    Delete
                  </button>
                </li>
              ))}
              {savedVisualisations.length === 0 && (
                <li className="text-xs text-ink-muted">None yet.</li>
              )}
            </ul>
          </div>
        </div>

        <div className="mt-4">
          <h3 className="title-sm">Dashboards ({dashboards.length})</h3>
          <div className="mt-1 flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="qb-dashname">New dashboard name</Label>
              <Input
                id="qb-dashname"
                value={dashboardName}
                onChange={(e) => setDashboardName(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              onClick={handleCreateDashboard}
              disabled={busy || dashboardName.trim() === ""}
            >
              Create from {selectedVisualisations.length} selected
            </Button>
          </div>
          <ul className="mt-2 space-y-1">
            {dashboards.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                <span>
                  {d.name} — {d.itemCount} item{d.itemCount === 1 ? "" : "s"}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete("dashboard", d.id)}
                  className={`text-[color:var(--status-critical-text)] hover:underline ${focusRing}`}
                >
                  Delete
                </button>
              </li>
            ))}
            {dashboards.length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
          </ul>
        </div>
      </CardContent></Card>
    </div>
  );
}
