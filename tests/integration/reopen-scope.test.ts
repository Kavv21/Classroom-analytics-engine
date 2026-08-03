// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { adminClient, cleanupTestData, createTestUser, loadEnv, type TestUser } from "./helpers";

/**
 * REOPENING IS SCOPED TO EXACTLY ONE (assignment, student) PAIR.
 *
 * The reported bugs: a submitted attempt was not really locked, and
 * reopening one student's Assignment 2 attempt also let them re-attempt
 * Assignment 1.
 *
 * Both came from the same place — the RLS policies, which were the actual
 * write boundary and asked a STUDENT-level question
 * (`for all using (student_id = auth.uid())`) rather than a per-attempt
 * one. Under them a student could rewrite their own final responses, and
 * could take their own SUBMITTED attempt to REOPENED (a legal FSM edge —
 * the trigger validates the edge, not the actor) and so unlock any
 * assignment for themselves. Migration 0024 removes every direct student
 * write on assignment_attempts / responses and makes the three RPCs the
 * only writers.
 *
 * These tests therefore go THROUGH the client library the app uses, as
 * really signed-in users, so they exercise grants, policies, triggers and
 * RPCs exactly as production does. The matrix is two assignments × two
 * students; the pass condition is that reopening one cell moves one cell.
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let studentA: TestUser;
let studentB: TestUser;
let classId: string;

const classIds: string[] = [];
const userIds: string[] = [];

interface Assignment {
  id: string;
  questionIds: string[];
}

let assignmentX: Assignment;
let assignmentY: Assignment;

/** attemptOf[assignmentId][studentId] */
const attemptOf: Record<string, Record<string, string>> = {};

let sequence = 0;

async function createOpenAssignment(title: string): Promise<Assignment> {
  const { data: a, error: aError } = await professor.client
    .from("assignments")
    .insert({
      class_id: classId,
      title,
      sequence_number: ++sequence,
      created_by: professor.id,
    })
    .select("id")
    .single();
  if (aError) throw new Error(`assignment insert failed: ${aError.message}`);

  const { data: qs, error: qError } = await professor.client
    .from("questions")
    .insert(
      [1, 2].map((n) => ({
        assignment_id: a!.id,
        external_question_code: `RS-${sequence}-${n}`,
        question_text: `Scope question ${n}`,
        response_zero_label: "No (0)",
        response_one_label: "Yes (1)",
        display_order: n,
      }))
    )
    .select("id, display_order");
  if (qError) throw new Error(`question insert failed: ${qError.message}`);

  for (const status of ["READY", "OPEN"] as const) {
    const { error } = await professor.client
      .from("assignments")
      .update({ status })
      .eq("id", a!.id);
    if (error) throw new Error(`transition to ${status} failed: ${error.message}`);
  }

  return {
    id: a!.id,
    questionIds: (qs ?? []).sort((x, y) => x.display_order - y.display_order).map((q) => q.id),
  };
}

/** Open, answer and submit — the state every cell of the matrix starts in. */
async function submitAttempt(student: TestUser, assignment: Assignment): Promise<string> {
  const { data, error } = await student.client.rpc("get_or_create_attempt", {
    p_assignment_id: assignment.id,
  });
  if (error) throw new Error(`open failed: ${error.message}`);
  const attemptId = (data as { id: string }).id;

  const { error: saveError } = await student.client.rpc("save_attempt_responses", {
    p_attempt_id: attemptId,
    p_answers: [{ questionId: assignment.questionIds[0], value: 1 }],
  });
  if (saveError) throw new Error(`save failed: ${saveError.message}`);

  const { error: submitError } = await student.client.rpc("submit_attempt", {
    p_attempt_id: attemptId,
  });
  if (submitError) throw new Error(`submit failed: ${submitError.message}`);

  return attemptId;
}

async function stateOf(attemptId: string): Promise<string> {
  const { data, error } = await admin
    .from("assignment_attempts")
    .select("state")
    .eq("id", attemptId)
    .single();
  if (error) throw new Error(`state fetch failed: ${error.message}`);
  return data!.state as string;
}

/** Can this student actually write to this attempt right now? Asked of the
 *  database, not of the UI: the save RPC is the narrowest real write. */
async function canWrite(
  student: TestUser,
  assignment: Assignment,
  attemptId: string
): Promise<boolean> {
  const { error } = await student.client.rpc("save_attempt_responses", {
    p_attempt_id: attemptId,
    p_answers: [{ questionId: assignment.questionIds[1], value: 0 }],
  });
  return error === null;
}

async function setStatus(assignmentId: string, status: string): Promise<void> {
  const { error } = await professor.client
    .from("assignments")
    .update({ status })
    .eq("id", assignmentId);
  if (error) throw new Error(`transition to ${status} failed: ${error.message}`);
}

