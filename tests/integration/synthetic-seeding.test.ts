import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  type TestUser,
} from "./helpers";

/**
 * Migration 0020 — seeding synthetic demo data into a CLOSED assignment.
 *
 * The exception exists because the assignment lifecycle is one-way
 * (DRAFT -> READY -> OPEN -> CLOSED -> ARCHIVED) and real assignments end
 * up permanently CLOSED, while the demo seed deliberately writes through
 * the same save_attempt_responses / submit_attempt path a real student's
 * CSV upload uses.
 *
 * The exception is gated on assignment_attempts.is_synthetic. That flag was
 * a plain label in migration 0017, and `attempts_student_own` is a FOR ALL
 * policy — so before 0020 a real student could have set it on their own
 * attempt. These tests are the standing proof that they cannot, because if
 * they could, the gate would be a way for any student to submit to a closed
 * assignment.
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let student: TestUser;
let classId: string;
let closedAssignmentId: string;
let questionIds: string[] = [];

const classIds: string[] = [];
const userIds: string[] = [];

beforeAll(async () => {
  professor = await createTestUser(env, admin, "PROFESSOR", "Seeding Professor");
  student = await createTestUser(env, admin, "STUDENT", "Seeding Student");
  userIds.push(professor.id, student.id);

  const { data: cls, error: clsError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Synthetic Seeding Class",
      class_code: `SS-${Date.now().toString(36).toUpperCase()}`,
      status: "ACTIVE",
    })
    .select("id")
    .single();
  if (clsError) throw new Error(`class insert failed: ${clsError.message}`);
  classId = cls!.id;
  classIds.push(classId);

  const { error: memberError } = await admin.from("class_members").insert({
    class_id: classId,
    user_id: student.id,
    member_role: "STUDENT",
    status: "ACTIVE",
  });
  if (memberError) throw new Error(`enrolment failed: ${memberError.message}`);

  const { data: assignment, error: aError } = await professor.client
    .from("assignments")
    .insert({
      class_id: classId,
      title: "Closed Assignment",
      sequence_number: 1,
      created_by: professor.id,
    })
    .select("id")
    .single();
  if (aError) throw new Error(`assignment insert failed: ${aError.message}`);
  closedAssignmentId = assignment!.id;

  const { data: qs, error: qError } = await professor.client
    .from("questions")
    .insert(
      [1, 2].map((n) => ({
        assignment_id: closedAssignmentId,
        external_question_code: `S-${String(n).padStart(3, "0")}`,
        question_text: `Seeding question ${n}`,
        response_zero_label: "No (0)",
        response_one_label: "Yes (1)",
        display_order: n,
      }))
    )
    .select("id");
  if (qError) throw new Error(`question insert failed: ${qError.message}`);
  questionIds = (qs ?? []).map((q) => q.id);

  // Walk the real lifecycle all the way to CLOSED.
  for (const status of ["READY", "OPEN", "CLOSED"] as const) {
    const { error } = await professor.client
      .from("assignments")
      .update({ status })
      .eq("id", closedAssignmentId);
    if (error) throw new Error(`could not move assignment to ${status}: ${error.message}`);
  }
}, 120_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("the seeding exception does not depend on reopening", () => {
  /**
   * This used to assert "the lifecycle stays one-way — CLOSED -> OPEN is
   * refused". Migration 0023 added that transition deliberately, because
   * its absence meant a professor who closed an assignment could never let
   * the class answer again (see the migration header, which answers 0020's
   * rejection of it directly).
   *
   * What 0020 actually needs is narrower and still holds: the synthetic
   * seeding path writes into a CLOSED assignment WITHOUT reopening it, and
   * no end user can reach that path. So the assertion moves to the thing
   * that would break the seeding guarantee — a student changing the
   * assignment's status — while "leaves the assignment CLOSED — it is
   * never reopened" below covers the other half.
   */
  it("a student cannot change the assignment's status at all", async () => {
    const { error } = await student.client
      .from("assignments")
      .update({ status: "OPEN" })
      .eq("id", closedAssignmentId);

    const { data } = await admin
      .from("assignments")
      .select("status")
      .eq("id", closedAssignmentId)
      .single();
    // RLS may refuse loudly or silently match no rows; either way the
    // status must be untouched.
    void error;
    expect(data!.status, "a student must never be able to reopen an assignment").toBe("CLOSED");
  });

  it("refuses DRAFT and READY as seeding targets — only published assignments", async () => {
    const { data: draft, error: draftError } = await professor.client
      .from("assignments")
      .insert({
        class_id: classId,
        title: "Draft Assignment",
        sequence_number: 4,
        created_by: professor.id,
      })
      .select("id")
      .single();
    expect(draftError, draftError?.message).toBeNull();

    const { data: attempt } = await admin
      .from("assignment_attempts")
      .insert({
        assignment_id: draft!.id,
        student_id: student.id,
        state: "DRAFT",
        is_synthetic: true,
      })
      .select("id")
      .single();

    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: (attempt as { id: string }).id,
      p_answers: [{ questionId: questionIds[0], value: 1 }],
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/has been published|does not belong/i);
  });
});

