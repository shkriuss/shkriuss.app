import { assertAppId, type BrowserFeature, edge } from "@shkriuss/edge";
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
}

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

/** Gives the page the app's name as its title, and its description, from `app.config.ts`. */
function pageHead({ name, description }: AppConfig): Plugin {
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
  const { id, allowedFeatures, ...manifest } = config;
  return {
    plugins: [
      tailwindcss(),
      react(),
      pageHead(config),
      webAppManifest(manifest),
      pwa(options.serviceWorker),
      edge({ appId: id, ...(allowedFeatures === undefined ? {} : { allowedFeatures }) }),
    ],
  };
}
