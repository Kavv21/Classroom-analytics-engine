import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared plumbing for integration tests against a live Supabase instance
 * (local stack or the project database). Env resolution: SUPABASE_TEST_*
 * first, then .env.local.
 */
function isLocalSupabaseUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|host\.docker\.internal)(:\d+)?/.test(url);
}

/**
 * SAFETY — these tests WRITE. They create users, classes, assignments,
 * questions, responses and mappings, then delete them again.
 *
 * The fallback below used to read `.env.local`, which is the APPLICATION's
 * configuration and therefore points at the production-track project.
 * `npm run test` on a developer machine consequently ran the whole
 * integration suite against production without saying so — the same class
 * of bug as the seed scripts' guards exist to prevent, in the one place
 * nobody thought to guard.
 *
 * So a non-local target is now refused unless it is asked for explicitly.
 * The tests clean up after themselves and are scoped to ids they create,
 * but "it tidies up afterwards" is not a reason to point a write suite at
 * real data by default.
 */
export function loadEnv(): { url: string; anonKey: string; serviceKey: string } {
  const fromProcess = {
    url: process.env.SUPABASE_TEST_URL,
    anonKey: process.env.SUPABASE_TEST_ANON_KEY,
    serviceKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
  };
  if (fromProcess.url && fromProcess.anonKey && fromProcess.serviceKey) {
    assertTargetAllowed(fromProcess.url, "SUPABASE_TEST_URL");
    return fromProcess as { url: string; anonKey: string; serviceKey: string };
  }

  const envPath = resolve(".env.local");
  if (!existsSync(envPath)) {
    throw new Error(
      "Integration tests need SUPABASE_TEST_URL/SUPABASE_TEST_ANON_KEY/" +
        "SUPABASE_TEST_SERVICE_ROLE_KEY or a .env.local file."
    );
  }
  const parsed: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    const [, key, value] = m ?? [];
    if (key) parsed[key] = (value ?? "").trim();
  }
  const url = parsed.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(".env.local is missing the Supabase URL or keys.");
  }
  assertTargetAllowed(url, ".env.local (NEXT_PUBLIC_SUPABASE_URL)");
  return { url, anonKey, serviceKey };
}

function assertTargetAllowed(url: string, source: string): void {
  if (isLocalSupabaseUrl(url)) return;
  if (process.env.SUPABASE_TEST_ALLOW_REMOTE === "true") return;

  throw new Error(
    `Refusing to run the integration suite against a non-local Supabase URL.\n\n` +
      `  target: ${url}\n` +
      `  from:   ${source}\n\n` +
      `These tests create and delete users, classes, assignments, questions and\n` +
      `responses. ${source.startsWith(".env.local") ? ".env.local is the application's own configuration, so it points at\nthe real project — not a test database.\n\n" : ""}` +
      `Run them against the local stack instead:\n\n` +
      `  npm run test:local\n\n` +
      `or, to wire it up by hand:\n\n` +
      `  eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"\n` +
      `  SUPABASE_TEST_URL=$API_URL \\\n` +
      `  SUPABASE_TEST_ANON_KEY=$ANON_KEY \\\n` +
      `  SUPABASE_TEST_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run test\n\n` +
      `If you genuinely mean to test against this project, set\n` +
      `SUPABASE_TEST_ALLOW_REMOTE=true.`
  );
}

export function adminClient(env: ReturnType<typeof loadEnv>): SupabaseClient {
  return createClient(env.url, env.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Retries a Supabase admin-API call through transient auth-service
 * failures. The hosted project's GoTrue intermittently rejects rapid
 * sequential admin calls with "invalid JWT: ... unrecognized JWT kid
 * <nil> for algorithm ES256" — a server-side keyfunc hiccup, not a
 * problem with our key (the same key succeeds on the surrounding calls).
 * After the retries are exhausted the last result is returned so the
 * caller still fails loudly.
 */
export async function retryTransient<T extends { error: { message: string } | null }>(
  fn: () => PromiseLike<T>,
  attempts = 4
): Promise<T> {
  let last!: T;
  for (let i = 0; i < attempts; i++) {
    last = await fn();
    if (!last.error) return last;
    await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
  }
  return last;
}

export interface TestUser {
  id: string;
  email: string;
  client: SupabaseClient;
}

/** Creates a password-auth user with a profile row and a signed-in client. */
export async function createTestUser(
  env: ReturnType<typeof loadEnv>,
  admin: SupabaseClient,
  role: "PROFESSOR" | "STUDENT",
  fullName: string
): Promise<TestUser> {
  const email = `it-${role.toLowerCase()}-${randomUUID().slice(0, 8)}@integration-test.invalid`;
  const password = `It-${randomUUID()}`;

  const { data, error } = await retryTransient(() =>
    admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
  );
  if (error) throw new Error(`could not create test ${role}: ${error.message}`);
  const id = data.user!.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id,
    email,
    full_name: fullName,
    role,
    is_active: true,
  });
  if (profileError) throw new Error(`could not create ${role} profile: ${profileError.message}`);

  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) throw new Error(`${role} sign-in failed: ${signInError.message}`);

  return { id, email, client };
}

/**
 * Removes everything the tests created, loudly. Order matters: responses
 * first (the questions_immutable_after_responses trigger blocks a class
 * delete's questions cascade while responses exist), then classes, then
 * actors.
 */
export async function cleanupTestData(
  admin: SupabaseClient,
  opts: { classIds: string[]; userIds: string[] }
): Promise<void> {
  const failures: string[] = [];
  const step = async (
    label: string,
    fn: () => PromiseLike<{ error: { message: string } | null }>
  ) => {
    const { error } = await fn();
    if (error) failures.push(`${label}: ${error.message}`);
  };

  if (opts.userIds.length > 0) {
    await step("responses", () =>
      admin.from("responses").delete().in("student_id", opts.userIds)
    );
    await step("attempts", () =>
      admin.from("assignment_attempts").delete().in("student_id", opts.userIds)
    );
  }
  for (const classId of opts.classIds) {
    await step(`class ${classId}`, () => admin.from("classes").delete().eq("id", classId));
  }
  if (opts.userIds.length > 0) {
    await step("audit_logs", () =>
      admin.from("audit_logs").delete().in("actor_id", opts.userIds)
    );
    await step("class_members", () =>
      admin.from("class_members").delete().in("user_id", opts.userIds)
    );
    await step("profiles", () => admin.from("profiles").delete().in("id", opts.userIds));
    for (const id of opts.userIds) {
      await step(`auth user ${id}`, () => retryTransient(() => admin.auth.admin.deleteUser(id)));
    }
  }

  if (failures.length > 0) {
    throw new Error(`integration-test cleanup left data behind — ${failures.join("; ")}`);
  }
}
