"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { focusRing } from "@/components/analytics/chart-card";
import { TransitionMatrixCard } from "@/components/analytics/transition-matrix-card";
import {
  BINARY_LABELS,
  byCriterion,
  bySource,
  groupMappings,
  QUALITY_LABELS,
  TRANSITION_STATE_LABELS,
} from "@/lib/analytics/chart-data";
import type {
  MappingTransitionSummary,
  ResponseTransitionLiveRow,
} from "@/lib/analytics/queries";
import type { TransitionState } from "@/lib/types/domain";
import { formatPct } from "@/lib/charts/theme";

/**
 * Section 21 drill-down chain: energy source → criterion → mapped
 * question → transition matrix → selected transition → students →
 * individual student profile. Breadcrumbs jump back to any level; Reset
 * clears the whole chain. All figures are descriptive — never grades.
 */

interface TransitionDrilldownProps {
  classId: string;
  mappingSummaries: MappingTransitionSummary[];
  liveRows: ResponseTransitionLiveRow[];
  studentNames: Record<string, string>;
}

interface DrillState {
  source?: string;
  criterion?: string;
  mappingId?: string;
  state?: TransitionState;
  studentId?: string;
}

function valueLabel(v: 0 | 1 | null): string {
  if (v === null) return "no answer";
  return v === 0 ? BINARY_LABELS.zero : BINARY_LABELS.one;
}

