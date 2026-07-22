import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The ONLY read surface downstream features (transition engine, analytics,
 * dashboards — Phases 7+) may use for mappings. Both views bake
 * professor_approved = true into the relation itself (migration 0011), so
 * an unapproved mapping is structurally invisible here no matter which
 * role queries. Reading question_mappings directly from any
 * analytics-facing code path is a rule violation, not a shortcut.
 */
export const APPROVED_MAPPINGS_VIEW = "approved_question_mappings";
export const APPROVED_MAPPING_MEMBERS_VIEW = "approved_question_mapping_members";

export interface ApprovedMappingRow {
  id: string;
  class_id: string;
  assignment_1_question_ids: string[];
  assignment_2_question_ids: string[];
  mapping_name: string;
  common_concept: string | null;
  energy_source: string | null;
  criterion: string | null;
  mapping_type: string;
  comparison_method: string | null;
  mapping_status: string;
  professor_approved: boolean;
  version: number;
  previous_version_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getApprovedMappings(
  supabase: SupabaseClient,
  classId: string
): Promise<ApprovedMappingRow[]> {
  const { data, error } = await supabase
    .from(APPROVED_MAPPINGS_VIEW)
    .select("*")
    .eq("class_id", classId)
    .order("mapping_name");
  if (error) {
    throw new Error(`could not load approved mappings: ${error.message}`);
  }
  return (data ?? []) as ApprovedMappingRow[];
}
