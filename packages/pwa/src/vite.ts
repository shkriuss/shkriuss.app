import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_WORKER_PLUGIN, type ServiceWorkerApi } from "@shkriuss/edge";
import { build, type Plugin } from "vite";
import { isVersionId } from "./protocol.ts";
import { serviceWorkerScript } from "./script.ts";

export interface PwaOptions {
  /**
   * The ids of broken versions that this build replaces as soon as it has installed, reloading
   * every window of the app (§8). A version's id is the `version` in its `/sw.js`.
   */
  readonly replaces?: readonly string[];
  /** Publishes a `/sw.js` that removes the service worker and its caches instead (§9). */
  readonly remove?: boolean;
}

/** The entry scripts of the service worker, and of the one that removes it. */
const SERVE_ENTRY = fileURLToPath(new URL("../worker/sw.ts", import.meta.url));
const REMOVE_ENTRY = fileURLToPath(new URL("../worker/remove.ts", import.meta.url));

/** The plugin that writes the build's other files and calls this one (`@shkriuss/edge`). */
const EDGE_PLUGIN = "shkriuss:edge";

/** Bundles a service worker into one classic script, with the ids of the modules it includes. */
async function bundle(entry: string): Promise<{ code: string; modules: string[] }> {
  const result = await build({
    configFile: false,
    envDir: false,
    logLevel: "warn",
    root: path.dirname(entry),
    build: {
      write: false,
      minify: true,
      copyPublicDir: false,
      reportCompressedSize: false,
      lib: { entry, formats: ["iife"], name: "serviceWorker", fileName: () => "sw.js" },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    "output" in output ? output.output : [],
  );
  const [script, ...others] = outputs;
  if (script?.type !== "chunk" || others.length > 0) {
    throw new Error("The service worker must bundle into one script.");
  }
  const modules = Object.entries(script.modules)
    .filter(([, module]) => module.renderedLength > 0)
    .map(([id]) => id);
  return { code: script.code, modules };
}

/**
 * Vite plugin that gives an app its service worker (docs/specs/service-worker.md). Add it
 * before `edge()`, which writes `/sw.js` once every other file of the build is final:
 *
 * ```ts
 * plugins: [tailwindcss(), react(), pwa(), edge({ appId: "notes" })];
 * ```
 *
 * It also tells the page's `startServiceWorker()` whether this build serves the app offline or
 * removes the service worker.
 */
export function pwa(options: PwaOptions = {}): Plugin<ServiceWorkerApi> {
  const { replaces = [], remove = false } = options;
  for (const version of replaces) {
    if (!isVersionId(version)) {
      throw new Error(`${JSON.stringify(version)} is not a version id: 16 lowercase hex digits.`);
    }
  }
  if (remove && replaces.length > 0) {
    throw new Error("A build that removes the service worker replaces no version.");
  }
  return {
    name: SERVICE_WORKER_PLUGIN,
    config() {
      return { define: { SHKRIUSS_PWA_MODE: JSON.stringify(remove ? "remove" : "serve") } };
    },
    configResolved(config) {
      if (config.command === "build" && !config.plugins.some(({ name }) => name === EDGE_PLUGIN)) {
        throw new Error("pwa() needs edge() from @shkriuss/edge, which writes /sw.js.");
      }
    },
    api: {
      async bundle() {
        const { code, modules } = await bundle(remove ? REMOVE_ENTRY : SERVE_ENTRY);
        return {
          modules,
          script: (files) => (remove ? code : serviceWorkerScript(code, files, replaces).script),
        };
      },
    },
  };
}
