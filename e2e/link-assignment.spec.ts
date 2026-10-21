import { test, expect } from "@playwright/test";
import {
  adminClient,
  PROFESSOR_EMAIL,
  requireEnv,
  signIn,
  signOut,
  STUDENT_DOMAIN,
} from "./helpers";

/**
 * Link-type assignment (migration 0032), end to end: the professor creates
 * a Google Form link assignment through the real form, approves it with a
 * window that is open now, and a student sees it in their list and opens
 * it to an Open button pointing at the exact URL — with no attempt row.
 *
 * Everything is created on a fresh class and removed in afterAll.
 */

const admin = adminClient();
const STUDENT_EMAIL = `e2e-link-student-${Date.now()}@${STUDENT_DOMAIN}`;
const STUDENT_PASSWORD = "E2e-Link-Student-1!";
const FORM_URL = `https://forms.gle/e2e${Date.now()}`;
const TITLE = `E2E Feedback Form ${Date.now()}`;

let classId: string;
let studentId: string;

/** datetime-local value, in the local timezone the browser shares. */
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test.beforeAll(async () => {
  requireEnv();
  const { data: professor } = await admin
    .from("profiles")
    .select("id")
    .eq("email", PROFESSOR_EMAIL)
    .single();

  const { data: classRow, error: classError } = await admin
    .from("classes")
    .insert({
      name: `E2E Link Class ${Date.now()}`,
      professor_id: professor!.id,
      class_code: `E2EL${Date.now().toString(36).toUpperCase()}`,
    })
    .select("id")
    .single();
  if (classError) throw new Error(`e2e class insert failed: ${classError.message}`);
  classId = classRow!.id;

  const { data, error } = await admin.auth.admin.createUser({
    email: STUDENT_EMAIL,
    password: STUDENT_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create e2e student: ${error.message}`);
  studentId = data.user!.id;
  await admin.from("profiles").insert({
    id: studentId,
    email: STUDENT_EMAIL,
    full_name: "E2E Link Student",
    role: "STUDENT",
    is_active: true,
  });
  await admin
    .from("class_members")
    .insert({ class_id: classId, user_id: studentId, member_role: "STUDENT", status: "ACTIVE" });
});

test.afterAll(async () => {
  await admin.from("classes").delete().eq("id", classId);
  await admin.from("class_members").delete().eq("user_id", studentId);
  await admin.from("profiles").delete().eq("id", studentId);
  await admin.auth.admin.deleteUser(studentId);
});

test("professor creates and schedules a link assignment; the student sees it with the right URL", async ({
  page,
  context,
}) => {
  await signIn(context, PROFESSOR_EMAIL, process.env.SEED_PROFESSOR_PASSWORD!);

  await page.goto(`/classes/${classId}/assignments/new`);
  await page.getByLabel(/Google Form link/).check();
  await page.getByLabel("Form link").fill(FORM_URL);
  await page.getByLabel("Title").fill(TITLE);
  await page.getByLabel("Description").fill("Tell us how the unit went.");
  await page.getByLabel("Opens at").fill(localInput(new Date(Date.now() - 24 * 3600_000)));
  await page.getByLabel("Closes at").fill(localInput(new Date(Date.now() + 24 * 3600_000)));
  await page.getByRole("button", { name: "Create assignment" }).click();

  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByRole("link", { name: FORM_URL })).toBeVisible();
  // No grid machinery on a link assignment's page.
  await expect(page.getByRole("heading", { name: /^Questions/ })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Import questions" })).toHaveCount(0);

  await page.getByLabel("I have opened the link and it is the right Form.").check();
  await page.getByRole("button", { name: "Mark ready to schedule" }).click();
  await expect(page.getByText(/Students can see the link now/)).toBeVisible();

  await signOut(context);
  await signIn(context, STUDENT_EMAIL, STUDENT_PASSWORD);

  await page.goto("/assignments");
  const row = page.locator("li").filter({ hasText: TITLE });
  await expect(row.getByText("Google Form", { exact: true })).toBeVisible();
  await row.getByRole("link", { name: "View" }).click();

  await expect(page.getByRole("heading", { name: TITLE })).toBeVisible();
  await expect(page.getByText("Tell us how the unit went.")).toBeVisible();
  const open = page.getByRole("link", { name: /Open/ });
  await expect(open).toHaveAttribute("href", FORM_URL);
  await expect(open).toHaveAttribute("target", "_blank");
  await expect(open).toHaveAttribute("rel", "noopener noreferrer");

  const { data: assignment } = await admin.from("assignments").select("id").eq("title", TITLE).single();
  const { count } = await admin
    .from("assignment_attempts")
    .select("id", { count: "exact", head: true })
    .eq("assignment_id", assignment!.id);
  expect(count).toBe(0);
});