beforeAll(async () => {
  professor = await createTestUser(env, admin, "PROFESSOR", "Scope Professor");
  userIds.push(professor.id);
  studentA = await createTestUser(env, admin, "STUDENT", "Scope Student A");
  userIds.push(studentA.id);
  studentB = await createTestUser(env, admin, "STUDENT", "Scope Student B");
  userIds.push(studentB.id);

  const { data: classRow, error: classError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Reopen Scope Class",
      class_code: `RS${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (classError) throw new Error(`class insert failed: ${classError.message}`);
  classId = classRow!.id;
  classIds.push(classId);

  const { error: memberError } = await admin.from("class_members").insert(
    [studentA, studentB].map((s) => ({
      class_id: classId,
      user_id: s.id,
      member_role: "STUDENT",
      status: "ACTIVE",
    }))
  );
  if (memberError) throw new Error(`enrolment failed: ${memberError.message}`);

  assignmentX = await createOpenAssignment("Scope Assignment X");
  assignmentY = await createOpenAssignment("Scope Assignment Y");

  attemptOf[assignmentX.id] = {
    [studentA.id]: await submitAttempt(studentA, assignmentX),
    [studentB.id]: await submitAttempt(studentB, assignmentX),
  };
  attemptOf[assignmentY.id] = {
    [studentA.id]: await submitAttempt(studentA, assignmentY),
    [studentB.id]: await submitAttempt(studentB, assignmentY),
  };

  // Both closed, so nothing but an explicit reopen can let anyone back in.
  await setStatus(assignmentX.id, "CLOSED");
  await setStatus(assignmentY.id, "CLOSED");
}, 180_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("a submitted attempt is locked by default", () => {
  it("refuses every write on every pair before anything is reopened", async () => {
    for (const assignment of [assignmentX, assignmentY]) {
      for (const student of [studentA, studentB]) {
        const attemptId = attemptOf[assignment.id]![student.id]!;
        expect(
          await canWrite(student, assignment, attemptId),
          "a submitted attempt must be read-only"
        ).toBe(false);
      }
    }
  }, 60_000);

  it("a student cannot rewrite their own final responses directly", async () => {
    const attemptId = attemptOf[assignmentX.id]![studentA.id]!;
    const { error } = await studentA.client
      .from("responses")
      .update({ response_value: 0 })
      .eq("attempt_id", attemptId);
    expect(error, "a final response must not be student-writable").not.toBeNull();

    const { data: rows } = await admin
      .from("responses")
      .select("response_value, is_final")
      .eq("attempt_id", attemptId);
    expect(rows!.every((r) => r.is_final)).toBe(true);
    expect(rows!.some((r) => r.response_value === 1)).toBe(true);
  }, 30_000);

  it("a student cannot reopen themselves — the escalation the FSM alone allowed", async () => {
    const attemptId = attemptOf[assignmentX.id]![studentA.id]!;

    // SUBMITTED -> REOPENED is a legal EDGE; the trigger validates edges,
    // not actors. Only the missing write privilege stops this.
    const { error } = await studentA.client
      .from("assignment_attempts")
      .update({ state: "REOPENED", reopened_at: new Date().toISOString() })
      .eq("id", attemptId);
    expect(error, "a student must not be able to reopen their own attempt").not.toBeNull();
    expect(await stateOf(attemptId)).toBe("SUBMITTED");

    // Nor through the professor's RPC.
    const { error: rpcError } = await studentA.client.rpc("reopen_attempt", {
      p_attempt_id: attemptId,
      p_assignment_id: assignmentX.id,
    });
    expect(rpcError).not.toBeNull();
    expect(await stateOf(attemptId)).toBe("SUBMITTED");
  }, 30_000);

  it("a student cannot delete their own submitted attempt", async () => {
    const attemptId = attemptOf[assignmentY.id]![studentA.id]!;
    const { error } = await studentA.client
      .from("assignment_attempts")
      .delete()
      .eq("id", attemptId);
    expect(error).not.toBeNull();
    expect(await stateOf(attemptId)).toBe("SUBMITTED");
  }, 30_000);
});

describe("reopening student A on assignment X", () => {
  it("reopens exactly that one attempt", async () => {
    const { data, error } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: attemptOf[assignmentX.id]![studentA.id]!,
      p_assignment_id: assignmentX.id,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { state: string }).state).toBe("REOPENED");

    expect(await stateOf(attemptOf[assignmentX.id]![studentA.id]!)).toBe("REOPENED");
    expect(await stateOf(attemptOf[assignmentY.id]![studentA.id]!)).toBe("SUBMITTED");
    expect(await stateOf(attemptOf[assignmentX.id]![studentB.id]!)).toBe("SUBMITTED");
    expect(await stateOf(attemptOf[assignmentY.id]![studentB.id]!)).toBe("SUBMITTED");
  }, 30_000);

  it("lets student A write to assignment X", async () => {
    expect(
      await canWrite(studentA, assignmentX, attemptOf[assignmentX.id]![studentA.id]!)
    ).toBe(true);
  }, 30_000);

  it("does NOT unlock student A's attempt on assignment Y — bug 2", async () => {
    const attemptId = attemptOf[assignmentY.id]![studentA.id]!;
    expect(await canWrite(studentA, assignmentY, attemptId)).toBe(false);

    // Nor the assignment itself: opening it must still be refused.
    const { error } = await studentA.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentY.id,
    });
    expect(error, "assignment Y was never reopened for student A").not.toBeNull();
    expect(await stateOf(attemptId)).toBe("SUBMITTED");
  }, 30_000);

  it("does NOT unlock student B's attempt on assignment X — bug 2, other axis", async () => {
    const attemptId = attemptOf[assignmentX.id]![studentB.id]!;
    expect(await canWrite(studentB, assignmentX, attemptId)).toBe(false);

    const { error } = await studentB.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentX.id,
    });
    expect(error, "student B was not the student who was reopened").not.toBeNull();
    expect(await stateOf(attemptId)).toBe("SUBMITTED");
  }, 30_000);

  it("locks assignment X again the moment student A resubmits", async () => {
    const attemptId = attemptOf[assignmentX.id]![studentA.id]!;
    const { data, error } = await studentA.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { submissionVersion: number }).submissionVersion).toBe(2);

    expect(await canWrite(studentA, assignmentX, attemptId)).toBe(false);
    // And the spent reopen grant is not left lying around.
    const { data: row } = await admin
      .from("assignment_attempts")
      .select("reopened_at, reopened_by")
      .eq("id", attemptId)
      .single();
    expect(row!.reopened_at).toBeNull();
    expect(row!.reopened_by, "who reopened it is still on the record").toBe(professor.id);
  }, 30_000);
});

describe("reopening an attempt names the assignment it belongs to", () => {
  it("refuses an attempt id that belongs to a different assignment", async () => {
    const { error } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: attemptOf[assignmentY.id]![studentB.id]!,
      p_assignment_id: assignmentX.id,
    });
    expect(error, "the pair must match").not.toBeNull();
    expect(await stateOf(attemptOf[assignmentY.id]![studentB.id]!)).toBe("SUBMITTED");
  }, 30_000);

  it("refuses a professor who does not own the class", async () => {
    const outsider = await createTestUser(env, admin, "PROFESSOR", "Outside Professor");
    userIds.push(outsider.id);

    const { error } = await outsider.client.rpc("reopen_attempt", {
      p_attempt_id: attemptOf[assignmentX.id]![studentB.id]!,
      p_assignment_id: assignmentX.id,
    });
    expect(error).not.toBeNull();
    expect(await stateOf(attemptOf[assignmentX.id]![studentB.id]!)).toBe("SUBMITTED");
  }, 60_000);
});

describe("reopening assignment X for all students", () => {
  it("reopens every submitted attempt on X and none on Y", async () => {
    const { data, error } = await professor.client.rpc("reopen_assignment_attempts", {
      p_assignment_id: assignmentX.id,
    });
    expect(error, error?.message).toBeNull();

    // Student A resubmitted above and student B never left SUBMITTED, so
    // both cells of X are eligible.
    expect((data as { reopened: number }).reopened).toBe(2);

    expect(await stateOf(attemptOf[assignmentX.id]![studentA.id]!)).toBe("REOPENED");
    expect(await stateOf(attemptOf[assignmentX.id]![studentB.id]!)).toBe("REOPENED");
    expect(await stateOf(attemptOf[assignmentY.id]![studentA.id]!)).toBe("SUBMITTED");
    expect(await stateOf(attemptOf[assignmentY.id]![studentB.id]!)).toBe("SUBMITTED");
  }, 30_000);

  it("both students can now work on X, and neither can work on Y", async () => {
    expect(
      await canWrite(studentA, assignmentX, attemptOf[assignmentX.id]![studentA.id]!)
    ).toBe(true);
    expect(
      await canWrite(studentB, assignmentX, attemptOf[assignmentX.id]![studentB.id]!)
    ).toBe(true);
    expect(
      await canWrite(studentA, assignmentY, attemptOf[assignmentY.id]![studentA.id]!)
    ).toBe(false);
    expect(
      await canWrite(studentB, assignmentY, attemptOf[assignmentY.id]![studentB.id]!)
    ).toBe(false);
  }, 60_000);

  it("leaves the assignment's own status alone — this is not CLOSED -> OPEN", async () => {
    const { data } = await admin
      .from("assignments")
      .select("status")
      .eq("id", assignmentX.id)
      .single();
    expect(data!.status).toBe("CLOSED");
  }, 30_000);

  it("is refused for a professor who does not own the class", async () => {
    const outsider = await createTestUser(env, admin, "PROFESSOR", "Outside Professor 2");
    userIds.push(outsider.id);

    const { error } = await outsider.client.rpc("reopen_assignment_attempts", {
      p_assignment_id: assignmentY.id,
    });
    expect(error).not.toBeNull();
    expect(await stateOf(attemptOf[assignmentY.id]![studentA.id]!)).toBe("SUBMITTED");
  }, 60_000);

  it("is refused by students", async () => {
    const { error } = await studentA.client.rpc("reopen_assignment_attempts", {
      p_assignment_id: assignmentY.id,
    });
    expect(error, "reopening is a professor gesture only").not.toBeNull();
    expect(await stateOf(attemptOf[assignmentY.id]![studentA.id]!)).toBe("SUBMITTED");
  }, 30_000);
});
