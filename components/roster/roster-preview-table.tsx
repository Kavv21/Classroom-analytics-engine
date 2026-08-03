"use client";

import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table";
import type { RosterRowResult, RosterRowClassification } from "@/lib/types/domain";
import { Badge } from "@/components/ui/badge";
import { PILL } from "@/lib/ui/tone";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const CLASSIFICATION_LABEL: Record<RosterRowClassification, string> = {
  NEW: "New",
  EXISTING_PROFILE: "Already provisioned — will enrol",
  DUPLICATE_IN_FILE: "Duplicate in file",
  DUPLICATE_ALREADY_IN_CLASS: "Already in this class",
  DUPLICATE_PENDING_OTHER_CLASS: "Pending for another class",
  INVALID: "Invalid",
};

/** Tone by outcome. Text always carries the meaning; colour is redundant. */
/**
 * Import validation outcome per row. This IS a success/failure axis — a
 * rejected roster row is genuinely a failure the professor has to fix — so
 * green and red are the honest encoding here, and .claude/rules/analytics.md
 * permits it: an import outcome is workflow state, not response data. The
 * label is always rendered in the same cell (WCAG 1.4.1).
 */
const CLASSIFICATION_TONE: Record<RosterRowClassification, string> = {
  NEW: PILL.green,
  EXISTING_PROFILE: PILL.blue,
  DUPLICATE_IN_FILE: PILL.amber,
  DUPLICATE_ALREADY_IN_CLASS: PILL.amber,
  DUPLICATE_PENDING_OTHER_CLASS: PILL.amber,
  INVALID: PILL.red,
};

const columnHelper = createColumnHelper<RosterRowResult>();

const columns = [
  columnHelper.accessor("rowNumber", { header: "Row" }),
  columnHelper.accessor((row) => row.data?.email ?? String(row.raw.email ?? ""), {
    id: "email",
    header: "Email",
  }),
  columnHelper.accessor((row) => row.data?.fullName ?? String(row.raw.fullName ?? ""), {
    id: "fullName",
    header: "Full name",
  }),
  columnHelper.accessor("classification", {
    header: "Status",
    cell: (info) => (
      <Badge variant="outline" className={CLASSIFICATION_TONE[info.getValue()]}>
        {CLASSIFICATION_LABEL[info.getValue()]}
      </Badge>
    ),
  }),
  columnHelper.accessor("errors", {
    header: "Notes",
    cell: (info) => info.getValue().join("; "),
  }),
];

export function RosterPreviewTable({ rows }: { rows: RosterRowResult[] }) {
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });

  if (rows.length === 0) {
    return <p className="text-sm text-ink-muted">No rows.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
