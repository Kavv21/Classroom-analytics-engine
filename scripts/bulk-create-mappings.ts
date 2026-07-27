/**
 * Bulk-create and approve question mappings from the pre-computed
 * suggestion template. `npm run mappings:bulk`
 *
 * WHY A SCRIPT AND NOT THE STUDIO
 * The split-screen mapping studio is a per-mapping tool. Creating thirty
 * mappings through it is thirty rounds of select-select-name-save. This
 * does the same thing from data/question-mapping-template.json, which was
 * produced by the deterministic suggestion engine in Phase 6 — no LLM, no
 * invented wording (EXCLUDED_FEATURES.md).
 *
 * IT GOES THROUGH THE REAL RPCs — never a raw INSERT.
 *   create_question_mapping  (0011) validates side counts per mapping type,
 *                            resolves each question to its class's
 *                            sequence-1/sequence-2 assignment, derives
 *                            mapping_side server-side, and writes the
 *                            member rows.
 *   set_mapping_approval     (0011) flips professor_approved, retires
 *                            superseded versions, and writes the audit row.
 * A direct INSERT would bypass all of that, plus the immutability triggers
 * that protect an approved mapping. Mappings are always created unapproved
 * and approved in a second step, exactly as the UI does it.
 *
 * AUTHENTICATION — this script signs in AS THE PROFESSOR, not as
 * service_role. Both RPCs are `security invoker` and gate on
 * `is_professor_of_class(...)`, which reads `auth.uid()`. service_role
 * bypasses RLS but has no auth.uid(), so every call would be rejected with
 * "class not found, or you are not its professor". Running as the real
 * professor is also the honest thing: these mappings are their editorial
 * decision and the audit log should say so.
 *
 * ENVIRONMENT
 *   MAPPINGS_SUPABASE_URL / MAPPINGS_SUPABASE_ANON_KEY
 *     (falls back to NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)
 *   MAPPINGS_PROFESSOR_EMAIL / MAPPINGS_PROFESSOR_PASSWORD   required
 *   MAPPINGS_CLASS_ID       defaults to the class id below
 *   MAPPINGS_ALLOW_REMOTE=true   required to target a non-local database
 *
 * FLAGS
 *   --dry-run        report what would happen, write nothing
 *   --fix-sequence   repair a duplicate/missing assignment sequence number
 *   --cleanup-duplicate=<assignmentId>
 *                    delete (if it has no responses) or archive (if it
 *                    does) a duplicate assignment
 *   --no-approve     create the mappings but approve nothing
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const SUPABASE_URL = env("MAPPINGS_SUPABASE_URL") ?? env("NEXT_PUBLIC_SUPABASE_URL");
const ANON_KEY = env("MAPPINGS_SUPABASE_ANON_KEY") ?? env("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const PROFESSOR_EMAIL = env("MAPPINGS_PROFESSOR_EMAIL");
const PROFESSOR_PASSWORD = env("MAPPINGS_PROFESSOR_PASSWORD");
const CLASS_ID = env("MAPPINGS_CLASS_ID", DEFAULT_CLASS_ID)!;

const DRY_RUN = process.argv.includes("--dry-run");
const FIX_SEQUENCE = process.argv.includes("--fix-sequence");
const NO_APPROVE = process.argv.includes("--no-approve");
const CLEANUP_DUPLICATE =
  process.argv.find((a) => a.startsWith("--cleanup-duplicate="))?.split("=")[1] ?? null;

if (!SUPABASE_URL || !ANON_KEY) {
  console.error(
    "Needs a Supabase URL and anon key:\n" +
      "  MAPPINGS_SUPABASE_URL, MAPPINGS_SUPABASE_ANON_KEY\n" +
      "(or the NEXT_PUBLIC_* pair from .env.local)\n"
  );
  process.exit(1);
}
if (!PROFESSOR_EMAIL || !PROFESSOR_PASSWORD) {
  console.error(
    "MAPPINGS_PROFESSOR_EMAIL and MAPPINGS_PROFESSOR_PASSWORD are required.\n\n" +
      "These RPCs are security-invoker and check is_professor_of_class(auth.uid()),\n" +
      "so the script has to act as the professor who owns the class. A service-role\n" +
      "key would be rejected — it has no auth.uid(). Credentials come from the\n" +
      "environment and are never committed."
  );
  process.exit(1);
}

const isLocal = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?/.test(SUPABASE_URL);
if (!isLocal && env("MAPPINGS_ALLOW_REMOTE") !== "true" && !DRY_RUN) {
  console.error(
    `Refusing to write mappings to a non-local Supabase URL:\n  ${SUPABASE_URL}\n\n` +
      "Mappings are load-bearing: once approved they are frozen by the 0011\n" +
      "immutability triggers and can only be superseded by a new version, so a\n" +
      "mistake here is not simply undoable.\n\n" +
      "Re-run with --dry-run to preview, or MAPPINGS_ALLOW_REMOTE=true to proceed."
  );
  process.exit(1);
}

// ------------------------------------------------------------- helpers ---

function fail(step: string, detail?: string): never {
  console.error(`\n✗ ${step}${detail ? `: ${detail}` : ""}`);
  process.exit(1);
}

interface TemplateMapping {
  id: string;
  assignment_1_question_ids: string[];
  assignment_2_question_ids: string[];
  mapping_name: string;
  common_concept: string | null;
  energy_source: string | null;
  criterion: string | null;
  mapping_type: string;
  comparison_method: string | null;
  professor_notes: string | null;
  mapping_status: string;
  professor_approved: boolean;
}

/** Only these two types can produce transitions, so only these get approved
 *  automatically. Everything else is recorded and left for the professor. */
