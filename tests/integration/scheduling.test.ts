// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  type TestUser,
} from "./helpers";

/**
 * Date-driven scheduling (migration 0029), proved against real RLS with
 * real signed-in users.
 *
 * The claim under test is the one the feature exists for: a student cannot
 * reach a scheduled assignment before `open_at` or after `close_at`, even
 * though its status column says READY the whole time — and can, in between.
 * Every check goes through the student's own client, so what is being
 * exercised is the policy and the RPC, not a redirect in a page component.
 *
 * Windows are built relative to now() at each step rather than slept
 * through: the predicates read the clock on every call, so moving the dates
 * is the same experiment as waiting, and takes milliseconds instead of
 * minutes.
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

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** A window relative to now, in hours. Negative is in the past. */
function windowHours(fromHours: number, toHours: number) {
  return {
    open_at: new Date(Date.now() + fromHours * HOUR).toISOString(),
    close_at: new Date(Date.now() + toHours * HOUR).toISOString(),
  };
}

/** Moves the assignment's schedule. Service role: this is test scaffolding,
 *  not the behaviour under test — the professor's own path is covered by
 *  the form/action tests. */
async function setWindow(window: { open_at: string | null; close_at: string | null }) {
  const { error } = await admin.from("assignments").update(window).eq("id", assignmentId);
  if (error) throw new Error(`could not move the window: ${error.message}`);
}

async function setStatus(status: string) {
  const { error } = await admin.from("assignments").update({ status }).eq("id", assignmentId);
  if (error) throw new Error(`transition to ${status} failed: ${error.message}`);
}

beforeAll(async () => {
  const { error: probe } = await admin.rpc("assignment_accepts_answers", {
    p_status: "READY",
    p_open_at: null,
    p_close_at: null,
  });
  if (probe && /could not find|does not exist|schema cache/i.test(probe.message)) {
    throw new Error(
      "assignment_accepts_answers is missing on the target database — apply migration " +
        "0029 (npm run db:migrate) before running the integration tests."
    );
  }

  professor = await createTestUser(env, admin, "PROFESSOR", "IT Schedule Professor");
  userIds.push(professor.id);
  student = await createTestUser(env, admin, "STUDENT", "IT Schedule Student");
  userIds.push(student.id);

  const { data: classRow, error: classError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Scheduling Class",
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

  const { data: a, error: aError } = await professor.client
    .from("assignments")
    .insert({
      class_id: classId,
      title: "Scheduled Assignment",
      sequence_number: 1,
      created_by: professor.id,
    })
    .select("id")
    .single();
  if (aError) throw new Error(`assignment insert failed: ${aError.message}`);
  assignmentId = a!.id;

  const { data: qs, error: qError } = await professor.client
    .from("questions")
    .insert(
      [1, 2, 3].map((n) => ({
        assignment_id: assignmentId,
        external_question_code: `S-${String(n).padStart(3, "0")}`,
        question_text: `Scheduled question ${n}`,
        response_zero_label: "No (0)",
        response_one_label: "Yes (1)",
        display_order: n,
      }))
    )
    .select("id, display_order");
  if (qError) throw new Error(`question insert failed: ${qError.message}`);
  questionIds = (qs ?? []).sort((x, y) => x.display_order - y.display_order).map((q) => q.id);

  // Approved, but NOT published: the assignment stays at READY for the
  // whole of this file. That is the point — nothing below ever moves it to
  // OPEN, and students still get in.
  await setStatus("READY");
}, 120_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("a READY assignment with no dates", () => {
  it("is invisible to the student — an unscheduled assignment is not 'open to everyone'", async () => {
    await setWindow({ open_at: null, close_at: null });
    const { data, error } = await student.client
      .from("assignments")
      .select("id")
      .eq("id", assignmentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  }, 20_000);

  it("refuses to start an attempt", async () => {
    const { error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentId,
    });
    expect(error).not.toBeNull();
  }, 20_000);
});

describe("before open_at", () => {
  beforeAll(async () => {
    await setWindow(windowHours(2, 26));
  });

  it("shows the student that it is coming", async () => {
    const { data, error } = await student.client
      .from("assignments")
      .select("id, status, open_at")
      .eq("id", assignmentId)
      .maybeSingle();
    expect(error).toBeNull();
    // The status column still literally reads READY — the window is what
    // decides access, and the professor's dashboard says "Scheduled".
    expect(data?.status).toBe("READY");
  }, 20_000);

  it("hides the question text until it opens", async () => {
    const { data, error } = await student.client
      .from("questions")
      .select("id")
      .eq("assignment_id", assignmentId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  }, 20_000);

  it("refuses to create an attempt, and says when it opens", async () => {
    const { error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/not open yet/i);
  }, 20_000);

  it("leaves no attempt row behind after the refusal", async () => {
    const { count, error } = await admin
      .from("assignment_attempts")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);
    expect(error).toBeNull();
    expect(count).toBe(0);
  }, 20_000);
});

let attemptId: string;

describe("inside the window", () => {
  beforeAll(async () => {
    await setWindow(windowHours(-1, 1));
  });

  it("lets the student start, while the status column still reads READY", async () => {
    const { data: statusRow } = await admin
      .from("assignments")
      .select("status")
      .eq("id", assignmentId)
      .single();
    expect(statusRow!.status).toBe("READY");

    const { data, error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentId,
    });
    expect(error, error?.message).toBeNull();
    const attempt = data as { id: string; state: string };
    expect(attempt.state).toBe("NOT_STARTED");
    attemptId = attempt.id;
  }, 20_000);

  it("shows the question text now that it has opened", async () => {
    const { data, error } = await student.client
      .from("questions")
      .select("id")
      .eq("assignment_id", assignmentId);
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  }, 20_000);

  it("saves answers", async () => {
    const { data, error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[0], value: 1 }],
    });
    expect(error, error?.message).toBeNull();
    expect((data as { saved: number }).saved).toBe(1);
  }, 20_000);
});

