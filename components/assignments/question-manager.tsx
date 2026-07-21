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
      <p className="mt-2 text-sm text-gray-600">
        No questions yet — import a spreadsheet to add them.
      </p>
    );
  }

  return (
    <div className="mt-4">
      {hasResponses && (
        <p className="mb-2 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Students have already responded, so question wording and labels are
          locked. Reordering is still allowed. To change questions, duplicate
          the assignment as a new version.
        </p>
      )}
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 font-medium text-gray-600">#</th>
              <th className="px-3 py-2 font-medium text-gray-600">Code</th>
              <th className="px-3 py-2 font-medium text-gray-600">Question</th>
              <th className="px-3 py-2 font-medium text-gray-600">Answer labels</th>
              {editable && <th className="px-3 py-2 font-medium text-gray-600" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordered.map((q, i) => (
              <tr key={q.id}>
                <td className="px-3 py-2 text-gray-500">{q.display_order}</td>
                <td className="px-3 py-2 font-mono text-xs">{q.external_question_code}</td>
                <td className="px-3 py-2">{q.question_text}</td>
                <td className="px-3 py-2">
                  {editingId === q.id ? (
                    <span className="flex items-center gap-2">
                      <input
                        aria-label="Label for 0"
                        value={zeroLabel}
                        onChange={(e) => setZeroLabel(e.target.value)}
                        className="w-28 rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                      <input
                        aria-label="Label for 1"
                        value={oneLabel}
                        onChange={(e) => setOneLabel(e.target.value)}
                        className="w-28 rounded border border-gray-300 px-2 py-1 text-xs"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => saveLabels(q.id)}
                        className="text-xs font-medium text-blue-600 hover:underline disabled:opacity-60"
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="text-xs text-gray-500 hover:underline"
                      >
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="text-xs text-gray-600">
                      {q.response_zero_label} / {q.response_one_label}
                      {editable && !hasResponses && (
                        <button
                          type="button"
                          onClick={() => startLabelEdit(q)}
                          className="ml-2 font-medium text-blue-600 hover:underline"
                        >
                          Edit
                        </button>
                      )}
                    </span>
                  )}
                </td>
                {editable && (
                  <td className="px-3 py-2">
                    <span className="flex gap-1">
                      <button
                        type="button"
                        aria-label={`Move question ${q.display_order} up`}
                        disabled={busy || i === 0}
                        onClick={() => swap(i, -1)}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move question ${q.display_order} down`}
                        disabled={busy || i === ordered.length - 1}
                        onClick={() => swap(i, 1)}
                        className="rounded border border-gray-300 px-2 py-0.5 text-xs disabled:opacity-40"
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
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
