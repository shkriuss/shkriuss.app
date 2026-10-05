import { fileURLToPath } from "node:url";
import { edge } from "@shkriuss/edge";
import { defineConfig, type Plugin } from "vite";

/**
 * Builds `src/sw.ts` into `/sw.js`, the only place a service worker can control the whole app
 * from. `@shkriuss/pwa` will build the real service worker; this one only has to run.
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
  plugins: [serviceWorker(), edge()],
});
