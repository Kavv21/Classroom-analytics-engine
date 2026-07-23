"use client";

import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table";
import type { RosterRowResult, RosterRowClassification } from "@/lib/types/domain";
import { Badge } from "@/components/ui/badge";
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
const CLASSIFICATION_TONE: Record<RosterRowClassification, string> = {
  NEW: "border-transparent bg-surface-good text-[color:var(--status-good-text)]",
  EXISTING_PROFILE: "border-transparent bg-surface-info text-[color:var(--status-info-text)]",
  DUPLICATE_IN_FILE: "border-transparent bg-surface-warning text-[color:var(--status-warning-text)]",
  DUPLICATE_ALREADY_IN_CLASS:
    "border-transparent bg-surface-warning text-[color:var(--status-warning-text)]",
  DUPLICATE_PENDING_OTHER_CLASS:
    "border-transparent bg-surface-warning text-[color:var(--status-warning-text)]",
  INVALID: "border-transparent bg-surface-critical text-[color:var(--status-critical-text)]",
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
