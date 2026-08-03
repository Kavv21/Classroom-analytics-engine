"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Busy } from "@/components/ui/busy";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/** The word, exactly. Case-sensitive on purpose — see below. */
const CONFIRM_WORD = "DELETE";

export interface DestructiveSummary {
  /** One sentence naming the thing and what goes with it. */
  headline: string;
  /** The full census, one row per category. Zeroes are kept: "0 responses"
   *  is a fact the professor is entitled to see before deciding, and
   *  hiding it would make an empty assignment look like an unmeasured one. */
  items: Array<{ label: string; value: number }>;
}

export type SummaryResult =
  | { success: true; data: DestructiveSummary }
  | { success: false; error: string };

export type ConfirmResult = { success: true } | { success: false; error: string };

interface DestructiveConfirmDialogProps {
  /** Text on the button that opens the dialog. */
  triggerLabel: string;
  title: string;
  /** Text on the final button, e.g. "Delete assignment". */
  confirmLabel: string;
  /**
   * Fetched when the dialog OPENS, not when the page renders. The counts
   * are the whole basis of the decision, and a number baked in at render
   * time can be minutes stale by the time someone clicks — long enough
   * for a class to have submitted into it.
   */
  loadSummary: () => Promise<SummaryResult>;
  onConfirm: () => Promise<ConfirmResult>;
  /** Runs after a successful confirm, with the dialog already closed. */
  onDeleted?: () => void;
  disabled?: boolean;
}

/**
 * Type-to-confirm dialog for irreversible actions. Used by both the
 * assignment and the class delete paths — the class one destroys strictly
 * more, but the gesture, the wording pattern and the guard are the same,
 * and two near-identical dialogs would drift apart exactly where they
 * must not.
 *
 * WHY TYPING, AND WHY CASE-SENSITIVE
 * A second "are you sure?" button is answered by the same reflex that hit
 * the first one. Typing a specific word cannot be done by reflex — it
 * requires reading. Accepting "delete" lowercase would give most of that
 * back, since it is what someone types without looking at the prompt.
 *
 * The counts are shown BEFORE the input is reachable, so the census is
 * something the professor has to scroll past to act, not fine print under
 * the button.
 */
export function DestructiveConfirmDialog({
  triggerLabel,
  title,
  confirmLabel,
  loadSummary,
  onConfirm,
  onDeleted,
  disabled,
}: DestructiveConfirmDialogProps) {
  const [open, setOpen] = useState(false);
  const [summary, setSummary] = useState<DestructiveSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) return;
    // The dialog can be closed while its fetch is still in flight.
    // Landing that response would leave counts from a previous open
    // sitting in state, ready to be shown as if they were fresh.
    let cancelled = false;

    setTyped("");
    setSummary(null);
    setLoading(true);
    setError(null);

    void loadSummary().then((result) => {
      if (cancelled) return;
      setLoading(false);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSummary(result.data);
    });

    return () => {
      cancelled = true;
    };
  }, [open, loadSummary]);

  const confirmed = typed === CONFIRM_WORD;
  // Never armed before the counts have landed: the guard is "you have read
  // what this destroys", and there is nothing to have read yet.
  const canConfirm = confirmed && !!summary && !working;

  async function run() {
    if (!canConfirm) return;
    setWorking(true);
    setError(null);
    const result = await onConfirm();
    setWorking(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setOpen(false);
    onDeleted?.();
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !working && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <button type="button" disabled={disabled} className="btn btn-sm btn-danger">
          {triggerLabel}
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div>
              {loading && <Busy label="Counting what this would delete…" className="note" />}
              {summary && <p>{summary.headline}</p>}
              {!loading && !summary && !error && (
                <p className="note">Counting what this would delete…</p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {summary && (
          <>
            <dl className="table-frame divide-y divide-hairline bg-surface-raised text-sm">
              {summary.items.map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 px-3 py-1.5">
                  <dt className="note-muted">{item.label}</dt>
                  <dd className="font-semibold tabular-nums">{item.value}</dd>
                </div>
              ))}
            </dl>

            <div>
              <Label htmlFor="destructive-confirm-input" className="text-sm">
                Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
              </Label>
              <Input
                id="destructive-confirm-input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={working}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby="destructive-confirm-hint"
                className="mt-2 font-mono"
              />
              <p id="destructive-confirm-hint" className="note-muted mt-1.5">
                {confirmed
                  ? "This cannot be undone."
                  : `Capital letters, exactly as shown.`}
              </p>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="banner banner-critical">
            {error}
          </p>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
          {/* Deliberately NOT an AlertDialogAction: that closes the dialog
              on click, which would dismiss the error message if the delete
              failed. This one stays open until the work has succeeded. */}
          <Button variant="destructive" disabled={!canConfirm} onClick={run}>
            {working ? <Busy label="Deleting…" /> : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
