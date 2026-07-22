import type { MappingType } from "@/lib/types/domain";

/**
 * Deterministic mapping-suggestion engine (Phase 6). Plain string/keyword
 * matching only — no LLM of any kind, ever (docs/EXCLUDED_FEATURES.md).
 * Suggestions are never auto-approved; every one lands as SUGGESTED or
 * NEEDS_PROFESSOR_REVIEW for explicit professor review.
 *
 * The validated matching for the real spreadsheets lives in
 * data/question-mapping-template.json (renewable-concept pairs across the
 * 11 common energy sources + NOT_COMPARABLE groups for the sources unique
 * to each assignment). suggestionsFromTemplate() replays that file against
 * the class's real question rows; suggestMappings() is the generic engine
 * for anything the template doesn't cover.
 */

export interface SuggestableQuestion {
  id: string;
  externalQuestionCode: string;
  questionText: string;
  energySource: string | null;
  criterion: string | null;
}

export interface MappingSuggestion {
  a1QuestionIds: string[];
  a2QuestionIds: string[];
  mappingName: string;
  commonConcept: string | null;
  energySource: string | null;
  criterion: string | null;
  mappingType: MappingType;
  comparisonMethod: string;
  professorNotes: string;
  mappingStatus: "SUGGESTED" | "NEEDS_PROFESSOR_REVIEW";
}

export interface SuggestConfig {
  /** Dice bigram similarity on normalised criterion text, 0..1. */
  similarityThreshold: number;
  /** Jaccard overlap on criterion keyword tokens, 0..1. */
  minKeywordOverlap: number;
}

/**
 * minKeywordOverlap of 1/3 is calibrated to the real data: "Renewable over
 * 25 years" vs "Is it renewable?" share {renewable} out of three distinct
 * keywords, while "Conventional" shares nothing with any A2 criterion.
 */
export const DEFAULT_SUGGEST_CONFIG: SuggestConfig = {
  similarityThreshold: 0.8,
  minKeywordOverlap: 1 / 3,
};

const STOPWORDS = new Set([
  "a", "an", "and", "are", "be", "can", "do", "does", "for", "in", "is",
  "it", "of", "or", "over", "the", "to", "with",
]);

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[‐-―−]/g, "-") // unicode dashes
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[-\s]+/g, " ")
    .trim();
}

export function keywordTokens(text: string): Set<string> {
  return new Set(
    normalizeText(text)
      .split(" ")
      .filter((t) => t.length > 0 && !STOPWORDS.has(t))
  );
}

export function keywordOverlap(a: string, b: string): number {
  const ta = keywordTokens(a);
  const tb = keywordTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / (ta.size + tb.size - shared);
}

export function sharedKeywords(a: string, b: string): string[] {
  const tb = keywordTokens(b);
  return [...keywordTokens(a)].filter((t) => tb.has(t)).sort();
}

/** Dice coefficient over character bigrams of the normalised strings. */
export function stringSimilarity(a: string, b: string): number {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2);
    bigrams.set(bg, (bigrams.get(bg) ?? 0) + 1);
  }
  let matches = 0;
  for (let i = 0; i < nb.length - 1; i++) {
    const bg = nb.slice(i, i + 2);
    const count = bigrams.get(bg) ?? 0;
    if (count > 0) {
      bigrams.set(bg, count - 1);
      matches++;
    }
  }
  return (2 * matches) / (na.length - 1 + (nb.length - 1));
}

function normalizedSource(q: SuggestableQuestion): string | null {
  if (!q.energySource) return null;
  const s = normalizeText(q.energySource);
  return s === "" ? null : s;
}

function bySource(questions: SuggestableQuestion[]): Map<string, SuggestableQuestion[]> {
  const map = new Map<string, SuggestableQuestion[]>();
  for (const q of questions) {
    const source = normalizedSource(q);
    if (!source) continue;
    const list = map.get(source) ?? [];
    list.push(q);
    map.set(source, list);
  }
  return map;
}

