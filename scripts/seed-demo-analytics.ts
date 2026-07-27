/**
 * Synthetic demo cohort for the analytics demonstration.
 * `npm run db:seed:demo`
 *
 * WHAT THIS DOES
 * Generates 150 fictional students (STU001–STU150) and a complete set of
 * final responses for BOTH existing assignments of one existing class, so
 * the real analytics engine (migration 0012 views + migration 0017's
 * energy_source_assignment_change) has enough data to demonstrate its full
 * range: S01-heavy students, S10-heavy students, stable students,
 * high-churn students whose net movement is nevertheless zero, and
 * different directions across different energy sources.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *  - It does not create assignments or questions. It uses the ones already
 *    imported from the source spreadsheets.
 *  - It does not create, edit, approve or version a single question
 *    mapping. It fingerprints the class's mappings before and after and
 *    aborts if the fingerprint moved.
 *  - It does not invent question wording (CLAUDE.md rule 1) — it never
 *    writes to `questions` at all.
 *  - It writes through the same tables, the same constraints and the same
 *    attempt state machine real submissions use. response_value is only
 *    ever 0 or 1; the (attempt_id, question_id) unique constraint and the
 *    response_value CHECK are both left to the database to enforce.
 *
 * SAFETY
 *  - Refuses any non-local Supabase URL unless DEMO_ALLOW_REMOTE=true,
 *    exactly like scripts/seed.ts. The production-track project holds real
 *    professor and student data and must never receive synthetic rows.
 *  - Every row it writes is flagged is_synthetic = true (migration 0017),
 *    so the marker survives into every view, chart and export.
 *  - Fictional identifiers only: STU001–STU150, emails on a `.invalid`
 *    domain (reserved by RFC 2606, can never resolve), names of the form
 *    "Demo Student 001". No real name, email or roll number is used.
 *  - Fixed random seed, so two runs produce byte-identical answers.
 *
 * ENVIRONMENT
 *   DEMO_SUPABASE_URL / DEMO_SUPABASE_SERVICE_ROLE_KEY
 *     (falls back to the SEED_* / SUPABASE_TEST_* / NEXT_PUBLIC_* pairs)
 *   DEMO_STUDENT_PASSWORD    required — never defaulted, never committed
 *   DEMO_CLASS_ID            optional — otherwise auto-discovered
 *   DEMO_STUDENT_DOMAIN      default: demo.invalid
 *   DEMO_ALLOW_REMOTE=true   required to target anything non-local
 *
 * FLAGS
 *   --clean   remove this class's synthetic rows and exit
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  archetypeFor,
  baseRateFor,
  clamp01,
  driftFor,
  makeRng,
  pairedAnswer,
  RANDOM_SEED,
  STUDENT_COUNT,
  studentIdentifier,
  type Archetype,
} from "./demo-cohort";

// ---------------------------------------------------------------- env ----

function loadEnvFile(): Record<string, string> {
  const parsed: Record<string, string> = {};
  const path = resolve(".env.local");
  if (!existsSync(path)) return parsed;
  for (const line of readFileSync(path, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) parsed[m[1]!] = (m[2] ?? "").trim();
  }
  return parsed;
}

const fileEnv = loadEnvFile();
const env = (key: string, fallback?: string): string | undefined =>
  process.env[key] ?? fileEnv[key] ?? fallback;

const SUPABASE_URL =
  env("DEMO_SUPABASE_URL") ??
  env("SEED_SUPABASE_URL") ??
  env("SUPABASE_TEST_URL") ??
  env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY =
  env("DEMO_SUPABASE_SERVICE_ROLE_KEY") ??
  env("SEED_SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_TEST_SERVICE_ROLE_KEY") ??
  env("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "The demo seed needs a Supabase URL and service-role key:\n" +
      "  DEMO_SUPABASE_URL, DEMO_SUPABASE_SERVICE_ROLE_KEY\n\n" +
      '  eval "$(npx supabase status -o env | grep -E \'^(API_URL|SERVICE_ROLE_KEY)=\')"\n' +
      "  DEMO_SUPABASE_URL=$API_URL DEMO_SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \\\n" +
      "  DEMO_STUDENT_PASSWORD=... npm run db:seed:demo\n"
  );
  process.exit(1);
}

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(SUPABASE_URL);
if (!isLocal && env("DEMO_ALLOW_REMOTE") !== "true") {
  console.error(
    `Refusing to write synthetic demo data to a non-local Supabase URL:\n  ${SUPABASE_URL}\n\n` +
      "This target may be the production-track project, which holds real professor\n" +
      "and student data. Synthetic students must never be mixed into it.\n" +
      "If this is genuinely a staging project, re-run with DEMO_ALLOW_REMOTE=true."
  );
  process.exit(1);
}

const STUDENT_PASSWORD = env("DEMO_STUDENT_PASSWORD");
if (!STUDENT_PASSWORD) {
  console.error(
    "DEMO_STUDENT_PASSWORD is required and is deliberately not defaulted, so a\n" +
      "demo password is never committed to the repository."
  );
  process.exit(1);
}

const STUDENT_DOMAIN = env("DEMO_STUDENT_DOMAIN", "demo.invalid")!;
const CLASS_ID = env("DEMO_CLASS_ID");
const CLEAN_ONLY = process.argv.includes("--clean");

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------- helpers ---

function fail(step: string, detail?: string): never {
  console.error(`\n✗ ${step}${detail ? `: ${detail}` : ""}`);
  process.exit(1);
}

function die(step: string, error: { message: string } | null): void {
  if (error) fail(step, error.message);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------- types --

interface QuestionRow {
  id: string;
  external_question_code: string;
  energy_source: string | null;
  criterion: string | null;
}

interface MappingPair {
  mappingId: string;
  a1QuestionId: string;
  a2QuestionId: string;
}

// ------------------------------------------------------- class + shape ---

async function resolveClassId(): Promise<string> {
  if (CLASS_ID) return CLASS_ID;

  const { data, error } = await admin
    .from("classes")
    .select("id, name, assignments(id, sequence_number)")
    .returns<Array<{ id: string; name: string; assignments: Array<{ id: string; sequence_number: number }> }>>();
  die("listing classes", error);

  const candidates = (data ?? []).filter(
    (c) =>
      c.assignments.some((a) => a.sequence_number === 1) &&
      c.assignments.some((a) => a.sequence_number === 2)
  );

  if (candidates.length === 0) {
    fail(
      "finding a class to demo",
      "no class has both an Assignment 1 and an Assignment 2. Import the real " +
        "assignments first (npm run db:seed), then re-run."
    );
  }
  if (candidates.length > 1) {
    fail(
      "finding a class to demo",
      `${candidates.length} classes have both assignments — pass DEMO_CLASS_ID explicitly:\n` +
        candidates.map((c) => `    ${c.id}  ${c.name}`).join("\n")
    );
  }
  return candidates[0]!.id;
}

/**
 * A hash over everything about the class's mappings that could change what
 * analytics reports: identity, version, type, status, the approval flag,
 * and the exact member question ids per side. Taken before and after the
 * run; any difference aborts loudly rather than shipping a demo built on a
 * mapping this script quietly moved.
 */
