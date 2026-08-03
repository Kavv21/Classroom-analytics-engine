"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  duplicateAssignment,
  transitionAssignment,
  unarchiveAssignment,
} from "@/lib/assignments/actions";
import type { AssignmentStatus } from "@/lib/types/domain";
import { Busy } from "@/components/ui/busy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";

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
    setBusy(true);
    const result = await transitionAssignment(assignmentId, to);
    setBusy(false);
    if (!result.success) {
      // A rejected transition used to fail silently here: the button
      // re-enabled and nothing else happened, which reads as "the click
      // didn't register" rather than "the server said no".
      toast.error(result.error);
      return;
    }
    // CLOSED -> OPEN is a reopen, not a first publication, and saying
    // "Published" there would misdescribe what the class just saw.
    const done =
      to === "OPEN" && status === "CLOSED"
        ? "Reopened. Students can answer this assignment again."
        : DONE_MESSAGES[to];
    if (done) toast.success(done);
    router.refresh();
  }

  async function duplicate() {
    setBusy(true);
    const result = await duplicateAssignment(assignmentId);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.push(`/classes/${classId}/assignments/${result.data.id}`);
    router.refresh();
  }

  /**
   * ARCHIVED -> CLOSED. Not part of `move`, because it is not part of the
   * FSM: `assignments_status_transition` (migration 0009) has no path out
   * of ARCHIVED at all, and this goes through the dedicated
   * `unarchive_assignment` RPC instead.
   */
  async function unarchive() {
    setBusy(true);
    const result = await unarchiveAssignment(assignmentId);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Restored. The assignment is closed — reopen it to let students answer.");
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {status === "DRAFT" && (
        <Card>
          <CardContent>
            <p className="eyebrow">Final step</p>
            {questionCount === 0 ? (
              <p className="note mt-1">
                Import your questions before you can mark this assignment ready.
              </p>
            ) : (
              <>
                <p className="heading mt-1">Review before publishing</p>
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <Checkbox
                    checked={reviewConfirmed}
                    onCheckedChange={(v) => setReviewConfirmed(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    I have reviewed all {questionCount} question
                    {questionCount === 1 ? "" : "s"} below and approve this list.
                  </span>
                </label>
                <Button
                  disabled={busy || !reviewConfirmed}
                  onClick={() => move("READY")}
                  className="mt-4"
                >
                  Mark ready to publish
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {status === "READY" && (
        <Card>
          <CardContent>
            <p className="eyebrow">Final step</p>
            <p className="heading mt-1">Ready to publish</p>
            <p className="note mt-1">
              Students will be able to open this assignment as soon as you publish it.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => move("OPEN")}>
                Publish to students
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => move("DRAFT")}>
                Back to draft
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {status === "CLOSED" && (
        <Card>
          <CardContent>
            <p className="eyebrow">Closed</p>
            <p className="heading mt-1">Students can&apos;t answer right now</p>
            <p className="note mt-1">
              Reopening puts this assignment back in front of the whole class:
              anyone who hasn&apos;t submitted can carry on, and anyone whose
              attempt you reopened individually can submit again. To let just
              one student back in, leave it closed and use Reopen on their row
              under Student attempts.
            </p>
            <Button disabled={busy} onClick={() => move("OPEN")} className="mt-4">
              Reopen to students
            </Button>
          </CardContent>
        </Card>
      )}

      {status === "ARCHIVED" && (
        <Card>
          <CardContent>
            <p className="eyebrow">Archived</p>
            <p className="heading mt-1">Out of play</p>
            <p className="note mt-1">
              Archived assignments are hidden from students and give up their
              first/second position in the class. Restoring puts this one back
              as <strong>closed</strong>, exactly as it was before it was
              archived &mdash; students still can&apos;t answer until you reopen
              it.
            </p>
            <Button disabled={busy} onClick={unarchive} className="mt-4">
              {busy ? <Busy label="Restoring…" /> : "Restore assignment"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {status === "OPEN" && (
          <Button disabled={busy} onClick={() => move("CLOSED")}>
            Close assignment
          </Button>
        )}
        {status === "CLOSED" && (
          <Button variant="outline" disabled={busy} onClick={() => move("ARCHIVED")}>
            Archive assignment
          </Button>
        )}
        {status !== "ARCHIVED" && (
          <Button variant="outline" disabled={busy} onClick={duplicate}>
            Duplicate
          </Button>
        )}
      </div>
    </div>
  );
}
