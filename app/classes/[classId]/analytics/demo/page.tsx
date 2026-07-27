import Link from "next/link";
import { notFound } from "next/navigation";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { DemoDashboard } from "@/components/analytics/demo-dashboard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getClassSyntheticCensus,
  getEnergySourceAssignmentChange,
  getMappingTransitionSummaries,
  getResponseTransitionsLive,
  getStudentTransitionSummaries,
} from "@/lib/analytics/queries";
import {
  getClassAssignments,
  getStudentNameMap,
  getSyntheticStudentIds,
  requireProfessorClassPage,
} from "@/lib/analytics/page-data";
import type { DemoScope } from "@/lib/analytics/demo-data";

/**
 * Demo Dashboard — a permanent route, not a throwaway script.
 *
 * It exists so the platform's analytics can be demonstrated on a cohort
 * large enough to show its range, without ever needing to point a
 * demonstration at real student opinions. It reads the same Phase 7 views
 * as every other analytics page; the only thing that makes it a "demo"
 * page is that it states the provenance of what it is showing, everywhere,
 * and refuses to imply synthetic data is real (or vice versa).
 *
 * Populate it with: npm run db:seed:demo (local/staging only).
 */
export default async function DemoDashboardPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, classRow } = await requireProfessorClassPage(classId);
  if (!classRow) notFound();

  const [census, assignments, energyChange, studentSummaries, liveRows, studentNames, syntheticIds, mappingSummaries] =
    await Promise.all([
      getClassSyntheticCensus(supabase, classId),
      getClassAssignments(supabase, classId),
      getEnergySourceAssignmentChange(supabase, classId),
      getStudentTransitionSummaries(supabase, classId),
      getResponseTransitionsLive(supabase, classId),
      getStudentNameMap(supabase, classId),
      getSyntheticStudentIds(supabase, classId),
      getMappingTransitionSummaries(supabase, classId),
    ]);

  const a1 = assignments.find((a) => a.sequence_number === 1);
  const a2 = assignments.find((a) => a.sequence_number === 2);

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="title-md">Demo dashboard — {classRow.name}</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          A presentation view of the platform&apos;s analytics running on a synthetic cohort.
          Every figure comes from the same approved-mappings-only views the rest of analytics uses.
        </p>
      </div>
      <Button asChild variant="outline">
        <Link href={`/classes/${classId}`}>Back to class</Link>
      </Button>
    </div>
  );

  // The page must never present a class with no synthetic data as a demo.
  if (!census || census.synthetic_student_count === 0) {
    return (
      <main className="page-dense">
        {header}
        <AnalyticsNav classId={classId} active="demo" />
        <Alert className="mt-6">
          <AlertDescription>
            This class has no synthetic demo students, so there is nothing to demonstrate here —
            and this page will not relabel real student data as a demo. Generate a cohort against a
            local or staging database with <code>npm run db:seed:demo</code>, then reload. The
            class&apos;s real analytics live in{" "}
            <Link href={`/classes/${classId}/analytics`} className="link">
              the analytics overview
            </Link>
            .
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  if (!a1 || !a2) {
    return (
      <main className="page-dense">
        {header}
        <AnalyticsNav classId={classId} active="demo" />
        <Alert className="mt-6">
          <AlertDescription>
            This class does not have both an Assignment 1 and an Assignment 2, so there is no
            comparison to show. The demo dashboard never creates assignments.
          </AlertDescription>
        </Alert>
      </main>
    );
  }

  const scope: DemoScope = {
    syntheticStudents: census.synthetic_student_count,
    realStudents: census.real_student_count,
    assignment1Title: a1.title,
    assignment2Title: a2.title,
    approvedMappings: mappingSummaries.length,
  };

  return (
    <main className="page-dense">
      {header}
      <AnalyticsNav classId={classId} active="demo" />
      <DemoDashboard
        scope={scope}
        energyChange={energyChange}
        studentSummaries={studentSummaries}
        liveRows={liveRows}
        studentNames={studentNames}
        syntheticStudentIds={[...syntheticIds]}
        exportHref={`/classes/${classId}/exports/demo`}
      />
    </main>
  );
}
