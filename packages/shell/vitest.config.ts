import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      // The components and hooks need React in a browser, and browser.ts the browser's globals:
      // tooling/platform-e2e tests them.
      exclude: ["src/**/*.test.ts", "src/index.ts", "src/use*.ts", "src/browser.ts"],
      // ADR 0018: at least 90% of lines and branches.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