export function TransitionDrilldown({
  classId,
  mappingSummaries,
  liveRows,
  studentNames,
}: TransitionDrilldownProps) {
  const [drill, setDrill] = useState<DrillState>({});

  const nameOf = (id: string) => studentNames[id] ?? `Student ${id.slice(0, 8)}`;

  const sourceGroups = useMemo(() => groupMappings(mappingSummaries, bySource), [mappingSummaries]);
  const sourceGroup = sourceGroups.find((g) => g.key === drill.source);
  const criterionGroups = useMemo(
    () => (sourceGroup ? groupMappings(sourceGroup.items, byCriterion) : []),
    [sourceGroup]
  );
  const criterionGroup = criterionGroups.find((g) => g.key === drill.criterion);
  const mapping = mappingSummaries.find((m) => m.mapping_id === drill.mappingId);

  const stateStudents = useMemo(() => {
    if (!drill.mappingId || !drill.state) return [];
    return liveRows
      .filter((r) => r.mapping_id === drill.mappingId && r.transition_state === drill.state)
      .sort((a, b) => nameOf(a.student_id).localeCompare(nameOf(b.student_id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveRows, drill.mappingId, drill.state, studentNames]);

  const studentRows = useMemo(() => {
    if (!drill.studentId) return [];
    return liveRows
      .filter((r) => r.student_id === drill.studentId)
      .sort((a, b) => a.mapping_name.localeCompare(b.mapping_name));
  }, [liveRows, drill.studentId]);

  const crumbs: Array<{ label: string; to: DrillState }> = [{ label: "All energy sources", to: {} }];
  if (drill.source) crumbs.push({ label: drill.source, to: { source: drill.source } });
  if (drill.criterion)
    crumbs.push({ label: drill.criterion, to: { source: drill.source, criterion: drill.criterion } });
  if (mapping)
    crumbs.push({
      label: `${mapping.mapping_name} v${mapping.mapping_version}`,
      to: { source: drill.source, criterion: drill.criterion, mappingId: drill.mappingId },
    });
  if (drill.state)
    crumbs.push({
      label: TRANSITION_STATE_LABELS[drill.state],
      to: {
        source: drill.source,
        criterion: drill.criterion,
        mappingId: drill.mappingId,
        state: drill.state,
      },
    });
  if (drill.studentId) crumbs.push({ label: nameOf(drill.studentId), to: drill });

  const rowButton = `flex w-full items-center justify-between gap-3 rounded border border-hairline px-3 py-2 text-left text-sm hover:bg-surface-info ${focusRing}`;

  return (
    <section
      aria-label="Transition drill-down"
      className="card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="eyebrow mb-0.5">Section 21</p>
          <h3 className="heading">Drill-down explorer</h3>
          <p className="mt-0.5 text-xs text-ink-secondary">
            Energy source → criterion → mapped question → transition matrix → students → student
            profile.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDrill({})}
          disabled={!drill.source && !drill.studentId}
          className={`btn btn-secondary ${focusRing}`}
        >
          Reset drill-down
        </button>
      </div>

      <nav aria-label="Drill-down breadcrumbs" className="mt-3 flex flex-wrap items-center gap-1 text-xs">
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true" className="text-ink-muted">/</span>}
            {i === crumbs.length - 1 ? (
              <span aria-current="location" className="rounded bg-action px-2 py-0.5 font-medium text-white">
                {crumb.label}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setDrill(crumb.to)}
                className={`rounded px-2 py-0.5 link ${focusRing}`}
              >
                {crumb.label}
              </button>
            )}
          </span>
        ))}
      </nav>

      <div className="mt-4">
        {/* Level 6 — student profile */}
        {drill.studentId ? (
          <div>
            <h4 className="font-medium text-ink">{nameOf(drill.studentId)}</h4>
            <p className="mt-0.5 text-xs text-ink-secondary">
              Every approved mapping for this student. Answers are opinions — a change is a change,
              not an improvement.{" "}
              <Link href={`/classes/${classId}/analytics/students`} className="underline">
                Open student analytics
              </Link>
            </p>
            <div className="mt-2 overflow-x-auto rounded border border-hairline">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Transitions for {nameOf(drill.studentId)}</caption>
                <thead className="bg-surface-sunken">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Mapping</th>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">A1 answer</th>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">A2 answer</th>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Transition</th>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">Data quality</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {studentRows.map((r) => (
                    <tr key={r.mapping_id}>
                      <td className="px-2 py-1.5">{r.mapping_name} <span className="text-ink-muted">v{r.mapping_version}</span></td>
                      <td className="px-2 py-1.5">{valueLabel(r.assignment_1_value)}</td>
                      <td className="px-2 py-1.5">{valueLabel(r.assignment_2_value)}</td>
                      <td className="px-2 py-1.5">
                        {r.transition_state ? TRANSITION_STATE_LABELS[r.transition_state] : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-ink-muted">
                        {r.data_quality_status
                          ? QUALITY_LABELS[r.data_quality_status.toLowerCase() as keyof typeof QUALITY_LABELS]
                          : "Valid pair"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : drill.state && mapping ? (
          /* Level 5 — students in the selected transition */
          <div>
            <h4 className="font-medium text-ink">
              {TRANSITION_STATE_LABELS[drill.state]} — {stateStudents.length} student
              {stateStudents.length === 1 ? "" : "s"} on “{mapping.mapping_name}”
            </h4>
            <ul className="mt-2 space-y-1.5">
              {stateStudents.map((r) => (
                <li key={r.student_id}>
                  <button
                    type="button"
                    className={rowButton}
                    onClick={() => setDrill({ ...drill, studentId: r.student_id })}
                  >
                    <span>{nameOf(r.student_id)}</span>
                    <span className="text-xs text-ink-muted">
                      {valueLabel(r.assignment_1_value)} → {valueLabel(r.assignment_2_value)} · view profile
                    </span>
                  </button>
                </li>
              ))}
              {stateStudents.length === 0 && (
                <li className="text-sm text-ink-muted">No students in this transition.</li>
              )}
            </ul>
          </div>
        ) : mapping ? (
          /* Level 4 — transition matrix for the mapped question */
          <TransitionMatrixCard
            title={`Transition matrix — ${mapping.mapping_name} (v${mapping.mapping_version})`}
            description="Click a cell to list the students in that transition."
            counts={mapping}
            qualityRows={[
              [QUALITY_LABELS.missing_a1, mapping.missing_a1],
              [QUALITY_LABELS.missing_a2, mapping.missing_a2],
              [QUALITY_LABELS.missing_both, mapping.missing_both],
              [QUALITY_LABELS.not_comparable, mapping.not_comparable],
            ]}
            onSelectState={(state) => setDrill({ ...drill, state })}
          />
        ) : drill.source && criterionGroups.length > 0 && !drill.criterion ? (
          /* Level 2 — criteria within the source */
          <ul className="space-y-1.5">
            {criterionGroups.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  className={rowButton}
                  onClick={() => setDrill({ source: drill.source, criterion: g.key })}
                >
                  <span>{g.key}</span>
                  <span className="text-xs text-ink-muted">
                    {g.items.length} mapping{g.items.length === 1 ? "" : "s"} ·{" "}
                    {g.totals.valid_paired} valid pairs · change rate{" "}
                    {formatPct(
                      g.totals.valid_paired > 0
                        ? (g.totals.s01 + g.totals.s10) / g.totals.valid_paired
                        : null
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : drill.criterion && criterionGroup ? (
          /* Level 3 — mapped questions within source + criterion */
          <ul className="space-y-1.5">
            {criterionGroup.items.map((m) => (
              <li key={m.mapping_id}>
                <button
                  type="button"
                  className={rowButton}
                  onClick={() => setDrill({ ...drill, mappingId: m.mapping_id })}
                >
                  <span>
                    {m.mapping_name} <span className="text-ink-muted">v{m.mapping_version}</span>
                  </span>
                  <span className="text-xs text-ink-muted">
                    {m.mapping_type} · {m.valid_paired} valid pairs · change rate{" "}
                    {formatPct(m.change_rate)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          /* Level 1 — energy sources */
          <ul className="space-y-1.5">
            {sourceGroups.map((g) => (
              <li key={g.key}>
                <button
                  type="button"
                  className={rowButton}
                  onClick={() => setDrill({ source: g.key })}
                >
                  <span>{g.key}</span>
                  <span className="text-xs text-ink-muted">
                    {g.items.length} mapping{g.items.length === 1 ? "" : "s"} ·{" "}
                    {g.totals.valid_paired} valid pairs · change rate{" "}
                    {formatPct(
                      g.totals.valid_paired > 0
                        ? (g.totals.s01 + g.totals.s10) / g.totals.valid_paired
                        : null
                    )}
                  </span>
                </button>
              </li>
            ))}
            {sourceGroups.length === 0 && (
              <li className="text-sm text-ink-muted">No approved mappings yet.</li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}
