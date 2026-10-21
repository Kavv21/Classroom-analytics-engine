import { describe, expect, it } from "vitest";
import {
  checkManualRows,
  describeManualOutcome,
  emptyManualRow,
  isBlankManualRow,
  PENDING_ANOTHER_CLASS_MESSAGE,
  statusForOutcome,
  type ManualAddOutcome,
  type ManualStudentRowInput,
} from "@/lib/roster/manual";

function row(overrides: Partial<ManualStudentRowInput> = {}): ManualStudentRowInput {
  return {
    ...emptyManualRow(overrides.key ?? "k"),
    fullName: "Shlok Thakkar",
    email: "shlok.t@ahduni.edu.in",
    ...overrides,
  };
}

describe("checkManualRows", () => {
  it("accepts name + email alone; optional fields become null", () => {
    const [check] = checkManualRows([row({ email: "  Shlok.T@AHDUNI.edu.in " })], "ahduni.edu.in");
    expect(check).toEqual({
      ok: true,
      data: {
        fullName: "Shlok Thakkar",
        email: "shlok.t@ahduni.edu.in",
        rollNumber: null,
        programme: null,
        yearOfStudy: null,
        section: null,
      },
    });
  });

  it("names the field that is wrong", () => {
    const [noName, badEmail, noEmail] = checkManualRows(
      [row({ fullName: "  " }), row({ email: "not-an-email" }), row({ email: "" })],
      null
    );
    expect(noName).toEqual({ ok: false, fieldErrors: { fullName: "Name is required" } });
    expect(badEmail).toEqual({ ok: false, fieldErrors: { email: "Not a valid email address" } });
    expect(noEmail!.ok).toBe(false);
  });

  it("rejects an email outside the allowed domain", () => {
    const [check] = checkManualRows([row({ email: "someone@gmail.com" })], "ahduni.edu.in");
    expect(check).toEqual({ ok: false, fieldErrors: { email: "Email must end in @ahduni.edu.in" } });
  });

  it("one bad row does not affect the others", () => {
    const checks = checkManualRows(
      [row({ key: "a", email: "a@ahduni.edu.in" }), row({ key: "b", fullName: "" }), row({ key: "c", email: "c@ahduni.edu.in" })],
      "ahduni.edu.in"
    );
    expect(checks.map((c) => c.ok)).toEqual([true, false, true]);
  });

  it("flags the second occurrence of an email, pointing at the first row", () => {
    const checks = checkManualRows(
      [row({ key: "a" }), row({ key: "b", email: "x@ahduni.edu.in" }), row({ key: "c", email: "SHLOK.T@ahduni.edu.in" })],
      "ahduni.edu.in"
    );
    expect(checks[0]!.ok).toBe(true);
    expect(checks[1]!.ok).toBe(true);
    expect(checks[2]).toEqual({ ok: false, fieldErrors: { email: "Same email as row 1" } });
  });

  it("has no role field to validate — a role key is not part of the output", () => {
    const withRole = { ...row(), intendedRole: "ADMIN" } as ManualStudentRowInput;
    const [check] = checkManualRows([withRole], null);
    expect(check!.ok).toBe(true);
    expect(check!.ok && "intendedRole" in check!.data).toBe(false);
  });
});

describe("isBlankManualRow", () => {
  it("ignores whitespace and the key", () => {
    expect(isBlankManualRow({ ...emptyManualRow("k"), section: "  " })).toBe(true);
    expect(isBlankManualRow({ ...emptyManualRow("k"), section: "B" })).toBe(false);
  });
});

describe("describeManualOutcome", () => {
  it("tells the professor whether the student can sign in now", () => {
    expect(describeManualOutcome("PROVISIONED", "Shlok Thakkar").message).toBe(
      "Shlok Thakkar can sign in now."
    );
    expect(describeManualOutcome("ENROLLED", "Shlok Thakkar").message).toBe(
      "Shlok Thakkar can sign in now."
    );
    expect(describeManualOutcome("PENDING_SIGNUP", "Shlok Thakkar").message).toBe(
      "Shlok Thakkar added. They'll be set up at their first Google sign-in."
    );
  });

  it("does not name another professor's class", () => {
    expect(describeManualOutcome("PENDING_OTHER_CLASS", "X", { otherClassName: null }).message).toBe(
      "This student is pending enrollment in another class. Ask them to sign in with Google once, then add them here."
    );
    expect(PENDING_ANOTHER_CLASS_MESSAGE).toContain("pending enrollment in another class");
  });

  it("names the other class when the caller manages it", () => {
    expect(
      describeManualOutcome("PENDING_OTHER_CLASS", "X", { otherClassName: "Energy 101 — B" }).message
    ).toContain("“Energy 101 — B”");
  });

  it("maps server-side INVALID codes onto the field", () => {
    expect(describeManualOutcome("INVALID", "X", { errorCode: "DOMAIN_NOT_ALLOWED" }).fieldErrors).toHaveProperty(
      "email"
    );
    expect(describeManualOutcome("INVALID", "X", { errorCode: "NAME_REQUIRED" }).fieldErrors).toEqual({
      fullName: "Name is required",
    });
  });

  it("never puts backend vocabulary or raw codes in front of the professor", () => {
    const outcomes: ManualAddOutcome[] = [
      "ENROLLED", "PROVISIONED", "PENDING_SIGNUP", "ALREADY_ENROLLED",
      "PENDING_OTHER_CLASS", "NEEDS_ATTENTION", "INVALID", "ERROR",
    ];
    for (const outcome of outcomes) {
      for (const errorCode of [null, "23505", "DUPLICATE_AUTH_ACCOUNTS", "ROSTER_EMAIL_CONFLICT", "57014"]) {
        const { message } = describeManualOutcome(outcome, "Name", { errorCode });
        expect(message).not.toMatch(/database|server|postgres|sql|constraint|rpc|23505|57014|_/i);
      }
    }
  });
});

describe("statusForOutcome", () => {
  it("clears added and needs-attention rows; keeps the ones the professor can fix", () => {
    expect(statusForOutcome("ENROLLED")).toBe("added");
    expect(statusForOutcome("PROVISIONED")).toBe("added");
    expect(statusForOutcome("PENDING_SIGNUP")).toBe("added");
    expect(statusForOutcome("NEEDS_ATTENTION")).toBe("attention");
    expect(statusForOutcome("ALREADY_ENROLLED")).toBe("failed");
    expect(statusForOutcome("PENDING_OTHER_CLASS")).toBe("failed");
    expect(statusForOutcome("INVALID")).toBe("failed");
    expect(statusForOutcome("ERROR")).toBe("failed");
  });
});
