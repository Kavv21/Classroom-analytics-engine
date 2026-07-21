"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  assignmentFormSchema,
  type AssignmentFormValues,
} from "@/lib/assignments/schema";
import type { AssignmentActionResult } from "@/lib/assignments/actions";

interface AssignmentFormProps {
  defaultValues?: Partial<AssignmentFormValues>;
  onSubmitAction: (values: AssignmentFormValues) => Promise<AssignmentActionResult<{ id: string }>>;
  submitLabel: string;
  redirectOnSuccess: (id: string) => string;
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
  redirectOnSuccess,
}: AssignmentFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
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
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof AssignmentFormValues, { message: messages[0] });
          }
        }
      }
      return;
    }

    router.push(redirectOnSuccess(result.data.id));
    router.refresh();
  }

  const fieldError = (name: keyof AssignmentFormValues) =>
    errors[name] ? (
      <p role="alert" className="mt-1 text-sm text-red-600">
        {errors[name]?.message}
      </p>
    ) : null;

  const inputClass = "mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm";

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div>
        <label htmlFor="title" className="block text-sm font-medium text-gray-700">
          Title
        </label>
        <input id="title" type="text" {...register("title")} className={inputClass} />
        {fieldError("title")}
      </div>

      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-700">
          Description
        </label>
        <textarea id="description" rows={2} {...register("description")} className={inputClass} />
        {fieldError("description")}
      </div>

      <div>
        <label htmlFor="instructions" className="block text-sm font-medium text-gray-700">
          Instructions shown to students
        </label>
        <textarea id="instructions" rows={3} {...register("instructions")} className={inputClass} />
        {fieldError("instructions")}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="assignmentStage" className="block text-sm font-medium text-gray-700">
            Stage
          </label>
          <select id="assignmentStage" {...register("assignmentStage")} className={inputClass}>
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          {fieldError("assignmentStage")}
        </div>
        <div>
          <label htmlFor="sequenceNumber" className="block text-sm font-medium text-gray-700">
            Sequence number
          </label>
          <input
            id="sequenceNumber"
            type="number"
            min={1}
            {...register("sequenceNumber")}
            className={inputClass}
          />
          {fieldError("sequenceNumber")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="openAt" className="block text-sm font-medium text-gray-700">
            Opens at (optional)
          </label>
          <input id="openAt" type="datetime-local" {...register("openAt")} className={inputClass} />
          {fieldError("openAt")}
        </div>
        <div>
          <label htmlFor="closeAt" className="block text-sm font-medium text-gray-700">
            Closes at (optional)
          </label>
          <input id="closeAt" type="datetime-local" {...register("closeAt")} className={inputClass} />
          {fieldError("closeAt")}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="responseZeroLabel" className="block text-sm font-medium text-gray-700">
            Label for 0
          </label>
          <input
            id="responseZeroLabel"
            type="text"
            {...register("responseZeroLabel")}
            className={inputClass}
          />
          {fieldError("responseZeroLabel")}
        </div>
        <div>
          <label htmlFor="responseOneLabel" className="block text-sm font-medium text-gray-700">
            Label for 1
          </label>
          <input
            id="responseOneLabel"
            type="text"
            {...register("responseOneLabel")}
            className={inputClass}
          />
          {fieldError("responseOneLabel")}
        </div>
      </div>

      <div className="flex gap-6">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register("allowDraftEditing")} />
          Allow draft editing
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register("allowResubmission")} />
          Allow resubmission after reopening
        </label>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
