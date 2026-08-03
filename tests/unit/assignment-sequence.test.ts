/**
 * A class is not limited to two assignments.
 *
 * The compared PAIR is: sequence_number 1 and 2 are the pivot of the
 * aggregate before/after view and are one-per-class (migration 0018).
 * Everything else is an "other" assignment, and the professor can have as
 * many of those as they like — which is what these tests pin down, since
 * the UI previously offered only the two paired positions and so capped a
 * class at two assignments.
 */
import { describe, expect, it } from "vitest";
import {
  FIRST_OTHER_SEQUENCE_NUMBER,
  nextOtherSequenceNumber,
  PAIRED_SEQUENCE_NUMBERS,
  positionForSequenceNumber,
  positionLabel,
  sequenceNumberLabel,
} from "@/lib/assignments/sequence";

describe("positionForSequenceNumber", () => {
  it("maps only 1 and 2 to the paired positions", () => {
    expect(positionForSequenceNumber(1)).toBe("FIRST");
    expect(positionForSequenceNumber(2)).toBe("SECOND");
  });

  it("treats every other stored number as OTHER", () => {
    for (const n of [3, 4, 5, 12, 999]) {
      expect(positionForSequenceNumber(n)).toBe("OTHER");
    }
  });

  it("round-trips the paired positions through their numbers", () => {
    expect(positionForSequenceNumber(PAIRED_SEQUENCE_NUMBERS.FIRST)).toBe("FIRST");
    expect(positionForSequenceNumber(PAIRED_SEQUENCE_NUMBERS.SECOND)).toBe("SECOND");
  });
});

describe("nextOtherSequenceNumber", () => {
  it("never returns a paired number, even in an empty class", () => {
    expect(nextOtherSequenceNumber([])).toBe(FIRST_OTHER_SEQUENCE_NUMBER);
    expect(nextOtherSequenceNumber([])).toBeGreaterThan(PAIRED_SEQUENCE_NUMBERS.SECOND);
  });

  it("ignores the paired assignments already in the class", () => {
    expect(nextOtherSequenceNumber([1, 2])).toBe(3);
  });

  it("keeps allocating for an unlimited number of 'other' assignments", () => {
    const used = [1, 2];
    const allocated: number[] = [];
    for (let i = 0; i < 6; i++) {
      const next = nextOtherSequenceNumber(used);
      allocated.push(next);
      used.push(next);
    }
    expect(allocated).toEqual([3, 4, 5, 6, 7, 8]);
    // Every allocation is distinct — two "other" assignments must never
    // share a number, or their question codes (A3-001, …) stop identifying
    // a question within the class.
    expect(new Set(allocated).size).toBe(allocated.length);
  });

  it("fills a gap left by a deleted assignment rather than counting past it", () => {
    expect(nextOtherSequenceNumber([1, 2, 3, 5])).toBe(4);
  });

  it("does not care about order or duplicates in the used list", () => {
    expect(nextOtherSequenceNumber([5, 3, 1, 3, 2])).toBe(4);
  });
});

describe("labels", () => {
  it("names the positions the way the professor-facing errors do", () => {
    expect(positionLabel("FIRST")).toBe("first");
    expect(positionLabel("SECOND")).toBe("second");
    expect(positionLabel("OTHER")).toBe("other");
  });

  it("names a stored number, including the ones with no fixed position", () => {
    expect(sequenceNumberLabel(1)).toBe("first");
    expect(sequenceNumberLabel(2)).toBe("second");
    expect(sequenceNumberLabel(7)).toBe("other (#7)");
  });
});
