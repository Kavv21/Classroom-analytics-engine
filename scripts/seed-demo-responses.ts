/**
 * Synthetic response cohort, submitted through the REAL CSV path.
 * `npm run db:seed:demo-responses`
 *
 * WHY THIS EXISTS
 * Migration 0022 removed the question-mapping and transition engine, and
 * with it the 150 synthetic students that existed to demonstrate
 * transitions. That was correct — those rows described a feature that no
 * longer exists — but it left the surviving single-assignment aggregates
 * (the response grid, per-question consensus/disagreement/entropy, the
 * response distributions) with only a few dozen real test responses to
 * describe. This script refills them.
 *
 * It has NO dependency on mappings, transitions or any pairing of one
 * student's Assignment 1 answer with their Assignment 2 answer. Each
 * assignment is answered on its own terms; the two are never linked, per
 * CLAUDE.md rule 4. Every figure the seeded data feeds describes one
 * assignment.
 *
 * HOW THE ROWS ARE WRITTEN
 * Each student's answer sheet is generated as CSV text and handed to
 * `commitCsvSubmission` while signed in AS THAT STUDENT. Students no longer
 * upload files — they fill the live grid in the browser
 * (components/attempts/answer-grid.tsx) — but both paths end in the same
 * place: `commitAnswerSet` (lib/attempts/commit-answers.ts), which owns the
 * 0/1 validation, the "commit only if the whole set is valid" rule and the
 * save_attempt_responses / submit_attempt RPCs. So every row here has been
 * through the same validation-and-commit core, the same RPCs and the same
 * RLS checks a real submission goes through. CSV is simply this script's
 * way of expressing a full answer sheet in text; it is not a student-facing
 * feature any more.
 *
 * SAFETY
 *  - Refuses a non-local Supabase URL unless SEED_ALLOW_REMOTE=true, the
 *    same guard as scripts/seed.ts.
 *  - SEED_STUDENT_PASSWORD is required and deliberately never defaulted,
 *    so a demo password is never committed.
 *  - Every row it creates carries is_synthetic = true (migration 0017),
 *    set by the service role because anon/authenticated cannot raise that
 *    flag (migration 0020). `--clean` removes exactly those rows.
 *  - Fictional identities only: STU001–STU150, `.invalid` email addresses,
 *    names of the form "Demo Student 001". Fixed seed, so re-running
 *    reproduces the same answers.
 *  - It never creates, edits or publishes a question, an assignment or a
 *    class. If the class isn't already set up, it stops.
 *
 * ENVIRONMENT
 *   SEED_SUPABASE_URL / SEED_SUPABASE_ANON_KEY /
 *   SEED_SUPABASE_SERVICE_ROLE_KEY   (SUPABASE_TEST_* / NEXT_PUBLIC_* are
 *                                     accepted as fallbacks)
 *   SEED_STUDENT_PASSWORD    required, never defaulted
 *   SEED_CLASS_ID            required only if the project holds more than
 *                            one class
 *   SEED_STUDENT_DOMAIN      default: demo.invalid
 *   SEED_ALLOW_REMOTE=true   required to target anything non-local
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
  env("SEED_SUPABASE_URL") ?? env("SUPABASE_TEST_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY =
  env("SEED_SUPABASE_ANON_KEY") ??
  env("SUPABASE_TEST_ANON_KEY") ??
  env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE_KEY =
  env("SEED_SUPABASE_SERVICE_ROLE_KEY") ??
  env("SUPABASE_TEST_SERVICE_ROLE_KEY") ??
  env("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error(
    "Needs a Supabase URL, anon key and service-role key:\n" +
      "  SEED_SUPABASE_URL, SEED_SUPABASE_ANON_KEY, SEED_SUPABASE_SERVICE_ROLE_KEY\n\n" +
      "The service key creates the accounts; the anon key is what each student\n" +
      "signs in with, so the commit runs under that student's own RLS.\n"
  );
  process.exit(1);
}

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(SUPABASE_URL);
if (!isLocal && env("SEED_ALLOW_REMOTE") !== "true") {
  console.error(
    `Refusing to write synthetic demo data to a non-local Supabase URL:\n  ${SUPABASE_URL}\n\n` +
      "This target may be the production-track project, which holds real professor\n" +
      "and student data.\n" +
      "If this is genuinely a demo or staging project, re-run with SEED_ALLOW_REMOTE=true."
  );
  process.exit(1);
}

const STUDENT_PASSWORD = env("SEED_STUDENT_PASSWORD");
if (!STUDENT_PASSWORD) {
  console.error(
    "SEED_STUDENT_PASSWORD is required and is deliberately not defaulted, so a\n" +
      "demo password is never committed to the repository."
  );
  process.exit(1);
}

const STUDENT_DOMAIN = env("SEED_STUDENT_DOMAIN", "demo.invalid")!;
const CLASS_ID = env("SEED_CLASS_ID");
const CLEAN_ONLY = process.argv.includes("--clean");

/** The full cohort. 150 keeps every per-question figure comfortably above
 *  the point where one student moves a percentage by more than a point. */
