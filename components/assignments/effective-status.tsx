import type { EffectiveStatus } from "@/lib/assignments/schedule";
import { LocalDateTime } from "@/components/ui/local-date-time";

/**
 * The status a professor is shown, now that `assignments.status` alone is
 * not the answer.
 *
 * A scheduled assignment sits at READY from the moment it is approved until
 * the day it is retired, so the raw status column reads "Ready to publish"
 * while the class is mid-answer and again a fortnight after they finished.
 * The badge therefore prints the EFFECTIVE status — status combined with
 * the window and the clock (lib/assignments/schedule.ts).
 *
 * The status object must be computed by the caller, in a Server Component.
 * It depends on `now()`, and a client component that recomputed it during
 * render would produce different text from the SSR HTML and fail hydration
 * — the same trap `LocalDateTime` exists to avoid, one level up.
 */
export function EffectiveStatusBadge({
  status,
  className,
}: {
  status: EffectiveStatus;
  className?: string;
}) {
  return (
    <span className={className ? `${status.tone} ${className}` : status.tone}>
      {status.label}
      {status.detail && status.at && (
        <>
          {` ${status.detail} `}
          <LocalDateTime value={status.at} />
        </>
      )}
    </span>
  );
}
