declare module "virtual:shkriuss/catalog" {
  import type { CatalogApp } from "@shkriuss/shell/vite";

  /** Every app, sorted by name, from the build's `catalog()` plugin (docs/specs/hub.md §2). */
  export const apps: readonly CatalogApp[];
}
