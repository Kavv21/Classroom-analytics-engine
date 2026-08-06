"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { previewRosterImport, commitRosterImport } from "@/lib/roster/actions";
import { buildRejectionReportCsv } from "@/lib/roster/validate";
import { RosterPreviewTable } from "@/components/roster/roster-preview-table";
import type { RosterImportPreview, RosterImportSummary } from "@/lib/types/domain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { PILL } from "@/lib/ui/tone";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Phase = "idle" | "loading" | "previewed" | "committed";

/** The three steps, shown as a non-interactive indicator. */
const STEPS = [
  { key: "upload", label: "1. Upload" },
  { key: "review", label: "2. Review" },
  { key: "done", label: "3. Done" },
] as const;

function stepFor(phase: Phase): (typeof STEPS)[number]["key"] {
  if (phase === "committed") return "done";
  if (phase === "previewed") return "review";
  return "upload";
}

export function RosterImportWizard({ classId }: { classId: string }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [preview, setPreview] = useState<RosterImportPreview | null>(null);
  const [summary, setSummary] = useState<RosterImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentStep = stepFor(phase);

  async function handlePreview() {
    if (!file) return;
    setPhase("loading");
    setError(null);

    const formData = new FormData();
    formData.set("file", file);
    const result = await previewRosterImport(classId, formData);

    if (!result.success) {
      setError(result.error);
      toast.error(result.error);
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
      toast.error(result.error);
      setPhase("previewed");
      return;
    }
    setSummary(result.data);
    setPhase("committed");
    toast.success(`Imported ${result.data.imported} student${result.data.imported === 1 ? "" : "s"}.`);
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
      {/* Step indicator — a Tabs list driven by phase, not clickable: the
          professor moves forward by acting, not by jumping steps. */}
      <Tabs value={currentStep}>
        <TabsList>
          {STEPS.map((step) => (
            <TabsTrigger key={step.key} value={step.key} disabled className="disabled:opacity-100">
              {step.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="upload" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>Upload a roster file</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-1.5">
                <Label htmlFor="roster-file">Roster file (.csv, .xlsx, .xls)</Label>
                <Input
                  id="roster-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] ?? null);
                    setPreview(null);
                    setPhase("idle");
                  }}
                />
              </div>
              <Button
                onClick={handlePreview}
                disabled={!file || phase === "loading"}
              >
                {phase === "loading" ? "Checking file…" : "Preview import"}
              </Button>
              {phase === "loading" && (
                <Progress value={undefined} aria-label="Checking file" className="h-1.5" />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="review" className="mt-6 space-y-4">
          {preview && (
            <>
              {/* A required column the file never had is a file-level problem,
                  not 60 identical row errors — say so once, name the column,
                  and show what we actually read so a mis-detected header row
                  is obvious at a glance. */}
              {preview.missingColumns.length > 0 && (
                <Alert className="border-[color:var(--status-critical-text)]/30 bg-surface-critical">
                  <AlertTitle className="text-[color:var(--status-critical-text)]">
                    {preview.missingColumns.length === 1
                      ? "A required column is missing"
                      : `${preview.missingColumns.length} required columns are missing`}
                  </AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc pl-4">
                      {preview.missingColumns.map((message) => (
                        <li key={message}>{message}</li>
                      ))}
                    </ul>
                    {preview.detectedHeaders.length > 0 && (
                      <p className="mt-2">
                        Columns found in your file:{" "}
                        <span className="font-medium">{preview.detectedHeaders.join(", ")}</span>
                      </p>
                    )}
                    <p className="mt-2">
                      Rename the column in your spreadsheet to one of the accepted headings and
                      upload again.
                    </p>
                  </AlertDescription>
                </Alert>
              )}

              {preview.missingColumns.length === 0 && preview.unmatchedHeaders.length > 0 && (
                <Alert>
                  <AlertTitle>Some columns weren&apos;t recognised</AlertTitle>
                  <AlertDescription>
                    These columns were ignored:{" "}
                    <span className="font-medium">{preview.unmatchedHeaders.join(", ")}</span>. Every
                    required column matched, so the import can still go ahead.
                  </AlertDescription>
                </Alert>
              )}

              <div className="flex flex-wrap gap-3">
                <Card className="min-w-32 p-0">
                  <CardContent className="p-4">
                    <p className="note-muted">Total rows</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums">{preview.totalRows}</p>
                  </CardContent>
                </Card>
                <Card className="min-w-32 p-0">
                  <CardContent className="p-4">
                    <p className="note-muted">Importable</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-[color:var(--status-good-text)]">
                      {preview.importableRows.length}
                    </p>
                  </CardContent>
                </Card>
                <Card className="min-w-32 p-0">
                  <CardContent className="p-4">
                    <p className="note-muted">Rejected</p>
                    <p className="mt-0.5 text-lg font-semibold tabular-nums text-[color:var(--status-critical-text)]">
                      {preview.rejectedRows.length}
                    </p>
                  </CardContent>
                </Card>
              </div>

              <div>
                <h3 className="mb-2 subheading">Rows to import</h3>
                <RosterPreviewTable rows={preview.importableRows} />
              </div>

              {preview.rejectedRows.length > 0 && (
                <div>
                  <h3 className="mb-2 flex items-center gap-2 subheading">
                    Rejected rows
                    <Badge
                      variant="outline"
                      className={PILL.red}
                    >
                      {preview.rejectedRows.length}
                    </Badge>
                  </h3>
                  <RosterPreviewTable rows={preview.rejectedRows} />
                </div>
              )}

              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={handleCommit}
                  disabled={preview.importableRows.length === 0 || phase === "loading"}
                >
                  {phase === "loading"
                    ? "Importing…"
                    : `Import ${preview.importableRows.length} student${preview.importableRows.length === 1 ? "" : "s"}`}
                </Button>
                <Button variant="outline" onClick={handleReset}>
                  Start over
                </Button>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="done" className="mt-6">
          {summary && (
            <Alert className="border-[color:var(--status-good-text)]/30 bg-surface-good">
              <AlertTitle className="text-[color:var(--status-good-text)]">
                Roster imported
              </AlertTitle>
              <AlertDescription>
                <ul className="text-[color:var(--status-good-text)]">
                  <li>Total rows: {summary.total}</li>
                  <li>Imported: {summary.imported}</li>
                  <li>Rejected: {summary.rejected}</li>
                </ul>
                <div className="mt-3 flex flex-wrap gap-3">
                  {preview && preview.rejectedRows.length > 0 && (
                    <Button variant="outline" size="sm" onClick={handleDownloadRejectionReport}>
                      Download rejection report
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleReset}>
                    Import another file
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>
      </Tabs>

      {error && (
        <p role="alert" className="text-sm text-[color:var(--status-critical-text)]">
          {error}
        </p>
      )}
    </div>
  );
}