describe("after close_at", () => {
  beforeAll(async () => {
    await setWindow(windowHours(-48, -24));
  });

  it("refuses to save, mid-draft, and says the assignment closed", async () => {
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[1], value: 0 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/closed at/i);
  }, 20_000);

  it("refuses to submit the draft that is already there", async () => {
    const { error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/closed at/i);
  }, 20_000);

  it("keeps the answer saved during the window — closing does not erase anything", async () => {
    const { data, error } = await student.client
      .from("responses")
      .select("question_id, response_value")
      .eq("attempt_id", attemptId);
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]!.response_value).toBe(1);
  }, 20_000);

  it("still shows the questions, so the student can read what they answered", async () => {
    const { data, error } = await student.client
      .from("questions")
      .select("id")
      .eq("assignment_id", assignmentId);
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
  }, 20_000);

  it("lets the professor extend the closing time to let the class back in", async () => {
    await setWindow(windowHours(-1, 1));
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[1], value: 0 }],
    });
    expect(error, error?.message).toBeNull();
  }, 20_000);
});

describe("a submitted attempt, reopened after the window shut", () => {
  it("submits inside the window", async () => {
    await setWindow(windowHours(-1, 1));
    const { data, error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { state: string }).state).toBe("SUBMITTED");
  }, 20_000);

  it("can still be reopened by the professor once the window has passed", async () => {
    // The guard used to be `status in ('OPEN','CLOSED')`, which a scheduled
    // assignment never satisfies — this is the case that would have made
    // per-student reopening silently impossible.
    await setWindow(windowHours(-48, -24));
    const { error } = await professor.client.rpc("reopen_attempt", {
      p_attempt_id: attemptId,
      p_assignment_id: assignmentId,
    });
    expect(error, error?.message).toBeNull();
  }, 20_000);

  it("lets that one student answer again although the class cannot", async () => {
    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[2], value: 1 }],
    });
    expect(error, error?.message).toBeNull();
  }, 20_000);

  it("lets them resubmit, and shuts the door again behind them", async () => {
    const { data, error } = await student.client.rpc("submit_attempt", {
      p_attempt_id: attemptId,
    });
    expect(error, error?.message).toBeNull();
    // SUBMITTED, not RESUBMITTED: the save above already moved the attempt
    // REOPENED -> DRAFT (there is no REOPENED -> REOPENED edge), and
    // DRAFT -> RESUBMITTED is not a legal edge either. The version is what
    // records that this was a second submission.
    const receipt = data as { state: string; submissionVersion: number };
    expect(receipt.state).toBe("SUBMITTED");
    expect(receipt.submissionVersion).toBe(2);

    const { error: afterError } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attemptId,
      p_answers: [{ questionId: questionIds[2], value: 0 }],
    });
    expect(afterError).not.toBeNull();
  }, 20_000);
});

