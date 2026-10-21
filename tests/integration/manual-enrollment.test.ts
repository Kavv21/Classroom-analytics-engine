// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  retryTransient,
  type TestUser,
} from "./helpers";

/**
 * ADDING STUDENTS BY HAND — add_students_to_class (migration 0031).
 *
 * Driven through the client library as really signed-in users, so grants,
 * the can_manage_class_content gate, the 0030 roster trigger and the
 * advisory lock all run exactly as in production. Every row's outcome is
 * read from the RPC AND checked against the rows it should have written.
 *
 * Emails that must be provisionable use app_config.allowed_email_domain —
 * that gate is applied before anything else, and is tested on its own.
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let otherProfessor: TestUser;
let student: TestUser;
let classA: string;
let classB: string;
let otherClass: string;
let domain: string;

const classIds: string[] = [];
const userIds: string[] = [];
const rosterEmails: string[] = [];

type RowResult = {
  key: string;
  email: string;
  outcome: string;
  otherClassName?: string | null;
  errorCode?: string | null;
};

function freshEmail(label: string): string {
  const email = `it-manual-${label}-${randomUUID().slice(0, 8)}@${domain}`;
  rosterEmails.push(email);
  return email;
}

async function createClass(owner: TestUser, name: string): Promise<string> {
  const { data, error } = await owner.client
    .from("classes")
    .insert({ name, professor_id: owner.id, class_code: `MN${randomUUID().slice(0, 6).toUpperCase()}` })
    .select("id")
    .single();
  if (error) throw new Error(`class insert failed: ${error.message}`);
  classIds.push(data!.id);
  return data!.id;
}

async function add(
  caller: TestUser,
  classId: string,
  rows: Array<Record<string, unknown>>
): Promise<RowResult[]> {
  const { data, error } = await caller.client.rpc("add_students_to_class", {
    p_class_id: classId,
    p_rows: rows,
  });
  expect(error, error?.message).toBeNull();
  return data as RowResult[];
}

/** An auth.users row with no profile — someone who signed in with Google
 * before anyone rostered them (handle_new_user found nothing to do). */
async function createBareAuthUser(email: string): Promise<string> {
  const { data, error } = await retryTransient(() =>
    admin.auth.admin.createUser({ email, password: `It-${randomUUID()}`, email_confirm: true })
  );
  if (error) throw new Error(`auth user create failed: ${error.message}`);
  const id = data.user!.id;
  userIds.push(id);
  // Belt and braces: if anything provisioned them, undo it — this test is
  // about the person who was NOT provisioned at sign-in.
  await admin.from("class_members").delete().eq("user_id", id);
  await admin.from("profiles").delete().eq("id", id);
  return id;
}

beforeAll(async () => {
  const { data: domainRow } = await admin
    .from("app_config")
    .select("value")
    .eq("key", "allowed_email_domain")
    .maybeSingle();
  domain = (domainRow?.value as string | undefined) ?? "integration-test.invalid";

  professor = await createTestUser(env, admin, "PROFESSOR", "IT Manual Professor");
  otherProfessor = await createTestUser(env, admin, "PROFESSOR", "IT Manual Other Professor");
  student = await createTestUser(env, admin, "STUDENT", "IT Manual Student");
  userIds.push(professor.id, otherProfessor.id, student.id);

  classA = await createClass(professor, "IT Manual Class A");
  classB = await createClass(professor, "IT Manual Class B");
  otherClass = await createClass(otherProfessor, "IT Manual Someone Else's Class");
}, 120_000);

