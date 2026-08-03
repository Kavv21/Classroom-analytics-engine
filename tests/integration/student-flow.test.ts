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

/**
 * Sequence numbers are unique per class (migration 0018), so each
 * assignment this helper creates takes the next free one. The helper used
 * to hardcode 1, which worked only because nothing enforced uniqueness —
 * the exact condition that let the real class end up with two sequence-1
 * assignments and a silently disabled comparison.
 *
 * Past the paired pair it asks the DATABASE for the next free number
 * rather than keeping its own counter: duplicate_assignment also allocates
 * numbers now, so a local counter drifts out of step with what the class
 * actually holds and collides with the index.
 */
let pairedAssignmentsCreated = 0;

async function nextSequenceNumber(): Promise<number> {
  if (pairedAssignmentsCreated < 2) return ++pairedAssignmentsCreated;
  const { data, error } = await professor.client.rpc("next_assignment_sequence_number", {
    p_class_id: classId,
  });
  if (error) throw new Error(`sequence allocation failed: ${error.message}`);
  return data as number;
}

async function createOpenAssignment(title: string): Promise<{ id: string; questionIds: string[] }> {
  const { data: a, error: aError } = await professor.client
    .from("assignments")
    .insert({
      class_id: classId,
      title,
      sequence_number: await nextSequenceNumber(),
      created_by: professor.id,
    })
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

/**
 * The reported bug, end to end: "the professor reopened it and the student
 * still can't answer."
 *
 * Reopening was a dead end twice over — CLOSED had no way back to OPEN, and
 * reopening a single attempt left the student facing a closed assignment
 * every write path refused. Migration 0023 fixes both; these tests are what
 * would have caught it, since every earlier reopen test ran against an
 * assignment that happened to still be OPEN.
 */
describe("reopening a closed assignment", () => {
  let closedAssignmentId: string;
  let closedQuestionIds: string[];
  let reopenedAttemptId: string;

  async function setStatus(id: string, status: string) {
    const { error } = await professor.client
      .from("assignments")
      .update({ status })
      .eq("id", id);
    if (error) throw new Error(`transition to ${status} failed: ${error.message}`);
  }

  beforeAll(async () => {
    const created = await createOpenAssignment("Closed-Then-Reopened Assignment");
    closedAssignmentId = created.id;
    closedQuestionIds = created.questionIds;

    const { data, error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: closedAssignmentId,
    });
    if (error) throw new Error(`attempt open failed: ${error.message}`);
    reopenedAttemptId = (data as { id: string }).id;

    const { error: submitError } = await student.client.rpc("submit_attempt", {
      p_attempt_id: reopenedAttemptId,
    });
    if (submitError) throw new Error(`submit failed: ${submitError.message}`);

    await setStatus(closedAssignmentId, "CLOSED");
  }, 60_000);

  it("a closed assignment blocks the student until something reopens it", async () => {
    const { error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: closedAssignmentId,
    });
    expect(error, "a closed assignment must not be answerable").not.toBeNull();
  }, 20_000);

  it("lets the professor reopen a single attempt while the assignment stays closed", async () => {
    const { data, error } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: reopenedAttemptId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { state: string }).state).toBe("REOPENED");
  }, 20_000);

  it("the reopened student can now open, save and resubmit — the bug", async () => {
    const { data, error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: closedAssignmentId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { id: string; state: string }).state).toBe("REOPENED");

    // The first save moves REOPENED -> DRAFT. If DRAFT were outside the
    // allowance the student would be locked out by their own first cell.
    const { error: saveError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: reopenedAttemptId,
      p_answers: [{ questionId: closedQuestionIds[0], value: 1 }],
    });
    expect(saveError, saveError?.message).toBeNull();

    const { error: secondSaveError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: reopenedAttemptId,
      p_answers: [{ questionId: closedQuestionIds[1], value: 0 }],
    });
    expect(secondSaveError, secondSaveError?.message).toBeNull();

    const { data: receipt, error: submitError } = await student.client.rpc("submit_attempt", {
      p_attempt_id: reopenedAttemptId,
    });
    expect(submitError, submitError?.message).toBeNull();
    expect((receipt as { submissionVersion: number }).submissionVersion).toBe(2);
  }, 30_000);

  it("the allowance ends at resubmission — no open door on a closed assignment", async () => {
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: reopenedAttemptId,
      p_answers: [{ questionId: closedQuestionIds[0], value: 0 }],
    });
    expect(error, "a resubmitted attempt must be closed again").not.toBeNull();
  }, 20_000);

  it("CLOSED -> OPEN reopens the assignment for the whole class", async () => {
    await setStatus(closedAssignmentId, "OPEN");

    const { data: fresh, error } = await admin
      .from("assignments")
      .select("status")
      .eq("id", closedAssignmentId)
      .single();
    expect(error).toBeNull();
    expect(fresh!.status).toBe("OPEN");

    // And back again, so closing is still available after a reopen.
    await setStatus(closedAssignmentId, "CLOSED");
  }, 20_000);

  it("refuses to reopen an attempt on an archived assignment", async () => {
    const spare = await createOpenAssignment("Archived Assignment");
    const { data: attempt } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: spare.id,
    });
    const spareAttemptId = (attempt as { id: string }).id;
    await student.client.rpc("submit_attempt", { p_attempt_id: spareAttemptId });

    await setStatus(spare.id, "CLOSED");
    await setStatus(spare.id, "ARCHIVED");

    const { error } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: spareAttemptId,
    });
    expect(error, "an archived assignment has nowhere for the student to answer").not.toBeNull();
    expect(error!.message).toContain("cannot be reopened");
  }, 30_000);
});

