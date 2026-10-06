import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_WORKER_PLUGIN, type ServiceWorkerApi } from "@shkriuss/edge";
import { build, type HtmlTagDescriptor, type Plugin } from "vite";
import {
  type AppManifest,
  appManifest,
  MANIFEST_FILE,
  THEME_COLORS,
  type WebAppManifestOptions,
} from "./manifest.ts";
import { isVersionId } from "./protocol.ts";
import { serviceWorkerScript } from "./script.ts";

export { appIconSvg, type WebAppManifestOptions } from "./manifest.ts";
export type { IconPath, IconSource } from "./icons/icons.ts";

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

/** A tag for the page's head. */
function tag(name: string, attrs: Record<string, string>): HtmlTagDescriptor {
  return { tag: name, attrs, injectTo: "head" };
}

/**
 * Vite plugin that gives an app its web app manifest and its icons (architecture §9), which
 * browsers need to install it:
 *
 * ```ts
 * plugins: [tailwindcss(), react(), webAppManifest({ name, description, accent, icon }), pwa(), edge()];
 * ```
 *
 * It writes `/manifest.webmanifest`, the PNG icons that it lists, the touch icon that iOS puts
 * on the home screen and the SVG favicon, all from the app's glyph, and links them from the
 * page, with the theme colors of both themes. The app's `public/` must not have files of the
 * same names.
 */
export function webAppManifest(options: WebAppManifestOptions): Plugin {
  // Checked and drawn once, when the configuration is read, so that a mistake fails at once.
  const { manifest, icons }: AppManifest = appManifest(options);
  const files = [MANIFEST_FILE, ...icons.map(({ fileName }) => fileName)];
  return {
    name: "shkriuss:web-app-manifest",
    apply: "build",
    configResolved(config) {
      for (const file of files) {
        if (config.publicDir !== "" && existsSync(path.join(config.publicDir, file))) {
          throw new Error(
            `public/${file} would take the place of the one that webAppManifest() writes; remove it.`,
          );
        }
      }
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: MANIFEST_FILE, source: manifest });
      for (const { fileName, bytes } of icons) {
        this.emitFile({ type: "asset", fileName, source: bytes });
      }
    },
    transformIndexHtml() {
      return [
        tag("link", { rel: "manifest", href: `/${MANIFEST_FILE}` }),
        tag("link", { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }),
        tag("link", { rel: "apple-touch-icon", href: "/apple-touch-icon.png" }),
        tag("meta", {
          name: "theme-color",
          content: THEME_COLORS.light.surface,
          media: "(prefers-color-scheme: light)",
        }),
        tag("meta", {
          name: "theme-color",
          content: THEME_COLORS.dark.surface,
          media: "(prefers-color-scheme: dark)",
        }),
      ];
    },
  };
}
