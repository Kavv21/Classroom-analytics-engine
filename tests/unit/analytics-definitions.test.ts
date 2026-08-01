// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  simpleConsensus,
  simpleDisagreement,
  binaryEntropy,
} from "../../lib/types/domain";
import {
  hammingDistance,
  jaccardSimilarity,
  mutualInformationBits,
  phiCoefficient,
} from "../../lib/analytics/exploratory";
import { parseGridWorkbook } from "../../lib/imports/parse-grid";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  retryTransient,
  type TestUser,
} from "../integration/helpers";

// ============================================================
// Part 1 — the pure formula helpers.
// ============================================================

describe("consensus / disagreement / entropy", () => {
  it("50/50 produces maximum disagreement and entropy", () => {
    expect(simpleConsensus(0.5, 0.5)).toBe(0.5);
    expect(simpleDisagreement(0.5)).toBe(0.5);
    expect(binaryEntropy(0.5)).toBeCloseTo(1, 5);
  });

  it("100/0 produces minimum disagreement and zero entropy", () => {
    expect(simpleConsensus(1, 0)).toBe(1);
    expect(simpleDisagreement(1)).toBe(0);
    expect(binaryEntropy(1)).toBe(0);
    expect(binaryEntropy(0)).toBe(0);
  });
});

// ============================================================
// Part 2 — the same formulas run end-to-end against real seeded data
// through the actual migration-0012 database views (the acceptance
// requirement): 11 students answering a deterministic 0/1 matrix, so every
// per-question consensus / entropy and every exploratory association the
// SQL reports can be checked against the TypeScript reference above.
//
// The cross-assignment transition assertions this file used to carry went
// with the question-mapping feature (migration 0022) — the views they
// queried no longer exist.
// ============================================================

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let classId: string;
let a1AssignmentId: string;
let a2AssignmentId: string;
const a1Codes = new Map<string, string>();
const a2Codes = new Map<string, string>();
const studentIds: string[] = [];

const classIds: string[] = [];
const userIds: string[] = [];

/** Deterministic response cell for student i (0..9), question j (0..9). */
function cellPair(i: number, j: number): [number, number] {
  const k = i * 10 + j;
  if (k < 30) return [0, 1]; // S01 x30
  if (k < 57) return [1, 0]; // S10 x27
  if (k < 77) return [0, 0]; // S00 x20
  return [1, 1]; // S11 x23
}

const pad3 = (n: number) => String(n).padStart(3, "0");

