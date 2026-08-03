import { LoadingShell, SkeletonHeading, SkeletonList } from "@/components/ui/page-skeleton";

/** /classes/[classId]/assignments — a list of assignment rows, each with
 *  a status pill on the right. */
export default function AssignmentsLoading() {
  return (
    <LoadingShell label="Loading assignments…">
      <SkeletonHeading />
      <SkeletonList rows={3} />
    </LoadingShell>
  );
}
