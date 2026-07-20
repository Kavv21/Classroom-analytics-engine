"use client";

import { ClassForm } from "@/components/classes/class-form";
import { updateClass } from "@/lib/classes/actions";
import type { ClassFormValues } from "@/lib/classes/schema";

export function EditClassForm({
  classId,
  defaultValues,
}: {
  classId: string;
  defaultValues: Partial<ClassFormValues>;
}) {
  return (
    <ClassForm
      defaultValues={defaultValues}
      onSubmitAction={(values) => updateClass(classId, values)}
      submitLabel="Save changes"
      redirectOnSuccess={(id) => `/classes/${id}`}
    />
  );
}
