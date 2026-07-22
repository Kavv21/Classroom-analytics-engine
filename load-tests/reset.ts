/**
 * Resets load-test users' attempt state so the autosave and
 * submission-spike scenarios are repeatable.
 *
 * Without this, a second run measures the FSM correctly refusing to save
 * or submit an already-SUBMITTED attempt — which looks like a load
 * failure but is the application behaving exactly as designed.
 *
 *   LOAD_SUPABASE_URL=$API_URL LOAD_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
 *     npx tsx load-tests/reset.ts
 */
import { createClient } from "@supabase/supabase-js";

const URL_ = process.env.LOAD_SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE = process.env.LOAD_SERVICE_ROLE_KEY!;

if (!SERVICE) {
  console.error("Set LOAD_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(URL_) && process.env.LOAD_ALLOW_REMOTE !== "true") {
  console.error(`Refusing to touch a non-local target: ${URL_}`);
  process.exit(1);
}

const admin = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const { data: users, error } = await admin
    .from("profiles")
    .select("id")
    .like("email", "load%@load.invalid");
  if (error) {
    console.error(`could not list load users: ${error.message}`);
    process.exit(1);
  }
  const ids = (users ?? []).map((u) => u.id);
  if (ids.length === 0) {
    console.log("no load users found — nothing to reset");
    return;
  }

  // Batched: PostgREST puts `in` filters in the query string, and 400
  // UUIDs in one URL exceeds the server's URI length limit.
  const CHUNK = 50;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    // Responses first: the attempts row is what the FSM guards.
    const { error: rErr } = await admin.from("responses").delete().in("student_id", slice);
    if (rErr) {
      console.error(`deleting responses (batch ${i / CHUNK}): ${rErr.message}`);
      process.exit(1);
    }
    const { error: aErr } = await admin
      .from("assignment_attempts")
      .delete()
      .in("student_id", slice);
    if (aErr) {
      console.error(`deleting attempts (batch ${i / CHUNK}): ${aErr.message}`);
      process.exit(1);
    }
  }

  console.log(`reset ${ids.length} load users (attempts + responses cleared)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
