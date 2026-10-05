import { describe, expect, it } from "vitest";
import { contrastRatio, isHexColor, relativeLuminance } from "./contrast.ts";

describe("relativeLuminance (WCAG 2.2)", () => {
  it.each([
    ["#000000", 0],
    ["#ffffff", 1],
    ["#FFFFFF", 1],
    ["#ff0000", 0.2126],
    ["#00ff00", 0.7152],
    ["#0000ff", 0.0722],
  ])("of %s is %d", (color, luminance) => {
    expect(relativeLuminance(color)).toBeCloseTo(luminance, 10);
  });

  it("makes each channel linear, with the formula's two parts", () => {
    // 10 / 255 is just below the cut at 0.04045, and 12 / 255 and 128 / 255 above it.
    expect(relativeLuminance("#0a0a0a")).toBeCloseTo(10 / 255 / 12.92, 10);
    expect(relativeLuminance("#0c0c0c")).toBeCloseTo(((12 / 255 + 0.055) / 1.055) ** 2.4, 10);
    expect(relativeLuminance("#808080")).toBeCloseTo(((128 / 255 + 0.055) / 1.055) ** 2.4, 10);
  });

  it.each(["#fff", "fff", "#ffffffff", "#gggggg", "white", ""])("refuses %j", (color) => {
    expect(isHexColor(color)).toBe(false);
    expect(() => relativeLuminance(color)).toThrow(TypeError);
  });
});

describe("contrastRatio (WCAG 2.2)", () => {
  it("is 21 for black and white, and 1 for one color", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 10);
    expect(contrastRatio("#1d4ed8", "#1d4ed8")).toBe(1);
  });

  it("puts the gray that just passes 4.5 on white on the right side of it", () => {
    expect(contrastRatio("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(4.5);
  });

  it("is the same in either order", () => {
    expect(contrastRatio("#ffffff", "#4b5563")).toBe(contrastRatio("#4b5563", "#ffffff"));
  });
});
