import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { BrowserContext } from "@playwright/test";

/**
 * E2E plumbing.
 *
 * The app signs in through Google OAuth, which a browser test cannot
 * drive. Instead we mint a real session in Node with
 * `signInWithPassword` against a seeded account, and let @supabase/ssr
 * itself serialise the session into cookies — capturing whatever it would
 * have set and injecting exactly that into the browser context. Using the
 * library's own serializer means this keeps working if the cookie format
 * or chunking changes.
 */

export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON_KEY = process.env.E2E_ANON_KEY ?? "";
export const SERVICE_ROLE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? "";

export const STUDENT_DOMAIN = process.env.SEED_STUDENT_DOMAIN ?? "seed.invalid";
export const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@seed.invalid";
export const PROFESSOR_EMAIL = process.env.SEED_PROFESSOR_EMAIL ?? "professor@seed.invalid";

export function requireEnv(): void {
  const missing = [
    !ANON_KEY && "E2E_ANON_KEY",
    !SERVICE_ROLE_KEY && "E2E_SERVICE_ROLE_KEY",
    !process.env.SEED_PROFESSOR_PASSWORD && "SEED_PROFESSOR_PASSWORD",
    !process.env.SEED_STUDENT_PASSWORD && "SEED_STUDENT_PASSWORD",
    !process.env.SEED_ADMIN_PASSWORD && "SEED_ADMIN_PASSWORD",
  ].filter(Boolean);
  if (missing.length > 0) {
    throw new Error(
      `E2E tests need these environment variables: ${missing.join(", ")}.\n` +
        "See the header of playwright.config.ts for the full command."
    );
  }
}

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface CapturedCookie {
  name: string;
  value: string;
  options?: CookieOptions;
}

/**
 * Signs in as `email` and installs the resulting session cookies into the
 * Playwright context, so server components see an authenticated user.
 */
export async function signIn(
  context: BrowserContext,
  email: string,
  password: string
): Promise<{ userId: string }> {
  const captured: CapturedCookie[] = [];

  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => captured.map(({ name, value }) => ({ name, value })),
      setAll: (cookiesToSet: CapturedCookie[]) => {
        for (const cookie of cookiesToSet) {
          const existing = captured.findIndex((c) => c.name === cookie.name);
          if (existing >= 0) captured[existing] = cookie;
          else captured.push(cookie);
        }
      },
    },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`e2e sign-in failed for ${email}: ${error.message}`);
  if (captured.length === 0) {
    throw new Error(`e2e sign-in for ${email} produced no session cookies`);
  }

  await context.addCookies(
    captured.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    }))
  );

  return { userId: data.user!.id };
}

export async function signOut(context: BrowserContext): Promise<void> {
  await context.clearCookies();
}

/** The seeded demo class, looked up rather than hard-coded. */
export async function seededClass(admin: SupabaseClient): Promise<{
  classId: string;
  className: string;
  a1Id: string;
  a2Id: string;
}> {
  const { data: classRow, error } = await admin
    .from("classes")
    .select("id, name")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read seeded class: ${error.message}`);
  if (!classRow) {
    throw new Error("no seeded class found — run `npm run db:seed` against the local stack first");
  }

  const { data: assignments, error: aError } = await admin
    .from("assignments")
    .select("id, sequence_number")
    .eq("class_id", classRow.id)
    .order("sequence_number");
  if (aError) throw new Error(`could not read seeded assignments: ${aError.message}`);

  return {
    classId: classRow.id,
    className: classRow.name,
    a1Id: assignments!.find((a) => a.sequence_number === 1)!.id,
    a2Id: assignments!.find((a) => a.sequence_number === 2)!.id,
  };
}
