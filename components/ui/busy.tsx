/**
 * Busy indication for work the user just started.
 *
 * Not a spinner. The design system's motion budget (app/globals.css)
 * allows colour, opacity and shadow only — a rotating glyph animates
 * transform. `.pending-dots` carries the same signal with opacity alone.
 *
 * The label is the accessible part: the dots are `aria-hidden`, and the
 * wrapper is a live region so a screen reader is told what is happening
 * rather than being left with a decoration it cannot see.
 */
export function Busy({ label, className }: { label: string; className?: string }) {
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 ${className ?? ""}`}
    >
      <span className="pending-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}
    </span>
  );
}
