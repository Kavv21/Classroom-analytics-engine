import { z } from "zod";

/**
 * Create/edit shape for an assignment. Mirrors the `assignments` table
 * (supabase/migrations/0001_init.sql, /docs/DATABASE_SCHEMA.md#assignments).
 * Status is NOT part of the form — status only changes through the
 * dedicated transition actions.
 */
export const assignmentFormSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(300),
    description: z.string().trim().max(5000).optional().or(z.literal("")),
    instructions: z.string().trim().max(10000).optional().or(z.literal("")),
    assignmentStage: z.enum(["PRE_INSTRUCTION", "POST_INSTRUCTION", "FOLLOW_UP", "OTHER"]),
    sequenceNumber: z.coerce.number().int().min(1).max(999),
    openAt: z.string().trim().optional().or(z.literal("")),
    closeAt: z.string().trim().optional().or(z.literal("")),
    allowDraftEditing: z.boolean(),
    allowResubmission: z.boolean(),
    responseZeroLabel: z.string().trim().min(1, "Label for 0 is required").max(100),
    responseOneLabel: z.string().trim().min(1, "Label for 1 is required").max(100),
  })
  .refine(
    (data) =>
      !data.openAt || !data.closeAt || new Date(data.openAt) <= new Date(data.closeAt),
    { message: "Close time must be at or after the open time", path: ["closeAt"] }
  );

export type AssignmentFormValues = z.infer<typeof assignmentFormSchema>;

export const questionLabelsSchema = z.object({
  responseZeroLabel: z.string().trim().min(1, "Label for 0 is required").max(100),
  responseOneLabel: z.string().trim().min(1, "Label for 1 is required").max(100),
});

export type QuestionLabelsValues = z.infer<typeof questionLabelsSchema>;
