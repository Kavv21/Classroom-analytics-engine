"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useFieldArray, useForm, type FieldErrors, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { Plus, Trash2, UserPlus } from "lucide-react";
import { addStudentsManually } from "@/lib/roster/actions";
import {
  checkManualRows,
  emptyManualRow,
  isBlankManualRow,
  MANUAL_ROW_FIELDS,
  MAX_MANUAL_ROWS,
  type ManualAddRowResult,
  type ManualAddSummary,
  type ManualStudentRowInput,
} from "@/lib/roster/manual";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Busy } from "@/components/ui/busy";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ALLOWED_EMAIL_DOMAIN = process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ?? null;

interface FormValues {
  rows: ManualStudentRowInput[];
}

function newKey(): string {
  return crypto.randomUUID();
}

/**
 * Per-row validation. A blank row is skipped rather than flagged — it is a
 * row the professor added and didn't use. Errors on one row never stop the
 * others from being sent (see onSubmit, which does not go through
 * handleSubmit for exactly that reason).
 */
const rowsResolver: Resolver<FormValues> = async (values) => {
  const checks = checkManualRows(values.rows, ALLOWED_EMAIL_DOMAIN);
  const rowErrors: FieldErrors<FormValues>["rows"] = [];
  let any = false;
  values.rows.forEach((row, index) => {
    const check = checks[index]!;
    if (check.ok || isBlankManualRow(row)) return;
    any = true;
    rowErrors[index] = Object.fromEntries(
      Object.entries(check.fieldErrors).map(([field, message]) => [
        field,
        { type: "validate", message },
      ])
    );
  });
  if (!any) return { values, errors: {} };
  return { values: {}, errors: { rows: rowErrors } as FieldErrors<FormValues> };
};

/**
 * Adds one or a few students by typing them in — the no-file path beside
 * "Import a roster". Each row is sent and answered on its own: rows that
 * went through are cleared, rows that didn't stay with their reason so the
 * professor can fix and resubmit just those.
 *
 * There is no role field. The database writes STUDENT
 * (add_students_to_class, migration 0031).
 */
