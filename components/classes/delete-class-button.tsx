"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { deleteClassPermanently, getClassDeletionCounts } from "@/lib/classes/actions";
import {
  DestructiveConfirmDialog,
  type SummaryResult,
} from "@/components/ui/destructive-confirm-dialog";

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export function DeleteClassButton({ classId }: { classId: string }) {
  const router = useRouter();

  const loadSummary = useCallback(async (): Promise<SummaryResult> => {
    const result = await getClassDeletionCounts(classId);
    if (!result.success) return { success: false, error: result.error };
    const c = result.data;
    return {
      success: true,
      data: {
        headline:
          `This will permanently delete “${c.name}”, ` +
          `${plural(c.assignments, "assignment", "assignments")} and ` +
          `${plural(c.responses, "student response", "student responses")}. ` +
          `This cannot be undone.`,
        items: [
          { label: "Assignments", value: c.assignments },
          { label: "Questions", value: c.questions },
          { label: "Student responses", value: c.responses },
          { label: "Attempts", value: c.attempts },
          { label: "Enrolled students", value: c.students },
          { label: "Roster entries awaiting sign-in", value: c.rosterEntries },
          { label: "Saved queries, charts and dashboards", value: c.savedViews },
        ],
      },
    };
  }, [classId]);

  const onConfirm = useCallback(async () => {
    const result = await deleteClassPermanently(classId);
    if (!result.success) return { success: false as const, error: result.error };
    toast.success(`Deleted “${result.data.name}” and everything in it.`);
    return { success: true as const };
  }, [classId]);

  return (
    <DestructiveConfirmDialog
      triggerLabel="Delete class permanently"
      title="Delete this class?"
      confirmLabel="Delete class"
      loadSummary={loadSummary}
      onConfirm={onConfirm}
      onDeleted={() => {
        router.push("/classes");
        router.refresh();
      }}
    />
  );
}
