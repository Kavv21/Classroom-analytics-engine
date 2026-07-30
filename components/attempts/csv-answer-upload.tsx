"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { submitCsvAnswers } from "@/lib/attempts/actions";
import {
  buildCsvQuestionKey,
  buildCsvTemplate,
  MAX_CSV_BYTES,
  parseCsvAnswers,
  type CsvQuestion,
  type CsvRowIssue,
  type ParsedCsvAnswers,
} from "@/lib/attempts/commit-csv-submission";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { questionLabel } from "@/lib/ui/question-label";

/**
 * Upload → preview → explicit confirm, the same three-step shape as the
 * Phase 3 roster import wizard.
 *
 * THE SUBMISSION RULE, restated because this is the file most likely to
 * break it: choosing a file parses and previews it. That is all. Submission
 * happens only when the student clicks the confirm button, and that button
 * is the only caller of `submitCsvAnswers` in this component. There is no
 * onChange-submits shortcut, no auto-advance, no timer, and no listener on
 * any browser lifecycle event (EXCLUDED_FEATURES.md — automatic submission
 * triggered by browser activity is excluded with zero tolerance, and a file
 * picker firing is browser activity).
 *
 * Parsing runs client-side purely so the student sees their mistakes
 * immediately. The server re-parses and re-validates the same text with the
 * same function before writing anything — the client preview is never
 * trusted as authorisation.
 */

interface CsvAnswerUploadProps {
  attemptId: string;
  assignmentTitle: string;
  instructions: string | null;
  questions: CsvQuestion[];
  receiptPath: string;
  /** Where the per-question UI lives, kept available as the other route. */
  manualPath?: string;
}

type Stage = "choose" | "preview";

