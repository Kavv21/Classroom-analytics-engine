"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { classFormSchema, type ClassFormValues } from "@/lib/classes/schema";
import type { ActionResult } from "@/lib/classes/actions";

interface ClassFormProps {
  defaultValues?: Partial<ClassFormValues>;
  onSubmitAction: (values: ClassFormValues) => Promise<ActionResult<{ id: string }>>;
  submitLabel: string;
  /**
   * Where to go after a successful submit: `${redirectBasePath}/${id}`,
   * where id is the created/updated class's id. A serializable string (not
   * a callback) so this prop stays legal across the server/client
   * component boundary.
   */
  redirectBasePath: string;
}

const fields: Array<{ name: keyof ClassFormValues; label: string; type?: string }> = [
  { name: "name", label: "Class name" },
  { name: "courseName", label: "Course name" },
  { name: "academicYear", label: "Academic year (e.g. 2026-27)" },
  { name: "semester", label: "Semester" },
  { name: "section", label: "Section" },
  { name: "classCode", label: "Class code (leave blank to auto-generate)" },
  { name: "startDate", label: "Start date", type: "date" },
  { name: "endDate", label: "End date", type: "date" },
];

export function ClassForm({
  defaultValues,
  onSubmitAction,
  submitLabel,
  redirectBasePath,
}: ClassFormProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ClassFormValues>({
    resolver: zodResolver(classFormSchema),
    defaultValues: {
      name: "",
      courseName: "",
      academicYear: "",
      semester: "",
      section: "",
      classCode: "",
      startDate: "",
      endDate: "",
      ...defaultValues,
    },
  });

  async function onSubmit(values: ClassFormValues) {
    setFormError(null);
    const result = await onSubmitAction(values);

    if (!result.success) {
      setFormError(result.error);
      if (result.fieldErrors) {
        for (const [field, messages] of Object.entries(result.fieldErrors)) {
          if (messages?.[0]) {
            setError(field as keyof ClassFormValues, { message: messages[0] });
          }
        }
      }
      return;
    }

    router.push(`${redirectBasePath}/${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {fields.map(({ name, label, type }) => (
        <div key={name}>
          <label htmlFor={name} className="field-label">
            {label}
          </label>
          <input
            id={name}
            type={type ?? "text"}
            aria-invalid={errors[name] ? "true" : undefined}
            aria-describedby={errors[name] ? `${name}-error` : undefined}
            {...register(name)}
            className={`input ${errors[name] ? "input-error" : ""}`}
          />
          {errors[name] && (
            <p
              id={`${name}-error`}
              role="alert"
              className="mt-1 text-xs"
              style={{ color: "var(--status-critical-text)" }}
            >
              {errors[name]?.message}
            </p>
          )}
        </div>
      ))}

      {formError && (
        <p role="alert" className="banner banner-critical">
          {formError}
        </p>
      )}

      <button type="submit" disabled={isSubmitting} className="btn btn-primary">
        {isSubmitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
