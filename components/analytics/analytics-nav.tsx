import Link from "next/link";
import { cn } from "@/lib/utils";

export type AnalyticsSection =
  | "overview"
  | "assignments"
  | "transitions"
  | "students"
  | "builder"
  | "demo";

const SECTIONS: Array<{ key: AnalyticsSection; label: string; path: string }> = [
  { key: "overview", label: "Overview", path: "" },
  { key: "assignments", label: "Assignment analytics", path: "/assignments" },
  { key: "transitions", label: "Transition analytics", path: "/transitions" },
  { key: "students", label: "Student analytics", path: "/students" },
  { key: "builder", label: "Visualisation builder", path: "/builder" },
  // Labelled "demo data" in the navigation itself, so the synthetic
  // provenance is visible before the page is even opened.
  { key: "demo", label: "Demo data", path: "/demo" },
];

/** Professor dashboard navigation (Section 19). Mapping studio is its own
 * page from Phase 6 and is linked alongside the analytics sections. */
export function AnalyticsNav({ classId, active }: { classId: string; active: AnalyticsSection }) {
  const base = `/classes/${classId}/analytics`;
  // Styled as a shadcn TabsList without using the Tabs primitive: these
  // are page navigations, not in-page panels, so they must stay real
  // links (right-click, open-in-new-tab, and the browser's back button
  // all have to keep working).
  const linkClass = (isActive: boolean) =>
    cn(
      "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
      "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground"
    );

  return (
    <nav
      aria-label="Analytics sections"
      className="mt-4 flex flex-wrap gap-1 rounded-lg bg-muted p-1"
    >
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
