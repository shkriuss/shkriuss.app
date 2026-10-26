/**
 * Read events from an iCalendar (.ics) file (RFC 5545), as exported by Google
 * Calendar, Apple Calendar, Outlook and this app.
 *
 * Calendar can't show everything a .ics file can describe (for example
 * "every 2 weeks"). Events it can't show are listed with a reason instead of
 * being changed silently.
 *
 * Times with a time zone (or in UTC) are converted to the device's time zone;
 * from then on they are "floating" local times like every other event. A
 * repeating event keeps the time its first date has, so when the two time
 * zones change their clocks on different dates, some of its times are an hour
 * off; a note says so. Another note says when a monthly or yearly repeat moved
 * to another day near the end of a month, where its dates can come out wrong.
 */
import { fingerprint } from '@shkriuss/sync';
import {
  addDays,
  addMinutes,
  daysBetween,
  daysInMonth,
  fromDayNumber,
  isIsoDate,
  makeDate,
  minutesOf,
  parts,
  toDayNumber,
  toStamp,
  weekday,
  type IsoDate,
  type IsoTime,
} from './dates.ts';
import {
  draftProblems,
  isValidReminder,
  MAX_NOTES_LENGTH,
  MAX_SPAN_DAYS,
  MAX_TITLE_LENGTH,
  occurrencesBetween,
  type CalendarEvent,
  type EventDraft,
  type Repeat,
} from './events.ts';

export interface ParsedEvent {
  id: string;
  draft: EventDraft;
}

export interface SkippedEvent {
  title: string;
  reason: string;
}

export interface ParseResult {
  events: ParsedEvent[];
  skipped: SkippedEvent[];
  /** Other things worth knowing, in plain language. */
  notes: string[];
  /** Set when the file can't be used at all. */
  error?: string;
}

export interface ParseOptions {
  /** The device's time zone, e.g. "Europe/Tbilisi". */
  timeZone: string;
  /** Events exported by this app keep their id (so importing twice doesn't duplicate). */
  domain?: string;
}

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface RawEvent {
  props: Property[];
  alarms: Property[][];
}

const plural = (count: number, word: string, many = `${word}s`): string =>
  `${count} ${count === 1 ? word : many}`;
const pad = (value: number): string => String(value).padStart(2, '0');

// ---------- Reading the file ----------

/** Splits text at `separator`, but not inside double quotes. */
function splitOutsideQuotes(text: string, separator: string): string[] {
  const pieces: string[] = [];
  let current = '';
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === separator && !quoted) {
      pieces.push(current);
      current = '';
    } else current += char;
  }
  pieces.push(current);
  return pieces;
}

/** One "NAME;PARAM=VALUE:value" line. */
function parseLine(line: string): Property | null {
  let quoted = false;
  let colon = -1;
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '"') quoted = !quoted;
    else if (line[index] === ':' && !quoted) {
      colon = index;
      break;
    }
  }
  if (colon < 1) return null;
  const [name = '', ...rawParams] = splitOutsideQuotes(line.slice(0, colon), ';');
  const params: Record<string, string> = {};
  for (const param of rawParams) {
    const equals = param.indexOf('=');
    if (equals > 0) {
      params[param.slice(0, equals).toUpperCase()] = param.slice(equals + 1).replace(/^"|"$/g, '');
    }
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Joins folded lines (a line break followed by a space or tab continues the line). */
function unfold(text: string): string[] {
  return text
    .replace(/\r\n|\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

function readEvents(text: string): RawEvent[] {
  const events: RawEvent[] = [];
  let event: RawEvent | null = null;
  let alarm: Property[] | null = null;
  // Components inside an event other than alarms (rare) are ignored.
  let ignoredDepth = 0;
  for (const line of unfold(text)) {
    const property = parseLine(line);
    if (!property) continue;
    const component = property.value.trim().toUpperCase();
    if (property.name === 'BEGIN') {
      if (!event) {
        if (component === 'VEVENT') event = { props: [], alarms: [] };
      } else if (component === 'VALARM' && !alarm && ignoredDepth === 0) alarm = [];
      else ignoredDepth += 1;
    } else if (property.name === 'END') {
      if (!event) continue;
      if (ignoredDepth > 0) ignoredDepth -= 1;
      else if (component === 'VALARM' && alarm) {
        event.alarms.push(alarm);
        alarm = null;
      } else if (component === 'VEVENT') {
        events.push(event);
        event = null;
      }
    } else if (event && ignoredDepth === 0) {
      (alarm ?? event.props).push(property);
    }
  }
  return events;
}

/** Undoes text escaping (RFC 5545 §3.3.11). */
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) =>
    char === 'n' || char === 'N' ? '\n' : char,
  );
}

