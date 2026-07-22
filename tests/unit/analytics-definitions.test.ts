// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import {
  changeRate,
  stabilityRate,
  netMovementToward1,
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
// Part 1 — the pure functions against the Section 12 worked example.
// ============================================================

// Worked example from spec Section 12: S01 = 30%, S10 = 27% -> change rate
// 57%, net shift +3 percentage points. Using a valid-paired-responses base
// of 100 for readability.
describe("transition metrics (Section 12 worked example)", () => {
  it("computes change rate as 57%", () => {
    expect(changeRate(30, 27, 100)).toBeCloseTo(0.57, 5);
  });

  it("computes net movement toward 1 as +3", () => {
    expect(netMovementToward1(30, 27)).toBe(3);
  });

  it("stability rate + change rate sum to 1 when all responses are valid pairs", () => {
    const s00 = 20;
    const s01 = 30;
    const s10 = 27;
    const s11 = 23;
    const total = s00 + s01 + s10 + s11;
    expect(changeRate(s01, s10, total) + stabilityRate(s00, s11, total)).toBeCloseTo(1, 5);
  });
});

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
// Part 2 — the SAME worked example run end-to-end against real seeded
// data through the actual migration-0012 database views (the acceptance
// requirement): 10 students x 10 approved 1:1 mappings = a 100-valid-pair
// base with S01=30, S10=27, S00=20, S11=23, plus an 11th student who only
// answered Assignment 1 (10 MISSING_A2 rows) and one approved
// NOT_COMPARABLE mapping (11 NOT_COMPARABLE rows). Change rate 57% and
// net shift +3pp must come back from a real query, matching the pure
// functions above.
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
const mappingIdsByName = new Map<string, string>();

const classIds: string[] = [];
const userIds: string[] = [];

/** Deterministic worked-example cell for student i (0..9), mapping j (0..9). */
function cellPair(i: number, j: number): [number, number] {
  const k = i * 10 + j;
  if (k < 30) return [0, 1]; // S01 x30
  if (k < 57) return [1, 0]; // S10 x27
  if (k < 77) return [0, 0]; // S00 x20
  return [1, 1]; // S11 x23
}

const pad3 = (n: number) => String(n).padStart(3, "0");
// Energy sources of A1-001..A1-010 in manifest/display order.
const MAPPING_SOURCES = [
  "Solar", "Solar", "Wind", "Wind", "Hydro", "Hydro", "Biomass", "Biomass", "Coal", "Coal",
];

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

async function createMappingRpc(args: {
  name: string;
  type: string;
  a1: string[];
  a2: string[];
  energySource?: string | null;
}): Promise<string> {
  const { data, error } = await professor.client.rpc("create_question_mapping", {
    p_class_id: classId,
    p_a1_question_ids: args.a1.map((c) => a1Codes.get(c)!),
    p_a2_question_ids: args.a2.map((c) => a2Codes.get(c)!),
    p_mapping_name: args.name,
    p_mapping_type: args.type,
    p_energy_source: args.energySource ?? null,
    p_mapping_status: "SUGGESTED",
  });
  expect(error, `${args.name}: ${error?.message}`).toBeNull();
  mappingIdsByName.set(args.name, data as string);
  return data as string;
}

async function approveMapping(mappingId: string) {
  const { error } = await professor.client.rpc("set_mapping_approval", {
    p_mapping_id: mappingId,
    p_approve: true,
  });
  expect(error, error?.message).toBeNull();
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

  // 10 one-to-one mappings A1-00j <-> A2-00j, approved; plus one approved
  // NOT_COMPARABLE mapping (Fusion exists only in Assignment 1).
  for (let j = 1; j <= 10; j++) {
    const id = await createMappingRpc({
      name: `WE mapping ${pad3(j)}`,
      type: "CONCEPTUAL_ONE_TO_ONE",
      a1: [`A1-${pad3(j)}`],
      a2: [`A2-${pad3(j)}`],
      energySource: MAPPING_SOURCES[j - 1],
    });
    await approveMapping(id);
  }
  const ncId = await createMappingRpc({
    name: "WE not comparable",
    type: "NOT_COMPARABLE",
    a1: ["A1-023", "A1-024"],
    a2: [],
    energySource: "Fusion",
  });
  await approveMapping(ncId);
}, 240_000);

