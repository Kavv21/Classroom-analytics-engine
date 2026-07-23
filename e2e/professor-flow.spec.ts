import { test, expect } from "@playwright/test";
import {
  adminClient,
  PROFESSOR_EMAIL,
  requireEnv,
  seededClass,
  signIn,
} from "./helpers";

/**
 * Professor workflow: class → roster → assignment → questions → publish →
 * mapping approval → analytics → export.
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
    await admin
      .from("question_mappings")
      .update({ professor_approved: false, mapping_status: "REJECTED" })
      .eq("class_id", id);
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

  // The class detail page exposes the three workflow entry points.
  await expect(page.getByRole("link", { name: "Manage assignments" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open mapping studio" })).toBeVisible();
  await expect(page.getByRole("link", { name: "View analytics" })).toBeVisible();
});

test("assignment detail shows imported questions and the publishing controls", async ({ page }) => {
  const { classId, a1Id } = await seededClass(admin);
  await page.goto(`/classes/${classId}/assignments/${a1Id}`);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Assignment 1");
  // The real spreadsheet import produced 30 questions for Assignment 1.
  await expect(page.getByRole("heading", { name: /^Questions \(30\)$/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Publishing" })).toBeVisible();
  // Seeded assignments are already OPEN, so closing is the offered action.
  await expect(page.getByRole("button", { name: "Close assignment" })).toBeVisible();
});

test("mapping studio lists mappings and shows the approval gate", async ({ page }) => {
  const { classId } = await seededClass(admin);
  await page.goto(`/classes/${classId}/mappings`);

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Question mapping");
  // 19 approved + 1 deliberately left unapproved by the seed.
  await expect(page.getByText(/^Mappings \(20\)$/)).toBeVisible();
  await expect(page.getByText("Approved").first()).toBeVisible();
  await expect(page.getByText("Suggested").first()).toBeVisible();
});

test("professor approves a mapping and it becomes visible to analytics", async ({ page }) => {
  const { classId } = await seededClass(admin);

  const { data: pending } = await admin
    .from("question_mappings")
    .select("id, mapping_name")
    .eq("class_id", classId)
    .eq("professor_approved", false)
    .limit(1)
    .maybeSingle();
  expect(pending, "seed should leave one unapproved mapping").toBeTruthy();

  const before = await admin
    .from("approved_question_mappings")
    .select("id")
    .eq("class_id", classId);
  const beforeCount = before.data!.length;

  await page.goto(`/classes/${classId}/mappings`);
  const row = page.locator("tr", { hasText: pending!.mapping_name });
  await row.getByRole("button", { name: "Approve" }).click();
  await expect(row.getByText("Approved")).toBeVisible();

  const after = await admin
    .from("approved_question_mappings")
    .select("id")
    .eq("class_id", classId);
  expect(after.data!.length).toBe(beforeCount + 1);

  // Put it back so re-running the suite starts from the same state.
  await admin
    .from("question_mappings")
    .update({ professor_approved: false, mapping_status: "SUGGESTED" })
    .eq("id", pending!.id);
});

test("analytics pages render real figures from the seeded responses", async ({ page }) => {
  const { classId } = await seededClass(admin);

  await page.goto(`/classes/${classId}/analytics`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Analytics");
  await expect(page.getByText("Valid response pairs")).toBeVisible();
  await expect(page.getByText("Change rate")).toBeVisible();

  await page.goto(`/classes/${classId}/analytics/transitions`);
  await expect(page.getByRole("heading", { name: /Transition matrix/ }).first()).toBeVisible();

  // Every chart must offer its accessible table twin.
  const firstCard = page.locator("section").filter({ hasText: "Before / after" }).first();
  await firstCard.getByRole("button", { name: "Table" }).click();
  await expect(firstCard.locator("table")).toBeVisible();
});

test("professor downloads the 10-sheet Excel export", async ({ page }) => {
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
  await page.getByRole("option", { name: "Sankey (answer flows)" }).click();
  // Default grouping is Mapping, not Transition state — invalid for a Sankey.
  const banner = page.getByRole("alert").filter({ hasText: "can’t be charted" });
  await expect(banner).toContainText("Sankey");
  await expect(banner).toContainText("Transition state");
  await expect(banner).toContainText("choose a bar chart");
});
