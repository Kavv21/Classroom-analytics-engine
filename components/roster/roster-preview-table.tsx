"use client";

import { useReactTable, getCoreRowModel, flexRender, createColumnHelper } from "@tanstack/react-table";
import type { RosterRowResult, RosterRowClassification } from "@/lib/types/domain";

const CLASSIFICATION_LABEL: Record<RosterRowClassification, string> = {
  NEW: "New",
  EXISTING_PROFILE: "Already provisioned — will enrol",
  DUPLICATE_IN_FILE: "Duplicate in file",
  DUPLICATE_ALREADY_IN_CLASS: "Already in this class",
  DUPLICATE_PENDING_OTHER_CLASS: "Pending for another class",
  INVALID: "Invalid",
};

const CLASSIFICATION_STYLE: Record<RosterRowClassification, string> = {
  NEW: "badge badge-good",
  EXISTING_PROFILE: "badge badge-info",
  DUPLICATE_IN_FILE: "badge badge-warning",
  DUPLICATE_ALREADY_IN_CLASS: "badge badge-warning",
  DUPLICATE_PENDING_OTHER_CLASS: "badge badge-warning",
  INVALID: "badge badge-critical",
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
      <span className={`rounded px-2 py-0.5 text-xs font-medium ${CLASSIFICATION_STYLE[info.getValue()]}`}>
        {CLASSIFICATION_LABEL[info.getValue()]}
      </span>
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
    <div className="overflow-x-auto rounded border border-hairline">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface-sunken">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 font-medium text-ink-secondary">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-hairline">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="px-3 py-2">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
