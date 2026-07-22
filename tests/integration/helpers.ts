import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared plumbing for integration tests against a live Supabase instance
 * (local stack or the project database). Env resolution: SUPABASE_TEST_*
 * first, then .env.local.
 */
export function loadEnv(): { url: string; anonKey: string; serviceKey: string } {
  const fromProcess = {
    url: process.env.SUPABASE_TEST_URL,
    anonKey: process.env.SUPABASE_TEST_ANON_KEY,
    serviceKey: process.env.SUPABASE_TEST_SERVICE_ROLE_KEY,
  };
  if (fromProcess.url && fromProcess.anonKey && fromProcess.serviceKey) {
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
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    const [, key, value] = m ?? [];
    if (key) parsed[key] = (value ?? "").trim();
  }
  const url = parsed.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) {
    throw new Error(".env.local is missing the Supabase URL or keys.");
  }
  return { url, anonKey, serviceKey };
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
