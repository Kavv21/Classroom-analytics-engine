import { z } from "zod";

/** Blank, or something `new Date()` can actually resolve to an instant. */
const datetimeField = z
  .string()
  .trim()
  .refine((v) => v === "" || !Number.isNaN(new Date(v).getTime()), {
    message: "Enter a valid date and time",
  })
  .optional()
  .or(z.literal(""));

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
    // Position, not a raw number. FIRST/SECOND map to sequence_number 1/2
    // and are one-per-class; OTHER is unlimited and the server allocates
    // the next free number from 3 up (lib/assignments/sequence.ts).
    sequencePosition: z.enum(["FIRST", "SECOND", "OTHER"]),
    // The schedule window. Since migration 0029 these two are the ONLY
    // thing that lets students into a READY assignment, so they are
    // required together: half a window schedules nothing, and the DB
    // refuses to admit anyone to a READY assignment missing either bound.
    //
    // Accepted in either representation, because this schema validates the
    // form on the client (where the field holds a datetime-local wall
    // clock, "2026-08-20T17:00") and again in the server action (where it
    // holds the UTC instant that wall clock was converted to). Both parse.
    openAt: datetimeField,
    closeAt: datetimeField,
    allowDraftEditing: z.boolean(),
    allowResubmission: z.boolean(),
    responseZeroLabel: z.string().trim().min(1, "Label for 0 is required").max(100),
    responseOneLabel: z.string().trim().min(1, "Label for 1 is required").max(100),
  })
  .refine(
    (data) =>
      !data.openAt || !data.closeAt || new Date(data.openAt) <= new Date(data.closeAt),
    { message: "Close time must be at or after the open time", path: ["closeAt"] }
  )
  // Both or neither. A lone open date would let students in with no end,
  // and a lone close date schedules nothing at all — the assignment would
  // stay unreachable and the professor would have no way to tell why.
  .refine((data) => !data.openAt || !!data.closeAt, {
    message: "Set a closing time too — students need a window, not just a start",
    path: ["closeAt"],
  })
  .refine((data) => !data.closeAt || !!data.openAt, {
    message: "Set an opening time too — students need a window, not just an end",
    path: ["openAt"],
  });

export type AssignmentFormValues = z.infer<typeof assignmentFormSchema>;

export const questionLabelsSchema = z.object({
  responseZeroLabel: z.string().trim().min(1, "Label for 0 is required").max(100),
  responseOneLabel: z.string().trim().min(1, "Label for 1 is required").max(100),
});

export type QuestionLabelsValues = z.infer<typeof questionLabelsSchema>;
