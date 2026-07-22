"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewRosterImport, commitRosterImport } from "@/lib/roster/actions";
import { buildRejectionReportCsv } from "@/lib/roster/validate";
import { RosterPreviewTable } from "@/components/roster/roster-preview-table";
import type { RosterImportPreview, RosterImportSummary } from "@/lib/types/domain";

type Phase = "idle" | "loading" | "previewed" | "committed";

export function RosterImportWizard({ classId }: { classId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<RosterImportPreview | null>(null);
  const [summary, setSummary] = useState<RosterImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handlePreview() {
    if (!file) return;
    setPhase("loading");
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    const result = await previewRosterImport(classId, formData);

    if (!result.success) {
      setError(result.error);
      setPhase("idle");
      return;
    }
    setPreview(result.data);
    setPhase("previewed");
  }

  async function handleCommit() {
    if (!file) return;
    setPhase("loading");
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    const result = await commitRosterImport(classId, formData);

    if (!result.success) {
      setError(result.error);
      setPhase("previewed");
      return;
    }
    setSummary(result.data);
    setPhase("committed");
    router.refresh();
  }

  function handleDownloadRejectionReport() {
    if (!preview) return;
    const csv = buildRejectionReportCsv(preview.rejectedRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "roster-import-rejected-rows.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    setFile(null);
    setPreview(null);
    setSummary(null);
    setError(null);
    setPhase("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <div className="space-y-6">
      {phase !== "committed" && (
        <div>
          <label htmlFor="roster-file" className="block text-sm font-medium text-ink-secondary">
            Roster file (.csv, .xlsx, .xls)
          </label>
          <input
            id="roster-file"
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setPhase("idle");
            }}
            className="mt-1 block text-sm"
          />
          <button
            type="button"
            onClick={handlePreview}
            disabled={!file || phase === "loading"}
            className="mt-3 btn btn-primary"
          >
            {phase === "loading" && !preview ? "Checking file…" : "Preview import"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-critical-text">
          {error}
        </p>
      )}

      {preview && phase !== "committed" && (
        <div className="space-y-4">
          <div className="flex gap-6 rounded border border-hairline p-4 text-sm">
            <div>
              <p className="text-ink-muted">Total rows</p>
              <p className="title-sm">{preview.totalRows}</p>
            </div>
            <div>
              <p className="text-ink-muted">Importable</p>
              <p className="text-lg font-semibold text-good-text">{preview.importableRows.length}</p>
            </div>
            <div>
              <p className="text-ink-muted">Rejected</p>
              <p className="text-lg font-semibold text-critical-text">{preview.rejectedRows.length}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-ink-secondary">Rows to import</h3>
            <RosterPreviewTable rows={preview.importableRows} />
          </div>

          {preview.rejectedRows.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold text-ink-secondary">Rejected rows</h3>
              <RosterPreviewTable rows={preview.rejectedRows} />
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleCommit}
              disabled={preview.importableRows.length === 0 || phase === "loading"}
              className="btn btn-primary"
            >
              {phase === "loading" ? "Importing…" : `Import ${preview.importableRows.length} student(s)`}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-strong px-4 py-2 text-sm font-medium hover:bg-surface-sunken"
            >
              Start over
            </button>
          </div>
        </div>
      )}

      {summary && phase === "committed" && (
        <div className="banner banner-good space-y-4">
          <p className="font-medium text-green-800">Import complete.</p>
          <ul className="text-sm text-green-800">
            <li>Total rows: {summary.total}</li>
            <li>Imported: {summary.imported}</li>
            <li>Rejected: {summary.rejected}</li>
          </ul>
          <div className="flex gap-3">
            {preview && preview.rejectedRows.length > 0 && (
              <button
                type="button"
                onClick={handleDownloadRejectionReport}
                className="rounded border border-strong bg-white px-4 py-2 text-sm font-medium hover:bg-surface-sunken"
              >
                Download rejection report
              </button>
            )}
            <button
              type="button"
              onClick={handleReset}
              className="rounded border border-strong bg-white px-4 py-2 text-sm font-medium hover:bg-surface-sunken"
            >
              Import another file
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
