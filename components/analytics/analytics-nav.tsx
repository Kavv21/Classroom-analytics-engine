import Link from "next/link";

export type AnalyticsSection =
  | "overview"
  | "assignments"
  | "transitions"
  | "students"
  | "builder";

const SECTIONS: Array<{ key: AnalyticsSection; label: string; path: string }> = [
  { key: "overview", label: "Overview", path: "" },
  { key: "assignments", label: "Assignment analytics", path: "/assignments" },
  { key: "transitions", label: "Transition analytics", path: "/transitions" },
  { key: "students", label: "Student analytics", path: "/students" },
  { key: "builder", label: "Visualisation builder", path: "/builder" },
];

/** Professor dashboard navigation (Section 19). Mapping studio is its own
 * page from Phase 6 and is linked alongside the analytics sections. */
export function AnalyticsNav({ classId, active }: { classId: string; active: AnalyticsSection }) {
  const base = `/classes/${classId}/analytics`;
  const linkClass = (isActive: boolean) =>
    `rounded px-3 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${
      isActive
        ? "bg-gray-900 text-white"
        : "border border-gray-300 text-gray-700 hover:bg-gray-50"
    }`;

  return (
    <nav aria-label="Analytics sections" className="mt-4 flex flex-wrap gap-2">
      {SECTIONS.map((s) => (
        <Link
          key={s.key}
          href={`${base}${s.path}`}
          aria-current={active === s.key ? "page" : undefined}
          className={linkClass(active === s.key)}
        >
          {s.label}
        </Link>
      ))}
      <Link href={`/classes/${classId}/mappings`} className={linkClass(false)}>
        Mapping studio
      </Link>
    </nav>
  );
}
