/**
 * Demo/staging seed. `npm run db:seed`
 *
 * Creates: 1 admin, 1 professor, 1 class, 30 fictional students, the REAL
 * Assignment 1 and Assignment 2 question sets parsed from the source
 * spreadsheets, responses covering the full 0/1 range on both assignments,
 * and saved visualisations.
 *
 * SAFETY — this script refuses to run against anything that doesn't look
 * like a local Supabase stack unless SEED_ALLOW_REMOTE=true is set
 * explicitly. The production-track project holds real test data belonging
 * to the professor and must never be seeded over.
 *
 * Credentials come from environment variables and are never committed:
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *   SEED_PROFESSOR_EMAIL / SEED_PROFESSOR_PASSWORD
 *   SEED_STUDENT_PASSWORD   (shared by the fictional students)
 *   SEED_STUDENT_DOMAIN     (default: seed.invalid)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseGridWorkbook } from "../lib/imports/parse-grid";

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

const SUPABASE_URL = env("SEED_SUPABASE_URL") ?? env("SUPABASE_TEST_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY =
  env("SEED_SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_TEST_SERVICE_ROLE_KEY") ??
  env("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Seed needs a Supabase URL and service-role key. Set SEED_SUPABASE_URL and\n" +
      "SEED_SUPABASE_SERVICE_ROLE_KEY (or the SUPABASE_TEST_* pair), e.g.:\n\n" +
      '  eval "$(npx supabase status -o env | grep -E \'^(API_URL|SERVICE_ROLE_KEY)=\')"\n' +
      "  SEED_SUPABASE_URL=$API_URL SEED_SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run db:seed\n"
  );
  process.exit(1);
}

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(SUPABASE_URL);
if (!isLocal && env("SEED_ALLOW_REMOTE") !== "true") {
  console.error(
    `Refusing to seed a non-local Supabase URL:\n  ${SUPABASE_URL}\n\n` +
      "This target may be the production-track project, which holds real data.\n" +
      "If you are certain, re-run with SEED_ALLOW_REMOTE=true."
  );
  process.exit(1);
}

const ADMIN_EMAIL = env("SEED_ADMIN_EMAIL", "admin@seed.invalid")!;
const ADMIN_PASSWORD = env("SEED_ADMIN_PASSWORD");
const PROFESSOR_EMAIL = env("SEED_PROFESSOR_EMAIL", "professor@seed.invalid")!;
const PROFESSOR_PASSWORD = env("SEED_PROFESSOR_PASSWORD");
const STUDENT_PASSWORD = env("SEED_STUDENT_PASSWORD");
const STUDENT_DOMAIN = env("SEED_STUDENT_DOMAIN", "seed.invalid")!;

if (!ADMIN_PASSWORD || !PROFESSOR_PASSWORD || !STUDENT_PASSWORD) {
  console.error(
    "Seed credentials are required and must come from the environment:\n" +
      "  SEED_ADMIN_PASSWORD, SEED_PROFESSOR_PASSWORD, SEED_STUDENT_PASSWORD\n" +
      "They are deliberately not defaulted so demo passwords are never committed."
  );
  process.exit(1);
}

const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ------------------------------------------------------------- helpers ---

function die(step: string, error: { message: string } | null): void {
  if (error) {
    console.error(`\n✗ ${step}: ${error.message}`);
    process.exit(1);
  }
}

const STUDENT_NAMES = [
  "Aarav Shah", "Diya Patel", "Vivaan Mehta", "Ananya Iyer", "Aditya Rao",
  "Ishita Nair", "Arjun Desai", "Kavya Menon", "Reyansh Joshi", "Saanvi Kulkarni",
  "Kabir Bhatt", "Myra Reddy", "Advait Chawla", "Aadhya Pillai", "Rudra Sinha",
  "Anika Verma", "Vihaan Kapoor", "Navya Ghosh", "Shaurya Malhotra", "Riya Banerjee",
  "Atharv Trivedi", "Prisha Dutta", "Dhruv Saxena", "Aarohi Bose", "Ayaan Chopra",
  "Sara Qureshi", "Krishna Pandey", "Tara Bhatia", "Ved Agarwal", "Meera Sundaram",
];

/** Deterministic answer pattern that guarantees all four states appear. */
function answerPair(studentIndex: number, questionIndex: number): [0 | 1, 0 | 1] {
  const bucket = (studentIndex + questionIndex) % 4;
  if (bucket === 0) return [0, 0]; // S00
  if (bucket === 1) return [0, 1]; // S01
  if (bucket === 2) return [1, 0]; // S10
  return [1, 1]; // S11
}

