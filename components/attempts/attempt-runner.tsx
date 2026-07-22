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
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

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
    return (
      <p className="banner">
        This assignment doesn&rsquo;t have any questions yet. Check back once
        your professor has added them.
      </p>
    );
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
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="title-sm">{assignmentTitle}</h1>
        <p
          role="status"
          aria-live="polite"
          className="text-xs font-medium"
          style={{
            color:
              status === "error"
                ? "var(--status-critical-text)"
                : status === "saved"
                  ? "var(--status-good-text)"
                  : "var(--text-muted)",
          }}
        >
          {statusLabel}
        </p>
      </div>

      {instructions && <p className="well p-3 text-sm text-ink-secondary">{instructions}</p>}

      {saveError && status === "error" && (
        <p role="alert" className="banner banner-critical">
          We couldn&rsquo;t save just now ({saveError}). Your answers are safe in
          this browser and we&rsquo;re retrying automatically — keep going.
        </p>
      )}

      <div>
        <div className="flex items-center justify-between text-xs text-ink-secondary">
          <span>
            Question {index + 1} of {ordered.length}
          </span>
          <span>
            Answered {answeredCount} · Unanswered {unansweredCount}
          </span>
        </div>
        {/* Progress mirrors the counts above rather than replacing them —
            the numbers stay the accessible source of truth. */}
        <Progress
          value={ordered.length === 0 ? 0 : (answeredCount / ordered.length) * 100}
          aria-label={`${answeredCount} of ${ordered.length} questions answered`}
          className="mt-2 h-1.5"
        />
      </div>

      <Card className="p-6">
        <p className="mono text-ink-muted">{current.externalQuestionCode}</p>
        <p className="mt-2 text-lg leading-snug">{current.questionText}</p>

        {/* Two explicit toggle buttons rather than a shadcn ToggleGroup.
            Radix's ToggleGroup type="single" renders RADIO semantics
            (radiogroup/radio), which changes the keyboard contract from
            "tab to each option" to "arrow between options" and broke the
            attempt-runner tests that assert the button role. Kept as
            aria-pressed toggle buttons — the tested, shipped behaviour.
            See the phase report; switching is a deliberate a11y decision,
            not a component swap. */}
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
                className="rounded-md border-2 px-6 py-6 text-center disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  borderColor: selected ? "var(--action)" : "var(--border-strong)",
                  backgroundColor: selected ? "var(--surface-sunken)" : "var(--surface-raised)",
                }}
              >
                <span className="block text-3xl font-semibold">{value}</span>
                <span className="mt-1 block text-sm text-ink-secondary">{label}</span>
                <span className="mt-1 block text-xs font-medium">
                  {selected ? "Selected ✓" : " "}
                </span>
              </button>
            );
          })}
        </div>

        {currentAnswer !== null && !locked && (
          <button
            type="button"
            onClick={() => selectAnswer(current.id, null)}
            className="link-quiet mt-3 text-xs"
          >
            Clear this answer
          </button>
        )}
        {locked && (
          <p className="note-muted mt-3">
            This assignment doesn&rsquo;t allow changing an answer once
            it&rsquo;s saved.
          </p>
        )}
      </Card>

      <div className="flex items-center justify-between">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => setIndex(index - 1)}
          className="btn btn-secondary"
        >
          ← Previous
        </button>
        {index < ordered.length - 1 ? (
          <button
            type="button"
            onClick={() => setIndex(index + 1)}
            className="btn btn-primary"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void goToReview()}
            className="btn btn-primary"
          >
            Review your answers
          </button>
        )}
      </div>

      {navError && (
        <p role="alert" className="banner banner-warning">
          {navError}
        </p>
      )}

      <div>
        <p className="field-label">Jump to a question</p>
        <div className="flex flex-wrap gap-1">
          {ordered.map((q, i) => {
            const answered = (answers[q.id] ?? null) !== null;
            const isCurrent = i === index;
            return (
              <button
                key={q.id}
                type="button"
                aria-label={`Question ${i + 1}${answered ? " (answered)" : " (unanswered)"}`}
                aria-current={isCurrent ? "true" : undefined}
                onClick={() => setIndex(i)}
                className="h-8 min-w-8 rounded border px-1 text-xs font-medium tabular-nums"
                style={{
                  borderColor: isCurrent
                    ? "var(--action)"
                    : answered
                      ? "var(--border-strong)"
                      : "var(--border-hairline)",
                  borderWidth: isCurrent ? 2 : 1,
                  backgroundColor: answered ? "var(--surface-sunken)" : "var(--surface-raised)",
                  color: answered ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {answered ? `${i + 1}✓` : i + 1}
              </button>
            );
          })}
        </div>
        <p className="note-muted mt-2">
          A tick means you&rsquo;ve answered that question. There are no right
          or wrong answers here.
        </p>
      </div>

      <div className="flex justify-end">
        <button type="button" onClick={() => void goToReview()} className="btn btn-secondary">
          Review &amp; submit ({answeredCount} of {ordered.length} answered)
        </button>
      </div>
    </div>
  );
}
