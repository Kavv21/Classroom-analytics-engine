import { describe, expect, it } from "vitest";
import { groupQuestionsBySource } from "@/lib/questions/group-by-source";
import assignment1 from "@/data/assignment-1-manifest.json";
import assignment2 from "@/data/assignment-2-manifest.json";

/**
 * The rule these tests pin: grouping produces exactly one section per
 * distinct energy source, whatever orientation the source spreadsheet used.
 *
 * A1 is source-major (Solar, Solar, Wind, Wind, …) and A2 is criterion-major
 * (all 15 sources, then the next criterion). A run-based grouping passes on
 * A1 and silently emits one group per row — with repeating keys — on A2.
 */

interface ManifestQuestion {
  display_order: number;
  energy_source: string | null;
}

function manifestQuestions(manifest: unknown): ManifestQuestion[] {
  const questions = (manifest as { questions: ManifestQuestion[] }).questions;
  return [...questions].sort((a, b) => a.display_order - b.display_order);
}

describe("groupQuestionsBySource", () => {
  it("keeps first-appearance order and trims the source name", () => {
    const groups = groupQuestionsBySource([
      { energy_source: "Solar " },
      { energy_source: "Wind" },
      { energy_source: "Solar" },
    ]);

    expect(groups.map((g) => g.label)).toEqual(["Solar", "Wind"]);
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it("collects blank and missing sources into a single ungrouped section", () => {
    const groups = groupQuestionsBySource([
      { energy_source: null },
      { energy_source: "   " },
      { energy_source: "Solar" },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.label).toBeNull();
    expect(groups[0]?.rows).toHaveLength(2);
  });

  it("groups a source-major assignment into one section per source", () => {
    const questions = manifestQuestions(assignment1);
    const groups = groupQuestionsBySource(questions);

    expect(questions).toHaveLength(30);
    expect(groups).toHaveLength(15);
    expect(groups.every((g) => g.rows.length === 2)).toBe(true);
  });

  it("groups a criterion-major assignment into one section per source", () => {
    const questions = manifestQuestions(assignment2);
    const groups = groupQuestionsBySource(questions);

    expect(questions).toHaveLength(255);
    expect(groups).toHaveLength(15);
    expect(groups.every((g) => g.rows.length === 17)).toBe(true);
  });

  it("emits unique keys for both orientations (React key safety)", () => {
    for (const manifest of [assignment1, assignment2]) {
      const groups = groupQuestionsBySource(manifestQuestions(manifest));
      const keys = groups.map((g) => g.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("preserves every question exactly once", () => {
    const questions = manifestQuestions(assignment2);
    const flattened = groupQuestionsBySource(questions).flatMap((g) => g.rows);

    expect(flattened).toHaveLength(questions.length);
    expect(new Set(flattened).size).toBe(questions.length);
  });
});
