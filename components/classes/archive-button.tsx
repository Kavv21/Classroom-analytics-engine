"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { archiveClass, unarchiveClass } from "@/lib/classes/actions";
import type { ClassStatus } from "@/lib/types/domain";

export function ArchiveButton({ classId, status }: { classId: string; status: ClassStatus }) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isArchived = status === "ARCHIVED";

  async function handleClick() {
    if (!isArchived && !window.confirm("Archive this class? Students will no longer see it as active.")) {
      return;
    }
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

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="btn btn-sm btn-secondary"
      >
        {isLoading
          ? "Saving…"
          : isArchived
            ? "Restore class"
            : "Archive class"}
      </button>
      {error && (
        <p role="alert" className="banner banner-critical mt-2">
          {error}
        </p>
      )}
    </div>
  );
}
