/**
 * The web app manifest of an app (W3C Web App Manifest; architecture §9): what browsers need to
 * install it, and how the installed app looks. Every app gets the same shape, with its own
 * name, description, accent color and glyph.
 */

import { appIcons, type IconFile, type IconSource } from "./icons/icons.ts";

export interface WebAppManifestOptions {
  /** The app's name, as installed apps and the app switcher show it. */
  readonly name: string;
  /** The name under the icon on a home screen: at most 12 characters. `name` if left out. */
  readonly shortName?: string;
  /** What the app does, in one sentence. */
  readonly description: string;
  /** The app's accent color, as `#rrggbb`: the background of its icons. */
  readonly accent: string;
  /** The glyph on the app's icons, in white. */
  readonly icon: IconSource;
}

/**
 * The platform's colors that the browser shows around an installed app, from the design tokens
 * of `@shkriuss/ui`, which a test keeps equal: the surface of the frame's header in each theme,
 * so that the title bar and the header look like one, and the canvas while the app loads.
 */
export const THEME_COLORS = {
  light: { surface: "#f3f4f6", canvas: "#ffffff" },
  dark: { surface: "#1f2937", canvas: "#111827" },
} as const;

/** The longest short name that home screens show whole under an icon. */
const SHORT_NAME_LENGTH = 12;

export const MANIFEST_FILE = "manifest.webmanifest";

/** The manifest, and the files of the icons it lists. */
export interface AppManifest {
  readonly manifest: string;
  readonly icons: readonly IconFile[];
}

/**
 * Builds the manifest and the icons. The manifest's `id` is `/`, the app's root, which never
 * changes, so a browser always knows an installed app as the same one.
 */
export function appManifest(options: WebAppManifestOptions): AppManifest {
  const name = options.name.trim();
  const shortName = (options.shortName ?? name).trim();
  const description = options.description.trim();
  if (name === "" || shortName === "" || description === "") {
    throw new Error("An app's manifest needs a name, a short name and a description.");
  }
  // Characters as people count them, so that an emoji of several code points is one.
  const characters = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(shortName)];
  if (characters.length > SHORT_NAME_LENGTH) {
    throw new Error(
      `"${shortName}" is longer than ${SHORT_NAME_LENGTH} characters, which home screens cut short: give a shorter shortName.`,
    );
  }
  const icons = appIcons(options.icon, { background: options.accent, foreground: "#ffffff" });
  const manifest = {
    id: "/",
    name,
    short_name: shortName,
    description,
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: THEME_COLORS.light.canvas,
    theme_color: THEME_COLORS.light.surface,
    icons: icons.flatMap(({ fileName, manifest: entry }) =>
      entry === undefined ? [] : [{ src: `/${fileName}`, ...entry }],
    ),
  };
  return { manifest: `${JSON.stringify(manifest, null, 2)}\n`, icons };
}
