"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  commitAssignmentImport,
  previewAssignmentImport,
  type AssignmentImportPreview,
} from "@/lib/assignments/actions";

interface ImportWizardProps {
  classId: string;
  assignmentId: string;
}

/**
 * Upload → preview → commit. The professor always sees the complete parsed
 * question list (and every problem row) before anything is written; commit
 * re-parses server-side and is all-or-nothing.
 */
export function AssignmentImportWizard({ classId, assignmentId }: ImportWizardProps) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [worksheet, setWorksheet] = useState<string>("");
  const [preview, setPreview] = useState<AssignmentImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function runPreview(selectedFile: File, selectedWorksheet: string) {
    setError(null);
    setBusy(true);
    const formData = new FormData();
    formData.set("file", selectedFile);
    if (selectedWorksheet) formData.set("worksheet", selectedWorksheet);
    const result = await previewAssignmentImport(assignmentId, formData);
    setBusy(false);

    if (!result.success) {
      setPreview(null);
      setError(result.error);
      return;
    }
    setPreview(result.data);
    setWorksheet(result.data.worksheet);
  }

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setPreview(null);
    setDone(null);
    if (selected) await runPreview(selected, "");
  }

  async function onWorksheetChange(name: string) {
    setWorksheet(name);
    if (file) await runPreview(file, name);
  }

  async function commit() {
    if (!file || !preview) return;
    setError(null);
    setBusy(true);
    const formData = new FormData();
    formData.set("file", file);
    if (worksheet) formData.set("worksheet", worksheet);
    const result = await commitAssignmentImport(assignmentId, formData);
    setBusy(false);

    if (!result.success) {
      setError(result.error);
      return;
    }
    setDone(result.data.imported);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="import-file" className="block text-sm font-medium text-gray-700">
          Spreadsheet (.xlsx or .xls)
        </label>
        <input
          id="import-file"
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={onFileChange}
          className="mt-1 text-sm"
        />
      </div>

      {busy && <p className="text-sm text-gray-600">Working…</p>}

      {error && (
        <p role="alert" className="whitespace-pre-wrap rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {done !== null && (
        <p className="rounded bg-green-50 px-3 py-2 text-sm text-green-700">
          Imported {done} questions. Review them below, then approve the
          assignment when you&rsquo;re satisfied.{" "}
          <a href={`/classes/${classId}/assignments/${assignmentId}`} className="font-medium underline">
            Back to the assignment
          </a>
        </p>
      )}

      {preview && done === null && (
        <div className="space-y-4">
          {preview.worksheets.length > 1 && (
            <div>
              <label htmlFor="worksheet" className="block text-sm font-medium text-gray-700">
                Worksheet
              </label>
              <select
                id="worksheet"
                value={worksheet}
                onChange={(e) => onWorksheetChange(e.target.value)}
                className="mt-1 rounded border border-gray-300 px-3 py-2 text-sm"
              >
                {preview.worksheets.map((name) => (
                  <option key={name} value={name} disabled={preview.emptyWorksheets.includes(name)}>
                    {name}
                    {preview.emptyWorksheets.includes(name) ? " (empty)" : ""}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex gap-6 rounded border border-gray-200 p-4 text-sm">
            <div>
              <p className="text-gray-500">Questions</p>
              <p className="text-lg font-semibold">{preview.questions.length}</p>
            </div>
            <div>
              <p className="text-gray-500">Energy sources</p>
              <p className="text-lg font-semibold">{preview.sources.length}</p>
            </div>
            <div>
              <p className="text-gray-500">Criteria</p>
              <p className="text-lg font-semibold">{preview.criteria.length}</p>
            </div>
            <div>
              <p className="text-gray-500">Answer labels</p>
              <p className="text-lg font-semibold">
                {preview.responseZeroLabel} / {preview.responseOneLabel}
              </p>
              {!preview.labelsDetected && (
                <p className="text-xs text-gray-500">
                  (defaults — none detected in the sheet; editable after import)
                </p>
              )}
            </div>
          </div>

          {preview.errors.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-4">
              <p className="text-sm font-semibold text-red-700">
                {preview.errors.length} problem row(s) — nothing will be imported until these are
                fixed in the file:
              </p>
              <ul className="mt-2 list-inside list-disc text-sm text-red-700">
                {preview.errors.map((e, i) => (
                  <li key={i}>
                    <span className="font-mono">{e.location}</span>: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.anomalies.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-4">
              <p className="text-sm font-semibold text-amber-800">
                {preview.anomalies.length} pre-filled cell(s) in the answer grid (ignored on
                import):
              </p>
              <p className="mt-1 text-sm text-amber-800">
                {preview.anomalies
                  .slice(0, 20)
                  .map((a) => `${a.cell}=${String(a.value)}`)
                  .join(", ")}
                {preview.anomalies.length > 20 ? "…" : ""}
              </p>
            </div>
          )}

          <div className="overflow-x-auto rounded border border-gray-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 font-medium text-gray-600">#</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Code</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Question</th>
                  <th className="px-3 py-2 font-medium text-gray-600">Source cell</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.questions.map((q) => (
                  <tr key={q.externalQuestionCode}>
                    <td className="px-3 py-2 text-gray-500">{q.displayOrder}</td>
                    <td className="px-3 py-2 font-mono text-xs">{q.externalQuestionCode}</td>
                    <td className="px-3 py-2">{q.questionText}</td>
                    <td className="px-3 py-2 font-mono text-xs text-gray-500">
                      {q.originalColumnReference}
                      {q.originalRowReference}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button
            type="button"
            disabled={busy || preview.errors.length > 0}
            onClick={commit}
            className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? "Importing…" : `Import ${preview.questions.length} questions`}
          </button>
          {preview.errors.length > 0 && (
            <p className="text-sm text-gray-600">
              Fix the problem rows in the spreadsheet and re-upload — imports are all-or-nothing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
