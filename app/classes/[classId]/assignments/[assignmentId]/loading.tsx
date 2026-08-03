import {
  LoadingShell,
  SkeletonCards,
  SkeletonHeading,
  SkeletonStats,
  SkeletonTable,
} from "@/components/ui/page-skeleton";

/**
 * /classes/[classId]/assignments/[assignmentId] — the heaviest professor
 * page: six parallel queries behind a title, the publishing panel, the
 * six-figure submission strip, the attempts table and the question list.
 */
export default function AssignmentDetailLoading() {
  return (
    <LoadingShell label="Loading assignment…">
      <SkeletonHeading />
      <SkeletonCards count={1} height="h-32" />
      <SkeletonStats count={6} />
      <SkeletonTable columns={5} rows={5} />
      <SkeletonTable columns={4} rows={4} />
    </LoadingShell>
  );
}