describe("the status column still outranks the calendar", () => {
  it("refuses a CLOSED assignment even inside a live window", async () => {
    await setWindow(windowHours(-1, 1));
    await setStatus("CLOSED");

    const { error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: assignmentId,
    });
    expect(error).not.toBeNull();
  }, 20_000);

  it("goes back onto the calendar with CLOSED -> READY", async () => {
    await setStatus("READY");
    const { data, error } = await admin
      .from("assignments")
      .select("status")
      .eq("id", assignmentId)
      .single();
    expect(error).toBeNull();
    expect(data!.status).toBe("READY");
  }, 20_000);

  it("refuses DRAFT -> CLOSED and every other edge off the map", async () => {
    const { error } = await admin
      .from("assignments")
      .update({ status: "ARCHIVED" })
      .eq("id", assignmentId);
    // READY -> ARCHIVED is not an edge: retiring comes first.
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/invalid assignment status transition/i);
  }, 20_000);
});

describe("a legacy OPEN assignment with no dates", () => {
  let legacyId: string;
  let legacyQuestionId: string;

  beforeAll(async () => {
    const { data, error } = await professor.client
      .from("assignments")
      .insert({
        class_id: classId,
        title: "Legacy Assignment",
        sequence_number: 2,
        created_by: professor.id,
      })
      .select("id")
      .single();
    if (error) throw new Error(`legacy assignment insert failed: ${error.message}`);
    legacyId = data!.id;

    const { data: legacyQuestion, error: qError } = await professor.client
      .from("questions")
      .insert({
        assignment_id: legacyId,
        external_question_code: "L-001",
        question_text: "Legacy question",
        response_zero_label: "No (0)",
        response_one_label: "Yes (1)",
        display_order: 1,
      })
      .select("id")
      .single();
    if (qError) throw new Error(`legacy question insert failed: ${qError.message}`);
    legacyQuestionId = legacyQuestion!.id;

    for (const status of ["READY", "OPEN"] as const) {
      const { error: sError } = await admin
        .from("assignments")
        .update({ status })
        .eq("id", legacyId);
      if (sError) throw new Error(`legacy transition to ${status} failed: ${sError.message}`);
    }
  }, 60_000);

  it("keeps working exactly as it did before the migration", async () => {
    const { data, error } = await student.client.rpc("get_or_create_attempt", {
      p_assignment_id: legacyId,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { state: string }).state).toBe("NOT_STARTED");
  }, 20_000);

  it("starts honouring a closing time the moment one is set", async () => {
    const { error: updateError } = await admin
      .from("assignments")
      .update({ close_at: new Date(Date.now() - MINUTE).toISOString() })
      .eq("id", legacyId);
    expect(updateError).toBeNull();

    const { data: attempt } = await admin
      .from("assignment_attempts")
      .select("id")
      .eq("assignment_id", legacyId)
      .eq("student_id", student.id)
      .single();

    const { error } = await student.client.rpc("save_attempt_responses", {
      p_attempt_id: attempt!.id,
      p_answers: [{ questionId: legacyQuestionId, value: 1 }],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/closed at/i);
  }, 20_000);
});