async function main() {
  console.log(`Seeding ${SUPABASE_URL}${isLocal ? " (local)" : " (REMOTE — explicitly allowed)"}\n`);

  // ---------------------------------------------------------- accounts ---
  const makeUser = async (email: string, password: string, role: string, fullName: string) => {
    const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    die("listing users", existing.error);
    const found = existing.data.users.find((u) => u.email === email);
    if (found) {
      await admin.from("profiles").delete().eq("id", found.id);
      const { error } = await admin.auth.admin.deleteUser(found.id);
      die(`removing previous ${role.toLowerCase()}`, error);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    die(`creating ${role.toLowerCase()} ${email}`, error);
    const id = data.user!.id;
    const { error: profileError } = await admin.from("profiles").insert({
      id,
      email,
      full_name: fullName,
      role,
      is_active: true,
    });
    die(`creating ${role.toLowerCase()} profile`, profileError);
    return id;
  };

  const adminId = await makeUser(ADMIN_EMAIL, ADMIN_PASSWORD!, "ADMIN", "Demo Administrator");
  const professorId = await makeUser(
    PROFESSOR_EMAIL,
    PROFESSOR_PASSWORD!,
    "PROFESSOR",
    "Prof. Jinraj Joshipura (demo)"
  );
  console.log(`✓ admin + professor accounts`);

  // ------------------------------------------------------------- class ---
  const { data: classRow, error: classError } = await admin
    .from("classes")
    .insert({
      professor_id: professorId,
      name: "Energy Systems — Demo Section",
      course_name: "INS 521",
      academic_year: "2026-27",
      semester: "Winter",
      section: "A",
      class_code: `DEMO-${randomUUID().slice(0, 4).toUpperCase()}`,
      status: "ACTIVE",
    })
    .select("id")
    .single();
  die("creating class", classError);
  const classId = classRow!.id;
  console.log(`✓ class ${classId}`);

  // ---------------------------------------------------------- students ---
  const studentIds: string[] = [];
  for (const [i, name] of STUDENT_NAMES.entries()) {
    const email = `student${String(i + 1).padStart(2, "0")}@${STUDENT_DOMAIN}`;
    const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const found = existing.data.users.find((u) => u.email === email);
    if (found) {
      await admin.from("profiles").delete().eq("id", found.id);
      await admin.auth.admin.deleteUser(found.id);
    }
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: STUDENT_PASSWORD!,
      email_confirm: true,
    });
    die(`creating student ${email}`, error);
    const id = data.user!.id;
    studentIds.push(id);
    const { error: profileError } = await admin.from("profiles").insert({
      id,
      email,
      full_name: name,
      role: "STUDENT",
      roll_number: `2026${String(i + 1).padStart(3, "0")}`,
      programme: "B.Tech",
      year_of_study: "2",
      section: "A",
      is_active: true,
    });
    die(`creating student profile ${email}`, profileError);
  }
  const { error: membersError } = await admin.from("class_members").insert(
    studentIds.map((id) => ({
      class_id: classId,
      user_id: id,
      member_role: "STUDENT",
      status: "ACTIVE",
    }))
  );
  die("enrolling students", membersError);
  console.log(`✓ ${studentIds.length} students enrolled`);

  // ------------------------------------------- assignments + questions ---
  const assignmentIds: Record<1 | 2, string> = { 1: "", 2: "" };
  for (const seq of [1, 2] as const) {
    const { data, error } = await admin
      .from("assignments")
      .insert({
        class_id: classId,
        title: seq === 1 ? "Assignment 1 — Classification of Energy Sources" : "Assignment 2 — Analysis of Fuel Sources",
        assignment_stage: seq === 1 ? "PRE_INSTRUCTION" : "POST_INSTRUCTION",
        sequence_number: seq,
        created_by: professorId,
        response_zero_label: seq === 1 ? "No (0)" : "Negative (0)",
        response_one_label: seq === 1 ? "Yes (1)" : "Positive (1)",
      })
      .select("id")
      .single();
    die(`creating assignment ${seq}`, error);
    assignmentIds[seq] = data!.id;
  }

  const codeToId: Record<1 | 2, Map<string, string>> = { 1: new Map(), 2: new Map() };
  for (const seq of [1, 2] as const) {
    const file = seq === 1 ? "source-assignments/assignment-1.xlsx" : "source-assignments/assignment-2.xlsx";
    const buf = readFileSync(resolve(file));
    const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    const parsed = parseGridWorkbook(arrayBuffer, {
      codePrefix: `A${seq}`,
      worksheet: seq === 2 ? "Quantitative" : undefined,
    });
    if (parsed.errors.length > 0) {
      console.error(`✗ parsing ${file}:`, parsed.errors.slice(0, 3));
      process.exit(1);
    }
    // Insert questions directly (service role); the import RPC is exercised
    // by the integration tests, this just needs the rows to exist.
    const { data: inserted, error } = await admin
      .from("questions")
      .insert(
        parsed.questions.map((q) => ({
          assignment_id: assignmentIds[seq],
          external_question_code: q.externalQuestionCode,
          original_worksheet: parsed.worksheet,
          original_row_reference: q.originalRowReference,
          original_column_reference: q.originalColumnReference,
          question_text: q.questionText,
          energy_source: q.energySource || null,
          criterion: q.criterion || null,
          response_zero_label: q.responseZeroLabel,
          response_one_label: q.responseOneLabel,
          display_order: q.displayOrder,
          raw_source_payload: q,
        }))
      )
      .select("id, external_question_code");
    die(`inserting assignment ${seq} questions`, error);
    for (const q of inserted ?? []) codeToId[seq].set(q.external_question_code, q.id);

    const { error: importError } = await admin.from("imports").insert({
      class_id: classId,
      assignment_id: assignmentIds[seq],
      import_type: "ASSIGNMENT",
      source_filename: file,
      source_checksum: createHash("sha256").update(buf).digest("hex"),
      status: "COMPLETED",
      imported_by: professorId,
      summary: { imported: parsed.questions.length, worksheet: parsed.worksheet },
    });
    die(`recording assignment ${seq} import`, importError);

    console.log(`✓ Assignment ${seq}: ${parsed.questions.length} real questions`);
  }

  // Publish both so students can answer / analytics can run.
  for (const seq of [1, 2] as const) {
    for (const status of ["READY", "OPEN"] as const) {
      const { error } = await admin
        .from("assignments")
        .update({ status })
        .eq("id", assignmentIds[seq]);
      die(`publishing assignment ${seq} (${status})`, error);
    }
  }

  // --------------------------------------------------------- responses ---
  // Every student answers the first 20 questions of each assignment, in a
  // pattern that guarantees all four transition states are represented.
  const a1Codes = [...codeToId[1].keys()].sort().slice(0, 20);
  const a2Codes = [...codeToId[2].keys()].sort().slice(0, 20);

  for (const [studentIndex, studentId] of studentIds.entries()) {
    for (const seq of [1, 2] as const) {
      const { data: attempt, error: attemptError } = await admin
        .from("assignment_attempts")
        .insert({ assignment_id: assignmentIds[seq], student_id: studentId, state: "DRAFT" })
        .select("id")
        .single();
      die(`creating attempt (student ${studentIndex}, assignment ${seq})`, attemptError);

      const codes = seq === 1 ? a1Codes : a2Codes;
      const rows = codes.map((code, qi) => ({
        attempt_id: attempt!.id,
        assignment_id: assignmentIds[seq],
        student_id: studentId,
        question_id: codeToId[seq].get(code)!,
        response_value: answerPair(studentIndex, qi)[seq - 1],
        is_final: true,
        submitted_at: new Date().toISOString(),
      }));
      const { error: responsesError } = await admin.from("responses").insert(rows);
      die(`inserting responses (student ${studentIndex}, assignment ${seq})`, responsesError);

      const { error: submitError } = await admin
        .from("assignment_attempts")
        .update({ state: "SUBMITTED", submitted_at: new Date().toISOString() })
        .eq("id", attempt!.id);
      die(`submitting attempt (student ${studentIndex}, assignment ${seq})`, submitError);
    }
  }
  console.log(`✓ responses for ${studentIds.length} students × ${a1Codes.length * 2} questions`);

  // --------------------------------------------- saved visualisations ---
  const savedItems = [
    {
      name: "% choosing 1 — Yes by energy source (Assignment 2)",
      chart_type: "BAR",
      query_definition: {
        dataset: "A2_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["ENERGY_SOURCE"],
        filters: [],
        chartType: "BAR",
      },
    },
    {
      name: "Energy source × criterion (Assignment 1)",
      chart_type: "HEATMAP",
      query_definition: {
        dataset: "A1_RESPONSES",
        measure: "PCT_ONE",
        dimensions: ["ENERGY_SOURCE", "CRITERION"],
        filters: [],
        chartType: "HEATMAP",
      },
    },
    {
      name: "Consensus by energy source (Assignment 1)",
      chart_type: "BAR",
      query_definition: {
        dataset: "A1_RESPONSES",
        measure: "CONSENSUS",
        dimensions: ["ENERGY_SOURCE"],
        filters: [],
        chartType: "BAR",
      },
    },
  ];
  const { data: visualisations, error: visError } = await admin
    .from("saved_visualisations")
    .insert(
      savedItems.map((v) => ({ ...v, class_id: classId, created_by: professorId }))
    )
    .select("id");
  die("creating saved visualisations", visError);

  const { data: dashboard, error: dashError } = await admin
    .from("dashboards")
    .insert({ class_id: classId, created_by: professorId, name: "Demo dashboard" })
    .select("id")
    .single();
  die("creating dashboard", dashError);

  const { error: itemsError } = await admin.from("dashboard_items").insert(
    (visualisations ?? []).map((v, i) => ({
      dashboard_id: dashboard!.id,
      saved_visualisation_id: v.id,
      position: i,
    }))
  );
  die("creating dashboard items", itemsError);
  console.log(`✓ ${savedItems.length} saved visualisations + 1 dashboard`);

  // ------------------------------------------------------------ report ---
  const { data: check } = await admin
    .from("assignment_response_summary")
    .select("assignment_id, answered_responses, respondents, avg_consensus")
    .eq("class_id", classId);

  console.log("\n--- seed complete ---");
  console.log(`class_id:    ${classId}`);
  console.log(`admin:       ${ADMIN_EMAIL}`);
  console.log(`professor:   ${PROFESSOR_EMAIL}`);
  console.log(`students:    student01..student${String(studentIds.length).padStart(2, "0")}@${STUDENT_DOMAIN}`);
  console.log(`passwords:   from SEED_*_PASSWORD env vars (not printed)`);
  for (const row of check ?? []) {
    console.log(
      `analytics:   assignment ${row.assignment_id} — ${row.answered_responses} answered ` +
        `responses from ${row.respondents} students (avg consensus ${row.avg_consensus})`
    );
  }
  void adminId;
}

main().catch((err) => {
  console.error("\n✗ seed failed:", err);
  process.exit(1);
});