/** A duration like "-PT15M" or "P1DT2H" in minutes (negative = before), or null. */
export function parseDuration(value: string): number | null {
  const match =
    /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?=\d)(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
      value.trim(),
    );
  if (!match || /^[+-]?P$/.test(value.trim())) return null;
  const [, sign, weeks, days, hours, minutes, seconds] = match;
  const total =
    Number(weeks ?? 0) * 10080 +
    Number(days ?? 0) * 1440 +
    Number(hours ?? 0) * 60 +
    Number(minutes ?? 0) +
    Math.floor(Number(seconds ?? 0) / 60);
  return sign === '-' && total !== 0 ? -total : total;
}

// ---------- Dates, times and time zones ----------

interface When {
  date: IsoDate;
  /** null for a whole day. */
  time: IsoTime | null;
  /** The date and time as written in the file, before converting. */
  written: { date: IsoDate; time: IsoTime | null };
  /** The time zone it was written in ("UTC" for UTC); null for whole days, floating times and unknown zones. */
  zone: string | null;
  /** The moment it is (ms since 1970, UTC), when it has a zone. */
  moment: number | null;
  /** True when the time was written as 23:59:59 (Calendar's "until the end of the day"). */
  endOfDay: boolean;
  /** True when the time zone wasn't recognised and the time was kept as written. */
  unknownZone: boolean;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

interface Clock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The date and time a moment shows on clocks in `timeZone`. Throws for unknown zones. */
function wallClock(ms: number, timeZone: string): Clock {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, format);
  }
  const found = format.formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(found.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetOf(ms: number, timeZone: string): number {
  const c = wallClock(ms, timeZone);
  return Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second) - ms;
}

/** The name this browser knows a time zone by, or null. */
function knownZone(timeZone: string): string | null {
  // Zone names are short. A long one isn't a time zone, and would be slow to search.
  if (timeZone.length > 100) return null;
  // Old Thunderbird files write zones like "/mozilla.org/20050126_1/Europe/Berlin".
  const zones = [timeZone, /[A-Za-z_]+(?:\/[A-Za-z_-]+){1,2}$/.exec(timeZone)?.[0]];
  for (const zone of zones) {
    if (!zone) continue;
    try {
      wallClock(0, zone);
      return zone;
    } catch {
      // Not a time zone this browser knows.
    }
  }
  return null;
}

/** The moment when clocks in `timeZone` (a known zone) show `wall` (a UTC-based number). */
function zonedToUtc(wall: number, timeZone: string): number {
  const guess = wall - offsetOf(wall, timeZone);
  return wall - offsetOf(guess, timeZone);
}

function inZone(ms: number, timeZone: string): { date: IsoDate; time: IsoTime } {
  const c = wallClock(ms, timeZone);
  return { date: makeDate(c.year, c.month, c.day), time: `${pad(c.hour)}:${pad(c.minute)}` };
}

/** Reads a DATE or DATE-TIME value, converted to `timeZone`. */
function readWhen(property: Property, timeZone: string): When | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/.exec(
    property.value.trim(),
  );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, utc] = match;
  const date = `${year}-${month}-${day}`;
  if (!isIsoDate(date)) return null;
  const plain: When = {
    date,
    time: null,
    written: { date, time: null },
    zone: null,
    moment: null,
    endOfDay: false,
    unknownZone: false,
  };
  if (hour === undefined || property.params['VALUE'] === 'DATE') return plain;

  const time = `${hour}:${minute}`;
  const asWritten: When = {
    ...plain,
    time,
    written: { date, time },
    endOfDay: hour === '23' && minute === '59' && second === '59',
  };
  const named = utc ? 'UTC' : property.params['TZID'];
  if (!named) return asWritten;
  const zone = knownZone(named);
  if (!zone) return { ...asWritten, unknownZone: true };
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const moment = zonedToUtc(wall, zone);
  return { ...asWritten, ...inZone(moment, timeZone), zone, moment };
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * Time zones and years compared per file, at most (each costs a year of clock
 * readings). Calendars use a few zones over some years; a crafted file of
 * thousands froze the page for minutes (audit F1-9). Past this, a repeat
 * counts as one whose times may be an hour off, and the note says so.
 */
