// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { adminClient, cleanupTestData, createTestUser, loadEnv, type TestUser } from "./helpers";

/**
 * A TEACHING ASSISTANT IS A MEMBERSHIP OF ONE CLASS.
 *
 * Migrations 0027/0028 give `class_members.member_role = 'TA'` the same
 * authority over a class's CONTENT that its professor has, and withhold
 * exactly two things: the class itself (archive / restore / delete /
 * reassign) and the class's other TAs.
 *
 * Every assertion below goes through the client library the app uses, as a
 * really signed-in user, so it exercises grants, policies, triggers and
 * RPCs exactly as production does. Hiding a button is not tested here and
 * would not be evidence of anything: the question this file asks is what
 * the DATABASE does when the request arrives anyway.
 *
 * The shape is a 2x2: {TA of class X, professor of class X} against
 * {class X, class Y}. A TA must be indistinguishable from the professor in
 * the first column except on the two exclusions, and indistinguishable
 * from a stranger in the second.
 */

const env = loadEnv();
const admin = adminClient(env);

let professorX: TestUser;
let professorY: TestUser;
let ta: TestUser;
let secondTa: TestUser;
let student: TestUser;

let classX: string;
let classY: string;

const classIds: string[] = [];
const userIds: string[] = [];
const rosterEmails: string[] = [];

interface Assignment {
  id: string;
  questionIds: string[];
}

let assignmentX: Assignment;
let assignmentY: Assignment;
let studentAttemptId: string;

let sequence = 0;

