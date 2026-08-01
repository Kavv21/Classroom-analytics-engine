"use client";

import { Fragment, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  reorderQuestions,
  updateQuestionLabels,
} from "@/lib/assignments/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QuestionLabel } from "@/components/questions/question-label";
import { questionLabel } from "@/lib/ui/question-label";
import { groupQuestionsBySource } from "@/lib/questions/group-by-source";

export interface QuestionRow {
  id: string;
  external_question_code: string;
  question_text: string;
  energy_source: string | null;
  criterion: string | null;
  response_zero_label: string;
  response_one_label: string;
  display_order: number;
}

interface QuestionManagerProps {
  assignmentId: string;
  questions: QuestionRow[];
  /** Once responses exist, only reordering is allowed (mirrors the DB
   * trigger — the trigger is the boundary, this just avoids dead-end UI). */
  hasResponses: boolean;
  /** Question edits/reorders only make sense pre-publication. */
  editable: boolean;
}

export function QuestionManager({
  assignmentId,
  questions,
  hasResponses,
  editable,
}: QuestionManagerProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [zeroLabel, setZeroLabel] = useState("");
  const [oneLabel, setOneLabel] = useState("");

  const ordered = [...questions].sort((a, b) => a.display_order - b.display_order);
  const displayIndex = new Map(ordered.map((q, i) => [q.id, i]));

  // One section per energy source. Grouping keys off the source name rather
  // than off adjacent rows, so it holds for both spreadsheet orientations
  // (see lib/questions/group-by-source.ts).
  const groups = groupQuestionsBySource(ordered);
  const showGroupHeadings = groups.some((g) => g.label !== null) && groups.length > 1;

  // For a criterion-major assignment the rendered order is not the display
  // order, so ↑/↓ act on the neighbour the professor actually sees; the swap
  // itself still just exchanges the two questions' display_order values.
  const rendered = groups.flatMap((g) => g.rows);
  const renderedIndex = new Map(rendered.map((q, i) => [q.id, i]));

  async function swap(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= rendered.length) return;
    const a = rendered[index];
    const b = rendered[target];
    if (a === undefined || b === undefined) return;
    const aAt = displayIndex.get(a.id);
    const bAt = displayIndex.get(b.id);
    if (aAt === undefined || bAt === undefined) return;
    const ids = ordered.map((q) => q.id);
    ids[aAt] = b.id;
    ids[bAt] = a.id;
    setBusy(true);
    const result = await reorderQuestions(assignmentId, ids);
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    router.refresh();
  }

  function startLabelEdit(q: QuestionRow) {
    setEditingId(q.id);
    setZeroLabel(q.response_zero_label);
    setOneLabel(q.response_one_label);
  }

  async function saveLabels(questionId: string) {
    setBusy(true);
    const result = await updateQuestionLabels(assignmentId, questionId, {
      responseZeroLabel: zeroLabel,
      responseOneLabel: oneLabel,
    });
    setBusy(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setEditingId(null);
    router.refresh();
  }

  if (ordered.length === 0) {
    return (
      <Alert className="mt-3">
        <AlertDescription>No questions yet. Import your spreadsheet to add them.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="mt-4">
      {hasResponses && (
        <Alert className="mb-3">
          <AlertDescription>
            Students have already answered this assignment, so question wording
            and answer labels are locked. You can still reorder questions. To
            change the questions themselves, duplicate the assignment and edit
            the copy.
          </AlertDescription>
        </Alert>
      )}
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Question</TableHead>
              <TableHead>Answer labels</TableHead>
              {editable && (
                <TableHead>
                  <span className="sr-only">Reorder</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.key}>
                {showGroupHeadings && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={editable ? 4 : 3}
                      className="bg-surface-sunken py-1.5"
                    >
                      <span className="eyebrow">{group.label ?? "Ungrouped"}</span>
                    </TableCell>
                  </TableRow>
                )}
                {group.rows.map((q) => {
                  const i = renderedIndex.get(q.id) ?? 0;
                  return (
              <TableRow key={q.id}>
                <TableCell className="text-ink-muted tabular-nums">{q.display_order}</TableCell>
                {/* Wording is the identifier a professor reads; the code is
                    kept underneath for cross-referencing exports. */}
                <TableCell>
                  <QuestionLabel
                    question={{
                      questionText: q.question_text,
                      energySource: q.energy_source,
                      criterion: q.criterion,
                      code: q.external_question_code,
                    }}
                  />
                </TableCell>
                <TableCell>
                  {editingId === q.id ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <Input
                        aria-label="Label for 0"
                        value={zeroLabel}
                        onChange={(e) => setZeroLabel(e.target.value)}
                        className="w-28"
                      />
                      <Input
                        aria-label="Label for 1"
                        value={oneLabel}
                        onChange={(e) => setOneLabel(e.target.value)}
                        className="w-28"
                      />
                      <Button size="sm" disabled={busy} onClick={() => saveLabels(q.id)}>
                        Save
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <span className="text-ink-secondary">
                      {q.response_zero_label} / {q.response_one_label}
                      {editable && !hasResponses && (
                        <button
                          type="button"
                          onClick={() => startLabelEdit(q)}
                          className="link ml-2 font-medium"
                        >
                          Edit
                        </button>
                      )}
                    </span>
                  )}
                </TableCell>
                {editable && (
                  <TableCell>
                    <span className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Move “${questionLabel({
                          questionText: q.question_text,
                          energySource: q.energy_source,
                          criterion: q.criterion,
                          code: q.external_question_code,
                        })}” up`}
                        disabled={busy || i === 0}
                        onClick={() => swap(i, -1)}
                        className="px-2"
                      >
                        ↑
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Move “${questionLabel({
                          questionText: q.question_text,
                          energySource: q.energy_source,
                          criterion: q.criterion,
                          code: q.external_question_code,
                        })}” down`}
                        disabled={busy || i === rendered.length - 1}
                        onClick={() => swap(i, 1)}
                        className="px-2"
                      >
                        ↓
                      </Button>
                    </span>
                  </TableCell>
                )}
              </TableRow>
                  );
                })}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
