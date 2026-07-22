// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseGridWorkbook } from "@/lib/imports/parse-grid";
import {
  adminClient,
  cleanupTestData,
  createTestUser,
  loadEnv,
  type TestUser,
} from "./helpers";

/**
 * Phase 6 integration tests against a live Supabase instance.
 *
 * The acceptance requirement is the headline: an unapproved mapping
 * (professor_approved = false) must be excluded from every query surface a
 * downstream feature would use to read mappings — the
 * approved_question_mappings / approved_question_mapping_members views.
 * This is a hard data-layer boundary, same category as RLS, so it is
 * asserted for the professor role AND for service_role (which bypasses RLS
 * but not the view's structural filter).
 *
 * Also covered: all 7 mapping types create correctly with side validation,
 * no auto-approval path exists, the pre-approval analytics preview
 * aggregates in the DB, and the load-bearing immutability/versioning
 * boundary (trigger, not UI).
 */

const env = loadEnv();
const admin = adminClient(env);

let professor: TestUser;
let student: TestUser;
let classId: string;
let a1AssignmentId: string;
let a2AssignmentId: string;

/** external_question_code -> question uuid, per assignment. */
const a1Codes = new Map<string, string>();
const a2Codes = new Map<string, string>();

const classIds: string[] = [];
const userIds: string[] = [];

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

async function loadCodeMap(assignmentId: string, into: Map<string, string>) {
  const { data, error } = await professor.client
    .from("questions")
    .select("id, external_question_code")
    .eq("assignment_id", assignmentId);
  expect(error).toBeNull();
  for (const q of data ?? []) into.set(q.external_question_code, q.id);
}

interface CreateMappingArgs {
  name: string;
  type: string;
  a1: string[]; // external codes
  a2: string[];
  status?: string;
  client?: SupabaseClient;
}

async function createMapping({ name, type, a1, a2, status, client }: CreateMappingArgs) {
  return (client ?? professor.client).rpc("create_question_mapping", {
    p_class_id: classId,
    p_a1_question_ids: a1.map((c) => a1Codes.get(c)!),
    p_a2_question_ids: a2.map((c) => a2Codes.get(c)!),
    p_mapping_name: name,
    p_mapping_type: type,
    p_common_concept: null,
    p_energy_source: null,
    p_criterion: null,
    p_comparison_method: "integration-test",
    p_professor_notes: null,
    p_mapping_status: status ?? "DRAFT",
  });
}