const APPROVABLE_TYPES = new Set(["EXACT_ONE_TO_ONE", "CONCEPTUAL_ONE_TO_ONE"]);

// --------------------------------------------------------- preflight -----

interface AssignmentRow {
  id: string;
  title: string;
  sequence_number: number;
  status: string;
  created_at: string;
}

/**
 * The sequence-number preflight.
 *
 * `assignments.sequence_number` decides which side of a mapping a question
 * lands on (create_question_mapping derives mapping_side from it) and which
 * assignment validate_mapping_questions resolves as "Assignment 2". If a
 * class has two sequence-1 assignments and no sequence-2 assignment, every
 * one-to-one mapping below is rejected outright — so this runs first and
 * explains the situation rather than emitting thirty identical failures.
 */
async function preflightSequence(
  supabase: SupabaseClient,
  classId: string
): Promise<{ a1: AssignmentRow; a2: AssignmentRow }> {
  const { data, error } = await supabase
    .from("assignments")
    .select("id, title, sequence_number, status, created_at")
    .eq("class_id", classId)
    .order("created_at")
    .returns<AssignmentRow[]>();
  if (error) fail("reading assignments", error.message);

  const live = (data ?? []).filter((a) => a.status !== "ARCHIVED");
  console.log(`Assignments in this class (${live.length} live):`);
  for (const a of data ?? []) {
    console.log(
      `  seq ${a.sequence_number}  ${a.status.padEnd(8)}  ${a.title}  (${a.id})`
    );
  }
  console.log("");

  const bySeq = new Map<number, AssignmentRow[]>();
  for (const a of live) {
    bySeq.set(a.sequence_number, [...(bySeq.get(a.sequence_number) ?? []), a]);
  }

  const duplicates = [...bySeq.entries()].filter(([, rows]) => rows.length > 1);
  const a1List = bySeq.get(1) ?? [];
  const a2List = bySeq.get(2) ?? [];

  if (duplicates.length === 0 && a1List.length === 1 && a2List.length === 1) {
    console.log(`✓ sequence numbers are correct (1 = "${a1List[0]!.title}", 2 = "${a2List[0]!.title}")\n`);
    return { a1: a1List[0]!, a2: a2List[0]! };
  }

  // ---- something is wrong; explain it precisely ----
  console.log("✗ SEQUENCE NUMBER PROBLEM\n");
  for (const [seq, rows] of duplicates) {
    console.log(`  ${rows.length} live assignments share sequence ${seq}:`);
    for (const r of rows) console.log(`     - "${r.title}" (${r.id})`);
  }
  if (a2List.length === 0) console.log("  No assignment has sequence 2.");

  console.log(
    "\n  Why this blocks everything:\n" +
      "    create_question_mapping derives mapping_side from sequence_number, and\n" +
      "    validate_mapping_questions resolves side 2 as 'this class's sequence-2\n" +
      "    assignment'. With no sequence-2 assignment, every one-to-one mapping is\n" +
      "    rejected. Any mapping that did get through would have both members on\n" +
      "    side 1, which response_transitions_live reports as NOT_COMPARABLE — the\n" +
      "    analytics pages would show 'no data' rather than an error.\n" +
      "    Per-assignment aggregates also SUM two sequence-1 assignments together,\n" +
      "    inflating Assignment 1 totals."
  );

  if (!FIX_SEQUENCE) {
    fail(
      "sequence preflight",
      "re-run with --fix-sequence to repair this, or fix it in the assignment " +
        "edit form (the 'Which assignment is this?' field)."
    );
  }

  // ---- repair ----
  // Only one shape is safe to repair without guessing: exactly two live
  // assignments, both on the same sequence. The later-created one becomes
  // the second assignment. Anything else needs a human decision about which
  // assignment is which, and this script will not make it.
  if (live.length !== 2 || duplicates.length !== 1 || a2List.length !== 0) {
    fail(
      "--fix-sequence",
      `cannot repair this automatically — it needs a decision about which assignment ` +
        `is the second one. Set it in the assignment edit form instead. ` +
        `(Found ${live.length} live assignments, ${duplicates.length} duplicated sequence(s).)`
    );
  }

  const [first, second] = [...live].sort((a, b) => a.created_at.localeCompare(b.created_at));
  console.log(
    `\n  Repair: "${second!.title}" becomes sequence 2 ` +
      `(it was created later than "${first!.title}").`
  );
  if (DRY_RUN) {
    console.log("  --dry-run: not applied.\n");
    return { a1: first!, a2: { ...second!, sequence_number: 2 } };
  }

  const { error: fixError } = await supabase
    .from("assignments")
    .update({ sequence_number: 2, updated_at: new Date().toISOString() })
    .eq("id", second!.id);
  if (fixError) fail("applying sequence repair", fixError.message);
  console.log("  ✓ applied\n");

  return { a1: first!, a2: { ...second!, sequence_number: 2 } };
}

