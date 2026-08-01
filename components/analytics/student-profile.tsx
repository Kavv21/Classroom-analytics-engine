"use client";

import { Fragment, useMemo, useState } from "react";
import { QuestionLabel } from "@/components/questions/question-label";
import { focusRing } from "@/components/analytics/chart-card";
import { FilterRow, FilterSearch, FilterSelect, ResetFiltersButton } from "@/components/analytics/filter-row";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BINARY_LABELS, QUALITY_LABELS, TRANSITION_STATE_LABELS } from "@/lib/analytics/chart-data";
import type {
  ResponseTransitionLiveRow,
  StudentTransitionSummary,
} from "@/lib/analytics/queries";
import {
  responseValueLabel,
  type StudentAssignmentResponses,
} from "@/lib/analytics/student-responses";
import { formatPct } from "@/lib/charts/theme";

/**
 * One student's profile, in two tabs.
 *
 *  - OPINION SHIFT is the mapping-based view: the ~11 approved mappings and
 *    how this student's answer moved between the paired questions. It is a
 *    small, curated subset by design — a mapping only exists where the
 *    professor approved one.
 *  - FULL RESPONSES is the raw view: every question on both assignments with
 *    the 0/1 the student actually recorded, whether or not it is mapped.
 *    Since the assignment grid became aggregate-only, this is the single
 *    place an individual answer is shown.
 *
 * Neither tab labels an answer right or wrong. 0 and 1 are two options.
 */

interface StudentProfileProps {
  studentName: string;
  summary: StudentTransitionSummary | null;
  transitions: ResponseTransitionLiveRow[];
  assignments: StudentAssignmentResponses[];
}

function valueLabel(v: 0 | 1 | null): string {
  if (v === null) return "no answer";
  return v === 0 ? BINARY_LABELS.zero : BINARY_LABELS.one;
}

export function StudentProfile({
  studentName,
  summary,
  transitions,
  assignments,
}: StudentProfileProps) {
  return (
    <Tabs defaultValue="shift" className="mt-6">
      <TabsList>
        <TabsTrigger value="shift">Opinion shift</TabsTrigger>
        <TabsTrigger value="raw">Full responses</TabsTrigger>
      </TabsList>

      <TabsContent value="shift" className="mt-4 space-y-4">
        <OpinionShift studentName={studentName} summary={summary} transitions={transitions} />
      </TabsContent>

      <TabsContent value="raw" className="mt-4 space-y-6">
        <p className="text-sm text-ink-secondary">
          Everything {studentName} recorded, question by question, on both assignments — not only
          the questions that carry an approved mapping. Answers come from each assignment&apos;s
          final submitted attempt.
        </p>
        {assignments.map((assignment) => (
          <RawResponses key={assignment.assignmentId} assignment={assignment} />
        ))}
        {assignments.length === 0 && (
          <p className="text-sm text-ink-muted">This class has no assignments yet.</p>
        )}
      </TabsContent>
    </Tabs>
  );
}

// ---------------------------------------------------------------- opinion shift

function OpinionShift({
  studentName,
  summary,
  transitions,
}: {
  studentName: string;
  summary: StudentTransitionSummary | null;
  transitions: ResponseTransitionLiveRow[];
}) {
  const rows = useMemo(
    () => [...transitions].sort((a, b) => a.mapping_name.localeCompare(b.mapping_name)),
    [transitions]
  );

  if (!summary && rows.length === 0) {
    return (
      <p className="text-sm text-ink-muted">
        No mapping-based data for {studentName} yet — it appears once mappings are approved and
        both assignments have answers.
      </p>
    );
  }

  return (
    <>
      {summary && (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-secondary md:grid-cols-5">
          <div>
            <dt className="text-ink-muted">Valid pairs</dt>
            <dd className="font-medium tabular-nums">{summary.valid_paired}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Changed</dt>
            <dd className="font-medium tabular-nums">{summary.changed_count}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Change rate</dt>
            <dd className="font-medium tabular-nums">{formatPct(summary.change_rate)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Stability</dt>
            <dd className="font-medium tabular-nums">{formatPct(summary.stability_rate)}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Net movement toward {BINARY_LABELS.one}</dt>
            <dd className="font-medium tabular-nums">
              {summary.net_movement_toward_1 > 0 ? "+" : ""}
              {summary.net_movement_toward_1}
            </dd>
          </div>
        </dl>
      )}

      <div className="overflow-x-auto rounded border border-hairline">
        <Table>
          <TableCaption className="sr-only">
            All approved-mapping transitions for {studentName}
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>Mapping</TableHead>
              <TableHead>Energy source</TableHead>
              <TableHead>Assignment 1 answer</TableHead>
              <TableHead>Assignment 2 answer</TableHead>
              <TableHead>Transition</TableHead>
              <TableHead>Data quality</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.mapping_id}>
                <TableCell>
                  {r.mapping_name} <span className="text-ink-muted">v{r.mapping_version}</span>
                </TableCell>
                <TableCell>{r.energy_source ?? "—"}</TableCell>
                <TableCell>{valueLabel(r.assignment_1_value)}</TableCell>
                <TableCell>{valueLabel(r.assignment_2_value)}</TableCell>
                <TableCell>
                  {r.transition_state ? TRANSITION_STATE_LABELS[r.transition_state] : "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {r.data_quality_status
                    ? QUALITY_LABELS[
                        r.data_quality_status.toLowerCase() as keyof typeof QUALITY_LABELS
                      ]
                    : "Valid pair"}
                </TableCell>
              </TableRow>
            ))}
            {rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-ink-muted">
                  No approved mappings produce a row for this student yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="text-xs text-ink-muted">
        Change describes opinion movement between the two assignments. It is not a score, and
        neither answer is the preferred one. Only questions covered by an approved mapping appear
        here — see the <strong>Full responses</strong> tab for every question.
      </p>
    </>
  );
}

