/**
 * Calendar events and their rules, as plain functions (easy to test).
 * Every function returns new data instead of changing the old.
 */
import { secondVersionName } from '@shkriuss/sync';
import { withEdits } from '@shkriuss/sync/edits';
import {
  addDays,
  compareDates,
  daysBetween,
  daysInMonth,
  isIsoDate,
  isIsoTime,
  makeDate,
  minutesOf,
  parts,
  toDayNumber,
  type IsoDate,
  type IsoTime,
} from './dates.ts';

export const REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
export type Repeat = (typeof REPEATS)[number];

/** Version of the saved data. 2 added reminders. */
export const DATA_VERSION = 2;

export const MAX_TITLE_LENGTH = 100;
export const MAX_NOTES_LENGTH = 1000;
export const MAX_EVENTS = 2000;
/** Longest an event may last, in days. */
export const MAX_SPAN_DAYS = 366;
/** Earliest reminder: 4 weeks before. */
export const MAX_REMINDER_MINUTES = 4 * 7 * 1440;

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: IsoDate;
  /** Same as startDate for a one-day event. */
  endDate: IsoDate;
  /** null means all day. */
  startTime: IsoTime | null;
  /** null for all-day events, or a timed event without an end time. */
  endTime: IsoTime | null;
  repeat: Repeat;
  /** Last day a repeating event may start on (null = forever). */
  repeatUntil: IsoDate | null;
  /**
   * Minutes before the start to remind (null = no reminder). An all-day event
   * starts at midnight, so -540 means 9:00 on the day and 900 means 9:00 the day before.
   */
  reminder: number | null;
  notes: string;
}

export type EventDraft = Omit<CalendarEvent, 'id'>;

export interface CalendarState {
  events: CalendarEvent[];
}

export const emptyState = (): CalendarState => ({ events: [] });

export type DraftField =
  | 'title'
  | 'endDate'
  | 'startDate'
  | 'startTime'
  | 'endTime'
  | 'repeatUntil'
  | 'reminder'
  | 'notes'
  | 'form';

/** Reminders run from 4 weeks before to the start (all-day: to 23:59 on the first day). */
export function isValidReminder(minutes: unknown, allDay: boolean): minutes is number {
  return (
    Number.isInteger(minutes) &&
    (minutes as number) <= MAX_REMINDER_MINUTES &&
    (minutes as number) >= (allDay ? -1439 : 0)
  );
}

/** The longest an event may last so it ends before it repeats. */
function maxSpanFor(repeat: Repeat): number {
  switch (repeat) {
    case 'daily':
      return 0;
    case 'weekly':
      return 6;
    case 'monthly':
      return 27;
    case 'yearly':
      return 364;
    default:
      return MAX_SPAN_DAYS;
  }
}

/** Problems with a draft, by field. An empty object means it can be saved. */
export function draftProblems(draft: EventDraft): Partial<Record<DraftField, string>> {
  const problems: Partial<Record<DraftField, string>> = {};
  const title = draft.title.trim();
  if (!title) problems.title = 'Enter a title.';
  else if (title.length > MAX_TITLE_LENGTH)
    problems.title = `Use ${MAX_TITLE_LENGTH} characters or fewer.`;

  if (!isIsoDate(draft.startDate)) problems.startDate = 'Enter a valid start date.';
  if (!isIsoDate(draft.endDate)) problems.endDate = 'Enter a valid end date.';

  const allDay = draft.startTime === null;
  if (!allDay && !isIsoTime(draft.startTime)) problems.startTime = 'Enter a valid start time.';
  if (draft.endTime !== null && !isIsoTime(draft.endTime))
    problems.endTime = 'Enter a valid end time.';
  if (allDay && draft.endTime !== null) problems.endTime = 'An all-day event has no end time.';

  if (!problems.startDate && !problems.endDate) {
    const span = daysBetween(draft.startDate, draft.endDate);
    // A timed event may end on the day it repeats, before its start time: a
    // daily 22:00–06:00 shift still ends before the next one starts.
    const overnight =
      draft.repeat !== 'none' &&
      !allDay &&
      isIsoTime(draft.startTime) &&
      isIsoTime(draft.endTime) &&
      (draft.endTime as string) <= (draft.startTime as string);
    if (span < 0) problems.endDate = 'The end date must be on or after the start date.';
    else if (span > maxSpanFor(draft.repeat) + (overnight ? 1 : 0)) {
      problems.endDate =
        draft.repeat === 'none'
          ? `An event can last up to ${MAX_SPAN_DAYS} days.`
          : 'A repeating event must end before it repeats.';
    } else if (
      span === 0 &&
      !allDay &&
      !problems.startTime &&
      draft.endTime !== null &&
      !problems.endTime &&
      minutesOf(draft.endTime) <= minutesOf(draft.startTime as IsoTime)
    ) {
      problems.endTime = 'The end time must be after the start time.';
    }
  }

  if (!(REPEATS as readonly string[]).includes(draft.repeat))
    problems.form = 'Choose how often it repeats.';
  if (draft.repeatUntil !== null) {
    if (draft.repeat === 'none') problems.repeatUntil = 'Only repeating events have an end date.';
    else if (!isIsoDate(draft.repeatUntil)) problems.repeatUntil = 'Enter a valid date.';
    else if (isIsoDate(draft.startDate) && compareDates(draft.repeatUntil, draft.startDate) < 0) {
      problems.repeatUntil = 'Repeating must end on or after the first day.';
    }
  }
  if (draft.reminder !== null && !isValidReminder(draft.reminder, allDay))
    problems.reminder = 'Choose when to be reminded.';
  if (draft.notes.length > MAX_NOTES_LENGTH)
    problems.notes = `Use ${MAX_NOTES_LENGTH} characters or fewer.`;
  return problems;
}

