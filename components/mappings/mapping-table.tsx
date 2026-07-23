"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  createMappingVersion,
  deleteMapping,
  previewMapping,
  setMappingApproval,
  type MappingPreview,
} from "@/lib/mappings/actions";
import type { MappingRowLite, QuestionLite } from "@/components/mappings/types";
import { mappingStatusLabel, mappingTypeLabel } from "@/lib/ui/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STATUS_TONE: Record<string, string> = {
  APPROVED: "border-transparent bg-surface-good text-[color:var(--status-good-text)]",
  NEEDS_PROFESSOR_REVIEW:
    "border-transparent bg-surface-warning text-[color:var(--status-warning-text)]",
  REJECTED: "border-transparent bg-surface-critical text-[color:var(--status-critical-text)]",
  SUGGESTED: "border-transparent bg-surface-info text-[color:var(--status-info-text)]",
  DRAFT: "border-transparent bg-surface-sunken text-ink-secondary",
  SUPERSEDED: "border-transparent bg-surface-sunken text-ink-muted",
};

function codesFor(ids: string[], questionsById: Record<string, QuestionLite>): string {
  if (ids.length === 0) return "—";
  const codes = ids.map((id) => questionsById[id]?.code ?? "?").sort();
  if (codes.length <= 4) return codes.join(", ");
  return `${codes.slice(0, 4).join(", ")} +${codes.length - 4} more`;
}

