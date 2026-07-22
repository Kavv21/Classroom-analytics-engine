/**
 * Provisions load-test accounts against the LOCAL Supabase stack and
 * writes their credentials + pre-fetched access tokens to
 * load-tests/.users.json (gitignored) for the k6 scripts to consume.
 *
 *   eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
 *   LOAD_SUPABASE_URL=$API_URL LOAD_ANON_KEY=$ANON_KEY \
 *     LOAD_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY LOAD_PASSWORD=<pick one> \
 *     npx tsx load-tests/provision.ts 400
 *
 * Refuses non-local targets unless LOAD_ALLOW_REMOTE=true.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.LOAD_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON = process.env.LOAD_ANON_KEY!;
const SERVICE = process.env.LOAD_SERVICE_ROLE_KEY!;
const COUNT = Number(process.argv[2] ?? 400);
const PASSWORD = process.env.LOAD_PASSWORD;

if (!ANON || !SERVICE) {
  console.error("Set LOAD_ANON_KEY and LOAD_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!PASSWORD) {
  // Not defaulted, per CLAUDE.md rule 8 — credentials come from the
  // environment even for disposable local load-test accounts.
  console.error("Set LOAD_PASSWORD (the shared password for load-test accounts).");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL_) && process.env.LOAD_ALLOW_REMOTE !== "true") {
  console.error(`Refusing to load-test a non-local target: ${URL_}`);
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: classRow, error: classError } = await admin
    .from("classes")
    .select("id")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (classError || !classRow) {
    console.error("No seeded class found — run `npm run db:seed` first.");
    process.exit(1);
  }
  const classId = classRow.id;

  const { data: assignments } = await admin
    .from("assignments")
    .select("id, sequence_number")
    .eq("class_id", classId)
    .order("sequence_number");
  const a1 = assignments!.find((a) => a.sequence_number === 1)!.id;
  const a2 = assignments!.find((a) => a.sequence_number === 2)!.id;

  const { data: questions } = await admin
    .from("questions")
    .select("id")
    .eq("assignment_id", a1)
    .order("display_order")
    .limit(30);

  // Clean out any previous load users so re-runs start fresh.
  const existing = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const stale = existing.data.users.filter((u) => u.email?.startsWith("load"));
  if (stale.length > 0) {
    process.stdout.write(`removing ${stale.length} previous load users… `);
    for (const u of stale) {
      await admin.from("responses").delete().eq("student_id", u.id);
      await admin.from("assignment_attempts").delete().eq("student_id", u.id);
      await admin.from("class_members").delete().eq("user_id", u.id);
      await admin.from("profiles").delete().eq("id", u.id);
      await admin.auth.admin.deleteUser(u.id);
    }
    console.log("done");
  }

  const users: Array<{ email: string; id: string; token: string }> = [];
  process.stdout.write(`provisioning ${COUNT} load users`);
  for (let i = 0; i < COUNT; i++) {
    const email = `load${String(i).padStart(4, "0")}@load.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    if (error) {
      console.error(`\ncreating ${email}: ${error.message}`);
      process.exit(1);
    }
    const id = data.user!.id;
    await admin.from("profiles").insert({
      id,
      email,
      full_name: `Load User ${i}`,
      role: "STUDENT",
      is_active: true,
    });
    await admin.from("class_members").insert({
      class_id: classId,
      user_id: id,
      member_role: "STUDENT",
      status: "ACTIVE",
    });
    users.push({ email, id, token: "" });
    if (i % 50 === 0) process.stdout.write(".");
  }
  console.log(" done");

  // Pre-fetch tokens so the non-login scenarios measure data operations
  // rather than re-measuring auth.
  process.stdout.write("fetching tokens");
  for (const [i, u] of users.entries()) {
    const res = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: ANON },
      body: JSON.stringify({ email: u.email, password: PASSWORD }),
    });
    const body = (await res.json()) as { access_token?: string };
    if (!body.access_token) {
      console.error(`\ntoken fetch failed for ${u.email}`);
      process.exit(1);
    }
    u.token = body.access_token;
    if (i % 50 === 0) process.stdout.write(".");
  }
  console.log(" done");

  const out = {
    supabaseUrl: URL_,
    anonKey: ANON,
    password: PASSWORD,
    classId,
    assignment1Id: a1,
    assignment2Id: a2,
    questionIds: (questions ?? []).map((q) => q.id),
    users,
  };
  const path = resolve("load-tests/.users.json");
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${path} (${users.length} users, ${out.questionIds.length} questions)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
