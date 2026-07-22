import { test, expect } from "@playwright/test";
import {
  ADMIN_EMAIL,
  adminClient,
  PROFESSOR_EMAIL,
  requireEnv,
  signIn,
  STUDENT_DOMAIN,
} from "./helpers";

/**
 * The admin console added in this phase. Phase 10 recorded "no admin UI"
 * as a known limitation; these tests cover the screens that close it.
 */

const admin = adminClient();
const TEMP_EMAIL = `admin-console-${Date.now()}@${STUDENT_DOMAIN}`;
let tempId: string;

test.beforeAll(async () => {
  requireEnv();
  const { data, error } = await admin.auth.admin.createUser({
    email: TEMP_EMAIL,
    password: "Admin-Console-1!",
    email_confirm: true,
  });
  if (error) throw new Error(`could not create fixture user: ${error.message}`);
  tempId = data.user!.id;
  const { error: profileError } = await admin.from("profiles").insert({
    id: tempId,
    email: TEMP_EMAIL,
    full_name: "Console Fixture User",
    role: "STUDENT",
    is_active: true,
  });
  if (profileError) throw new Error(`could not create fixture profile: ${profileError.message}`);
});

test.afterAll(async () => {
  await admin.from("audit_logs").delete().eq("entity_id", tempId);
  await admin.from("profiles").delete().eq("id", tempId);
  const { error } = await admin.auth.admin.deleteUser(tempId);
  if (error) throw new Error(`fixture cleanup failed: ${error.message}`);
  await admin.from("roster_entries").delete().like("email", "new-prof-%@e2e.invalid");
});

test("the console is closed to non-admins", async ({ page, context }) => {
  await signIn(context, PROFESSOR_EMAIL, process.env.SEED_PROFESSOR_PASSWORD!);

  for (const path of ["/admin/users", "/admin/audit"]) {
    await page.goto(path);
    await expect(page.getByText("This page could not be found")).toBeVisible();
    // And no data leaked onto the 404.
    await expect(page.getByText("Console Fixture User")).toHaveCount(0);
  }
});

test("an admin lists everyone with roles, status and class memberships", async ({
  page,
  context,
}) => {
  await signIn(context, ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);
  await page.goto("/admin/users");

  await expect(page.getByRole("heading", { name: /^People \(/ })).toBeVisible();
  await expect(page.getByText(TEMP_EMAIL)).toBeVisible();

  // Role filter tabs are populated from real data.
  await expect(page.getByRole("tab", { name: /^Students \(/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /^Professors \(/ })).toBeVisible();

  // Search narrows the table.
  await page.getByLabel("Search people").fill("Console Fixture");
  const row = page.locator("tr", { hasText: "Console Fixture User" });
  await expect(row).toBeVisible();
  await expect(row.getByText("Student")).toBeVisible();
  await expect(row.getByText("Active")).toBeVisible();
});

test("an admin changes a role and sees it confirmed", async ({ page, context }) => {
  await signIn(context, ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);
  await page.goto("/admin/users");
  await page.getByLabel("Search people").fill("Console Fixture");

  const row = page.locator("tr", { hasText: "Console Fixture User" });
  await row.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Professor" }).click();

  await expect(page.getByText(/is now a professor/i)).toBeVisible();

  const { data } = await admin.from("profiles").select("role").eq("id", tempId).single();
  expect(data!.role).toBe("PROFESSOR");
});

test("deactivation asks for confirmation first, then applies", async ({ page, context }) => {
  await signIn(context, ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);
  await page.goto("/admin/users");
  await page.getByLabel("Search people").fill("Console Fixture");

  const row = page.locator("tr", { hasText: "Console Fixture User" });
  await row.getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: "Deactivate account" }).click();

  // The alert dialog is the confirmation step — nothing has changed yet.
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(page.getByText(/Their existing answers are kept/)).toBeVisible();
  const midway = await admin.from("profiles").select("is_active").eq("id", tempId).single();
  expect(midway.data!.is_active).toBe(true);

  await page.getByRole("button", { name: "Deactivate", exact: true }).click();
  await expect(page.getByText(/deactivated/i).first()).toBeVisible();

  const after = await admin.from("profiles").select("is_active").eq("id", tempId).single();
  expect(after.data!.is_active).toBe(false);
});

test("an admin pre-authorises a new professor", async ({ page, context }) => {
  const email = `new-prof-${Date.now()}@e2e.invalid`;
  await signIn(context, ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);
  await page.goto("/admin/users");

  await page.getByRole("button", { name: /Add professor or admin/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByLabel("University email").fill(email);
  await page.getByLabel("Full name (optional)").fill("Incoming Professor");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(page.getByText(/pre-authorised/i)).toBeVisible();

  const { data } = await admin
    .from("roster_entries")
    .select("intended_role")
    .eq("email", email)
    .maybeSingle();
  expect(data?.intended_role).toBe("PROFESSOR");
});

test("the activity log records what the admin just did", async ({ page, context }) => {
  await signIn(context, ADMIN_EMAIL, process.env.SEED_ADMIN_PASSWORD!);
  await page.goto("/admin/audit");

  await expect(page.getByRole("heading", { name: /^Activity log \(/ })).toBeVisible();
  // The role change and deactivation above are append-only records.
  await expect(page.getByText("Changed someone's role").first()).toBeVisible();
  await expect(page.getByText("Deactivated an account").first()).toBeVisible();
});
