import { describe, it, expect } from "vitest";
import {
  changeRate,
  stabilityRate,
  netMovementToward1,
  simpleConsensus,
  simpleDisagreement,
  binaryEntropy,
} from "../../lib/types/domain";

// Worked example from spec Section 12: S01 = 30%, S10 = 27% -> change rate
// 57%, net shift +3 percentage points. Using a valid-paired-responses base
// of 100 for readability.
describe("transition metrics (Section 12 worked example)", () => {
  it("computes change rate as 57%", () => {
    expect(changeRate(30, 27, 100)).toBeCloseTo(0.57, 5);
  });

  it("computes net movement toward 1 as +3", () => {
    expect(netMovementToward1(30, 27)).toBe(3);
  });

  it("stability rate + change rate sum to 1 when all responses are valid pairs", () => {
    const s00 = 20;
    const s01 = 30;
    const s10 = 27;
    const s11 = 23;
    const total = s00 + s01 + s10 + s11;
    expect(changeRate(s01, s10, total) + stabilityRate(s00, s11, total)).toBeCloseTo(1, 5);
  });
});

describe("consensus / disagreement / entropy", () => {
  it("50/50 produces maximum disagreement and entropy", () => {
    expect(simpleConsensus(0.5, 0.5)).toBe(0.5);
    expect(simpleDisagreement(0.5)).toBe(0.5);
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 5);
  });

  it("100/0 produces minimum disagreement and zero entropy", () => {
    expect(simpleConsensus(1, 0)).toBe(1);
    expect(simpleDisagreement(1)).toBe(0);
    expect(binaryEntropy(1)).toBe(0);
    expect(binaryEntropy(0)).toBe(0);
  });
});
