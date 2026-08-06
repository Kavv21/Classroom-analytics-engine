import { describe, it, expect } from "vitest";
import {
  classifyRosterRows,
  extractCandidateEmail,
  isImportableClassification,
  buildRejectionReportCsv,
  type ClassifyRosterRowsContext,
  type RosterEmailCheck,
} from "../../lib/roster/validate";
import type { RawRosterRow } from "../../lib/roster/parse";

const NO_CHECK: RosterEmailCheck = {
  hasProfile: false,
  profileId: null,
  alreadyClassMember: false,
  pendingThisClass: false,
  pendingOtherClass: false,
};

function context(overrides: Partial<ClassifyRosterRowsContext> = {}): ClassifyRosterRowsContext {
  return { emailChecks: new Map(), allowedEmailDomain: null, ...overrides };
}

/** A row carrying the three required fields — name, enrollment number, email.
 * Programme / year of study / section are deliberately absent: a file without
 * them must still import cleanly. */
function row(email: string, fullName = "Student Name", extra: Partial<RawRosterRow> = {}): RawRosterRow {
  return { email, fullName, rollNumber: "AU2340001", ...extra };
}

describe("classifyRosterRows", () => {
  it("classifies a well-formed, unseen row as NEW", () => {
    const results = classifyRosterRows([row("new.student@uni.edu")], context());
    expect(results).toHaveLength(1);
    expect(results[0]?.classification).toBe("NEW");
    expect(results[0]?.data?.email).toBe("new.student@uni.edu");
  });

  it("rejects a row with an invalid email", () => {
    const results = classifyRosterRows([row("not-an-email")], context());
    expect(results[0]?.classification).toBe("INVALID");
    expect(results[0]?.errors.length).toBeGreaterThan(0);
  });

  it("rejects a row missing a full name", () => {
    const results = classifyRosterRows([row("student@uni.edu", "")], context());
    expect(results[0]?.classification).toBe("INVALID");
  });

  it("rejects a row missing an enrollment number", () => {
    const results = classifyRosterRows(
      [row("student@uni.edu", "Student Name", { rollNumber: "" })],
      context()
    );
    expect(results[0]?.classification).toBe("INVALID");
    expect(results[0]?.errors).toContain("Enrollment number is required");
  });

  it("accepts a row carrying only name, enrollment number and email", () => {
    const results = classifyRosterRows(
      [{ fullName: "Student Name", rollNumber: "AU2340001", email: "student@uni.edu" }],
      context()
    );
    expect(results[0]?.classification).toBe("NEW");
    expect(results[0]?.data).toMatchObject({
      programme: null,
      yearOfStudy: null,
      section: null,
    });
  });

  it("keeps optional columns when the file happens to carry them", () => {
    const results = classifyRosterRows(
      [
        row("student@uni.edu", "Student Name", {
          programme: "B.Tech",
          yearOfStudy: "2",
          section: "A",
        }),
      ],
      context()
    );
    expect(results[0]?.classification).toBe("NEW");
    expect(results[0]?.data).toMatchObject({
      programme: "B.Tech",
      yearOfStudy: "2",
      section: "A",
    });
  });

  it("names the missing field rather than reporting a bare 'Required'", () => {
    const results = classifyRosterRows([{ email: "student@uni.edu" }], context());
    expect(results[0]?.errors).toEqual(["Name is required", "Enrollment number is required"]);
    expect(results[0]?.errors).not.toContain("Required");
  });

  it("names the missing column, not the cell, when the file lacks it entirely", () => {
    const results = classifyRosterRows(
      [{ fullName: "Student Name", email: "student@uni.edu" }],
      context({ presentFields: new Set(["fullName", "email"]) })
    );
    expect(results[0]?.classification).toBe("INVALID");
    expect(results[0]?.errors).toEqual([
      "Missing: Enrollment number column not found — expected one of: Enrollment Number, Roll Number, Student ID",
    ]);
  });

  it("rejects an email outside the allowed domain", () => {
    const results = classifyRosterRows(
      [row("student@other.edu")],
      context({ allowedEmailDomain: "uni.edu" })
    );
    expect(results[0]?.classification).toBe("INVALID");
    expect(results[0]?.errors[0]).toMatch(/domain/i);
  });

  it("flags the second occurrence of a duplicate email within the file", () => {
    const results = classifyRosterRows(
      [row("dup@uni.edu"), row("dup@uni.edu")],
      context()
    );
    expect(results[0]?.classification).toBe("NEW");
    expect(results[1]?.classification).toBe("DUPLICATE_IN_FILE");
  });

  it("treats case-different duplicate emails as the same student", () => {
    const results = classifyRosterRows(
      [row("Dup@Uni.edu"), row("dup@uni.edu")],
      context()
    );
    expect(results[1]?.classification).toBe("DUPLICATE_IN_FILE");
  });

  it("classifies an email already a member of this class as a duplicate", () => {
    const emailChecks = new Map([
      ["member@uni.edu", { ...NO_CHECK, hasProfile: true, alreadyClassMember: true }],
    ]);
    const results = classifyRosterRows([row("member@uni.edu")], context({ emailChecks }));
    expect(results[0]?.classification).toBe("DUPLICATE_ALREADY_IN_CLASS");
  });

  it("classifies an email pending for this same class as a duplicate", () => {
    const emailChecks = new Map([
      ["pending@uni.edu", { ...NO_CHECK, pendingThisClass: true }],
    ]);
    const results = classifyRosterRows([row("pending@uni.edu")], context({ emailChecks }));
    expect(results[0]?.classification).toBe("DUPLICATE_ALREADY_IN_CLASS");
  });

  it("classifies an already-provisioned email (elsewhere) as EXISTING_PROFILE", () => {
    const emailChecks = new Map([
      ["existing@uni.edu", { ...NO_CHECK, hasProfile: true, profileId: "profile-1" }],
    ]);
    const results = classifyRosterRows([row("existing@uni.edu")], context({ emailChecks }));
    expect(results[0]?.classification).toBe("EXISTING_PROFILE");
  });

  it("classifies an email pending for a different class as a blocked duplicate", () => {
    const emailChecks = new Map([
      ["other-class@uni.edu", { ...NO_CHECK, pendingOtherClass: true }],
    ]);
    const results = classifyRosterRows([row("other-class@uni.edu")], context({ emailChecks }));
    expect(results[0]?.classification).toBe("DUPLICATE_PENDING_OTHER_CLASS");
  });

  it("numbers rows starting at 2 (header is row 1)", () => {
    const results = classifyRosterRows([row("a@uni.edu"), row("b@uni.edu")], context());
    expect(results[0]?.rowNumber).toBe(2);
    expect(results[1]?.rowNumber).toBe(3);
  });
});

describe("isImportableClassification", () => {
  it("only NEW and EXISTING_PROFILE are importable", () => {
    expect(isImportableClassification("NEW")).toBe(true);
    expect(isImportableClassification("EXISTING_PROFILE")).toBe(true);
    expect(isImportableClassification("DUPLICATE_IN_FILE")).toBe(false);
    expect(isImportableClassification("DUPLICATE_ALREADY_IN_CLASS")).toBe(false);
    expect(isImportableClassification("DUPLICATE_PENDING_OTHER_CLASS")).toBe(false);
    expect(isImportableClassification("INVALID")).toBe(false);
  });
});

describe("extractCandidateEmail", () => {
  it("lowercases and trims", () => {
    expect(extractCandidateEmail({ email: "  Foo@Bar.com " })).toBe("foo@bar.com");
  });

  it("returns null when absent", () => {
    expect(extractCandidateEmail({})).toBeNull();
  });
});

describe("buildRejectionReportCsv", () => {
  it("includes a header row and one line per rejected row", () => {
    const results = classifyRosterRows(
      [row("not-an-email", "Bad Row")],
      context()
    );
    const csv = buildRejectionReportCsv(results);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("row_number,email,full_name,roll_number,classification,errors");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain("INVALID");
  });
});
