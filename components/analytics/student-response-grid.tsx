import { answerCellContext } from "@/lib/attempts/answer-grid";
import { studentCellGlyph, type StudentGrid } from "@/lib/analytics/student-grid";
import { questionLabel } from "@/lib/ui/question-label";
import type { GridMatrixCell } from "@/lib/exports/response-grid";
import type { ResponseValue } from "@/lib/types/domain";

/**
 * ONE student's submission, in the shape they submitted it: the source
 * spreadsheet's own grid, read-only.
 *
 * Same table markup and the same tokens as the two grids it sits between —
 * the professor's aggregate response grid
 * (components/assignments/response-grid-table.tsx) and the student's own
 * editable answer grid (components/attempts/answer-grid.tsx). Where the
 * first shows a class count and the second a button, this shows the one
 * number the student recorded, as static text.
 *
 * NO TOTALS ROW, on purpose. The other two grids close with TOTAL because
 * summing a class's answers down a column is a descriptive statistic about
 * the class. Summing ONE person's 0s and 1s is a number about that person,
 * which reads as a score — and this app has no scores (CLAUDE.md: no
 * grades, no correctness). `buildStudentGrid` does not compute one, so
 * there is nothing here to render even by accident.
 *
 * The verbatim question wording does not fit in a grid cell and is not
 * paraphrased to make it fit (CLAUDE.md rule 1). It is carried in each
 * cell's tooltip and accessible name, and in full on the question-by-
 * question list under this grid.
 */

interface StudentResponseGridProps {
  grid: StudentGrid;
  assignmentTitle: string;
  /** Used only in the caption, so a screen reader knows whose sheet this is. */
  studentName: string;
}

/** The phrase a cell is meant to be read as, used as its tooltip. */
function cellTitle(cell: GridMatrixCell, value: ResponseValue): string {
  const answer = value === null ? "left blank" : `answered ${value}`;
  return `${answer} — ${cell.energySource} — ${cell.criterion} (${cell.code}, cell ${cell.originalCell})`;
}

/** The accessible name: where the cell is, what it asked, what they put. */
function cellName(
  cell: GridMatrixCell,
  rowLabel: string,
  columnLabel: string,
  value: ResponseValue
): string {
  const where = answerCellContext(rowLabel, columnLabel);
  const wording = questionLabel({
    questionText: cell.questionText,
    energySource: cell.energySource,
    criterion: cell.criterion,
    code: cell.code,
  });
  const answer = value === null ? "no answer" : String(value);
  return `${where}. ${wording}. Answer: ${answer}`;
}

export function StudentResponseGrid({
  grid,
  assignmentTitle,
  studentName,
}: StudentResponseGridProps) {
  const { matrix, answers } = grid;

  if (matrix.rows.length === 0) {
    return (
      <p className="mt-3 text-sm text-ink-muted">
        This assignment has no questions yet, so there is no grid to show.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="table-frame" style={{ maxHeight: "70vh", overflow: "auto" }}>
        <table className="border-collapse text-left text-xs">
          <caption className="sr-only">
            {assignmentTitle} — {studentName}&apos;s answer sheet, laid out as the original
            spreadsheet: {matrix.rowAxisHeading} down the rows, {matrix.rows.length} of them,
            against {matrix.columns.length} columns. Each cell holds the 0 or 1 they recorded, or a
            dot where they left it blank.
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
            {matrix.rows.map((row) => (
              <tr key={row.originalRow}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap border-r border-hairline bg-surface-raised px-3 py-1 text-left font-normal"
                >
                  {row.label}
                </th>
                {row.cells.map((cell, ci) => {
                  const column = matrix.columns[ci]!;
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
                  return (
                    <td key={column.originalColumn} className="border-l border-hairline p-0.5">
                      <span
                        className="cell-toggle"
                        data-answer={value === null ? "blank" : value}
                        title={cellTitle(cell, value)}
                      >
                        <span aria-hidden="true">{studentCellGlyph(value)}</span>
                        <span className="sr-only">
                          {cellName(cell, row.label, column.label, value)}
                        </span>
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {matrix.unplaced.length > 0 && (
        <p className="rounded border border-dashed border-hairline px-3 py-2 text-xs text-ink-secondary">
          {matrix.unplaced.length} question{matrix.unplaced.length === 1 ? "" : "s"} could not be
          placed on the grid because another question already occupies the same source cell:{" "}
          {matrix.unplaced.map((c) => `${c.code} (${c.originalCell})`).join(", ")}. Their answers
          are on the question-by-question list below.
        </p>
      )}

      <p className="text-xs text-ink-muted">
        This is the original spreadsheet&apos;s own grid — {grid.orientationText}. Each cell holds
        the one number this student recorded there. <span className="mono">·</span> means they left
        that cell blank, which is not the same as answering 0. 0 and 1 are the two options and
        neither is a preferred answer; nothing here is a grade. There is no total row: a figure
        summing one person&apos;s answers would read as a score, and this app has none.
      </p>
    </div>
  );
}
