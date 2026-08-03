import { LoadingShell, SkeletonHeading, SkeletonTable } from "@/components/ui/page-skeleton";

/** Covers both admin screens (users, audit): each is a heading over one
 *  long table. */
export default function AdminLoading() {
  return (
    <LoadingShell label="Loading…">
      <SkeletonHeading />
      <SkeletonTable columns={5} rows={10} />
    </LoadingShell>
  );
}
