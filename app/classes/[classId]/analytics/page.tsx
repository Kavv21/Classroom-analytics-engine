import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getAssignmentResponseSummaries,
  getClassTransitionSummary,
  getEnergySourceTransitionSummaries,
  getMappingTransitionSummaries,
  type TransitionCounts,
} from "@/lib/analytics/queries";

/**
 * Phase 7 analytics — numbers only (real charts land in Phase 8). All
 * figures are descriptive statistics about opinions, never grades or
 * correctness judgements; copy stays neutral per .claude/rules/analytics.md.
 * Data is computed on read from the 0012 views, so it is always current —
 * no refresh step exists.
 */

function pct(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function num(value: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toFixed(3);
}

function TransitionCells({ row }: { row: TransitionCounts }) {
  return (
    <>
      <td className="px-3 py-2 text-right">{row.valid_paired}</td>
      <td className="px-3 py-2 text-right">{row.s00}</td>
      <td className="px-3 py-2 text-right">{row.s01}</td>
      <td className="px-3 py-2 text-right">{row.s10}</td>
      <td className="px-3 py-2 text-right">{row.s11}</td>
      <td className="px-3 py-2 text-right">{pct(row.change_rate)}</td>
      <td className="px-3 py-2 text-right">{pct(row.stability_rate)}</td>
      <td className="px-3 py-2 text-right">
        {row.net_movement_toward_1 > 0 ? `+${row.net_movement_toward_1}` : row.net_movement_toward_1}
      </td>
      <td className="px-3 py-2 text-right">
        {row.pct_point_shift === null
          ? "—"
          : `${row.pct_point_shift > 0 ? "+" : ""}${(row.pct_point_shift * 100).toFixed(1)}pp`}
      </td>
      <td className="px-3 py-2 text-right text-gray-500">
        {row.missing_a1 + row.missing_a2 + row.missing_both}
      </td>
    </>
  );
}

const TRANSITION_HEADERS = (
  <>
    <th className="px-3 py-2 text-right font-medium">Valid pairs</th>
    <th className="px-3 py-2 text-right font-medium">0→0</th>
    <th className="px-3 py-2 text-right font-medium">0→1</th>
    <th className="px-3 py-2 text-right font-medium">1→0</th>
    <th className="px-3 py-2 text-right font-medium">1→1</th>
    <th className="px-3 py-2 text-right font-medium">Change rate</th>
    <th className="px-3 py-2 text-right font-medium">Stability</th>
    <th className="px-3 py-2 text-right font-medium">Net → 1</th>
    <th className="px-3 py-2 text-right font-medium">Shift</th>
    <th className="px-3 py-2 text-right font-medium">Missing</th>
  </>
);

export default async function ClassAnalyticsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id, name, professor_id")
    .eq("id", classId)
    .maybeSingle();
  if (classError) {
    throw new Error(`Could not verify access: ${classError.message}`);
  }
  if (!classRow || !user || classRow.professor_id !== user.id) notFound();

  const [classSummary, mappingSummaries, energySummaries, assignmentSummaries] =
    await Promise.all([
      getClassTransitionSummary(supabase, classId),
      getMappingTransitionSummaries(supabase, classId),
      getEnergySourceTransitionSummaries(supabase, classId),
      getAssignmentResponseSummaries(supabase, classId),
    ]);

  return (
    <main className="mx-auto max-w-6xl p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Analytics — {classRow.name}</h1>
          <p className="mt-1 text-sm text-gray-600">
            Descriptive statistics about opinion responses and how they moved
            between the two assignments. Nothing here is a grade or a
            correctness judgement. Figures update live as responses arrive
            and mappings are approved.
          </p>
        </div>
        <Link
          href={`/classes/${classId}`}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
        >
          Back to class
        </Link>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Class overview</h2>
      {!classSummary ? (
        <p className="mt-2 text-sm text-gray-600">
          No transition data yet — transitions appear once at least one
          mapping is{" "}
          <Link href={`/classes/${classId}/mappings`} className="text-blue-600 underline">
            approved in the mapping studio
          </Link>{" "}
          and students have submitted responses.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Students</th>
                <th className="px-3 py-2 font-medium">Approved mappings</th>
                {TRANSITION_HEADERS}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="px-3 py-2">{classSummary.students_considered}</td>
                <td className="px-3 py-2">{classSummary.mappings_considered}</td>
                <TransitionCells row={classSummary} />
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Per approved mapping</h2>
      {mappingSummaries.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">No approved mappings yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Mapping</th>
                <th className="px-3 py-2 font-medium">Type</th>
                {TRANSITION_HEADERS}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mappingSummaries.map((m) => (
                <tr key={m.mapping_id}>
                  <td className="px-3 py-2">
                    {m.mapping_name}{" "}
                    <span className="text-xs text-gray-500">v{m.mapping_version}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{m.mapping_type}</td>
                  <TransitionCells row={m} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">By energy source</h2>
      {energySummaries.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">
          No energy-source data yet (mappings need an energy source set and
          approval).
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Energy source</th>
                <th className="px-3 py-2 font-medium">Mappings</th>
                {TRANSITION_HEADERS}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {energySummaries.map((e) => (
                <tr key={e.energy_source}>
                  <td className="px-3 py-2">{e.energy_source}</td>
                  <td className="px-3 py-2">{e.mappings_considered}</td>
                  <TransitionCells row={e} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 text-lg font-semibold">Response distributions per assignment</h2>
      {assignmentSummaries.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">No submitted responses yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border border-gray-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs text-gray-600">
              <tr>
                <th className="px-3 py-2 font-medium">Assignment</th>
                <th className="px-3 py-2 text-right font-medium">Questions</th>
                <th className="px-3 py-2 text-right font-medium">Respondents</th>
                <th className="px-3 py-2 text-right font-medium">Final answers</th>
                <th className="px-3 py-2 text-right font-medium">Avg consensus</th>
                <th className="px-3 py-2 text-right font-medium">Avg disagreement</th>
                <th className="px-3 py-2 text-right font-medium">Avg entropy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {assignmentSummaries.map((a) => (
                <tr key={a.assignment_id}>
                  <td className="px-3 py-2 font-mono text-xs">{a.assignment_id.slice(0, 8)}…</td>
                  <td className="px-3 py-2 text-right">{a.question_count}</td>
                  <td className="px-3 py-2 text-right">{a.respondents}</td>
                  <td className="px-3 py-2 text-right">{a.answered_responses}</td>
                  <td className="px-3 py-2 text-right">{pct(a.avg_consensus)}</td>
                  <td className="px-3 py-2 text-right">{pct(a.avg_disagreement)}</td>
                  <td className="px-3 py-2 text-right">{num(a.avg_entropy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-8 text-xs text-gray-500">
        Change rate and net shift are different metrics: change rate counts
        all movement in both directions; net shift is the balance of it.
        Missing or non-comparable pairs are reported separately and never
        counted as transitions.
      </p>
    </main>
  );
}
