import { describe, expect, it } from "vitest";
import { describeProvisioningFailure } from "@/lib/roster/provisioning-failure";

describe("describeProvisioningFailure", () => {
  it("names the duplicate-account case", () => {
    expect(describeProvisioningFailure("DUPLICATE_AUTH_ACCOUNTS")).toMatch(/more than one sign-in account/i);
  });

  it("names the email clash case", () => {
    expect(describeProvisioningFailure("23505")).toMatch(/clashes with an existing account/i);
  });

  it("falls back to a plain sentence for anything else, never the raw code", () => {
    const reason = describeProvisioningFailure("XX000");
    expect(reason).toMatch(/couldn't be set up automatically/i);
    expect(reason).not.toContain("XX000");
  });
});
