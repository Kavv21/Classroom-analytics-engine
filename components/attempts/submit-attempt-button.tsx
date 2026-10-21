"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { submitAttempt } from "@/lib/attempts/actions";
import { clearPending } from "@/lib/attempts/local-store";
import { describeSubmitFailure } from "@/lib/attempts/save-failure";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SubmitAttemptButtonProps {
  attemptId: string;
  /** Serializable path string (never a function across the boundary). */
  receiptPath: string;
  unansweredCount: number;
  /**
   * Makes sure every answer has reached the database before submitting.
   * Resolves to null when it has, or to a sentence for the student when it
   * hasn't — in which case nothing is submitted.
   */
  ensureSaved?: () => Promise<string | null>;
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
  ensureSaved,
}: SubmitAttemptButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doSubmit() {
    setError(null);
    setBusy(true);

    const unsaved = ensureSaved ? await ensureSaved() : null;
    if (unsaved) {
      setBusy(false);
      setError(unsaved);
      return;
    }

    let result: Awaited<ReturnType<typeof submitAttempt>>;
    try {
      result = await submitAttempt(attemptId);
    } catch {
      // No action result came back (network, or a rate-limit / error page
      // in front of the action). Never show what the framework says.
      result = { success: false, error: describeSubmitFailure("TEMPORARY"), code: "TEMPORARY" };
    }
    setBusy(false);

    if (!result.success) {
      if (result.code === "ALREADY_SUBMITTED") {
        clearPending(attemptId);
        router.push(receiptPath);
        router.refresh();
        return;
      }
      setError(result.error);
      toast.error(result.error);
      return;
    }

    clearPending(attemptId);
    router.push(receiptPath);
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {/* Still two deliberate steps: open the dialog, then confirm. The
          dialog replaces the inline panel but not the two-click contract,
          and nothing else in the app can reach submitAttempt. */}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogTrigger asChild>
          <Button>Submit assignment</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Submit your answers now?</AlertDialogTitle>
            <AlertDialogDescription>
              {unansweredCount > 0 && (
                <span className="font-medium">
                  {unansweredCount} question{unansweredCount === 1 ? " is" : "s are"} still
                  unanswered and will be recorded as unanswered.{" "}
                </span>
              )}
              You won&rsquo;t be able to change answers unless your professor
              reopens the attempt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                // Keep the dialog open while the request is in flight so a
                // failure is not hidden behind a closing animation.
                e.preventDefault();
                void doSubmit();
              }}
            >
              {busy ? "Submitting…" : "Yes, submit now"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <p role="alert" className="banner banner-critical">
          {error}
        </p>
      )}
    </div>
  );
}