// --------------------------------------------------------------- raw responses

function RawResponses({ assignment }: { assignment: StudentAssignmentResponses }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [answer, setAnswer] = useState("");

  const sourceOptions = useMemo(
    () => assignment.groups.map((g) => g.energySource),
    [assignment.groups]
  );

  // Counts are recomputed over the FILTERED rows so a group heading always
  // describes what is on screen — a heading that counted hidden answers
  // would silently disagree with the rows under it.
  const groups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return assignment.groups
      .filter((g) => !source || g.energySource === source)
      .map((g) => {
        const rows = g.rows.filter((row) => {
          if (answer === "1" && row.value !== 1) return false;
          if (answer === "0" && row.value !== 0) return false;
          if (answer === "blank" && row.value !== null) return false;
          if (!needle) return true;
          return (
            (row.questionText ?? "").toLowerCase().includes(needle) ||
            row.criterion.toLowerCase().includes(needle) ||
            row.code.toLowerCase().includes(needle)
          );
        });
        return {
          energySource: g.energySource,
          rows,
          ones: rows.filter((r) => r.value === 1).length,
          zeros: rows.filter((r) => r.value === 0).length,
          blank: rows.filter((r) => r.value === null).length,
        };
      })
      .filter((g) => g.rows.length > 0);
  }, [assignment.groups, search, source, answer]);

  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const filtersActive = Boolean(search || source || answer);
  const blank = assignment.questionCount - assignment.answeredCount;

  return (
    <section aria-label={assignment.title} className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="heading">
          Assignment {assignment.sequenceNumber} — {assignment.title}
        </h3>
        <p className="text-xs text-ink-secondary">
          {assignment.attemptState
            ? `Attempt ${assignment.attemptState.toLowerCase()}`
            : "Not started"}
          {assignment.submittedAt
            ? ` · submitted ${new Date(assignment.submittedAt).toLocaleString()}`
            : ""}
          {assignment.submissionVersion && assignment.submissionVersion > 1
            ? ` · submission ${assignment.submissionVersion}`
            : ""}
        </p>
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-ink-secondary md:grid-cols-4">
        <div>
          <dt className="text-ink-muted">Questions</dt>
          <dd className="font-medium tabular-nums">{assignment.questionCount}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Answered {BINARY_LABELS.one}</dt>
          <dd className="font-medium tabular-nums">{assignment.ones}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Answered {BINARY_LABELS.zero}</dt>
          <dd className="font-medium tabular-nums">{assignment.zeros}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Left blank</dt>
          <dd className="font-medium tabular-nums">{blank}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <FilterRow>
          <FilterSearch
            label="Question"
            value={search}
            onChange={setSearch}
            placeholder="Search wording or code"
          />
          <FilterSelect
            label="Energy source"
            value={source}
            onChange={setSource}
            options={sourceOptions}
            allLabel="All energy sources"
          />
          <label className="text-xs text-ink-secondary">
            <span className="mb-0.5 block">Answer</span>
            <select
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              className={`input input-compact ${focusRing}`}
            >
              <option value="">All answers</option>
              <option value="1">{BINARY_LABELS.one}</option>
              <option value="0">{BINARY_LABELS.zero}</option>
              <option value="blank">No answer</option>
            </select>
          </label>
          <ResetFiltersButton
            onReset={() => {
              setSearch("");
              setSource("");
              setAnswer("");
            }}
            disabled={!filtersActive}
          />
        </FilterRow>
      </div>

      <p className="text-xs text-ink-muted">
        Showing {shown} of {assignment.questionCount} questions.
      </p>

      <div className="mt-2 overflow-x-auto rounded border border-hairline">
        <Table>
          <TableCaption className="sr-only">
            Every question on {assignment.title} with this student&apos;s answer
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[55%]">Question</TableHead>
              <TableHead>Criterion</TableHead>
              <TableHead>Source cell</TableHead>
              <TableHead>Answer</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <Fragment key={group.energySource}>
                <TableRow className="bg-surface-sunken">
                  <TableCell colSpan={4} className="font-semibold">
                    {group.energySource}
                    <span className="ml-2 font-normal text-ink-muted">
                      {group.rows.length} question{group.rows.length === 1 ? "" : "s"} ·{" "}
                      {group.ones} × {BINARY_LABELS.one} · {group.zeros} × {BINARY_LABELS.zero}
                      {group.blank > 0 ? ` · ${group.blank} blank` : ""}
                    </span>
                  </TableCell>
                </TableRow>
                {group.rows.map((row) => (
                  <TableRow key={row.questionId}>
                    <TableCell>
                      <QuestionLabel
                        question={{
                          questionText: row.questionText,
                          energySource: group.energySource,
                          criterion: row.criterion,
                          code: row.code,
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-ink-secondary">{row.criterion}</TableCell>
                    <TableCell className="mono text-ink-muted">{row.originalCell}</TableCell>
                    <TableCell
                      className={row.value === null ? "text-ink-muted" : "font-medium tabular-nums"}
                    >
                      {responseValueLabel(row.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
            {groups.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-ink-muted">
                  No questions match the current filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        0 and 1 are the two options — neither is a preferred answer, and nothing here is a grade.
        &ldquo;No answer&rdquo; means the student left that question blank.
      </p>
    </section>
  );
}
