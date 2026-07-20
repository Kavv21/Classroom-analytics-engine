"use client";

import { useState } from "react";
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
        className={`rounded px-2 py-1 text-xs font-medium disabled:opacity-60 ${
          isActive ? "bg-gray-100 text-gray-700 hover:bg-gray-200" : "bg-green-100 text-green-700 hover:bg-green-200"
        }`}
      >
        {isLoading ? "Saving…" : isActive ? "Deactivate" : "Activate"}
      </button>
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
