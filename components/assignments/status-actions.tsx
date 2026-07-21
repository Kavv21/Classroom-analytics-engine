"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  duplicateAssignment,
  transitionAssignment,
} from "@/lib/assignments/actions";
import type { AssignmentStatus } from "@/lib/types/domain";

interface StatusActionsProps {
  assignmentId: string;
  classId: string;
  status: AssignmentStatus;
  questionCount: number;
}

/**
 * Publish / close / archive / duplicate controls, plus the explicit
 * approval step: DRAFT -> READY is only offered once questions exist and
 * requires the professor to tick "I have reviewed all N questions" — the
 * "seen and approved the full question list" gate from the Phase 4 plan.
 */
export function StatusActions({ assignmentId, classId, status, questionCount }: StatusActionsProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  async function move(to: AssignmentStatus) {
    setError(null);
    setBusy(true);
    const result = await transitionAssignment(assignmentId, to);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.refresh();
  }

  async function duplicate() {
    setError(null);
    setBusy(true);
    const result = await duplicateAssignment(assignmentId);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    router.push(`/classes/${classId}/assignments/${result.data.id}`);
    router.refresh();
  }

  const buttonClass =
    "rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60";
  const secondaryClass =
    "rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-60";

  return (
    <div className="space-y-3">
      {status === "DRAFT" && (
        <div className="rounded border border-gray-200 p-4">
          {questionCount === 0 ? (
            <p className="text-sm text-gray-600">
              Import or add questions before this assignment can be approved.
            </p>
          ) : (
            <>
              <label className="flex items-start gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={reviewConfirmed}
                  onChange={(e) => setReviewConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I have reviewed all {questionCount} question
                  {questionCount === 1 ? "" : "s"} below and approve this list.
                </span>
              </label>
              <button
                type="button"
                disabled={busy || !reviewConfirmed}
                onClick={() => move("READY")}
                className={`${buttonClass} mt-3`}
              >
                Approve &amp; mark ready
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "READY" && (
          <>
            <button type="button" disabled={busy} onClick={() => move("OPEN")} className={buttonClass}>
              Publish (open to students)
            </button>
            <button type="button" disabled={busy} onClick={() => move("DRAFT")} className={secondaryClass}>
              Back to draft
            </button>
          </>
        )}
        {status === "OPEN" && (
          <button type="button" disabled={busy} onClick={() => move("CLOSED")} className={buttonClass}>
            Close assignment
          </button>
        )}
        {status === "CLOSED" && (
          <button type="button" disabled={busy} onClick={() => move("ARCHIVED")} className={secondaryClass}>
            Archive
          </button>
        )}
        {status !== "ARCHIVED" && (
          <button type="button" disabled={busy} onClick={duplicate} className={secondaryClass}>
            Duplicate
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
