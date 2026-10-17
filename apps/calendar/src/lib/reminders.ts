/**
 * Reminders: when they go off, what they're called, and which are due.
 *
 * A reminder is a number of minutes before an event starts (see
 * CalendarEvent.reminder). Times are "floating" local times, like the events.
 */
import { addDays, addMinutes, toStamp, type IsoTime, type Stamp } from './dates.ts';
import {
  compareOccurrences,
  occurrencesBetween,
  type CalendarState,
  type Occurrence,
} from './events.ts';

/** Choices for events with a time, in minutes before the start. */
export const TIMED_REMINDERS = [0, 5, 10, 15, 30, 60, 120, 1440, 10080] as const;
/** Choices for all-day events: 9:00 on the day, or 1 day, 2 days or 1 week before at 9:00. */
export const ALL_DAY_REMINDERS = [-540, 900, 2340, 9540] as const;
/** What the reminder list switches to when an event changes between all-day and timed. */
export const DEFAULT_REMINDER = { timed: 15, allDay: -540 } as const;

/** Reminders missed while Calendar was closed still show if they're this recent. */
export const LOOKBACK_MINUTES = 12 * 60;

const count = (value: number, word: string): string => `${value} ${word}${value === 1 ? '' : 's'}`;

/** Minutes after midnight as "HH:MM". */
const clock = (minutes: number): IsoTime =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** For example "15 minutes before", "1 hour 30 minutes before" or "1 day before at 9:00 AM". */
export function reminderLabel(
  minutes: number,
  allDay: boolean,
  formatTime: (time: IsoTime) => string,
): string {
  if (allDay) {
    // Minutes after midnight on the first day (negative = days before).
    const offset = -minutes;
    const days = Math.floor(offset / 1440);
    const at = formatTime(clock(offset - days * 1440));
    if (days === 0) return `On the day at ${at}`;
    const before = -days % 7 === 0 ? count(-days / 7, 'week') : count(-days, 'day');
    return `${before} before at ${at}`;
  }
  if (minutes === 0) return 'At the start time';
  if (minutes % 10080 === 0) return `${count(minutes / 10080, 'week')} before`;
  const parts = [
    [Math.floor(minutes / 1440), 'day'],
    [Math.floor((minutes % 1440) / 60), 'hour'],
    [minutes % 60, 'minute'],
  ] as const;
  const text = parts.filter(([value]) => value > 0).map(([value, word]) => count(value, word));
  return `${text.join(' ')} before`;
}

/** When an occurrence starts: its start time, or midnight for all-day events. */
export const startStamp = (occurrence: Occurrence): Stamp =>
  toStamp(occurrence.start, occurrence.event.startTime ?? '00:00');

/** When an occurrence's reminder goes off. */
export const reminderStamp = (occurrence: Occurrence): Stamp =>
  addMinutes(startStamp(occurrence), -(occurrence.event.reminder ?? 0));

/** When an occurrence is over (an hour after the start if it has no end time). */
export function finishStamp(occurrence: Occurrence): Stamp {
  const { event, end } = occurrence;
  if (event.startTime === null) return toStamp(addDays(end, 1));
  if (event.endTime !== null) return toStamp(end, event.endTime);
  return addMinutes(startStamp(occurrence), 60);
}

export interface DueReminder {
  occurrence: Occurrence;
  /** When it went off. */
  at: Stamp;
}

/**
 * Reminders that went off after `after` and up to `until`, oldest first.
 * Ones older than `lookback` minutes, or for events already over, are left out.
 */
export function dueReminders(
  state: CalendarState,
  after: Stamp,
  until: Stamp,
  lookback = LOOKBACK_MINUTES,
): DueReminder[] {
  const earliest = addMinutes(until, -lookback);
  const from = after > earliest ? after : earliest;
  if (from >= until) return [];

  const due: DueReminder[] = [];
  for (const event of state.events) {
    if (event.reminder === null) continue;
    // A reminder at `at` belongs to an occurrence starting `reminder` minutes later.
    const firstDay = addMinutes(from, event.reminder).slice(0, 10);
    const lastDay = addMinutes(until, event.reminder).slice(0, 10);
    for (const occurrence of occurrencesBetween({ events: [event] }, firstDay, lastDay)) {
      const at = reminderStamp(occurrence);
      if (at > from && at <= until && finishStamp(occurrence) > until) due.push({ occurrence, at });
    }
  }
  return due.sort(
    (a, b) =>
      (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || compareOccurrences(a.occurrence, b.occurrence),
  );
}
