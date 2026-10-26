/**
 * When scheduled notifications are due.
 *
 * Apps describe each notification by its local wall-clock time, like a paper
 * calendar: "starts 2026-10-17 14:30, repeats every week, remind 15 minutes
 * before", plus the phone's time zone. This file turns that into real
 * moments, through daylight-saving changes, so a weekly 14:15 reminder stays
 * at 14:15 local time all year. The same rules as Calendar: monthly events on
 * the 31st skip shorter months, and 29 February repeats only in leap years.
 */

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export const REPEATS: readonly Repeat[] = ['none', 'daily', 'weekly', 'monthly', 'yearly'];

export interface Timing {
  /** When the thing starts, local time: "YYYY-MM-DDTHH:MM". */
  start: string;
  repeat: Repeat;
  /** The last day it may start on, "YYYY-MM-DD" (null = forever). */
  until: string | null;
  /** Minutes before the start to notify (negative = after). */
  offset: number;
}

const MINUTE = 60_000;
const DAY = 86_400_000;
const STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Safety limit when looking for the next time (a monthly 31st or yearly 29 Feb skip some). */
const MAX_STEPS = 2000;

const isLeapYear = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
export const daysInMonth = (year: number, month: number): number =>
  [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;

/** Reads "YYYY-MM-DDTHH:MM" into parts, or null if it isn't a real date and time. */
export function parseStamp(
  stamp: string,
): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const match = STAMP.exec(stamp);
  if (!match) return null;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  const valid =
    year >= 1000 &&
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth(year, month) &&
    hour <= 23 &&
    minute <= 59;
  return valid ? { year, month, day, hour, minute } : null;
}

export function isDate(value: string): boolean {
  const match = DATE.exec(value);
  return match !== null && parseStamp(`${value}T00:00`) !== null;
}

/**
 * One clock reader per time zone, kept under the zone's own name only, so
 * other spellings of it ("aSiA/tBiLiSi") don't each add one.
 */
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Reads clocks in `timeZone`. Throws for a time zone nobody knows. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatters.get(timeZone);
  if (cached) return cached;
  const format = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const name = format.resolvedOptions().timeZone;
  if (!formatters.has(name)) formatters.set(name, format);
  return format;
}

/** The time zones with a clock reader kept (for tests). */
export const cachedTimeZones = (): string[] => [...formatters.keys()];

/** The wall-clock time (as UTC-based ms) that clocks in `timeZone` show at `moment`. */
function wallClock(moment: number, timeZone: string): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(moment));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour'),
    read('minute'),
    read('second'),
  );
}

/**
 * The time zone's own name, e.g. "Asia/Tbilisi" for "asia/tbilisi", or null
 * if this browser or server doesn't know it. Only named zones: browsers never
 * give a bare offset like "+03:00".
 */
export function canonicalTimeZone(timeZone: string): string | null {
  if (!/^[A-Za-z]/.test(timeZone)) return null;
  try {
    return formatterFor(timeZone).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * The moment when clocks in `timeZone` show `wall`. When they show it twice
 * (the hour that repeats when clocks go back), the first time, as an open
 * app does (audit 3 F1-3). In a daylight-saving gap, an hour later.
 */
export function zonedMoment(wall: number, timeZone: string): number {
  // The offsets in force a day before and a day after: the same, except
  // around a clock change.
  const before = wallClock(wall - DAY, timeZone) - (wall - DAY);
  const after = wallClock(wall + DAY, timeZone) - (wall + DAY);
  const shown = [wall - before, wall - after].filter(
    (moment) => wallClock(moment, timeZone) === wall,
  );
  if (shown.length > 0) return Math.min(...shown);
  // Not shown at all that night (the time clocks skip): with the offset from
  // before the change, it's as much later as they skip (an hour, mostly).
  return wall - before;
}

/** Start times (wall ms) of each occurrence that starts on or after `fromDay` (days since 1970). */
function* occurrences(timing: Timing, fromDay: number): Generator<number> {
  const start = parseStamp(timing.start);
  if (!start) return;
  const { year, month, day, hour, minute } = start;
  const timeOfDay = (hour * 60 + minute) * MINUTE;
  const startDay = Date.UTC(year, month - 1, day) / DAY;
  const lastDay = timing.until === null ? Infinity : Date.parse(`${timing.until}T00:00:00Z`) / DAY;
  const at = (dayNumber: number) => dayNumber * DAY + timeOfDay;

  if (timing.repeat === 'none') {
    if (startDay >= fromDay) yield at(startDay);
    return;
  }
  if (timing.repeat === 'daily' || timing.repeat === 'weekly') {
    const step = timing.repeat === 'daily' ? 1 : 7;
    const first = Math.max(0, Math.ceil((fromDay - startDay) / step));
    for (let index = first; ; index += 1) {
      const dayNumber = startDay + index * step;
      if (dayNumber > lastDay) return;
      yield at(dayNumber);
    }
  }
  const from = new Date(fromDay * DAY);
  if (timing.repeat === 'monthly') {
    let index = Math.max(
      year * 12 + month - 1,
      from.getUTCFullYear() * 12 + from.getUTCMonth() - 1,
    );
    for (;;) {
      const y = Math.floor(index / 12);
      const m = (index % 12) + 1;
      index += 1;
      if (Date.UTC(y, m - 1, 1) / DAY > lastDay) return;
      if (day > daysInMonth(y, m)) continue;
      const dayNumber = Date.UTC(y, m - 1, day) / DAY;
      if (dayNumber > lastDay) return;
      if (dayNumber >= fromDay) yield at(dayNumber);
    }
  }
  // yearly
  for (let y = Math.max(year, from.getUTCFullYear() - 1); ; y += 1) {
    if (Date.UTC(y, 0, 1) / DAY > lastDay) return;
    if (day > daysInMonth(y, month)) continue;
    const dayNumber = Date.UTC(y, month - 1, day) / DAY;
    if (dayNumber > lastDay) return;
    if (dayNumber >= fromDay) yield at(dayNumber);
  }
}

/**
 * The first moment (ms) after `after` when this notification is due, or null
 * if it never is again.
 */
export function nextFireTime(timing: Timing, timeZone: string, after: number): number | null {
  // Start looking a day early: time zones and offsets shift things by hours.
  const offset = timing.offset * MINUTE;
  const fromDay = Math.floor((wallClock(after, timeZone) + offset) / DAY) - 1;
  let steps = 0;
  for (const start of occurrences(timing, fromDay)) {
    const moment = zonedMoment(start - offset, timeZone);
    if (moment > after) return moment;
    steps += 1;
    if (steps > MAX_STEPS) return null;
  }
  return null;
}
