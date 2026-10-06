import type { AppConfig } from "@shkriuss/shell/vite";
import { m } from "./src/messages.ts";

/**
 * What this app is (architecture §6), for its build and its screens. Its id is permanent: it is
 * the app's subdomain and folder, and the app that its backups belong to.
 */
export const config = {
  id: "template",
  name: m.appName(),
  shortName: m.appShortName(),
  description: m.appDescription(),
  accent: "#1d4ed8",
  // The glyph on the app's icons, in white: filled SVG paths in a square of 24 units.
  icon: { size: 24, paths: [{ d: "M5 5h14v3H5Z M5 10.5h14v3H5Z M5 16h9v3H5Z" }] },
} satisfies AppConfig;