function clean(draft: EventDraft): EventDraft {
  return { ...draft, title: draft.title.trim(), notes: draft.notes.trim() };
}

export function addEvent(state: CalendarState, draft: EventDraft, id: string): CalendarState {
  if (Object.keys(draftProblems(draft)).length > 0 || state.events.length >= MAX_EVENTS)
    return state;
  return { events: [...state.events, { id, ...clean(draft) }] };
}

/**
 * Puts in the changed event. One deleted on another device (or in another
 * tab) while it was being changed comes back with the change: a change wins
 * over a deletion, as sync does (audit F1-3).
 */
export function updateEvent(state: CalendarState, id: string, draft: EventDraft): CalendarState {
  if (Object.keys(draftProblems(draft)).length > 0) return state;
  const changed = { id, ...clean(draft) };
  if (!state.events.some((event) => event.id === id)) return { events: [...state.events, changed] };
  return { events: state.events.map((event) => (event.id === id ? changed : event)) };
}

/** An event's fields, as the editor holds them. */
export const draftOf = ({ id: _id, ...draft }: CalendarEvent): EventDraft => draft;

/**
 * Saves the editor. While it was open, a sync (or another tab) may have
 * changed the event: only what was changed in the editor goes on the event
 * as it is now, so the other change stays (withEdits, audit F1-2). If the
 * two don't fit together (say, an end time set here before a start moved
 * there), the editor wins, as it was checked. `opened` is the editor as it
 * opened, `edited` as it is now.
 */
export function editEvent(
  state: CalendarState,
  id: string,
  opened: EventDraft,
  edited: EventDraft,
): CalendarState {
  const current = state.events.find((event) => event.id === id);
  const merged = current ? withEdits(opened, edited, draftOf(current)) : edited;
  const draft = Object.keys(draftProblems(merged)).length === 0 ? merged : edited;
  return updateEvent(state, id, draft);
}

/**
 * An event changed on two devices at once: this device's version, kept as
 * its own event next to the other device's (packages/sync, conflictCopy).
 */
export const secondVersion = (event: CalendarEvent, id: string): CalendarEvent => ({
  ...event,
  id,
  title: secondVersionName(event.title, MAX_TITLE_LENGTH),
});

export function removeEvent(state: CalendarState, id: string): CalendarState {
  return { events: state.events.filter((event) => event.id !== id) };
}

function isCalendarEvent(value: unknown): value is CalendarEvent {
  if (typeof value !== 'object' || value === null) return false;
  const event = value as Record<string, unknown>;
  if (typeof event['id'] !== 'string' || !event['id']) return false;
  const draft = {
    title: event['title'],
    startDate: event['startDate'],
    endDate: event['endDate'],
    startTime: event['startTime'],
    endTime: event['endTime'],
    repeat: event['repeat'],
    repeatUntil: event['repeatUntil'],
    reminder: event['reminder'],
    notes: event['notes'],
  };
  if (typeof draft.title !== 'string' || typeof draft.notes !== 'string') return false;
  return Object.keys(draftProblems(draft as EventDraft)).length === 0;
}

/** True when saved data has the shape Calendar expects. */
export function isCalendarState(value: unknown): value is CalendarState {
  if (typeof value !== 'object' || value === null) return false;
  const { events } = value as Record<string, unknown>;
  return Array.isArray(events) && events.every(isCalendarEvent);
}

/** Turns data saved by an older version into the current shape, or undefined. */
export function migrateState(data: unknown, version: number): CalendarState | undefined {
  if (version !== 1 || typeof data !== 'object' || data === null) return undefined;
  const { events } = data as Record<string, unknown>;
  if (!Array.isArray(events)) return undefined;
  // Version 1 had no reminders.
  const migrated = {
    events: events.map((event: unknown) => ({ ...(event as object), reminder: null })),
  };
  return isCalendarState(migrated) ? migrated : undefined;
}

export interface ImportResult {
  state: CalendarState;
  added: number;
  /** Already in the calendar (same id). */
  duplicates: number;
  /** Left out because the calendar is full. */
  overLimit: number;
}

