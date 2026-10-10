import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appIconSvg, appManifest, THEME_COLORS, type WebAppManifestOptions } from "./manifest.ts";

const OPTIONS: WebAppManifestOptions = {
  name: "Notes",
  description: "Notes that stay on this device.",
  accent: "#1d4ed8",
  icon: { size: 24, paths: [{ d: "M4 4H20V20H4Z" }] },
};

describe("appManifest", () => {
  it("describes the app as browsers need to install it, with every icon", () => {
    const { manifest, icons } = appManifest(OPTIONS);
    expect(JSON.parse(manifest)).toStrictEqual({
      id: "/",
      name: "Notes",
      short_name: "Notes",
      description: "Notes that stay on this device.",
      lang: "en",
      dir: "ltr",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#f3f4f6",
      prefer_related_applications: false,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
        { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        {
          src: "/icon-monochrome-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "monochrome",
        },
      ],
    });
    expect(manifest.endsWith("}\n")).toBe(true);
    expect(icons.map(({ fileName }) => fileName)).toStrictEqual([
      "icon-192.png",
      "icon-512.png",
      "icon-maskable-192.png",
      "icon-maskable-512.png",
      "icon-monochrome-512.png",
      "apple-touch-icon.png",
      "favicon.svg",
    ]);
  });

  it("takes a short name for the home screen, and trims the names", () => {
    const { manifest } = appManifest({
      ...OPTIONS,
      name: "  Shopping lists ",
      shortName: " Shopping ",
    });
    expect(JSON.parse(manifest)).toMatchObject({ name: "Shopping lists", short_name: "Shopping" });
  });

  it("refuses names that are missing, or too long for a home screen", () => {
    expect(() => appManifest({ ...OPTIONS, name: " " })).toThrow("needs a name");
    expect(() => appManifest({ ...OPTIONS, description: "" })).toThrow("needs a name");
    expect(() => appManifest({ ...OPTIONS, name: "Shopping lists" })).toThrow(
      '"Shopping lists" is longer than 12 characters',
    );
    // Characters as people count them: twelve emoji fit, even of several code points each.
    expect(() => appManifest({ ...OPTIONS, shortName: "👩‍💻".repeat(12) })).not.toThrow();
    expect(() => appManifest({ ...OPTIONS, shortName: "👩‍💻".repeat(13) })).toThrow(
      "longer than 12 characters",
    );
  });

  it("refuses an accent that is no color, and a glyph that cannot be drawn", () => {
    expect(() => appManifest({ ...OPTIONS, accent: "blue" })).toThrow("is not a color");
    expect(() => appManifest({ ...OPTIONS, icon: { size: 24, paths: [] } })).toThrow(
      "at least one path",
    );
  });
});

describe("THEME_COLORS", () => {
  it("are the canvas and surface tokens of @shkriuss/ui, in both themes", () => {
    const css = readFileSync(new URL("../../ui/src/styles.css", import.meta.url), "utf8");
    const token = (block: string, name: string): string | undefined => {
      const from = css.indexOf(block);
      const body = css.slice(from, css.indexOf("}", from));
      return new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6});`).exec(body)?.[1];
    };
    expect(THEME_COLORS).toStrictEqual({
      light: { surface: token("@theme {", "surface"), canvas: token("@theme {", "canvas") },
      dark: {
        surface: token("@media (prefers-color-scheme: dark)", "surface"),
        canvas: token("@media (prefers-color-scheme: dark)", "canvas"),
      },
    });
  });
});

describe("appIconSvg", () => {
  it("draws the app's icon as its favicon is drawn", () => {
    const favicon = appManifest(OPTIONS).icons.find(({ fileName }) => fileName === "favicon.svg");
    expect(appIconSvg(OPTIONS)).toBe(new TextDecoder().decode(favicon?.bytes));
    expect(appIconSvg(OPTIONS)).toContain('fill="#1d4ed8"');
  });

  it("refuses an accent that is no color", () => {
    expect(() => appIconSvg({ ...OPTIONS, accent: "blue" })).toThrow("is not a color");
  });
});
