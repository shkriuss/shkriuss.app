import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      // browser/workers.ts needs a browser's Trusted Types: tooling/platform-e2e tests it.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts"],
      // ADR 0018: at least 90% of lines, branches, functions and statements.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