async function mappingFingerprint(classId: string): Promise<{ hash: string; approvedPairs: MappingPair[] }> {
  const { data: mappings, error } = await admin
    .from("question_mappings")
    .select(
      "id, mapping_name, version, mapping_type, mapping_status, professor_approved, previous_version_id, superseded_by_id"
    )
    .eq("class_id", classId)
    .order("id")
    .returns<
      Array<{
        id: string;
        mapping_name: string;
        version: number;
        mapping_type: string;
        mapping_status: string;
        professor_approved: boolean;
        previous_version_id: string | null;
        superseded_by_id: string | null;
      }>
    >();
  die("reading question_mappings", error);

  const ids = (mappings ?? []).map((m) => m.id);
  let members: Array<{ mapping_id: string; question_id: string; mapping_side: number }> = [];
  if (ids.length > 0) {
    const { data, error: membersError } = await admin
      .from("question_mapping_members")
      .select("mapping_id, question_id, mapping_side")
      .in("mapping_id", ids)
      .order("mapping_id")
      .returns<Array<{ mapping_id: string; question_id: string; mapping_side: number }>>();
    die("reading question_mapping_members", membersError);
    members = data ?? [];
  }

  const serialised = JSON.stringify({
    mappings: (mappings ?? []).map((m) => [
      m.id,
      m.mapping_name,
      m.version,
      m.mapping_type,
      m.mapping_status,
      m.professor_approved,
      m.previous_version_id,
      m.superseded_by_id,
    ]),
    members: members
      .map((m) => [m.mapping_id, m.question_id, m.mapping_side] as const)
      .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
  });

  // The pairs the transition engine can actually use: approved, and one
  // question per side. Mirrors response_transitions_live's own rule — it is
  // read here only to steer the generated data toward interesting
  // transitions, never to reproduce the engine's maths.
  const bySide = new Map<string, { one: string[]; two: string[] }>();
  for (const m of members) {
    const entry = bySide.get(m.mapping_id) ?? { one: [], two: [] };
    (m.mapping_side === 1 ? entry.one : entry.two).push(m.question_id);
    bySide.set(m.mapping_id, entry);
  }

  const approvedPairs: MappingPair[] = [];
  for (const m of mappings ?? []) {
    if (!m.professor_approved) continue;
    if (m.mapping_type !== "EXACT_ONE_TO_ONE" && m.mapping_type !== "CONCEPTUAL_ONE_TO_ONE") continue;
    const sides = bySide.get(m.id);
    if (!sides || sides.one.length !== 1 || sides.two.length !== 1) continue;
    approvedPairs.push({ mappingId: m.id, a1QuestionId: sides.one[0]!, a2QuestionId: sides.two[0]! });
  }

  return { hash: createHash("sha256").update(serialised).digest("hex"), approvedPairs };
}

