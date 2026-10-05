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

  // Which regions have English formats depends on the browser's Unicode data: Georgia and
  // Japan gained them with CLDR 48. AA is a private-use region, which no data will ever cover,
  // so it stands for the regions that a browser's data does not.
  it.each([
    ["de-AA", "h23"],
    ["ko-AA", "h12"],
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