/**
 * Duplicate-assignment cleanup. Responses are never destroyed: an
 * assignment that has any response is archived, not deleted.
 *
 * Archiving alone is not enough, though. An archived duplicate keeps its
 * sequence number, and the per-assignment analytics views join questions to
 * assignments with no status filter — so an archived sequence-1 duplicate
 * would still be summed into Assignment 1's totals. It is therefore also
 * moved out of the 1/2 comparison range.
 */
async function cleanupDuplicate(supabase: SupabaseClient, assignmentId: string): Promise<void> {
  console.log(`Duplicate cleanup for ${assignmentId}`);

  const { data: assignment, error } = await supabase
    .from("assignments")
    .select("id, class_id, title, sequence_number, status")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) fail("reading the duplicate assignment", error.message);
  if (!assignment) fail("reading the duplicate assignment", `no assignment with id ${assignmentId}`);
  if (assignment.class_id !== CLASS_ID) {
    fail(
      "duplicate cleanup",
      `assignment ${assignmentId} belongs to class ${assignment.class_id}, not ${CLASS_ID}`
    );
  }

  const { count: responseCount, error: countError } = await supabase
    .from("responses")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);
  if (countError) fail("counting responses on the duplicate", countError.message);

  const { count: questionCount } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignmentId);

  console.log(
    `  "${assignment.title}" — ${responseCount ?? 0} responses, ${questionCount ?? 0} questions`
  );

  if ((responseCount ?? 0) === 0) {
    console.log("  No responses → safe to delete.");
    if (DRY_RUN) {
      console.log("  --dry-run: not applied.\n");
      return;
    }
    const { error: deleteError } = await supabase
      .from("assignments")
      .delete()
      .eq("id", assignmentId);
    if (deleteError) fail("deleting the duplicate assignment", deleteError.message);
    console.log("  ✓ deleted\n");
    return;
  }

  // Has responses → archive, and move it out of the comparison range so it
  // stops being double-counted as Assignment 1.
  const parkedSequence = 900 + (assignment.sequence_number ?? 1);
  console.log(
    `  Has responses → archiving instead of deleting, and moving it to ` +
      `sequence ${parkedSequence} so per-assignment totals stop counting it as ` +
      `Assignment ${assignment.sequence_number}.`
  );
  if (DRY_RUN) {
    console.log("  --dry-run: not applied.\n");
    return;
  }

  // ARCHIVED must be reachable from the current status under the
  // assignments_status_transition trigger; go through the front door.
  const { error: archiveError } = await supabase
    .from("assignments")
    .update({ status: "ARCHIVED", updated_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (archiveError) {
    fail(
      "archiving the duplicate assignment",
      `${archiveError.message}\n  (the status FSM may not allow ${assignment.status} → ARCHIVED; ` +
        `move it to CLOSED first)`
    );
  }
  const { error: parkError } = await supabase
    .from("assignments")
    .update({ sequence_number: parkedSequence, updated_at: new Date().toISOString() })
    .eq("id", assignmentId);
  if (parkError) fail("renumbering the archived duplicate", parkError.message);
  console.log("  ✓ archived and renumbered\n");
}

// ------------------------------------------------------------------ main --

async function main(): Promise<void> {
  console.log(
    `Bulk mapping creation → ${SUPABASE_URL}${isLocal ? " (local)" : " (REMOTE)"}` +
      `${DRY_RUN ? "  [DRY RUN — nothing will be written]" : ""}\n`
  );

  const supabase = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: auth, error: authError } = await supabase.auth.signInWithPassword({
    email: PROFESSOR_EMAIL!,
    password: PROFESSOR_PASSWORD!,
  });
  if (authError) fail(`signing in as ${PROFESSOR_EMAIL}`, authError.message);
  console.log(`Signed in as ${PROFESSOR_EMAIL} (${auth.user!.id})`);

  const { data: classRow, error: classError } = await supabase
    .from("classes")
    .select("id, name, professor_id")
    .eq("id", CLASS_ID)
    .maybeSingle();
  if (classError) fail("reading the class", classError.message);
  if (!classRow) {
    fail(
      "reading the class",
      `class ${CLASS_ID} is not visible to ${PROFESSOR_EMAIL}. Either the id is wrong ` +
        `or this account is not its professor (RLS returns nothing either way).`
    );
  }
  console.log(`Class: ${classRow.name} (${CLASS_ID})\n`);

  if (CLEANUP_DUPLICATE) await cleanupDuplicate(supabase, CLEANUP_DUPLICATE);

  const { a1, a2 } = await preflightSequence(supabase, CLASS_ID);

  // ------------------------------------------------ question code index --
  // Look questions up by external_question_code, never by hardcoded UUID —
  // the template ships codes (A1-018, A2-030), and UUIDs differ per
  // environment.
  const codeToId = new Map<string, string>();
  for (const [label, assignment] of [["A1", a1], ["A2", a2]] as const) {
    const { data, error } = await supabase
      .from("questions")
      .select("id, external_question_code")
      .eq("assignment_id", assignment.id)
      .eq("is_active", true)
      .returns<Array<{ id: string; external_question_code: string }>>();
    if (error) fail(`reading ${label} questions`, error.message);
    for (const q of data ?? []) codeToId.set(q.external_question_code, q.id);
    console.log(`${label}: ${data?.length ?? 0} active questions loaded`);
  }
  console.log("");

  // --------------------------------------------------------- template ----
  const templatePath = resolve("data/question-mapping-template.json");
  const template = JSON.parse(readFileSync(templatePath, "utf-8")) as {
    mappings: TemplateMapping[];
  };
  console.log(`Template: ${template.mappings.length} suggested mappings\n`);

  const { data: existing } = await supabase
    .from("question_mappings")
    .select("mapping_name")
    .eq("class_id", CLASS_ID)
    .returns<Array<{ mapping_name: string }>>();
  const existingNames = new Set((existing ?? []).map((m) => m.mapping_name));
  if (existingNames.size > 0) {
    console.log(`${existingNames.size} mappings already exist in this class; those names are skipped.\n`);
  }

  // ----------------------------------------------------------- create ----
  const created: Array<{ id: string; name: string; type: string }> = [];
  const skipped: Array<{ name: string; reason: string }> = [];
  const failures: Array<{ name: string; reason: string }> = [];

  for (const m of template.mappings) {
    if (existingNames.has(m.mapping_name)) {
      skipped.push({ name: m.mapping_name, reason: "a mapping with this name already exists" });
      continue;
    }

    // Resolve codes → ids. An unresolvable code is a loud failure, never a
    // silently dropped side (CLAUDE.md: fail loudly, don't guess).
    const resolve1: string[] = [];
    const resolve2: string[] = [];
    const missing: string[] = [];
    for (const code of m.assignment_1_question_ids) {
      const id = codeToId.get(code);
      if (id) resolve1.push(id);
      else missing.push(code);
    }
    for (const code of m.assignment_2_question_ids) {
      const id = codeToId.get(code);
      if (id) resolve2.push(id);
      else missing.push(code);
    }
    if (missing.length > 0) {
      failures.push({
        name: m.mapping_name,
        reason: `question code(s) not found in this class: ${missing.join(", ")}`,
      });
      continue;
    }

    if (DRY_RUN) {
      created.push({ id: "(dry-run)", name: m.mapping_name, type: m.mapping_type });
      continue;
    }

    const { data: mappingId, error } = await supabase.rpc("create_question_mapping", {
      p_class_id: CLASS_ID,
      p_a1_question_ids: resolve1,
      p_a2_question_ids: resolve2,
      p_mapping_name: m.mapping_name,
      p_mapping_type: m.mapping_type,
      p_common_concept: m.common_concept,
      p_energy_source: m.energy_source,
      p_criterion: m.criterion,
      p_comparison_method: m.comparison_method,
      p_professor_notes: m.professor_notes,
      p_mapping_status: "SUGGESTED",
    });

    if (error) {
      failures.push({ name: m.mapping_name, reason: error.message });
      continue;
    }
    created.push({ id: mappingId as string, name: m.mapping_name, type: m.mapping_type });
  }

  console.log(`Created:  ${created.length}`);
  console.log(`Skipped:  ${skipped.length}`);
  console.log(`Failed:   ${failures.length}\n`);

  // ---------------------------------------------------------- approve ----
  let approved = 0;
  const approvalFailures: Array<{ name: string; reason: string }> = [];

  if (NO_APPROVE) {
    console.log("--no-approve: leaving every mapping unapproved.\n");
  } else {
    const toApprove = created.filter((c) => APPROVABLE_TYPES.has(c.type));
    console.log(
      `Approving ${toApprove.length} one-to-one mappings ` +
        `(NOT_COMPARABLE and UNMAPPED entries stay unapproved — they carry no ` +
        `transition data and exist to record that a source has no counterpart).\n`
    );

    for (const c of toApprove) {
      if (DRY_RUN) {
        approved += 1;
        continue;
      }
      const { error } = await supabase.rpc("set_mapping_approval", {
        p_mapping_id: c.id,
        p_approve: true,
      });
      if (error) approvalFailures.push({ name: c.name, reason: error.message });
      else approved += 1;
    }
  }

  // ----------------------------------------------------------- report ----
  console.log("--- summary ---");
  console.log(`class:                ${classRow.name} (${CLASS_ID})`);
  console.log(`assignment 1:         "${a1.title}" (seq ${a1.sequence_number})`);
  console.log(`assignment 2:         "${a2.title}" (seq ${a2.sequence_number})`);
  console.log(`mappings created:     ${created.length}`);
  console.log(`mappings approved:    ${approved}`);
  console.log(`skipped (existing):   ${skipped.length}`);
  console.log(`validation failures:  ${failures.length + approvalFailures.length}`);

  if (skipped.length > 0) {
    console.log("\nSkipped:");
    for (const s of skipped) console.log(`  - ${s.name}: ${s.reason}`);
  }
  if (failures.length > 0) {
    console.log("\nCreation failures:");
    for (const f of failures) console.log(`  ✗ ${f.name}: ${f.reason}`);
  }
  if (approvalFailures.length > 0) {
    console.log("\nApproval failures:");
    for (const f of approvalFailures) console.log(`  ✗ ${f.name}: ${f.reason}`);
  }

  if (!DRY_RUN) {
    const { count } = await supabase
      .from("question_mappings")
      .select("id", { count: "exact", head: true })
      .eq("class_id", CLASS_ID)
      .eq("professor_approved", true);
    console.log(`\napproved mappings now live in this class: ${count ?? 0}`);
  }

  if (failures.length + approvalFailures.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\n✗ bulk mapping creation failed:", err);
  process.exit(1);
});
