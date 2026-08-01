import { metadataLines, type ExportMetadata } from "@/lib/exports/metadata";

/**
 * RFC 4180 quoting: a field is only quoted when it has to be, and an
 * embedded quote is doubled. Shared by every CSV surface in the app.
 */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * CSV export with the provenance block written as leading `#` comment
 * lines, so the file is still a valid single-table CSV for a reader that
 * skips comments, while carrying its own context for a human opening it
 * in a text editor a year later.
 */
export function buildCsv(
  metadata: ExportMetadata,
  columns: string[],
  rows: Array<Array<string | number | null>>
): string {
  const lines: string[] = [];
  for (const [key, value] of metadataLines(metadata)) {
    lines.push(`# ${key}: ${value.replace(/[\r\n]+/g, " ")}`);
  }
  lines.push("#");
  lines.push(columns.map(csvEscape).join(","));
  for (const row of rows) {
    lines.push(row.map((cell) => csvEscape(cell === null || cell === undefined ? "" : String(cell))).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
