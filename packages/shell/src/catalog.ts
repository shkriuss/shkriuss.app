import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { assertAppId, type BrowserFeature, DENIED_FEATURES, OWN_GENERATED } from "@shkriuss/edge";
import { appIconSvg, type IconSource } from "@shkriuss/pwa/vite";
import type { Plugin } from "vite";

/** What the hub shows of an app (docs/specs/hub.md §2). */
export interface CatalogApp {
  /** The app's permanent id, which is its subdomain. */
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Its icon, drawn as on a home screen: an SVG, as a `data:` URL for an `<img>`. */
  readonly icon: string;
  /** The browser features that it may use, besides those that every app may; none for most. */
  readonly allowedFeatures: readonly BrowserFeature[];
  /**
   * Whether it keeps data, which only backups that the user saves take off the device; an app
   * without data has nothing that leaves it.
   */
  readonly keepsData: boolean;
  /** Whether production gets it (ADR 0015), so that the production hub lists it. */
  readonly released: boolean;
}

/** The module that gives the hub its catalog: `import { apps } from "virtual:shkriuss/catalog"`. */
export const CATALOG_MODULE = "virtual:shkriuss/catalog";

const RESOLVED_MODULE = `${OWN_GENERATED}catalog`;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIconSource(value: unknown): value is IconSource {
  return (
    isRecord(value) &&
    typeof value["size"] === "number" &&
    Array.isArray(value["paths"]) &&
    value["paths"].every(
      (shape: unknown) =>
        isRecord(shape) &&
        typeof shape["d"] === "string" &&
        (shape["fillRule"] === undefined ||
          shape["fillRule"] === "nonzero" ||
          shape["fillRule"] === "evenodd"),
    )
  );
}

function isFeature(value: unknown): value is BrowserFeature {
  return DENIED_FEATURES.some((feature) => feature === value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** What the catalog shows of the app in `folder`, from its configuration, which it checks. */
function catalogApp(folder: string, module: unknown): CatalogApp {
  const id = path.basename(folder);
  const file = `${path.basename(path.dirname(folder))}/${id}/app.config.ts`;
  const config = isRecord(module) ? module["config"] : undefined;
  if (!isRecord(config)) {
    throw new Error(`${file} must export the app's configuration as "config".`);
  }
  const {
    name,
    description,
    accent,
    icon,
    allowedFeatures = [],
    keepsData = true,
    released,
  } = config;
  if (config["id"] !== id) {
    throw new Error(`${file} must give its folder's name, "${id}", as the app's id.`);
  }
  assertAppId(id);
  if (!isText(name) || !isText(description)) {
    throw new Error(`${file} must give the app's name and description.`);
  }
  if (typeof accent !== "string" || !isIconSource(icon)) {
    throw new Error(`${file} must give the app's accent color and icon.`);
  }
  if (!Array.isArray(allowedFeatures) || !allowedFeatures.every(isFeature)) {
    throw new Error(`${file} must list only browser features that exist, in allowedFeatures.`);
  }
  if (typeof keepsData !== "boolean") {
    throw new Error(`${file} must say whether the app keeps data as true or false, if at all.`);
  }
  if (typeof released !== "boolean") {
    throw new Error(`${file} must say whether production gets the app, as released (ADR 0015).`);
  }
  return {
    id,
    name: name.trim(),
    description: description.trim(),
    icon: `data:image/svg+xml,${encodeURIComponent(appIconSvg({ accent, icon }))}`,
    allowedFeatures,
    keepsData,
    released,
  };
}

/**
 * Every app in `appsDirectory`, from the `app.config.ts` of each folder that has one, which the
 * hub, a site and no app, has not: sorted by name, as people read names.
 */
export async function readCatalog(appsDirectory: string): Promise<CatalogApp[]> {
  const folders = (await readdir(appsDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(appsDirectory, entry.name))
    .filter((folder) => existsSync(path.join(folder, "app.config.ts")));
  const apps = await Promise.all(
    folders.map(async (folder) => {
      const module: unknown = await import(pathToFileURL(path.join(folder, "app.config.ts")).href);
      return catalogApp(folder, module);
    }),
  );
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return apps.toSorted((a, b) => collator.compare(a.name, b.name) || (a.id < b.id ? -1 : 1));
}

/**
 * The hub's catalog of apps (docs/specs/hub.md §2), at build time: reads the `app.config.ts` of
 * every app in `appsDirectory` and gives the hub what it shows of them, as the module
 * `virtual:shkriuss/catalog`. Only those values reach the hub's bundle, never an app's code.
 * It is the one place that reads other apps' configuration; elsewhere, `pnpm check imports`
 * refuses imports of an app.
 */
export function catalog(appsDirectory: string): Plugin {
  return {
    name: "shkriuss:catalog",
    resolveId(id) {
      return id === CATALOG_MODULE ? RESOLVED_MODULE : undefined;
    },
    async load(id) {
      if (id !== RESOLVED_MODULE) {
        return undefined;
      }
      return `export const apps = ${JSON.stringify(await readCatalog(appsDirectory))};\n`;
    },
  };
}
