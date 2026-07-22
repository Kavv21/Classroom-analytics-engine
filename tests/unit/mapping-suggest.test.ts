import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SUGGEST_CONFIG,
  keywordOverlap,
  normalizeText,
  stringSimilarity,
  suggestionSignature,
  suggestionsFromTemplate,
  suggestMappings,
  TemplateResolutionError,
  type MappingTemplate,
  type SuggestableQuestion,
} from "@/lib/mappings/suggest";

function q(
  id: string,
  code: string,
  text: string,
  energySource: string | null,
  criterion: string | null
): SuggestableQuestion {
  return { id, externalQuestionCode: code, questionText: text, energySource, criterion };
}

describe("text normalisation and matching primitives", () => {
  it("normalises case, punctuation, and whitespace", () => {
    expect(normalizeText("  Is it RENEWABLE?  ")).toBe("is it renewable");
    expect(normalizeText("Solar — Conventional")).toBe("solar conventional");
  });

  it("keyword overlap ignores stopwords and is symmetric", () => {
    const a = "Renewable over 25 years";
    const b = "Is it renewable?";
    // shared {renewable} out of {renewable, 25, years}
    expect(keywordOverlap(a, b)).toBeCloseTo(1 / 3);
    expect(keywordOverlap(b, a)).toBeCloseTo(1 / 3);
    expect(keywordOverlap("Conventional", "Is it renewable?")).toBe(0);
  });

  it("string similarity is 1 for identical normalised text, 0 for disjoint", () => {
    expect(stringSimilarity("Solar!", "solar")).toBe(1);
    expect(stringSimilarity("wind", "coal")).toBe(0);
  });
});

describe("deterministic suggestion engine", () => {
  const a1 = [
    q("a1-solar-renew", "A1-002", "Solar — Renewable over 25 years", "Solar", "Renewable over 25 years"),
    q("a1-solar-conv", "A1-001", "Solar — Conventional", "Solar", "Conventional"),
    q("a1-fusion", "A1-023", "Fusion — Conventional", "Fusion", "Conventional"),
    q("a1-identical", "A1-099", "Coal — Same wording", "Coal", "Same wording"),
  ];
  const a2 = [
    q("a2-solar-renew", "A2-016", "Solar — Is it renewable?", "Solar", "Is it renewable?"),
    q("a2-solar-avail", "A2-001", "Solar — Is it available all the time?", "Solar", "Is it available all the time?"),
    q("a2-tidal", "A2-007", "Tidal — Is it renewable?", "Tidal", "Is it renewable?"),
    q("a2-identical", "A2-099", "Coal — Same wording", "Coal", "Same wording"),
  ];

  it("finds exact normalised text matches as EXACT_ONE_TO_ONE", () => {
    const suggestions = suggestMappings(a1, a2);
    const exact = suggestions.filter((s) => s.mappingType === "EXACT_ONE_TO_ONE");
    expect(exact).toHaveLength(1);
    expect(exact[0]!.a1QuestionIds).toEqual(["a1-identical"]);
    expect(exact[0]!.a2QuestionIds).toEqual(["a2-identical"]);
    expect(exact[0]!.comparisonMethod).toBe("exact_normalised_text_match");
  });

  it("matches renewable criteria across the same energy source, not Conventional", () => {
    const suggestions = suggestMappings(a1, a2);
    const conceptual = suggestions.filter((s) => s.mappingType === "CONCEPTUAL_ONE_TO_ONE");
    expect(conceptual).toHaveLength(1);
    expect(conceptual[0]!.a1QuestionIds).toEqual(["a1-solar-renew"]);
    expect(conceptual[0]!.a2QuestionIds).toEqual(["a2-solar-renew"]);
    expect(conceptual[0]!.commonConcept).toBe("renewable");
    expect(conceptual[0]!.comparisonMethod).toContain("keyword_match");
    // "Conventional" must never be paired with an unrelated A2 criterion.
    expect(
      suggestions.some((s) => s.a1QuestionIds.includes("a1-solar-conv") && s.a2QuestionIds.length > 0)
    ).toBe(false);
  });

  it("groups one-side-only energy sources as NOT_COMPARABLE", () => {
    const suggestions = suggestMappings(a1, a2);
    const notComparable = suggestions.filter((s) => s.mappingType === "NOT_COMPARABLE");
    expect(notComparable).toHaveLength(2);
    const fusion = notComparable.find((s) => s.energySource === "Fusion")!;
    expect(fusion.a1QuestionIds).toEqual(["a1-fusion"]);
    expect(fusion.a2QuestionIds).toEqual([]);
    const tidal = notComparable.find((s) => s.energySource === "Tidal")!;
    expect(tidal.a1QuestionIds).toEqual([]);
    expect(tidal.a2QuestionIds).toEqual(["a2-tidal"]);
  });

  it("similarity threshold is configurable and changes the result", () => {
    const strict = suggestMappings(a1, a2, {
      similarityThreshold: 1,
      minKeywordOverlap: 0.99,
    });
    expect(strict.filter((s) => s.mappingType === "CONCEPTUAL_ONE_TO_ONE")).toHaveLength(0);

    const loose = suggestMappings(a1, a2, {
      similarityThreshold: 0.01,
      minKeywordOverlap: 0.01,
    });
    expect(
      loose.filter((s) => s.mappingType === "CONCEPTUAL_ONE_TO_ONE").length
    ).toBeGreaterThan(1);
  });

  it("is deterministic — same input, same output", () => {
    expect(suggestMappings(a1, a2)).toEqual(suggestMappings(a1, a2));
  });
});

