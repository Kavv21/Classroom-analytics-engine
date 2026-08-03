import { LoadingShell, SkeletonHeading, SkeletonList } from "@/components/ui/page-skeleton";

/** /classes — a heading over a divided list of class rows. */
export default function ClassesLoading() {
  return (
    <LoadingShell label="Loading your classes…">
      <SkeletonHeading />
      <SkeletonList rows={3} />
    </LoadingShell>
  );
}
