"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  commitAssignmentImport,
  previewAssignmentImport,
  type AssignmentImportPreview,
} from "@/lib/assignments/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
      toast.error(result.error);
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
      toast.error(result.error);
      return;
    }
    setDone(result.data.imported);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-1.5">
        <Label htmlFor="import-file">Spreadsheet (.xlsx or .xls)</Label>
        <Input
          id="import-file"
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={onFileChange}
        />
      </div>

      {busy && <Progress value={undefined} aria-label="Working" className="h-1.5" />}

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="whitespace-pre-wrap">{error}</AlertDescription>
        </Alert>
      )}

      {done !== null && (
        <Alert className="border-[color:var(--status-good-text)]/30 bg-surface-good">
          <AlertDescription className="text-[color:var(--status-good-text)]">
            Imported {done} questions. Review them below, then approve the
            assignment when you&rsquo;re satisfied.{" "}
            <a href={`/classes/${classId}/assignments/${assignmentId}`} className="font-medium underline">
              Back to the assignment
            </a>
          </AlertDescription>
        </Alert>
      )}

      {preview && done === null && (
        <div className="space-y-4">
          {preview.worksheets.length > 1 && (
            <div className="grid max-w-xs gap-1.5">
              <Label htmlFor="worksheet">Worksheet</Label>
              <Select value={worksheet} onValueChange={onWorksheetChange}>
                <SelectTrigger id="worksheet">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {preview.worksheets.map((name) => (
                    <SelectItem
                      key={name}
                      value={name}
                      disabled={preview.emptyWorksheets.includes(name)}
                    >
                      {name}
                      {preview.emptyWorksheets.includes(name) ? " (empty)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Card className="p-0">
            <CardContent className="flex flex-wrap gap-6 p-4 text-sm">
              <div>
                <p className="note-muted">Questions</p>
                <p className="text-lg font-semibold tabular-nums">{preview.questions.length}</p>
              </div>
              <div>
                <p className="note-muted">Energy sources</p>
                <p className="text-lg font-semibold tabular-nums">{preview.sources.length}</p>
              </div>
              <div>
                <p className="note-muted">Criteria</p>
                <p className="text-lg font-semibold tabular-nums">{preview.criteria.length}</p>
              </div>
              <div>
                <p className="note-muted">Answer labels</p>
                <p className="text-sm font-semibold">
                  {preview.responseZeroLabel} / {preview.responseOneLabel}
                </p>
                {!preview.labelsDetected && (
                  <p className="note-muted">
                    (defaults — none detected in the sheet; editable after import)
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {preview.errors.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>
                {preview.errors.length} problem row(s) — nothing will be imported until these are
                fixed in the file
              </AlertTitle>
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {preview.errors.map((e, i) => (
                    <li key={i}>
                      <span className="font-mono">{e.location}</span>: {e.message}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {preview.anomalies.length > 0 && (
            <Alert>
              <AlertTitle>
                {preview.anomalies.length} pre-filled cell(s) in the answer grid (ignored on import)
              </AlertTitle>
              <AlertDescription>
                {preview.anomalies
                  .slice(0, 20)
                  .map((a) => `${a.cell}=${String(a.value)}`)
                  .join(", ")}
                {preview.anomalies.length > 20 ? "…" : ""}
              </AlertDescription>
            </Alert>
          )}

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead>Source cell</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.questions.map((q) => (
                  <TableRow key={q.externalQuestionCode}>
                    <TableCell className="text-ink-muted tabular-nums">{q.displayOrder}</TableCell>
                    <TableCell className="font-mono text-xs">{q.externalQuestionCode}</TableCell>
                    <TableCell>{q.questionText}</TableCell>
                    <TableCell className="font-mono text-xs text-ink-muted">
                      {q.originalColumnReference}
                      {q.originalRowReference}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <Button disabled={busy || preview.errors.length > 0} onClick={commit}>
            {busy ? "Importing…" : `Import ${preview.questions.length} questions`}
          </Button>
          {preview.errors.length > 0 && (
            <p className="text-sm text-ink-secondary">
              Fix the problem rows in the spreadsheet and re-upload — imports are all-or-nothing.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
