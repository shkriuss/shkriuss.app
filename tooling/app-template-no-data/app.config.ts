import type { AppConfig } from "@shkriuss/shell/vite";
import { m } from "./src/messages.ts";

/**
 * What this app is (architecture §6), for its build and its screens. Its id is permanent: it is
 * the app's subdomain and folder.
 */
export const config = {
  id: "template-no-data",
  name: m.appName(),
  shortName: m.appShortName(),
  description: m.appDescription(),
  accent: "#1d4ed8",
  // The glyph on the app's icons, in white: filled SVG paths in a square of 24 units.
  icon: { size: 24, paths: [{ d: "M5 5h14v3H5Z M5 10.5h14v3H5Z M5 16h9v3H5Z" }] },
  // The app keeps nothing: it has no database and no backups, whose code its build cannot have.
  keepsData: false,
  // Production gets a new app only once it has been checked on real devices (ADR 0015).
  released: false,
} satisfies AppConfig;