async function createAssignment(
  owner: TestUser,
  classId: string,
  title: string
): Promise<Assignment> {
  const { data: a, error: aError } = await owner.client
    .from("assignments")
    .insert({
      class_id: classId,
      title,
      sequence_number: ++sequence,
      created_by: owner.id,
    })
    .select("id")
    .single();
  if (aError) throw new Error(`assignment insert failed: ${aError.message}`);

  const { data: qs, error: qError } = await owner.client
    .from("questions")
    .insert(
      [1, 2].map((n) => ({
        assignment_id: a!.id,
        external_question_code: `TA-${sequence}-${n}`,
        question_text: `TA scope question ${n}`,
        response_zero_label: "No (0)",
        response_one_label: "Yes (1)",
        display_order: n,
      }))
    )
    .select("id, display_order");
  if (qError) throw new Error(`question insert failed: ${qError.message}`);

  for (const status of ["READY", "OPEN"] as const) {
    const { error } = await owner.client
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

/** Open, answer and submit — a real attempt, through the real RPCs. */
async function submitAttempt(who: TestUser, assignment: Assignment): Promise<string> {
  const { data, error } = await who.client.rpc("get_or_create_attempt", {
    p_assignment_id: assignment.id,
  });
  if (error) throw new Error(`attempt open failed: ${error.message}`);
  const attemptId = (data as { id: string }).id;

  const { error: saveError } = await who.client.rpc("save_attempt_responses", {
    p_attempt_id: attemptId,
    p_answers: [{ questionId: assignment.questionIds[0], value: 1 }],
  });
  if (saveError) throw new Error(`save failed: ${saveError.message}`);

  const { error: submitError } = await who.client.rpc("submit_attempt", {
    p_attempt_id: attemptId,
  });
  if (submitError) throw new Error(`submit failed: ${submitError.message}`);

  return attemptId;
}

async function createClassFor(owner: TestUser, name: string): Promise<string> {
  const { data, error } = await owner.client
    .from("classes")
    .insert({
      professor_id: owner.id,
      name,
      class_code: `TA${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (error) throw new Error(`class insert failed: ${error.message}`);
  classIds.push(data!.id);
  return data!.id;
}

async function classStatus(classId: string): Promise<string> {
  const { data, error } = await admin
    .from("classes")
    .select("status")
    .eq("id", classId)
    .single();
  if (error) throw new Error(`class status fetch failed: ${error.message}`);
  return data!.status as string;
}

async function memberRoleOf(classId: string, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("class_members")
    .select("member_role")
    .eq("class_id", classId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.member_role as string) ?? null;
}

beforeAll(async () => {
  professorX = await createTestUser(env, admin, "PROFESSOR", "TA Scope Professor X");
  userIds.push(professorX.id);
  professorY = await createTestUser(env, admin, "PROFESSOR", "TA Scope Professor Y");
  userIds.push(professorY.id);
  // The TA's GLOBAL role is STUDENT on purpose: TA-ness must come from the
  // class_members row alone. If any of the assertions below passed because
  // of profiles.role, this account would fail them.
  ta = await createTestUser(env, admin, "STUDENT", "TA Scope Assistant");
  userIds.push(ta.id);
  secondTa = await createTestUser(env, admin, "STUDENT", "TA Scope Second Assistant");
  userIds.push(secondTa.id);
  student = await createTestUser(env, admin, "STUDENT", "TA Scope Student");
  userIds.push(student.id);

  classX = await createClassFor(professorX, "TA Scope Class X");
  classY = await createClassFor(professorY, "TA Scope Class Y");

  const { error: memberError } = await admin.from("class_members").insert([
    { class_id: classX, user_id: ta.id, member_role: "TA", status: "ACTIVE" },
    { class_id: classX, user_id: secondTa.id, member_role: "TA", status: "ACTIVE" },
    { class_id: classX, user_id: student.id, member_role: "STUDENT", status: "ACTIVE" },
    { class_id: classY, user_id: student.id, member_role: "STUDENT", status: "ACTIVE" },
  ]);
  if (memberError) throw new Error(`membership setup failed: ${memberError.message}`);

  assignmentX = await createAssignment(professorX, classX, "TA Scope Assignment X");
  assignmentY = await createAssignment(professorY, classY, "TA Scope Assignment Y");

  // One real submission on X, so the TA has something to read and reopen.
  studentAttemptId = await submitAttempt(student, assignmentX);
}, 240_000);

afterAll(async () => {
  if (rosterEmails.length > 0) {
    await admin.from("roster_entries").delete().in("email", rosterEmails);
  }
  await cleanupTestData(admin, { classIds, userIds });
}, 180_000);

// ============================================================
describe("a TA of class X can do what its professor can", () => {
  it("reads the class, its roster and its assignments", async () => {
    const { data: classRow } = await ta.client
      .from("classes")
      .select("id, name")
      .eq("id", classX)
      .maybeSingle();
    expect(classRow?.id, "the class itself is readable").toBe(classX);

    const { data: members } = await ta.client
      .from("class_members")
      .select("user_id, member_role")
      .eq("class_id", classX);
    expect(
      (members ?? []).some((m) => m.user_id === student.id),
      "the student roster is readable"
    ).toBe(true);

    const { data: assignments } = await ta.client
      .from("assignments")
      .select("id")
      .eq("class_id", classX);
    expect((assignments ?? []).map((a) => a.id)).toContain(assignmentX.id);
  }, 30_000);

  it("reads the student profiles behind that roster", async () => {
    const { data } = await ta.client
      .from("profiles")
      .select("id, email")
      .eq("id", student.id)
      .maybeSingle();
    expect(data?.id, "a TA must be able to name the students they mark").toBe(student.id);
  }, 30_000);

  it("reads submitted attempts and responses", async () => {
    const { data: attempts } = await ta.client
      .from("assignment_attempts")
      .select("id, state")
      .eq("assignment_id", assignmentX.id);
    expect((attempts ?? []).map((a) => a.id)).toContain(studentAttemptId);

    const { data: responses } = await ta.client
      .from("responses")
      .select("id")
      .eq("assignment_id", assignmentX.id);
    expect((responses ?? []).length).toBeGreaterThan(0);
  }, 30_000);

  /**
   * The app's own checks (analytics pages, the three export routes, the
   * assignment and query-builder actions) no longer compare
   * classes.professor_id to the caller — they call THIS. So the answer it
   * gives is the answer the UI gives, and there is one rule in the system
   * rather than a policy and a copy of it in TypeScript.
   */
  it("answers can_manage_class_content for the app's own checks", async () => {
    const mine = await ta.client.rpc("can_manage_class_content", { p_class_id: classX });
    expect(mine.error, mine.error?.message).toBeNull();
    expect(mine.data).toBe(true);

    const theirs = await ta.client.rpc("can_manage_class_content", { p_class_id: classY });
    expect(theirs.error, theirs.error?.message).toBeNull();
    expect(theirs.data, "and false for a class they have nothing to do with").toBe(false);

    const asStudent = await student.client.rpc("can_manage_class_content", {
      p_class_id: classX,
    });
    expect(asStudent.data, "being enrolled is not managing").toBe(false);

    const asProfessor = await professorX.client.rpc("can_manage_class_content", {
      p_class_id: classX,
    });
    expect(asProfessor.data).toBe(true);
  }, 30_000);

  it("reads the analytics views for the class", async () => {
    const { data, error } = await ta.client
      .from("question_response_summary")
      .select("assignment_id")
      .eq("assignment_id", assignmentX.id);
    expect(error, error?.message).toBeNull();
    expect((data ?? []).length, "single-assignment aggregates are visible").toBeGreaterThan(0);
  }, 30_000);

  it("creates, edits and publishes an assignment", async () => {
    const { data: created, error } = await ta.client
      .from("assignments")
      .insert({
        class_id: classX,
        title: "Made by the assistant",
        sequence_number: ++sequence,
        created_by: ta.id,
      })
      .select("id")
      .single();
    expect(error, error?.message).toBeNull();

    const { error: editError } = await ta.client
      .from("assignments")
      .update({ title: "Renamed by the assistant" })
      .eq("id", created!.id);
    expect(editError, editError?.message).toBeNull();

    const { error: questionError } = await ta.client.from("questions").insert({
      assignment_id: created!.id,
      external_question_code: `TA-NEW-${sequence}`,
      question_text: "Added by the assistant",
      response_zero_label: "No (0)",
      response_one_label: "Yes (1)",
      display_order: 1,
    });
    expect(questionError, questionError?.message).toBeNull();

    for (const status of ["READY", "OPEN", "CLOSED"] as const) {
      const { error: transitionError } = await ta.client
        .from("assignments")
        .update({ status })
        .eq("id", created!.id);
      expect(transitionError, `transition to ${status}: ${transitionError?.message}`).toBeNull();
    }
  }, 60_000);

  it("archives, unarchives and deletes an ASSIGNMENT — only the CLASS is protected", async () => {
    const disposable = await createAssignment(ta, classX, "Assistant's disposable assignment");

    for (const status of ["CLOSED", "ARCHIVED"] as const) {
      const { error } = await ta.client
        .from("assignments")
        .update({ status })
        .eq("id", disposable.id);
      expect(error, `transition to ${status}: ${error?.message}`).toBeNull();
    }

    const { error: unarchiveError } = await ta.client.rpc("unarchive_assignment", {
      p_assignment_id: disposable.id,
    });
    expect(unarchiveError, unarchiveError?.message).toBeNull();

    const { data: counts, error: countsError } = await ta.client.rpc(
      "assignment_deletion_counts",
      { p_assignment_id: disposable.id }
    );
    expect(countsError, countsError?.message).toBeNull();
    expect(counts, "NULL from this RPC means no access").not.toBeNull();

    const { error: deleteError } = await ta.client.rpc("delete_assignment_permanently", {
      p_assignment_id: disposable.id,
    });
    expect(deleteError, deleteError?.message).toBeNull();

    const { data: gone } = await admin
      .from("assignments")
      .select("id")
      .eq("id", disposable.id)
      .maybeSingle();
    expect(gone).toBeNull();
  }, 90_000);

  it("duplicates an assignment", async () => {
    const { data, error } = await ta.client.rpc("duplicate_assignment", {
      p_assignment_id: assignmentX.id,
    });
    expect(error, error?.message).toBeNull();
    expect(typeof data).toBe("string");
  }, 30_000);

  it("reopens one attempt", async () => {
    const { error } = await ta.client.rpc("reopen_attempt", {
      p_attempt_id: studentAttemptId,
      p_assignment_id: assignmentX.id,
    });
    expect(error, error?.message).toBeNull();

    const { data } = await admin
      .from("assignment_attempts")
      .select("state, reopened_by")
      .eq("id", studentAttemptId)
      .single();
    expect(data!.state).toBe("REOPENED");
    expect(data!.reopened_by, "the assistant is on the record as the one who did it").toBe(ta.id);
  }, 30_000);

  it("reopens every attempt on an assignment", async () => {
    // SUBMITTED -> REOPENED is the only reopenable edge (0024), and
    // assignmentX's one attempt is already spent by the test above — so
    // this needs its own assignment with its own fresh submission.
    const bulk = await createAssignment(ta, classX, "Assistant's bulk-reopen assignment");
    await submitAttempt(student, bulk);

    const { data, error } = await ta.client.rpc("reopen_assignment_attempts", {
      p_assignment_id: bulk.id,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { reopened: number }).reopened).toBe(1);
  }, 60_000);

  it("runs the roster import path end to end", async () => {
    const email = `it-ta-import-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    rosterEmails.push(email);

    const { data: checked, error: checkError } = await ta.client.rpc("check_roster_emails", {
      p_class_id: classX,
      p_emails: [email],
    });
    expect(checkError, checkError?.message).toBeNull();
    expect((checked as unknown[]).length).toBe(1);

    const { data, error } = await ta.client.rpc("commit_roster_import", {
      p_class_id: classX,
      p_source_filename: "assistant-roster.csv",
      p_source_checksum: randomUUID(),
      p_new_roster_rows: [
        { rowNumber: 1, email, fullName: "Imported By Assistant", rollNumber: "TA-001" },
      ],
      p_existing_member_rows: [],
      p_rejected_rows: [],
    });
    expect(error, error?.message).toBeNull();
    expect((data as { imported: number }).imported).toBe(1);
  }, 60_000);

  it("edits the class's details — the fields that are not its status", async () => {
    const { error } = await ta.client
      .from("classes")
      .update({ course_name: "Renamed by the assistant" })
      .eq("id", classX);
    expect(error, error?.message).toBeNull();

    const { data } = await admin
      .from("classes")
      .select("course_name")
      .eq("id", classX)
      .single();
    expect(data!.course_name).toBe("Renamed by the assistant");
  }, 30_000);

  it("deactivates and reactivates a student of the class", async () => {
    const { error } = await ta.client.rpc("set_student_active", {
      p_class_id: classX,
      p_profile_id: student.id,
      p_is_active: false,
    });
    expect(error, error?.message).toBeNull();

    const { error: restoreError } = await ta.client.rpc("set_student_active", {
      p_class_id: classX,
      p_profile_id: student.id,
      p_is_active: true,
    });
    expect(restoreError, restoreError?.message).toBeNull();
  }, 30_000);

  it("saves a query scoped to the class", async () => {
    const { error } = await ta.client.from("saved_queries").insert({
      class_id: classX,
      created_by: ta.id,
      name: "Assistant's saved query",
      definition: { kind: "test" },
    });
    expect(error, error?.message).toBeNull();
  }, 30_000);
});

// ============================================================
describe("EXCLUSION 1 — the class itself is the professor's alone", () => {
  it("refuses to archive the class", async () => {
    const before = await classStatus(classX);
    const { error } = await ta.client
      .from("classes")
      .update({ status: "ARCHIVED" })
      .eq("id", classX);

    expect(error, "archiving a class must be refused at the database").not.toBeNull();
    expect(await classStatus(classX), "and the status must not have moved").toBe(before);
  }, 30_000);

  it("refuses to unarchive the class", async () => {
    // Archive it as the professor first, so the refusal below is about the
    // TA and not about the transition being a no-op.
    const { error: professorError } = await professorX.client
      .from("classes")
      .update({ status: "ARCHIVED" })
      .eq("id", classX);
    expect(professorError, "the professor can archive their own class").toBeNull();
    expect(await classStatus(classX)).toBe("ARCHIVED");

    const { error } = await ta.client
      .from("classes")
      .update({ status: "ACTIVE" })
      .eq("id", classX);
    expect(error, "restoring a class must be refused too").not.toBeNull();
    expect(await classStatus(classX)).toBe("ARCHIVED");

    const { error: restoreError } = await professorX.client
      .from("classes")
      .update({ status: "ACTIVE" })
      .eq("id", classX);
    expect(restoreError, restoreError?.message).toBeNull();
  }, 60_000);

  it("refuses to reassign the class to itself", async () => {
    const { error } = await ta.client
      .from("classes")
      .update({ professor_id: ta.id })
      .eq("id", classX);
    expect(error, "taking ownership of the class must be refused").not.toBeNull();

    const { data } = await admin
      .from("classes")
      .select("professor_id")
      .eq("id", classX)
      .single();
    expect(data!.professor_id).toBe(professorX.id);
  }, 30_000);

  it("cannot call class_deletion_counts — the preview a delete starts from", async () => {
    const { data, error } = await ta.client.rpc("class_deletion_counts", {
      p_class_id: classX,
    });
    // The RPC returns NULL rather than raising when the caller has no
    // access; either way it must not hand back a census.
    expect(error ? true : data === null, "a TA must not see the class's deletion census").toBe(
      true
    );
  }, 30_000);

  it("cannot call delete_class_permanently, and the class survives", async () => {
    const { error } = await ta.client.rpc("delete_class_permanently", {
      p_class_id: classX,
    });
    expect(error, "deleting a class must raise for a TA").not.toBeNull();

    const { data } = await admin.from("classes").select("id").eq("id", classX).maybeSingle();
    expect(data?.id, "the class is still there").toBe(classX);
  }, 30_000);

  it("cannot delete the class row directly either", async () => {
    const { error } = await ta.client.from("classes").delete().eq("id", classX);
    const { data } = await admin.from("classes").select("id").eq("id", classX).maybeSingle();
    expect(
      error !== null || data?.id === classX,
      "a direct DELETE must either raise or match no rows"
    ).toBe(true);
    expect(data?.id).toBe(classX);
  }, 30_000);
});

// ============================================================
describe("EXCLUSION 2 — a TA cannot manage other TAs", () => {
  it("cannot add a TA through the RPC", async () => {
    const email = `it-ta-added-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    rosterEmails.push(email);

    const { error } = await ta.client.rpc("add_class_ta", {
      p_class_id: classX,
      p_email: email,
      p_full_name: "Should Never Exist",
    });
    expect(error, "adding a TA is professor-only").not.toBeNull();

    const { data } = await admin
      .from("roster_entries")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(data, "and nothing was written").toBeNull();
  }, 30_000);

  it("cannot remove another TA through the RPC", async () => {
    const { error } = await ta.client.rpc("remove_class_ta", {
      p_class_id: classX,
      p_email: secondTa.email,
    });
    expect(error, "removing a TA is professor-only").not.toBeNull();
    expect(await memberRoleOf(classX, secondTa.id)).toBe("TA");
  }, 30_000);

  it("cannot insert a TA class_members row directly", async () => {
    const outsider = await createTestUser(env, admin, "STUDENT", "TA Scope Outsider");
    userIds.push(outsider.id);

    const { error } = await ta.client.from("class_members").insert({
      class_id: classX,
      user_id: outsider.id,
      member_role: "TA",
      status: "ACTIVE",
    });
    expect(error, "the WITH CHECK on class_members must refuse a TA row").not.toBeNull();
    expect(await memberRoleOf(classX, outsider.id)).toBeNull();
  }, 60_000);

  it("cannot promote a student of the class to TA", async () => {
    const { error } = await ta.client
      .from("class_members")
      .update({ member_role: "TA" })
      .eq("class_id", classX)
      .eq("user_id", student.id);
    const role = await memberRoleOf(classX, student.id);
    expect(
      error !== null || role === "STUDENT",
      "promotion must either raise or write nothing"
    ).toBe(true);
    expect(role).toBe("STUDENT");
  }, 30_000);

  it("cannot demote another TA to student", async () => {
    const { error } = await ta.client
      .from("class_members")
      .update({ member_role: "STUDENT" })
      .eq("class_id", classX)
      .eq("user_id", secondTa.id);
    const role = await memberRoleOf(classX, secondTa.id);
    expect(error !== null || role === "TA", "demotion must either raise or write nothing").toBe(
      true
    );
    expect(role).toBe("TA");
  }, 30_000);

  it("cannot delete another TA's membership", async () => {
    await ta.client
      .from("class_members")
      .delete()
      .eq("class_id", classX)
      .eq("user_id", secondTa.id);
    expect(
      await memberRoleOf(classX, secondTa.id),
      "the other assistant is still an assistant"
    ).toBe("TA");
  }, 30_000);

  it("cannot promote a PENDING student roster row into a pending TA", async () => {
    // The subtle door: the row is a student's, so USING admits it. Only
    // the WITH CHECK half of roster_entries_ta_manage_students refuses
    // what it would become.
    const email = `it-ta-promote-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    rosterEmails.push(email);

    const { error: seedError } = await admin.from("roster_entries").insert({
      email,
      intended_role: "STUDENT",
      class_id: classX,
      full_name: "Pending Student",
    });
    expect(seedError, seedError?.message).toBeNull();

    const { error } = await ta.client
      .from("roster_entries")
      .update({ intended_role: "TA" })
      .eq("email", email);

    const { data: row } = await admin
      .from("roster_entries")
      .select("intended_role")
      .eq("email", email)
      .single();
    expect(
      error !== null || row!.intended_role === "STUDENT",
      "promoting a pending row must either raise or write nothing"
    ).toBe(true);
    expect(row!.intended_role).toBe("STUDENT");
  }, 30_000);

  it("cannot rewrite its own global profiles.role", async () => {
    await ta.client.from("profiles").update({ role: "PROFESSOR" }).eq("id", ta.id);

    const { data } = await admin.from("profiles").select("role").eq("id", ta.id).single();
    expect(data!.role, "profiles is read-only for a TA").toBe("STUDENT");
  }, 30_000);

  it("cannot pre-authorise a TA through roster_entries", async () => {
    const email = `it-ta-roster-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    rosterEmails.push(email);

    const { error } = await ta.client.from("roster_entries").insert({
      email,
      intended_role: "TA",
      class_id: classX,
      full_name: "Should Never Exist",
    });
    expect(error, "a pending TA is still a TA").not.toBeNull();

    const { data } = await admin
      .from("roster_entries")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    expect(data).toBeNull();
  }, 30_000);

  it("cannot deactivate another TA's account through set_student_active", async () => {
    const { error } = await ta.client.rpc("set_student_active", {
      p_class_id: classX,
      p_profile_id: secondTa.id,
      p_is_active: false,
    });
    expect(error, "is_active is global — a TA must not flip another TA's").not.toBeNull();

    const { data } = await admin
      .from("profiles")
      .select("is_active")
      .eq("id", secondTa.id)
      .single();
    expect(data!.is_active).toBe(true);
  }, 30_000);
});

// ============================================================
describe("a TA of class X has no elevated access to class Y", () => {
  it("cannot read class Y", async () => {
    const { data } = await ta.client
      .from("classes")
      .select("id")
      .eq("id", classY)
      .maybeSingle();
    expect(data).toBeNull();
  }, 30_000);

  it("cannot read class Y's assignments, attempts or responses", async () => {
    const { data: assignments } = await ta.client
      .from("assignments")
      .select("id")
      .eq("class_id", classY);
    expect(assignments ?? []).toHaveLength(0);

    const { data: attempts } = await ta.client
      .from("assignment_attempts")
      .select("id")
      .eq("assignment_id", assignmentY.id);
    expect(attempts ?? []).toHaveLength(0);

    const { data: responses } = await ta.client
      .from("responses")
      .select("id")
      .eq("assignment_id", assignmentY.id);
    expect(responses ?? []).toHaveLength(0);
  }, 30_000);

  it("cannot read class Y's roster", async () => {
    const { data } = await ta.client
      .from("class_members")
      .select("user_id")
      .eq("class_id", classY);
    expect(data ?? []).toHaveLength(0);
  }, 30_000);

  it("cannot write into class Y", async () => {
    const { error } = await ta.client.from("assignments").insert({
      class_id: classY,
      title: "Trespass",
      sequence_number: 99,
      created_by: ta.id,
    });
    expect(error, "creating an assignment in another class must be refused").not.toBeNull();

    const { error: editError } = await ta.client
      .from("classes")
      .update({ course_name: "Trespass" })
      .eq("id", classY);
    const { data: unchanged } = await admin
      .from("classes")
      .select("course_name")
      .eq("id", classY)
      .single();
    expect(
      editError !== null || unchanged!.course_name === null,
      "editing another class must either raise or write nothing"
    ).toBe(true);
  }, 30_000);

  it("cannot reopen, import into, or delete anything in class Y", async () => {
    const { error: reopenError } = await ta.client.rpc("reopen_assignment_attempts", {
      p_assignment_id: assignmentY.id,
    });
    expect(reopenError).not.toBeNull();

    const { error: rosterError } = await ta.client.rpc("check_roster_emails", {
      p_class_id: classY,
      p_emails: ["nobody@integration-test.invalid"],
    });
    expect(rosterError).not.toBeNull();

    const { error: deleteError } = await ta.client.rpc("delete_assignment_permanently", {
      p_assignment_id: assignmentY.id,
    });
    expect(deleteError).not.toBeNull();

    const { data: stillThere } = await admin
      .from("assignments")
      .select("id")
      .eq("id", assignmentY.id)
      .maybeSingle();
    expect(stillThere?.id).toBe(assignmentY.id);
  }, 60_000);

  it("cannot save a query scoped to class Y", async () => {
    const { error } = await ta.client.from("saved_queries").insert({
      class_id: classY,
      created_by: ta.id,
      name: "Trespass",
      definition: { kind: "test" },
    });
    expect(error).not.toBeNull();
  }, 30_000);
});

// ============================================================
describe("the professor's own authority is unchanged", () => {
  it("adds a TA who already has an account, without touching their global role", async () => {
    const colleague = await createTestUser(env, admin, "PROFESSOR", "TA Scope Colleague");
    userIds.push(colleague.id);

    const { data, error } = await professorX.client.rpc("add_class_ta", {
      p_class_id: classX,
      p_email: colleague.email,
      p_full_name: null,
    });
    expect(error, error?.message).toBeNull();
    expect((data as { mode: string }).mode).toBe("ENROLLED");
    expect(await memberRoleOf(classX, colleague.id)).toBe("TA");

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", colleague.id)
      .single();
    expect(profile!.role, "a professor stays a professor everywhere else").toBe("PROFESSOR");

    const { error: removeError } = await professorX.client.rpc("remove_class_ta", {
      p_class_id: classX,
      p_email: colleague.email,
    });
    expect(removeError, removeError?.message).toBeNull();
    expect(await memberRoleOf(classX, colleague.id)).toBeNull();
  }, 90_000);

  it("pre-authorises a TA who has never signed in", async () => {
    const email = `it-ta-pending-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    rosterEmails.push(email);

    const { data, error } = await professorX.client.rpc("add_class_ta", {
      p_class_id: classX,
      p_email: email,
      p_full_name: "Future Assistant",
    });
    expect(error, error?.message).toBeNull();
    expect((data as { mode: string }).mode).toBe("PREAUTHORISED");

    const { data: entry } = await admin
      .from("roster_entries")
      .select("intended_role, class_id, provisioned")
      .eq("email", email)
      .single();
    expect(entry!.intended_role).toBe("TA");
    expect(entry!.class_id).toBe(classX);
    expect(entry!.provisioned).toBe(false);
  }, 60_000);

  /**
   * The one reason roster_entries.intended_role — and therefore
   * profiles.role — needed a 'TA' value at all: a person invited as an
   * assistant before they have ever signed in has no profiles row for a
   * class_members row to point at. This is that path, driven through the
   * real auth trigger.
   *
   * The email has to be on the configured allowed_email_domain or
   * handle_new_user returns without provisioning anyone — that domain
   * check is the first gate, and it is not what this test is about.
   */
  it("provisions a pre-authorised TA correctly at their first sign-in", async () => {
    const { data: domainRow } = await admin
      .from("app_config")
      .select("value")
      .eq("key", "allowed_email_domain")
      .maybeSingle();
    const domain = (domainRow?.value as string | undefined) ?? "integration-test.invalid";

    const email = `it-ta-firstlogin-${randomUUID().slice(0, 8)}@${domain}`;
    rosterEmails.push(email);

    const { error: inviteError } = await professorX.client.rpc("add_class_ta", {
      p_class_id: classX,
      p_email: email,
      p_full_name: "First Login Assistant",
    });
    expect(inviteError, inviteError?.message).toBeNull();

    // No helper here: the point is that handle_new_user creates the
    // profile, not the test.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: `It-${randomUUID()}`,
      email_confirm: true,
    });
    expect(createError, createError?.message).toBeNull();
    const newUserId = created.user!.id;
    userIds.push(newUserId);

    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", newUserId)
      .maybeSingle();
    expect(profile?.role, "the trigger copies intended_role into profiles.role").toBe("TA");

    expect(
      await memberRoleOf(classX, newUserId),
      "and into the class_members row that actually carries the authority"
    ).toBe("TA");

    const { data: entry } = await admin
      .from("roster_entries")
      .select("provisioned")
      .eq("email", email)
      .single();
    expect(entry!.provisioned, "the pre-authorisation is spent").toBe(true);
  }, 90_000);

  it("refuses a professor trying to add a TA to somebody else's class", async () => {
    const email = `it-ta-foreign-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    rosterEmails.push(email);

    const { error } = await professorY.client.rpc("add_class_ta", {
      p_class_id: classX,
      p_email: email,
      p_full_name: null,
    });
    expect(error).not.toBeNull();
  }, 30_000);

  it("still archives and restores its own class", async () => {
    const { error: archiveError } = await professorX.client
      .from("classes")
      .update({ status: "ARCHIVED" })
      .eq("id", classX);
    expect(archiveError, archiveError?.message).toBeNull();
    expect(await classStatus(classX)).toBe("ARCHIVED");

    const { error: restoreError } = await professorX.client
      .from("classes")
      .update({ status: "ACTIVE" })
      .eq("id", classX);
    expect(restoreError, restoreError?.message).toBeNull();
    expect(await classStatus(classX)).toBe("ACTIVE");
  }, 30_000);
});

// ============================================================
describe("no student gained anything in this pass", () => {
  it("still cannot read another student's responses", async () => {
    const other = await createTestUser(env, admin, "STUDENT", "TA Scope Other Student");
    userIds.push(other.id);
    const { error: enrolError } = await admin
      .from("class_members")
      .insert({ class_id: classX, user_id: other.id, member_role: "STUDENT", status: "ACTIVE" });
    expect(enrolError, enrolError?.message).toBeNull();

    const { data } = await other.client
      .from("responses")
      .select("id")
      .eq("student_id", student.id);
    expect(data ?? [], "a classmate's answers stay invisible").toHaveLength(0);
  }, 60_000);

  it("still cannot read the class roster or its attempts", async () => {
    const { data: members } = await student.client
      .from("class_members")
      .select("user_id")
      .eq("class_id", classX);
    expect(
      (members ?? []).every((m) => m.user_id === student.id),
      "a student sees only their own membership row"
    ).toBe(true);

    const { data: attempts } = await student.client
      .from("assignment_attempts")
      .select("student_id")
      .eq("assignment_id", assignmentX.id);
    expect(
      (attempts ?? []).every((a) => a.student_id === student.id),
      "and only their own attempt"
    ).toBe(true);
  }, 30_000);

  it("still cannot manage the class's content", async () => {
    const { error: assignmentError } = await student.client.from("assignments").insert({
      class_id: classX,
      title: "Student-made",
      sequence_number: 98,
      created_by: student.id,
    });
    expect(assignmentError).not.toBeNull();

    const { error: rosterError } = await student.client.rpc("check_roster_emails", {
      p_class_id: classX,
      p_emails: ["nobody@integration-test.invalid"],
    });
    expect(rosterError).not.toBeNull();

    const { error: reopenError } = await student.client.rpc("reopen_assignment_attempts", {
      p_assignment_id: assignmentX.id,
    });
    expect(reopenError).not.toBeNull();

    const { error: activeError } = await student.client.rpc("set_student_active", {
      p_class_id: classX,
      p_profile_id: student.id,
      p_is_active: false,
    });
    expect(activeError, "a student cannot even deactivate themselves").not.toBeNull();
  }, 60_000);

  it("still cannot become a TA, or edit the class", async () => {
    const { error: promoteError } = await student.client
      .from("class_members")
      .update({ member_role: "TA" })
      .eq("class_id", classX)
      .eq("user_id", student.id);
    expect(
      promoteError !== null || (await memberRoleOf(classX, student.id)) === "STUDENT"
    ).toBe(true);
    expect(await memberRoleOf(classX, student.id)).toBe("STUDENT");

    const { error: taRpcError } = await student.client.rpc("add_class_ta", {
      p_class_id: classX,
      p_email: student.email,
      p_full_name: null,
    });
    expect(taRpcError).not.toBeNull();

    const before = await classStatus(classX);
    await student.client.from("classes").update({ status: "ARCHIVED" }).eq("id", classX);
    expect(await classStatus(classX)).toBe(before);
  }, 60_000);
});
