import { LoadingShell, SkeletonHeading, SkeletonTable } from "@/components/ui/page-skeleton";

/**
 * The student's answer grid. Shaped as the grid rather than as the
 * assignment list one level up, because this is the screen a student
 * waits on with the class watching — a boundary that draws the wrong
 * shape here reflows the whole worksheet when it lands.
 */
export default function AttemptLoading() {
  return (
    <LoadingShell label="Loading your assignment…" className="page-dense-narrow">
      <SkeletonHeading />
      <SkeletonTable columns={4} rows={12} />
    </LoadingShell>
  );
}
