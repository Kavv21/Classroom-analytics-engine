import { describe, expect, it } from "vitest";
import {
  groupStudentResponses,
  responseValueLabel,
  type StudentResponseRow,
} from "@/lib/analytics/student-responses";

/**
 * The per-student raw view is the only surface that shows an individual
 * answer, so its two pure pieces are worth pinning down: how answers are
 * grouped and counted, and how a 0/1/blank is worded.
 */

const row = (
  code: string,
  energySource: string,
  value: 0 | 1 | null
): StudentResponseRow => ({
  questionId: `q-${code}`,
  code,
  questionText: `${energySource} wording for ${code}`,
  energySource,
  criterion: "A criterion",
  originalCell: "D6",
  value,
  recorded: value !== null,
});

describe("groupStudentResponses", () => {
  it("keeps the incoming question order and groups by energy source", () => {
    const groups = groupStudentResponses([
      row("A1-001", "Solar", 1),
      row("A1-002", "Solar", 0),
      row("A1-003", "Wind", 1),
    ]);
    expect(groups.map((g) => g.energySource)).toEqual(["Solar", "Wind"]);
    expect(groups[0]!.rows.map((r) => r.code)).toEqual(["A1-001", "A1-002"]);
  });

  it("counts 1s, 0s and blanks separately — a blank is never folded into either", () => {
    const groups = groupStudentResponses([
      row("A1-001", "Solar", 1),
      row("A1-002", "Solar", 0),
      row("A1-003", "Solar", null),
      row("A1-004", "Solar", 1),
    ]);
    expect(groups[0]).toMatchObject({ ones: 2, zeros: 1, blank: 1 });
    expect(groups[0]!.rows).toHaveLength(4);
  });

  it("re-joins a source that appears more than once rather than splitting it", () => {
    const groups = groupStudentResponses([
      row("A1-001", "Solar", 1),
      row("A1-002", "Wind", 0),
      row("A1-003", "Solar", 1),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ energySource: "Solar", ones: 2 });
  });

  it("never drops a question", () => {
    const rows = ["a", "b", "c", "d"].map((c, i) =>
      row(c, i % 2 === 0 ? "Solar" : "Wind", i === 3 ? null : ((i % 2) as 0 | 1))
    );
    const groups = groupStudentResponses(rows);
    expect(groups.reduce((n, g) => n + g.rows.length, 0)).toBe(rows.length);
  });
});

describe("responseValueLabel", () => {
  it("labels both options neutrally and names the blank case", () => {
    expect(responseValueLabel(0)).toBe("0 — No");
    expect(responseValueLabel(1)).toBe("1 — Yes");
    expect(responseValueLabel(null)).toBe("No answer");
  });

  it("uses no word implying one answer is better", () => {
    for (const value of [0, 1, null] as const) {
      expect(responseValueLabel(value)).not.toMatch(
        /correct|wrong|right|better|score|grade|pass|fail/i
      );
    }
  });
});
