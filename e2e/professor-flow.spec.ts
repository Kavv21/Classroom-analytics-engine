import { test, expect } from "@playwright/test";
import {
  adminClient,
  PROFESSOR_EMAIL,
  requireEnv,
  seededClass,
  signIn,
  STUDENT_DOMAIN,
} from "./helpers";

/**
 * Professor workflow: class → roster → assignment → questions → publish →
 * analytics → export.
 *
 * Runs against the seeded local stack. Anything this spec creates itself
 * (a fresh class and assignment) is deleted in afterAll; the shared seed
 * data is left intact for the other specs.
 */

const admin = adminClient();
const createdClassIds: string[] = [];

test.beforeAll(() => requireEnv());

test.afterAll(async () => {
  for (const id of createdClassIds) {
    const { error } = await admin.from("classes").delete().eq("id", id);
    if (error) throw new Error(`e2e cleanup failed for class ${id}: ${error.message}`);
  }
});

test.beforeEach(async ({ context }) => {
  await signIn(context, PROFESSOR_EMAIL, process.env.SEED_PROFESSOR_PASSWORD!);
});

test("professor sees their classes and can open the seeded class", async ({ page }) => {
  const { className } = await seededClass(admin);
  await page.goto("/classes");
  await expect(page.getByRole("heading", { name: "Your classes" })).toBeVisible();
  await expect(page.getByText(className)).toBeVisible();
});

test("professor creates a class end to end", async ({ page }) => {
  const name = `E2E Class ${Date.now()}`;
  await page.goto("/classes/new");
  await expect(page.getByRole("heading", { name: "Create a class" })).toBeVisible();

  await page.getByLabel("Class name").fill(name);
  await page.getByRole("button", { name: "Create class" }).click();

  await expect(page.getByRole("heading", { name })).toBeVisible();

  const { data } = await admin.from("classes").select("id").eq("name", name).maybeSingle();
  expect(data?.id).toBeTruthy();
  createdClassIds.push(data!.id);

  // The class detail page exposes both workflow entry points.
  await expect(page.getByRole("link", { name: "Manage assignments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View analytics" })).toBeVisible();
});

test("assignment detail shows imported questions and the availability controls", async ({ page }) => {
  const { classId, a1Id } = await seededClass(admin);
  await page.goto(`/classes/${classId}/assignments/${a1Id}`);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Assignment 1");
  // The real spreadsheet import produced 30 questions for Assignment 1.
  await expect(page.getByRole("heading", { name: /^Questions \(30\)$/ })).toBeVisible();
  // "Publishing" became "Availability" in migration 0029: the dates are
  // what let students in, so there is no publish button to head a section
  // with. Seeded assignments are OPEN with no dates — the legacy shape —
  // so what is offered is the schedule and the retire step.
  await expect(page.getByRole("heading", { name: "Availability" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Set the schedule" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close to students now" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish to students" })).toHaveCount(0);
});

test("analytics pages render real figures from the seeded responses", async ({ page }) => {
  const { classId } = await seededClass(admin);

  await page.goto(`/classes/${classId}/analytics`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Analytics");
  await expect(page.getByText("Answered responses").first()).toBeVisible();
  await expect(page.getByText("Average consensus").first()).toBeVisible();

  await page.goto(`/classes/${classId}/analytics/assignments`);
  await expect(page.getByRole("heading", { name: /Response distribution/ }).first()).toBeVisible();

  // Every chart must offer its accessible table twin.
  const firstCard = page.locator("section").filter({ hasText: "Response distribution" }).first();
  await firstCard.getByRole("button", { name: "Table" }).click();
  await expect(firstCard.locator("table")).toBeVisible();
});

test("professor downloads the full Excel export", async ({ page }) => {
  const { classId } = await seededClass(admin);
  await page.goto(`/classes/${classId}/analytics/builder`);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("link", { name: /Export full workbook/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/analytics-export-.*\.xlsx$/);
});

test("query builder rejects an incompatible chart combination with a clear message", async ({
  page,
}) => {
  const { classId } = await seededClass(admin);
  await page.goto(`/classes/${classId}/analytics/builder`);

  // Chart type is now a shadcn Select (a combobox), not a native <select>,
  // so it is opened and its option chosen rather than selectOption()'d.
  await page.getByLabel("Chart type").click();
  await page.getByRole("option", { name: "Heatmap" }).click();
  // The default query has one grouping; a heatmap needs two.
  const banner = page.getByRole("alert").filter({ hasText: "can’t be charted" });
  await expect(banner).toContainText("heatmap");
  await expect(banner).toContainText("at least 2 groupings");
});

test("professor adds a student by hand and they appear on the roster", async ({ page }) => {
  const { data: professor } = await admin
    .from("profiles")
    .select("id")
    .eq("email", PROFESSOR_EMAIL)
    .single();
  const { data: domainRow } = await admin
    .from("app_config")
    .select("value")
    .eq("key", "allowed_email_domain")
    .maybeSingle();
  const domain = (domainRow?.value as string | undefined) ?? STUDENT_DOMAIN;

  const { data: classRow, error: classError } = await admin
    .from("classes")
    .insert({
      name: `E2E Manual Add ${Date.now()}`,
      professor_id: professor!.id,
      class_code: `E2EM${Date.now().toString(36).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (classError) throw new Error(`e2e class insert failed: ${classError.message}`);
  createdClassIds.push(classRow!.id);

  // Someone who signed in with Google before anyone rostered them: an auth
  // account, no profile. Adding them provisions them on the spot, so they
  // land in the roster table (a never-signed-in student would only move
  // the "Awaiting first sign-in" count).
  const email = `e2e-manual-${Date.now()}@${domain}`;
  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password: `E2e-${Date.now()}-x`,
    email_confirm: true,
  });
  if (authError) throw new Error(`e2e auth user create failed: ${authError.message}`);

  try {
    await page.goto(`/classes/${classRow!.id}`);
    await page.getByRole("button", { name: "Add student" }).click();

    const dialog = page.getByRole("dialog");
    const row = dialog.getByRole("group", { name: "Student 1" });
    await row.getByLabel("Full name").fill("E2E Manual Student");
    await row.getByLabel("Email").fill(email);
    await row.getByLabel(/^Roll number/).fill("E2E001");
    await dialog.getByRole("button", { name: "Add student" }).click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText("E2E Manual Student can sign in now.")).toBeVisible();
    await expect(page.getByRole("cell", { name: email })).toBeVisible();
  } finally {
    await admin.from("roster_entries").delete().eq("email", email);
    await admin.from("class_members").delete().eq("user_id", authUser!.user!.id);
    await admin.from("profiles").delete().eq("id", authUser!.user!.id);
    await admin.auth.admin.deleteUser(authUser!.user!.id);
  }
});
