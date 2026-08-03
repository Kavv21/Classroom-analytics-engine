import { LoadingShell, SkeletonCards, SkeletonHeading } from "@/components/ui/page-skeleton";

/**
 * One student's page. Has its own boundary rather than inheriting the
 * analytics one because it is reached by clicking a row in the students
 * table — a same-section navigation, where the parent boundary would not
 * fire and the screen would sit unchanged until the data arrived.
 */
export default function StudentDetailLoading() {
  return (
    <LoadingShell label="Loading student…" className="page-dense">
      <SkeletonHeading />
      <SkeletonCards count={3} />
    </LoadingShell>
  );
}
