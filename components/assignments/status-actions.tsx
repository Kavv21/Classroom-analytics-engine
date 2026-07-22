"use client";

import { useState } from "react";
import { toast } from "sonner";
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

  /** What the professor just did, said back in the same words. */
  const DONE_MESSAGES: Partial<Record<AssignmentStatus, string>> = {
    READY: "Marked ready to publish. Students still can't see it yet.",
    OPEN: "Published. Students can now open this assignment.",
    CLOSED: "Closed. Students can no longer submit.",
    ARCHIVED: "Archived.",
    DRAFT: "Back in draft. You can edit the questions again.",
  };

  async function move(to: AssignmentStatus) {
    setError(null);
    setBusy(true);
    const result = await transitionAssignment(assignmentId, to);
    setBusy(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    const done = DONE_MESSAGES[to];
    if (done) toast.success(done);
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

  return (
    <div className="space-y-3">
      {status === "DRAFT" && (
        <div className="card-standard">
          {questionCount === 0 ? (
            <p className="note">
              Import your questions before you can mark this assignment ready.
            </p>
          ) : (
            <>
              <label className="flex items-start gap-2 text-sm">
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
                className="btn btn-primary mt-4"
              >
                Mark ready to publish
              </button>
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "READY" && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => move("OPEN")}
              className="btn btn-primary"
            >
              Publish to students
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => move("DRAFT")}
              className="btn btn-secondary"
            >
              Back to draft
            </button>
          </>
        )}
        {status === "OPEN" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => move("CLOSED")}
            className="btn btn-primary"
          >
            Close assignment
          </button>
        )}
        {status === "CLOSED" && (
          <button
            type="button"
            disabled={busy}
            onClick={() => move("ARCHIVED")}
            className="btn btn-secondary"
          >
            Archive assignment
          </button>
        )}
        {status !== "ARCHIVED" && (
          <button type="button" disabled={busy} onClick={duplicate} className="btn btn-secondary">
            Duplicate
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="banner banner-critical">
          {error}
        </p>
      )}
    </div>
  );
}