export function CsvAnswerUpload({
  attemptId,
  assignmentTitle,
  instructions,
  questions,
  receiptPath,
  manualPath,
}: CsvAnswerUploadProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>("choose");
  const [fileName, setFileName] = useState<string | null>(null);
  const [csvText, setCsvText] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedCsvAnswers | null>(null);
  const [serverIssues, setServerIssues] = useState<CsvRowIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fileStem = assignmentTitle.replace(/[^\w-]+/g, "-").toLowerCase();

  const labelOf = (q: CsvQuestion) =>
    questionLabel({
      questionText: q.questionText,
      energySource: q.energySource,
      criterion: q.criterion,
      code: q.externalQuestionCode,
    });
  const orderedQuestions = [...questions].sort((a, b) => a.displayOrder - b.displayOrder);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  function download(csv: string, filename: string) {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadTemplate() {
    download(buildCsvTemplate(questions), `${fileStem}-answer-sheet.csv`);
  }

  /** The companion reference: code → wording, energy source, criterion. */
  function downloadQuestionKey() {
    download(buildCsvQuestionKey(questions), `${fileStem}-question-key.csv`);
  }

  /**
   * Reads and previews. Explicitly does NOT submit — see the note above.
   */
  async function onFileChosen(file: File | undefined) {
    setError(null);
    setServerIssues([]);
    if (!file) return;

    if (file.size > MAX_CSV_BYTES) {
      setError("That file is too large to be an answer sheet.");
      return;
    }

    const text = await file.text();
    setFileName(file.name);
    setCsvText(text);
    setParsed(parseCsvAnswers(text, questions));
    setStage("preview");
  }

  function reset() {
    setStage("choose");
    setFileName(null);
    setCsvText(null);
    setParsed(null);
    setServerIssues([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  /** The one and only submission path in this component. */
  async function confirmSubmit() {
    if (!csvText) return;
    setSubmitting(true);
    setError(null);
    setServerIssues([]);

    const result = await submitCsvAnswers(attemptId, csvText);
    setSubmitting(false);

    if (!result.success) {
      setError(result.error);
      setServerIssues(result.issues ?? []);
      toast.error(result.error);
      return;
    }

    toast.success("Your answers were submitted.");
    router.push(receiptPath);
    router.refresh();
  }

  const issues = parsed?.issues ?? [];
  const canSubmit =
    stage === "preview" && issues.length === 0 && (parsed?.answers.length ?? 0) === questions.length;

  return (
    <section className="space-y-5">
      <div>
        <h1 className="title-md">{assignmentTitle}</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          Answer every question with a <strong>0</strong> or a <strong>1</strong> in the answer
          sheet, then upload it here. Nothing is submitted until you have seen the preview and
          pressed the confirm button.
        </p>
        {instructions && (
          <p className="mt-2 whitespace-pre-wrap rounded border border-hairline bg-surface-sunken px-3 py-2 text-sm">
            {instructions}
          </p>
        )}
      </div>

      <ol className="space-y-4">
        {/* ---- step 1 ---- */}
        <li className="rounded border border-hairline p-4">
          <p className="font-medium">1. Download the answer sheet</p>
          <p className="mt-1 text-sm text-ink-secondary">
            It has one column per question ({questions.length} in total). The first row holds the
            question code — that&rsquo;s the label the upload matches on, so leave it alone — and the
            row below it repeats the question in words. Fill in the empty row underneath with 0 or 1
            and save it as CSV.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              Download answer sheet (CSV)
            </Button>
            <Button type="button" variant="outline" onClick={downloadQuestionKey}>
              Download question key (CSV)
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink-muted">
            The question key lists every code with its full question, energy source and criterion —
            keep it open while you fill the sheet in.
          </p>

          {/* The same key on screen, so checking a code costs no download. */}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">
              Question key ({questions.length} questions)
            </summary>
            <div className="mt-2 max-h-72 overflow-auto rounded border border-hairline">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">
                  Every question in this assignment, with the answer-sheet column code for each
                </caption>
                <thead className="sticky top-0 bg-surface-sunken">
                  <tr>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                      Question
                    </th>
                    <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                      Column in the answer sheet
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {orderedQuestions.map((q) => (
                    <tr key={q.id}>
                      <td className="px-2 py-1.5">{labelOf(q)}</td>
                      <td className="px-2 py-1.5 font-mono text-ink-muted">
                        {q.externalQuestionCode}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </li>

        {/* ---- step 2 ---- */}
        <li className="rounded border border-hairline p-4">
          <p className="font-medium">2. Upload your completed sheet</p>
          <p className="mt-1 text-sm text-ink-secondary">
            Choosing a file only shows you a preview — it does not submit anything.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => onFileChosen(e.target.files?.[0])}
            className="mt-3 block w-full text-sm file:mr-3 file:rounded file:border file:border-hairline file:bg-surface-sunken file:px-3 file:py-1.5 file:text-sm"
          />
          {fileName && (
            <p className="mt-2 text-xs text-ink-muted">
              Loaded <span className="font-medium">{fileName}</span>.{" "}
              <button type="button" onClick={reset} className="link">
                Choose a different file
              </button>
            </p>
          )}
        </li>

        {/* ---- step 3 ---- */}
        <li className="rounded border border-hairline p-4">
          <p className="font-medium">3. Check the preview, then submit</p>

          {stage === "choose" && (
            <p className="mt-1 text-sm text-ink-secondary">
              Upload a file above and its answers will appear here for checking.
            </p>
          )}

          {stage === "preview" && parsed && (
            <div className="mt-3 space-y-3">
              <p className="text-sm">
                <span className="font-medium tabular-nums">{parsed.answers.length}</span> of{" "}
                <span className="tabular-nums">{questions.length}</span> questions answered
                {issues.length > 0 && (
                  <>
                    {" · "}
                    <span className="text-[color:var(--status-critical-text)]">
                      {issues.length} problem{issues.length === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </p>

              {issues.length > 0 && (
                <div className="max-h-64 overflow-auto rounded border border-hairline">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Problems found in the uploaded file</caption>
                    <thead className="sticky top-0 bg-surface-sunken">
                      <tr>
                        <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                          Row
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                          Column
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                          Problem
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {issues.map((issue, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1.5 tabular-nums">{issue.row ?? "—"}</td>
                          <td className="px-2 py-1.5">{issue.column ?? "—"}</td>
                          <td className="px-2 py-1.5">{issue.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {issues.length === 0 && (
                <div className="max-h-64 overflow-auto rounded border border-hairline">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Answers read from the uploaded file</caption>
                    <thead className="sticky top-0 bg-surface-sunken">
                      <tr>
                        <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                          Question
                        </th>
                        <th scope="col" className="px-2 py-1.5 font-medium text-ink-secondary">
                          Your answer
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {parsed.answers.map((a) => {
                        const q = questionById.get(a.questionId);
                        return (
                          <tr key={a.questionId}>
                            {/* Checking your own answers means reading the
                                question, not the code. */}
                            <td className="px-2 py-1.5">
                              <span className="block">{q ? labelOf(q) : a.code}</span>
                              <span className="block font-mono text-[11px] text-ink-muted">
                                {a.code}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 align-top tabular-nums">{a.value}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {serverIssues.length > 0 && (
                <ul className="space-y-1 text-xs text-[color:var(--status-critical-text)]">
                  {serverIssues.map((issue, i) => (
                    <li key={i}>
                      {issue.column ? `${issue.column}: ` : ""}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={confirmSubmit} disabled={!canSubmit || submitting}>
                  {submitting ? "Submitting…" : "Submit these answers"}
                </Button>
                <Button type="button" variant="outline" onClick={reset} disabled={submitting}>
                  Start over
                </Button>
                {!canSubmit && (
                  <span className="text-xs text-ink-muted">
                    Fix the problems above and upload the file again.
                  </span>
                )}
              </div>

              <p className="text-xs text-ink-muted">
                Submitting is final for this attempt. If you need to change an answer afterwards,
                ask your professor to reopen it.
              </p>
            </div>
          )}
        </li>
      </ol>

      {manualPath && (
        <p className="text-xs text-ink-muted">
          Prefer to answer question by question?{" "}
          <a href={manualPath} className="link">
            Use the one-at-a-time view
          </a>
          . Both routes save to the same attempt.
        </p>
      )}
    </section>
  );
}