// ------------------------------------------------------------- cleanup ---

async function removeSyntheticStudents(classId: string): Promise<number> {
  const { data: members, error } = await admin
    .from("class_members")
    .select("user_id")
    .eq("class_id", classId)
    .eq("is_synthetic", true)
    .returns<Array<{ user_id: string }>>();
  if (error) {
    if (/is_synthetic/.test(error.message)) {
      fail(
        "reading synthetic enrolments",
        "the is_synthetic column does not exist yet — apply migration " +
          "0017_synthetic_demo_data.sql first (npm run db:migrate)."
      );
    }
    die("reading synthetic enrolments", error);
  }

  const ids = (members ?? []).map((m) => m.user_id);
  // Deleting the auth user cascades: profiles -> class_members,
  // assignment_attempts, responses. One delete per person, no orphans.
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    die(`removing synthetic account ${id}`, deleteError);
  }
  return ids.length;
}

// ------------------------------------------------------------ generator --

async function main(): Promise<void> {
  console.log(
    `Demo analytics seed → ${SUPABASE_URL}${isLocal ? " (local)" : " (REMOTE — explicitly allowed)"}\n`
  );

  const classId = await resolveClassId();
  const { data: classRow, error: classError } = await admin
    .from("classes")
    .select("id, name")
    .eq("id", classId)
    .maybeSingle();
  die("reading class", classError);
  if (!classRow) fail("reading class", `no class with id ${classId}`);
  console.log(`class:  ${classRow.name} (${classId})`);

  const removed = await removeSyntheticStudents(classId);
  if (removed > 0) console.log(`✓ removed ${removed} synthetic accounts from a previous run`);
  if (CLEAN_ONLY) {
    console.log("\n--clean: nothing else to do.");
    return;
  }

  // ------------------------------------------- assignments + questions ---
  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("id, title, sequence_number")
    .eq("class_id", classId)
    .order("sequence_number")
    .returns<Array<{ id: string; title: string; sequence_number: number }>>();
  die("reading assignments", assignmentsError);

  const a1 = (assignments ?? []).find((a) => a.sequence_number === 1);
  const a2 = (assignments ?? []).find((a) => a.sequence_number === 2);
  if (!a1 || !a2) {
    fail(
      "reading assignments",
      "this class needs both an Assignment 1 and an Assignment 2. This script never creates them."
    );
  }

  const questionsBySequence: Record<1 | 2, QuestionRow[]> = { 1: [], 2: [] };
  for (const [seq, assignment] of [[1, a1], [2, a2]] as const) {
    const { data, error } = await admin
      .from("questions")
      .select("id, external_question_code, energy_source, criterion")
      .eq("assignment_id", assignment.id)
      .eq("is_active", true)
      .order("display_order")
      .returns<QuestionRow[]>();
    die(`reading assignment ${seq} questions`, error);
    if (!data || data.length === 0) {
      fail(
        `reading assignment ${seq} questions`,
        "no active questions found — import the real assignment spreadsheet first."
      );
    }
    questionsBySequence[seq] = data;
  }
  console.log(
    `        A1 "${a1.title}" — ${questionsBySequence[1].length} questions\n` +
      `        A2 "${a2.title}" — ${questionsBySequence[2].length} questions`
  );

  // ----------------------------------------------- mapping fingerprint ---
  const before = await mappingFingerprint(classId);
  if (before.approvedPairs.length === 0) {
    fail(
      "reading approved mappings",
      "this class has no approved one-to-one mapping, so there is nothing for the " +
        "transition engine to report. Approve a mapping in the mapping studio first — " +
        "this script will not create or approve one."
    );
  }
  console.log(
    `        ${before.approvedPairs.length} approved one-to-one mappings (fingerprint ${before.hash.slice(0, 12)}…)\n`
  );

  // ---------------------------------------------------------- baseline ---
  // Deltas, not absolutes: the class may already hold non-synthetic
  // students, and the validation below must not claim their responses.
  const baselineTransitions = await readTransitionTotals(classId);
  const baselineSourceOnes = await readEnergySourceOnes(classId);

  // ---------------------------------------------------------- students ---
  const rng = makeRng(RANDOM_SEED);

  const existingUsers = new Map<string, string>();
  {
    let page = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      die("listing auth users", error);
      for (const u of data.users) if (u.email) existingUsers.set(u.email, u.id);
      if (data.users.length < 1000) break;
      page += 1;
    }
  }

  interface DemoStudent {
    identifier: string;
    userId: string;
    archetype: Archetype;
  }
  const students: DemoStudent[] = [];

  for (let i = 0; i < STUDENT_COUNT; i++) {
    const identifier = studentIdentifier(i);
    const email = `${identifier.toLowerCase()}@${STUDENT_DOMAIN}`;

    // A leftover account with this email but no synthetic enrolment in this
    // class would collide on the unique email; remove it rather than
    // half-failing 40 students in.
    const stale = existingUsers.get(email);
    if (stale) {
      const { error } = await admin.auth.admin.deleteUser(stale);
      die(`removing stale demo account ${email}`, error);
    }

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: STUDENT_PASSWORD,
      email_confirm: true,
    });
    die(`creating demo account ${email}`, error);
    const userId = data.user!.id;

    const { error: profileError } = await admin.from("profiles").upsert(
      {
        id: userId,
        email,
        full_name: `Demo Student ${String(i + 1).padStart(3, "0")}`,
        role: "STUDENT",
        student_identifier: identifier,
        roll_number: identifier,
        programme: "Demo programme",
        year_of_study: "1",
        section: "DEMO",
        is_active: true,
        is_synthetic: true,
      },
      { onConflict: "id" }
    );
    if (profileError && /is_synthetic/.test(profileError.message)) {
      fail(
        "creating demo profile",
        "the is_synthetic column does not exist yet — apply migration " +
          "0017_synthetic_demo_data.sql first (npm run db:migrate)."
      );
    }
    die(`creating demo profile ${email}`, profileError);

    students.push({ identifier, userId, archetype: archetypeFor(i) });

    if ((i + 1) % 25 === 0) console.log(`  … ${i + 1}/${STUDENT_COUNT} demo accounts`);
  }

  const { error: enrolError } = await admin.from("class_members").insert(
    students.map((s) => ({
      class_id: classId,
      user_id: s.userId,
      member_role: "STUDENT",
      status: "ACTIVE",
      is_synthetic: true,
    }))
  );
  die("enrolling demo students", enrolError);
  console.log(`✓ ${students.length} synthetic students enrolled\n`);

  // --------------------------------------------------------- responses ---
  // Base rate per question, plus a per-energy-source drift that pushes
  // different sources in different directions between the assignments. Both
  // are hash-derived, so the spread is deterministic and carries no
  // real-world opinion about any energy source.
  const baseRate = new Map<string, number>();
  const sourceDrift = new Map<string, number>();
  for (const seq of [1, 2] as const) {
    for (const q of questionsBySequence[seq]) {
      baseRate.set(q.id, baseRateFor(q.energy_source, q.criterion));
      const source = (q.energy_source ?? "").trim();
      if (!sourceDrift.has(source)) sourceDrift.set(source, driftFor(source));
    }
  }

  const a1PairedQuestion = new Map<string, string>(); // a2 question id -> a1 question id
  for (const pair of before.approvedPairs) a1PairedQuestion.set(pair.a2QuestionId, pair.a1QuestionId);

  // Expected counts, accumulated as the answers are generated. These are
  // the intent; the validation below compares them against what the views
  // independently report, which is what makes the check meaningful.
  const expectedTransitions = { s00: 0, s01: 0, s10: 0, s11: 0 };
  const expectedSourceOnes = new Map<string, { a1: number; a2: number }>();
  const bumpSourceOnes = (source: string, seq: 1 | 2, by: number) => {
    const entry = expectedSourceOnes.get(source) ?? { a1: 0, a2: 0 };
    if (seq === 1) entry.a1 += by;
    else entry.a2 += by;
    expectedSourceOnes.set(source, entry);
  };

  const now = new Date().toISOString();
  let responseRows = 0;

  for (const [index, student] of students.entries()) {
    const a1Answers = new Map<string, 0 | 1>();

    for (const [seq, assignment] of [[1, a1], [2, a2]] as const) {
      const { data: attempt, error: attemptError } = await admin
        .from("assignment_attempts")
        .insert({
          assignment_id: assignment.id,
          student_id: student.userId,
          state: "DRAFT",
          started_at: now,
          last_saved_at: now,
          is_synthetic: true,
        })
        .select("id")
        .single();
      die(`creating attempt (${student.identifier}, assignment ${seq})`, attemptError);

      const rows: Array<Record<string, unknown>> = [];
      for (const q of questionsBySequence[seq]) {
        const source = (q.energy_source ?? "").trim();
        const drift = sourceDrift.get(source) ?? 0;
        let value: 0 | 1;

        if (seq === 1) {
          value = rng() < baseRate.get(q.id)! ? 1 : 0;
          a1Answers.set(q.id, value);
        } else {
          const pairedA1 = a1PairedQuestion.get(q.id);
          if (pairedA1 !== undefined && a1Answers.has(pairedA1)) {
            // Mapped question: derive from the A1 answer so the archetype
            // shows up as a transition pattern, not as noise.
            const previous = a1Answers.get(pairedA1)!;
            value = pairedAnswer(previous, student.archetype, drift, rng());
            const state = `s${previous}${value}` as keyof typeof expectedTransitions;
            expectedTransitions[state] += 1;
          } else {
            // Unmapped A2 question: independent draw, nudged by the same
            // per-source drift so the per-source totals move coherently.
            value = rng() < clamp01(baseRate.get(q.id)! + drift) ? 1 : 0;
          }
        }

        if (value !== 0 && value !== 1) {
          fail("generating responses", `produced a non-binary value for ${q.external_question_code}`);
        }
        if (q.energy_source !== null) bumpSourceOnes(source, seq, value);

        rows.push({
          attempt_id: attempt!.id,
          assignment_id: assignment.id,
          student_id: student.userId,
          question_id: q.id,
          response_value: value,
          is_final: true,
          first_saved_at: now,
          last_saved_at: now,
          submitted_at: now,
          version: 1,
          is_synthetic: true,
        });
      }

      for (const batch of chunk(rows, 1000)) {
        const { error } = await admin.from("responses").insert(batch);
        die(`inserting responses (${student.identifier}, assignment ${seq})`, error);
      }
      responseRows += rows.length;

      // Real submission path: DRAFT -> SUBMITTED, which is on the
      // docs/DATABASE_SCHEMA.md transition list and is checked by the
      // attempts_state_transition trigger for every role, service_role
      // included. A state this FSM rejects would abort here.
      const { error: submitError } = await admin
        .from("assignment_attempts")
        .update({ state: "SUBMITTED", submitted_at: now })
        .eq("id", attempt!.id);
      die(`submitting attempt (${student.identifier}, assignment ${seq})`, submitError);
    }

    if ((index + 1) % 25 === 0) {
      console.log(`  … ${index + 1}/${STUDENT_COUNT} students answered (${responseRows} responses)`);
    }
  }
  console.log(`✓ ${responseRows} synthetic responses across 2 assignments\n`);

  // -------------------------------------------------------- validation ---
  await validate({
    classId,
    a1Id: a1.id,
    a2Id: a2.id,
    a1Questions: questionsBySequence[1].length,
    a2Questions: questionsBySequence[2].length,
    beforeHash: before.hash,
    baselineTransitions,
    baselineSourceOnes,
    expectedTransitions,
    expectedSourceOnes,
  });

  console.log("\n--- demo seed complete ---");
  console.log(`class_id:   ${classId}`);
  console.log(`students:   ${students.length} synthetic (STU001–STU${String(STUDENT_COUNT).padStart(3, "0")})`);
  console.log(`accounts:   stu001..stu${String(STUDENT_COUNT).padStart(3, "0")}@${STUDENT_DOMAIN}`);
  console.log(`password:   from DEMO_STUDENT_PASSWORD (not printed)`);
  console.log(`random seed: ${RANDOM_SEED} (re-running reproduces the same answers)`);
  console.log(`dashboard:  /classes/${classId}/analytics/demo`);
}

