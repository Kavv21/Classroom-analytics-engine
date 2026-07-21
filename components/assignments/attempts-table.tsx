"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { reopenAttempt } from "@/lib/attempts/actions";

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

const STATE_STYLES: Record<string, string> = {
  NOT_STARTED: "bg-gray-100 text-gray-600",
  DRAFT: "bg-blue-100 text-blue-700",
  SUBMITTED: "bg-green-100 text-green-700",
  REOPENED: "bg-amber-100 text-amber-800",
  RESUBMITTED: "bg-green-100 text-green-800",
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
      return;
    }
    router.refresh();
  }

  if (attempts.length === 0) {
    return <p className="mt-2 text-sm text-gray-600">No attempts yet.</p>;
  }

  return (
    <div className="mt-3">
      <div className="overflow-x-auto rounded border border-gray-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-2 font-medium text-gray-600">Student</th>
              <th className="px-3 py-2 font-medium text-gray-600">State</th>
              <th className="px-3 py-2 font-medium text-gray-600">Submitted</th>
              <th className="px-3 py-2 font-medium text-gray-600">Version</th>
              <th className="px-3 py-2 font-medium text-gray-600" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {attempts.map((a) => (
              <tr key={a.id}>
                <td className="px-3 py-2">
                  <p>{a.studentName}</p>
                  <p className="text-xs text-gray-500">{a.studentEmail}</p>
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${STATE_STYLES[a.state] ?? ""}`}
                  >
                    {a.state}
                  </span>
                </td>
                <td className="px-3 py-2 text-gray-600">
                  {a.submitted_at ? new Date(a.submitted_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 text-gray-600">{a.submission_version}</td>
                <td className="px-3 py-2">
                  {a.state === "SUBMITTED" && (
                    <button
                      type="button"
                      disabled={busyId === a.id}
                      onClick={() => void reopen(a.id)}
                      className="rounded border border-gray-300 px-3 py-1 text-xs font-medium hover:bg-gray-50 disabled:opacity-60"
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
        <p role="alert" className="mt-2 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
