"use client";

import { useState } from "react";
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
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isLoading}
        className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-60"
      >
        {isLoading ? "Saving…" : isArchived ? "Unarchive class" : "Archive class"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
