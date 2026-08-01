/**
 * Grouping questions by energy source for display.
 *
 * Assignments arrive in two orientations depending on how the source
 * spreadsheet was laid out:
 *   - source-major   (A1): Solar, Solar, Wind, Wind, …  — sources are rows
 *   - criterion-major (A2): Solar, Wind, Hydro, … then the next criterion
 *                           — sources are columns
 *
 * Grouping must therefore key off the source name itself, not off runs of
 * adjacent rows: a run-based grouping silently produces one group per row
 * for a criterion-major assignment.
 */

export interface GroupableQuestion {
  energy_source: string | null;
}

export interface QuestionGroup<T> {
  /** Stable, unique per group — safe to use as a React key. */
  key: string;
  /** null when the question carries no energy source. */
  label: string | null;
  rows: T[];
}

const UNGROUPED_KEY = "__ungrouped__";

/**
 * One group per distinct energy source, in first-appearance order. Rows keep
 * their incoming order within a group, so callers that pass display-ordered
 * questions get display-ordered rows.
 */
export function groupQuestionsBySource<T extends GroupableQuestion>(
  questions: readonly T[]
): QuestionGroup<T>[] {
  const groups: QuestionGroup<T>[] = [];
  const byKey = new Map<string, QuestionGroup<T>>();

  for (const question of questions) {
    const label = (question.energy_source ?? "").trim() || null;
    const key = label ?? UNGROUPED_KEY;
    let group = byKey.get(key);
    if (!group) {
      group = { key, label, rows: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rows.push(question);
  }

  return groups;
}
