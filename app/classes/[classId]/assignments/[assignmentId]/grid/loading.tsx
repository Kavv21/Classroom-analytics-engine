import { LoadingShell, SkeletonHeading, SkeletonTable } from "@/components/ui/page-skeleton";

/** The response-totals grid: one wide table and nothing else, so the
 *  skeleton is one wide table. */
export default function GridLoading() {
  return (
    <LoadingShell label="Loading response totals…" className="page-dense">
      <SkeletonHeading />
      <SkeletonTable columns={6} rows={12} />
    </LoadingShell>
  );
}
