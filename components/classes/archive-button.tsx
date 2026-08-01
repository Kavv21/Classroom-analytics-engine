"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { archiveClass, unarchiveClass } from "@/lib/classes/actions";
import type { ClassStatus } from "@/lib/types/domain";
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

/**
 * Archive / restore a class.
 *
 * The confirmation is an AlertDialog rather than window.confirm: a native
 * confirm is OS chrome, so it carries none of the design tokens, no focus
 * ring, and no serif/eyebrow treatment — it was the only dialog in the app
 * that did not look like the others (see admin/user-table and
 * attempts/submit-attempt-button for the same pattern).
 *
 * Restoring stays a plain button. It is not destructive and never asked for
 * confirmation; adding one here would be a behaviour change, not a restyle.
 */
export function ArchiveButton({ classId, status }: { classId: string; status: ClassStatus }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isArchived = status === "ARCHIVED";

  async function run() {
    setIsLoading(true);
    setError(null);
    const result = isArchived ? await unarchiveClass(classId) : await archiveClass(classId);
    setIsLoading(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success(isArchived ? "Class restored." : "Class archived.");
    router.refresh();
  }

  const label = isLoading ? "Saving…" : isArchived ? "Restore class" : "Archive class";

  return (
    <div>
      {isArchived ? (
        <button
          type="button"
          onClick={run}
          disabled={isLoading}
          className="btn btn-sm btn-secondary"
        >
          {label}
        </button>
      ) : (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button type="button" disabled={isLoading} className="btn btn-sm btn-secondary">
              {label}
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive this class?</AlertDialogTitle>
              <AlertDialogDescription>
                Students will no longer see it as active. Existing responses are
                kept and nothing is deleted &mdash; you can restore the class at
                any time.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={run}>Archive class</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {error && (
        <p role="alert" className="banner banner-critical mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
