import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { requireProfessorClassPage } from "@/lib/analytics/page-data";

/**
 * Visualisation Builder — scaffold only (Phase 8). The full builder
 * (saved queries, custom visualisations, dashboards over the
 * saved_queries / saved_visualisations / dashboards tables) is Phase 9's
 * job; this page reserves the route and explains what will live here so
 * the dashboard navigation is complete.
 */
export default async function VisualisationBuilderPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Visualisation builder — {classRow.name}</h1>
        <Link
          href={`/classes/${classId}`}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Back to class
        </Link>
      </div>

      <AnalyticsNav classId={classId} active="builder" />

      <div className="mt-6 rounded border border-dashed border-gray-300 bg-gray-50 p-6">
        <h2 className="font-semibold text-gray-900">Coming in Phase 9</h2>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          The visualisation builder will let you compose your own charts from
          the analytics views — pick a metric, a level (class, assignment,
          question, student, energy source, criterion), filters, and a chart
          type — then save queries and visualisations and arrange them into
          dashboards.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-gray-600">
          Until then, the built-in chart pages cover every required chart
          type:{" "}
          <Link href={`/classes/${classId}/analytics/assignments`} className="text-blue-600 underline">
            assignment analytics
          </Link>
          ,{" "}
          <Link href={`/classes/${classId}/analytics/transitions`} className="text-blue-600 underline">
            transition analytics
          </Link>{" "}
          and{" "}
          <Link href={`/classes/${classId}/analytics/students`} className="text-blue-600 underline">
            student analytics
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
