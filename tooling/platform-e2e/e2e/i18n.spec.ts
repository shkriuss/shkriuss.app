import { expect, test } from "@shkriuss/config/playwright";
import { load } from "./app.ts";

// The formats of the UI (architecture §10) with each browser's own Unicode data: English, with
// the regional conventions of the device, here one set to German in Berlin.

test("formats in English with the device's regional conventions", async ({ page }) => {
  await load(page);
  const shown = await page.evaluate(() => {
    if (window.platform === undefined) {
      throw new Error("The test app has not loaded.");
    }
    const format = window.platform.createFormat("de-DE", { timeZone: "Europe/Berlin" });
    const at = new Date(Date.UTC(2026, 9, 5, 12, 30));
    return {
      locale: format.locale,
      date: format.date(at),
      time: format.time(at),
      number: format.number(1234.5),
      bytes: format.bytes(1_250_000),
      // 0:30 on October 4 in Berlin.
      relative: format.relative(new Date(Date.UTC(2026, 9, 3, 22, 30)), at),
      list: format.list(["Milk", "Eggs", "Bread"]),
    };
  });
  expect(shown).toEqual({
    locale: { locale: "en-DE", hourCycle: "h23" },
    date: "5 Oct 2026",
    time: "14:30",
    number: "1.234,5",
    bytes: "1,3 MB",
    relative: "yesterday",
    list: "Milk, Eggs and Bread",
  });
});
