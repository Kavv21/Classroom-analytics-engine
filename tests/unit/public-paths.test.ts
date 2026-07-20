import { describe, it, expect } from "vitest";
import { isUnauthenticatedPath, isUnprovisionedPath } from "../../lib/auth/public-paths";

describe("isUnauthenticatedPath", () => {
  it("matches /login and /auth/callback exactly", () => {
    expect(isUnauthenticatedPath("/login")).toBe(true);
    expect(isUnauthenticatedPath("/auth/callback")).toBe(true);
  });

  it("matches sub-paths but not unrelated paths", () => {
    expect(isUnauthenticatedPath("/auth/callback/extra")).toBe(true);
    expect(isUnauthenticatedPath("/loginish")).toBe(false);
    expect(isUnauthenticatedPath("/")).toBe(false);
    expect(isUnauthenticatedPath("/not-provisioned")).toBe(false);
  });
});

describe("isUnprovisionedPath", () => {
  it("matches /not-provisioned only", () => {
    expect(isUnprovisionedPath("/not-provisioned")).toBe(true);
    expect(isUnprovisionedPath("/login")).toBe(false);
    expect(isUnprovisionedPath("/")).toBe(false);
  });
});
