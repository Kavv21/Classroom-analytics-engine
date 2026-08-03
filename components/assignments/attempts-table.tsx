"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { reopenAttempt } from "@/lib/attempts/actions";
import { attemptStateLabel } from "@/lib/ui/labels";

export interface AttemptTableRow {
  id: string;
  state: string;
  submitted_at: string | null;
  reopened_at: string | null;
  submission_version: number;
  studentName: string;
  studentEmail: string;
}

interface AttemptsTableProps {
  classId: string;
  assignmentId: string;
  attempts: AttemptTableRow[];
}

/**
 * One hue per attempt state, so a professor can scan the column. These are
 * workflow states, not marks: SUBMITTED is not "good" and NOT_STARTED is
 * not "bad", and no student answer is encoded here. Every cell renders the
 * state in words next to the colour (WCAG 1.4.1).
 */
const STATE_TONES: Record<string, string> = {
  NOT_STARTED: "badge badge-neutral",
  DRAFT: "badge badge-amber",
  SUBMITTED: "badge badge-green",
  REOPENED: "badge badge-purple",
  RESUBMITTED: "badge badge-blue",
};

/** Professor view of per-student attempts, with the reopen action (the only
 * side of reopening — students cannot reopen their own attempts). */
export function AttemptsTable({ classId, assignmentId, attempts }: AttemptsTableProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function reopen(attemptId: string) {
    setError(null);
    setBusyId(attemptId);
    const result = await reopenAttempt(attemptId, classId, assignmentId);
    setBusyId(null);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success("Attempt reopened. The student can submit again.");
    router.refresh();
  }

  if (attempts.length === 0) {
    return (
      <p className="banner mt-3">
        No students have opened this assignment yet.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="table-frame">
        <table className="data-table data-table--numeric">
          <thead>
            <tr>
              <th scope="col">Student</th>
              <th scope="col">Status</th>
              <th scope="col">Submitted</th>
              <th scope="col">Version</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id}>
                <td>
                  <p>{a.studentName}</p>
                  <p className="note-muted">{a.studentEmail}</p>
                </td>
                <td>
                  <span className={STATE_TONES[a.state] ?? "badge"}>
                    {attemptStateLabel(a.state)}
                  </span>
                </td>
                <td className="text-ink-secondary">
                  {a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "—"}
                </td>
                <td className="text-ink-secondary">{a.submission_version}</td>
                <td>
                  {a.state === "SUBMITTED" && (
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => void reopen(a.id)}
                      className="btn btn-sm btn-secondary"
                    >
                      {busyId === a.id ? "Reopening…" : "Reopen"}
                    </button>
                  )}
                </td>
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
