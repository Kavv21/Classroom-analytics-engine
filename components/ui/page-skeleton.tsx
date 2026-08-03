/**
 * Route-level loading skeletons.
 *
 * Two rules, both inherited from the first one of these
 * (app/classes/[classId]/analytics/loading.tsx):
 *
 * 1. STATIC. No pulse, no shimmer. The professor navigates through these
 *    screens dozens of times a session, and a skeleton that animates on
 *    every navigation is noise. The motion budget spends its animation on
 *    things being interacted with — see `Busy` in components/ui/busy.tsx,
 *    which is what an in-flight *action* uses.
 *
 * 2. SHAPED LIKE WHAT IS COMING. The point is that the page does not
 *    reflow when the data lands. A generic centred spinner would move
 *    every element on arrival, which is the layout shift the budget
 *    forbids for real content too.
 *
 * These are plain server components: a loading.tsx must not pull a client
 * bundle in just to draw grey boxes.
 */

/** The announcement plus the decoration. Only the label reaches a screen
 *  reader — the boxes are shapes, and reading them out is noise. */
export function LoadingShell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <main className={className ?? "page-standard"}>
      <p role="status" aria-live="polite" className="note">
        {label}
      </p>
      <div aria-hidden="true">{children}</div>
    </main>
  );
}

/** One line of text-height grey. `width` is a Tailwind width class. */
export function SkeletonLine({ width = "w-40", className }: { width?: string; className?: string }) {
  return <div className={`skeleton-line ${width} ${className ?? ""}`} />;
}

/** A page heading: eyebrow over title. */
export function SkeletonHeading() {
  return (
    <div className="mt-6 space-y-2">
      <SkeletonLine width="w-28" className="h-2.5" />
      <SkeletonLine width="w-64" className="h-6" />
    </div>
  );
}

/** The app's repeated pattern: a card holding a divided list of rows,
 *  each row a label on the left and a status pill on the right. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="table-frame mt-4 divide-y divide-hairline bg-surface-raised">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonLine width="w-1/3" />
            <SkeletonLine width="w-1/2" className="h-2.5" />
          </div>
          <SkeletonLine width="w-16" className="h-5" />
        </div>
      ))}
    </div>
  );
}

/** A header row plus body rows, at the column count the real table uses. */
export function SkeletonTable({ columns = 4, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="table-frame mt-4 overflow-hidden bg-surface-raised">
      <div className="flex gap-4 border-b border-hairline p-3">
        {Array.from({ length: columns }, (_, i) => (
          <SkeletonLine key={i} width="flex-1" className="h-2.5" />
        ))}
      </div>
      <div className="divide-y divide-hairline">
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} className="flex gap-4 p-3">
            {Array.from({ length: columns }, (_, c) => (
              <SkeletonLine key={c} width="flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The row of figures above a table (enrolled / submitted / …). */
export function SkeletonStats({ count = 4 }: { count?: number }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="skeleton-block h-16" />
      ))}
    </div>
  );
}

/** A stack of full-width cards, for pages that are a column of panels. */
export function SkeletonCards({ count = 3, height = "h-28" }: { count?: number; height?: string }) {
  return (
    <div className="mt-4 space-y-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`skeleton-block ${height}`} />
      ))}
    </div>
  );
}