afterAll(async () => {
  // Demote mappings first — the 0011 triggers block deleting approved
  // mappings, and the class delete cascades into question_mappings.
  for (const cid of classIds) {
    const { error } = await admin
      .from("question_mappings")
      .update({ professor_approved: false, mapping_status: "REJECTED" })
      .eq("class_id", cid);
    if (error) throw new Error(`mapping demotion failed: ${error.message}`);
  }
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("Section 12 worked example through the real database views", () => {
  it("class_transition_summary reproduces the worked example on a 100-valid-pair base", async () => {
    const { data, error } = await professor.client
      .from("class_transition_summary")
      .select("*")
      .eq("class_id", classId)
      .single();
    expect(error, error?.message).toBeNull();

    expect(data).toMatchObject({
      students_considered: 11,
      mappings_considered: 11,
      valid_paired: 100,
      s00: 20,
      s01: 30,
      s10: 27,
      s11: 23,
      changed_count: 57,
      unchanged_count: 43,
      net_movement_toward_1: 3,
      missing_a2: 10,
      missing_a1: 0,
      missing_both: 0,
      not_comparable: 11,
    });
    expect(data!.change_rate).toBeCloseTo(0.57, 10);
    expect(data!.stability_rate).toBeCloseTo(0.43, 10);
    expect(data!.pct_point_shift).toBeCloseTo(0.03, 10);
  });

  it("the view's rates equal the unit-tested pure functions (no formula drift)", async () => {
    const { data, error } = await professor.client
      .from("class_transition_summary")
      .select("*")
      .eq("class_id", classId)
      .single();
    expect(error).toBeNull();
    const row = data!;
    expect(row.change_rate).toBeCloseTo(changeRate(row.s01, row.s10, row.valid_paired), 10);
    expect(row.stability_rate).toBeCloseTo(stabilityRate(row.s00, row.s11, row.valid_paired), 10);
    expect(row.net_movement_toward_1).toBe(netMovementToward1(row.s01, row.s10));
  });

  it("per-mapping and per-energy-source grains aggregate the same data consistently", async () => {
    const { data: mapping, error: mappingError } = await professor.client
      .from("mapping_transition_summary")
      .select("*")
      .eq("mapping_id", mappingIdsByName.get("WE mapping 001")!)
      .single();
    expect(mappingError, mappingError?.message).toBeNull();
    expect(mapping).toMatchObject({
      pairs_considered: 11,
      valid_paired: 10,
      s00: 2,
      s01: 3,
      s10: 3,
      s11: 2,
      missing_a2: 1,
    });
    expect(mapping!.change_rate).toBeCloseTo(0.6, 10);

    // Solar = mappings 001 + 002.
    const { data: solar, error: solarError } = await professor.client
      .from("energy_source_transition_summary")
      .select("*")
      .eq("class_id", classId)
      .eq("energy_source", "Solar")
      .single();
    expect(solarError, solarError?.message).toBeNull();
    expect(solar).toMatchObject({
      mappings_considered: 2,
      valid_paired: 20,
      s00: 4,
      s01: 6,
      s10: 6,
      s11: 4,
    });

    // The approved NOT_COMPARABLE mapping: all pairs data-quality rows,
    // zero valid pairs, rates NULL — never fabricated into transitions.
    const { data: fusion, error: fusionError } = await professor.client
      .from("energy_source_transition_summary")
      .select("*")
      .eq("class_id", classId)
      .eq("energy_source", "Fusion")
      .single();
    expect(fusionError, fusionError?.message).toBeNull();
    expect(fusion).toMatchObject({ valid_paired: 0, not_comparable: 11 });
    expect(fusion!.change_rate).toBeNull();
    expect(fusion!.pct_point_shift).toBeNull();
  });

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
      .from("mapping_association_exploratory")
      .select("*")
      .eq("mapping_id", mappingIdsByName.get("WE mapping 001")!)
      .single();
    expect(error, error?.message).toBeNull();
    const row = data!;
    expect(row.phi_coefficient).toBeCloseTo(
      phiCoefficient(row.s00, row.s01, row.s10, row.s11)!,
      10
    );
    expect(row.mutual_information_bits).toBeCloseTo(
      mutualInformationBits(row.s00, row.s01, row.s10, row.s11)!,
      10
    );
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

describe("mapping approval and versioning flip visibility (computed on read — no recompute step exists)", () => {
  let v1Id: string;
  let v2Id: string;

  it("an unapproved mapping contributes nothing to transitions or aggregates", async () => {
    v1Id = await createMappingRpc({
      name: "Flip mapping",
      type: "CONCEPTUAL_ONE_TO_ONE",
      a1: ["A1-011"],
      a2: ["A2-011"],
      energySource: "Nuclear",
    });

    const { data: live, error: liveError } = await professor.client
      .from("response_transitions_live")
      .select("mapping_id")
      .eq("mapping_id", v1Id);
    expect(liveError).toBeNull();
    expect(live).toEqual([]);

    const { data: summary, error: summaryError } = await professor.client
      .from("mapping_transition_summary")
      .select("mapping_id")
      .eq("mapping_id", v1Id);
    expect(summaryError).toBeNull();
    expect(summary).toEqual([]);
  });

  it("approval makes it visible immediately — no recompute call anywhere", async () => {
    await approveMapping(v1Id);

    const { data, error } = await professor.client
      .from("mapping_transition_summary")
      .select("*")
      .eq("mapping_id", v1Id)
      .single();
    expect(error, error?.message).toBeNull();
    // Nobody answered A1-011/A2-011: every active student is MISSING_BOTH.
    expect(data).toMatchObject({ pairs_considered: 11, valid_paired: 0, missing_both: 11 });
  });

  it("approving a new version flips visibility from v1 to v2", async () => {
    const { data: newId, error: versionError } = await professor.client.rpc(
      "create_mapping_version",
      { p_mapping_id: v1Id }
    );
    expect(versionError, versionError?.message).toBeNull();
    v2Id = newId as string;

    const { error: updateError } = await professor.client.rpc("update_question_mapping", {
      p_mapping_id: v2Id,
      p_a1_question_ids: [a1Codes.get("A1-012")!],
      p_a2_question_ids: [a2Codes.get("A2-012")!],
      p_mapping_name: "Flip mapping",
      p_mapping_type: "CONCEPTUAL_ONE_TO_ONE",
      p_energy_source: "Nuclear",
    });
    expect(updateError, updateError?.message).toBeNull();

    // v1 is still the live version until v2 is approved.
    const { data: beforeFlip } = await professor.client
      .from("mapping_transition_summary")
      .select("mapping_id, mapping_version")
      .eq("class_id", classId)
      .eq("mapping_name", "Flip mapping");
    expect(beforeFlip!.map((m) => m.mapping_id)).toEqual([v1Id]);

    await approveMapping(v2Id);

    // The flip is instant and total: v2 in, v1 out — same query, no
    // refresh step in between.
    const { data: afterFlip, error: afterError } = await professor.client
      .from("mapping_transition_summary")
      .select("mapping_id, mapping_version, pairs_considered")
      .eq("class_id", classId)
      .eq("mapping_name", "Flip mapping");
    expect(afterError).toBeNull();
    expect(afterFlip!.map((m) => m.mapping_id)).toEqual([v2Id]);
    expect(afterFlip![0]).toMatchObject({ mapping_version: 2, pairs_considered: 11 });

    const { data: v1Live } = await professor.client
      .from("response_transitions_live")
      .select("mapping_id")
      .eq("mapping_id", v1Id);
    expect(v1Live).toEqual([]);

    // The worked-example base is untouched by the flip (v1/v2 have no
    // answered questions, so class valid pairs stay exactly 100).
    const { data: classSummary } = await professor.client
      .from("class_transition_summary")
      .select("valid_paired, mappings_considered")
      .eq("class_id", classId)
      .single();
    expect(classSummary).toMatchObject({ valid_paired: 100, mappings_considered: 12 });
  });
});