export function AddStudentsDialog({ classId }: { classId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<ManualAddSummary | null>(null);
  const [rowMessages, setRowMessages] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: rowsResolver,
    mode: "onTouched",
    defaultValues: { rows: [emptyManualRow(newKey())] },
  });
  const { control, register, formState, getValues, reset, setError, trigger } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "rows", keyName: "fieldId" });

  function resetAll() {
    reset({ rows: [emptyManualRow(newKey())] });
    setSummary(null);
    setRowMessages({});
    setFormError(null);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    // Show every row's inline errors, then send whatever is valid anyway.
    await trigger();
    const rows = getValues("rows").filter((row) => !isBlankManualRow(row));
    if (rows.length === 0) {
      setFormError("Fill in at least one student.");
      return;
    }

    setSubmitting(true);
    const result = await addStudentsManually(classId, rows);
    setSubmitting(false);

    if (!result.success) {
      setFormError(result.error);
      toast.error(result.error);
      return;
    }

    const { results, added } = result.data;
    const remaining = results.filter((r) => r.status === "failed");

    if (added > 0 || results.some((r) => r.status === "attention")) router.refresh();

    if (remaining.length === 0 && results.every((r) => r.status === "added")) {
      toast.success(successToast(results));
      setOpen(false);
      resetAll();
      return;
    }

    // Keep only the rows that need fixing, with their reasons.
    const keep = getValues("rows").filter((row) => remaining.some((r) => r.key === row.key));
    reset({ rows: keep.length > 0 ? keep : [emptyManualRow(newKey())] });
    setRowMessages(Object.fromEntries(remaining.map((r) => [r.key, r.message])));
    keep.forEach((row, index) => {
      const fieldErrors = remaining.find((r) => r.key === row.key)?.fieldErrors ?? {};
      for (const [field, message] of Object.entries(fieldErrors)) {
        setError(`rows.${index}.${field as keyof typeof fieldErrors}`, { type: "server", message });
      }
    });
    setSummary(result.data);
    const attentionCount = result.data.needsAttention;
    toast.warning(`${added} added, ${attentionCount} need${attentionCount === 1 ? "s" : ""} attention.`);
  }

  const added = summary?.results.filter((r) => r.status === "added") ?? [];
  const attention = summary?.results.filter((r) => r.status === "attention") ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submitting) return;
        setOpen(next);
        if (!next) resetAll();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus className="size-4" aria-hidden="true" />
          Add student
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Add students</DialogTitle>
          <DialogDescription>
            Type in one or a few students. Name and email are required. Anyone who
            already has an account can sign in straight away; everyone else is set
            up the first time they sign in with Google. For a longer list, use
            Import a roster.
          </DialogDescription>
        </DialogHeader>

        {summary && (
          <Alert
            role="status"
            className="border-[color:var(--status-critical-text)]/30 bg-surface-critical"
          >
            <AlertTitle className="text-[color:var(--status-critical-text)]">
              {summary.added} added, {summary.needsAttention} need
              {summary.needsAttention === 1 ? "s" : ""} attention
            </AlertTitle>
            <AlertDescription>
              {added.length > 0 && (
                <ul className="space-y-0.5">
                  {added.map((r) => (
                    <li key={r.key}>{r.message}</li>
                  ))}
                </ul>
              )}
              {attention.length > 0 && <AttentionList rows={attention} />}
              {fields.length > 0 && summary.results.some((r) => r.status === "failed") && (
                <p className="mt-2">The rows below weren&rsquo;t added. Fix them and add again.</p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <form id="add-students-form" onSubmit={onSubmit} noValidate className="grid gap-4">
          {fields.map((field, index) => {
            const rowErrors = formState.errors.rows?.[index];
            const message = rowMessages[field.key];
            return (
              <fieldset
                key={field.fieldId}
                className="relative rounded-lg border border-border p-3"
                aria-describedby={message ? `${field.fieldId}-message` : undefined}
              >
                <legend className="px-1 text-sm font-medium">Student {index + 1}</legend>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="absolute top-1 right-1"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1 || submitting}
                  aria-label={`Remove student ${index + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
                {message && (
                  <p
                    id={`${field.fieldId}-message`}
                    className="mt-1 text-sm text-[color:var(--status-critical-text)]"
                  >
                    {message}
                  </p>
                )}
                <input type="hidden" {...register(`rows.${index}.key`)} />
                <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {MANUAL_ROW_FIELDS.map(({ name, label }) => {
                    const id = `${field.fieldId}-${name}`;
                    const error = rowErrors?.[name]?.message;
                    const required = name === "fullName" || name === "email";
                    return (
                      <div key={name} className="grid gap-1.5">
                        <Label htmlFor={id}>
                          {label}
                          {!required && <span className="note-muted font-normal"> (optional)</span>}
                        </Label>
                        <Input
                          id={id}
                          type={name === "email" ? "email" : "text"}
                          autoComplete="off"
                          placeholder={
                            name === "email" && ALLOWED_EMAIL_DOMAIN
                              ? `name@${ALLOWED_EMAIL_DOMAIN}`
                              : undefined
                          }
                          aria-invalid={!!error}
                          aria-describedby={error ? `${id}-error` : undefined}
                          {...register(`rows.${index}.${name}`)}
                        />
                        {error && (
                          <p
                            id={`${id}-error`}
                            className="text-xs text-[color:var(--status-critical-text)]"
                          >
                            {error}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append(emptyManualRow(newKey()))}
              disabled={fields.length >= MAX_MANUAL_ROWS || submitting}
            >
              <Plus className="size-4" aria-hidden="true" />
              Add another row
            </Button>
          </div>

          {formError && (
            <p role="alert" className="text-sm text-[color:var(--status-critical-text)]">
              {formError}
            </p>
          )}
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(false);
              resetAll();
            }}
            disabled={submitting}
          >
            {summary ? "Done" : "Cancel"}
          </Button>
          <Button type="submit" form="add-students-form" disabled={submitting}>
            {submitting ? (
              <Busy label="Adding…" />
            ) : fields.length === 1 ? (
              "Add student"
            ) : (
              `Add ${fields.length} students`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AttentionList({ rows }: { rows: ManualAddRowResult[] }) {
  return (
    <div className="mt-2">
      <p>
        On the roster, but their accounts couldn&rsquo;t be linked to this class, so they
        can&rsquo;t get in yet:
      </p>
      <ul className="mt-1 space-y-0.5">
        {rows.map((r) => (
          <li key={r.key}>
            <span className="font-medium">{r.fullName || r.email}</span> &mdash; {r.message}
          </li>
        ))}
      </ul>
    </div>
  );
}

function successToast(results: ManualAddRowResult[]): string {
  if (results.length === 1) return results[0]!.message;
  const pending = results.filter((r) => r.outcome === "PENDING_SIGNUP").length;
  const base = `${results.length} students added.`;
  if (pending === 0) return `${base} They can sign in now.`;
  if (pending === results.length) return `${base} They'll be set up at their first Google sign-in.`;
  return `${base} ${pending} will be set up at their first Google sign-in; the rest can sign in now.`;
}
