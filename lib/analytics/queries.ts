import type { SupabaseClient } from "@supabase/supabase-js";
import { markExploratory, type Exploratory } from "@/lib/analytics/exploratory";

/**
 * The ONLY read paths for Phase 7 analytics. Every function hits a
 * PostgreSQL view from migration 0012 — aggregation happens in the
 * database, never by looping over raw response rows in app code
 * (.claude/rules/analytics.md). All are computed on read: results are
 * always current with the latest responses, no refresh step exists or is
 * needed (decision documented in docs/DATABASE_SCHEMA.md#phase-7).
 *
 * Every read here is scoped to a SINGLE assignment, or compares the two
 * assignments through their shared energy-source labels. There is no
 * per-student cross-assignment pairing: question mappings and the
 * transition engine built on them were removed in migration 0022, so the
 * paired views (response_transitions_live and its summaries) no longer
 * exist.
 *
 * Every fetcher surfaces Supabase errors explicitly — never a silent
 * empty result.
 */

export interface QuestionResponseSummary {
  class_id: string;
  assignment_id: string;
  question_id: string;
  external_question_code: string;
  /** Verbatim wording, added to the view in migration 0021 so analytics can
   *  name a question rather than printing its code. */
  question_text: string;
  energy_source: string | null;
  criterion: string | null;
  concept: string | null;
  answered: number;
  zeros: number;
  ones: number;
  pct_zero: number | null;
  pct_one: number | null;
  consensus: number | null;
  disagreement: number | null;
  entropy: number | null;
}

export interface AssignmentResponseSummary {
  class_id: string;
  assignment_id: string;
  question_count: number;
  answered_responses: number;
  respondents: number;
  avg_consensus: number | null;
  avg_disagreement: number | null;
  avg_entropy: number | null;
}

export interface GroupedResponseSummary {
  class_id: string;
  assignment_id: string;
  question_count: number;
  answered: number;
  zeros: number;
  ones: number;
  pct_zero: number | null;
  pct_one: number | null;
  consensus: number | null;
  disagreement: number | null;
  entropy: number | null;
}

export interface EnergySourceResponseSummary extends GroupedResponseSummary {
  energy_source: string;
}

export interface CriterionResponseSummary extends GroupedResponseSummary {
  criterion: string;
}

async function selectAll<T>(
  supabase: SupabaseClient,
  view: string,
  filters: Record<string, string>,
  orderBy: string
): Promise<T[]> {
  let query = supabase.from(view).select("*");
  for (const [column, value] of Object.entries(filters)) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.order(orderBy);
  if (error) {
    throw new Error(`could not read ${view}: ${error.message}`);
  }
  return (data ?? []) as T[];
}

