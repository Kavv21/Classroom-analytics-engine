import { GRID_TOTAL_LABEL, type GridMatrixCell, type ResponseGrid } from "@/lib/exports/response-grid";

/**
 * The live response grid — the source spreadsheet's own grid, reproduced.
 *
 * Same rows, same columns, same order as the original file. Where a single
 * student would have typed 0 or 1, this shows ONE NUMBER: the sum of every
 * student's answer for that cell, which is the count of students who
 * answered 1. A TOTAL row sums straight down each column.
 *
 * That TOTAL row sits where the source file puts it, which differs per
 * assignment: below the data for Assignment 1 (its own blank "TOTAL" at
 * C21), above it for Assignment 2 ("Total score" at C6). The matrix decides
 * — this component only reads `totalsPosition`.
 *
 * AGGREGATE-ONLY. There are no student rows here and no way to reach one
 * person's answer: an individual submission lives on that student's profile
 * page, which is the single surface for raw per-person data.
 *
 * Same layout as the Excel grid sheet, and deliberately so: both are built
 * from `gatherResponseGrid`'s matrix, so the geometry, the labels and the
 * numbers are one definition rendered twice. The difference is freshness —
 * this recomputes on every load, the .xlsx is frozen at its download time,
 * and the page says which is which rather than leaving a professor to
 * assume.
 *
 * The grid is small in both orientations (15x2 for Assignment 1, 17x15 for
 * Assignment 2), so it is rendered whole with no filtering — a filtered
 * grid would no longer be the source file's grid. It still scrolls inside
 * its own container with the label column pinned, so the page never scrolls
 * sideways.
 */

interface ResponseGridTableProps {
  grid: ResponseGrid;
  exportHref: string;
}

/** The phrase a cell is meant to be read as, used as its tooltip. */
function cellTitle(cell: GridMatrixCell): string {
  const where = `${cell.energySource} — ${cell.criterion} (${cell.code}, cell ${cell.originalCell})`;
  if (cell.total === null || cell.answered === null) return `No answers recorded yet. ${where}`;
  return `${cell.total} of ${cell.answered} students who answered chose 1. ${where}`;
}

export function ResponseGridTable({ grid, exportHref }: ResponseGridTableProps) {
  const { matrix } = grid;
  const totalsOnTop = matrix.totalsPosition === "TOP";

  /** The TOTAL row, rendered identically wherever the source file puts it. */
  const totalsRow = (
    <tr className={totalsOnTop ? "border-b-2 border-hairline" : "border-t-2 border-hairline"}>
      <th
        scope="row"
        className="sticky left-0 z-10 whitespace-nowrap border-r border-hairline bg-surface-sunken px-3 py-2 text-left font-semibold"
      >
        {GRID_TOTAL_LABEL}
      </th>
      {matrix.columnTotals.map((total, ci) => (
        <td
          key={matrix.columns[ci]!.originalColumn}
          title={`Every ${matrix.rowAxisHeading.toLowerCase()} row, summed for ${matrix.columns[ci]!.label}`}
          className="border-l border-hairline bg-surface-sunken px-3 py-2 text-center font-semibold tabular-nums"
        >
          {total ?? "—"}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="mt-6 space-y-4">
      <div className="overflow-auto rounded border border-hairline" style={{ maxHeight: "70vh" }}>
        <table className="border-collapse text-left text-xs">
          <caption className="sr-only">
            {grid.assignmentTitle} — the source spreadsheet&apos;s grid, with each cell showing how
            many students answered 1, and a TOTAL row summing each column. No individual student
            answers.
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
            {matrix.rows.length > 0 && totalsOnTop && totalsRow}
            {matrix.rows.map((row) => (
              <tr key={row.originalRow}>
                <th
                  scope="row"
                  className="sticky left-0 z-10 whitespace-nowrap border-r border-hairline bg-surface px-3 py-1.5 text-left font-normal"
                >
                  {row.label}
                </th>
                {row.cells.map((cell, ci) => (
                  <td
                    key={matrix.columns[ci]!.originalColumn}
                    title={cell ? cellTitle(cell) : undefined}
                    className="border-l border-hairline px-3 py-1.5 text-center tabular-nums"
                  >
                    {cell?.total ?? "—"}
                  </td>
                ))}
              </tr>
            ))}
            {matrix.rows.length === 0 && (
              <tr>
                <td className="px-3 py-3 text-ink-muted">
                  This assignment has no questions yet, so there is no grid to show.
                </td>
              </tr>
            )}
          </tbody>
          {matrix.rows.length > 0 && !totalsOnTop && (
            <tfoot className="sticky bottom-0 z-20">{totalsRow}</tfoot>
          )}
        </table>
      </div>

      {matrix.unplaced.length > 0 && (
        <p className="rounded border border-dashed border-hairline px-3 py-2 text-xs text-ink-secondary">
          {matrix.unplaced.length} question{matrix.unplaced.length === 1 ? "" : "s"} could not be
          placed on the grid because another question already occupies the same source cell:{" "}
          {matrix.unplaced.map((c) => `${c.code} (${c.originalCell})`).join(", ")}. Their totals are
          not counted in the TOTAL row.
        </p>
      )}

      <p className="text-xs text-ink-muted">
        Each cell is the sum of every student&apos;s answer for that cell — the number of students
        who answered 1. 0 and 1 are the two options and neither is a preferred answer. A dash means
        no answers have been recorded there yet, and a student who left a cell blank counts in
        neither figure. The TOTAL row sums each column and sits{" "}
        {totalsOnTop ? "above" : "below"} the data, which is where this assignment&apos;s own source
        spreadsheet puts it.{" "}
        <a href={exportHref} className="link">
          Download this grid as Excel
        </a>
        .
      </p>
    </div>
  );
}