const MAX_CLOCK_CHECKS = 100;

/**
 * The moments (to the minute) when clocks in `zone` change in `year`, from
 * noon (UTC) on 31 December the year before to noon on 31 December: read at
 * noon each day, then to the minute between two readings that differ. Null
 * once the file has had its MAX_CLOCK_CHECKS; `seen` keeps them for the next
 * event.
 */
function clockChanges(zone: string, year: number, seen: Map<string, number[]>): number[] | null {
  const key = `${zone} ${year}`;
  const known = seen.get(key);
  if (known) return known;
  if (seen.size >= MAX_CLOCK_CHECKS) return null;
  const changes: number[] = [];
  let noon = Date.UTC(year - 1, 11, 31, 12);
  let before = offsetOf(noon, zone);
  for (noon += DAY_MS; noon <= Date.UTC(year, 11, 31, 12); noon += DAY_MS) {
    const now = offsetOf(noon, zone);
    if (now !== before) {
      // The clocks still read as before at `early`, and not at `late`.
      let early = noon - DAY_MS;
      let late = noon;
      while (late - early > MINUTE_MS) {
        const middle = early + Math.floor((late - early) / MINUTE_MS / 2) * MINUTE_MS;
        if (offsetOf(middle, zone) === before) early = middle;
        else late = middle;
      }
      changes.push(late);
    }
    before = now;
  }
  seen.set(key, changes);
  return changes;
}

/** How far ahead (days) a repeat's next time is, at most. */
const NEXT_WITHIN: Record<Repeat, number> = {
  none: 0,
  daily: 1,
  weekly: 7,
  monthly: 62,
  yearly: 366 * 8,
};

/**
 * True when some times of a repeat from another time zone, in the year from
 * its first, are an hour off here, or may be (past MAX_CLOCK_CHECKS). Every
 * time keeps the first one's time of day on this device, so a time is off
 * when the two zones' clocks are a different time apart then than at the
 * first. That changes only when either clock changes, so after each change,
 * the next time is compared. Comparing at noon each day missed changes on
 * the first day and two changes on one day (audit 3 F1-2).
 */
function someTimesOff(
  draft: EventDraft,
  start: When,
  timeZone: string,
  seen: Map<string, number[]>,
): boolean {
  const { zone, moment: first, written } = start;
  if (zone === null || zone === timeZone || first === null || written.time === null) return false;
  const apart = (ms: number) => offsetOf(ms, zone) - offsetOf(ms, timeZone);
  // Clocks change on a yearly pattern, so a year is compared. (The dates move
  // a little: a yearly event a few days before a change can still be off in
  // some later years.)
  const end = Math.min(first + 366 * DAY_MS, Date.UTC(9999, 11, 31, 12));
  // A year's changes start at noon (UTC) on 31 December the year before.
  const yearOf = (ms: number) => new Date(ms + DAY_MS / 2 - 1).getUTCFullYear();
  const changes: number[] = [];
  for (const clocks of [zone, timeZone]) {
    for (let year = yearOf(first); year <= yearOf(end); year += 1) {
      const found = clockChanges(clocks, year, seen);
      if (!found) return true;
      changes.push(...found.filter((at) => at > first && at <= end));
    }
  }
  if (changes.length === 0) return false;
  // Its times as written in its own zone: there, its dates may be a day off ours.
  const shift = daysBetween(written.date, draft.startDate);
  const own: CalendarEvent = {
    ...draft,
    id: 'clocks',
    startDate: written.date,
    endDate: written.date,
    repeatUntil: draft.repeatUntil === null ? null : addDays(draft.repeatUntil, -shift),
  };
  const time = minutesOf(written.time) * MINUTE_MS;
  const apartAtFirst = apart(first);
  for (const at of changes) {
    const from = inZone(at, zone).date;
    const dates = occurrencesBetween(
      { events: [own] },
      from,
      addDays(from, NEXT_WITHIN[own.repeat]),
    );
    for (const { start: date } of dates) {
      const next = zonedToUtc(toDayNumber(date) * DAY_MS + time, zone);
      if (next < at) continue;
      if (apart(next) !== apartAtFirst) return true;
      break;
    }
  }
  return false;
}

