"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  assignmentFormSchema,
  type AssignmentFormValues,
} from "@/lib/assignments/schema";
import type { AssignmentActionResult } from "@/lib/assignments/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

export function AssignmentForm({
  defaultValues,
  onSubmitAction,
  submitLabel,
  redirectBasePath,
}: AssignmentFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<AssignmentFormValues>({
    resolver: zodResolver(assignmentFormSchema),
    defaultValues: {
      title: "",
      description: "",
      instructions: "",
      assignmentStage: "OTHER",
      sequenceNumber: 1,
      openAt: "",
      closeAt: "",
      allowDraftEditing: true,
      allowResubmission: false,
      responseZeroLabel: "No (0)",
      responseOneLabel: "Yes (1)",
      ...defaultValues,
    },
  });

  async function onSubmit(values: AssignmentFormValues) {
    setFormError(null);
    const result = await onSubmitAction(values);

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
          <Label htmlFor="sequenceNumber">Sequence number</Label>
          <Input id="sequenceNumber" type="number" min={1} {...register("sequenceNumber")} />
          {fieldError("sequenceNumber")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="openAt">Opens at (optional)</Label>
          <Input id="openAt" type="datetime-local" {...register("openAt")} />
          {fieldError("openAt")}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="closeAt">Closes at (optional)</Label>
          <Input id="closeAt" type="datetime-local" {...register("closeAt")} />
          {fieldError("closeAt")}
        </div>
      </div>

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
        {isSubmitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
