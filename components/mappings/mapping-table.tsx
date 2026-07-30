"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
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
import { questionLabel } from "@/lib/ui/question-label";

/** The stored fields `questionLabel` needs, for a question id. */
function fieldsFor(id: string, questionsById: Record<string, QuestionLite>) {
  const q = questionsById[id];
  return {
    questionText: q?.text,
    energySource: q?.energySource,
    criterion: q?.criterion,
    code: q?.code ?? id.slice(0, 8),
  };
}

/** One-line label for a question id, wording first. */
function labelFor(id: string, questionsById: Record<string, QuestionLite>): string {
  return questionLabel(fieldsFor(id, questionsById));
}

const SIDE_PREVIEW_LIMIT = 4;

/**
 * The questions on one side of a mapping. Each is named by its wording, with
 * its code underneath as the small cross-reference — a column of bare
 * "A1-017"s tells a professor nothing about what they approved.
 */
function QuestionSideCell({
  ids,
  questionsById,
}: {
  ids: string[];
  questionsById: Record<string, QuestionLite>;
}) {
  if (ids.length === 0) return <span className="text-ink-muted">—</span>;

  const sorted = [...ids].sort((a, b) =>
    labelFor(a, questionsById).localeCompare(labelFor(b, questionsById))
  );
  const shown = sorted.slice(0, SIDE_PREVIEW_LIMIT);
  const overflow = sorted.length - shown.length;

  return (
    <ul className="space-y-1">
      {shown.map((id) => {
        const fields = fieldsFor(id, questionsById);
        const label = questionLabel(fields);
        return (
          <li key={id} className="min-w-0">
            <span className="block">{label}</span>
            {fields.code && fields.code !== label && (
              <span className="block font-mono text-[11px] text-ink-muted">{fields.code}</span>
            )}
          </li>
        );
      })}
      {overflow > 0 && (
        <li className="text-ink-muted">
          +{overflow} more (
          {sorted
            .slice(SIDE_PREVIEW_LIMIT)
            .map((id) => labelFor(id, questionsById))
            .join(", ")}
          )
        </li>
      )}
    </ul>
  );
}

function PreviewPanel({
  preview,
  questionsById,
}: {
  preview: MappingPreview;
  questionsById: Record<string, QuestionLite>;
}) {
  // Wording is the label; the code follows in muted type so a professor can
  // still tie a preview row back to an export.
  const label = (id: string) => labelFor(id, questionsById);
  const code = (id: string) => fieldsFor(id, questionsById).code;
  const QuestionCell = ({ id }: { id: string }) => (
    <>
      <span className="block">{label(id)}</span>
      {code(id) !== label(id) && (
        <span className="block font-mono text-[11px] text-ink-muted">{code(id)}</span>
      )}
    </>
  );
  return (
    <div className="space-y-3 bg-surface-sunken p-3 text-sm">
      <p className="text-ink-secondary">
        Preview of what this mapping <em>would</em> show once approved —
        counts of matched final responses from {preview.enrolledStudents}{" "}
        enrolled student{preview.enrolledStudents === 1 ? "" : "s"}. Nothing
        here reaches analytics until the mapping is approved.
      </p>

      {preview.questionCounts.length > 0 && (
        <div className="table-frame overflow-x-auto">
          <table className="data-table data-table--dense data-table--numeric">
            <thead>
              <tr>
                <th>Question</th>
                <th>Side</th>
                <th>Answered</th>
                <th>0s</th>
                <th>1s</th>
              </tr>
            </thead>
            <tbody>
              {preview.questionCounts.map((qc) => (
                <tr key={`${qc.questionId}-${qc.side}`}>
                  <td>
                    <QuestionCell id={qc.questionId} />
                  </td>
                  <td>A{qc.side}</td>
                  <td>{qc.answered}</td>
                  <td>{qc.zeros}</td>
                  <td>{qc.ones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.pairCounts.length > 0 ? (
        <div>
          <div className="table-frame overflow-x-auto">
            <table className="data-table data-table--dense data-table--numeric">
              <thead>
                <tr>
                  <th>A1 × A2 pair</th>
                  <th>Paired</th>
                  <th>0/0</th>
                  <th>0/1</th>
                  <th>1/0</th>
                  <th>1/1</th>
                  <th>Missing A1</th>
                  <th>Missing A2</th>
                  <th>Missing both</th>
                </tr>
              </thead>
              <tbody>
                {preview.pairCounts.map((p) => (
                  <tr key={`${p.a1QuestionId}-${p.a2QuestionId}`}>
                    <td>
                      <span className="block">
                        {label(p.a1QuestionId)} × {label(p.a2QuestionId)}
                      </span>
                      <span className="block font-mono text-[11px] text-ink-muted">
                        {code(p.a1QuestionId)} × {code(p.a2QuestionId)}
                      </span>
                    </td>
                    <td>{p.paired}</td>
                    <td>{p.pair00}</td>
                    <td>{p.pair01}</td>
                    <td>{p.pair10}</td>
                    <td>{p.pair11}</td>
                    <td>{p.missingA1}</td>
                    <td>{p.missingA2}</td>
                    <td>{p.missingBoth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
        toast.error(result.error);
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
      <div className="card-standard text-sm text-ink-secondary">
        No mappings yet. Select questions above and create one, or use
        “Generate suggestions” to seed the deterministic matches.
      </div>
    );
  }

  return (
    <div className="table-frame">
      <div className="border-b border-hairline bg-surface-sunken px-4 py-3">
        <p className="eyebrow">Confirmed &amp; suggested mappings</p>
        <p className="mt-0.5 font-medium">{mappings.length} total</p>
        <p className="mt-0.5 text-xs text-ink-muted">
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
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>A1 questions</th>
              <th>A2 questions</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
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
                    <td className="px-3 py-2 text-xs">
                      <QuestionSideCell ids={m.a1QuestionIds} questionsById={questionsById} />
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <QuestionSideCell ids={m.a2QuestionIds} questionsById={questionsById} />
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
                            className="btn btn-sm"
                            style={
                              busy
                                ? undefined
                                : {
                                    backgroundColor: "var(--surface-good)",
                                    borderColor: "var(--status-good)",
                                    color: "var(--status-good-text)",
                                  }
                            }
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
                        <ul className="mt-1 space-y-2">
                          {historyChain(m).map((v) => (
                            <li key={v.id}>
                              v{v.version} — {mappingStatusLabel(v.mappingStatus)}
                              {v.professorApproved ? " (live in analytics)" : ""} · last updated{" "}
                              {new Date(v.updatedAt).toLocaleString()}
                              {/* Which questions that version actually mapped —
                                  by wording, so a history entry is readable
                                  without opening the version. */}
                              <span className="mt-0.5 block text-ink-muted">
                                A1: {v.a1QuestionIds.map((id) => labelFor(id, questionsById)).join(", ") || "—"}
                                {" · "}
                                A2: {v.a2QuestionIds.map((id) => labelFor(id, questionsById)).join(", ") || "—"}
                              </span>
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
