import { fileURLToPath } from "node:url";
import { edge } from "@shkriuss/edge";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Builds `src/sw.ts` into `/sw.js`, the only place a service worker can control the whole app
 * from. It is a stand-in that answers the tests' messages, which the real service worker of
 * `@shkriuss/pwa` ignores; tooling/pwa-e2e tests the real one.
 */
function serviceWorker(): Plugin {
  return {
    name: "platform-e2e:service-worker",
    apply: "build",
    buildStart() {
      this.emitFile({
        type: "chunk",
        id: fileURLToPath(new URL("src/sw.ts", import.meta.url)),
        fileName: "sw.js",
      });
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker(), tailwindcss(), react(), edge()],
});
