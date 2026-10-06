import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The components and hooks need React in a browser: tooling/platform-e2e tests them.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/use*.ts"],
      // ADR 0008: at least 90% of lines and branches.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
