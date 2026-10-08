import type { AppConfig } from "@shkriuss/shell/vite";
import { m } from "./src/messages.ts";

/**
 * What this app is (architecture §6), for its build and its screens. Its id is permanent: it is
 * the app's subdomain and folder.
 */
export const config = {
  id: "grammar",
  name: m.appName(),
  shortName: m.appShortName(),
  description: m.appDescription(),
  accent: "#4338ca",
  // The glyph on the app's icons, in white: a capital A, with a check mark, in a square of 24
  // units.
  icon: {
    size: 24,
    paths: [
      {
        d: "M2 19 6.6 5h1.8L13 19h-2.1l-1-3.2H5.1L4.1 19Z M5.7 13.9h3.6L7.5 8.3Z",
        fillRule: "evenodd",
      },
      { d: "M13.5 16.6l1.4-1.4 2.2 2.2 4-4 1.4 1.4-5.4 5.4Z" },
    ],
  },
  // The app keeps nothing: it has no database and no backups, whose code its build cannot have.
  keepsData: false,
  // Its checker is Harper, compiled to WebAssembly, in a worker (ADR 0014).
  webAssembly: true,
  // Harper's module, 8 MB to download, comes only once the checker first starts (ADR 0019).
  keepOnFirstUse: [".wasm"],
  // Copy puts the text on the clipboard.
  allowedFeatures: ["clipboard-write"],
  // Production gets it: it was checked on real devices (ADR 0015).
  released: true,
} satisfies AppConfig;
