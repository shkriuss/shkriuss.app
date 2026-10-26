/**
 * Calendar dates without time zones (shared by Calendar and Habits).
 *
 * Dates are plain strings like "2026-10-17" and times like "14:30" ("floating"
 * local times, as on a paper calendar). The maths uses UTC internally so that
 * daylight-saving changes can never shift a day.
 */

/** "YYYY-MM-DD" */
export type IsoDate = string;
/** "HH:MM" (24-hour) */
export type IsoTime = string;
/** A date and time, "YYYY-MM-DDTHH:MM". Stamps sort and compare as plain text. */
export type Stamp = string;

// Years 1000–9999 only: date maths in JavaScript treats years below 100 specially.
const DATE_PATTERN = /^([1-9]\d{3})-(\d{2})-(\d{2})$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

export function isIsoTime(value: unknown): value is IsoTime {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** Days since 1970-01-01 (works for comparisons and arithmetic). */
export function toDayNumber(date: IsoDate): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export function fromDayNumber(day: number): IsoDate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/** Whole days from `a` to `b` (negative if b is earlier). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return toDayNumber(b) - toDayNumber(a);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** month is 1–12 */
export function daysInMonth(year: number, month: number): number {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;
}

export function parts(date: IsoDate): { year: number; month: number; day: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return { year, month, day };
}

export function makeDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export function weekday(date: IsoDate): number {
  const day = new Date(toDayNumber(date) * DAY_MS).getUTCDay();
  return day === 0 ? 7 : day;
}

/** "YYYY-MM" of the month containing `date`. */
export function monthOf(date: IsoDate): string {
  return date.slice(0, 7);
}

/** "YYYY" of the year containing `date`. */
export function yearOf(date: IsoDate): string {
  return date.slice(0, 4);
}

/** First day of the month `offset` months away from the month of `date`. */
export function shiftMonth(date: IsoDate, offset: number): IsoDate {
  const { year, month } = parts(date);
  const index = year * 12 + (month - 1) + offset;
  return makeDate(Math.floor(index / 12), (index % 12) + 1, 1);
}

/** The same day in another month, clamped to that month's length (31 Jan → 28/29 Feb). */
export function sameDayInMonth(
  date: IsoDate,
  offset: number,
  day: number = parts(date).day,
): IsoDate {
  const first = shiftMonth(date, offset);
  const { year, month } = parts(first);
  return makeDate(year, month, Math.min(day, daysInMonth(year, month)));
}

/**
 * The weeks of a month as rows of 7 cells. Cells outside the month are null.
 * `firstDayOfWeek` is 1 (Monday) … 7 (Sunday).
 */
export function monthGrid(monthStart: IsoDate, firstDayOfWeek: number): (IsoDate | null)[][] {
  const { year, month } = parts(monthStart);
  const total = daysInMonth(year, month);
  const lead = (weekday(makeDate(year, month, 1)) - firstDayOfWeek + 7) % 7;
  const cells: (IsoDate | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: total }, (_, index) => makeDate(year, month, index + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (IsoDate | null)[][] = [];
  for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
  return weeks;
}

/** Today's date on this device, as "YYYY-MM-DD". */
export function today(now: Date = new Date()): IsoDate {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Minutes since midnight, for comparing times. */
export function minutesOf(time: IsoTime): number {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

const pad = (value: number): string => String(value).padStart(2, '0');

export const toStamp = (date: IsoDate, time: IsoTime = '00:00'): Stamp => `${date}T${time}`;

/** Minutes since 1970-01-01 00:00, for stamp arithmetic. */
export function stampMinutes(stamp: Stamp): number {
  return toDayNumber(stamp.slice(0, 10)) * 1440 + minutesOf(stamp.slice(11, 16));
}

export function fromStampMinutes(total: number): Stamp {
  const day = Math.floor(total / 1440);
  const minutes = total - day * 1440;
  return toStamp(fromDayNumber(day), `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`);
}

export const addMinutes = (stamp: Stamp, minutes: number): Stamp =>
  fromStampMinutes(stampMinutes(stamp) + minutes);

/** The device's current date and time, to the minute. */
export function nowStamp(now: Date = new Date()): Stamp {
  return toStamp(today(now), `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

/** A time moved by some minutes, or null if that leaves the day. */
export function shiftTime(time: IsoTime, minutes: number): IsoTime | null {
  const total = minutesOf(time) + minutes;
  if (total < 0 || total >= 24 * 60) return null;
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/**
 * The day weeks start on where `language` is used (e.g. "en-GB"):
 * 1 = Monday … 7 = Sunday. Monday when the browser can't tell.
 */
export function firstDayOfWeek(language: string): number {
  try {
    const locale = new Intl.Locale(language) as unknown as {
      getWeekInfo?: () => { firstDay?: number };
      weekInfo?: { firstDay?: number };
    };
    const day = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return day && day >= 1 && day <= 7 ? day : 1;
  } catch {
    return 1;
  }
}
