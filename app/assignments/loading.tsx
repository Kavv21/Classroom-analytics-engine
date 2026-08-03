import { LoadingShell, SkeletonHeading, SkeletonCards } from "@/components/ui/page-skeleton";

/** The student's own assignment list: a stack of cards, each with the
 *  open/continue button on the right. */
export default function StudentAssignmentsLoading() {
  return (
    <LoadingShell label="Loading your assignments…">
      <SkeletonHeading />
      <SkeletonCards count={2} height="h-24" />
    </LoadingShell>
  );
}
