"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { setStudentActive } from "@/lib/classes/actions";

export function StudentActiveToggle({
  classId,
  profileId,
  isActive,
}: {
  classId: string;
  profileId: string;
  isActive: boolean;
}) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setIsLoading(true);
    setError(null);
    const result = await setStudentActive(classId, profileId, !isActive);
    setIsLoading(false);
    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
      return;
    }
    toast.success(isActive ? "Student deactivated." : "Student reactivated.");
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
        {isLoading ? "Saving…" : isActive ? "Deactivate" : "Activate"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs" style={{ color: "var(--status-critical-text)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