describe("template seeding against the real manifests", () => {
  const template = JSON.parse(
    readFileSync(resolve("data/question-mapping-template.json"), "utf-8")
  ) as MappingTemplate;

  interface ManifestQuestion {
    id: string;
    question_text: string;
    energy_source: string | null;
    criterion: string | null;
  }

  function manifestQuestions(path: string): SuggestableQuestion[] {
    const manifest = JSON.parse(readFileSync(resolve(path), "utf-8")) as {
      questions: ManifestQuestion[];
    };
    return manifest.questions.map((mq) => ({
      // Simulate DB rows: uuid-ish id distinct from the external code.
      id: `db-${mq.id}`,
      externalQuestionCode: mq.id,
      questionText: mq.question_text,
      energySource: mq.energy_source,
      criterion: mq.criterion,
    }));
  }

  const a1 = manifestQuestions("data/assignment-1-manifest.json");
  const a2 = manifestQuestions("data/assignment-2-manifest.json");

  it("resolves every template entry against the real question codes", () => {
    const suggestions = suggestionsFromTemplate(template, a1, a2);
    expect(suggestions).toHaveLength(template.mappings.length);
    // The 11 renewable-concept matches across the common energy sources.
    const renewable = suggestions.filter(
      (s) => s.commonConcept === "renewable" && s.mappingType === "CONCEPTUAL_ONE_TO_ONE"
    );
    expect(renewable).toHaveLength(11);
    // The NOT_COMPARABLE groups for the 4 sources unique to each side.
    const notComparable = suggestions.filter((s) => s.mappingType === "NOT_COMPARABLE");
    expect(notComparable).toHaveLength(8);
    // Every suggestion arrives unapproved, awaiting professor review.
    expect(
      suggestions.every(
        (s) => s.mappingStatus === "SUGGESTED" || s.mappingStatus === "NEEDS_PROFESSOR_REVIEW"
      )
    ).toBe(true);
  });

  it("the generic engine independently re-derives the template's renewable pairs", () => {
    const engine = suggestMappings(a1, a2, DEFAULT_SUGGEST_CONFIG);
    const engineSignatures = new Set(engine.map(suggestionSignature));
    const fromTemplate = suggestionsFromTemplate(template, a1, a2);
    for (const t of fromTemplate.filter((s) => s.commonConcept === "renewable")) {
      expect(engineSignatures.has(suggestionSignature(t))).toBe(true);
    }
  });

  it("fails loudly when a template code has no matching question", () => {
    const broken: MappingTemplate = {
      mappings: [
        {
          ...template.mappings[0]!,
          assignment_1_question_ids: ["A1-DOES-NOT-EXIST"],
        },
      ],
    };
    expect(() => suggestionsFromTemplate(broken, a1, a2)).toThrowError(TemplateResolutionError);
    expect(() => suggestionsFromTemplate(broken, a1, a2)).toThrowError(/A1-DOES-NOT-EXIST/);
  });

  it("refuses a template entry that claims to be pre-approved", () => {
    const sneaky: MappingTemplate = {
      mappings: [{ ...template.mappings[0]!, professor_approved: true }],
    };
    expect(() => suggestionsFromTemplate(sneaky, a1, a2)).toThrowError(/professor_approved/);
  });
});
