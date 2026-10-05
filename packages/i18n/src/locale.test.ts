import { describe, expect, it } from "vitest";
import { deviceLocale, uiLocale } from "./locale.ts";

describe("uiLocale (architecture §10)", () => {
  it.each([
    ["de-DE", "en-DE", "h23"],
    ["de", "en-DE", "h23"],
    ["en-US", "en-US", "h12"],
    ["en", "en-US", "h12"],
    ["en-GB", "en-GB", "h23"],
    ["fr-CA", "en-CA", "h23"],
    ["en-US-u-hc-h23", "en-US", "h23"],
  ])("formats for %s in %s with a %s clock", (device, locale, hourCycle) => {
    expect(uiLocale(device)).toStrictEqual({ locale, hourCycle });
  });

  it.each([
    ["ka-GE", "h23"],
    ["ja-JP", "h23"],
    ["ko-KR", "h12"],
  ])(
    "formats for %s in English with its %s clock, without English formats for its region",
    (device, hourCycle) => {
      expect(uiLocale(device)).toStrictEqual({ locale: "en", hourCycle });
    },
  );

  it("formats in English for a language without a region", () => {
    expect(uiLocale("xx").locale).toBe("en");
  });
});

describe("deviceLocale", () => {
  it("gives the locale the browser formats with", () => {
    const locale = deviceLocale();
    expect(Intl.getCanonicalLocales(locale)).toStrictEqual([locale]);
    expect(new Intl.NumberFormat().resolvedOptions().locale).toBe(locale);
  });
});
