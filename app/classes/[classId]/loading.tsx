import {
  LoadingShell,
  SkeletonCards,
  SkeletonHeading,
  SkeletonStats,
  SkeletonTable,
} from "@/components/ui/page-skeleton";

/**
 * /classes/[classId] — title, the two-figure summary strip, the
 * Assignments/Analytics tiles, then the roster table.
 */
export default function ClassDetailLoading() {
  return (
    <LoadingShell label="Loading class…">
      <SkeletonHeading />
      <SkeletonStats count={2} />
      <SkeletonCards count={2} height="h-20" />
      <SkeletonTable columns={5} rows={5} />
    </LoadingShell>
  );
}
