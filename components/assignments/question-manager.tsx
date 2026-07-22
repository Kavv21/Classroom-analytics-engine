"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  reorderQuestions,
  updateQuestionLabels,
} from "@/lib/assignments/actions";

export interface QuestionRow {
  id: string;
  external_question_code: string;
  question_text: string;
  energy_source: string | null;
  criterion: string | null;
  response_zero_label: string;
  response_one_label: string;
  display_order: number;
}

interface QuestionManagerProps {
  assignmentId: string;
  questions: QuestionRow[];
  /** Once responses exist, only reordering is allowed (mirrors the DB
   * trigger — the trigger is the boundary, this just avoids dead-end UI). */
  hasResponses: boolean;
  /** Question edits/reorders only make sense pre-publication. */
  editable: boolean;
}

export function QuestionManager({
  assignmentId,
  questions,
  hasResponses,
  editable,
}: QuestionManagerProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zeroLabel, setZeroLabel] = useState("");
  const [oneLabel, setOneLabel] = useState("");

  const ordered = [...questions].sort((a, b) => a.display_order - b.display_order);

  async function swap(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const ids = ordered.map((q) => q.id);
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;

    setError(null);
    setBusy(true);
    const result = await reorderQuestions(assignmentId, ids);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  function startLabelEdit(q: QuestionRow) {
    setEditingId(q.id);
    setZeroLabel(q.response_zero_label);
    setOneLabel(q.response_one_label);
    setError(null);
  }

  async function saveLabels(questionId: string) {
    setError(null);
    setBusy(true);
    const result = await updateQuestionLabels(assignmentId, questionId, {
      responseZeroLabel: zeroLabel,
      responseOneLabel: oneLabel,
    });
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  if (ordered.length === 0) {
    return (
      <p className="banner mt-3">
        No questions yet. Import your spreadsheet to add them.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {hasResponses && (
        <p className="banner banner-warning mb-3">
          Students have already answered this assignment, so question wording
          and answer labels are locked. You can still reorder questions. To
          change the questions themselves, duplicate the assignment and edit
          the copy.
        </p>
      )}
      <div className="table-frame">
        <table className="data-table data-table--dense">
          <thead>
            <tr>
              <th scope="col">#</th>
              <th scope="col">Code</th>
              <th scope="col">Question</th>
              <th scope="col">Answer labels</th>
              {editable && (
                <th scope="col">
                  <span className="sr-only">Reorder</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {ordered.map((q, i) => (
              <tr key={q.id}>
                <td className="text-ink-muted tabular-nums">{q.display_order}</td>
                <td className="mono">{q.external_question_code}</td>
                <td>{q.question_text}</td>
                <td>
                  {editingId === q.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        aria-label="Label for 0"
                        value={zeroLabel}
                        onChange={(e) => setZeroLabel(e.target.value)}
                        className="input input-compact w-28"
                      />
                      <input
                        aria-label="Label for 1"
                        value={oneLabel}
                        onChange={(e) => setOneLabel(e.target.value)}
                        className="input input-compact w-28"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveLabels(q.id)}
                        className="btn btn-sm btn-primary"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="btn btn-sm btn-secondary"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="text-ink-secondary">
                      {q.response_zero_label} / {q.response_one_label}
                      {editable && !hasResponses && (
                        <button
                          type="button"
                          onClick={() => startLabelEdit(q)}
                          className="link ml-2 font-medium"
                        >
                          Edit
                        </button>
                      )}
                    </span>
                  )}
                </td>
                {editable && (
                  <td>
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Move question ${q.display_order} up`}
                        disabled={busy || i === 0}
                        onClick={() => swap(i, -1)}
                        className="btn btn-sm btn-secondary px-2"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move question ${q.display_order} down`}
                        disabled={busy || i === ordered.length - 1}
                        onClick={() => swap(i, 1)}
                        className="btn btn-sm btn-secondary px-2"
                      >
                        ↓
                      </button>
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p role="alert" className="banner banner-critical mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
