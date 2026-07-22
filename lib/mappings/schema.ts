import { z } from "zod";

export const MAPPING_TYPES = [
  "EXACT_ONE_TO_ONE",
  "CONCEPTUAL_ONE_TO_ONE",
  "ONE_TO_MANY",
  "MANY_TO_ONE",
  "GROUPED_CONCEPT",
  "NOT_COMPARABLE",
  "UNMAPPED",
] as const;

/**
 * Side-count shape per mapping type — the friendly mirror of the
 * validate_mapping_questions check in migration 0011 (the DB is the
 * boundary; this exists for inline form errors).
 */
export function sideCountError(
  mappingType: (typeof MAPPING_TYPES)[number],
  a1Count: number,
  a2Count: number
): string | null {
  if (a1Count + a2Count === 0) return "Select at least one question.";
  switch (mappingType) {
    case "EXACT_ONE_TO_ONE":
    case "CONCEPTUAL_ONE_TO_ONE":
      return a1Count === 1 && a2Count === 1
        ? null
        : "One-to-one types need exactly one question on each side.";
    case "ONE_TO_MANY":
      return a1Count === 1 && a2Count >= 2
        ? null
        : "One-to-many needs exactly one Assignment 1 question and two or more Assignment 2 questions.";
    case "MANY_TO_ONE":
      return a1Count >= 2 && a2Count === 1
        ? null
        : "Many-to-one needs two or more Assignment 1 questions and exactly one Assignment 2 question.";
    case "GROUPED_CONCEPT":
      return a1Count >= 1 && a2Count >= 1
        ? null
        : "Grouped concept needs at least one question on each side.";
    case "NOT_COMPARABLE":
    case "UNMAPPED":
      return null; // one-sided by design is fine
  }
}

export const mappingFormSchema = z
  .object({
    mappingName: z.string().trim().min(1, "Give the mapping a name."),
    mappingType: z.enum(MAPPING_TYPES),
    a1QuestionIds: z.array(z.string().uuid()),
    a2QuestionIds: z.array(z.string().uuid()),
    commonConcept: z.string().trim().max(200).optional(),
    energySource: z.string().trim().max(100).optional(),
    criterion: z.string().trim().max(200).optional(),
    comparisonMethod: z.string().trim().max(200).optional(),
    professorNotes: z.string().trim().max(2000).optional(),
  })
  .superRefine((values, ctx) => {
    const error = sideCountError(
      values.mappingType,
      values.a1QuestionIds.length,
      values.a2QuestionIds.length
    );
    if (error) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mappingType"], message: error });
    }
  });

export type MappingFormValues = z.infer<typeof mappingFormSchema>;
