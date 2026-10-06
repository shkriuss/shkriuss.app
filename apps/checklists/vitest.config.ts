import { defineConfig } from "vitest/config";

// The app's logic in Node, without its build: its screens are tested in browsers, in e2e/.
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