/** Adds events from a file, skipping ones already here (same id) and anything over the limit. */
export function importEvents(
  state: CalendarState,
  items: readonly { id: string; draft: EventDraft }[],
): ImportResult {
  const ids = new Set(state.events.map((event) => event.id));
  const added: CalendarEvent[] = [];
  let duplicates = 0;
  let overLimit = 0;
  for (const { id, draft } of items) {
    if (ids.has(id)) duplicates += 1;
    else if (Object.keys(draftProblems(draft)).length > 0) continue;
    else if (state.events.length + added.length >= MAX_EVENTS) overLimit += 1;
    else {
      ids.add(id);
      added.push({ id, ...clean(draft) });
    }
  }
  return {
    state: added.length ? { events: [...state.events, ...added] } : state,
    added: added.length,
    duplicates,
    overLimit,
  };
}

/** One appearance of an event (repeating events have many). */
export interface Occurrence {
  event: CalendarEvent;
  start: IsoDate;
  end: IsoDate;
}

/** Start dates of an event's occurrences that could overlap [from, to]. */
function occurrenceStarts(event: CalendarEvent, from: IsoDate, to: IsoDate): IsoDate[] {
  const span = daysBetween(event.startDate, event.endDate);
  const earliest = addDays(from, -span);
  let last = to;
  if (event.repeatUntil && compareDates(event.repeatUntil, last) < 0) last = event.repeatUntil;
  if (compareDates(event.startDate, last) > 0) return [];
  if (event.repeat === 'none') return [event.startDate];

  const starts: IsoDate[] = [];
  const first = compareDates(event.startDate, earliest) > 0 ? event.startDate : earliest;
  const lastDay = toDayNumber(last);

  if (event.repeat === 'daily' || event.repeat === 'weekly') {
    const step = event.repeat === 'daily' ? 1 : 7;
    const offset = Math.ceil(daysBetween(event.startDate, first) / step) * step;
    for (let day = toDayNumber(event.startDate) + offset; day <= lastDay; day += step) {
      starts.push(addDays(event.startDate, day - toDayNumber(event.startDate)));
    }
    return starts;
  }

  const origin = parts(event.startDate);
  const firstParts = parts(first);
  if (event.repeat === 'monthly') {
    let index = Math.max(
      origin.year * 12 + origin.month - 1,
      firstParts.year * 12 + firstParts.month - 1,
    );
    for (;;) {
      const year = Math.floor(index / 12);
      const month = (index % 12) + 1;
      if (toDayNumber(makeDate(year, month, 1)) > lastDay) break;
      if (origin.day <= daysInMonth(year, month)) {
        const start = makeDate(year, month, origin.day);
        if (compareDates(start, first) >= 0 && compareDates(start, last) <= 0) starts.push(start);
      }
      index += 1;
    }
    return starts;
  }

  // yearly
  for (let year = Math.max(origin.year, firstParts.year); ; year += 1) {
    if (toDayNumber(makeDate(year, 1, 1)) > lastDay) break;
    if (origin.day <= daysInMonth(year, origin.month)) {
      const start = makeDate(year, origin.month, origin.day);
      if (compareDates(start, first) >= 0 && compareDates(start, last) <= 0) starts.push(start);
    }
  }
  return starts;
}

/** Sort order: by date, all-day first, then by start time, then by title. */
export function compareOccurrences(a: Occurrence, b: Occurrence): number {
  return (
    compareDates(a.start, b.start) ||
    (a.event.startTime === null ? -1 : 0) - (b.event.startTime === null ? -1 : 0) ||
    (a.event.startTime ?? '').localeCompare(b.event.startTime ?? '') ||
    a.event.title.localeCompare(b.event.title)
  );
}

/** Every occurrence overlapping the days from `from` to `to` (inclusive), sorted. */
export function occurrencesBetween(state: CalendarState, from: IsoDate, to: IsoDate): Occurrence[] {
  const result: Occurrence[] = [];
  for (const event of state.events) {
    const span = daysBetween(event.startDate, event.endDate);
    for (const start of occurrenceStarts(event, from, to)) {
      const end = addDays(start, span);
      if (compareDates(end, from) >= 0 && compareDates(start, to) <= 0) {
        result.push({ event, start, end });
      }
    }
  }
  return result.sort(compareOccurrences);
}

/** Occurrences that cover `day`, from a list made by occurrencesBetween. */
export function onDay(occurrences: readonly Occurrence[], day: IsoDate): Occurrence[] {
  return occurrences.filter(
    (occurrence) =>
      compareDates(occurrence.start, day) <= 0 && compareDates(occurrence.end, day) >= 0,
  );
}

/**
 * How an occurrence's time reads on a given day, e.g. "All day", "14:30 – 15:30",
 * "From 22:00", "Until 02:00", "Continues". `formatTime` turns "14:30" into the
 * person's preferred format.
 */
export function timeLabel(
  occurrence: Occurrence,
  day: IsoDate,
  formatTime: (time: IsoTime) => string,
): string {
  const { event, start, end } = occurrence;
  if (event.startTime === null) return 'All day';
  const isFirst = start === day;
  const isLast = end === day;
  const from = formatTime(event.startTime);
  const until = event.endTime === null ? null : formatTime(event.endTime);
  if (isFirst && isLast) return until ? `${from} – ${until}` : from;
  if (isFirst) return `From ${from}`;
  if (isLast) return until ? `Until ${until}` : 'Continues';
  return 'Continues';
}

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};
