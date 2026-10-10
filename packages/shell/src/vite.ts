import { fileURLToPath } from "node:url";
import { assertAppId, type BrowserFeature, edge, FIRST_PAGE_BUDGETS } from "@shkriuss/edge";
import {
  type PwaOptions,
  pwa,
  type WebAppManifestOptions,
  webAppManifest,
} from "@shkriuss/pwa/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { HtmlTagDescriptor, Plugin, UserConfig } from "vite";

export { CATALOG_MODULE, type CatalogApp, catalog, readCatalog } from "./catalog.ts";

/**
 * What an app is, in its `app.config.ts` (architecture §6): the source of its manifest and
 * icons, its page's title, its security headers, and the id that names it everywhere. Its name
 * and description come from the app's messages.
 */
export interface AppConfig extends WebAppManifestOptions {
  /**
   * The app's permanent id: its subdomain, its folder in `apps/`, and the app that its backups
   * belong to. It never changes, and is never used again (`CLAUDE.md`, product rule 3).
   */
  readonly id: string;
  /** Browser features that the app needs, such as `camera`; every other one stays denied. */
  readonly allowedFeatures?: readonly BrowserFeature[];
  /**
   * Whether the app's workers compile WebAssembly, which its Content-Security-Policy then
   * allows (ADR 0014). Its build must then have WebAssembly modules, and none otherwise.
   */
  readonly webAssembly?: boolean;
  /**
   * Large files that not every use of the app needs, by the ends of their names, such as
   * `".wasm"`: the service worker keeps them only once the app first requests one, not at
   * install, and they need the network until then (ADR 0019).
   */
  readonly keepOnFirstUse?: readonly string[];
  /**
   * Whether the app keeps data on the device, as most apps do: in a database of
   * `@shkriuss/data`, which the backups of `@shkriuss/backup` save. True if left out. An app
   * without data keeps nothing, and its build fails if it has the code of either package, or the
   * shell's text for apps with data. Its first page may load 150 kB of JavaScript, gzipped, and
   * an app with data 180 kB (ADR 0018).
   */
  readonly keepsData?: boolean;
  /**
   * Whether production gets the app (ADR 0015): only once the maintainer has checked it on real
   * devices. Staging gets every app. The deploy reads the line `released: true,` as it is.
   */
  readonly released: boolean;
}

/** The packages that keep data, whose code an app without data must not have. */
const DATA_PACKAGES = ["@shkriuss/data", "@shkriuss/backup"];

/**
 * The shell's text that only apps with data show, which an app without data must not have, and
 * so none of the shell's parts that show it, such as the backups.
 */
const DATA_MESSAGES = fileURLToPath(new URL("./data-messages.ts", import.meta.url));

export interface AppBuildOptions {
  /**
   * For the service worker's procedures of last resort: the broken versions that this build
   * replaces, or removing the service worker (`@shkriuss/pwa`, "Replacing a broken version").
   */
  readonly serviceWorker?: PwaOptions;
}

/** Text for the page's HTML, where Vite writes the text of a tag as it is. */
function escapeText(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
}

/** What a page says of itself before any script runs: its title, and its description. */
export interface PageHead {
  readonly name: string;
  readonly description: string;
}

/**
 * Gives the page `name` as its title, and its description, in its HTML: an app's, from its
 * `app.config.ts`, which `app()` does, and the hub's, from its messages. The text comes from
 * messages, as all text does (ADR 0012), rather than from the page's `index.html`.
 */
export function pageHead({ name, description }: PageHead): Plugin {
  return {
    name: "shkriuss:page-head",
    transformIndexHtml(): HtmlTagDescriptor[] {
      return [
        { tag: "title", children: escapeText(name), injectTo: "head" },
        { tag: "meta", attrs: { name: "description", content: description }, injectTo: "head" },
      ];
    },
  };
}

/**
 * The Vite configuration of an app, from its `app.config.ts`: React, Tailwind CSS, the page's
 * title, the service worker, the manifest and the icons, and the security headers, which
 * `edge()` writes last, once every other file is final. An app's `vite.config.ts` is only:
 *
 * ```ts
 * import { app } from "@shkriuss/shell/vite";
 * import { config } from "./app.config.ts";
 *
 * export default app(config);
 * ```
 *
 * It throws if the app's id cannot be one, before anything is built.
 */
export function app(config: AppConfig, options: AppBuildOptions = {}): UserConfig {
  assertAppId(config.id);
  const {
    id,
    allowedFeatures,
    webAssembly,
    keepOnFirstUse,
    keepsData = true,
    ...manifest
  } = config;
  return {
    plugins: [
      tailwindcss(),
      react(),
      pageHead(config),
      webAppManifest(manifest),
      pwa({
        ...options.serviceWorker,
        ...(keepOnFirstUse === undefined ? {} : { keepOnFirstUse }),
      }),
      edge({
        appId: id,
        ...(allowedFeatures === undefined ? {} : { allowedFeatures }),
        ...(webAssembly === undefined ? {} : { webAssembly }),
        // ADR 0018: an app with data has the platform's database and backups to load.
        firstPageBudget: keepsData ? FIRST_PAGE_BUDGETS.withData : FIRST_PAGE_BUDGETS.withoutData,
        ...(keepsData ? {} : { excludedPackages: DATA_PACKAGES, excludedFiles: [DATA_MESSAGES] }),
      }),
    ],
  };
}
