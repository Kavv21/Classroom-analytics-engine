"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { saveResponses } from "@/lib/attempts/actions";
import {
  loadPending,
  mergeServerAndLocal,
  storePending,
  type PendingMap,
} from "@/lib/attempts/local-store";
import { answerCellContext, type AnswerGridLayout } from "@/lib/attempts/answer-grid";
import { SubmitAttemptButton } from "@/components/attempts/submit-attempt-button";
import { questionLabel } from "@/lib/ui/question-label";
import type { GridMatrixCell } from "@/lib/exports/response-grid";
import type { ResponseValue } from "@/lib/types/domain";

/**
 * The assignment-answering surface: the source spreadsheet's own grid, live
 * in the browser, with every cell editable.
 *
 * It replaces both earlier routes — the one-question-at-a-time runner and
 * the download/fill/upload CSV wizard — and inherits their machinery rather
 * than reimplementing it. The layout comes from lib/attempts/answer-grid.ts,
 * which is the professor's response-grid geometry (`detectOrientation`,
 * `buildGridMatrix`) with editable cells instead of class totals. The
 * autosave, the offline retry queue and the local draft recovery are the
 * runner's, moved here unchanged in behaviour.
 *
 * A CELL CANNOT HOLD AN INVALID VALUE. Each one is a button that cycles
 * blank → 0 → 1 → blank. There is no text entry, so "2" or "yes" is not a
 * value the control can produce and then have rejected — it is a state that
 * does not exist. The server still validates (lib/attempts/commit-answers.ts),
 * because a UI's shape is not a guarantee about what reaches an action.
 *
 * NO AUTOMATIC SUBMISSION (EXCLUDED_FEATURES.md, zero tolerance). There are
 * no listeners on visibilitychange, blur, fullscreenchange, pagehide or
 * beforeunload anywhere in this file. The single global listener is
 * `online`, which retries pending SAVES after a disconnect. The only path to
 * submission is the review step's SubmitAttemptButton, which needs two
 * explicit clicks; tab-switching, blurring, leaving fullscreen, refreshing
 * or losing the connection do nothing but leave the draft where it is.
 */

