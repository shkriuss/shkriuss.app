import type { AppConfig } from "@shkriuss/shell/vite";
import { m } from "./src/messages.ts";

/**
 * What this app is (architecture §6), for its build and its screens. Its id is permanent: it is
 * the app's subdomain and folder, and the app that its backups belong to.
 */
export const config = {
  id: "checklists",
  name: m.appName(),
  shortName: m.appShortName(),
  description: m.appDescription(),
  accent: "#15803d",
  // The glyph on the app's icons, in white: filled SVG paths in a square of 24 units.
  icon: {
    size: 24,
    paths: [{ d: "M3.58 13.42 9.5 19.34 20.42 8.42 18.58 6.58 9.5 15.66 5.42 11.58Z" }],
  },
} satisfies AppConfig;
