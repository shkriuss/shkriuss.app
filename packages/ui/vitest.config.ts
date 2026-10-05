import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The entry only exports, and marks a stylesheet present: browser tests cover it
      // (tooling/platform-e2e), as they do the components.
      exclude: ["src/**/*.test.ts", "src/index.ts"],
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
