import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" path alias.
    alias: { "@": resolve(__dirname) },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
