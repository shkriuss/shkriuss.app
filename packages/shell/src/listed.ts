import { PRODUCTION_DOMAIN } from "@shkriuss/edge/domains";
import type { CatalogApp } from "./catalog.ts";

/**
 * The apps that the hub at `hostname` lists (ADR 0015, docs/specs/hub.md §2): in production,
 * only the released ones, which production has; elsewhere, as on staging, every app. The hub's
 * build is the same in both, so it decides where it runs.
 */
export function listedApps(apps: readonly CatalogApp[], hostname: string): readonly CatalogApp[] {
  return hostname === PRODUCTION_DOMAIN ? apps.filter((app) => app.released) : apps;
}
