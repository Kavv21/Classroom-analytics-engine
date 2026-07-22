"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitAttempt } from "@/lib/attempts/actions";
import { clearPending } from "@/lib/attempts/local-store";

interface SubmitAttemptButtonProps {
  attemptId: string;
  /** Serializable path string (never a function across the boundary). */
  receiptPath: string;
  unansweredCount: number;
}

/**
 * The ONLY way an attempt gets submitted: two explicit clicks (submit, then
 * confirm). No browser event, timer, or lifecycle hook calls submitAttempt
 * anywhere in the codebase (EXCLUDED_FEATURES.md — no auto-submission).
 * Double-clicks are harmless: the button disables while in flight, and the
 * DB row-lock rejects a second submission with ALREADY_SUBMITTED, which we
 * treat as "go to the receipt".
 */
export function SubmitAttemptButton({
  attemptId,
  receiptPath,
  unansweredCount,
}: SubmitAttemptButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSubmit() {
    setError(null);
    setBusy(true);
    const result = await submitAttempt(attemptId);
    setBusy(false);

    if (!result.success) {
      if (result.error === "ALREADY_SUBMITTED") {
        clearPending(attemptId);
        router.push(receiptPath);
        router.refresh();
        return;
      }
      setError(result.error);
      return;
    }

    clearPending(attemptId);
    router.push(receiptPath);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} className="btn btn-primary">
          Submit assignment
        </button>
      ) : (
        <div className="banner banner-info">
          <p>
            Submit your answers now?
            {unansweredCount > 0 && (
              <span className="font-medium">
                {" "}
                {unansweredCount} question{unansweredCount === 1 ? " is" : "s are"} still
                unanswered and will be recorded as unanswered.
              </span>
            )}{" "}
            You won&rsquo;t be able to change answers unless your professor reopens the
            attempt.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void doSubmit()}
              className="btn btn-sm btn-primary"
            >
              {busy ? "Submitting…" : "Yes, submit now"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              className="btn btn-sm btn-secondary"
            >
              Keep editing
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="banner banner-critical">
          We couldn&rsquo;t submit: {error} Your answers are still saved — try again.
        </p>
      )}
    </div>
  );
}
