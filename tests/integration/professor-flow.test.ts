// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { parseGridWorkbook } from "@/lib/imports/parse-grid";

/**
 * Real integration tests against a live Supabase instance (local stack or
 * the project database — whatever the env points at). They cover the two
 * Phase 4 acceptance requirements:
 *
 *  1. A logged-in PROFESSOR can create a class through RLS (regression
 *     guard for the 42P17 recursion / missing-GRANT outages that blocked
 *     class creation).
 *  2. A real spreadsheet imports end-to-end, and a malformed row makes the
 *     import fail loudly and atomically — never a silent partial import.
 *
 * Env resolution: SUPABASE_TEST_URL / SUPABASE_TEST_ANON_KEY /
 * SUPABASE_TEST_SERVICE_ROLE_KEY first, then .env.local. All data created
 * here is deleted in afterAll.
 */

function loadEnv(): { url: string; anonKey: string; serviceKey: string } {
  const fromProcess = {
    url: process.env.SUPABASE_TEST_URL,
    anonKey: process.env.SUPABASE_TEST_ANON_KEY,
    serviceKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
  };
  if (fromProcess.url && fromProcess.anonKey && fromProcess.serviceKey) {
    return fromProcess as { url: string; anonKey: string; serviceKey: string };
  }

  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) {
    throw new Error(
      "Integration tests need SUPABASE_TEST_URL/SUPABASE_TEST_ANON_KEY/" +
        "SUPABASE_TEST_SERVICE_ROLE_KEY or a .env.local file."
    );
  }
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    const [, key, value] = m ?? [];
    if (key) parsed[key] = (value ?? "").trim();
  }
  const url = parsed.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(".env.local is missing the Supabase URL or keys.");
  }
  return { url, anonKey, serviceKey };
}

const { url, anonKey, serviceKey } = loadEnv();

const admin: SupabaseClient = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const professorEmail = `it-professor-${randomUUID().slice(0, 8)}@integration-test.invalid`;
const professorPassword = `It-${randomUUID()}`;
let professor: SupabaseClient;
let professorId: string;

const studentIds: string[] = [];
const classIds: string[] = [];

