import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js sets tsconfig jsx: "preserve"; tell esbuild to use the
  // automatic runtime so .tsx tests don't need `import React`.
  esbuild: { jsx: "automatic" },
  resolve: {
    // Mirror tsconfig's "@/*" path alias.
    alias: { "@": resolve(__dirname) },
  },
  test: {
    environment: "jsdom",
    globals: true,
    // Vitest owns tests/**; Playwright owns e2e/**. Without this, vitest's
    // default include picks up e2e/*.spec.ts and fails to collect them
    // because they import @playwright/test.
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "e2e/**", ".next/**"],
  },
});
