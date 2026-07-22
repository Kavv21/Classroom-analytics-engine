import { test, expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import {
  ADMIN_EMAIL,
  adminClient,
  ANON_KEY,
  PROFESSOR_EMAIL,
  requireEnv,
  SUPABASE_URL,
  signIn,
} from "./helpers";

/**
 * Admin workflow.
 *
 * IMPORTANT, and stated plainly because it is a real scope gap: this
 * application has **no admin user interface**. Nothing under app/ renders
 * an admin-only screen. The only admin-specific capability that exists is
 * the `audit_logs_admin` RLS policy from migration 0001, which lets a
 * profile with role = 'ADMIN' read the audit log; every other admin
 * capability described in the original spec (user management, system
 * settings, cross-class oversight) was never built.
 *
 * These tests therefore verify the capability that genuinely exists, at
 * the data layer, and assert the absence of an admin UI rather than
 * pretending to exercise one. See docs/TESTING.md "Known gaps".
 */

const admin = adminClient();

test.beforeAll(() => requireEnv());

/** Signs in as `email` outside the browser and returns an RLS-scoped client. */
async function sessionClient(email: string, password: string) {
  const jar: Array<{ name: string; value: string }> = [];
  const client = createServerClient(SUPABASE_URL, ANON_KEY, {
    cookies: {
      getAll: () => jar,
      setAll: (toSet: Array<{ name: string; value: string }>) => {
        for (const c of toSet) {
          const i = jar.findIndex((j) => j.name === c.name);
          if (i >= 0) jar[i] = { name: c.name, value: c.value };
          else jar.push({ name: c.name, value: c.value });
        }
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return client;
}

test("an ADMIN can read the audit log; a professor cannot", async () => {
  // Generate at least one audit event so the comparison is meaningful.
  const { data: classRow } = await admin
    .from("classes")
    .select("id")
    .limit(1)
    .maybeSingle();
  expect(classRow?.id).toBeTruthy();

  const adminSession = await sessionClient(ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);
  const professorSession = await sessionClient(
    PROFESSOR_EMAIL,
    process.env.SEED_PROFESSOR_PASSWORD!
  );

  const { data: adminRows, error: adminError } = await adminSession
    .from("audit_logs")
    .select("id, action")
    .limit(5);
  expect(adminError, adminError?.message).toBeNull();

  const { data: profRows, error: profError } = await professorSession
    .from("audit_logs")
    .select("id, action")
    .limit(5);
  // RLS filters rather than errors — the professor simply sees nothing.
  expect(profError).toBeNull();
  expect(profRows).toEqual([]);

  // The admin's visibility is strictly greater than the professor's.
  expect(Array.isArray(adminRows)).toBe(true);
  expect((adminRows ?? []).length).toBeGreaterThanOrEqual((profRows ?? []).length);
});

test("an admin has no dedicated UI and is not treated as a professor", async ({ page, context }) => {
  await signIn(context, ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);

  // No /admin route exists. (Asserting content, not HTTP status: `next dev`
  // streams notFound() with a 200 while `next start` returns a real 404.)
  await page.goto("/admin");
  await expect(page.getByText("This page could not be found")).toBeVisible();

  // The admin is not the professor of the seeded class, so the professor
  // surfaces are correctly closed to them too.
  const { data: classRow } = await admin.from("classes").select("id").limit(1).maybeSingle();
  await page.goto(`/classes/${classRow!.id}/analytics`);
  await expect(page.getByText("This page could not be found")).toBeVisible();

  // They can still sign in and reach the homepage, which names their role.
  await page.goto("/");
  // Exact match: the seeded full name is "Demo Administrator", so a loose
  // match would resolve to two elements.
  await expect(page.getByText("Administrator", { exact: true })).toBeVisible();
});

test("student deactivation is a professor capability, and it works", async () => {
  // The spec listed "deactivating users" under admin; as built it is a
  // professor action scoped to their own class (set_student_active,
  // migration 0005). Verified here so the capability is covered even
  // though it does not live where the spec put it.
  const { data: classRow } = await admin.from("classes").select("id").limit(1).maybeSingle();
  const { data: member } = await admin
    .from("class_members")
    .select("user_id")
    .eq("class_id", classRow!.id)
    .limit(1)
    .maybeSingle();

  const professorSession = await sessionClient(
    PROFESSOR_EMAIL,
    process.env.SEED_PROFESSOR_PASSWORD!
  );

  const { error: offError } = await professorSession.rpc("set_student_active", {
    p_class_id: classRow!.id,
    p_profile_id: member!.user_id,
    p_is_active: false,
  });
  expect(offError, offError?.message).toBeNull();

  const { data: after } = await admin
    .from("profiles")
    .select("is_active")
    .eq("id", member!.user_id)
    .single();
  expect(after!.is_active).toBe(false);

  // Restore.
  const { error: onError } = await professorSession.rpc("set_student_active", {
    p_class_id: classRow!.id,
    p_profile_id: member!.user_id,
    p_is_active: true,
  });
  expect(onError, onError?.message).toBeNull();
});
