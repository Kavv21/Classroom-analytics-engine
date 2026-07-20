import { describe, it, expect } from "vitest";
import { classFormSchema } from "../../lib/classes/schema";

describe("classFormSchema", () => {
  it("accepts a minimal valid class", () => {
    const result = classFormSchema.safeParse({ name: "Thermodynamics 101" });
    expect(result.success).toBe(true);
  });

  it("rejects a blank name", () => {
    const result = classFormSchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects end date before start date", () => {
    const result = classFormSchema.safeParse({
      name: "Thermodynamics 101",
      startDate: "2026-06-01",
      endDate: "2026-01-01",
    });
    expect(result.success).toBe(false);
  });

  it("accepts end date on or after start date", () => {
    const result = classFormSchema.safeParse({
      name: "Thermodynamics 101",
      startDate: "2026-01-01",
      endDate: "2026-06-01",
    });
    expect(result.success).toBe(true);
  });

  it("treats an empty end date as unset, not a validation failure", () => {
    const result = classFormSchema.safeParse({
      name: "Thermodynamics 101",
      startDate: "2026-06-01",
      endDate: "",
    });
    expect(result.success).toBe(true);
  });
});
