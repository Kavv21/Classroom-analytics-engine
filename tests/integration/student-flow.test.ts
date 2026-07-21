// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  type TestUser,
} from "./helpers";

/**
 * Live integration tests for the Phase 5 student response workflow: the
 * attempt state machine (DB trigger), idempotent autosave, transactional
 * duplicate-proof submission, and professor-only reopening. Every check
 * here runs against real RLS with real signed-in users.
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let student: TestUser;
let classId: string;
let assignmentId: string;
let questionIds: string[] = [];

const classIds: string[] = [];
const userIds: string[] = [];

async function createOpenAssignment(title: string): Promise<{ id: string; questionIds: string[] }> {
  const { data: a, error: aError } = await professor.client
    .from("assignments")
    .insert({ class_id: classId, title, sequence_number: 1, created_by: professor.id })
    .select("id")
    .single();
  if (aError) throw new Error(`assignment insert failed: ${aError.message}`);

  const { data: qs, error: qError } = await professor.client
    .from("questions")
    .insert(
      [1, 2, 3].map((n) => ({
        assignment_id: a!.id,
        external_question_code: `T-${String(n).padStart(3, "0")}`,
        question_text: `Test question ${n}`,
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
    questionIds: (qs ?? [])
      .sort((x, y) => x.display_order - y.display_order)
      .map((q) => q.id),
  };
}

async function getAttempt(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("assignment_attempts")
    .select("id, state, submitted_at, submission_version, reopened_at, reopened_by")
    .eq("id", id)
    .single();
  if (error) throw new Error(`attempt fetch failed: ${error.message}`);
  return data!;
}

beforeAll(async () => {
  // Fail fast with a clear message if migration 0010 hasn't been applied.
  const { error: probe } = await admin.rpc("get_or_create_attempt", {
    p_assignment_id: randomUUID(),
  });
  if (probe && /could not find|does not exist|schema cache/i.test(probe.message)) {
    throw new Error(
      "get_or_create_attempt is missing on the target database — apply migration " +
        "0010 (npm run db:migrate) before running the integration tests."
    );
  }

  professor = await createTestUser(env, admin, "PROFESSOR", "IT Professor");
  userIds.push(professor.id);
  student = await createTestUser(env, admin, "STUDENT", "IT Student");
  userIds.push(student.id);

  const { data: classRow, error: classError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Student Flow Class",
      class_code: `IT${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (classError) throw new Error(`class insert failed: ${classError.message}`);
  classId = classRow!.id;
  classIds.push(classId);

  const { error: memberError } = await admin.from("class_members").insert({
    class_id: classId,
    user_id: student.id,
    member_role: "STUDENT",
    status: "ACTIVE",
  });
  if (memberError) throw new Error(`enrolment failed: ${memberError.message}`);

  const created = await createOpenAssignment("Student Flow Assignment");
  assignmentId = created.id;
  questionIds = created.questionIds;
}, 120_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

let attemptId: string;

describe("attempt lifecycle", () => {
  it("get_or_create_attempt is idempotent and starts at NOT_STARTED", async () => {
    const { data: first, error: e1 } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentId,
    });
    expect(e1, e1?.message).toBeNull();
    const a1 = first as { id: string; state: string };
    expect(a1.state).toBe("NOT_STARTED");

    const { data: second, error: e2 } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentId,
    });
    expect(e2).toBeNull();
    expect((second as { id: string }).id).toBe(a1.id);
    attemptId = a1.id;
  }, 20_000);

  it("rejects state transitions not on the list (DB trigger)", async () => {
    for (const state of ["REOPENED", "RESUBMITTED"] as const) {
      const { error } = await student.client
        .from("assignment_attempts")
        .update({ state })
        .eq("id", attemptId);
      expect(error, `NOT_STARTED -> ${state} must be rejected`).not.toBeNull();
      expect(error!.message).toContain("invalid attempt state transition");
    }
  }, 20_000);

  it("autosaves a batch idempotently and moves NOT_STARTED -> DRAFT", async () => {
    const batch = [
      { questionId: questionIds[0], value: 1 },
      { questionId: questionIds[1], value: 0 },
      { questionId: questionIds[2], value: null },
    ];
    const { data, error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: batch,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { saved: number; state: string }).state).toBe("DRAFT");

    // Replay the identical batch (retry after a dropped connection):
    // converges to the same three rows, no duplicates.
    const { error: replayError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: batch,
    });
    expect(replayError).toBeNull();

    const { data: rows, error: rowsError } = await student.client
      .from("responses")
      .select("question_id, response_value")
      .eq("attempt_id", attemptId);
    expect(rowsError).toBeNull();
    expect(rows).toHaveLength(3);
    const byQuestion = new Map(rows!.map((r) => [r.question_id, r.response_value]));
    expect(byQuestion.get(questionIds[0]!)).toBe(1);
    expect(byQuestion.get(questionIds[1]!)).toBe(0);
    expect(byQuestion.get(questionIds[2]!)).toBeNull();

    // Changing an answer updates in place (still 3 rows).
    const { error: changeError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[0], value: 0 }],
    });
    expect(changeError).toBeNull();
    const { count } = await student.client
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("attempt_id", attemptId);
    expect(count).toBe(3);
  }, 20_000);

  it("rejects out-of-range values and foreign questions", async () => {
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[0], value: 2 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("only 0, 1, or null are allowed");

    const { error: foreignError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: randomUUID(), value: 1 }],
    });
    expect(foreignError).not.toBeNull();
    expect(foreignError!.message).toContain("does not belong to this assignment");
  }, 20_000);

  it("submits transactionally and blocks the duplicate submission", async () => {
    const { data, error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error, error?.message).toBeNull();
    const receipt = data as { state: string; submissionVersion: number; answered: number };
    expect(receipt.state).toBe("SUBMITTED");
    expect(receipt.submissionVersion).toBe(1);
    expect(receipt.answered).toBe(2); // one answer is deliberately null

    // The double-click / double-request: clear error, nothing changes.
    const { error: dupError } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(dupError).not.toBeNull();
    expect(dupError!.message).toContain("already submitted");

    const after = await getAttempt(student.client, attemptId);
    expect(after.state).toBe("SUBMITTED");
    expect(after.submission_version).toBe(1);

    const { data: finals } = await student.client
      .from("responses")
      .select("is_final")
      .eq("attempt_id", attemptId);
    expect(finals!.every((r) => r.is_final)).toBe(true);
  }, 20_000);

  it("rejects saves after submission", async () => {
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[0], value: 1 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("already been submitted");
  }, 20_000);

  it("only the professor can reopen, with full bookkeeping", async () => {
    const { error: studentReopen } = await student.client.rpc("reopen_attempt", {
      p_attempt_id: attemptId,
    });
    expect(studentReopen, "a student must not reopen their own attempt").not.toBeNull();

    const { data, error } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { state: string }).state).toBe("REOPENED");

    const after = await getAttempt(student.client, attemptId);
    expect(after.state).toBe("REOPENED");
    expect(after.reopened_by).toBe(professor.id);
    expect(after.reopened_at).not.toBeNull();

    const { data: finals } = await student.client
      .from("responses")
      .select("is_final")
      .eq("attempt_id", attemptId);
    expect(finals!.every((r) => !r.is_final)).toBe(true);
  }, 20_000);

  it("REOPENED -> DRAFT -> RESUBMITTED bumps the submission version", async () => {
    const { error: saveError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[2], value: 1 }],
    });
    expect(saveError, saveError?.message).toBeNull();
    expect((await getAttempt(student.client, attemptId)).state).toBe("DRAFT");

    // Per the FSM an edited reopened attempt goes REOPENED -> DRAFT ->
    // SUBMITTED (DRAFT -> RESUBMITTED is not an edge), but it is still a
    // re-submission, so the version bumps to 2.
    const { data, error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error, error?.message).toBeNull();
    const receipt = data as { state: string; submissionVersion: number };
    expect(receipt.state).toBe("SUBMITTED");
    expect(receipt.submissionVersion).toBe(2);

    // Reopen again and resubmit WITHOUT drafting: REOPENED -> RESUBMITTED.
    const { error: reopenError } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: attemptId,
    });
    expect(reopenError, reopenError?.message).toBeNull();

    const { data: resubmit, error: resubmitError } = await student.client.rpc(
      "submit_attempt",
      { p_attempt_id: attemptId }
    );
    expect(resubmitError, resubmitError?.message).toBeNull();
    const r2 = resubmit as { state: string; submissionVersion: number };
    expect(r2.state).toBe("RESUBMITTED");
    expect(r2.submissionVersion).toBe(3);

    // RESUBMITTED is terminal: no further reopen.
    const { error: terminalError } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: attemptId,
    });
    expect(terminalError).not.toBeNull();
    expect(terminalError!.message).toContain("only a SUBMITTED attempt");
  }, 30_000);

  it("supports direct NOT_STARTED -> SUBMITTED (submit with no draft)", async () => {
    const second = await createOpenAssignment("No-Draft Assignment");
    const { data, error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: second.id,
    });
    expect(error, error?.message).toBeNull();
    const a = data as { id: string; state: string };
    expect(a.state).toBe("NOT_STARTED");

    const { data: receipt, error: submitError } = await student.client.rpc("submit_attempt", {
      p_attempt_id: a.id,
    });
    expect(submitError, submitError?.message).toBeNull();
    expect((receipt as { state: string }).state).toBe("SUBMITTED");
  }, 30_000);
});