export interface AnswerGridProps {
  attemptId: string;
  assignmentTitle: string;
  instructions: string | null;
  layout: AnswerGridLayout;
  initialAnswers: Record<string, ResponseValue>;
  /** Serializable path string (never a function across the boundary). */
  receiptPath: string;
  allowDraftEditing: boolean;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";
type Stage = "grid" | "review";

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

/** Arrow key → [row delta, column delta]. */
const ARROW_MOVES: Record<string, [number, number] | undefined> = {
  ArrowUp: [-1, 0],
  ArrowDown: [1, 0],
  ArrowLeft: [0, -1],
  ArrowRight: [0, 1],
};

/** blank → 0 → 1 → blank. The only transition a cell has. */
function cycle(value: ResponseValue): ResponseValue {
  if (value === null) return 0;
  if (value === 0) return 1;
  return null;
}

export function AnswerGrid({
  attemptId,
  assignmentTitle,
  instructions,
  layout,
  initialAnswers,
  receiptPath,
  allowDraftEditing,
}: AnswerGridProps) {
  const { matrix, legend, questionCount } = layout;

  const [answers, setAnswers] = useState<Record<string, ResponseValue>>(initialAnswers);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("grid");

  const answersRef = useRef(answers);
  const dirtyRef = useRef<Set<string>>(new Set());
  const pendingStoreRef = useRef<PendingMap>({});
  const savingRef = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----------------------------------------------------------------
  // Autosave: batched, debounced, retried. One request per window, not
  // one per cell — filling a row of 15 cells is one save, not fifteen.
  // ----------------------------------------------------------------
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
        // Only mark clean if the cell wasn't changed again mid-save.
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

  // Restore any unsynced local draft on mount (a refresh mid-assignment
  // shows the student's cells back immediately, before the server has said
  // anything), then push it up.
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
    // the answering flow; nothing here reacts to visibility, blur,
    // fullscreen or unload, and nothing anywhere auto-submits.
    const onOnline = () => void flush();
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId]);

  // ----------------------------------------------------------------
  // Answers
  // ----------------------------------------------------------------
  const lockedQuestions = useMemo(() => {
    if (allowDraftEditing) return new Set<string>();
    return new Set(
      Object.entries(initialAnswers)
        .filter(([, v]) => v !== null)
        .map(([id]) => id)
    );
  }, [allowDraftEditing, initialAnswers]);

  const setAnswer = useCallback(
    (questionId: string, value: ResponseValue) => {
      if (lockedQuestions.has(questionId)) return;
      const next = { ...answersRef.current, [questionId]: value };
      answersRef.current = next;
      setAnswers(next);
      dirtyRef.current.add(questionId);
      pendingStoreRef.current[questionId] = { value, changedAt: Date.now() };
      storePending(attemptId, pendingStoreRef.current);
      setStatus("saving");
      scheduleFlush(DEBOUNCE_MS);
    },
    [attemptId, lockedQuestions, scheduleFlush]
  );

  // ----------------------------------------------------------------
  // Keyboard navigation: one tab stop into the grid, then arrows/Tab
  // between cells, the way a spreadsheet moves.
  // ----------------------------------------------------------------
  const positions = useMemo(() => {
    const list: Array<{ r: number; c: number }> = [];
    matrix.rows.forEach((row, r) => {
      row.cells.forEach((cell, c) => {
        if (cell) list.push({ r, c });
      });
    });
    return list;
  }, [matrix]);

  const [active, setActive] = useState<{ r: number; c: number } | null>(
    () => positions[0] ?? null
  );
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());
  /** Only pull DOM focus when WE moved it, never on a plain re-render. */
  const focusWanted = useRef(false);

  useEffect(() => {
    if (!focusWanted.current || !active) return;
    focusWanted.current = false;
    cellRefs.current.get(`${active.r}:${active.c}`)?.focus();
  }, [active]);

  const cellAt = useCallback(
    (r: number, c: number): GridMatrixCell | null => matrix.rows[r]?.cells[c] ?? null,
    [matrix]
  );

  /** Step by (dr, dc) until a cell with a question is found. */
  const step = useCallback(
    (from: { r: number; c: number }, dr: number, dc: number) => {
      let { r, c } = from;
      for (;;) {
        r += dr;
        c += dc;
        if (r < 0 || c < 0 || r >= matrix.rows.length || c >= matrix.columns.length) return null;
        if (cellAt(r, c)) return { r, c };
      }
    },
    [cellAt, matrix]
  );

  const moveTo = useCallback((next: { r: number; c: number } | null) => {
    if (!next) return false;
    focusWanted.current = true;
    setActive(next);
    return true;
  }, []);

  /** Reading order — what Tab and Shift+Tab follow. */
  const neighbourInOrder = useCallback(
    (from: { r: number; c: number }, delta: 1 | -1) => {
      const i = positions.findIndex((p) => p.r === from.r && p.c === from.c);
      if (i === -1) return null;
      return positions[i + delta] ?? null;
    },
    [positions]
  );

  function onCellKeyDown(
    event: React.KeyboardEvent<HTMLButtonElement>,
    at: { r: number; c: number },
    cell: GridMatrixCell
  ) {
    const key = event.key;

    // Value keys. Typing the digit is how a spreadsheet is filled in, and
    // it is the only "typing" here — 0, 1 and clear, nothing else.
    if (key === "0" || key === "1") {
      event.preventDefault();
      setAnswer(cell.questionId, key === "1" ? 1 : 0);
      return;
    }
    if (key === "Backspace" || key === "Delete") {
      event.preventDefault();
      setAnswer(cell.questionId, null);
      return;
    }

    // Movement. Enter and Space are left alone: they activate the button,
    // which is what "keyboard-activate to cycle" means.
    const move = ARROW_MOVES[key];
    if (move) {
      event.preventDefault();
      moveTo(step(at, move[0], move[1]));
      return;
    }

    // Home/End: the ends of this row, or of the whole grid with Ctrl.
    if (key === "Home" || key === "End") {
      event.preventDefault();
      const toEnd = key === "End";
      if (event.ctrlKey) {
        moveTo((toEnd ? positions[positions.length - 1] : positions[0]) ?? null);
      } else {
        // Walk inwards from just outside the row's edge to the first cell
        // that actually carries a question.
        const outside = toEnd ? matrix.columns.length : -1;
        moveTo(step({ r: at.r, c: outside }, 0, toEnd ? -1 : 1));
      }
      return;
    }

    // Tab walks the grid in reading order. At the two ends it is NOT
    // intercepted, so the grid can always be tabbed out of in both
    // directions — a keyboard trap would fail WCAG 2.1.2, and "you can
    // only leave from the last cell" is a trap.
    if (key === "Tab") {
      const next = neighbourInOrder(at, event.shiftKey ? -1 : 1);
      if (next && moveTo(next)) event.preventDefault();
    }
  }

  // ----------------------------------------------------------------
  // Counts
  // ----------------------------------------------------------------
  const answeredCount = useMemo(
    () => Object.values(answers).filter((v) => v !== null).length,
    [answers]
  );
  const unansweredCount = questionCount - answeredCount;

  const unansweredCells = useMemo(() => {
    const list: Array<{ questionId: string; where: string; code: string }> = [];
    for (const row of matrix.rows) {
      row.cells.forEach((cell, c) => {
        if (!cell) return;
        if ((answers[cell.questionId] ?? null) !== null) return;
        list.push({
          questionId: cell.questionId,
          where: answerCellContext(row.label, matrix.columns[c]!.label),
          code: cell.code,
        });
      });
    }
    return list;
  }, [answers, matrix]);

  async function openReview() {
    setReviewError(null);
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (dirtyRef.current.size > 0) await flush();
    if (dirtyRef.current.size > 0) {
      setReviewError(
        "Your latest answers haven't reached the server yet — hold on, we're retrying. " +
          "Nothing is lost; they're saved in this browser."
      );
      return;
    }
    setStage("review");
  }

  const statusLabel =
    status === "saving"
      ? "Saving…"
      : status === "saved"
        ? "Saved"
        : status === "error"
          ? "Save failed — retrying"
          : "";

  const valueWording = (value: ResponseValue) => {
    if (value === null) return "not answered";
    if (!legend) return String(value);
    return `${value} — ${value === 1 ? legend.one : legend.zero}`;
  };

  /** The cell's accessible name: where it is, what it asks, what it holds. */
  function cellName(cell: GridMatrixCell, rowLabel: string, columnLabel: string): string {
    const where = answerCellContext(rowLabel, columnLabel);
    const wording = questionLabel({
      questionText: cell.questionText,
      energySource: cell.energySource,
      criterion: cell.criterion,
      code: cell.code,
    });
    const question = wording === where ? "" : `${wording}. `;
    return `${where}. ${question}${valueWording(answers[cell.questionId] ?? null)}`;
  }

  const header = (
    <div className="space-y-1">
      <p className="eyebrow">There are no right or wrong answers</p>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="title-md">{assignmentTitle}</h1>
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
    </div>
  );

  if (matrix.rows.length === 0) {
    return (
      <section className="space-y-5">
        {header}
        <p className="banner">
          This assignment doesn&rsquo;t have any questions yet. Check back once your professor has
          added them.
        </p>
      </section>
    );
  }

  // ================================================================
  // Review step
  // ================================================================
  if (stage === "review") {
    return (
      <section className="space-y-5">
        {header}
        <h2 className="title-sm">Review your answers</h2>

        <div className="card-standard space-y-3">
          <p className="text-sm">
            You have answered{" "}
            <span className="font-medium tabular-nums">{answeredCount}</span> of{" "}
            <span className="tabular-nums">{questionCount}</span> cells.{" "}
            {unansweredCount > 0 ? (
              <>
                <span className="font-medium tabular-nums">{unansweredCount}</span>{" "}
                {unansweredCount === 1 ? "cell is" : "cells are"} still blank and will be recorded
                as unanswered.
              </>
            ) : (
              <>Every cell has a 0 or a 1.</>
            )}
          </p>

          {unansweredCells.length > 0 && (
            <div className="table-frame max-h-64 overflow-y-auto">
              <table className="data-table data-table--dense">
                <caption className="sr-only">
                  Cells with no answer yet, by row and column of the grid
                </caption>
                <thead className="sticky top-0">
                  <tr>
                    <th scope="col">Blank cell</th>
                    <th scope="col">Question code</th>
                  </tr>
                </thead>
                <tbody>
                  {unansweredCells.map((cell) => (
                    <tr key={cell.questionId}>
                      <td>{cell.where}</td>
                      <td className="mono text-ink-muted">{cell.code}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {matrix.unplaced.length > 0 && (
            <p role="alert" className="banner banner-critical">
              {matrix.unplaced.length} question{matrix.unplaced.length === 1 ? "" : "s"} could not be
              placed on the grid, so {matrix.unplaced.length === 1 ? "it has" : "they have"} no cell
              to answer in:{" "}
              {matrix.unplaced.map((c) => `${c.code} (${c.originalCell})`).join(", ")}. Tell your
              professor before submitting.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <SubmitAttemptButton
            attemptId={attemptId}
            receiptPath={receiptPath}
            unansweredCount={unansweredCount}
          />
          <button type="button" onClick={() => setStage("grid")} className="btn btn-secondary">
            Back to the grid
          </button>
        </div>

        <p className="note-muted">
          Submitting is final for this attempt. If you need to change an answer afterwards, ask your
          professor to reopen it. Nothing submits on its own — switching tabs, refreshing or losing
          connection never submits for you.
        </p>
      </section>
    );
  }

  // ================================================================
  // The grid
  // ================================================================
  return (
    <section className="space-y-5">
      {header}

      <p className="note">
        This is your professor&rsquo;s spreadsheet, live on this page —{" "}
        {layout.orientationText}. Fill it in here; there is nothing to download, and nothing to
        upload.
      </p>

      {instructions && <p className="well p-3 text-sm text-ink-secondary">{instructions}</p>}

      {saveError && status === "error" && (
        <p role="alert" className="banner banner-critical">
          We couldn&rsquo;t save just now ({saveError}). Your answers are safe in this browser and
          we&rsquo;re retrying automatically — keep going.
        </p>
      )}

      {matrix.unplaced.length > 0 && (
        <p role="alert" className="banner banner-critical">
          {matrix.unplaced.length} question{matrix.unplaced.length === 1 ? "" : "s"} could not be
          placed on the grid because another question already occupies the same source cell:{" "}
          {matrix.unplaced.map((c) => `${c.code} (${c.originalCell})`).join(", ")}. There is nowhere
          to answer {matrix.unplaced.length === 1 ? "it" : "them"} — tell your professor.
        </p>
      )}

      {/* The legend. The meaning of 0 and 1 is written out here, in text,
          because a cell shows a digit and nothing else — no colour, shape or
          position carries the meaning. */}
      <div className="well flex flex-wrap items-center gap-x-6 gap-y-2 p-3 text-sm">
        <span className="text-xs font-medium text-ink-secondary">What the numbers mean</span>
        <span>
          <span className="mono">0</span> — {legend ? legend.zero : "the first option"}
        </span>
        <span>
          <span className="mono">1</span> — {legend ? legend.one : "the second option"}
        </span>
        <span className="text-ink-secondary">
          <span className="mono">·</span> — blank, not answered yet
        </span>
      </div>

      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-ink-secondary">
          <span>
            Answered <span className="tabular-nums">{answeredCount}</span> · Unanswered{" "}
            <span className="tabular-nums">{unansweredCount}</span> of{" "}
            <span className="tabular-nums">{questionCount}</span> cells
          </span>
          <span>
            Click a cell to change it: blank → 0 → 1 → blank. Arrow keys, Tab and Shift+Tab move
            between cells; 0 and 1 fill one directly; Delete clears it.
          </span>
        </div>

        <div className="table-frame mt-2" style={{ maxHeight: "70vh", overflow: "auto" }}>
          <table className="border-collapse text-left text-xs">
            <caption className="sr-only">
              {assignmentTitle} — your answer sheet, laid out as the original spreadsheet:{" "}
              {matrix.rowAxisHeading} down the rows, {matrix.rows.length} of them, against{" "}
              {matrix.columns.length} columns. Each cell is a button that cycles between blank, 0
              and 1.
            </caption>
            <thead className="sticky top-0 z-20 bg-surface-sunken">
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-30 min-w-48 border-b border-r border-hairline bg-surface-sunken px-3 py-2 font-medium text-ink-secondary"
                >
                  {matrix.rowAxisHeading}
                </th>
                {matrix.columns.map((column) => (
                  <th
                    key={column.originalColumn}
                    scope="col"
                    title={`${column.label} (source column ${column.originalColumn})`}
                    className="min-w-24 max-w-40 border-b border-l border-hairline px-3 py-2 text-center align-bottom font-medium text-ink-secondary"
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {matrix.rows.map((row, r) => (
                <tr key={row.originalRow}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 whitespace-nowrap border-r border-hairline bg-surface-raised px-3 py-1 text-left font-normal"
                  >
                    {row.label}
                  </th>
                  {row.cells.map((cell, c) => {
                    const column = matrix.columns[c]!;
                    if (!cell) {
                      return (
                        <td
                          key={column.originalColumn}
                          className="border-l border-hairline px-1 py-1 text-center text-ink-muted"
                        >
                          <span aria-hidden="true"> </span>
                          <span className="sr-only">
                            No question at {answerCellContext(row.label, column.label)}
                          </span>
                        </td>
                      );
                    }
                    const value = answers[cell.questionId] ?? null;
                    const locked = lockedQuestions.has(cell.questionId);
                    const isActive = active?.r === r && active?.c === c;
                    return (
                      <td
                        key={column.originalColumn}
                        className="border-l border-hairline p-0.5"
                      >
                        <button
                          ref={(el) => {
                            if (el) cellRefs.current.set(`${r}:${c}`, el);
                            else cellRefs.current.delete(`${r}:${c}`);
                          }}
                          type="button"
                          className="cell-toggle"
                          data-answer={value === null ? "blank" : value}
                          data-locked={locked ? "true" : undefined}
                          aria-disabled={locked || undefined}
                          aria-label={cellName(cell, row.label, column.label)}
                          title={`${answerCellContext(row.label, column.label)} — ${cell.code} (cell ${cell.originalCell})`}
                          tabIndex={isActive ? 0 : -1}
                          onFocus={() => setActive({ r, c })}
                          onClick={() => {
                            if (locked) return;
                            setAnswer(cell.questionId, cycle(value));
                          }}
                          onKeyDown={(e) => onCellKeyDown(e, { r, c }, cell)}
                        >
                          <span aria-hidden="true">{value === null ? "·" : value}</span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!allowDraftEditing && (
          <p className="note-muted mt-2">
            This assignment doesn&rsquo;t allow changing a cell once it&rsquo;s saved.
          </p>
        )}
      </div>

      {reviewError && (
        <p role="alert" className="banner banner-warning">
          {reviewError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="note-muted">
          Your answers save themselves as you go, and stay in this browser too. Switching tabs,
          refreshing or losing connection never submits anything.
        </p>
        <button type="button" onClick={() => void openReview()} className="btn btn-primary">
          Review &amp; submit ({answeredCount} of {questionCount} answered)
        </button>
      </div>
    </section>
  );
}
