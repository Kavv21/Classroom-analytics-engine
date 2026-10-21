// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { adminClient, cleanupTestData, createTestUser, loadEnv, type TestUser } from "./helpers";

/**
 * LINK-TYPE ASSIGNMENTS — migration 0032.
 *
 * The first describe block is the one that matters most: a GRID
 * assignment, created exactly as every assignment was before 0032 (no
 * `kind` in the insert), must behave identically — default kind, approval
 * still needs questions, attempts/saves/submits work, progress counts it.
 *
 * Everything runs as really signed-in users through the client library,
 * so policies, triggers and RPCs are exercised as in production.
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let student: TestUser;
let classId: string;

const classIds: string[] = [];
const userIds: string[] = [];

const HOUR = 3_600_000;
const openWindow = () => ({
  open_at: new Date(Date.now() - HOUR).toISOString(),
  close_at: new Date(Date.now() + HOUR).toISOString(),
});

let sequence = 2;
async function insertAssignment(fields: Record<string, unknown>) {
  return professor.client
    .from("assignments")
    .insert({
      class_id: classId,
      title: `Link test ${randomUUID().slice(0, 6)}`,
      sequence_number: ++sequence,
      created_by: professor.id,
      ...fields,
    })
    .select("id, kind, link_url")
    .single();
}

async function createLink(url = "https://forms.gle/abc123"): Promise<string> {
  const { data, error } = await insertAssignment({ kind: "LINK", link_url: url });
  if (error) throw new Error(`link insert failed: ${error.message}`);
  return data!.id;
}

async function schedule(id: string) {
  const { error: readyError } = await professor.client
    .from("assignments")
    .update({ status: "READY" })
    .eq("id", id);
  if (readyError) throw new Error(`approve failed: ${readyError.message}`);
  const { error } = await professor.client.from("assignments").update(openWindow()).eq("id", id);
  if (error) throw new Error(`schedule failed: ${error.message}`);
}

beforeAll(async () => {
  professor = await createTestUser(env, admin, "PROFESSOR", "Link Test Professor");
  student = await createTestUser(env, admin, "STUDENT", "Link Test Student");
  userIds.push(professor.id, student.id);

  const { data, error } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Link Test Class",
      class_code: `LK${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`class insert failed: ${error.message}`);
  classId = data!.id;
  classIds.push(classId);

  const { error: memberError } = await admin
    .from("class_members")
    .insert({ class_id: classId, user_id: student.id, member_role: "STUDENT", status: "ACTIVE" });
  if (memberError) throw new Error(`membership failed: ${memberError.message}`);
}, 120_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

// ============================================================
describe("an existing-style GRID assignment is unaffected", () => {
  let gridId: string;
  let questionId: string;

  it("is created without naming a kind and comes out GRID with no link", async () => {
    const { data, error } = await professor.client
      .from("assignments")
      .insert({ class_id: classId, title: "Grid A1", sequence_number: 1, created_by: professor.id })
      .select("id, kind, link_url")
      .single();
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ kind: "GRID", link_url: null });
    gridId = data!.id;
  });

  it("still cannot be approved without questions", async () => {
    const { error } = await professor.client
      .from("assignments")
      .update({ status: "READY" })
      .eq("id", gridId);
    expect(error?.message).toMatch(/no active questions/);
  });

  it("takes questions, approves, schedules, and a student opens, saves and submits as before", async () => {
    const { data: qs, error: qError } = await professor.client
      .from("questions")
      .insert({
        assignment_id: gridId,
        external_question_code: "A1-001",
        question_text: "Grid question",
        response_zero_label: "No (0)",
        response_one_label: "Yes (1)",
        display_order: 1,
      })
      .select("id")
      .single();
    expect(qError, qError?.message).toBeNull();
    questionId = qs!.id;

    await schedule(gridId);

    const { data: attempt, error: openError } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: gridId,
    });
    expect(openError, openError?.message).toBeNull();
    const attemptId = (attempt as { id: string }).id;

    const { error: saveError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId, value: 1 }],
    });
    expect(saveError, saveError?.message).toBeNull();

    const { error: submitError } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(submitError, submitError?.message).toBeNull();
  }, 60_000);

  it("is counted in submission progress exactly as before", async () => {
    const { data, error } = await professor.client
      .from("assignment_submission_progress")
      .select("enrolled_students, submitted_count")
      .eq("assignment_id", gridId)
      .single();
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ enrolled_students: 1, submitted_count: 1 });
  });

  it("can't be turned into a link now that it has questions and an attempt", async () => {
    const { error } = await professor.client
      .from("assignments")
      .update({ kind: "LINK", link_url: "https://forms.gle/x" })
      .eq("id", gridId);
    expect(error?.message).toMatch(/can't become a link assignment|link_not_paired/);
  });

  it("can't be given a link while it is a grid", async () => {
    const { error } = await professor.client
      .from("assignments")
      .update({ link_url: "https://forms.gle/x" })
      .eq("id", gridId);
    expect(error?.message).toMatch(/assignments_kind_link_url/);
  });
});

// ============================================================
describe("a LINK assignment", () => {
  it("is approved without questions and scheduled like any other", async () => {
    const id = await createLink();
    await schedule(id);
    const { data } = await admin.from("assignments").select("status, kind").eq("id", id).single();
    expect(data).toMatchObject({ status: "READY", kind: "LINK" });
  }, 60_000);

  it("is visible to the student with its URL, inside the window", async () => {
    const id = await createLink("https://docs.google.com/forms/d/e/abc/viewform");
    await schedule(id);
    const { data, error } = await student.client
      .from("assignments")
      .select("id, kind, link_url")
      .eq("id", id)
      .single();
    expect(error, error?.message).toBeNull();
    expect(data).toMatchObject({ kind: "LINK", link_url: "https://docs.google.com/forms/d/e/abc/viewform" });
  }, 60_000);

  it("creates no attempt and no responses — the database refuses the attempt row", async () => {
    const id = await createLink();
    await schedule(id);

    const { error } = await student.client.rpc("get_or_create_attempt", { p_assignment_id: id });
    expect(error?.message).toMatch(/link assignment/);

    const [{ count: attempts }, { count: responses }] = await Promise.all([
      admin.from("assignment_attempts").select("id", { count: "exact", head: true }).eq("assignment_id", id),
      admin.from("responses").select("id", { count: "exact", head: true }).eq("assignment_id", id),
    ]);
    expect(attempts).toBe(0);
    expect(responses).toBe(0);
  }, 60_000);

  it("refuses questions", async () => {
    const id = await createLink();
    const { error } = await professor.client.from("questions").insert({
      assignment_id: id,
      external_question_code: "A3-001",
      question_text: "Should not exist",
      response_zero_label: "No (0)",
      response_one_label: "Yes (1)",
      display_order: 1,
    });
    expect(error?.message).toMatch(/link assignment/);
  });

  it("is left out of submission progress", async () => {
    const id = await createLink();
    await schedule(id);
    const { data } = await professor.client
      .from("assignment_submission_progress")
      .select("assignment_id")
      .eq("assignment_id", id);
    expect(data).toEqual([]);
  }, 60_000);

  it("is duplicated as a LINK with the same URL", async () => {
    const id = await createLink("https://forms.gle/duplicate-me");
    const { data: newId, error } = await professor.client.rpc("duplicate_assignment", {
      p_assignment_id: id,
    });
    expect(error, error?.message).toBeNull();
    const { data } = await admin
      .from("assignments")
      .select("kind, link_url, status")
      .eq("id", newId as string)
      .single();
    expect(data).toMatchObject({ kind: "LINK", link_url: "https://forms.gle/duplicate-me", status: "DRAFT" });
  });
});

// ============================================================
describe("constraints", () => {
  it("rejects a non-https link", async () => {
    const { error } = await insertAssignment({ kind: "LINK", link_url: "http://forms.gle/x" });
    expect(error?.message).toMatch(/assignments_link_url_https/);
  });

  it("rejects a LINK without a URL", async () => {
    const { error } = await insertAssignment({ kind: "LINK" });
    expect(error?.message).toMatch(/assignments_kind_link_url/);
  });

  it("rejects a GRID with a URL", async () => {
    const { error } = await insertAssignment({ kind: "GRID", link_url: "https://forms.gle/x" });
    expect(error?.message).toMatch(/assignments_kind_link_url/);
  });

  it("rejects a LINK in the first or second position", async () => {
    const { error } = await professor.client.from("assignments").insert({
      class_id: classId,
      title: "Link as A2",
      sequence_number: 2,
      created_by: professor.id,
      kind: "LINK",
      link_url: "https://forms.gle/x",
    });
    expect(error?.message).toMatch(/assignments_link_not_paired/);
  });

  it("rejects an unknown kind", async () => {
    const { error } = await insertAssignment({ kind: "QUIZ" });
    expect(error?.message).toMatch(/assignments_kind_valid/);
  });
});