// ---------- Repeats ----------

const FREQUENCIES: Record<string, Repeat> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
};
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const RULE_PARTS = new Set([
  'FREQ',
  'INTERVAL',
  'BYDAY',
  'BYMONTHDAY',
  'BYMONTH',
  'UNTIL',
  'COUNT',
  'WKST',
]);
/** Longer COUNTs are treated as "forever". */
const MAX_COUNT = 5000;
/**
 * Months and years looked at, at most, for the whole file, to find when
 * repeats with a COUNT end (lastStart). Only monthly repeats on the 29th to
 * 31st and yearly ones on 29 February need any: a monthly one on the 31st
 * for 10 years takes about 200, so 2,000 of those fit. Working out every
 * time instead, a crafted file far under 5 MB froze the page for minutes
 * (audit 3 C-2). Past this (only in odd files), an event is listed as not
 * imported.
 */
const MAX_COUNT_STEPS = 500_000;

interface Rule {
  repeat: Repeat;
  until: When | null;
  count: number | null;
}

/**
 * Reads an RRULE, or returns null if Calendar can't show it. Rules use the
 * start's own time zone: `written` is the start date as written in the file,
 * and UNTIL is converted to `timeZone`, the zone the start is written in.
 */
function readRule(value: string, written: IsoDate, timeZone: string): Rule | null {
  const rule: Record<string, string> = {};
  for (const part of value.split(';')) {
    const [key = '', val = ''] = part.split('=');
    rule[key.trim().toUpperCase()] = val.trim().toUpperCase();
  }
  const repeat = FREQUENCIES[rule['FREQ'] ?? ''];
  if (!repeat || Object.keys(rule).some((key) => !RULE_PARTS.has(key))) return null;
  if (rule['INTERVAL'] !== undefined && rule['INTERVAL'] !== '1') return null;
  // Allowed only when they repeat what the start date already says.
  const start = parts(written);
  if (rule['BYDAY'] && !(repeat === 'weekly' && rule['BYDAY'] === WEEKDAYS[weekday(written) - 1]))
    return null;
  if (
    rule['BYMONTHDAY'] &&
    !(repeat !== 'daily' && repeat !== 'weekly' && Number(rule['BYMONTHDAY']) === start.day)
  )
    return null;
  if (rule['BYMONTH'] && !(repeat === 'yearly' && Number(rule['BYMONTH']) === start.month))
    return null;

  const until = rule['UNTIL']
    ? readWhen({ name: 'UNTIL', params: {}, value: rule['UNTIL'] }, timeZone)
    : null;
  if (rule['UNTIL'] && !until) return null;
  const count = rule['COUNT'] ? Number(rule['COUNT']) : null;
  if (count !== null && !(Number.isInteger(count) && count >= 1)) return null;
  return { repeat, until, count };
}

/** How many months and years lastStart has looked at, for a whole file. */
export interface CountSteps {
  taken: number;
}

/**
 * The start of the `count`-th time a repeating event happens (the first is
 * its start), or null if that's very far away (after 9999, or a COUNT over
 * MAX_COUNT: "forever"). Worked out without going through every time (audit
 * 3 C-2): daily and weekly by counting days; monthly and yearly by stepping
 * through the months or years with the same rule as occurrencesBetween (a
 * day missing from a month, like the 31st or 29 February, is skipped there).
 * Undefined once the file's MAX_COUNT_STEPS are used up.
 */