function titleCase(s: string): string {
  return s.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

function pairKey(a1Ids: string[], a2Ids: string[]): string {
  return `${[...a1Ids].sort().join(",")}|${[...a2Ids].sort().join(",")}`;
}

/** Signature of a suggestion's question sets — used for de-duplication. */
export function suggestionSignature(s: {
  a1QuestionIds: string[];
  a2QuestionIds: string[];
}): string {
  return pairKey(s.a1QuestionIds, s.a2QuestionIds);
}

/**
 * The generic deterministic engine, in priority order:
 *  1. exact normalised question-text matches (unambiguous 1:1 only);
 *  2. same energy source + criterion keyword overlap / string similarity;
 *  3. energy sources present on only one side → NOT_COMPARABLE groups.
 * Output order is deterministic (sorted by source / code).
 */
export function suggestMappings(
  a1Questions: SuggestableQuestion[],
  a2Questions: SuggestableQuestion[],
  config: SuggestConfig = DEFAULT_SUGGEST_CONFIG
): MappingSuggestion[] {
  const suggestions: MappingSuggestion[] = [];
  const usedPairs = new Set<string>();

  // 1. Exact normalised text matches — only when the text is unique on
  // both sides (an ambiguous match is a professor decision, not a guess).
  const a1ByText = new Map<string, SuggestableQuestion[]>();
  for (const q of a1Questions) {
    const key = normalizeText(q.questionText);
    a1ByText.set(key, [...(a1ByText.get(key) ?? []), q]);
  }
  const a2ByText = new Map<string, SuggestableQuestion[]>();
  for (const q of a2Questions) {
    const key = normalizeText(q.questionText);
    a2ByText.set(key, [...(a2ByText.get(key) ?? []), q]);
  }
  const exactKeys = [...a1ByText.keys()].filter((k) => a2ByText.has(k)).sort();
  for (const key of exactKeys) {
    const left = a1ByText.get(key)!;
    const right = a2ByText.get(key)!;
    if (left.length !== 1 || right.length !== 1) continue;
    const q1 = left[0]!;
    const q2 = right[0]!;
    usedPairs.add(pairKey([q1.id], [q2.id]));
    suggestions.push({
      a1QuestionIds: [q1.id],
      a2QuestionIds: [q2.id],
      mappingName: `Exact match — ${q1.questionText}`,
      commonConcept: null,
      energySource: q1.energySource,
      criterion: q1.criterion,
      mappingType: "EXACT_ONE_TO_ONE",
      comparisonMethod: "exact_normalised_text_match",
      professorNotes:
        "Auto-suggested: identical wording (after normalisation) in both assignments.",
      mappingStatus: "SUGGESTED",
    });
  }

  // 2. Same energy source, criterion keyword/similarity match.
  const a1BySource = bySource(a1Questions);
  const a2BySource = bySource(a2Questions);
  const commonSources = [...a1BySource.keys()].filter((s) => a2BySource.has(s)).sort();
  for (const source of commonSources) {
    for (const q1 of a1BySource.get(source)!) {
      if (!q1.criterion) continue;
      for (const q2 of a2BySource.get(source)!) {
        if (!q2.criterion) continue;
        if (usedPairs.has(pairKey([q1.id], [q2.id]))) continue;
        const overlap = keywordOverlap(q1.criterion, q2.criterion);
        const similarity = stringSimilarity(q1.criterion, q2.criterion);
        if (overlap < config.minKeywordOverlap && similarity < config.similarityThreshold) {
          continue;
        }
        const shared = sharedKeywords(q1.criterion, q2.criterion);
        const concept = shared.length > 0 ? shared.join(" ") : null;
        usedPairs.add(pairKey([q1.id], [q2.id]));
        suggestions.push({
          a1QuestionIds: [q1.id],
          a2QuestionIds: [q2.id],
          mappingName: `${concept ? titleCase(concept) : "Similar criterion"} — ${q1.energySource ?? titleCase(source)}`,
          commonConcept: concept,
          energySource: q1.energySource ?? titleCase(source),
          criterion: null,
          mappingType: "CONCEPTUAL_ONE_TO_ONE",
          comparisonMethod:
            overlap >= config.minKeywordOverlap
              ? `keyword_match:${shared.join(",")}`
              : `string_similarity:${similarity.toFixed(2)}`,
          professorNotes:
            `Auto-suggested: same energy source, related criteria ` +
            `("${q1.criterion}" vs "${q2.criterion}"). Confirm the concepts genuinely match before approving.`,
          mappingStatus: "SUGGESTED",
        });
      }
    }
  }

  // 3. Sources present on only one side → NOT_COMPARABLE groups.
  const a1Only = [...a1BySource.keys()].filter((s) => !a2BySource.has(s)).sort();
  for (const source of a1Only) {
    const group = a1BySource.get(source)!;
    suggestions.push({
      a1QuestionIds: group.map((q) => q.id),
      a2QuestionIds: [],
      mappingName: `No Assignment 2 counterpart — ${group[0]!.energySource ?? titleCase(source)}`,
      commonConcept: null,
      energySource: group[0]!.energySource ?? titleCase(source),
      criterion: null,
      mappingType: "NOT_COMPARABLE",
      comparisonMethod: "energy_source_match: no match found",
      professorNotes: `'${group[0]!.energySource ?? titleCase(source)}' appears in Assignment 1 but has no corresponding energy source in Assignment 2.`,
      mappingStatus: "SUGGESTED",
    });
  }
  const a2Only = [...a2BySource.keys()].filter((s) => !a1BySource.has(s)).sort();
  for (const source of a2Only) {
    const group = a2BySource.get(source)!;
    suggestions.push({
      a1QuestionIds: [],
      a2QuestionIds: group.map((q) => q.id),
      mappingName: `No Assignment 1 counterpart — ${group[0]!.energySource ?? titleCase(source)}`,
      commonConcept: null,
      energySource: group[0]!.energySource ?? titleCase(source),
      criterion: null,
      mappingType: "NOT_COMPARABLE",
      comparisonMethod: "energy_source_match: no match found",
      professorNotes: `'${group[0]!.energySource ?? titleCase(source)}' appears in Assignment 2 but has no corresponding energy source in Assignment 1.`,
      mappingStatus: "SUGGESTED",
    });
  }

  return suggestions;
}

// ============================================================
// Template seeding — data/question-mapping-template.json holds the exact
// matching already validated against the real spreadsheets. Codes that
// don't resolve against the imported questions fail loudly (CLAUDE.md:
// never silently skip or guess).
// ============================================================

export interface TemplateMapping {
  id: string;
  assignment_1_question_ids: string[];
  assignment_2_question_ids: string[];
  mapping_name: string;
  common_concept: string | null;
  energy_source: string | null;
  criterion: string | null;
  mapping_type: MappingType;
  comparison_method: string | null;
  professor_notes: string | null;
  mapping_status: string;
  professor_approved: boolean;
}

export interface MappingTemplate {
  mappings: TemplateMapping[];
}

export class TemplateResolutionError extends Error {
  constructor(public readonly missingCodes: string[]) {
    super(
      `question-mapping template references codes that do not exist in the imported questions: ` +
        missingCodes.join(", ")
    );
    this.name = "TemplateResolutionError";
  }
}

export function suggestionsFromTemplate(
  template: MappingTemplate,
  a1Questions: SuggestableQuestion[],
  a2Questions: SuggestableQuestion[]
): MappingSuggestion[] {
  const a1ByCode = new Map(a1Questions.map((q) => [q.externalQuestionCode, q]));
  const a2ByCode = new Map(a2Questions.map((q) => [q.externalQuestionCode, q]));

  const missing: string[] = [];
  const suggestions: MappingSuggestion[] = [];

  for (const entry of template.mappings) {
    if (entry.professor_approved) {
      // The template documents suggestions only; an approved entry would
      // bypass the explicit professor-approval workflow.
      throw new Error(
        `template entry ${entry.id} is marked professor_approved — templates may only carry suggestions`
      );
    }
    const a1Ids: string[] = [];
    const a2Ids: string[] = [];
    for (const code of entry.assignment_1_question_ids) {
      const q = a1ByCode.get(code);
      if (!q) missing.push(code);
      else a1Ids.push(q.id);
    }
    for (const code of entry.assignment_2_question_ids) {
      const q = a2ByCode.get(code);
      if (!q) missing.push(code);
      else a2Ids.push(q.id);
    }
    suggestions.push({
      a1QuestionIds: a1Ids,
      a2QuestionIds: a2Ids,
      mappingName: entry.mapping_name,
      commonConcept: entry.common_concept,
      energySource: entry.energy_source,
      criterion: entry.criterion,
      mappingType: entry.mapping_type,
      comparisonMethod: entry.comparison_method ?? "template",
      professorNotes: entry.professor_notes ?? "",
      mappingStatus:
        entry.mapping_status === "NEEDS_PROFESSOR_REVIEW"
          ? "NEEDS_PROFESSOR_REVIEW"
          : "SUGGESTED",
    });
  }

  if (missing.length > 0) {
    throw new TemplateResolutionError(missing);
  }
  return suggestions;
}
