/**
 * Synthetic demo cohort, submitted through the REAL CSV path.
 * `npm run db:seed:demo-csv`
 *
 * HOW THIS DIFFERS FROM scripts/seed-demo-analytics.ts
 * The older demo seed inserts response rows directly with a service-role
 * client. This one generates each student's answer sheet as CSV text and
 * hands it to `commitCsvSubmission` — the exact function the web upload
 * wizard calls — while signed in AS THAT STUDENT. So every row it creates
 * has been through the same parser, the same completeness and 0/1
 * validation, the same save_attempt_responses / submit_attempt RPCs, and
 * the same RLS checks a real submission goes through. If the CSV feature
 * is broken, this script fails rather than quietly producing data the
 * feature could never have produced.
 *
 * It is not a browser, though, and does not pretend to be: 150 headless
 * sign-ins are cheap, 150 browser sessions are not. The layer being proven
 * is the validation-and-commit core, which is precisely the layer the UI
 * delegates to.
 *
 * SAFETY
 *  - Refuses a non-local Supabase URL unless DEMO_ALLOW_REMOTE=true, same
 *    pattern as the existing seed:demo script.
 *  - Fingerprints the class's mappings (SHA-256) before and after and
 *    aborts if anything moved. Part 1's mappings must already exist and be
 *    approved; this script never creates, edits or approves one.
 *  - Every row it creates is flagged is_synthetic = true (migration 0017).
 *  - Fictional identities only: STU001–STU150, `.invalid` emails, names of
 *    the form "Demo Student 001". Fixed seed 20260727, so re-running
 *    reproduces the same answers.
 *
 * ENVIRONMENT
 *   DEMO_SUPABASE_URL / DEMO_SUPABASE_ANON_KEY / DEMO_SUPABASE_SERVICE_ROLE_KEY
 *   DEMO_STUDENT_PASSWORD    required
 *   DEMO_CLASS_ID            defaults to the class id below
 *   DEMO_STUDENT_DOMAIN      default: demo.invalid
 *   DEMO_ALLOW_REMOTE=true   required to target anything non-local
 *
 * FLAGS
 *   --clean          remove this class's synthetic rows and exit
 *   --limit=<n>      seed fewer than 150 students (for a quick check)
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import Papa from "papaparse";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  commitCsvSubmission,
  type CsvQuestion,
} from "../lib/attempts/commit-csv-submission";
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

const DEFAULT_CLASS_ID = "853fec6a-66d0-4470-a314-b58396f93d09";

const SUPABASE_URL =
  env("DEMO_SUPABASE_URL") ?? env("SUPABASE_TEST_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY =
  env("DEMO_SUPABASE_ANON_KEY") ?? env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY =
  env("DEMO_SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_TEST_SERVICE_ROLE_KEY") ??
  env("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "Needs a Supabase URL, anon key and service-role key:\n" +
      "  DEMO_SUPABASE_URL, DEMO_SUPABASE_ANON_KEY, DEMO_SUPABASE_SERVICE_ROLE_KEY\n\n" +
      "The service key creates the accounts; the anon key is what each student\n" +
      "signs in with, so the commit runs under that student's own RLS.\n"
  );
  process.exit(1);
}

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(SUPABASE_URL);
if (!isLocal && env("DEMO_ALLOW_REMOTE") !== "true") {
  console.error(
    `Refusing to write synthetic demo data to a non-local Supabase URL:\n  ${SUPABASE_URL}\n\n` +
      "This target may be the production-track project, which holds real professor\n" +
      "and student data.\n" +
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
const CLASS_ID = env("DEMO_CLASS_ID", DEFAULT_CLASS_ID)!;
const CLEAN_ONLY = process.argv.includes("--clean");
const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? STUDENT_COUNT
);
const COHORT_SIZE = Math.min(Math.max(1, LIMIT), STUDENT_COUNT);

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

// ------------------------------------------------- mapping fingerprint ---

/**
 * Identical in shape to the fingerprint in scripts/seed-demo-analytics.ts:
 * a hash over everything that could change what analytics reports.
 * Recomputed after seeding; any drift is a hard failure, because a demo
 * built on mappings this script moved would be a demo of the wrong thing.
 */
async function mappingFingerprint(classId: string): Promise<string> {
  const { data: mappings, error } = await admin
    .from("question_mappings")
    .select(
      "id, mapping_name, version, mapping_type, mapping_status, professor_approved, previous_version_id, superseded_by_id"
    )
    .eq("class_id", classId)
    .order("id");
  die("reading question_mappings", error);

  const ids = (mappings ?? []).map((m) => m.id as string);
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

  return createHash("sha256")
    .update(
      JSON.stringify({
        mappings,
        members: members
          .map((m) => [m.mapping_id, m.question_id, m.mapping_side] as const)
          .sort((a, b) => `${a[0]}${a[1]}`.localeCompare(`${b[0]}${b[1]}`)),
      })
    )
    .digest("hex");
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
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    die(`removing synthetic account ${id}`, deleteError);
  }
  return ids.length;
}