export function lastStart(
  draft: EventDraft,
  count: number,
  steps: CountSteps = { taken: 0 },
): IsoDate | null | undefined {
  // With an UNTIL too (which files shouldn't have), the earlier of the two.
  const until = draft.repeatUntil;
  if (count > MAX_COUNT) return until;
  const { year, month, day } = parts(draft.startDate);
  const later = count - 1;
  let found: IsoDate | null = null;
  if (draft.repeat === 'daily' || draft.repeat === 'weekly') {
    const last = toDayNumber(draft.startDate) + later * (draft.repeat === 'daily' ? 1 : 7);
    if (last <= toDayNumber('9999-12-31')) found = fromDayNumber(last);
  } else {
    // Months since the year 0 (monthly), or years (yearly).
    const monthly = draft.repeat === 'monthly';
    const yearOf = (step: number) => (monthly ? Math.floor(step / 12) : step);
    const monthOf = (step: number) => (monthly ? (step % 12) + 1 : month);
    let step = monthly ? year * 12 + month - 1 : year;
    // Every month has the 1st to the 28th, and every year has every day but 29 February.
    const always = day <= 28 || (!monthly && !(month === 2 && day === 29));
    if (always) step += later;
    let left = always ? 0 : later;
    while (left > 0 && yearOf(step) <= 9999) {
      step += 1;
      steps.taken += 1;
      if (steps.taken > MAX_COUNT_STEPS) return undefined;
      if (day <= daysInMonth(yearOf(step), monthOf(step))) left -= 1;
    }
    if (yearOf(step) <= 9999) found = makeDate(yearOf(step), monthOf(step), day);
  }
  return until !== null && (found === null || found > until) ? until : found;
}

/**
 * True when moving a monthly or yearly event from `written` to another day,
 * `moved`, changes the months or years it's in. Monthly on the 31st (7 months
 * a year) moved to the 1st would show every month; yearly on 28 February
 * moved to 1 March would miss 29 February in leap years.
 */
function repeatMoves(repeat: Repeat, written: IsoDate, moved: IsoDate): boolean {
  if (written === moved) return false;
  const a = parts(written);
  const b = parts(moved);
  if (repeat === 'monthly') return a.month !== b.month || a.day > 28 || b.day > 28;
  if (repeat === 'yearly') {
    // 29 February is the only day that isn't in every year.
    const leapDay = (date: { month: number; day: number }) => date.month === 2 && date.day === 29;
    const acrossFebruary = (a.month === 2 && b.month === 3) || (a.month === 3 && b.month === 2);
    return leapDay(a) || leapDay(b) || acrossFebruary;
  }
  return false;
}

// ---------- Events ----------

const UNSUPPORTED_REPEAT =
  'It repeats in a way Calendar can’t show yet (for example every 2 weeks).';
const TOO_MANY_COUNTS =
  'The file has too many repeats for Calendar to work out when this one stops.';

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

interface Flags {
  unknownZone: number;
  changedDates: number;
  skippedDates: number;
  droppedReminders: number;
  clockChanges: number;
  movedRepeats: number;
}

