import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{src,browser,worker}/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["{src,browser,worker}/**/*.ts"],
      // The entry scripts only connect the code to the browser's globals; the end-to-end tests
      // cover them.
      exclude: [
        "**/*.test.ts",
        "**/test/**",
        "browser/index.ts",
        "worker/sw.ts",
        "worker/remove.ts",
      ],
      // ADR 0018: at least 90% of lines and branches.
      thresholds: { lines: 90, branches: 90, functions: 90, statements: 90 },
    },
  },
});
