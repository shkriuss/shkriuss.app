import { defineConfig } from "@playwright/test";
import { playwrightConfig } from "@shkriuss/config/playwright";

const port = 4175;

// The shared setup, but with the test server of server.ts: every build of the test app at one
// origin, each served by Wrangler with its own _headers.
export default defineConfig({
  ...playwrightConfig({ port }),
  webServer: {
    command: `node server.ts ${port}`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
});