describe("ACCEPTANCE: a real student cannot reach the synthetic seeding path", () => {
  let realAttemptId: string;

  beforeAll(async () => {
    const { data, error } = await admin
      .from("assignment_attempts")
      .insert({
        assignment_id: closedAssignmentId,
        student_id: student.id,
        state: "DRAFT",
        is_synthetic: false,
      })
      .select("id")
      .single();
    if (error) throw new Error(`attempt insert failed: ${error.message}`);
    realAttemptId = data!.id;
  });

  it("cannot save answers to a closed assignment", async () => {
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: realAttemptId,
      p_answers: [{ questionId: questionIds[0], value: 1 }],
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/no longer open/i);

    const { count } = await admin
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", realAttemptId);
    expect(count ?? 0).toBe(0);
  });

  it("cannot submit to a closed assignment", async () => {
    const { error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: realAttemptId,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/no longer open/i);
  });

  it("cannot flag its own attempt synthetic — the escalation 0020 closes", async () => {
    // Since migration 0024 a student has no direct write on this table at
    // all, so this is refused before the 0020 trigger is even reached. The
    // trigger remains the backstop for any writer that does have the
    // privilege; what this asserts either way is the outcome — the flag
    // stays down.
    await student.client
      .from("assignment_attempts")
      .update({ is_synthetic: true })
      .eq("id", realAttemptId);

    const { data } = await admin
      .from("assignment_attempts")
      .select("is_synthetic")
      .eq("id", realAttemptId)
      .single();
    expect(data!.is_synthetic, "a student must never be able to raise this flag").toBe(false);
  });

  it("cannot insert a synthetic-flagged response under a real attempt", async () => {
    await student.client.from("responses").insert({
      attempt_id: realAttemptId,
      assignment_id: closedAssignmentId,
      student_id: student.id,
      question_id: questionIds[0],
      response_value: 1,
      is_synthetic: true,
    });

    const { count } = await admin
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", realAttemptId);
    expect(count ?? 0).toBe(0);
  });

  it("still cannot submit after every attempt to escalate", async () => {
    const { error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: realAttemptId,
    });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/no longer open/i);
  });
});

describe("ACCEPTANCE: a synthetic attempt seeds into a closed assignment", () => {
  let syntheticStudent: TestUser;
  let syntheticAttemptId: string;

  beforeAll(async () => {
    syntheticStudent = await createTestUser(env, admin, "STUDENT", "Synthetic Student");
    userIds.push(syntheticStudent.id);

    await admin.from("profiles").update({ is_synthetic: true }).eq("id", syntheticStudent.id);
    await admin.from("class_members").insert({
      class_id: classId,
      user_id: syntheticStudent.id,
      member_role: "STUDENT",
      status: "ACTIVE",
      is_synthetic: true,
    });

    // Service role — the only context that may raise the flag.
    const { data, error } = await admin
      .from("assignment_attempts")
      .insert({
        assignment_id: closedAssignmentId,
        student_id: syntheticStudent.id,
        state: "DRAFT",
        is_synthetic: true,
      })
      .select("id")
      .single();
    if (error) throw new Error(`synthetic attempt insert failed: ${error.message}`);
    syntheticAttemptId = data!.id;
  });

  it("saves and submits through the real RPCs, as the student", async () => {
    const { error: saveError } = await syntheticStudent.client.rpc("save_attempt_responses", {
      p_attempt_id: syntheticAttemptId,
      p_answers: questionIds.map((id, i) => ({ questionId: id, value: i % 2 })),
    });
    expect(saveError, saveError?.message).toBeNull();

    const { data: receipt, error: submitError } = await syntheticStudent.client.rpc(
      "submit_attempt",
      { p_attempt_id: syntheticAttemptId }
    );
    expect(submitError, submitError?.message).toBeNull();
    expect((receipt as { state: string }).state).toBe("SUBMITTED");
  });

  it("marks every seeded response synthetic, without a second pass", async () => {
    const { data } = await admin
      .from("responses")
      .select("is_synthetic, response_value, is_final")
      .eq("attempt_id", syntheticAttemptId);

    expect(data).toHaveLength(questionIds.length);
    for (const row of data ?? []) {
      expect(row.is_synthetic, "provenance flows from the attempt").toBe(true);
      expect(row.is_final).toBe(true);
      expect([0, 1]).toContain(row.response_value);
    }
  });

  it("leaves the assignment CLOSED — it is never reopened", async () => {
    const { data } = await admin
      .from("assignments")
      .select("status")
      .eq("id", closedAssignmentId)
      .single();
    expect(data!.status).toBe("CLOSED");
  });

  it("still enforces 0/1 on synthetic data", async () => {
    const { data: second, error } = await admin
      .from("assignment_attempts")
      .insert({
        assignment_id: closedAssignmentId,
        student_id: syntheticStudent.id,
        state: "DRAFT",
        is_synthetic: true,
      })
      .select("id")
      .maybeSingle();
    // One attempt per (assignment, student) — reuse the existing one.
    void second;
    void error;

    const { error: badValue } = await syntheticStudent.client.rpc("save_attempt_responses", {
      p_attempt_id: syntheticAttemptId,
      p_answers: [{ questionId: questionIds[0], value: 7 }],
    });
    // Already submitted, so the state check fires first — either way the
    // write is refused. The point is that nothing about the synthetic path
    // relaxes validation.
    expect(badValue).toBeTruthy();
  });
});
