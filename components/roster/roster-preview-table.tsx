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
  NEW: "bg-green-100 text-green-700",
  EXISTING_PROFILE: "bg-blue-100 text-blue-700",
  DUPLICATE_IN_FILE: "bg-amber-100 text-amber-700",
  DUPLICATE_ALREADY_IN_CLASS: "bg-amber-100 text-amber-700",
  DUPLICATE_PENDING_OTHER_CLASS: "bg-amber-100 text-amber-700",
  INVALID: "bg-red-100 text-red-700",
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
    return <p className="text-sm text-gray-500">No rows.</p>;
  }

  return (
    <div className="overflow-x-auto rounded border border-gray-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-gray-50">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} className="px-3 py-2 font-medium text-gray-600">
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y divide-gray-100">
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