const STUDENT_COUNT = 150;

/** Fixed seed — reproducibility is a requirement, not a nicety. */
const RANDOM_SEED = 20260801;

const LIMIT = Number(
  process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? STUDENT_COUNT
);
if (!Number.isFinite(LIMIT) || LIMIT < 1) {
  console.error("--limit must be a positive whole number of students.");
  process.exit(1);
}
const COHORT_SIZE = Math.min(Math.floor(LIMIT), STUDENT_COUNT);

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

// ------------------------------------------------- answer generation ----

/**
 * The deterministic core: what 150 fictional students answer.
 *
 * Nothing here computes an analytic. It only produces 0s and 1s; every
 * rate, consensus figure and entropy in the app is computed by the real
 * views from the rows these answers become.
 *
 * It also encodes no stance about any energy source or criterion. A
 * question's lean comes from a hash of its own classification strings, so
 * the cohort disagrees about different questions by different amounts —
 * which is what makes consensus and entropy worth looking at — without the
 * seed asserting anything about the subject matter.
 */

/** mulberry32 — small, fast, fully deterministic from a 32-bit seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable [0,1) from a string. */
function hashUnit(text: string): number {
  return createHash("sha256").update(text).digest().readUInt32BE(0) / 4294967296;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * A question's base probability of being answered 1, in [0.1, 0.9]. The
 * spread is deliberate: questions near 0.5 produce high disagreement and
 * high entropy, questions near the ends produce strong consensus, so the
 * per-question figures have something to distinguish.
 */
function baseRateFor(question: {
  externalQuestionCode: string;
  energySource?: string | null;
  criterion?: string | null;
}): number {
  const key = `${question.energySource ?? ""}|${question.criterion ?? ""}|${question.externalQuestionCode}`;
  return 0.1 + hashUnit(key) * 0.8;
}

/**
 * How far one student sits from the cohort's lean, in [-0.2, +0.2].
 * Applied to every question that student answers, so a student is
 * recognisably themselves across the sheet rather than 285 coin flips.
 */
function studentLean(index: number): number {
  return hashUnit(`student-lean:${index}`) * 0.4 - 0.2;
}

function studentIdentifier(index: number): string {
  return `STU${String(index + 1).padStart(3, "0")}`;
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
    // profiles.id references auth.users ON DELETE CASCADE, and responses /
    // assignment_attempts / class_members cascade from the profile, so
    // removing the auth row removes the whole synthetic student.
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

/** The class to seed: named explicitly, or inferred only when there is no
 *  ambiguity. Guessing between several classes is how the wrong cohort
 *  ends up in someone's live analytics. */
async function resolveClassId(): Promise<{ id: string; name: string }> {
  if (CLASS_ID) {
    const { data, error } = await admin
      .from("classes")
      .select("id, name")
      .eq("id", CLASS_ID)
      .maybeSingle();
    die("reading the class", error);
    if (!data) fail("reading the class", `no class with id ${CLASS_ID}`);
    return { id: data.id as string, name: data.name as string };
  }

  const { data, error } = await admin
    .from("classes")
    .select("id, name")
    .order("created_at")
    .returns<Array<{ id: string; name: string }>>();
  die("listing classes", error);
  const classes = data ?? [];
  if (classes.length === 1) return classes[0]!;
  if (classes.length === 0) fail("listing classes", "this project has no classes to seed");
  fail(
    "listing classes",
    `this project has ${classes.length} classes, so the target must be explicit. ` +
      `Set SEED_CLASS_ID to one of:\n` +
      classes.map((c) => `    ${c.id}  ${c.name}`).join("\n")
  );
}

async function main(): Promise<void> {
  console.log(
    `Synthetic response seed via the CSV path → ${SUPABASE_URL}${
      isLocal ? " (local)" : " (REMOTE — explicitly allowed)"
    }\n`
  );

  const classRow = await resolveClassId();
  const classId = classRow.id;
  console.log(`class: ${classRow.name} (${classId})`);

  const removed = await removeSyntheticStudents(classId);
  if (removed > 0) console.log(`✓ removed ${removed} synthetic accounts from a previous run`);
  if (CLEAN_ONLY) {
    console.log("\n--clean: nothing else to do.");
    return;
  }

  // ------------------------------------------- assignments + questions ---
  const { data: assignments, error: assignmentsError } = await admin
    .from("assignments")
    .select("id, title, sequence_number, status")
    .eq("class_id", classId)
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
        "This script never creates or publishes one — import them first."
    );
  }
  // A CLOSED assignment is fine. Migration 0020 lets a SYNTHETIC attempt be
  // written to an assignment that has been published, whatever its current
  // status — the assignment is never reopened and the FSM is untouched.
  // DRAFT/READY are still refused: their questions may still be changing.
  for (const a of [a1Row, a2Row]) {
    if (!["OPEN", "CLOSED"].includes(a.status)) {
      fail(
        "checking assignment status",
        `"${a.title}" is ${a.status}. Synthetic seeding needs an assignment that has been ` +
          `published at least once — a DRAFT or READY assignment may still be having its ` +
          `questions imported, and seeding would attach responses to questions that are ` +
          `about to change.`
      );
    }
    if (a.status !== "OPEN") {
      console.log(
        `  note: "${a.title}" is ${a.status}. Seeding proceeds through the synthetic path ` +
          `(migration 0020) — the assignment is NOT reopened.`
      );
    }
  }

  const loaded: AssignmentInfo[] = [];
  for (const row of [a1Row, a2Row]) {
    const { data, error } = await admin
      .from("questions")
      .select("id, external_question_code, question_text, display_order, energy_source, criterion")
      .eq("assignment_id", row.id)
      .eq("is_active", true)
      .order("display_order")
      .returns<
        Array<{
          id: string;
          external_question_code: string;
          question_text: string;
          display_order: number;
          energy_source: string | null;
          criterion: string | null;
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
        energySource: q.energy_source,
        criterion: q.criterion,
      })),
    });
    console.log(`  seq ${row.sequence_number}: "${row.title}" — ${data.length} questions`);
  }
  const [a1, a2] = loaded as [AssignmentInfo, AssignmentInfo];
  const totalQuestions = a1.questions.length + a2.questions.length;
  console.log(
    `\nSeeding ${COHORT_SIZE} students × ${totalQuestions} questions ` +
      `(${COHORT_SIZE * totalQuestions} responses), random seed ${RANDOM_SEED}\n`
  );

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
    const lean = studentLean(i);

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
      class_id: classId,
      user_id: userId,
      member_role: "STUDENT",
      status: "ACTIVE",
      is_synthetic: true,
    });
    die(`enrolling ${identifier}`, enrolError);

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
      // The attempt is created with the SERVICE ROLE and flagged synthetic
      // up front — not via get_or_create_attempt, which requires an OPEN
      // assignment, and not tagged afterwards, because the flag is what
      // authorises the writes that follow (migration 0020).
      //
      // Migration 0020's trigger means anon/authenticated cannot raise this
      // flag, so this service-role insert is the only way a synthetic
      // attempt comes into existence. The attempt FSM still applies: a new
      // row may only start as NOT_STARTED or DRAFT.
      const { data: attemptRow, error: attemptError } = await admin
        .from("assignment_attempts")
        .upsert(
          {
            assignment_id: assignment.id,
            student_id: userId,
            state: "DRAFT",
            started_at: new Date().toISOString(),
            is_synthetic: true,
          },
          { onConflict: "assignment_id,student_id" }
        )
        .select("id")
        .single();
      if (attemptError) {
        failures.push({
          student: identifier,
          step: `attempt (${assignment.title})`,
          reason: attemptError.message,
        });
        continue;
      }
      const attemptId = attemptRow!.id;

      // Each assignment is answered independently. There is no carry-over
      // from this student's Assignment 1 answers to their Assignment 2
      // answers, and there must not be: nothing downstream may pair them
      // (CLAUDE.md rule 4).
      const ordered = [...assignment.questions].sort((x, y) => x.displayOrder - y.displayOrder);
      const csvText = Papa.unparse(
        [
          ordered.map((q) => q.externalQuestionCode),
          ordered.map((q) => (rng() < clamp01(baseRateFor(q) + lean) ? "1" : "0")),
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

    // No post-hoc tagging: save_attempt_responses copies is_synthetic from
    // the attempt onto every response it writes (migration 0020), so
    // provenance is set by the same call that creates the row rather than
    // by a second pass that could miss some.

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

  if (failures.length === 0) {
    ok("submissions", `all ${COHORT_SIZE} students submitted both assignments`);
  } else {
    bad("submissions", `${failures.length} failure(s)`);
  }

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

  // The point of the exercise: the per-assignment aggregates have data
  // again, and it varies from question to question rather than being 150
  // copies of the same sheet.
  for (const assignment of [a1, a2]) {
    const { data: summary, error } = await admin
      .from("question_response_summary")
      .select("pct_one, consensus")
      .eq("assignment_id", assignment.id)
      .returns<Array<{ pct_one: number | null; consensus: number | null }>>();
    die(`reading question_response_summary for "${assignment.title}"`, error);
    const pcts = (summary ?? [])
      .map((r) => r.pct_one)
      .filter((v): v is number => v !== null);
    if (pcts.length !== assignment.questions.length) {
      bad(
        `"${assignment.title}" aggregates`,
        `${pcts.length} of ${assignment.questions.length} questions have a % choosing 1`
      );
      continue;
    }
    // pct_one is a fraction in [0,1] (see the view definition), shown here
    // as points for readability.
    const spread = (Math.max(...pcts) - Math.min(...pcts)) * 100;
    if (spread > 20) {
      ok(
        `"${assignment.title}" aggregates`,
        `${pcts.length} questions, % choosing 1 spans ` +
          `${(Math.min(...pcts) * 100).toFixed(1)}–${(Math.max(...pcts) * 100).toFixed(1)}`
      );
    } else {
      bad(
        `"${assignment.title}" aggregates`,
        `% choosing 1 varies by only ${spread.toFixed(1)} points across questions — ` +
          `the cohort is too uniform to be worth charting`
      );
    }
  }

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
  console.log("\n--- synthetic response seed complete ---");
  console.log(`class_id:    ${classId}`);
  console.log(
    `students:    ${COHORT_SIZE} synthetic (STU001–${studentIdentifier(COHORT_SIZE - 1)})`
  );
  console.log(`accounts:    stu001..@${STUDENT_DOMAIN}`);
  console.log(`random seed: ${RANDOM_SEED} (re-running reproduces the same answers)`);
  console.log(`remove with: npm run db:seed:demo-responses -- --clean`);
}

main().catch((err) => {
  console.error("\n✗ synthetic response seed failed:", err);
  process.exit(1);
});