function toEvent(
  raw: RawEvent,
  options: ParseOptions,
  flags: Flags,
  clockChangesSeen: Map<string, number[]>,
  countSteps: CountSteps,
): ParsedEvent | SkippedEvent | null {
  const get = (name: string) => raw.props.find((property) => property.name === name);
  const text = (name: string) => unescapeText(get(name)?.value ?? '').trim();
  const title = truncate(text('SUMMARY') || 'Untitled event', MAX_TITLE_LENGTH);
  const skip = (reason: string): SkippedEvent => ({ title, reason });

  // A change to one date of a repeating event: Calendar can't store those yet.
  if (get('RECURRENCE-ID')) {
    flags.changedDates += 1;
    return null;
  }
  if (get('STATUS')?.value.trim().toUpperCase() === 'CANCELLED') return skip('It was cancelled.');

  const startProperty = get('DTSTART');
  const start = startProperty && readWhen(startProperty, options.timeZone);
  if (!startProperty || !start) return skip('Calendar can’t read its start date.');
  const allDay = start.time === null;

  // When it ends.
  let endDate = start.date;
  let endTime: IsoTime | null = null;
  const endProperty = get('DTEND');
  const end = endProperty ? readWhen(endProperty, options.timeZone) : null;
  const durationProperty = get('DURATION');
  const parsed = durationProperty ? parseDuration(durationProperty.value) : null;
  // One that ends before it starts is ignored, like an end before the start.
  const duration = parsed !== null && parsed > 0 ? parsed : null;
  // Longer than any event can last: turned down before the date maths, which
  // fails for a big enough number and stopped the whole import (audit F1-8).
  if (duration !== null && duration > (MAX_SPAN_DAYS + 1) * 1440) {
    return skip(`An event can last up to ${MAX_SPAN_DAYS} days.`);
  }
  if (start.time === null) {
    // All-day ends are "the day after", or a number of days.
    if (end) endDate = addDays(end.date, -1);
    else if (duration !== null) endDate = addDays(start.date, Math.ceil(duration / 1440) - 1);
    if (endDate < start.date) endDate = start.date;
  } else {
    const startAt = toStamp(start.date, start.time);
    const endAt = end
      ? toStamp(end.date, end.time ?? '00:00')
      : duration !== null
        ? addMinutes(startAt, duration)
        : null;
    if (endAt && endAt > startAt) {
      endDate = endAt.slice(0, 10);
      endTime = end?.endOfDay ? null : endAt.slice(11);
    }
  }
  if (start.unknownZone || end?.unknownZone) flags.unknownZone += 1;

  // How it repeats.
  let repeat: Repeat = 'none';
  let repeatUntil: IsoDate | null = null;
  let count: number | null = null;
  const rules = raw.props.filter((property) => property.name === 'RRULE');
  if (rules.length > 1 || get('RDATE')) return skip(UNSUPPORTED_REPEAT);
  if (rules[0]) {
    // Rules use the time zone the start is written in. A whole day's last day
    // is the date written, even as a UTC time (as Outlook writes it): moved to
    // the phone's time zone, it would be a day off on one side of the world
    // or the other (audit F1-10).
    const { written } = start;
    const zone = allDay ? 'UTC' : (start.zone ?? options.timeZone);
    const rule = readRule(rules[0].value, written.date, zone);
    if (!rule) return skip(UNSUPPORTED_REPEAT);
    repeat = rule.repeat;
    count = rule.count;
    if (rule.until) {
      // The last start as written: UNTIL can be before the start time on its day.
      let last = rule.until.date;
      if (rule.until.time !== null && written.time !== null && written.time > rule.until.time)
        last = addDays(last, -1);
      // Then moved to another day if the first start was.
      repeatUntil = addDays(last, daysBetween(written.date, start.date));
      if (repeatUntil < start.date) repeat = 'none';
    }
    if (count === 1) repeat = 'none';
    if (repeat !== 'none' && get('EXDATE')) flags.skippedDates += 1;
  }
  if (repeat === 'none') repeatUntil = null;

  // The first reminder that fits.
  let reminder: number | null = null;
  for (const alarm of raw.alarms) {
    const trigger = alarm.find((property) => property.name === 'TRIGGER');
    if (!trigger || trigger.params['VALUE'] === 'DATE-TIME' || trigger.params['RELATED'] === 'END')
      continue;
    const minutes = parseDuration(trigger.value);
    if (minutes !== null && isValidReminder(-minutes || 0, allDay)) {
      reminder = -minutes || 0;
      break;
    }
  }
  if (raw.alarms.length > 0 && reminder === null) flags.droppedReminders += 1;

  const location = text('LOCATION');
  const notes = truncate(
    [text('DESCRIPTION'), location && `Location: ${location}`].filter(Boolean).join('\n\n'),
    MAX_NOTES_LENGTH,
  );

  const draft: EventDraft = {
    title,
    startDate: start.date,
    endDate,
    startTime: start.time,
    endTime,
    repeat,
    repeatUntil,
    reminder,
    notes,
  };
  if (count !== null && repeat !== 'none') {
    const last = lastStart(draft, count, countSteps);
    if (last === undefined) return skip(TOO_MANY_COUNTS);
    draft.repeatUntil = last;
  }

  const problems = draftProblems(draft);
  const problem = Object.values(problems)[0];
  if (problem) return skip(problem);

  // Every later time keeps the first one's time, and day of the month, on this device.
  if (draft.repeat !== 'none' && start.zone) {
    if (someTimesOff(draft, start, options.timeZone, clockChangesSeen)) flags.clockChanges += 1;
    if (repeatMoves(draft.repeat, start.written.date, draft.startDate)) flags.movedRepeats += 1;
  }

  // A UID is text, escaped like any other: Calendar's own ids can hold ","
  // or ";" from other calendars' UIDs (audit F1-11).
  const uid = unescapeText(get('UID')?.value ?? '').trim();
  const ownSuffix = `@${options.domain ?? 'calendar.shkriuss.app'}`;
  const id = uid.endsWith(ownSuffix) ? uid.slice(0, -ownSuffix.length) : uid;
  return { id: id ? id.slice(0, 200) : contentId(raw), draft };
}

