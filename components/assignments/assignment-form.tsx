"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  assignmentFormSchema,
  type AssignmentFormValues,
} from "@/lib/assignments/schema";
import { isoToLocalInput, localInputToIso } from "@/lib/assignments/schedule";
import type { AssignmentActionResult } from "@/lib/assignments/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Busy } from "@/components/ui/busy";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface AssignmentFormProps {
  defaultValues?: Partial<AssignmentFormValues>;
  onSubmitAction: (values: AssignmentFormValues) => Promise<AssignmentActionResult<{ id: string }>>;
  submitLabel: string;
  /**
   * Where to go after a successful submit: `${redirectBasePath}/${id}`,
   * where id is the created/updated assignment's id. A serializable string
   * (not a callback) so Server Component pages can pass it across the
   * client boundary.
   */
  redirectBasePath: string;
}

const STAGES = [
  { value: "PRE_INSTRUCTION", label: "Pre-instruction" },
  { value: "POST_INSTRUCTION", label: "Post-instruction" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "OTHER", label: "Other" },
] as const;

/**
 * A closed choice, not a free number box.
 *
 * The old control was `<Input type="number" min={1}>` labelled "Sequence
 * number", defaulting to 1. Nothing about that tells a professor it decides
 * which answers get compared with which, and nothing stopped them leaving
 * two assignments on 1 — which silently disables the aggregate comparison
 * (see migration 0018 for the full cascade).
 *
 * It then offered exactly two answers, which over-corrected: a class could
 * hold no more than two assignments at all. Only the compared PAIR is
 * limited to one each. "Other" is the escape hatch and can be used as many
 * times as the professor likes — the server allocates its stored number
 * (3, 4, 5, …) so two "other" assignments never collide.
 */
const SEQUENCE_CHOICES = [
  { value: "FIRST", label: "First — answered before instruction" },
  { value: "SECOND", label: "Second — answered after instruction" },
  { value: "OTHER", label: "Other — a standalone assignment" },
] as const;

export function AssignmentForm({
  defaultValues,
  onSubmitAction,
  submitLabel,
  redirectBasePath,
}: AssignmentFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    getValues,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: {
      title: "",
      description: "",
      instructions: "",
      assignmentStage: "OTHER",
      sequencePosition: "FIRST",
      openAt: "",
      closeAt: "",
      allowDraftEditing: true,
      allowResubmission: false,
      responseZeroLabel: "No (0)",
      responseOneLabel: "Yes (1)",
      ...defaultValues,
    },
  });

  /**
   * The schedule is stored as instants (`timestamptz`) and edited as wall
   * clock times, and only the browser knows the professor's timezone — so
   * both halves of the conversion happen here, in an effect and at submit,
   * never on the server. Doing it server-side is what made a 5 PM close
   * time mean 17:00 UTC (see lib/assignments/schedule.ts).
   *
   * The effect runs once: `defaultValues` arrives holding ISO instants from
   * the database, which a datetime-local input cannot display, so the
   * fields start empty and fill in on mount. Re-running it over an
   * already-converted value would be harmless (the conversion is
   * idempotent) but would also stomp on whatever the professor has typed
   * since.
   */
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    for (const field of ["openAt", "closeAt"] as const) {
      const stored = getValues(field);
      if (stored) setValue(field, isoToLocalInput(stored));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSubmit(values: AssignmentFormValues) {
    setFormError(null);
    const result = await onSubmitAction({
      ...values,
      openAt: localInputToIso(values.openAt),
      closeAt: localInputToIso(values.closeAt),
    });

    if (!result.success) {
      setFormError(result.error);
      toast.error(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof AssignmentFormValues, { message: messages[0] });
          }
        }
      }
      return;
    }

    router.push(`${redirectBasePath}/${result.data.id}`);
    router.refresh();
  }

  const fieldError = (name: keyof AssignmentFormValues) =>
    errors[name] ? (
      <p role="alert" className="mt-1 text-xs text-[color:var(--status-critical-text)]">
        {errors[name]?.message}
      </p>
    ) : null;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid gap-1.5">
        <Label htmlFor="title">Title</Label>
        <Input id="title" type="text" aria-invalid={!!errors.title} {...register("title")} />
        {fieldError("title")}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={2} {...register("description")} />
        {fieldError("description")}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="instructions">Instructions shown to students</Label>
        <Textarea id="instructions" rows={3} {...register("instructions")} />
        {fieldError("instructions")}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="assignmentStage">Stage</Label>
          <Controller
            name="assignmentStage"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id="assignmentStage">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGES.map((stage) => (
                    <SelectItem key={stage.value} value={stage.value}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          {fieldError("assignmentStage")}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sequencePosition">Which assignment is this?</Label>
          <Controller
            name="sequencePosition"
            control={control}
            render={({ field }) => (
              <Select value={field.value ?? ""} onValueChange={field.onChange}>
                <SelectTrigger id="sequencePosition" aria-describedby="sequencePosition-help">
                  <SelectValue placeholder="Choose a position" />
                </SelectTrigger>
                <SelectContent>
                  {SEQUENCE_CHOICES.map((choice) => (
                    <SelectItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <p id="sequencePosition-help" className="text-xs text-muted-foreground">
            The first assignment is the one students answer before instruction; the
            second is the one they answer afterwards. That pair is what the
            before/after comparison is built from, so a class can have only one of
            each. Choose <strong>Other</strong> for anything else — you can add as
            many of those as you need, and each one reports on its own.
          </p>
          {fieldError("sequencePosition")}
        </div>
      </div>

      <fieldset className="grid gap-1.5 rounded-md border border-hairline p-4">
        <legend className="eyebrow px-1">Schedule</legend>
        <p id="schedule-help" className="note">
          These two times are what let students in. Once you have marked the
          assignment ready, it opens itself at the first time and stops
          accepting answers at the second &mdash; there is no button to press.
          Leave them empty while you are still preparing: students can&apos;t
          reach an assignment with no schedule.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="openAt">Opens at</Label>
            <Input
              id="openAt"
              type="datetime-local"
              aria-describedby="schedule-help schedule-timezone"
              aria-invalid={!!errors.openAt}
              {...register("openAt")}
            />
            {fieldError("openAt")}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="closeAt">Closes at</Label>
            <Input
              id="closeAt"
              type="datetime-local"
              aria-describedby="schedule-help schedule-timezone"
              aria-invalid={!!errors.closeAt}
              {...register("closeAt")}
            />
            {fieldError("closeAt")}
          </div>
        </div>
        {/* Rendered only after mount: the timezone name comes from the
            browser, and printing anything here during SSR would be the
            server's zone (UTC) masquerading as the professor's. */}
        <p id="schedule-timezone" className="note-muted mt-1">
          {timeZone
            ? `Times are in your own timezone (${timeZone}).`
            : "Times are in your own timezone."}
        </p>
      </fieldset>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="responseZeroLabel">Label for 0</Label>
          <Input id="responseZeroLabel" type="text" {...register("responseZeroLabel")} />
          {fieldError("responseZeroLabel")}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="responseOneLabel">Label for 1</Label>
          <Input id="responseOneLabel" type="text" {...register("responseOneLabel")} />
          {fieldError("responseOneLabel")}
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <Controller
          name="allowDraftEditing"
          control={control}
          render={({ field }) => (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              Allow draft editing
            </label>
          )}
        />
        <Controller
          name="allowResubmission"
          control={control}
          render={({ field }) => (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              Allow resubmission after reopening
            </label>
          )}
        />
      </div>

      {formError && (
        <Alert variant="destructive">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? <Busy label="Saving…" /> : submitLabel}
      </Button>
    </form>
  );
}
