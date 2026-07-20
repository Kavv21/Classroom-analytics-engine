import { z } from "zod";

/**
 * Shared create/edit shape for a class. Kept intentionally close to the
 * `classes` table columns in supabase/migrations/0001_init.sql — see
 * /docs/DATABASE_SCHEMA.md#classes.
 */
export const classFormSchema = z
  .object({
    name: z.string().trim().min(1, "Class name is required").max(200),
    courseName: z.string().trim().max(200).optional().or(z.literal("")),
    academicYear: z.string().trim().max(20).optional().or(z.literal("")),
    semester: z.string().trim().max(50).optional().or(z.literal("")),
    section: z.string().trim().max(50).optional().or(z.literal("")),
    classCode: z.string().trim().max(50).optional().or(z.literal("")),
    startDate: z.string().trim().optional().or(z.literal("")),
    endDate: z.string().trim().optional().or(z.literal("")),
  })
  .refine(
    (data) => !data.startDate || !data.endDate || data.startDate <= data.endDate,
    { message: "End date must be on or after the start date", path: ["endDate"] }
  );

export type ClassFormValues = z.infer<typeof classFormSchema>;
