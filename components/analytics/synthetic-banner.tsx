import {
  DEMO_NEUTRALITY_NOTE,
  SYNTHETIC_NOTE,
  type DemoScope,
} from "@/lib/analytics/demo-data";

/**
 * The standing provenance block for the Demo Dashboard.
 *
 * It is deliberately loud and deliberately at the top. The failure mode
 * this guards against is not a professor forgetting mid-session — it is a
 * screenshot of a chart escaping the session entirely and being read as a
 * real class's results a month later. That is also why every chart and
 * table repeats a compact version of this in its own footnote.
 *
 * When the class contains non-synthetic students as well, the mixture is
 * stated outright: the analytics views aggregate every active student in
 * the class, so in that situation the figures are NOT purely synthetic and
 * saying so is the only honest option.
 */
export function SyntheticDataBanner({ scope }: { scope: DemoScope }) {
  const mixed = scope.realStudents > 0;

  return (
    <section
      aria-label="Data provenance"
      className="rounded-md border-2 border-dashed border-hairline bg-surface-sunken p-4"
    >
      <p className="text-sm font-semibold uppercase tracking-wide text-ink-primary">
        Synthetic demo data — not a real class
      </p>
      <p className="mt-1 text-sm text-ink-secondary">{SYNTHETIC_NOTE}</p>

      <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-secondary md:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Synthetic students</dt>
          <dd className="tabular-nums font-medium">{scope.syntheticStudents}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Non-synthetic students</dt>
          <dd className="tabular-nums font-medium">{scope.realStudents}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Approved mappings in use</dt>
          <dd className="tabular-nums font-medium">{scope.approvedMappings}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Comparison</dt>
          <dd className="font-medium">
            {scope.assignment1Title} → {scope.assignment2Title}
          </dd>
        </div>
      </dl>

      {mixed && (
        <p className="mt-3 rounded border border-hairline bg-surface px-3 py-2 text-xs text-ink-primary">
          <strong>This class also contains {scope.realStudents} non-synthetic student
          {scope.realStudents === 1 ? "" : "s"}.</strong>{" "}
          The analytics views aggregate every active student in a class, so the figures below
          combine both populations and are not purely synthetic. To demonstrate on synthetic data
          alone, use a class that holds no real enrolments.
        </p>
      )}

      <p className="mt-3 text-xs text-ink-muted">{DEMO_NEUTRALITY_NOTE}</p>
      <p className="mt-1 text-xs text-ink-muted">
        Only professor-approved mappings contribute to any transition figure on this page — an
        unapproved mapping is invisible to these views by construction.
      </p>
    </section>
  );
}
