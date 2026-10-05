import { describe, expect, it } from "vitest";
import { createFormat } from "./format.ts";

/** Plain spaces for the no-break spaces that Unicode's data puts in some formats. */
const NO_BREAK = new RegExp(`[${String.fromCodePoint(0xa0, 0x202f)}]`, "gu");
const plain = (text: string): string => text.replaceAll(NO_BREAK, " ");

/** 14:30 in Berlin, 8:30 in New York and 16:30 in Tbilisi. */
const AT = new Date(Date.UTC(2026, 9, 5, 12, 30));

/** A time `minutes` before AT, or after it if negative. */
function before(minutes: number): Date {
  return new Date(AT.getTime() - minutes * 60_000);
}

/** A day, in minutes. */
const DAY = 24 * 60;

const german = createFormat("de-DE", { timeZone: "Europe/Berlin" });
const american = createFormat("en-US", { timeZone: "America/New_York" });
const georgian = createFormat("ka-GE", { timeZone: "Asia/Tbilisi" });

describe("dates and times", () => {
  it("follow the device's region, in English", () => {
    expect(german.date(AT)).toBe("5 Oct 2026");
    expect(german.time(AT)).toBe("14:30");
    expect(german.dateTime(AT)).toBe("5 Oct 2026, 14:30");
    expect(plain(american.date(AT))).toBe("Oct 5, 2026");
    expect(plain(american.time(AT))).toBe("8:30 AM");
    expect(plain(american.dateTime(AT))).toBe("Oct 5, 2026, 8:30 AM");
  });

  it("keep the device's 24-hour clock where the browser has no English formats for its region", () => {
    expect(georgian.locale).toStrictEqual({ locale: "en", hourCycle: "h23" });
    expect(georgian.date(AT)).toBe("Oct 5, 2026");
    expect(georgian.time(AT)).toBe("16:30");
    expect(georgian.dateTime(AT)).toBe("Oct 5, 2026, 16:30");
  });

  it("are in the device's time zone", () => {
    const local = createFormat("de-DE");
    expect(local.time(AT)).toBe(
      new Intl.DateTimeFormat("en-DE", { timeStyle: "short", hourCycle: "h23" }).format(AT),
    );
  });
});

describe("numbers", () => {
  it("have the region's separators", () => {
    expect(german.number(1234567.891)).toBe("1.234.567,891");
    expect(american.number(1234567.891)).toBe("1,234,567.891");
    expect(georgian.number(1234567.891)).toBe("1,234,567.891");
  });

  it.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [999, "999 bytes"],
    [1000, "1 kB"],
    [1234, "1.2 kB"],
    [999_940, "999.9 kB"],
    [999_950, "1 MB"],
    [1_250_000, "1.3 MB"],
    [5_000_000_000, "5 GB"],
    [2e12, "2 TB"],
    [3e15, "3,000 TB"],
  ])("show %d bytes as %s", (bytes, shown) => {
    expect(american.bytes(bytes)).toBe(shown);
  });

  it("show sizes with the region's decimal separator", () => {
    expect(german.bytes(1_250_000)).toBe("1,3 MB");
  });
});

describe("relative times", () => {
  it.each([
    [0.5, "now"],
    [-0.9, "now"],
    [1, "1 minute ago"],
    [59, "59 minutes ago"],
    [60, "1 hour ago"],
    [DAY - 1, "23 hours ago"],
    [-120, "in 2 hours"],
    [6 * DAY, "6 days ago"],
    [7 * DAY, "last week"],
    [20 * DAY, "2 weeks ago"],
    [27 * DAY, "3 weeks ago"],
    [28 * DAY, "last month"],
    [100 * DAY, "3 months ago"],
    [349 * DAY, "11 months ago"],
    [351 * DAY, "last year"],
    [800 * DAY, "2 years ago"],
    [-30 * DAY, "next month"],
  ])("say a time %d minutes earlier is %s", (minutes, shown) => {
    expect(german.relative(before(minutes), AT)).toBe(shown);
  });

  it("count calendar days in the device's time zone", () => {
    // 0:30 on October 4 in Berlin, 38 hours earlier, but still October 3 in UTC.
    expect(german.relative(new Date(Date.UTC(2026, 9, 3, 22, 30)), AT)).toBe("yesterday");
    // 23:30 on October 3 in Berlin.
    expect(german.relative(new Date(Date.UTC(2026, 9, 3, 21, 30)), AT)).toBe("2 days ago");
    // 23:30 on October 6 in Berlin, 33 hours later.
    expect(german.relative(new Date(Date.UTC(2026, 9, 6, 21, 30)), AT)).toBe("tomorrow");
  });
});

describe("lists", () => {
  const items = ["Milk", "Eggs", "Bread"];

  it("join items as the region does", () => {
    expect(german.list(items)).toBe("Milk, Eggs and Bread");
    expect(american.list(items)).toBe("Milk, Eggs, and Bread");
    expect(american.list(items, "or")).toBe("Milk, Eggs, or Bread");
    expect(german.list(["12 new", "3 updated", "1 deleted"], "units")).toBe(
      "12 new, 3 updated, 1 deleted",
    );
    expect(german.list(["Milk"])).toBe("Milk");
    expect(german.list([])).toBe("");
  });
});

describe("plurals", () => {
  const forms = { one: "# note", other: "# notes" };

  it.each([
    [0, "0 notes"],
    [1, "1 note"],
    [2, "2 notes"],
    [1.5, "1.5 notes"],
    [1234, "1,234 notes"],
  ])("are English for %d: %s", (count, shown) => {
    expect(american.plural(count, forms)).toBe(shown);
  });

  it("write the count with the region's separators", () => {
    expect(german.plural(1234, forms)).toBe("1.234 notes");
    expect(german.plural(1, { one: "a note", other: "# notes" })).toBe("a note");
  });
});
