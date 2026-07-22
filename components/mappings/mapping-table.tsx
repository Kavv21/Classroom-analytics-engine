"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createMappingVersion,
  deleteMapping,
  previewMapping,
  setMappingApproval,
  type MappingPreview,
} from "@/lib/mappings/actions";
import type { MappingRowLite, QuestionLite } from "@/components/mappings/types";
import { mappingStatusLabel, mappingStatusTone, mappingTypeLabel } from "@/lib/ui/labels";

function codesFor(ids: string[], questionsById: Record<string, QuestionLite>): string {
  if (ids.length === 0) return "—";
  const codes = ids.map((id) => questionsById[id]?.code ?? "?").sort();
  if (codes.length <= 4) return codes.join(", ");
  return `${codes.slice(0, 4).join(", ")} +${codes.length - 4} more`;
}

function PreviewPanel({
  preview,
  questionsById,
}: {
  preview: MappingPreview;
  questionsById: Record<string, QuestionLite>;
}) {
  const code = (id: string) => questionsById[id]?.code ?? id.slice(0, 8);
  return (
    <div className="space-y-3 bg-surface-sunken p-3 text-sm">
      <p className="text-ink-secondary">
        Preview of what this mapping <em>would</em> show once approved —
        counts of matched final responses from {preview.enrolledStudents}{" "}
        enrolled student{preview.enrolledStudents === 1 ? "" : "s"}. Nothing
        here reaches analytics until the mapping is approved.
      </p>

      {preview.questionCounts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pr-4 font-medium">Question</th>
                <th className="pr-4 font-medium">Side</th>
                <th className="pr-4 font-medium">Answered</th>
                <th className="pr-4 font-medium">0s</th>
                <th className="pr-4 font-medium">1s</th>
              </tr>
            </thead>
            <tbody>
              {preview.questionCounts.map((qc) => (
                <tr key={`${qc.questionId}-${qc.side}`}>
                  <td className="pr-4 font-mono">{code(qc.questionId)}</td>
                  <td className="pr-4">A{qc.side}</td>
                  <td className="pr-4">{qc.answered}</td>
                  <td className="pr-4">{qc.zeros}</td>
                  <td className="pr-4">{qc.ones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.pairCounts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pr-4 font-medium">A1 × A2 pair</th>
                <th className="pr-4 font-medium">Paired</th>
                <th className="pr-4 font-medium">0/0</th>
                <th className="pr-4 font-medium">0/1</th>
                <th className="pr-4 font-medium">1/0</th>
                <th className="pr-4 font-medium">1/1</th>
                <th className="pr-4 font-medium">Missing A1</th>
                <th className="pr-4 font-medium">Missing A2</th>
                <th className="pr-4 font-medium">Missing both</th>
              </tr>
            </thead>
            <tbody>
              {preview.pairCounts.map((p) => (
                <tr key={`${p.a1QuestionId}-${p.a2QuestionId}`}>
                  <td className="pr-4 font-mono">
                    {code(p.a1QuestionId)} × {code(p.a2QuestionId)}
                  </td>
                  <td className="pr-4">{p.paired}</td>
                  <td className="pr-4">{p.pair00}</td>
                  <td className="pr-4">{p.pair01}</td>
                  <td className="pr-4">{p.pair10}</td>
                  <td className="pr-4">{p.pair11}</td>
                  <td className="pr-4">{p.missingA1}</td>
                  <td className="pr-4">{p.missingA2}</td>
                  <td className="pr-4">{p.missingBoth}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-muted">
            Pair columns read “A1 value / A2 value”. Missing responses stay
            in their own columns — they are never counted as a pair.
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">
          No cross-assignment pairs to preview (one side of this mapping has
          no questions).
        </p>
      )}
    </div>
  );
}

export function MappingTable({
  mappings,
  questionsById,
  onEdit,
}: {
  mappings: MappingRowLite[];
  questionsById: Record<string, QuestionLite>;
  onEdit: (mapping: MappingRowLite) => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, MappingPreview>>({});
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);

  const byId = new Map(mappings.map((m) => [m.id, m]));

  function historyChain(mapping: MappingRowLite): MappingRowLite[] {
    const chain: MappingRowLite[] = [];
    let current: MappingRowLite | undefined = mapping;
    while (current) {
      chain.push(current);
      current = current.previousVersionId ? byId.get(current.previousVersionId) : undefined;
    }
    return chain;
  }

  async function run(id: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    setBusyId(id);
    const result = await fn();
    setBusyId(null);
    if (!result.success) {
      setError(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  async function togglePreview(id: string) {
    if (openPreviewId === id) {
      setOpenPreviewId(null);
      return;
    }
    setError(null);
    if (!previews[id]) {
      setBusyId(id);
      const result = await previewMapping(id);
      setBusyId(null);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setPreviews((prev) => ({ ...prev, [id]: result.data }));
    }
    setOpenPreviewId(id);
  }

  const actionClass =
    "btn btn-sm btn-secondary";

  if (mappings.length === 0) {
    return (
      <div className="rounded border border-hairline p-6 text-sm text-ink-secondary">
        No mappings yet. Select questions above and create one, or use
        “Generate suggestions” to seed the deterministic matches.
      </div>
    );
  }

  return (
    <div className="rounded border border-hairline">
      <div className="border-b border-hairline bg-surface-sunken px-4 py-3">
        <p className="font-medium">Mappings ({mappings.length})</p>
        <p className="text-xs text-ink-muted">
          Only approved mappings are visible to analytics. Approved mappings
          can&rsquo;t be edited — create a new version instead.
        </p>
      </div>
      {error && (
        <p role="alert" className="banner banner-critical rounded-none border-x-0 border-t-0">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-sunken text-xs text-ink-secondary">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">A1 questions</th>
              <th className="px-3 py-2 font-medium">A2 questions</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {mappings.map((m) => {
              const busy = busyId === m.id;
              const superseded = m.mappingStatus === "SUPERSEDED" || m.supersededById !== null;
              const editable = !m.professorApproved && !superseded;
              return (
                <Fragment key={m.id}>
                  <tr className={superseded ? "text-ink-muted" : ""}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{m.mappingName}</span>{" "}
                      <span className="text-xs text-ink-muted">v{m.version}</span>
                      {m.commonConcept && (
                        <span className="block text-xs text-ink-muted">{m.commonConcept}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">{mappingTypeLabel(m.mappingType)}</td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {codesFor(m.a1QuestionIds, questionsById)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {codesFor(m.a2QuestionIds, questionsById)}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={mappingStatusTone(m.mappingStatus)}
                      >
                        {mappingStatusLabel(m.mappingStatus)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => togglePreview(m.id)}
                          className={actionClass}
                        >
                          {openPreviewId === m.id ? "Hide preview" : "Preview"}
                        </button>
                        {!m.professorApproved && !superseded && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(m.id, () => setMappingApproval(m.id, true))}
                            className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {m.mappingStatus !== "REJECTED" && !superseded && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(m.id, () => setMappingApproval(m.id, false))}
                            className={actionClass}
                          >
                            Reject
                          </button>
                        )}
                        {!superseded && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(m.id, () => createMappingVersion(m.id))}
                            className={actionClass}
                          >
                            New version
                          </button>
                        )}
                        {editable && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => onEdit(m)}
                            className={actionClass}
                          >
                            Edit
                          </button>
                        )}
                        {editable && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => run(m.id, () => deleteMapping(m.id))}
                            className="btn btn-sm btn-danger"
                          >
                            Delete
                          </button>
                        )}
                        {(m.version > 1 || m.supersededById) && (
                          <button
                            type="button"
                            onClick={() =>
                              setOpenHistoryId(openHistoryId === m.id ? null : m.id)
                            }
                            className={actionClass}
                          >
                            History
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {openPreviewId === m.id && previews[m.id] && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <PreviewPanel preview={previews[m.id]!} questionsById={questionsById} />
                      </td>
                    </tr>
                  )}
                  {openHistoryId === m.id && (
                    <tr>
                      <td colSpan={6} className="bg-surface-sunken px-4 py-3 text-xs text-ink-secondary">
                        <p className="font-medium text-ink-secondary">Revision history</p>
                        <ul className="mt-1 space-y-1">
                          {historyChain(m).map((v) => (
                            <li key={v.id}>
                              v{v.version} — {mappingStatusLabel(v.mappingStatus)}
                              {v.professorApproved ? " (live in analytics)" : ""} · last updated{" "}
                              {new Date(v.updatedAt).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
