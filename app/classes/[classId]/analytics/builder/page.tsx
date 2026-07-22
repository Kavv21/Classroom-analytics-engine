import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { QueryBuilder } from "@/components/analytics/query-builder";
import { requireProfessorClassPage } from "@/lib/analytics/page-data";
import { DEFAULT_QUERY, type QueryDefinition } from "@/lib/query-builder/schema";
import type {
  DashboardSummary,
  SavedQuerySummary,
  SavedVisualisationSummary,
} from "@/lib/query-builder/actions";
import {
  getMappingTransitionSummaries,
  getQuestionResponseSummaries,
} from "@/lib/analytics/queries";
import { getClassAssignments } from "@/lib/analytics/page-data";

/**
 * Visualisation Builder (Phase 9). Everything the professor can select is
 * derived from the same Phase 7 views the rest of analytics reads, so a
 * built query can never reach data the dashboards couldn't — including
 * unapproved mappings, which are structurally absent from those views.
 */
export default async function VisualisationBuilderPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const assignments = await getClassAssignments(supabase, classId);
  const a1 = assignments.find((a) => a.sequence_number === 1);

  const [savedQueriesResult, savedVisualisationsResult, dashboardsResult] = await Promise.all([
    supabase
      .from("saved_queries")
      .select("id, name, definition, updated_at")
      .eq("class_id", classId)
      .order("updated_at", { ascending: false })
      .returns<
        Array<{ id: string; name: string; definition: QueryDefinition; updated_at: string }>
      >(),
    supabase
      .from("saved_visualisations")
      .select("id, name, description, chart_type, query_definition, updated_at")
      .eq("class_id", classId)
      .order("updated_at", { ascending: false })
      .returns<
        Array<{
          id: string;
          name: string;
          description: string | null;
          chart_type: string;
          query_definition: QueryDefinition;
          updated_at: string;
        }>
      >(),
    supabase
      .from("dashboards")
      .select("id, name, updated_at, dashboard_items(id)")
      .eq("class_id", classId)
      .order("updated_at", { ascending: false })
      .returns<
        Array<{ id: string; name: string; updated_at: string; dashboard_items: Array<{ id: string }> }>
      >(),
  ]);

  // Never swallow a load error — a silently empty "Saved queries" list
  // would read as "you have none" rather than "this page is broken".
  for (const [label, result] of [
    ["saved queries", savedQueriesResult],
    ["saved visualisations", savedVisualisationsResult],
    ["dashboards", dashboardsResult],
  ] as const) {
    if (result.error) {
      throw new Error(`Could not load ${label}: ${result.error.message}`);
    }
  }

  const savedQueries: SavedQuerySummary[] = (savedQueriesResult.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    definition: r.definition,
    updatedAt: r.updated_at,
  }));
  const savedVisualisations: SavedVisualisationSummary[] = (
    savedVisualisationsResult.data ?? []
  ).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    chartType: r.query_definition?.chartType ?? (r.chart_type as QueryDefinition["chartType"]),
    definition: r.query_definition,
    updatedAt: r.updated_at,
  }));
  const dashboards: DashboardSummary[] = (dashboardsResult.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    itemCount: r.dashboard_items?.length ?? 0,
    updatedAt: r.updated_at,
  }));

  // Filter option lists, from the same views the builder queries.
  const [mappingSummaries, a1Questions] = await Promise.all([
    getMappingTransitionSummaries(supabase, classId),
    a1 ? getQuestionResponseSummaries(supabase, a1.id) : Promise.resolve([]),
  ]);

  const distinct = (values: Array<string | null>) =>
    [...new Set(values.filter((v): v is string => !!v))].sort();

  const filterOptions: Record<string, string[]> = {
    ENERGY_SOURCE: distinct([
      ...mappingSummaries.map((m) => m.energy_source),
      ...a1Questions.map((q) => q.energy_source),
    ]),
    CRITERION: distinct([
      ...mappingSummaries.map((m) => m.criterion),
      ...a1Questions.map((q) => q.criterion),
    ]),
    CONCEPT: distinct(a1Questions.map((q) => q.concept)),
    MAPPING: distinct(mappingSummaries.map((m) => m.mapping_name)),
  };

  return (
    <main className="page-dense">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="title-md">Visualisation builder — {classRow.name}</h1>
          <p className="mt-1 text-sm text-ink-secondary">
            Compose your own view of the class data, preview it, save it, and
            export it. Every figure here is a descriptive statistic about
            opinions — never a grade or a correctness judgement.
          </p>
        </div>
        <div className="flex gap-2">
          <a
            href={`/classes/${classId}/exports/workbook`}
            className="btn btn-sm btn-primary"
          >
            Export full workbook (Excel)
          </a>
          <Link
            href={`/classes/${classId}`}
            className="btn btn-secondary"
          >
            Back to class
          </Link>
        </div>
      </div>

      <AnalyticsNav classId={classId} active="builder" />

      <QueryBuilder
        classId={classId}
        initialQuery={DEFAULT_QUERY}
        savedQueries={savedQueries}
        savedVisualisations={savedVisualisations}
        dashboards={dashboards}
        filterOptions={filterOptions}
      />
    </main>
  );
}
