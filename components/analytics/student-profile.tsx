"use client";

import { Fragment, useId, useMemo, useState } from "react";
import { QuestionLabel } from "@/components/questions/question-label";
import { StudentResponseGrid } from "@/components/analytics/student-response-grid";
import { LocalDateTime } from "@/components/ui/local-date-time";
import { focusRing } from "@/components/analytics/chart-card";
import { FilterRow, FilterSearch, FilterSelect, ResetFiltersButton } from "@/components/analytics/filter-row";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BINARY_LABELS } from "@/lib/analytics/chart-data";
import {
  responseValueLabel,
  type StudentAssignmentResponses,
} from "@/lib/analytics/student-responses";

/**
 * One student's FULL responses: every question on both assignments with the
 * 0/1 they actually recorded. Since the assignment grid became
 * aggregate-only, this is the single place an individual answer is shown.
 *
 * IT LEADS WITH THE GRID. The submission is shown in the shape it was made
 * in — the source spreadsheet's own grid, the same geometry the student
 * answered on and the professor's class totals use — because 285 answers as
 * a flat list is a scroll, and as a grid it is a picture. The flat
 * question-by-question list is still here, one click away, because it is
 * the only place the verbatim question wording is readable and the only
 * place the answers can be searched and filtered.
 *
 * The "Opinion shift" tab that used to sit beside this one was removed with
 * the question-mapping feature: it showed how one student's answer moved
 * between a mapped pair of questions, and without an approved mapping there
 * is no record of which Assignment 1 question a given Assignment 2 question
 * corresponds to. Nothing has replaced it, and nothing here pairs an
 * Assignment 1 answer with an Assignment 2 answer.
 *
 * Nothing here labels an answer right or wrong. 0 and 1 are two options.
 */

interface StudentProfileProps {
  studentName: string;
  assignments: StudentAssignmentResponses[];
  /** GET route for the one-student .xlsx, or null to hide the button. */
  exportHref?: string | null;
}

export function StudentProfile({ studentName, assignments, exportHref }: StudentProfileProps) {
  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-ink-secondary">
          Everything {studentName} recorded on both assignments, laid out as the original
          spreadsheet. Answers come from each assignment&apos;s final submitted attempt.
        </p>
        {exportHref && assignments.length > 0 && (
          <a href={exportHref} className="btn btn-secondary shrink-0">
            Download as Excel
          </a>
        )}
      </div>
      {assignments.map((assignment) => (
        <RawResponses
          key={assignment.assignmentId}
          assignment={assignment}
          studentName={studentName}
        />
      ))}
      {assignments.length === 0 && (
        <p className="text-sm text-ink-muted">This class has no assignments yet.</p>
      )}
    </div>
  );
}

// --------------------------------------------------------------- raw responses

function RawResponses({
  assignment,
  studentName,
}: {
  assignment: StudentAssignmentResponses;
  studentName: string;
}) {
  // The list starts closed: the grid above it is the reading of this
  // submission, and 285 rows of list under it would bury the next
  // assignment's grid entirely.
  const [listOpen, setListOpen] = useState(false);
  const listId = useId();
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
          {assignment.submittedAt ? (
            <>
              {" · submitted "}
              <LocalDateTime value={assignment.submittedAt} />
            </>
          ) : null}
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

      <StudentResponseGrid
        grid={assignment.grid}
        assignmentTitle={assignment.title}
        studentName={studentName}
      />

      <div className="mt-4">
        <button
          type="button"
          onClick={() => setListOpen((open) => !open)}
          aria-expanded={listOpen}
          aria-controls={listId}
          className="btn btn-secondary"
        >
          {listOpen ? "Hide" : "Show"} question-by-question list
        </button>
        <p className="note-muted mt-1">
          The same {assignment.questionCount} answers as a searchable list, with each
          question&apos;s full wording — which a grid cell has no room for.
        </p>
      </div>

      {/* The region keeps its id whether or not it is open, so the button's
          aria-controls always points at something; its 285 rows are only
          mounted while it is. */}
      <div id={listId} hidden={!listOpen}>
        {listOpen && <ResponseList assignment={assignment} />}
      </div>
    </section>
  );
}

// ------------------------------------------------------- question-by-question

/**
 * The flat list under the grid: every question with its verbatim wording,
 * searchable and filterable. It is the only surface that shows the wording
 * in full — a grid cell has room for one digit — and the only one that can
 * be narrowed to "just the blanks" or "just the 1s".
 */
function ResponseList({ assignment }: { assignment: StudentAssignmentResponses }) {
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

  return (
    <>
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
    </>
  );
}