/** What makes an event without a UID that event, for contentId: never when the file was written. */
const CONTENT = ['DTSTART', 'DTEND', 'DURATION', 'RRULE', 'SUMMARY', 'DESCRIPTION', 'LOCATION'];

/**
 * An id for an event without a UID, made from what the event is, so it's
 * the same each time the file is imported, and isn't added twice (audit
 * F1-11).
 */
function contentId(raw: RawEvent): string {
  const content = CONTENT.map((name) =>
    raw.props
      .filter((property) => property.name === name)
      .map(({ params, value }) => [params, value]),
  );
  return `ics-${fingerprint(content)}`;
}

/** Reads every event in a .ics file. */
export function parseIcs(file: string, options: ParseOptions): ParseResult {
  // Some apps start files with an invisible "byte order mark".
  const text = file.replace(/^\uFEFF/, '');
  if (!/^BEGIN:VCALENDAR/im.test(text)) {
    return {
      events: [],
      skipped: [],
      notes: [],
      error: 'This doesn’t look like a calendar (.ics) file.',
    };
  }
  const flags: Flags = {
    unknownZone: 0,
    changedDates: 0,
    skippedDates: 0,
    droppedReminders: 0,
    clockChanges: 0,
    movedRepeats: 0,
  };
  const clockChangesSeen = new Map<string, number[]>();
  const countSteps: CountSteps = { taken: 0 };
  const events: ParsedEvent[] = [];
  const skipped: SkippedEvent[] = [];
  for (const raw of readEvents(text)) {
    const result = toEvent(raw, options, flags, clockChangesSeen, countSteps);
    if (!result) continue;
    if ('draft' in result) events.push(result);
    else skipped.push(result);
  }

  const notes: string[] = [];
  if (flags.unknownZone) {
    notes.push(
      `${plural(flags.unknownZone, 'event')} used a time zone Calendar doesn’t know, so ${flags.unknownZone === 1 ? 'its times were' : 'their times were'} kept as written.`,
    );
  }
  if (flags.clockChanges) {
    notes.push(
      `${plural(flags.clockChanges, 'repeating event')} ${flags.clockChanges === 1 ? 'is' : 'are'} from a time zone that doesn’t change its clocks on the same dates as yours, so some of ${flags.clockChanges === 1 ? 'its' : 'their'} times may be an hour off.`,
    );
  }
  if (flags.movedRepeats) {
    notes.push(
      `${plural(flags.movedRepeats, 'repeating event')} moved to another day in your time zone, so some of ${flags.movedRepeats === 1 ? 'its' : 'their'} dates near the end of a month may be wrong.`,
    );
  }
  if (flags.changedDates) {
    notes.push(
      `${plural(flags.changedDates, 'change')} to single dates of repeating events can’t be imported yet.`,
    );
  }
  if (flags.skippedDates) {
    notes.push(
      `${plural(flags.skippedDates, 'repeating event')} skipped some dates in the other calendar; here ${flags.skippedDates === 1 ? 'it shows' : 'they show'} on those dates too.`,
    );
  }
  if (flags.droppedReminders) {
    notes.push(
      `${plural(flags.droppedReminders, 'reminder')} couldn’t be imported (Calendar reminds from 4 weeks before up to the start).`,
    );
  }
  if (events.length === 0 && skipped.length === 0 && !flags.changedDates) {
    return { events, skipped, notes, error: 'There are no events in this file.' };
  }
  return { events, skipped, notes };
}
