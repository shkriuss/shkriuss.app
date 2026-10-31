import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'packages/*/src/**/*.test.ts',
      'apps/*/src/**/*.test.ts',
      // An app's build scripts, like Grammar's model download (audit 5 H-2).
      'apps/*/scripts/**/*.test.ts',
      'scripts/**/*.test.ts',
      'tests/unit/**/*.test.ts',
    ],
    environment: 'node',
  },
});