beforeAll(async () => {
  professor = await createTestUser(env, admin, "PROFESSOR", "Mapping Test Professor");
  userIds.push(professor.id);
  student = await createTestUser(env, admin, "STUDENT", "Mapping Test Student");
  userIds.push(student.id);

  const { data: classRow, error: classError } = await professor.client
    .from("classes")
    .insert({
      professor_id: professor.id,
      name: "Mapping Flow Class",
      class_code: `MF${randomUUID().slice(0, 6).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (classError) throw new Error(`class creation failed: ${classError.message}`);
  classId = classRow!.id;
  classIds.push(classId);

  const { error: memberError } = await admin.from("class_members").insert({
    class_id: classId,
    user_id: student.id,
    member_role: "STUDENT",
    status: "ACTIVE",
  });
  if (memberError) throw new Error(`enrolment failed: ${memberError.message}`);

  for (const [title, sequence] of [
    ["Assignment 1", 1],
    ["Assignment 2", 2],
  ] as const) {
    const { data, error } = await professor.client
      .from("assignments")
      .insert({
        class_id: classId,
        title,
        sequence_number: sequence,
        created_by: professor.id,
      })
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
  await loadCodeMap(a1AssignmentId, a1Codes);
  await loadCodeMap(a2AssignmentId, a2Codes);

  // Fail fast if migration 0011 isn't applied to the target database.
  const { error: probeError } = await admin
    .from("approved_question_mappings")
    .select("id", { head: true, count: "exact" });
  if (probeError) {
    throw new Error(
      "approved_question_mappings is missing on the target database — apply migration " +
        `0011 (npm run db:migrate) before running the integration tests. (${probeError.message})`
    );
  }
}, 120_000);

afterAll(async () => {
  // Mappings must be demoted before cleanup: the 0011 triggers block
  // deleting approved/analytics-referenced mappings even for service_role,
  // and the class delete cascades into question_mappings.
  const failures: string[] = [];
  for (const cid of classIds) {
    const { error: transitionsError } = await admin
      .from("response_transitions")
      .delete()
      .eq("class_id", cid);
    if (transitionsError) failures.push(`response_transitions: ${transitionsError.message}`);
    const { error: demoteError } = await admin
      .from("question_mappings")
      .update({ professor_approved: false, mapping_status: "REJECTED" })
      .eq("class_id", cid);
    if (demoteError) failures.push(`mapping demotion: ${demoteError.message}`);
  }
  if (failures.length > 0) {
    throw new Error(`mapping cleanup failed — ${failures.join("; ")}`);
  }
  await cleanupTestData(admin, { classIds, userIds });
}, 120_000);

describe("mapping creation — all 7 types, server-side shape validation", () => {
  it("creates every mapping type with the right member sides", async () => {
    const cases: Array<{ name: string; type: string; a1: string[]; a2: string[] }> = [
      { name: "T Exact", type: "EXACT_ONE_TO_ONE", a1: ["A1-002"], a2: ["A2-016"] },
      { name: "T Conceptual", type: "CONCEPTUAL_ONE_TO_ONE", a1: ["A1-004"], a2: ["A2-017"] },
      { name: "T One-to-many", type: "ONE_TO_MANY", a1: ["A1-006"], a2: ["A2-018", "A2-019"] },
      { name: "T Many-to-one", type: "MANY_TO_ONE", a1: ["A1-008", "A1-010"], a2: ["A2-020"] },
      {
        name: "T Grouped",
        type: "GROUPED_CONCEPT",
        a1: ["A1-012", "A1-016"],
        a2: ["A2-021", "A2-022"],
      },
      { name: "T Not comparable", type: "NOT_COMPARABLE", a1: ["A1-023", "A1-024"], a2: [] },
      { name: "T Unmapped", type: "UNMAPPED", a1: ["A1-001"], a2: [] },
    ];

    for (const c of cases) {
      const { data: mappingId, error } = await createMapping(c);
      expect(error, `${c.type} creation failed: ${error?.message}`).toBeNull();

      const { data: members, error: membersError } = await professor.client
        .from("question_mapping_members")
        .select("mapping_side, question_id")
        .eq("mapping_id", mappingId as string);
      expect(membersError).toBeNull();
      expect(members!.filter((m) => m.mapping_side === 1)).toHaveLength(c.a1.length);
      expect(members!.filter((m) => m.mapping_side === 2)).toHaveLength(c.a2.length);
    }
  });

  it("rejects a shape that contradicts the mapping type", async () => {
    const { error } = await createMapping({
      name: "T Bad shape",
      type: "EXACT_ONE_TO_ONE",
      a1: ["A1-001", "A1-002"],
      a2: ["A2-016"],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("requires exactly one question on each side");
  });

  it("rejects questions from the wrong side/class", async () => {
    const { error } = await professor.client.rpc("create_question_mapping", {
      p_class_id: classId,
      p_a1_question_ids: [a2Codes.get("A2-016")!], // an A2 question on the A1 side
      p_a2_question_ids: [a2Codes.get("A2-017")!],
      p_mapping_name: "T Wrong side",
      p_mapping_type: "CONCEPTUAL_ONE_TO_ONE",
      p_mapping_status: "DRAFT",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("do not belong to this class");
  });

  it("has no auto-approval path at creation", async () => {
    const { error } = await createMapping({
      name: "T Sneaky approve",
      type: "UNMAPPED",
      a1: ["A1-003"],
      a2: [],
      status: "APPROVED",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("must start as DRAFT, SUGGESTED, or NEEDS_PROFESSOR_REVIEW");
  });
});

describe("ACCEPTANCE: unapproved mappings are invisible to downstream read surfaces", () => {
  let approvedId: string;
  let unapprovedId: string;
  let rejectedId: string;

  beforeAll(async () => {
    const mk = async (name: string, a1: string, a2: string) => {
      const { data, error } = await createMapping({
        name,
        type: "CONCEPTUAL_ONE_TO_ONE",
        a1: [a1],
        a2: [a2],
        status: "SUGGESTED",
      });
      expect(error, `${name}: ${error?.message}`).toBeNull();
      return data as string;
    };
    approvedId = await mk("Gate approved", "A1-018", "A2-030");
    unapprovedId = await mk("Gate unapproved", "A1-020", "A2-027");
    rejectedId = await mk("Gate rejected", "A1-022", "A2-021");

    const { error: approveError } = await professor.client.rpc("set_mapping_approval", {
      p_mapping_id: approvedId,
      p_approve: true,
    });
    expect(approveError, approveError?.message).toBeNull();
    const { error: rejectError } = await professor.client.rpc("set_mapping_approval", {
      p_mapping_id: rejectedId,
      p_approve: false,
    });
    expect(rejectError, rejectError?.message).toBeNull();
  });

  it("approved_question_mappings returns only the approved mapping (professor)", async () => {
    const { data, error } = await professor.client
      .from("approved_question_mappings")
      .select("id, professor_approved, mapping_status")
      .eq("class_id", classId);
    expect(error).toBeNull();
    const ids = (data ?? []).map((m) => m.id);
    expect(ids).toContain(approvedId);
    expect(ids).not.toContain(unapprovedId);
    expect(ids).not.toContain(rejectedId);
    expect((data ?? []).every((m) => m.professor_approved && m.mapping_status === "APPROVED")).toBe(
      true
    );
  });

  it("the filter is structural — service_role (bypasses RLS) still cannot see unapproved rows through the view", async () => {
    // service_role CAN see everything in the base table…
    const { data: baseRows, error: baseError } = await admin
      .from("question_mappings")
      .select("id")
      .eq("class_id", classId);
    expect(baseError).toBeNull();
    expect(baseRows!.map((m) => m.id)).toContain(unapprovedId);

    // …but the downstream surface never exposes them.
    const { data: viewRows, error: viewError } = await admin
      .from("approved_question_mappings")
      .select("id")
      .eq("class_id", classId);
    expect(viewError).toBeNull();
    const ids = viewRows!.map((m) => m.id);
    expect(ids).toContain(approvedId);
    expect(ids).not.toContain(unapprovedId);
    expect(ids).not.toContain(rejectedId);
  });

  it("approved_question_mapping_members exposes only approved mappings' members", async () => {
    const { data, error } = await admin
      .from("approved_question_mapping_members")
      .select("mapping_id");
    expect(error).toBeNull();
    const mappingIds = new Set((data ?? []).map((m) => m.mapping_id));
    expect(mappingIds.has(approvedId)).toBe(true);
    expect(mappingIds.has(unapprovedId)).toBe(false);
    expect(mappingIds.has(rejectedId)).toBe(false);
  });

  it("students cannot read mappings at all — base table or view", async () => {
    const { data: baseRows, error: baseError } = await student.client
      .from("question_mappings")
      .select("id")
      .eq("class_id", classId);
    expect(baseError).toBeNull(); // RLS filters, it doesn't error
    expect(baseRows).toEqual([]);

    const { data: viewRows, error: viewError } = await student.client
      .from("approved_question_mappings")
      .select("id")
      .eq("class_id", classId);
    expect(viewError).toBeNull();
    expect(viewRows).toEqual([]);
  });
});

describe("analytics preview (pre-approval, aggregated in the database)", () => {
  it("counts final response pairs for an unapproved mapping", async () => {
    // One student, final responses on both sides of a fresh mapping:
    // A1-030 = 0, A2-028 = 1 → exactly one 0/1 pair.
    const { data: mappingId, error: mapError } = await createMapping({
      name: "Preview mapping",
      type: "CONCEPTUAL_ONE_TO_ONE",
      a1: ["A1-030"],
      a2: ["A2-028"],
      status: "SUGGESTED",
    });
    expect(mapError, mapError?.message).toBeNull();

    for (const [assignmentId, code, value, codes] of [
      [a1AssignmentId, "A1-030", 0, a1Codes],
      [a2AssignmentId, "A2-028", 1, a2Codes],
    ] as const) {
      const { data: attempt, error: attemptError } = await admin
        .from("assignment_attempts")
        .insert({ assignment_id: assignmentId, student_id: student.id, state: "DRAFT" })
        .select("id")
        .single();
      expect(attemptError, attemptError?.message).toBeNull();
      const { error: responseError } = await admin.from("responses").insert({
        attempt_id: attempt!.id,
        assignment_id: assignmentId,
        student_id: student.id,
        question_id: codes.get(code)!,
        response_value: value,
        is_final: true,
        submitted_at: new Date().toISOString(),
      });
      expect(responseError, responseError?.message).toBeNull();
    }

    const { data, error } = await professor.client.rpc("preview_mapping_pairs", {
      p_mapping_id: mappingId as string,
    });
    expect(error, error?.message).toBeNull();

    const preview = data as {
      enrolledStudents: number;
      questionCounts: Array<{ side: number; answered: number; zeros: number; ones: number }>;
      pairCounts: Array<{
        paired: number;
        pair00: number;
        pair01: number;
        pair10: number;
        pair11: number;
        missingBoth: number;
      }>;
    };
    expect(preview.enrolledStudents).toBe(1);
    expect(preview.pairCounts).toHaveLength(1);
    expect(preview.pairCounts[0]).toMatchObject({
      paired: 1,
      pair00: 0,
      pair01: 1,
      pair10: 0,
      pair11: 0,
    });
    const side1 = preview.questionCounts.find((q) => q.side === 1)!;
    expect(side1).toMatchObject({ answered: 1, zeros: 1, ones: 0 });
  });

  it("students cannot invoke the preview", async () => {
    const { data: mappings } = await admin
      .from("question_mappings")
      .select("id")
      .eq("class_id", classId)
      .limit(1);
    const { error } = await student.client.rpc("preview_mapping_pairs", {
      p_mapping_id: mappings![0]!.id,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("not the professor");
  });
});

describe("load-bearing immutability and versioning", () => {
  let v1Id: string;

  beforeAll(async () => {
    const { data, error } = await createMapping({
      name: "Versioned mapping",
      type: "CONCEPTUAL_ONE_TO_ONE",
      a1: ["A1-016"],
      a2: ["A2-029"],
      status: "DRAFT",
    });
    expect(error, error?.message).toBeNull();
    v1Id = data as string;

    const { error: approveError } = await professor.client.rpc("set_mapping_approval", {
      p_mapping_id: v1Id,
      p_approve: true,
    });
    expect(approveError, approveError?.message).toBeNull();

    // Downstream dependency appears (what Phase 7 will write).
    const { error: transitionError } = await admin.from("response_transitions").insert({
      class_id: classId,
      student_id: student.id,
      mapping_id: v1Id,
      assignment_1_value: 0,
      assignment_2_value: 1,
      transition_state: "S01",
    });
    expect(transitionError, transitionError?.message).toBeNull();
  });

  it("blocks destructive edits and deletes — even for service_role", async () => {
    const { error: editError } = await admin
      .from("question_mappings")
      .update({ mapping_name: "Paraphrased!" })
      .eq("id", v1Id);
    expect(editError).not.toBeNull();
    expect(editError!.message).toContain("create a new version instead");

    const { error: deleteError } = await admin
      .from("question_mappings")
      .delete()
      .eq("id", v1Id);
    expect(deleteError).not.toBeNull();

    const { error: memberError } = await admin
      .from("question_mapping_members")
      .delete()
      .eq("mapping_id", v1Id);
    expect(memberError).not.toBeNull();
    expect(memberError!.message).toContain("create a new version instead");

    const { error: rpcError } = await professor.client.rpc("update_question_mapping", {
      p_mapping_id: v1Id,
      p_a1_question_ids: [a1Codes.get("A1-016")!],
      p_a2_question_ids: [a2Codes.get("A2-029")!],
      p_mapping_name: "Renamed via RPC",
      p_mapping_type: "CONCEPTUAL_ONE_TO_ONE",
    });
    expect(rpcError).not.toBeNull();
    expect(rpcError!.message).toContain("create a new version");
  });

  it("versions instead: v2 draft, chain linked, approval supersedes v1", async () => {
    const { data: v2Id, error } = await professor.client.rpc("create_mapping_version", {
      p_mapping_id: v1Id,
    });
    expect(error, error?.message).toBeNull();

    const { data: v2 } = await professor.client
      .from("question_mappings")
      .select("version, previous_version_id, mapping_status, professor_approved")
      .eq("id", v2Id as string)
      .single();
    expect(v2).toMatchObject({
      version: 2,
      previous_version_id: v1Id,
      mapping_status: "DRAFT",
      professor_approved: false,
    });

    const { data: v2Members } = await professor.client
      .from("question_mapping_members")
      .select("question_id, mapping_side")
      .eq("mapping_id", v2Id as string);
    expect(v2Members).toHaveLength(2);

    // v1 stays live until v2 is approved.
    const { data: v1Before } = await professor.client
      .from("question_mappings")
      .select("professor_approved, superseded_by_id")
      .eq("id", v1Id)
      .single();
    expect(v1Before).toMatchObject({ professor_approved: true, superseded_by_id: v2Id });

    // A superseded tip cannot be re-approved or forked again.
    const { error: reApproveError } = await professor.client.rpc("set_mapping_approval", {
      p_mapping_id: v1Id,
      p_approve: true,
    });
    expect(reApproveError).not.toBeNull();
    expect(reApproveError!.message).toContain("superseded");
    const { error: reForkError } = await professor.client.rpc("create_mapping_version", {
      p_mapping_id: v1Id,
    });
    expect(reForkError).not.toBeNull();

    // Approving v2 retires v1 from analytics.
    const { error: approveError } = await professor.client.rpc("set_mapping_approval", {
      p_mapping_id: v2Id as string,
      p_approve: true,
    });
    expect(approveError, approveError?.message).toBeNull();

    const { data: v1After } = await professor.client
      .from("question_mappings")
      .select("professor_approved, mapping_status")
      .eq("id", v1Id)
      .single();
    expect(v1After).toMatchObject({ professor_approved: false, mapping_status: "SUPERSEDED" });

    const { data: viewRows } = await professor.client
      .from("approved_question_mappings")
      .select("id")
      .eq("class_id", classId)
      .eq("mapping_name", "Versioned mapping");
    expect(viewRows!.map((m) => m.id)).toEqual([v2Id]);
  });

  it("still allows deleting an unapproved draft with no dependents", async () => {
    const { data: draftId, error } = await createMapping({
      name: "Disposable draft",
      type: "UNMAPPED",
      a1: ["A1-005"],
      a2: [],
    });
    expect(error, error?.message).toBeNull();
    const { error: deleteError } = await professor.client
      .from("question_mappings")
      .delete()
      .eq("id", draftId as string);
    expect(deleteError).toBeNull();
  });
});