// ------------------------------------------------------- view readers ---

async function readTransitionTotals(
  classId: string
): Promise<{ s00: number; s01: number; s10: number; s11: number }> {
  const { data, error } = await admin
    .from("class_transition_summary")
    .select("s00, s01, s10, s11")
    .eq("class_id", classId)
    .maybeSingle();
  die("reading class_transition_summary", error);
  return data ?? { s00: 0, s01: 0, s10: 0, s11: 0 };
}

async function readEnergySourceOnes(classId: string): Promise<Map<string, { a1: number; a2: number }>> {
  const { data, error } = await admin
    .from("energy_source_assignment_change")
    .select("energy_source, a1_ones, a2_ones")
    .eq("class_id", classId)
    .returns<Array<{ energy_source: string; a1_ones: number | null; a2_ones: number | null }>>();
  if (error) {
    if (/energy_source_assignment_change/.test(error.message)) {
      fail(
        "reading energy_source_assignment_change",
        "the view does not exist yet — apply migration 0017_synthetic_demo_data.sql " +
          "first (npm run db:migrate)."
      );
    }
    die("reading energy_source_assignment_change", error);
  }
  const out = new Map<string, { a1: number; a2: number }>();
  for (const row of data ?? []) {
    out.set(row.energy_source, { a1: row.a1_ones ?? 0, a2: row.a2_ones ?? 0 });
  }
  return out;
}

