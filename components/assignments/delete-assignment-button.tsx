"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  deleteAssignmentPermanently,
  getAssignmentDeletionCounts,
} from "@/lib/assignments/actions";
import {
  DestructiveConfirmDialog,
  type SummaryResult,
} from "@/components/ui/destructive-confirm-dialog";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function DeleteAssignmentButton({
  assignmentId,
  classId,
}: {
  assignmentId: string;
  classId: string;
}) {
  const router = useRouter();

  const loadSummary = useCallback(async (): Promise<SummaryResult> => {
    const result = await getAssignmentDeletionCounts(assignmentId);
    if (!result.success) return { success: false, error: result.error };
    const c = result.data;
    return {
      success: true,
      data: {
        // The count that matters is the one that cannot be recreated.
        // Questions come from a spreadsheet that still exists; the
        // students' answers do not exist anywhere else.
        headline:
          `This will permanently delete “${c.title}” and ` +
          `${plural(c.responses, "student response", "student responses")}. ` +
          `This cannot be undone.`,
        items: [
          { label: "Questions", value: c.questions },
          { label: "Student responses", value: c.responses },
          { label: "Attempts", value: c.attempts },
          { label: "Students who answered", value: c.students },
          { label: "Import records", value: c.imports },
        ],
      },
    };
  }, [assignmentId]);

  const onConfirm = useCallback(async () => {
    const result = await deleteAssignmentPermanently(assignmentId);
    if (!result.success) return { success: false as const, error: result.error };
    toast.success(`Deleted “${result.data.title}” and everything attached to it.`);
    return { success: true as const };
  }, [assignmentId]);

  return (
    <DestructiveConfirmDialog
      triggerLabel="Delete permanently"
      title="Delete this assignment?"
      confirmLabel="Delete assignment"
      loadSummary={loadSummary}
      onConfirm={onConfirm}
      // The page this button sits on describes a row that no longer
      // exists, so leave it rather than refreshing into a 404.
      onDeleted={() => {
        router.push(`/classes/${classId}/assignments`);
        router.refresh();
      }}
    />
  );
}
