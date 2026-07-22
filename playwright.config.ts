import { defineConfig } from "@playwright/test";

/**
 * End-to-end tests run against the LOCAL Supabase stack and a dev server
 * pointed at it — never the hosted project, which holds real data.
 *
 * Start the stack and seed it first:
 *   npx supabase start && npx supabase db reset --local
 *   eval "$(npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
 *   SEED_SUPABASE_URL=$API_URL SEED_SUPABASE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
 *     SEED_ADMIN_PASSWORD=... SEED_PROFESSOR_PASSWORD=... SEED_STUDENT_PASSWORD=... \
 *     npm run db:seed
 *   E2E_SUPABASE_URL=$API_URL E2E_ANON_KEY=$ANON_KEY \
 *     E2E_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY npm run test:e2e
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
const ANON_KEY = process.env.E2E_ANON_KEY ?? "";
const SERVICE_ROLE_KEY = process.env.E2E_SERVICE_ROLE_KEY ?? "";

export default defineConfig({
  testDir: "./e2e",
  // These specs drive shared seed data through stateful workflows
  // (publish, submit, reopen), so they must not race each other.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    // The dev server must talk to the LOCAL stack, not whatever
    // .env.local points at.
    env: {
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
    },
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
});
