import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, isHexColor } from "./contrast.ts";

// The color tokens of styles.css, which is their only source, in each theme.

const CSS = readFileSync(new URL("styles.css", import.meta.url), "utf8");

/** The `--color-*` values of a block of `CSS`, from `start` to the first `}` after it. */
function colorsAfter(start: string): Map<string, string> {
  const from = CSS.indexOf(start);
  if (from === -1) {
    throw new Error(`styles.css has no ${start}.`);
  }
  const block = CSS.slice(from, CSS.indexOf("}", from));
  return new Map(
    [...block.matchAll(/--color-([a-z-]+):\s*([^;]+);/g)].map(([, name, value]) => [
      name ?? "",
      value?.trim() ?? "",
    ]),
  );
}

const light = colorsAfter("@theme {");
const dark = colorsAfter("@media (prefers-color-scheme: dark)");
const THEMES = [
  ["light", light],
  ["dark", dark],
] as const;

/** Text and the background it is on: at least 4.5 (WCAG 1.4.3). */
const TEXT = [
  ["ink", "canvas"],
  ["ink", "surface"],
  ["ink-muted", "canvas"],
  ["ink-muted", "surface"],
  ["accent", "canvas"],
  ["accent", "surface"],
  ["accent-ink", "accent"],
  ["danger", "canvas"],
  ["danger", "surface"],
  ["danger-ink", "danger"],
] as const;

/** The borders of controls and the focus outline, and what they are on: at least 3 (WCAG 1.4.11). */
const NON_TEXT = [
  ["line-strong", "canvas"],
  ["line-strong", "surface"],
  ["focus", "canvas"],
  ["focus", "surface"],
] as const;

function color(theme: ReadonlyMap<string, string>, name: string): string {
  const value = theme.get(name);
  if (value === undefined) {
    throw new Error(`The theme has no color ${name}.`);
  }
  return value;
}

describe("color tokens", () => {
  it("are the same colors in both themes, each as #rrggbb", () => {
    expect(light.size).toBeGreaterThan(0);
    expect([...dark.keys()].toSorted()).toStrictEqual([...light.keys()].toSorted());
    const values = [...light.values(), ...dark.values()];
    expect(values.filter((value) => !isHexColor(value))).toStrictEqual([]);
  });

  it("are tested in every pair below, and only those exist", () => {
    const tested = new Set<string>([...TEXT, ...NON_TEXT].flat());
    expect([...light.keys()].filter((name) => !tested.has(name))).toStrictEqual(["line"]);
  });

  describe.each(THEMES)("in the %s theme", (_theme, colors) => {
    it.each(TEXT)("give text in %s on %s a contrast of at least 4.5", (text, background) => {
      expect(contrastRatio(color(colors, text), color(colors, background))).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it.each(NON_TEXT)("give %s on %s a contrast of at least 3", (part, background) => {
      expect(contrastRatio(color(colors, part), color(colors, background))).toBeGreaterThanOrEqual(
        3,
      );
    });
  });
});
