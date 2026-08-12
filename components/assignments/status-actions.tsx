"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  duplicateAssignment,
  transitionAssignment,
  unarchiveAssignment,
} from "@/lib/assignments/actions";
import type { AssignmentStatus } from "@/lib/types/domain";
import type { EffectiveStatus } from "@/lib/assignments/schedule";
import { Busy } from "@/components/ui/busy";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { LocalDateTime } from "@/components/ui/local-date-time";

interface StatusActionsProps {
  assignmentId: string;
  classId: string;
  status: AssignmentStatus;
  questionCount: number;
  /**
   * Computed server-side (see EffectiveStatusBadge) — this component must
   * not derive it, because deriving it needs `now()` and this runs on both
   * sides of hydration.
   */
  effective: EffectiveStatus;
  openAt: string | null;
  closeAt: string | null;
  /** Where the schedule is edited. */
  editHref: string;
}

/**
 * Approve / schedule / retire / archive / duplicate.
 *
 * WHAT CHANGED, AND WHY THE PUBLISH BUTTON IS GONE
 * There used to be a "Publish to students" button (READY -> OPEN) and a
 * "Close assignment" button (OPEN -> CLOSED), and those two clicks were the
 * only thing that decided whether a class could answer. `open_at` and
 * `close_at` were collected by the form and enforced nowhere, so a
 * professor who filled them in had every reason to believe the assignment
 * would open and close on its own, and it did not.
 *
 * The dates are now the mechanism (migration 0029), so the button that
 * competed with them is gone rather than sitting alongside them offering a
 * second, contradictory answer.
 *
 * What is deliberately NOT gone:
 *   * DRAFT -> READY. Still manual, still behind "I have reviewed all N
 *     questions". Scheduling happens after approval, never instead of it.
 *   * "Close to students now". A window is not a way to retire something:
 *     ARCHIVED is reachable only from CLOSED, so without this an assignment
 *     could never be put away. It is framed as retiring, and the professor
 *     is pointed at the close date for the ordinary "end it early" case.
 *   * Archive / restore / duplicate / delete, all untouched.
 */
export function StatusActions({
  assignmentId,
  classId,
  status,
  questionCount,
  effective,
  openAt,
  closeAt,
  editHref,
}: StatusActionsProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  /** What the professor just did, said back in the same words. */
  const DONE_MESSAGES: Partial<Record<AssignmentStatus, string>> = {
    READY: "Marked ready. Set the schedule and it will open on its own.",
    CLOSED: "Closed. Students can no longer answer, whatever the dates say.",
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
    const done =
      to === "READY" && status === "CLOSED"
        ? "Back on the calendar. Set a new window to let students in again."
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
   * FSM: `assignments_status_transition` has no path out of ARCHIVED at
   * all, and this goes through the dedicated `unarchive_assignment` RPC.
   */
  async function unarchive() {
    setBusy(true);
    const result = await unarchiveAssignment(assignmentId);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Restored. The assignment is closed — reschedule it to let students answer.");
    router.refresh();
  }

  // Keyed on whether a window exists at all, not on the effective status: a
  // legacy OPEN assignment with no dates is "open", and still has nothing
  // to change — it has a schedule to set.
  const scheduled = !!openAt && !!closeAt;
  const scheduleLink = (
    <Button asChild variant={scheduled ? "outline" : "default"}>
      <Link href={editHref}>{scheduled ? "Change the schedule" : "Set the schedule"}</Link>
    </Button>
  );

  return (
    <div className="space-y-3">
      {status === "DRAFT" && (
        <Card>
          <CardContent>
            <p className="eyebrow">Step 1 of 2</p>
            {questionCount === 0 ? (
              <p className="note mt-1">
                Import your questions before you can mark this assignment ready.
              </p>
            ) : (
              <>
                <p className="heading mt-1">Review, then schedule</p>
                <p className="note mt-1">
                  Approving the question list comes first &mdash; you can only
                  put an assignment on the calendar once you have signed off on
                  what it asks.
                </p>
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
                  Mark ready to schedule
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {(status === "READY" || status === "OPEN") && (
        <Card>
          <CardContent>
            <p className="eyebrow">{scheduled ? "Schedule" : "Step 2 of 2"}</p>

            {effective.kind === "NOT_SCHEDULED" && (
              <>
                <p className="heading mt-1">Not scheduled yet</p>
                <p className="note mt-1">
                  The questions are approved, but nobody can reach this
                  assignment until it has both an opening and a closing time.
                  There is no publish button any more &mdash; the dates are what
                  let students in, and it opens and closes on its own.
                </p>
              </>
            )}

            {effective.kind === "SCHEDULED" && (
              <>
                <p className="heading mt-1">
                  Opens <LocalDateTime value={openAt} />
                </p>
                <p className="note mt-1">
                  Students can see that this assignment is coming, but not its
                  questions. It lets them in by itself at the opening time and
                  stops accepting answers at <LocalDateTime value={closeAt} />.
                </p>
              </>
            )}

            {effective.kind === "OPEN" && (
              <>
                <p className="heading mt-1">
                  {closeAt ? (
                    <>
                      Open until <LocalDateTime value={closeAt} />
                    </>
                  ) : (
                    "Open to students"
                  )}
                </p>
                <p className="note mt-1">
                  {closeAt
                    ? "Students are answering it now. It stops accepting answers at that time on its own — to end it sooner or run it longer, change the closing time."
                    : "Published under the old manual model, with no end date: it stays open until you close it. Give it an opening and closing time to put it on the calendar instead."}
                </p>
              </>
            )}

            {effective.kind === "WINDOW_PASSED" && (
              <>
                <p className="heading mt-1">
                  Window ended <LocalDateTime value={closeAt} />
                </p>
                <p className="note mt-1">
                  Students can no longer answer. Extend the closing time to let
                  the class back in, reopen one student&apos;s attempt under
                  Student attempts, or close it for good below.
                </p>
              </>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {scheduleLink}
              {status === "READY" && (
                <Button variant="outline" disabled={busy} onClick={() => move("DRAFT")}>
                  Back to draft
                </Button>
              )}
              <Button variant="outline" disabled={busy} onClick={() => move("CLOSED")}>
                Close to students now
              </Button>
            </div>
            <p className="note-muted mt-2">
              Closing retires the assignment whatever the dates say, and is the
              step before archiving. To simply end it early, change the closing
              time instead.
            </p>
          </CardContent>
        </Card>
      )}

      {status === "CLOSED" && (
        <Card>
          <CardContent>
            <p className="eyebrow">Closed</p>
            <p className="heading mt-1">Students can&apos;t answer right now</p>
            <p className="note mt-1">
              Putting it back on the calendar returns it to the whole class:
              anyone who hasn&apos;t submitted can carry on for as long as the
              new window lasts. To let just one student back in, leave it closed
              and use Reopen on their row under Student attempts.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button disabled={busy} onClick={() => move("READY")}>
                Reschedule
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => move("ARCHIVED")}>
                Archive assignment
              </Button>
            </div>
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
              archived &mdash; students still can&apos;t answer until you
              reschedule it.
            </p>
            <Button disabled={busy} onClick={unarchive} className="mt-4">
              {busy ? <Busy label="Restoring…" /> : "Restore assignment"}
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        {status !== "ARCHIVED" && (
          <Button variant="outline" disabled={busy} onClick={duplicate}>
            Duplicate
          </Button>
        )}
      </div>
    </div>
  );
}
