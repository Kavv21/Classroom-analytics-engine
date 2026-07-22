/**
 * Loading state. Deliberately static — no pulse or shimmer. This is a
 * repeat-use tool; an animated skeleton on every navigation becomes
 * noise, and the motion budget reserves animation for things the
 * professor is interacting with.
 */
export default function AnalyticsLoading() {
  return (
    <main className="page-dense">
      <p role="status" aria-live="polite" className="note">
        Loading analytics…
      </p>
      <div className="mt-6 space-y-6" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-28" />
        ))}
      </div>
    </main>
  );
}