function loadXlsx(path: string): ArrayBuffer {
  const buf = readFileSync(resolve(path));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

async function importAssignment(
  assignmentId: string,
  file: string,
  codePrefix: "A1" | "A2",
  worksheet?: string
) {
  const buffer = loadXlsx(file);
  const parsed = parseGridWorkbook(buffer, { codePrefix, worksheet });
  expect(parsed.errors, `${file} parse errors`).toEqual([]);
  const { error } = await professor.client.rpc("commit_assignment_import", {
    p_assignment_id: assignmentId,
    p_source_filename: file,
    p_source_checksum: createHash("sha256").update(Buffer.from(buffer)).digest("hex"),
    p_source_worksheet: parsed.worksheet,
    p_questions: parsed.questions,
  });
  expect(error, `import of ${file} failed: ${error?.message}`).toBeNull();
}

beforeAll(async () => {
  professor = await createTestUser(env, admin, "PROFESSOR", "Analytics Test Professor");
  userIds.push(professor.id);

  const { data: classRow, error: classError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Worked Example Class",
      class_code: `AN${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (classError) throw new Error(`class creation failed: ${classError.message}`);
  classId = classRow!.id;
  classIds.push(classId);

  for (const [title, sequence] of [
    ["Assignment 1", 1],
    ["Assignment 2", 2],
  ] as const) {
    const { data, error } = await professor.client
      .from("assignments")
      .insert({ class_id: classId, title, sequence_number: sequence, created_by: professor.id })
      .select("id")
      .single();
    if (error) throw new Error(`assignment creation failed: ${error.message}`);
    if (sequence === 1) a1AssignmentId = data!.id;
    else a2AssignmentId = data!.id;
  }

  await importAssignment(a1AssignmentId, "source-assignments/assignment-1.xlsx", "A1");
  await importAssignment(
    a2AssignmentId,
    "source-assignments/assignment-2.xlsx",
    "A2",
    "Quantitative"
  );
  for (const [assignmentId, into] of [
    [a1AssignmentId, a1Codes],
    [a2AssignmentId, a2Codes],
  ] as const) {
    const { data, error } = await professor.client
      .from("questions")
      .select("id, external_question_code")
      .eq("assignment_id", assignmentId);
    expect(error).toBeNull();
    for (const q of data ?? []) into.set(q.external_question_code, q.id);
  }

  // 11 students, created directly via the admin API (no sign-in needed —
  // their responses are seeded with service_role; triggers still fire).
  for (let i = 0; i < 11; i++) {
    const email = `an-student-${i}-${randomUUID().slice(0, 8)}@integration-test.invalid`;
    const { data, error } = await retryTransient(() =>
      admin.auth.admin.createUser({
        email,
        password: `It-${randomUUID()}`,
        email_confirm: true,
      })
    );
    if (error) throw new Error(`student ${i} creation failed: ${error.message}`);
    const id = data.user!.id;
    studentIds.push(id);
    userIds.push(id);
    const { error: profileError } = await admin.from("profiles").insert({
      id,
      email,
      full_name: `Analytics Student ${i}`,
      role: "STUDENT",
      is_active: true,
    });
    if (profileError) throw new Error(`student ${i} profile failed: ${profileError.message}`);
    const { error: memberError } = await admin.from("class_members").insert({
      class_id: classId,
      user_id: id,
      member_role: "STUDENT",
      status: "ACTIVE",
    });
    if (memberError) throw new Error(`student ${i} enrolment failed: ${memberError.message}`);
  }

  // Final responses per the worked-example matrix. Student 11 (index 10)
  // answers ONLY Assignment 1 -> 10 MISSING_A2 rows.
  for (const [index, studentId] of studentIds.entries()) {
    const sides: Array<[string, 0 | 1]> = index < 10 ? [["A1", 0], ["A2", 1]] : [["A1", 0]];
    for (const [prefix, side] of sides) {
      const assignmentId = prefix === "A1" ? a1AssignmentId : a2AssignmentId;
      const codes = prefix === "A1" ? a1Codes : a2Codes;
      const { data: attempt, error: attemptError } = await admin
        .from("assignment_attempts")
        .insert({ assignment_id: assignmentId, student_id: studentId, state: "DRAFT" })
        .select("id")
        .single();
      if (attemptError) throw new Error(`attempt failed: ${attemptError.message}`);
      const rows = Array.from({ length: 10 }, (_, j) => ({
        attempt_id: attempt!.id,
        assignment_id: assignmentId,
        student_id: studentId,
        question_id: codes.get(`${prefix}-${pad3(j + 1)}`)!,
        response_value: index < 10 ? cellPair(index, j)[side] : 1,
        is_final: true,
        submitted_at: new Date().toISOString(),
      }));
      const { error: responsesError } = await admin.from("responses").insert(rows);
      if (responsesError) throw new Error(`responses failed: ${responsesError.message}`);
    }
  }

  // Submit every attempt (DRAFT -> SUBMITTED is a legal transition) so the
  // Phase 8 submission views have data to report.
  {
    const { error: submitError } = await admin
      .from("assignment_attempts")
      .update({ state: "SUBMITTED", submitted_at: new Date().toISOString() })
      .in("student_id", studentIds);
    if (submitError) throw new Error(`marking attempts submitted failed: ${submitError.message}`);
  }

}, 240_000);

afterAll(async () => {
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("per-question aggregates through the real database views", () => {
  it("question consensus / disagreement / entropy match the pure functions", async () => {
    const { data, error } = await professor.client
      .from("question_response_summary")
      .select("*")
      .eq("question_id", a1Codes.get("A1-001")!)
      .single();
    expect(error, error?.message).toBeNull();
    const row = data!;
    // 10 worked-example students (5 zeros / 5 ones on A1-001) + student 11
    // who answered 1 everywhere.
    expect(row).toMatchObject({ answered: 11, zeros: 5, ones: 6 });
    const pctZero = row.zeros / row.answered;
    const pctOne = row.ones / row.answered;
    expect(row.consensus).toBeCloseTo(simpleConsensus(pctZero, pctOne), 10);
    expect(row.disagreement).toBeCloseTo(simpleDisagreement(simpleConsensus(pctZero, pctOne)), 10);
    expect(row.entropy).toBeCloseTo(binaryEntropy(pctOne), 10);
  });

  it("SQL phi coefficient and mutual information match the TS reference", async () => {
    const { data, error } = await professor.client
      .from("question_pair_association_exploratory")
      .select("*")
      .eq("assignment_id", a1AssignmentId);
    expect(error, error?.message).toBeNull();

    // Any pair with observations exercises the same SQL expressions; check
    // every one of them so a formula change cannot hide in an untested row.
    const pairs = (data ?? []).filter((r) => r.n > 0);
    expect(pairs.length).toBeGreaterThan(0);
    for (const row of pairs) {
      const expectedPhi = phiCoefficient(row.n00, row.n01, row.n10, row.n11);
      if (expectedPhi === null) {
        expect(row.phi_coefficient).toBeNull();
      } else {
        expect(row.phi_coefficient).toBeCloseTo(expectedPhi, 10);
      }
      const expectedMi = mutualInformationBits(row.n00, row.n01, row.n10, row.n11);
      if (expectedMi === null) {
        expect(row.mutual_information_bits).toBeNull();
      } else {
        expect(row.mutual_information_bits).toBeCloseTo(expectedMi, 10);
      }
    }
  });

  it("student pair similarity matches the TS helpers", async () => {
    const { data, error } = await professor.client
      .from("student_pair_similarity_exploratory")
      .select("*")
      .eq("assignment_id", a1AssignmentId);
    expect(error, error?.message).toBeNull();

    const pairOf = (x: string, y: string) =>
      data!.find(
        (r) =>
          (r.student_a === x && r.student_b === y) || (r.student_a === y && r.student_b === x)
      )!;

    // Students 0 and 1 both answered all-zero on A1 (identical vectors).
    const same = pairOf(studentIds[0]!, studentIds[1]!);
    expect(same).toMatchObject({ shared_questions: 10, both_zero: 10, hamming_distance: 0 });
    expect(same.agreement_rate).toBe(1);
    expect(same.jaccard_similarity).toBe(
      jaccardSimilarity(same.both_one, same.a_only_one, same.b_only_one)
    );

    // Students 0 (all zero) and 3 (all one) disagree everywhere.
    const opposite = pairOf(studentIds[0]!, studentIds[3]!);
    expect(opposite.hamming_distance).toBe(
      hammingDistance(opposite.a_only_one, opposite.b_only_one)
    );
    expect(opposite).toMatchObject({ shared_questions: 10, hamming_distance: 10 });
    expect(opposite.agreement_rate).toBe(0);
    expect(opposite.jaccard_similarity).toBe(0);
  });
});

describe("submission views (Phase 8 charts 17.13 / 17.14)", () => {
  it("assignment_submission_progress counts states per assignment", async () => {
    const { data, error } = await professor.client
      .from("assignment_submission_progress")
      .select("*")
      .eq("class_id", classId)
      .order("assignment_id");
    expect(error, error?.message).toBeNull();
    expect(data).toHaveLength(2);
    const a1 = data!.find((r) => r.assignment_id === a1AssignmentId)!;
    const a2 = data!.find((r) => r.assignment_id === a2AssignmentId)!;
    // All 11 students attempted+submitted A1; only the first 10 touched A2.
    expect(a1).toMatchObject({ enrolled_students: 11, submitted_count: 11, not_started_count: 0 });
    expect(a2).toMatchObject({ enrolled_students: 11, submitted_count: 10, not_started_count: 1 });
  });

  it("submission_timeline reports per-day and cumulative submissions", async () => {
    const { data, error } = await professor.client
      .from("submission_timeline")
      .select("*")
      .eq("class_id", classId)
      .order("assignment_id");
    expect(error, error?.message).toBeNull();
    // Everything was submitted "today", so one row per assignment with
    // cumulative == that day's count.
    const a1Rows = data!.filter((r) => r.assignment_id === a1AssignmentId);
    expect(a1Rows).toHaveLength(1);
    expect(a1Rows[0]).toMatchObject({ submissions: 11, cumulative_submissions: 11 });
    const a2Rows = data!.filter((r) => r.assignment_id === a2AssignmentId);
    expect(a2Rows[0]).toMatchObject({ submissions: 10, cumulative_submissions: 10 });
  });
});
