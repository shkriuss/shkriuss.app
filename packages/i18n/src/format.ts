import { type UiLocale, deviceLocale, uiLocale } from "./locale.ts";

export interface FormatOptions {
  /** The time zone of dates and times: the device's, unless a test says otherwise. */
  readonly timeZone?: string;
}

/** Formats for the UI, in English with the device's regional conventions (see `uiLocale()`). */
export interface Format {
  readonly locale: UiLocale;
  /** A number, such as "1,234.5". */
  number(value: number): string;
  /** A size in bytes, in units of 1,000 as phones show them: "512 bytes", "1.2 MB". */
  bytes(value: number): string;
  /** A date: "5 Oct 2026", or "Oct 5, 2026" in the United States. */
  date(date: Date): string;
  /** A time, with the device's clock: "14:30" or "2:30 PM". */
  time(date: Date): string;
  /** A date and a time: "5 Oct 2026, 14:30". */
  dateTime(date: Date): string;
  /**
   * How long ago `date` was, or how far ahead it is, seen from `now`: "now", "5 minutes ago",
   * "yesterday", "last week", "3 months ago", "in 2 hours". Days are calendar days, so that
   * "yesterday" is always the day before today.
   */
  relative(date: Date, now: Date): string;
  /** A list: "Milk, Eggs and Bread"; with "or"; or as units, "12 new, 3 updated, 1 deleted". */
  list(items: readonly string[], type?: "and" | "or" | "units"): string;
}

const BYTE_UNITS = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The days and months of an average year, for distances of weeks and more. */
const DAYS_PER_MONTH = 365.2425 / 12;

/** The formats of the UI on a device that formats with `device`. */
export function createFormat(device = deviceLocale(), { timeZone }: FormatOptions = {}): Format {
  const locale = uiLocale(device);
  const { hourCycle } = locale;
  const numbers = new Intl.NumberFormat(locale.locale);
  const bytes = new Intl.NumberFormat(locale.locale, {
    style: "unit",
    unit: "byte",
    unitDisplay: "long",
  });
  const larger = BYTE_UNITS.map(
    (unit) =>
      new Intl.NumberFormat(locale.locale, {
        style: "unit",
        unit,
        unitDisplay: "short",
        maximumFractionDigits: 1,
      }),
  );
  const dates = new Intl.DateTimeFormat(locale.locale, { dateStyle: "medium", timeZone });
  const times = new Intl.DateTimeFormat(locale.locale, {
    timeStyle: "short",
    hourCycle,
    timeZone,
  });
  const dateTimes = new Intl.DateTimeFormat(locale.locale, {
    dateStyle: "medium",
    timeStyle: "short",
    hourCycle,
    timeZone,
  });
  const days = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    timeZone,
  });
  const relatives = new Intl.RelativeTimeFormat(locale.locale, { numeric: "auto" });
  const lists = {
    and: new Intl.ListFormat(locale.locale, { type: "conjunction" }),
    or: new Intl.ListFormat(locale.locale, { type: "disjunction" }),
    units: new Intl.ListFormat(locale.locale, { type: "unit", style: "short" }),
  };

  /** The calendar day of `date` in the time zone, as a count of days since 1970. */
  const dayOf = (date: Date): number => {
    let year = 0;
    let month = 0;
    let day = 0;
    for (const { type, value } of days.formatToParts(date)) {
      if (type === "year") {
        year = Number(value);
      } else if (type === "month") {
        month = Number(value);
      } else if (type === "day") {
        day = Number(value);
      }
    }
    return Date.UTC(year, month - 1, day) / DAY;
  };

  return {
    locale,
    number: (value) => numbers.format(value),
    bytes(value) {
      let amount = value;
      let unit = -1;
      // The next unit once the amount, rounded as it is shown, reaches 1,000: 999,950 bytes are
      // "1 MB", not "1,000 kB".
      while (unit < larger.length - 1 && Math.round(Math.abs(amount) * 10) / 10 >= 1000) {
        amount /= 1000;
        unit += 1;
      }
      return (larger[unit] ?? bytes).format(amount);
    },
    date: (date) => dates.format(date),
    time: (date) => times.format(date),
    dateTime: (date) => dateTimes.format(date),
    relative(date, now) {
      const elapsed = date.getTime() - now.getTime();
      const distance = Math.abs(elapsed);
      if (distance < MINUTE) {
        return relatives.format(0, "second");
      }
      if (distance < HOUR) {
        return relatives.format(Math.trunc(elapsed / MINUTE), "minute");
      }
      if (distance < DAY) {
        return relatives.format(Math.trunc(elapsed / HOUR), "hour");
      }
      const calendarDays = dayOf(date) - dayOf(now);
      if (Math.abs(calendarDays) < 7) {
        return relatives.format(calendarDays, "day");
      }
      if (Math.abs(calendarDays) < 28) {
        return relatives.format(Math.trunc(calendarDays / 7), "week");
      }
      const months = Math.round(calendarDays / DAYS_PER_MONTH);
      if (Math.abs(months) < 12) {
        return relatives.format(months, "month");
      }
      return relatives.format(Math.round(calendarDays / 365.2425), "year");
    },
    list: (items, type = "and") => lists[type].format(items),
  };
}
