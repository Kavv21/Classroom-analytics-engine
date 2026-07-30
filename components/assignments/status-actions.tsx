"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  duplicateAssignment,
  transitionAssignment,
} from "@/lib/assignments/actions";
import type { AssignmentStatus } from "@/lib/types/domain";
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
      return;
    }
    const done = DONE_MESSAGES[to];
    if (done) toast.success(done);
    router.refresh();
  }

  async function duplicate() {
    setBusy(true);
    const result = await duplicateAssignment(assignmentId);
    setBusy(false);
    if (!result.success) {
      return;
    }
    router.push(`/classes/${classId}/assignments/${result.data.id}`);
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