afterAll(async () => {
  if (rosterEmails.length > 0) {
    await admin.from("roster_entries").delete().in("email", rosterEmails);
  }
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("add_students_to_class", () => {
  it("someone who has never signed in: roster entry, PENDING_SIGNUP, role STUDENT", async () => {
    const email = freshEmail("pending");
    const [result] = await add(professor, classA, [
      { key: "r1", email: `  ${email.toUpperCase()} `, fullName: "Pending Person", rollNumber: "AU1", section: "B" },
    ]);
    expect(result).toMatchObject({ key: "r1", email, outcome: "PENDING_SIGNUP" });

    const { data: entry } = await admin
      .from("roster_entries")
      .select("class_id, intended_role, provisioned, full_name, roll_number, section, created_by")
      .eq("email", email)
      .single();
    expect(entry).toMatchObject({
      class_id: classA,
      intended_role: "STUDENT",
      provisioned: false,
      full_name: "Pending Person",
      roll_number: "AU1",
      section: "B",
      created_by: professor.id,
    });
  }, 60_000);

  it("someone who signed in before being rostered: provisioned on the spot", async () => {
    const email = freshEmail("existing-auth");
    const userId = await createBareAuthUser(email);

    const [result] = await add(professor, classA, [
      { key: "r1", email, fullName: "Shlok Thakkar", rollNumber: "AU2", programme: "BTech" },
    ]);
    expect(result!.outcome).toBe("PROVISIONED");

    const { data: profile } = await admin
      .from("profiles")
      .select("email, full_name, role, roll_number, programme, is_active")
      .eq("id", userId)
      .single();
    expect(profile).toMatchObject({
      email,
      full_name: "Shlok Thakkar",
      role: "STUDENT",
      roll_number: "AU2",
      programme: "BTech",
      is_active: true,
    });

    const { data: member } = await admin
      .from("class_members")
      .select("member_role, status")
      .eq("class_id", classA)
      .eq("user_id", userId)
      .single();
    expect(member).toMatchObject({ member_role: "STUDENT", status: "ACTIVE" });
  }, 60_000);

  it("someone who already has a profile: added to the class, profile untouched", async () => {
    const [result] = await add(professor, classA, [
      { key: "r1", email: student.email, fullName: "A Different Name" },
    ]);
    expect(result!.outcome).toBe("ENROLLED");

    const { data: member } = await admin
      .from("class_members")
      .select("member_role")
      .eq("class_id", classA)
      .eq("user_id", student.id)
      .single();
    expect(member!.member_role).toBe("STUDENT");

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", student.id)
      .single();
    expect(profile!.full_name, "first write wins — known issue, see DATABASE_SCHEMA.md").toBe(
      "IT Manual Student"
    );
  }, 60_000);

  it("the role is always STUDENT, whatever the row says", async () => {
    const email = freshEmail("role");
    const [result] = await add(professor, classA, [
      { key: "r1", email, fullName: "Role Smuggler", intendedRole: "ADMIN", role: "PROFESSOR", intended_role: "TA" },
    ]);
    expect(result!.outcome).toBe("PENDING_SIGNUP");

    const { data: entry } = await admin
      .from("roster_entries")
      .select("intended_role")
      .eq("email", email)
      .single();
    expect(entry!.intended_role).toBe("STUDENT");
  }, 60_000);

  it("an email outside the allowed domain is refused and nothing is written", async () => {
    const email = `it-manual-wrongdomain-${randomUUID().slice(0, 8)}@not-${domain}`;
    rosterEmails.push(email);
    const [result] = await add(professor, classA, [{ key: "r1", email, fullName: "Wrong Domain" }]);
    expect(result).toMatchObject({ outcome: "INVALID", errorCode: "DOMAIN_NOT_ALLOWED" });

    const { count } = await admin
      .from("roster_entries")
      .select("id", { count: "exact", head: true })
      .eq("email", email);
    expect(count).toBe(0);
  }, 60_000);

  it("a duplicate is refused: already a member, and already pending in this class", async () => {
    const pendingEmail = freshEmail("dup-pending");
    await add(professor, classA, [{ key: "first", email: pendingEmail, fullName: "Dup Pending" }]);

    const results = await add(professor, classA, [
      { key: "member", email: student.email, fullName: "Already Member" },
      { key: "pending", email: pendingEmail, fullName: "Dup Pending" },
    ]);
    expect(results.map((r) => [r.key, r.outcome])).toEqual([
      ["member", "ALREADY_ENROLLED"],
      ["pending", "ALREADY_ENROLLED"],
    ]);

    const { count } = await admin
      .from("roster_entries")
      .select("id", { count: "exact", head: true })
      .eq("email", pendingEmail);
    expect(count).toBe(1);
  }, 60_000);

  it("pending in another class: named only when the caller manages that class", async () => {
    const mine = freshEmail("pending-mine");
    const theirs = freshEmail("pending-theirs");
    await add(professor, classB, [{ key: "x", email: mine, fullName: "Mine Elsewhere" }]);
    await add(otherProfessor, otherClass, [{ key: "x", email: theirs, fullName: "Theirs" }]);

    const results = await add(professor, classA, [
      { key: "mine", email: mine, fullName: "Mine Elsewhere" },
      { key: "theirs", email: theirs, fullName: "Theirs" },
    ]);
    expect(results[0]).toMatchObject({ outcome: "PENDING_OTHER_CLASS", otherClassName: "IT Manual Class B" });
    expect(results[1]).toMatchObject({ outcome: "PENDING_OTHER_CLASS", otherClassName: null });

    // Same rule on the import's check.
    const { data: checked, error } = await professor.client.rpc("check_roster_emails", {
      p_class_id: classA,
      p_emails: [mine, theirs],
    });
    expect(error, error?.message).toBeNull();
    const byEmail = new Map((checked as Array<{ email: string; pending_other_class_name: string | null }>).map((r) => [r.email, r]));
    expect(byEmail.get(mine)!.pending_other_class_name).toBe("IT Manual Class B");
    expect(byEmail.get(theirs)!.pending_other_class_name).toBeNull();
  }, 60_000);

  it("one bad row does not block the others", async () => {
    const good1 = freshEmail("batch-1");
    const good2 = freshEmail("batch-2");
    const results = await add(professor, classA, [
      { key: "a", email: good1, fullName: "Batch One" },
      { key: "b", email: "not-an-email", fullName: "Broken" },
      { key: "c", email: freshEmail("batch-noname"), fullName: "   " },
      { key: "d", email: good2, fullName: "Batch Two" },
    ]);
    expect(results.map((r) => [r.key, r.outcome])).toEqual([
      ["a", "PENDING_SIGNUP"],
      ["b", "INVALID"],
      ["c", "INVALID"],
      ["d", "PENDING_SIGNUP"],
    ]);
    const { count } = await admin
      .from("roster_entries")
      .select("id", { count: "exact", head: true })
      .in("email", [good1, good2]);
    expect(count).toBe(2);
  }, 60_000);

  it("refuses anyone who cannot manage the class — another professor, a student", async () => {
    for (const caller of [otherProfessor, student]) {
      const email = freshEmail("refused");
      const { error } = await caller.client.rpc("add_students_to_class", {
        p_class_id: classA,
        p_rows: [{ key: "r1", email, fullName: "Should Not Exist" }],
      });
      expect(error?.message).toMatch(/not authorized/);

      const { count } = await admin
        .from("roster_entries")
        .select("id", { count: "exact", head: true })
        .eq("email", email);
      expect(count).toBe(0);
    }
  }, 60_000);
});