// ------------------------------------------------------------------ main --

interface AssignmentInfo {
  id: string;
  title: string;
  sequenceNumber: number;
  questions: CsvQuestion[];
}

async function main(): Promise<void> {
  console.log(
    `Demo seed via the CSV path → ${SUPABASE_URL}${isLocal ? " (local)" : " (REMOTE — explicitly allowed)"}\n`
  );

  const { data: classRow, error: classError } = await admin
    .from("classes")
    .select("id, name")
    .eq("id", CLASS_ID)
    .maybeSingle();
  die("reading the class", classError);
  if (!classRow) fail("reading the class", `no class with id ${CLASS_ID}`);
  console.log(`class: ${classRow.name} (${CLASS_ID})`);

  const removed = await removeSyntheticStudents(CLASS_ID);
  if (removed > 0) console.log(`✓ removed ${removed} synthetic accounts from a previous run`);
  if (CLEAN_ONLY) {
    console.log("\n--clean: nothing else to do.");
    return;
  }

  // ------------------------------------------- assignments + questions ---
  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("id, title, sequence_number, status")
    .eq("class_id", CLASS_ID)
    .neq("status", "ARCHIVED")
    .in("sequence_number", [1, 2])
    .order("sequence_number")
    .returns<Array<{ id: string; title: string; sequence_number: number; status: string }>>();
  die("reading assignments", assignmentsError);

  const a1Row = (assignments ?? []).find((a) => a.sequence_number === 1);
  const a2Row = (assignments ?? []).find((a) => a.sequence_number === 2);
  if (!a1Row || !a2Row) {
    fail(
      "reading assignments",
      "this class needs one live sequence-1 and one live sequence-2 assignment. " +
        "Run `npm run mappings:bulk -- --fix-sequence` first — see migration 0018 for why " +
        "a sequence collision disables the whole comparison."
    );
  }
  for (const a of [a1Row, a2Row]) {
    if (a.status !== "OPEN") {
      fail(
        "checking assignment status",
        `"${a.title}" is ${a.status}. save_attempt_responses and submit_attempt both ` +
          `refuse a non-OPEN assignment, so the CSV path cannot run against it. ` +
          `Open it, seed, then close it again.`
      );
    }
  }

  const loaded: AssignmentInfo[] = [];
  for (const row of [a1Row, a2Row]) {
    const { data, error } = await admin
      .from("questions")
      .select("id, external_question_code, question_text, display_order")
      .eq("assignment_id", row.id)
      .eq("is_active", true)
      .order("display_order")
      .returns<
        Array<{
          id: string;
          external_question_code: string;
          question_text: string;
          display_order: number;
        }>
      >();
    die(`reading questions for "${row.title}"`, error);
    if (!data || data.length === 0) {
      fail(`reading questions for "${row.title}"`, "no active questions found");
    }
    loaded.push({
      id: row.id,
      title: row.title,
      sequenceNumber: row.sequence_number,
      questions: data.map((q) => ({
        id: q.id,
        externalQuestionCode: q.external_question_code,
        questionText: q.question_text,
        displayOrder: q.display_order,
      })),
    });
    console.log(`  seq ${row.sequence_number}: "${row.title}" — ${data.length} questions`);
  }
  const [a1, a2] = loaded as [AssignmentInfo, AssignmentInfo];

  // ----------------------------------------------- mapping fingerprint ---
  const fingerprintBefore = await mappingFingerprint(CLASS_ID);
  const { count: approvedCount } = await admin
    .from("question_mappings")
    .select("id", { count: "exact", head: true })
    .eq("class_id", CLASS_ID)
    .eq("professor_approved", true);

  if ((approvedCount ?? 0) === 0) {
    fail(
      "checking approved mappings",
      "this class has no approved mapping, so the demo would show no transitions at all. " +
        "Run `npm run mappings:bulk` first (Part 1) — this script will not create or approve one."
    );
  }
  console.log(
    `  ${approvedCount} approved mappings (fingerprint ${fingerprintBefore.slice(0, 12)}…)\n`
  );

  // Which A2 question is paired with which A1 question, for the approved
  // one-to-one mappings. Read-only — used to steer generated answers toward
  // interesting transitions, never to reproduce the engine's arithmetic.
  const { data: memberRows, error: memberError } = await admin
    .from("approved_question_mapping_members")
    .select("mapping_id, question_id, mapping_side")
    .returns<Array<{ mapping_id: string; question_id: string; mapping_side: number }>>();
  die("reading approved mapping members", memberError);

  const sides = new Map<string, { one: string[]; two: string[] }>();
  for (const m of memberRows ?? []) {
    const entry = sides.get(m.mapping_id) ?? { one: [], two: [] };
    (m.mapping_side === 1 ? entry.one : entry.two).push(m.question_id);
    sides.set(m.mapping_id, entry);
  }
  const a1PairedQuestion = new Map<string, string>(); // a2 qid -> a1 qid
  for (const [, entry] of sides) {
    if (entry.one.length === 1 && entry.two.length === 1) {
      a1PairedQuestion.set(entry.two[0]!, entry.one[0]!);
    }
  }
  console.log(`  ${a1PairedQuestion.size} one-to-one pairs will carry transitions\n`);

  // ---------------------------------------------------------- students ---
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

  const rng = makeRng(RANDOM_SEED);
  let submitted = 0;
  const failures: Array<{ student: string; step: string; reason: string }> = [];

  for (let i = 0; i < COHORT_SIZE; i++) {
    const identifier = studentIdentifier(i);
    const email = `${identifier.toLowerCase()}@${STUDENT_DOMAIN}`;
    const archetype: Archetype = archetypeFor(i);

    // ---- account ----
    const stale = existingUsers.get(email);
    if (stale) {
      const { error } = await admin.auth.admin.deleteUser(stale);
      die(`removing stale demo account ${email}`, error);
    }
    const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
      email,
      password: STUDENT_PASSWORD!,
      email_confirm: true,
    });
    die(`creating demo account ${email}`, createError);
    const userId = createdUser.user!.id;

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
        "the is_synthetic column does not exist yet — apply migration 0017 first."
      );
    }
    die(`creating demo profile ${email}`, profileError);

    const { error: enrolError } = await admin.from("class_members").insert({
      class_id: CLASS_ID,
      user_id: userId,
      member_role: "STUDENT",
      status: "ACTIVE",
      is_synthetic: true,
    });
    die(`enrolling ${identifier}`, enrolError);

    // ---- generate this student's answers ----
    const a1Answers = new Map<string, 0 | 1>();
    const answerFor = (assignment: AssignmentInfo, q: CsvQuestion): 0 | 1 => {
      const meta = questionMeta.get(q.id);
      const source = meta?.energySource ?? "";
      const drift = driftFor(source);

      if (assignment.sequenceNumber === 1) {
        const value = rng() < baseRateFor(meta?.energySource ?? null, meta?.criterion ?? null) ? 1 : 0;
        a1Answers.set(q.id, value as 0 | 1);
        return value as 0 | 1;
      }
      const pairedA1 = a1PairedQuestion.get(q.id);
      if (pairedA1 !== undefined && a1Answers.has(pairedA1)) {
        return pairedAnswer(a1Answers.get(pairedA1)!, archetype, drift, rng());
      }
      const base = baseRateFor(meta?.energySource ?? null, meta?.criterion ?? null);
      return rng() < clamp01(base + drift) ? 1 : 0;
    };

    // ---- one CSV per assignment, submitted as this student ----
    const studentClient = createClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signInError } = await studentClient.auth.signInWithPassword({
      email,
      password: STUDENT_PASSWORD!,
    });
    if (signInError) {
      failures.push({ student: identifier, step: "sign-in", reason: signInError.message });
      continue;
    }

    for (const assignment of [a1, a2]) {
      // get_or_create_attempt runs as the student, exactly as the page does.
      const { data: attemptData, error: attemptError } = await studentClient.rpc(
        "get_or_create_attempt",
        { p_assignment_id: assignment.id }
      );
      if (attemptError) {
        failures.push({
          student: identifier,
          step: `attempt (${assignment.title})`,
          reason: attemptError.message,
        });
        continue;
      }
      const attemptId = (attemptData as { id: string }).id;

      const ordered = [...assignment.questions].sort((x, y) => x.displayOrder - y.displayOrder);
      const csvText = Papa.unparse(
        [
          ordered.map((q) => q.externalQuestionCode),
          ordered.map((q) => String(answerFor(assignment, q))),
        ],
        { newline: "\r\n" }
      );

      // THE REAL PATH — same function the upload wizard calls.
      const result = await commitCsvSubmission(studentClient, {
        attemptId,
        questions: assignment.questions,
        csvText,
      });

      if (!result.success) {
        failures.push({
          student: identifier,
          step: `submit (${assignment.title})`,
          reason: `${result.error}${
            result.issues?.length ? ` — first issue: ${result.issues[0]!.message}` : ""
          }`,
        });
        continue;
      }
      submitted += 1;
    }

    await studentClient.auth.signOut();

    // ---- tag the rows the real path just created ----
    // save_attempt_responses / submit_attempt know nothing about
    // is_synthetic, and deliberately so: provenance of a demo cohort is a
    // seeding concern, not a submission concern, and adding it to the RPC
    // would let any client mark its own answers synthetic. So the seeder
    // stamps its own rows afterwards, with the service key. The rows were
    // still created by the real validated path — this only records where
    // they came from.
    for (const [table, column] of [
      ["assignment_attempts", "student_id"],
      ["responses", "student_id"],
    ] as const) {
      const { error: tagError } = await admin
        .from(table)
        .update({ is_synthetic: true })
        .eq(column, userId);
      if (tagError) {
        failures.push({
          student: identifier,
          step: `flagging ${table} as synthetic`,
          reason: tagError.message,
        });
      }
    }

    if ((i + 1) % 25 === 0) {
      console.log(`  … ${i + 1}/${COHORT_SIZE} students (${submitted} submissions)`);
    }
  }

  console.log(`\n✓ ${submitted} submissions through the CSV commit path\n`);

  // -------------------------------------------------------- validation ---
  const problems: string[] = [];
  const ok = (label: string, detail: string) => console.log(`  ✓ ${label} — ${detail}`);
  const bad = (label: string, detail: string) => {
    problems.push(`${label}: ${detail}`);
    console.log(`  ✗ ${label} — ${detail}`);
  };

  console.log("Validating…");

  const fingerprintAfter = await mappingFingerprint(CLASS_ID);
  if (fingerprintAfter === fingerprintBefore) {
    ok("mappings unchanged", `fingerprint still ${fingerprintAfter.slice(0, 12)}…`);
  } else {
    bad(
      "mappings unchanged",
      `fingerprint moved ${fingerprintBefore.slice(0, 12)}… → ${fingerprintAfter.slice(0, 12)}…`
    );
  }

  if (failures.length === 0) ok("submissions", `all ${COHORT_SIZE} students submitted both assignments`);
  else bad("submissions", `${failures.length} failure(s)`);

  for (const assignment of [a1, a2]) {
    const { count } = await admin
      .from("responses")
      .select("id", { count: "exact", head: true })
      .eq("assignment_id", assignment.id)
      .eq("is_synthetic", true)
      .eq("is_final", true);
    const expected = COHORT_SIZE * assignment.questions.length;
    if (count === expected) {
      ok(
        `"${assignment.title}" completeness`,
        `${count} final responses = ${COHORT_SIZE} × ${assignment.questions.length}, no duplicates`
      );
    } else {
      bad(`"${assignment.title}" completeness`, `expected ${expected}, found ${count ?? 0}`);
    }
  }

  const { count: blanks } = await admin
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("is_synthetic", true)
    .is("response_value", null);
  if ((blanks ?? 0) === 0) ok("binary values", "every synthetic response is 0 or 1");
  else bad("binary values", `${blanks} synthetic responses are blank`);

  if (problems.length > 0) {
    console.error(`\n✗ validation failed (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`   - ${p}`);
    if (failures.length > 0) {
      console.error("\nSubmission failures (first 10):");
      for (const f of failures.slice(0, 10)) {
        console.error(`   - ${f.student} @ ${f.step}: ${f.reason}`);
      }
    }
    process.exit(1);
  }

  console.log("  all checks passed");
  console.log("\n--- demo seed (CSV path) complete ---");
  console.log(`class_id:    ${CLASS_ID}`);
  console.log(`students:    ${COHORT_SIZE} synthetic (STU001–${studentIdentifier(COHORT_SIZE - 1)})`);
  console.log(`accounts:    stu001..@${STUDENT_DOMAIN}`);
  console.log(`random seed: ${RANDOM_SEED} (re-running reproduces the same answers)`);
  console.log(`dashboard:   /classes/${CLASS_ID}/analytics/demo`);
}

/**
 * Question classification, needed for the answer generator's per-source
 * variation. Loaded once up front rather than per student.
 */
const questionMeta = new Map<string, { energySource: string | null; criterion: string | null }>();

async function loadQuestionMeta(): Promise<void> {
  const { data, error } = await admin
    .from("questions")
    .select("id, energy_source, criterion, assignment_id, assignments!inner(class_id)")
    .eq("assignments.class_id", CLASS_ID)
    .returns<Array<{ id: string; energy_source: string | null; criterion: string | null }>>();
  die("reading question classifications", error);
  for (const q of data ?? []) {
    questionMeta.set(q.id, { energySource: q.energy_source, criterion: q.criterion });
  }
}

loadQuestionMeta()
  .then(main)
  .catch((err) => {
    console.error("\n✗ demo seed via CSV failed:", err);
    process.exit(1);
  });
