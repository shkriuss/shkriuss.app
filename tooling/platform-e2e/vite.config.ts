import { fileURLToPath } from "node:url";
import { edge, REPORT_WORKER_VIOLATIONS } from "@shkriuss/edge";
import { webAppManifest } from "@shkriuss/pwa/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/**
 * Builds `src/sw.ts` into `/sw.js`, the only place a service worker can control the whole app
 * from. It is a stand-in that answers the tests' messages, which the real service worker of
 * `@shkriuss/pwa` ignores; tooling/pwa-e2e tests the real one. As every worker script, it starts
 * with the code that reports a Content-Security-Policy violation inside it.
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
    renderChunk(code, chunk) {
      return chunk.fileName === "sw.js"
        ? { code: `${REPORT_WORKER_VIOLATIONS}${code}`, map: null }
        : null;
    },
  };
}

export default defineConfig({
  plugins: [
    serviceWorker(),
    // The manifest and the icons of an app, with the glyph of the hub's favicon: a ring.
    webAppManifest({
      name: "Platform tests",
      shortName: "Platform",
      description: "The test app of the platform's packages, which is never deployed.",
      accent: "#1d4ed8",
      icon: {
        size: 24,
        paths: [
          {
            d: "M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20Z M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12Z",
            fillRule: "evenodd",
          },
        ],
      },
    }),
    tailwindcss(),
    react(),
    // Its wasm worker compiles WebAssembly (ADR 0014).
    edge({ webAssembly: true }),
  ],
});
