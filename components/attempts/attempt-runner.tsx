"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveResponses } from "@/lib/attempts/actions";
import {
  loadPending,
  mergeServerAndLocal,
  storePending,
  type PendingMap,
} from "@/lib/attempts/local-store";
import type { ResponseValue } from "@/lib/types/domain";

export interface TakingQuestion {
  id: string;
  externalQuestionCode: string;
  questionText: string;
  responseZeroLabel: string;
  responseOneLabel: string;
  displayOrder: number;
}

interface AttemptRunnerProps {
  attemptId: string;
  assignmentTitle: string;
  instructions: string | null;
  questions: TakingQuestion[];
  initialAnswers: Record<string, ResponseValue>;
  /** Serializable path string (never a function across the boundary). */
  reviewPath: string;
  allowDraftEditing: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

/**
 * The assignment-taking surface. Answer selections persist to localStorage
 * immediately, then a debounced batch save syncs them; failed saves stay in
 * the queue and retry on a timer and on reconnect.
 *
 * Deliberately absent (EXCLUDED_FEATURES.md — zero tolerance): listeners on
 * visibilitychange, blur, fullscreenchange, pagehide, or beforeunload, and
 * ANY call path to submission. This component cannot submit — it does not
 * even import the submit action; submission only happens on the review page
 * behind an explicit button. The single global listener is `online`, which
 * retries pending SAVES after a disconnect.
 */
export function AttemptRunner({
  attemptId,
  assignmentTitle,
  instructions,
  questions,
  initialAnswers,
  reviewPath,
  allowDraftEditing,
}: AttemptRunnerProps) {
  const router = useRouter();
  const ordered = useMemo(
    () => [...questions].sort((a, b) => a.displayOrder - b.displayOrder),
    [questions]
  );

  const [answers, setAnswers] = useState<Record<string, ResponseValue>>(initialAnswers);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [navError, setNavError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const answersRef = useRef(answers);
  const dirtyRef = useRef<Set<string>>(new Set());
  const pendingStoreRef = useRef<PendingMap>({});
  const savingRef = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    if (savingRef.current) return;
    const ids = [...dirtyRef.current];
    if (ids.length === 0) return;

    savingRef.current = true;
    setStatus("saving");
    setSaveError(null);

    const batch = ids.map((questionId) => ({
      questionId,
      value: answersRef.current[questionId] ?? null,
    }));

    let result: Awaited<ReturnType<typeof saveResponses>>;
    try {
      result = await saveResponses(attemptId, batch);
    } catch (err) {
      result = {
        success: false,
        error: err instanceof Error ? err.message : "Network error while saving.",
      };
    }
    savingRef.current = false;

    if (result.success) {
      for (const sent of batch) {
        // Only mark clean if the answer wasn't changed again mid-save.
        if (answersRef.current[sent.questionId] === sent.value) {
          dirtyRef.current.delete(sent.questionId);
          delete pendingStoreRef.current[sent.questionId];
        }
      }
      storePending(attemptId, pendingStoreRef.current);
      if (dirtyRef.current.size > 0) {
        scheduleFlush(DEBOUNCE_MS);
        return;
      }
      setStatus("saved");
    } else {
      setStatus("error");
      setSaveError(result.error);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      retryTimer.current = setTimeout(() => void flush(), RETRY_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const scheduleFlush = useCallback(
    (delay: number) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => void flush(), delay);
    },
    [flush]
  );

  // Restore any unsynced local draft on mount (refresh mid-assignment),
  // then push it to the server.
  useEffect(() => {
    const pending = loadPending(attemptId);
    const { answers: merged, dirtyIds } = mergeServerAndLocal(initialAnswers, pending);
    if (dirtyIds.length > 0) {
      pendingStoreRef.current = pending;
      dirtyRef.current = new Set(dirtyIds);
      answersRef.current = merged;
      setAnswers(merged);
      scheduleFlush(200);
    }

    // Reconnect => retry queued SAVES. This is the only global listener in
    // the taking flow; nothing here reacts to visibility, blur, fullscreen,
    // or unload, and nothing anywhere auto-submits.
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  const lockedQuestions = useMemo(() => {
    if (allowDraftEditing) return new Set<string>();
    return new Set(
      Object.entries(initialAnswers)
        .filter(([, v]) => v !== null)
        .map(([id]) => id)
    );
  }, [allowDraftEditing, initialAnswers]);

  function selectAnswer(questionId: string, value: ResponseValue) {
    if (lockedQuestions.has(questionId)) return;
    const next = { ...answersRef.current, [questionId]: value };
    answersRef.current = next;
    setAnswers(next);
    dirtyRef.current.add(questionId);
    pendingStoreRef.current[questionId] = { value, changedAt: Date.now() };
    storePending(attemptId, pendingStoreRef.current);
    setStatus("saving");
    scheduleFlush(DEBOUNCE_MS);
  }

  async function goToReview() {
    setNavError(null);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (dirtyRef.current.size > 0) {
      await flush();
    }
    if (dirtyRef.current.size > 0) {
      setNavError(
        "Your latest answers haven't reached the server yet — hold on, we're retrying. " +
          "Nothing is lost; they're saved in this browser."
      );
      return;
    }
    router.push(reviewPath);
  }

  const current = ordered[index];
  const answeredCount = ordered.filter((q) => (answers[q.id] ?? null) !== null).length;
  const unansweredCount = ordered.length - answeredCount;

  if (!current) {
    return <p className="text-sm text-gray-600">This assignment has no questions.</p>;
  }

  const currentAnswer = answers[current.id] ?? null;
  const locked = lockedQuestions.has(current.id);

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Save failed — retrying"
          : "";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{assignmentTitle}</h1>
        <p
          role="status"
          aria-live="polite"
          className={`text-sm font-medium ${
            status === "error"
              ? "text-red-600"
              : status === "saved"
                ? "text-green-700"
                : "text-gray-600"
          }`}
        >
          {statusLabel}
        </p>
      </div>

      {instructions && (
        <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          {instructions}
        </p>
      )}

      {saveError && status === "error" && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError} — your answers are kept in this browser and will retry automatically.
        </p>
      )}

      <div className="flex items-center justify-between text-sm text-gray-600">
        <span>
          Question {index + 1} of {ordered.length}
        </span>
        <span>
          Answered {answeredCount} · Unanswered {unansweredCount}
        </span>
      </div>

      <div className="rounded border border-gray-200 p-6">
        <p className="font-mono text-xs text-gray-500">{current.externalQuestionCode}</p>
        <p className="mt-2 text-lg">{current.questionText}</p>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {([0, 1] as const).map((value) => {
            const label = value === 0 ? current.responseZeroLabel : current.responseOneLabel;
            const selected = currentAnswer === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                disabled={locked}
                onClick={() => selectAnswer(current.id, value)}
                className={`rounded-lg border-2 px-6 py-6 text-center focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 ${
                  selected
                    ? "border-blue-600 bg-blue-50"
                    : "border-gray-300 hover:border-gray-400"
                }`}
              >
                <span className="block text-3xl font-bold">{value}</span>
                <span className="mt-1 block text-sm text-gray-700">{label}</span>
                {selected && <span className="mt-1 block text-xs font-medium text-blue-700">Selected ✓</span>}
              </button>
            );
          })}
        </div>

        {currentAnswer !== null && !locked && (
          <button
            type="button"
            onClick={() => selectAnswer(current.id, null)}
            className="mt-3 text-sm text-gray-500 hover:underline"
          >
            Clear answer
          </button>
        )}
        {locked && (
          <p className="mt-3 text-xs text-gray-500">
            Draft editing is disabled for this assignment — saved answers can&rsquo;t be changed.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-40"
        >
          ← Previous
        </button>
        {index < ordered.length - 1 ? (
          <button
            type="button"
            onClick={() => setIndex(index + 1)}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void goToReview()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Review answers
          </button>
        )}
      </div>

      {navError && (
        <p role="alert" className="text-sm text-amber-700">
          {navError}
        </p>
      )}

      <div>
        <p className="text-xs font-medium text-gray-500">Jump to question</p>
        <div className="mt-2 flex flex-wrap gap-1">
          {ordered.map((q, i) => {
            const answered = (answers[q.id] ?? null) !== null;
            return (
              <button
                key={q.id}
                type="button"
                aria-label={`Question ${i + 1}${answered ? " (answered)" : " (unanswered)"}`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => setIndex(i)}
                className={`h-8 w-8 rounded border text-xs font-medium ${
                  i === index ? "ring-2 ring-blue-500" : ""
                } ${
                  answered
                    ? "border-green-600 bg-green-50 text-green-800"
                    : "border-gray-300 text-gray-600"
                }`}
              >
                {answered ? `${i + 1}✓` : i + 1}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void goToReview()}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Review &amp; submit ({answeredCount}/{ordered.length} answered)
        </button>
      </div>
    </div>
  );
}
