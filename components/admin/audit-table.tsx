"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PILL } from "@/lib/ui/tone";
import { Input } from "@/components/ui/input";
import { LocalDateTime } from "@/components/ui/local-date-time";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actor: string;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

/** Human wording for the actions the app actually records. */
const ACTION_LABELS: Record<string, string> = {
  CLASS_CREATED: "Created a class",
  ROSTER_IMPORTED: "Imported a roster",
  ASSIGNMENT_CREATED: "Created an assignment",
  ASSIGNMENT_IMPORTED: "Imported questions",
  ASSIGNMENT_APPROVED: "Marked an assignment ready",
  ASSIGNMENT_PUBLISHED: "Published an assignment",
  ASSIGNMENT_CLOSED: "Closed an assignment",
  ASSIGNMENT_REOPENED: "Reopened an assignment to students",
  ASSIGNMENT_ARCHIVED: "Archived an assignment",
  ASSIGNMENT_UNAPPROVED: "Returned an assignment to draft",
  ASSIGNMENT_DUPLICATED: "Duplicated an assignment",
  ATTEMPT_REOPENED: "Reopened a student's attempt",
  ASSIGNMENT_ATTEMPTS_REOPENED: "Reopened every submitted attempt on an assignment",
  MAPPING_CREATED: "Created a mapping",
  MAPPING_UPDATED: "Edited a mapping",
  MAPPING_APPROVED: "Approved a mapping",
  MAPPING_REJECTED: "Rejected a mapping",
  MAPPING_VERSIONED: "Created a new mapping version",
  MAPPING_DELETED: "Deleted a mapping",
  MAPPING_SUGGESTIONS_SEEDED: "Generated mapping suggestions",
  MAPPING_EXPORTED: "Exported mappings",
  EXPORT_GENERATED: "Generated an export",
  ADMIN_ROLE_CHANGED: "Changed someone's role",
  ADMIN_USER_DEACTIVATED: "Deactivated an account",
  ADMIN_USER_ACTIVATED: "Reactivated an account",
  ADMIN_STAFF_PREAUTHORISED: "Pre-authorised a staff account",
};

/** Tone by consequence, not by good/bad — these are workflow events. */
function toneFor(action: string): string {
  if (action.startsWith("ADMIN_")) return PILL.purple;
  if (action.includes("DELETED") || action.includes("DEACTIVATED")) return PILL.red;
  if (action.includes("APPROVED") || action.includes("PUBLISHED")) return PILL.green;
  return PILL.slate;
}

export function AuditTable({ rows }: { rows: AuditRow[] }) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.actor.toLowerCase().includes(needle) ||
        r.action.toLowerCase().includes(needle) ||
        (ACTION_LABELS[r.action] ?? "").toLowerCase().includes(needle) ||
        r.entityType.toLowerCase().includes(needle)
    );
  }, [rows, search]);

  return (
    <Card>
      <CardHeader className="gap-3">
        <div>
          <CardTitle>Activity log ({rows.length})</CardTitle>
          <CardDescription>
            What has been done in the system, newest first. Showing the most
            recent 500 events. This log is append-only — nothing here can be
            edited or removed from the interface.
          </CardDescription>
        </div>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search person or action…"
            aria-label="Search the activity log"
            className="w-72 pl-8"
          />
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Who</TableHead>
                <TableHead>What</TableHead>
                <TableHead>Item</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-ink-secondary tabular-nums">
                    <LocalDateTime value={row.createdAt} />
                  </TableCell>
                  <TableCell className="font-medium">{row.actor}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={toneFor(row.action)}>
                      {ACTION_LABELS[row.action] ?? row.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-ink-secondary">
                    {row.metadata && Object.keys(row.metadata).length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-help underline decoration-dotted underline-offset-2">
                            {row.entityType}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-sm">
                          <pre className="whitespace-pre-wrap text-xs">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      row.entityType
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-ink-muted">
                    {rows.length === 0
                      ? "Nothing has been recorded yet."
                      : "No activity matches that search."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