function PreviewPanel({
  preview,
  questionsById,
}: {
  preview: MappingPreview;
  questionsById: Record<string, QuestionLite>;
}) {
  const code = (id: string) => questionsById[id]?.code ?? id.slice(0, 8);
  return (
    <div className="space-y-3 bg-surface-sunken p-3 text-sm">
      <p className="text-ink-secondary">
        Preview of what this mapping <em>would</em> show once approved —
        counts of matched final responses from {preview.enrolledStudents}{" "}
        enrolled student{preview.enrolledStudents === 1 ? "" : "s"}. Nothing
        here reaches analytics until the mapping is approved.
      </p>

      {preview.questionCounts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pr-4 font-medium">Question</th>
                <th className="pr-4 font-medium">Side</th>
                <th className="pr-4 font-medium">Answered</th>
                <th className="pr-4 font-medium">0s</th>
                <th className="pr-4 font-medium">1s</th>
              </tr>
            </thead>
            <tbody>
              {preview.questionCounts.map((qc) => (
                <tr key={`${qc.questionId}-${qc.side}`}>
                  <td className="pr-4 font-mono">{code(qc.questionId)}</td>
                  <td className="pr-4">A{qc.side}</td>
                  <td className="pr-4">{qc.answered}</td>
                  <td className="pr-4">{qc.zeros}</td>
                  <td className="pr-4">{qc.ones}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview.pairCounts.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="pr-4 font-medium">A1 × A2 pair</th>
                <th className="pr-4 font-medium">Paired</th>
                <th className="pr-4 font-medium">0/0</th>
                <th className="pr-4 font-medium">0/1</th>
                <th className="pr-4 font-medium">1/0</th>
                <th className="pr-4 font-medium">1/1</th>
                <th className="pr-4 font-medium">Missing A1</th>
                <th className="pr-4 font-medium">Missing A2</th>
                <th className="pr-4 font-medium">Missing both</th>
              </tr>
            </thead>
            <tbody>
              {preview.pairCounts.map((p) => (
                <tr key={`${p.a1QuestionId}-${p.a2QuestionId}`}>
                  <td className="pr-4 font-mono">
                    {code(p.a1QuestionId)} × {code(p.a2QuestionId)}
                  </td>
                  <td className="pr-4">{p.paired}</td>
                  <td className="pr-4">{p.pair00}</td>
                  <td className="pr-4">{p.pair01}</td>
                  <td className="pr-4">{p.pair10}</td>
                  <td className="pr-4">{p.pair11}</td>
                  <td className="pr-4">{p.missingA1}</td>
                  <td className="pr-4">{p.missingA2}</td>
                  <td className="pr-4">{p.missingBoth}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-muted">
            Pair columns read “A1 value / A2 value”. Missing responses stay
            in their own columns — they are never counted as a pair.
          </p>
        </div>
      ) : (
        <p className="text-xs text-ink-muted">
          No cross-assignment pairs to preview (one side of this mapping has
          no questions).
        </p>
      )}
    </div>
  );
}

export function MappingTable({
  mappings,
  questionsById,
  onEdit,
}: {
  mappings: MappingRowLite[];
  questionsById: Record<string, QuestionLite>;
  onEdit: (mapping: MappingRowLite) => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, MappingPreview>>({});
  const [openPreviewId, setOpenPreviewId] = useState<string | null>(null);
  const [openHistoryId, setOpenHistoryId] = useState<string | null>(null);

  const byId = new Map(mappings.map((m) => [m.id, m]));

  function historyChain(mapping: MappingRowLite): MappingRowLite[] {
    const chain: MappingRowLite[] = [];
    let current: MappingRowLite | undefined = mapping;
    while (current) {
      chain.push(current);
      current = current.previousVersionId ? byId.get(current.previousVersionId) : undefined;
    }
    return chain;
  }

  async function run(id: string, fn: () => Promise<{ success: boolean; error?: string }>) {
    setBusyId(id);
    const result = await fn();
    setBusyId(null);
    if (!result.success) {
      toast.error(result.error ?? "Something went wrong.");
      return;
    }
    router.refresh();
  }

  async function togglePreview(id: string) {
    if (openPreviewId === id) {
      setOpenPreviewId(null);
      return;
    }
    if (!previews[id]) {
      setBusyId(id);
      const result = await previewMapping(id);
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setPreviews((prev) => ({ ...prev, [id]: result.data }));
    }
    setOpenPreviewId(id);
  }

  if (mappings.length === 0) {
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          No mappings yet. Select questions above and create one, or use
          “Generate suggestions” to seed the deterministic matches.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="p-0">
      <CardHeader className="border-b p-4">
        <CardTitle>Mappings ({mappings.length})</CardTitle>
        <CardDescription>
          Only approved mappings are visible to analytics. Approved mappings
          can&rsquo;t be edited — create a new version instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>A1 questions</TableHead>
              <TableHead>A2 questions</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((m) => {
              const busy = busyId === m.id;
              const superseded = m.mappingStatus === "SUPERSEDED" || m.supersededById !== null;
              const editable = !m.professorApproved && !superseded;
              return (
                <Fragment key={m.id}>
                  <TableRow className={superseded ? "text-ink-muted" : ""}>
                    <TableCell>
                      <span className="font-medium">{m.mappingName}</span>{" "}
                      <span className="text-xs text-ink-muted">v{m.version}</span>
                      {m.commonConcept && (
                        <span className="block text-xs text-ink-muted">{m.commonConcept}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs">{mappingTypeLabel(m.mappingType)}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {codesFor(m.a1QuestionIds, questionsById)}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {codesFor(m.a2QuestionIds, questionsById)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_TONE[m.mappingStatus] ?? ""}>
                        {mappingStatusLabel(m.mappingStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => togglePreview(m.id)}>
                          {openPreviewId === m.id ? "Hide preview" : "Preview"}
                        </Button>
                        {!m.professorApproved && !superseded && (
                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() => run(m.id, () => setMappingApproval(m.id, true))}
                          >
                            Approve
                          </Button>
                        )}
                        {m.mappingStatus !== "REJECTED" && !superseded && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => run(m.id, () => setMappingApproval(m.id, false))}
                          >
                            Reject
                          </Button>
                        )}
                        {!superseded && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => run(m.id, () => createMappingVersion(m.id))}
                          >
                            New version
                          </Button>
                        )}
                        {editable && (
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => onEdit(m)}>
                            Edit
                          </Button>
                        )}
                        {editable && (
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button size="sm" variant="destructive" disabled={busy}>
                                Delete
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete “{m.mappingName}”?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This mapping is not approved and nothing depends on it, so it can
                                  be removed. This can&rsquo;t be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => run(m.id, () => deleteMapping(m.id))}>
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        )}
                        {(m.version > 1 || m.supersededById) && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setOpenHistoryId(openHistoryId === m.id ? null : m.id)}
                          >
                            History
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {openPreviewId === m.id && previews[m.id] && (
                    <TableRow>
                      <TableCell colSpan={6} className="p-0">
                        <PreviewPanel preview={previews[m.id]!} questionsById={questionsById} />
                      </TableCell>
                    </TableRow>
                  )}
                  {openHistoryId === m.id && (
                    <TableRow>
                      <TableCell colSpan={6} className="bg-muted px-4 py-3 text-xs text-muted-foreground">
                        <p className="font-medium text-foreground">Revision history</p>
                        <ul className="mt-1 space-y-1">
                          {historyChain(m).map((v) => (
                            <li key={v.id}>
                              v{v.version} — {mappingStatusLabel(v.mappingStatus)}
                              {v.professorApproved ? " (live in analytics)" : ""} · last updated{" "}
                              {new Date(v.updatedAt).toLocaleString()}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