/**
 * A class is not limited to two assignments — only the compared PAIR is.
 * duplicate_assignment copied the source's sequence_number verbatim, which
 * has been a guaranteed unique-index violation since migration 0018, so
 * duplicating a live assignment could not succeed at all.
 */
describe("more than two assignments per class", () => {
  it("duplicate_assignment allocates its own sequence number and re-prefixes codes", async () => {
    const source = await createOpenAssignment("Duplicate Source");

    const { data: newId, error } = await professor.client.rpc("duplicate_assignment", {
      p_assignment_id: source.id,
    });
    expect(error, error?.message).toBeNull();

    const { data: copy, error: copyError } = await professor.client
      .from("assignments")
      .select("id, sequence_number, status, class_id")
      .eq("id", newId as string)
      .single();
    expect(copyError).toBeNull();
    expect(copy!.status).toBe("DRAFT");
    expect(copy!.class_id).toBe(classId);
    expect(copy!.sequence_number).toBeGreaterThanOrEqual(3);

    const { data: sourceRow } = await professor.client
      .from("assignments")
      .select("sequence_number")
      .eq("id", source.id)
      .single();
    expect(copy!.sequence_number).not.toBe(sourceRow!.sequence_number);
  }, 30_000);

  it("a class can hold several non-paired assignments at once", async () => {
    const extras = [
      await createOpenAssignment("Extra One"),
      await createOpenAssignment("Extra Two"),
      await createOpenAssignment("Extra Three"),
    ];

    const { data: rows, error } = await professor.client
      .from("assignments")
      .select("id, sequence_number")
      .eq("class_id", classId)
      .in(
        "id",
        extras.map((e) => e.id)
      );
    expect(error).toBeNull();
    expect(rows).toHaveLength(3);
    const numbers = rows!.map((r) => r.sequence_number);
    expect(new Set(numbers).size).toBe(3);
  }, 40_000);

  it("next_assignment_sequence_number never returns a paired or taken number", async () => {
    const { data, error } = await professor.client.rpc("next_assignment_sequence_number", {
      p_class_id: classId,
    });
    expect(error, error?.message).toBeNull();
    const next = data as number;
    expect(next).toBeGreaterThanOrEqual(3);

    const { data: taken } = await professor.client
      .from("assignments")
      .select("sequence_number")
      .eq("class_id", classId);
    expect(taken!.map((t) => t.sequence_number)).not.toContain(next);
  }, 20_000);
});