export async function getQuestionResponseSummaries(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<QuestionResponseSummary[]> {
  return selectAll(
    supabase,
    "question_response_summary",
    { assignment_id: assignmentId },
    "external_question_code"
  );
}

export async function getAssignmentResponseSummaries(
  supabase: SupabaseClient,
  classId: string
): Promise<AssignmentResponseSummary[]> {
  return selectAll(supabase, "assignment_response_summary", { class_id: classId }, "assignment_id");
}

export async function getEnergySourceResponseSummaries(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<EnergySourceResponseSummary[]> {
  return selectAll(
    supabase,
    "energy_source_response_summary",
    { assignment_id: assignmentId },
    "energy_source"
  );
}

export async function getCriterionResponseSummaries(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<CriterionResponseSummary[]> {
  return selectAll(
    supabase,
    "criterion_response_summary",
    { assignment_id: assignmentId },
    "criterion"
  );
}

// ============================================================
// Per-energy-source A1 -> A2 change + synthetic-data census
// (migration 0017). Same contract as everything above: the aggregation
// lives in the view, this is only the read path.
// ============================================================

export interface EnergySourceAssignmentChange {
  class_id: string;
  /** btrim()'d join key — the raw per-side labels are carried separately. */
  energy_source: string;
  a1_energy_source_raw: string | null;
  a2_energy_source_raw: string | null;
  both_sides_present: boolean;
  a1_question_count: number | null;
  a2_question_count: number | null;
  a1_answered: number | null;
  a2_answered: number | null;
  a1_zeros: number | null;
  a2_zeros: number | null;
  a1_ones: number | null;
  a2_ones: number | null;
  a1_pct_one: number | null;
  a2_pct_one: number | null;
  /** NULL when either assignment has no questions for this source. */
  ones_absolute_change: number | null;
  /** NULL on a zero A1 baseline or a one-sided source — never 0, never Inf. */
  ones_relative_change: number | null;
  pct_point_shift: number | null;
}

export async function getEnergySourceAssignmentChange(
  supabase: SupabaseClient,
  classId: string
): Promise<EnergySourceAssignmentChange[]> {
  return selectAll(
    supabase,
    "energy_source_assignment_change",
    { class_id: classId },
    "energy_source"
  );
}

export interface ClassSyntheticCensus {
  class_id: string;
  student_count: number;
  synthetic_student_count: number;
  real_student_count: number;
}

export async function getClassSyntheticCensus(
  supabase: SupabaseClient,
  classId: string
): Promise<ClassSyntheticCensus | null> {
  const { data, error } = await supabase
    .from("class_synthetic_census")
    .select("*")
    .eq("class_id", classId)
    .maybeSingle();
  if (error) {
    throw new Error(`could not read class_synthetic_census: ${error.message}`);
  }
  return data as ClassSyntheticCensus | null;
}

// ============================================================
// Submission progress / timeline (charts 17.13, 17.14).
// ============================================================

export interface SubmissionProgressRow {
  assignment_id: string;
  class_id: string;
  enrolled_students: number;
  not_started_count: number;
  draft_count: number;
  submitted_count: number;
  reopened_count: number;
  resubmitted_count: number;
}

export interface SubmissionTimelineRow {
  class_id: string;
  assignment_id: string;
  submission_date: string;
  submissions: number;
  cumulative_submissions: number;
}

export async function getSubmissionProgress(
  supabase: SupabaseClient,
  classId: string
): Promise<SubmissionProgressRow[]> {
  return selectAll(supabase, "assignment_submission_progress", { class_id: classId }, "assignment_id");
}

export async function getSubmissionTimeline(
  supabase: SupabaseClient,
  classId: string
): Promise<SubmissionTimelineRow[]> {
  return selectAll(supabase, "submission_timeline", { class_id: classId }, "submission_date");
}

// ============================================================
// Section 18 exploratory fetchers. Rows come back wrapped in explicit
// exploratory metadata — Phase 8 must carry the caveat to the UI.
// ============================================================

export interface StudentPairSimilarity {
  class_id: string;
  assignment_id: string;
  student_a: string;
  student_b: string;
  shared_questions: number;
  both_one: number;
  both_zero: number;
  a_only_one: number;
  b_only_one: number;
  hamming_distance: number;
  agreement_rate: number;
  jaccard_similarity: number | null;
}

export interface QuestionPairAssociation {
  class_id: string;
  assignment_id: string;
  question_a: string;
  question_b: string;
  n: number;
  n00: number;
  n01: number;
  n10: number;
  n11: number;
  phi_coefficient: number | null;
  mutual_information_bits: number | null;
}

export async function getStudentPairSimilarities(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<Exploratory<StudentPairSimilarity[]>> {
  return markExploratory(
    await selectAll<StudentPairSimilarity>(
      supabase,
      "student_pair_similarity_exploratory",
      { assignment_id: assignmentId },
      "student_a"
    )
  );
}

export async function getQuestionPairAssociations(
  supabase: SupabaseClient,
  assignmentId: string
): Promise<Exploratory<QuestionPairAssociation[]>> {
  return markExploratory(
    await selectAll<QuestionPairAssociation>(
      supabase,
      "question_pair_association_exploratory",
      { assignment_id: assignmentId },
      "question_a"
    )
  );
}