async function countRows(
  table: string,
  filters: (q: ReturnType<SupabaseClient["from"]>) => unknown
): Promise<number> {
  const query = filters(admin.from(table)) as unknown as Promise<{
    count: number | null;
    error: { message: string } | null;
  }>;
  const { count, error } = await query;
  die(`counting ${table}`, error);
  return count ?? 0;
}

// ---------------------------------------------------------- validation ---

async function validate(ctx: {
  classId: string;
  a1Id: string;
  a2Id: string;
  a1Questions: number;
  a2Questions: number;
  beforeHash: string;
  baselineTransitions: { s00: number; s01: number; s10: number; s11: number };
  baselineSourceOnes: Map<string, { a1: number; a2: number }>;
  expectedTransitions: { s00: number; s01: number; s10: number; s11: number };
  expectedSourceOnes: Map<string, { a1: number; a2: number }>;
}): Promise<void> {
  console.log("Validating…");
  const problems: string[] = [];
  const ok = (label: string, detail: string) => console.log(`  ✓ ${label} — ${detail}`);
  const bad = (label: string, detail: string) => {
    problems.push(`${label}: ${detail}`);
    console.log(`  ✗ ${label} — ${detail}`);
  };

  // 1. The mapping is genuinely unchanged.
  const after = await mappingFingerprint(ctx.classId);
  if (after.hash === ctx.beforeHash) {
    ok("mapping unchanged", `fingerprint still ${after.hash.slice(0, 12)}…`);
  } else {
    bad("mapping unchanged", `fingerprint moved ${ctx.beforeHash.slice(0, 12)}… → ${after.hash.slice(0, 12)}…`);
  }

  // 2. 150 synthetic students, enrolled and active.
  const enrolled = await countRows("class_members", (q) =>
    q
      .select("id", { count: "exact", head: true })
      .eq("class_id", ctx.classId)
      .eq("is_synthetic", true)
      .eq("status", "ACTIVE")
  );
  if (enrolled === STUDENT_COUNT) ok("cohort size", `${enrolled} synthetic students enrolled and active`);
  else bad("cohort size", `expected ${STUDENT_COUNT} synthetic students, found ${enrolled}`);

  // 3. Complete responses on BOTH assignments. Because the database holds a
  //    unique constraint on (attempt_id, question_id) and one attempt per
  //    (assignment, student), a total of students × questions can only be
  //    reached with exactly one response per student per question — this
  //    single equality proves completeness AND the absence of duplicates.
  for (const [label, assignmentId, questionCount] of [
    ["Assignment 1", ctx.a1Id, ctx.a1Questions],
    ["Assignment 2", ctx.a2Id, ctx.a2Questions],
  ] as const) {
    const total = await countRows("responses", (q) =>
      q
        .select("id", { count: "exact", head: true })
        .eq("assignment_id", assignmentId)
        .eq("is_synthetic", true)
        .eq("is_final", true)
    );
    const expected = STUDENT_COUNT * questionCount;
    if (total === expected) {
      ok(`${label} completeness`, `${total} final responses = ${STUDENT_COUNT} × ${questionCount}, no duplicates`);
    } else {
      bad(`${label} completeness`, `expected ${expected} final responses, found ${total}`);
    }
  }

  // 4. Only 0/1 values. The CHECK constraint blocks anything else outright,
  //    so the live risk is a NULL (a submitted-blank answer), which would
  //    show up in analytics as MISSING rather than as a transition.
  const blanks = await countRows("responses", (q) =>
    q.select("id", { count: "exact", head: true }).eq("is_synthetic", true).is("response_value", null)
  );
  if (blanks === 0) ok("binary values", "every synthetic response is 0 or 1, none blank");
  else bad("binary values", `${blanks} synthetic responses have a NULL value`);

  const outOfRange = await countRows("responses", (q) =>
    q
      .select("id", { count: "exact", head: true })
      .eq("is_synthetic", true)
      .not("response_value", "in", "(0,1)")
      .not("response_value", "is", null)
  );
  if (outOfRange === 0) ok("value range", "no synthetic response outside {0, 1}");
  else bad("value range", `${outOfRange} synthetic responses outside {0, 1}`);

  // 5. Attempts finished on a state the FSM allows.
  const unsubmitted = await countRows("assignment_attempts", (q) =>
    q
      .select("id", { count: "exact", head: true })
      .eq("is_synthetic", true)
      .in("assignment_id", [ctx.a1Id, ctx.a2Id])
      .neq("state", "SUBMITTED")
  );
  if (unsubmitted === 0) ok("attempt states", `all ${STUDENT_COUNT * 2} synthetic attempts are SUBMITTED`);
  else bad("attempt states", `${unsubmitted} synthetic attempts are not SUBMITTED`);

  // 6. Transition arithmetic: what the generator intended vs what the
  //    analytics views independently computed from the stored rows.
  const actual = await readTransitionTotals(ctx.classId);
  const deltas = {
    s00: actual.s00 - ctx.baselineTransitions.s00,
    s01: actual.s01 - ctx.baselineTransitions.s01,
    s10: actual.s10 - ctx.baselineTransitions.s10,
    s11: actual.s11 - ctx.baselineTransitions.s11,
  };
  const transitionsMatch = (["s00", "s01", "s10", "s11"] as const).every(
    (k) => deltas[k] === ctx.expectedTransitions[k]
  );
  const describe = (t: typeof deltas) => `S00=${t.s00} S01=${t.s01} S10=${t.s10} S11=${t.s11}`;
  if (transitionsMatch) {
    ok("transition totals", `views agree with generated data (${describe(deltas)})`);
  } else {
    bad(
      "transition totals",
      `generated ${describe(ctx.expectedTransitions)} but views report ${describe(deltas)}`
    );
  }

  // 7. Per-energy-source totals: same cross-check, per source.
  const actualSources = await readEnergySourceOnes(ctx.classId);
  const mismatched: string[] = [];
  for (const [source, expected] of ctx.expectedSourceOnes) {
    const base = ctx.baselineSourceOnes.get(source) ?? { a1: 0, a2: 0 };
    const now = actualSources.get(source) ?? { a1: 0, a2: 0 };
    if (now.a1 - base.a1 !== expected.a1 || now.a2 - base.a2 !== expected.a2) {
      mismatched.push(
        `${source || "(no energy source)"} expected A1=${expected.a1}/A2=${expected.a2}, ` +
          `views report A1=${now.a1 - base.a1}/A2=${now.a2 - base.a2}`
      );
    }
  }
  if (mismatched.length === 0) {
    ok("per-source totals", `${ctx.expectedSourceOnes.size} energy sources agree with the views`);
  } else {
    bad("per-source totals", mismatched.slice(0, 5).join("; "));
  }

  // 8. Zero baseline handling: prove it renders as unknown, not as a number.
  const { data: changeRows, error: changeError } = await admin
    .from("energy_source_assignment_change")
    .select("energy_source, a1_ones, a2_ones, ones_relative_change, both_sides_present")
    .eq("class_id", ctx.classId)
    .returns<
      Array<{
        energy_source: string;
        a1_ones: number | null;
        a2_ones: number | null;
        ones_relative_change: number | null;
        both_sides_present: boolean;
      }>
    >();
  die("reading energy_source_assignment_change", changeError);

  const badBaseline = (changeRows ?? []).filter((r) => {
    const undefinedBaseline = r.a1_ones === null || r.a1_ones === 0 || r.a2_ones === null;
    if (undefinedBaseline) return r.ones_relative_change !== null;
    return r.ones_relative_change === null || !Number.isFinite(r.ones_relative_change);
  });
  const oneSided = (changeRows ?? []).filter((r) => !r.both_sides_present).length;
  if (badBaseline.length === 0) {
    ok(
      "zero-baseline handling",
      `${changeRows?.length ?? 0} energy sources, ${oneSided} present in only one assignment — all report “—” rather than a number`
    );
  } else {
    bad(
      "zero-baseline handling",
      `${badBaseline.length} rows report a relative change that is not defined (${badBaseline
        .slice(0, 3)
        .map((r) => r.energy_source)
        .join(", ")})`
    );
  }

  if (problems.length > 0) {
    console.error(`\n✗ validation failed (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`   - ${p}`);
    process.exit(1);
  }
  console.log("  all checks passed");
}

main().catch((err) => {
  console.error("\n✗ demo seed failed:", err);
  process.exit(1);
});