function loadXlsx(path: string): ArrayBuffer {
  const buf = readFileSync(resolve(path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function checksumOf(buffer: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(buffer)).digest("hex");
}

async function createProfessorUser() {
  const { data, error } = await admin.auth.admin.createUser({
    email: professorEmail,
    password: professorPassword,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create test professor: ${error.message}`);
  professorId = data.user.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: professorId,
    email: professorEmail,
    full_name: "Integration Test Professor",
    role: "PROFESSOR",
    is_active: true,
  });
  if (profileError) throw new Error(`could not create professor profile: ${profileError.message}`);

  professor = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await professor.auth.signInWithPassword({
    email: professorEmail,
    password: professorPassword,
  });
  if (signInError) throw new Error(`professor sign-in failed: ${signInError.message}`);
}

beforeAll(async () => {
  await createProfessorUser();

  // Fail fast with a clear message if migration 0009 hasn't been applied to
  // the target database — a missing RPC otherwise surfaces as confusing
  // per-test failures.
  const { error } = await admin.rpc("commit_assignment_import", {
    p_assignment_id: randomUUID(),
    p_source_filename: "probe",
    p_source_checksum: "probe",
    p_source_worksheet: null,
    p_questions: [],
  });
  if (error && /could not find|does not exist|schema cache/i.test(error.message)) {
    throw new Error(
      "commit_assignment_import is missing on the target database — apply migration " +
        "0009 (npm run db:migrate) before running the integration tests."
    );
  }
}, 60_000);

afterAll(async () => {
  const failures: string[] = [];
  const step = async (
    label: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>
  ) => {
    const { error } = await fn();
    if (error) failures.push(`${label}: ${error.message}`);
  };

  // Responses must go first: the questions_immutable_after_responses
  // trigger (0009) blocks the questions cascade of a class delete while
  // any response exists — hard-deleting response-bearing data is supposed
  // to be impossible, so the cleanup removes the responses explicitly.
  if (studentIds.length > 0) {
    await step("responses", () => admin.from("responses").delete().in("student_id", studentIds));
    await step("attempts", () =>
      admin.from("assignment_attempts").delete().in("student_id", studentIds)
    );
  }
  for (const classId of classIds) {
    // Cascades take members, assignments, questions, and imports with it.
    await step(`class ${classId}`, () => admin.from("classes").delete().eq("id", classId));
  }
  const actorIds = [professorId, ...studentIds].filter(Boolean);
  if (actorIds.length > 0) {
    await step("audit_logs", () => admin.from("audit_logs").delete().in("actor_id", actorIds));
    await step("class_members", () =>
      admin.from("class_members").delete().in("user_id", actorIds)
    );
    await step("profiles", () => admin.from("profiles").delete().in("id", actorIds));
    for (const id of actorIds) {
      await step(`auth user ${id}`, () => admin.auth.admin.deleteUser(id));
    }
  }

  // Loud, not silent: leftover test data on a shared database is a bug.
  if (failures.length > 0) {
    throw new Error(`integration-test cleanup left data behind — ${failures.join("; ")}`);
  }
}, 60_000);

async function createTestClass(name: string): Promise<string> {
  const { data, error } = await professor
    .from("classes")
    .insert({
      professor_id: professorId,
      name,
      class_code: `IT${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  expect(error, `class creation failed: ${error?.message}`).toBeNull();
  expect(data?.id).toBeTruthy();
  classIds.push(data!.id);
  return data!.id;
}

async function createDraftAssignment(classId: string, title: string, sequence: number) {
  const { data, error } = await professor
    .from("assignments")
    .insert({
      class_id: classId,
      title,
      sequence_number: sequence,
      created_by: professorId,
    })
    .select("id, status")
    .single();
  expect(error, `assignment creation failed: ${error?.message}`).toBeNull();
  expect(data!.status).toBe("DRAFT");
  return data!.id;
}

describe("professor can create a class (blocking-bug regression)", () => {
  it("inserts a class as the authenticated professor through RLS", async () => {
    const classId = await createTestClass("Integration Test Class");

    // And can read it back (SELECT path of the same policy).
    const { data: readBack, error: readError } = await professor
      .from("classes")
      .select("id, name")
      .eq("id", classId)
      .single();
    expect(readError).toBeNull();
    expect(readBack!.name).toBe("Integration Test Class");
  });

  it("surfaces the professor's own profile (the requireProfessor path)", async () => {
    const { data, error } = await professor
      .from("profiles")
      .select("id, role")
      .eq("id", professorId)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data?.role).toBe("PROFESSOR");
  });
});

describe("assignment spreadsheet import — end to end", () => {
  it("imports the real assignment-1 spreadsheet into a draft assignment", async () => {
    const classId = await createTestClass("Import Test Class");
    const assignmentId = await createDraftAssignment(classId, "Assignment 1", 1);

    const buffer = loadXlsx("source-assignments/assignment-1.xlsx");
    const parsed = parseGridWorkbook(buffer, { codePrefix: "A1" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.questions).toHaveLength(30);

    const { data, error } = await professor.rpc("commit_assignment_import", {
      p_assignment_id: assignmentId,
      p_source_filename: "assignment-1.xlsx",
      p_source_checksum: checksumOf(buffer),
      p_source_worksheet: parsed.worksheet,
      p_questions: parsed.questions,
    });
    expect(error, `import failed: ${error?.message}`).toBeNull();
    expect((data as { imported: number }).imported).toBe(30);

    const { data: questions, error: qError } = await professor
      .from("questions")
      .select("external_question_code, question_text, display_order")
      .eq("assignment_id", assignmentId)
      .order("display_order");
    expect(qError).toBeNull();
    expect(questions).toHaveLength(30);
    expect(questions![0]!.external_question_code).toBe("A1-001");
    expect(questions![0]!.question_text).toBe("Solar — Conventional");

    const { data: imports, error: iError } = await professor
      .from("imports")
      .select("status, import_type")
      .eq("assignment_id", assignmentId);
    expect(iError).toBeNull();
    expect(imports).toHaveLength(1);
    expect(imports![0]).toEqual({ status: "COMPLETED", import_type: "ASSIGNMENT" });
  });

  it("fails loudly on a malformed row — parser reports it, nothing imports", async () => {
    const classId = await createTestClass("Malformed Import Class");
    const assignmentId = await createDraftAssignment(classId, "Malformed", 1);

    // A numbered source row with a blank name — the classic silent-skip trap.
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Header", null, null],
      [null, "Mark = 1 for YES and Zero for NO", "Conventional"],
      [1, "Solar", null],
      [2, null, null],
      [3, "Hydro", null],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;

    const parsed = parseGridWorkbook(buffer, { codePrefix: "A1" });
    expect(parsed.errors.length).toBeGreaterThan(0);
    expect(parsed.errors[0]!.message).toContain("has an index but no name");
    // The import pipeline refuses to commit while errors exist (the server
    // action returns them to the professor); questions stay untouched.
    const { count } = await professor
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);
    expect(count).toBe(0);
  });

  it("rolls back atomically when a bad row reaches the database", async () => {
    const classId = await createTestClass("Rollback Import Class");
    const assignmentId = await createDraftAssignment(classId, "Rollback", 1);

    const buffer = loadXlsx("source-assignments/assignment-1.xlsx");
    const parsed = parseGridWorkbook(buffer, { codePrefix: "A1" });
    const sabotaged = parsed.questions.map((q, i) =>
      i === 20 ? { ...q, questionText: "" } : q
    );

    const { error } = await professor.rpc("commit_assignment_import", {
      p_assignment_id: assignmentId,
      p_source_filename: "assignment-1-sabotaged.xlsx",
      p_source_checksum: checksumOf(buffer),
      p_source_worksheet: parsed.worksheet,
      p_questions: sabotaged,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("blank question text");

    // Loud AND atomic: the 20 valid rows before the bad one must not persist.
    const { count } = await professor
      .from("questions")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignmentId);
    expect(count).toBe(0);

    const { data: imports } = await professor
      .from("imports")
      .select("status")
      .eq("assignment_id", assignmentId);
    expect(imports).toEqual([]);
  });
});

describe("DB-level boundaries", () => {
  it("rejects invalid status transitions and empty-approval", async () => {
    const classId = await createTestClass("Transition Class");
    const assignmentId = await createDraftAssignment(classId, "Transitions", 1);

    // DRAFT -> OPEN skips READY: rejected.
    const { error: skipError } = await professor
      .from("assignments")
      .update({ status: "OPEN" })
      .eq("id", assignmentId);
    expect(skipError).not.toBeNull();
    expect(skipError!.message).toContain("invalid assignment status transition");

    // DRAFT -> READY with zero questions: rejected.
    const { error: emptyError } = await professor
      .from("assignments")
      .update({ status: "READY" })
      .eq("id", assignmentId);
    expect(emptyError).not.toBeNull();
    expect(emptyError!.message).toContain("no active questions");

    // Import questions, then DRAFT -> READY -> OPEN is allowed.
    const buffer = loadXlsx("source-assignments/assignment-1.xlsx");
    const parsed = parseGridWorkbook(buffer, { codePrefix: "A1" });
    const { error: importError } = await professor.rpc("commit_assignment_import", {
      p_assignment_id: assignmentId,
      p_source_filename: "assignment-1.xlsx",
      p_source_checksum: checksumOf(buffer),
      p_source_worksheet: parsed.worksheet,
      p_questions: parsed.questions,
    });
    expect(importError).toBeNull();

    for (const status of ["READY", "OPEN"] as const) {
      const { error } = await professor
        .from("assignments")
        .update({ status })
        .eq("id", assignmentId);
      expect(error, `transition to ${status} failed: ${error?.message}`).toBeNull();
    }
  });

  it("blocks destructive question edits once a response exists", async () => {
    const classId = await createTestClass("Immutability Class");
    const assignmentId = await createDraftAssignment(classId, "Immutable", 1);

    const buffer = loadXlsx("source-assignments/assignment-1.xlsx");
    const parsed = parseGridWorkbook(buffer, { codePrefix: "A1" });
    const { error: importError } = await professor.rpc("commit_assignment_import", {
      p_assignment_id: assignmentId,
      p_source_filename: "assignment-1.xlsx",
      p_source_checksum: checksumOf(buffer),
      p_source_worksheet: parsed.worksheet,
      p_questions: parsed.questions,
    });
    expect(importError).toBeNull();

    // Provision a student with an attempt and one response (service role —
    // RLS is bypassed but the triggers still fire, which is the point).
    const { data: studentUser, error: studentError } = await admin.auth.admin.createUser({
      email: `it-student-${randomUUID().slice(0, 8)}@integration-test.invalid`,
      password: `It-${randomUUID()}`,
      email_confirm: true,
    });
    expect(studentError).toBeNull();
    const student = studentUser!.user!;
    studentIds.push(student.id);

    await admin.from("profiles").insert({
      id: student.id,
      email: student.email,
      role: "STUDENT",
      is_active: true,
    });
    await admin.from("class_members").insert({
      class_id: classId,
      user_id: student.id,
      member_role: "STUDENT",
      status: "ACTIVE",
    });

    const { data: attempt, error: attemptError } = await admin
      .from("assignment_attempts")
      .insert({
        assignment_id: assignmentId,
        student_id: student.id,
        state: "DRAFT",
      })
      .select("id")
      .single();
    expect(attemptError).toBeNull();

    const { data: question } = await admin
      .from("questions")
      .select("id")
      .eq("assignment_id", assignmentId)
      .eq("display_order", 1)
      .single();

    const { error: responseError } = await admin.from("responses").insert({
      attempt_id: attempt!.id,
      assignment_id: assignmentId,
      student_id: student.id,
      question_id: question!.id,
      response_value: 1,
    });
    expect(responseError).toBeNull();

    // Rewording is blocked — even for service_role.
    const { error: editError } = await admin
      .from("questions")
      .update({ question_text: "Paraphrased!" })
      .eq("id", question!.id);
    expect(editError).not.toBeNull();
    expect(editError!.message).toContain("already has responses");

    // Deletion is blocked.
    const { error: deleteError } = await admin
      .from("questions")
      .delete()
      .eq("id", question!.id);
    expect(deleteError).not.toBeNull();

    // Reordering is still allowed.
    const { error: reorderError } = await admin
      .from("questions")
      .update({ display_order: 99 })
      .eq("id", question!.id);
    expect(reorderError).toBeNull();
  });
});
