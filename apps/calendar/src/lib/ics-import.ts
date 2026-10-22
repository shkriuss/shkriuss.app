/**
 * Read events from an iCalendar (.ics) file (RFC 5545), as exported by Google
 * Calendar, Apple Calendar, Outlook and this app.
 *
 * Calendar can't show everything a .ics file can describe (for example
 * "every 2 weeks"). Events it can't show are listed with a reason instead of
 * being changed silently.
 *
 * Times with a time zone (or in UTC) are converted to the device's time zone;
 * from then on they are "floating" local times like every other event.
 */
import {
  addDays,
  addMinutes,
  fromDayNumber,
  isIsoDate,
  makeDate,
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
  MAX_TITLE_LENGTH,
  occurrencesBetween,
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
  /** Makes an id for events without one. */
  makeId: () => string;
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

/** The moment when clocks in `timeZone` show `wall` (a UTC-based number), or null. */
function zonedToUtc(wall: number, timeZone: string): number | null {
  // Zone names are short. A long one isn't a time zone, and would be slow to search.
  if (timeZone.length > 100) return null;
  // Old Thunderbird files write zones like "/mozilla.org/20050126_1/Europe/Berlin".
  const zones = [timeZone, /[A-Za-z_]+(?:\/[A-Za-z_-]+){1,2}$/.exec(timeZone)?.[0]];
  for (const zone of zones) {
    if (!zone) continue;
    try {
      const guess = wall - offsetOf(wall, zone);
      return wall - offsetOf(guess, zone);
    } catch {
      // Not a time zone this browser knows.
    }
  }
  return null;
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
  const plain = { date, time: null, endOfDay: false, unknownZone: false };
  if (hour === undefined || property.params['VALUE'] === 'DATE') return plain;

  const endOfDay = hour === '23' && minute === '59' && second === '59';
  const wall = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  const zone = utc ? 'UTC' : property.params['TZID'];
  if (!zone) return { ...plain, time: `${hour}:${minute}`, endOfDay };
  const moment = zonedToUtc(wall, zone);
  if (moment === null) return { ...plain, time: `${hour}:${minute}`, endOfDay, unknownZone: true };
  return { ...plain, ...inZone(moment, timeZone), endOfDay };
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

interface Rule {
  repeat: Repeat;
  until: When | null;
  count: number | null;
}

/**
 * Reads an RRULE, or returns null if Calendar can't show it. `written` is the
 * start date as written in the file (rules use the file's own time zone).
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

/** The start of the `count`-th time an event happens, or null if that's very far away. */
function lastStart(draft: EventDraft, count: number): IsoDate | null {
  if (count > MAX_COUNT) return null;
  const daysPer: Record<Repeat, number> = {
    none: 0,
    daily: 1,
    weekly: 7,
    monthly: 62,
    yearly: 366 * 8,
  };
  const end = Math.min(
    toDayNumber(draft.startDate) + daysPer[draft.repeat] * count,
    toDayNumber('9999-12-31'),
  );
  const starts = occurrencesBetween(
    { events: [{ id: 'count', ...draft }] },
    draft.startDate,
    fromDayNumber(end),
  ).filter((occurrence) => occurrence.start >= draft.startDate);
  return starts[count - 1]?.start ?? null;
}

// ---------- Events ----------

const UNSUPPORTED_REPEAT =
  'It repeats in a way Calendar can’t show yet (for example every 2 weeks).';

const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

interface Flags {
  unknownZone: number;
  changedDates: number;
  skippedDates: number;
  droppedReminders: number;
}

function toEvent(
  raw: RawEvent,
  options: ParseOptions,
  flags: Flags,
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
  const duration = durationProperty ? parseDuration(durationProperty.value) : null;
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
    const written = startProperty.value
      .trim()
      .slice(0, 8)
      .replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
    const rule = readRule(rules[0].value, written, options.timeZone);
    if (!rule) return skip(UNSUPPORTED_REPEAT);
    repeat = rule.repeat;
    count = rule.count;
    if (rule.until) {
      repeatUntil = rule.until.date;
      // An UNTIL in another time zone can land on the next day, after the last start.
      if (rule.until.time !== null && start.time !== null && start.time > rule.until.time)
        repeatUntil = addDays(repeatUntil, -1);
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
  if (count !== null && repeat !== 'none') draft.repeatUntil = lastStart(draft, count);

  const problems = draftProblems(draft);
  const problem = Object.values(problems)[0];
  if (problem) return skip(problem);

  const uid = get('UID')?.value.trim() ?? '';
  const ownSuffix = `@${options.domain ?? 'calendar.shkriuss.app'}`;
  const id = uid.endsWith(ownSuffix) ? uid.slice(0, -ownSuffix.length) : uid;
  return { id: id ? id.slice(0, 200) : options.makeId(), draft };
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
  const flags: Flags = { unknownZone: 0, changedDates: 0, skippedDates: 0, droppedReminders: 0 };
  const events: ParsedEvent[] = [];
  const skipped: SkippedEvent[] = [];
  for (const raw of readEvents(text)) {
    const result = toEvent(raw, options, flags);
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
