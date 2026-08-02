import { test, expect } from "@playwright/test";
import {
  adminClient,
  PROFESSOR_EMAIL,
  requireEnv,
  seededClass,
  signIn,
  signOut,
  STUDENT_DOMAIN,
} from "./helpers";

/**
 * Student workflow: sign in → answer → refresh mid-way (draft must
 * survive) → submit → receipt → professor reopens → resubmit.
 *
 * Uses a dedicated student created by this spec so it never disturbs the
 * seeded students the analytics figures are computed from.
 */

const admin = adminClient();
const STUDENT_EMAIL = `e2e-student-${Date.now()}@${STUDENT_DOMAIN}`;
const STUDENT_PASSWORD = "E2e-Student-Pass-1!";

let studentId: string;
let classId: string;
let a1Id: string;

test.beforeAll(async () => {
  requireEnv();
  const seeded = await seededClass(admin);
  classId = seeded.classId;
  a1Id = seeded.a1Id;

  const { data, error } = await admin.auth.admin.createUser({
    email: STUDENT_EMAIL,
    password: STUDENT_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create e2e student: ${error.message}`);
  studentId = data.user!.id;

  const { error: profileError } = await admin.from("profiles").insert({
    id: studentId,
    email: STUDENT_EMAIL,
    full_name: "E2E Student",
    role: "STUDENT",
    is_active: true,
  });
  if (profileError) throw new Error(`could not create e2e student profile: ${profileError.message}`);

  const { error: memberError } = await admin.from("class_members").insert({
    class_id: classId,
    user_id: studentId,
    member_role: "STUDENT",
    status: "ACTIVE",
  });
  if (memberError) throw new Error(`could not enrol e2e student: ${memberError.message}`);
});

test.afterAll(async () => {
  const failures: string[] = [];
  const step = async (label: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await fn();
    if (error) failures.push(`${label}: ${error.message}`);
  };
  await step("responses", () => admin.from("responses").delete().eq("student_id", studentId));
  await step("attempts", () =>
    admin.from("assignment_attempts").delete().eq("student_id", studentId)
  );
  await step("audit_logs", () => admin.from("audit_logs").delete().eq("actor_id", studentId));
  await step("class_members", () => admin.from("class_members").delete().eq("user_id", studentId));
  await step("profile", () => admin.from("profiles").delete().eq("id", studentId));
  await step("auth user", () => admin.auth.admin.deleteUser(studentId));
  if (failures.length > 0) {
    throw new Error(`e2e student cleanup left data behind — ${failures.join("; ")}`);
  }
});

test("student sees their assignments and can start one", async ({ page, context }) => {
  await signIn(context, STUDENT_EMAIL, STUDENT_PASSWORD);
  await page.goto("/assignments");

  await expect(page.getByRole("heading", { name: "Your assignments" })).toBeVisible();
  await expect(page.getByText("Assignment 1 — Classification of Energy Sources")).toBeVisible();
  await expect(page.getByRole("link", { name: "Start" }).first()).toBeVisible();
});

test("answers persist across a mid-assignment refresh, then submit and get a receipt", async ({
  page,
  context,
}) => {
  await signIn(context, STUDENT_EMAIL, STUDENT_PASSWORD);
  await page.goto(`/assignments/${a1Id}`);

  // The whole assignment is one grid: Assignment 1 is 15 energy sources
  // down the rows against 2 criteria across, exactly as the source
  // spreadsheet — 30 editable cells, no download, no upload.
  const cells = page.locator("button.cell-toggle");
  await expect(cells).toHaveCount(30);
  await expect(page.getByRole("columnheader").first()).toHaveText("Energy source");

  // Fill the first cell as 1 (two clicks: blank → 0 → 1).
  await cells.nth(0).click();
  await cells.nth(0).click();
  await expect(cells.nth(0)).toHaveAttribute("data-answer", "1");
  // Wait for the debounced autosave to report success.
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

  // Fill the second cell as 0, this time from the keyboard.
  await cells.nth(1).press("0");
  await expect(cells.nth(1)).toHaveAttribute("data-answer", "0");
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

  // THE REFRESH: reload mid-assignment; both answers must survive.
  await page.reload();
  await expect(page.getByRole("button", { name: /Review & submit \(2 of 30 answered\)/ })).toBeVisible();

  // Submit through the review step (the only submission path).
  await page.getByRole("button", { name: /Review & submit/ }).click();
  await expect(page.getByRole("heading", { name: "Review your answers" })).toBeVisible();
  await expect(page.getByText(/28 cells are still blank/)).toBeVisible();

  await page.getByRole("button", { name: "Submit assignment" }).click();
  await page.getByRole("button", { name: "Yes, submit now" }).click();

  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await expect(page.getByText("Questions answered")).toBeVisible();
  await expect(page.getByText("2 of 30")).toBeVisible();
  await expect(page.getByText("First submission")).toBeVisible();
});

test("professor reopens the attempt and the student resubmits", async ({ page, context }) => {
  // --- professor reopens ---
  await signIn(context, PROFESSOR_EMAIL, process.env.SEED_PROFESSOR_PASSWORD!);
  await page.goto(`/classes/${classId}/assignments/${a1Id}`);

  const row = page.locator("tr", { hasText: "E2E Student" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Reopen" }).click();
  await expect(row.getByText("Reopened")).toBeVisible();

  // --- student resubmits ---
  await signOut(context);
  await signIn(context, STUDENT_EMAIL, STUDENT_PASSWORD);

  await page.goto("/assignments");
  await expect(page.getByText(/Reopened — submit again/)).toBeVisible();

  await page.goto(`/assignments/${a1Id}`);
  // The reopened attempt keeps its answers; change a third cell and resubmit.
  await page.locator("button.cell-toggle").nth(2).press("1");
  await expect(page.getByRole("status")).toHaveText("Saved", { timeout: 15_000 });

  await page.getByRole("button", { name: /Review & submit/ }).click();
  await page.getByRole("button", { name: "Submit assignment" }).click();
  await page.getByRole("button", { name: "Yes, submit now" }).click();

  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await expect(page.getByText("Version 2")).toBeVisible();
});

test("a student cannot reach professor-only pages or another user's data", async ({
  page,
  context,
}) => {
  await signIn(context, STUDENT_EMAIL, STUDENT_PASSWORD);

  // Professor-only pages call notFound() for anyone who is not the class's
  // professor. Assert the rendered outcome rather than the HTTP status:
  // `next dev` streams notFound() with a 200 status while `next start`
  // returns a real 404, so the status is not a reliable signal here — the
  // content is, and it is what the student actually experiences.
  for (const path of [
    `/classes/${classId}/analytics`,
    `/classes/${classId}/analytics/assignments`,
    `/classes/${classId}/analytics/students`,
    `/classes/${classId}/analytics/builder`,
  ]) {
    await page.goto(path);
    await expect(page.getByText("This page could not be found")).toBeVisible();
    // And crucially: none of the professor's data leaked onto the page.
    await expect(page.getByText("Answered responses")).toHaveCount(0);
    await expect(page.getByText("Average consensus")).toHaveCount(0);
  }

  // /classes has no role gate by design — it is simply empty for a student,
  // because RLS scopes it to classes they own. Assert the RLS outcome
  // rather than a redirect that does not exist.
  await page.goto("/classes");
  await expect(page.getByRole("heading", { name: "Your classes" })).toBeVisible();
  // Regex, because the UI renders a typographic apostrophe (U+2019).
  await expect(page.getByText(/You haven.t created a class yet/)).toBeVisible();
});
